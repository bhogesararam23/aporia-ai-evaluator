/**
 * Pure batch semantics for the offline review workflow (ADR-027, defect 5).
 *
 * v0.6 merged what it could and wrote straight into the output directory. A batch containing one defective
 * submission therefore produced a partially-updated corpus, with no record of which files had been written
 * and no way to resume or roll back — the failure mode a reviewer trusting a corpus least wants.
 *
 * This module changes no files. It turns a set of inputs into a *plan*: a deterministic value saying which
 * item was accepted or refused, with what reason, and exactly which bytes would be written. The filesystem
 * layer in `scripts/benchmark-case.ts` publishes that plan through a staging directory and a journal, so an
 * interrupted run can be recognised and finished or discarded.
 *
 * Atomic is the default: if any item is refused, nothing applies. `isolated` is the explicit opt-in for an
 * operator who wants the accepted items anyway, and even then every refusal is reported.
 *
 * No clock, no paths, no absolute directories, no ordering dependence: the same inputs always produce the
 * same plan and the same `planHash`.
 */
import type { AnnotationSubmission, BenchmarkCase } from './types.ts';
import { BENCHMARK_BATCH_JOURNAL_VERSION } from './types.ts';
import { contentHash } from './hashing.ts';
import { normaliseCase } from './authoring.ts';
import { mergeSubmission, type PendingAdjudication, applyAdjudication } from './review.ts';
import { reviewerIdentity } from './provenance.ts';

export type BatchMode = 'atomic' | 'isolated';
export type BatchKind = 'merge' | 'adjudication';

/** One input item and whether the batch would accept it. */
export interface BatchPlanItem {
  /** Deterministic identity: the case and the reviewer or subject, never an input position. */
  readonly key: string;
  readonly caseId: string;
  readonly subject: string;
  readonly accepted: boolean;
  readonly reasons: readonly string[];
}

/** The full decision of a batch run, as a value that can be hashed, journalled and compared. */
export interface BatchPlan {
  readonly kind: BatchKind;
  readonly mode: BatchMode;
  readonly items: readonly BatchPlanItem[];
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  /** True when nothing was refused, which is the only condition under which an atomic batch writes. */
  readonly clean: boolean;
  readonly planHash: string;
  /** The cases that would be written. Identical to the input when an atomic batch is not clean. */
  readonly cases: readonly BenchmarkCase[];
  /** Ids whose canonical bytes actually differ from the input, so an unchanged case need not be rewritten. */
  readonly changedCaseIds: readonly string[];
}

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function canonical(cases: readonly BenchmarkCase[]): Map<string, string> {
  return new Map(cases.map((benchmarkCase) => [benchmarkCase.id, normaliseCase(benchmarkCase)]));
}

function finishPlan(
  kind: BatchKind,
  mode: BatchMode,
  items: readonly BatchPlanItem[],
  inputCases: readonly BenchmarkCase[],
  workedCases: ReadonlyMap<string, BenchmarkCase>,
): BatchPlan {
  const acceptedCount = items.filter((item) => item.accepted).length;
  const rejectedCount = items.length - acceptedCount;
  const clean = rejectedCount === 0;
  // Atomic and not clean means the batch applies nothing: a corpus cannot be half-reviewed by accident.
  const applyChanges = clean || mode === 'isolated';
  const cases = inputCases.map((benchmarkCase) =>
    applyChanges ? workedCases.get(benchmarkCase.id)! : benchmarkCase,
  );
  const before = canonical(inputCases);
  const changedCaseIds = cases
    .filter((benchmarkCase) => before.get(benchmarkCase.id) !== normaliseCase(benchmarkCase))
    .map((benchmarkCase) => benchmarkCase.id)
    .sort(compareStrings);
  const planHash = contentHash({
    kind,
    mode,
    items: items.map((item) => ({
      key: item.key,
      accepted: item.accepted,
      reasons: item.reasons,
    })),
  });
  return {
    kind,
    mode,
    items,
    acceptedCount,
    rejectedCount,
    clean,
    planHash,
    cases,
    changedCaseIds,
  };
}

/**
 * Plan a batch of reviewer submissions against a set of cases.
 *
 * Duplicate detection works across the whole batch: a second submission from the same canonical reviewer for
 * the same case is refused even though the first has not been written anywhere yet. Items are ordered by
 * (case, reviewer, submission hash) so the plan does not depend on the order files happened to be read in.
 */
export function planBatchMerge(
  cases: readonly BenchmarkCase[],
  submissions: readonly AnnotationSubmission[],
  mode: BatchMode = 'atomic',
): BatchPlan {
  const byId = new Map(cases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]));
  const worked = new Map(byId);
  const appliedReviewers = new Map<string, string[]>();
  const ordered = [...submissions]
    .map((submission, index) => ({
      submission,
      index,
      key: `${submission.caseId}\u0000${reviewerIdentity(submission.reviewer)}\u0000${contentHash(submission)}`,
    }))
    .sort(
      (left, right) =>
        compareStrings(left.key, right.key) ||
        // Identical submissions in one batch are indistinguishable by content, so keep their file order as
        // the final tiebreak: the first is the submission, the second is the duplicate.
        left.index - right.index,
    );

  const items: BatchPlanItem[] = [];
  for (const { submission } of ordered) {
    const reviewerKey = reviewerIdentity(submission.reviewer);
    const target = byId.get(submission.caseId);
    if (target === undefined) {
      items.push({
        key: `${submission.caseId}|${reviewerKey}`,
        caseId: submission.caseId,
        subject: reviewerKey,
        accepted: false,
        reasons: [`No case in the batch matches this submission’s case id "${submission.caseId}".`],
      });
      continue;
    }
    const already = appliedReviewers.get(submission.caseId) ?? [];
    const result = mergeSubmission(worked.get(submission.caseId)!, submission, already);
    if (result.ok) {
      worked.set(submission.caseId, result.case);
      appliedReviewers.set(submission.caseId, [...already, reviewerKey]);
      items.push({
        key: `${submission.caseId}|${reviewerKey}`,
        caseId: submission.caseId,
        subject: reviewerKey,
        accepted: true,
        reasons: [],
      });
    } else {
      items.push({
        key: `${submission.caseId}|${reviewerKey}`,
        caseId: submission.caseId,
        subject: reviewerKey,
        accepted: false,
        reasons: result.reasons,
      });
    }
  }
  return finishPlan('merge', mode, items, cases, worked);
}

/**
 * Plan a batch of adjudications against a set of cases.
 *
 * Each decision is applied to the case as the batch has made it so far, so a decision that settles a subject
 * moves that subject out of `UNRESOLVED` and a second decision on the same split is refused within the run.
 */
export function planBatchAdjudication(
  cases: readonly BenchmarkCase[],
  adjudications: readonly PendingAdjudication[],
  mode: BatchMode = 'atomic',
): BatchPlan {
  const byId = new Map(cases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]));
  const worked = new Map(byId);
  const ordered = [...adjudications]
    .map((entry, index) => ({
      entry,
      index,
      key: `${entry.caseId}\u0000${entry.dimension}/${entry.subjectId}\u0000${contentHash(entry)}`,
    }))
    .sort((left, right) => compareStrings(left.key, right.key) || left.index - right.index);

  const items: BatchPlanItem[] = [];
  for (const { entry } of ordered) {
    const subject = `${entry.dimension}/${entry.subjectId}`;
    const target = byId.get(entry.caseId);
    if (target === undefined) {
      items.push({
        key: `${entry.caseId}|${subject}`,
        caseId: entry.caseId,
        subject,
        accepted: false,
        reasons: [`No case in the batch matches this adjudication’s case id "${entry.caseId}".`],
      });
      continue;
    }
    const result = applyAdjudication(worked.get(entry.caseId)!, entry);
    if (result.ok) {
      worked.set(entry.caseId, result.case);
      items.push({
        key: `${entry.caseId}|${subject}`,
        caseId: entry.caseId,
        subject,
        accepted: true,
        reasons: [],
      });
    } else {
      items.push({
        key: `${entry.caseId}|${subject}`,
        caseId: entry.caseId,
        subject,
        accepted: false,
        reasons: result.reasons,
      });
    }
  }
  return finishPlan('adjudication', mode, items, cases, worked);
}

/** One file a batch would publish, with the bytes and their hash. */
export interface StagedFile {
  readonly name: string;
  readonly contents: string;
  readonly contentsHash: string;
}

/**
 * Render a case set as the exact files a batch writes.
 *
 * Names are bare and sorted — a path separator in a staged name would let a case id escape the output
 * directory. Contents are canonical JSON with LF endings, so the same corpus produces the same bytes on
 * Windows, Linux and macOS and a resumed run can recognise a file it already wrote.
 */
export function renderStagedCorpus(cases: readonly BenchmarkCase[]): StagedFile[] {
  return cases
    .map((benchmarkCase) => {
      const contents = normaliseCase(benchmarkCase);
      return {
        name: `${benchmarkCase.id}.json`,
        contents,
        contentsHash: contentHash(contents),
      };
    })
    .sort((left, right) => compareStrings(left.name, right.name));
}

export const BATCH_JOURNAL_STATES = ['staged', 'committing', 'committed'] as const;
export type BatchJournalState = (typeof BATCH_JOURNAL_STATES)[number];

export interface BatchJournalItem {
  readonly name: string;
  readonly contentsHash: string;
}

/**
 * The record a staged batch leaves behind. It is the only evidence an interrupted run exists, so recovery is
 * driven entirely by reading it: `staged` means the target was never touched and can be discarded, and
 * `committing` means publishing must be finished.
 *
 * It deliberately stores no absolute path and no timestamp. The target directory is supplied again by the
 * operator running the recovery, and the journal's own `planHash` is what identifies the work.
 */
export interface BatchJournal {
  readonly version: string;
  readonly planHash: string;
  readonly kind: BatchKind;
  readonly mode: BatchMode;
  readonly state: BatchJournalState;
  readonly items: readonly BatchJournalItem[];
}

export type JournalAdvance =
  | { readonly ok: true; readonly journal: BatchJournal }
  | { readonly ok: false; readonly reason: string };

/** Only the next state in the sequence is legal; skipping or rewinding would misreport what happened. */
export function isLegalJournalTransition(from: BatchJournalState, to: BatchJournalState): boolean {
  return BATCH_JOURNAL_STATES.indexOf(to) === BATCH_JOURNAL_STATES.indexOf(from) + 1;
}

export function advanceJournal(journal: BatchJournal, to: BatchJournalState): JournalAdvance {
  if (!isLegalJournalTransition(journal.state, to)) {
    return {
      ok: false,
      reason: `Illegal journal transition "${journal.state}" → "${to}". A batch journal moves staged → committing → committed and never backwards, or a completed run could be mistaken for an interrupted one.`,
    };
  }
  return { ok: true, journal: { ...journal, state: to } };
}

/** A journal for a plan, positioned at `staged` with the files it would publish. */
export function createJournal(plan: BatchPlan, staged: readonly StagedFile[]): BatchJournal {
  return {
    version: BENCHMARK_BATCH_JOURNAL_VERSION,
    planHash: plan.planHash,
    kind: plan.kind,
    mode: plan.mode,
    state: 'staged',
    items: staged.map((file) => ({ name: file.name, contentsHash: file.contentsHash })),
  };
}
