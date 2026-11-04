/**
 * Benchmark human-review workflow (ADR-026): blinded packets, separate submissions, safe merge,
 * disagreement reporting and corpus readiness audits.
 *
 * Everything here is pure and offline: it reads parsed JSON values and returns plain data, never the
 * application database, a network, or a clock. Timestamps and reviewer identities come from the human
 * submitting the work; the tool never invents a label, a reviewer, a timestamp, a permission, or a
 * gold answer. The reviewer packet is deliberately blinded: it excludes gold labels, existing
 * annotations, and any evaluator output, so a review is not anchored by what the tool already did.
 *
 * These workflow artifacts are new file formats with their own versions; the benchmark *case* contract
 * is unchanged (`benchmark-case-v1`/`v2` still read), so no corpus migration is implied.
 */
import {
  BENCHMARK_ADJUDICATION_VERSION,
  BENCHMARK_ADJUDICATION_VERSION_V2,
  BENCHMARK_AUDIT_VERSION,
  BENCHMARK_PACKET_VERSION,
  BENCHMARK_STRATA,
  BENCHMARK_SUBMISSION_VERSION,
  BENCHMARK_SUBMISSION_VERSION_V2,
} from './types.ts';
import type {
  AnnotationSubmission,
  BenchmarkAdjudication,
  BenchmarkCase,
  BenchmarkDimension,
  BenchmarkInputPack,
  BenchmarkReviewerLabel,
} from './types.ts';
import { contentHash } from './hashing.ts';
import { benchmarkDimensionLabels } from './validate.ts';
import { isoDateTime } from '../core/validation.ts';
import {
  compareStrings,
  declaredRoster,
  disagreementStateHash,
  isDeclaredReviewer,
  resolveSettlingAdjudication,
  reviewerIdentity,
  reviewerLabelFromAnnotation,
  subjectLabelEntries,
  submissionHash,
  type AdjudicationBinding,
  type LabelProvenance,
} from './provenance.ts';
import { isContentHash } from './hashing.ts';

// The canonical version strings live in `types.ts` (the contracts module); these are stable aliases so
// callers of this module keep a single source of truth for a workflow artifact's version.
export const REVIEW_PACKET_VERSION = BENCHMARK_PACKET_VERSION;
export const SUBMISSION_VERSION = BENCHMARK_SUBMISSION_VERSION;
export const SUBMISSION_VERSION_V2 = BENCHMARK_SUBMISSION_VERSION_V2;

const PACKET_INSTRUCTIONS =
  'Label every subject from the frozen input only. Judge each dimension on its own evidence; a ' +
  'refusal is not a denial, silence is not a wrong statement, and absence of recorded evidence is ' +
  'not contradiction. Do not add knowledge the case does not contain. Read the annotation rubric ' +
  '(docs/evaluator/BENCHMARK_ANNOTATION_RUBRIC.md) before labelling.';

/** A single (dimension, subject) the reviewer must judge. */
export interface ReviewerSubject {
  readonly dimension: BenchmarkDimension;
  readonly subjectId: string;
}

/** What a reviewer is shown: the frozen input and the subjects, with no gold or prior output. */
export interface ReviewerPacket {
  readonly version: string;
  readonly caseId: string;
  readonly packetHash: string;
  readonly subjects: readonly ReviewerSubject[];
  readonly input: BenchmarkInputPack;
  readonly instructions: string;
}

/**
 * One label a reviewer recorded for one subject, and their submission bound to a packet by its hash.
 *
 * Both contracts live in `types.ts` (they are shared with the batch planner), and are re-exported below so
 * existing importers of this module keep resolving them from here.
 */

/**
 * `canonicalise`, `contentHash` and `isContentHash` live in `hashing.ts` so the review workflow, the batch
 * planner and the release manifest hash values identically. They are re-exported here because every
 * existing importer of `review.ts` keeps working — one hash function is the whole point.
 */
export { canonicalise, contentHash, isContentHash } from './hashing.ts';
export type { AnnotationSubmission, SubmissionAnnotation } from './types.ts';

/**
 * The subjects a case must be labelled on, derived from its input pack alone.
 *
 * Evidence support is a property of a proposition; answer fidelity, citation support and attribution
 * are properties of a recorded statement. Deriving subjects from the input — never from the gold
 * labels — keeps the packet blind: a subject list copied from `expected` would leak which labels exist.
 */
export function deriveSubjects(input: BenchmarkInputPack): ReviewerSubject[] {
  const subjects: ReviewerSubject[] = [];
  for (const proposition of input.propositions) {
    subjects.push({ dimension: 'EVIDENCE_SUPPORT', subjectId: proposition.id });
  }
  for (const statement of input.statements) {
    subjects.push({ dimension: 'ANSWER_FIDELITY', subjectId: statement.id });
    subjects.push({ dimension: 'CITATION_SUPPORT', subjectId: statement.id });
    subjects.push({ dimension: 'ATTRIBUTION', subjectId: statement.id });
  }
  return subjects;
}

/** Build the blinded packet for a case: input + subjects + hash, with gold/annotations/output removed. */
export function buildReviewerPacket(benchmarkCase: BenchmarkCase): ReviewerPacket {
  const subjects = deriveSubjects(benchmarkCase.input);
  // The hash covers exactly what the reviewer sees that binds the judgement to the frozen input.
  const packetHash = contentHash({
    version: REVIEW_PACKET_VERSION,
    caseId: benchmarkCase.id,
    subjects,
    input: benchmarkCase.input,
  });
  return {
    version: REVIEW_PACKET_VERSION,
    caseId: benchmarkCase.id,
    packetHash,
    subjects,
    input: benchmarkCase.input,
    instructions: PACKET_INSTRUCTIONS,
  };
}

/**
 * A submission skeleton for one packet: one empty annotation per subject. Nothing is pre-filled — the
 * reviewer supplies the label, rationale, their own identity and their own timestamp.
 *
 * New templates are v2, so work issued from now on is bound to a real instant. A v1 submission file a reviewer
 * already filled in is still accepted on merge, which is why the version travels with the artifact rather
 * than being inferred.
 */
export function buildSubmissionTemplate(packet: ReviewerPacket): AnnotationSubmission {
  return {
    version: SUBMISSION_VERSION_V2,
    caseId: packet.caseId,
    packetHash: packet.packetHash,
    reviewer: '',
    submittedAt: '',
    annotations: packet.subjects.map((subject) => ({
      dimension: subject.dimension,
      subjectId: subject.subjectId,
      label: '',
      rationale: '',
    })),
  };
}

export type MergeResult =
  | { readonly ok: true; readonly case: BenchmarkCase }
  | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * Safely merge one reviewer submission into a case, appending to its reviewer labels.
 *
 * It refuses rather than repairs: a submission on an unsupported version, aimed at another case, bound to a
 * now-stale input hash, from a reviewer the case does not declare, duplicating a reviewer who already
 * submitted (however they spelled the name), containing a subject this case has no gold for, an
 * out-of-vocabulary label, a blank rationale, or a missing reviewer or timestamp is rejected in full and the
 * case is returned untouched. Every reason is reported at once, so a defective file is fixed in one pass.
 *
 * What it keeps (ADR-027): the reviewer's rationale, the timestamp they supplied, the packet hash the
 * judgement was bound to and the hash of the submission record it arrived in. v0.6 demanded the first two,
 * checked the third, and stored none.
 *
 * What it never does: edit the gold `expected` array, delete an existing reviewer's label, widen
 * `provenance.reviewedBy`, invent a reviewer, label or timestamp, or read a clock. Authorising a reviewer is
 * a human edit to the case, and an empty roster therefore authorises nobody.
 */
export function mergeSubmission(
  benchmarkCase: BenchmarkCase,
  submission: AnnotationSubmission,
  alreadyMergedReviewers: readonly string[] = [],
): MergeResult {
  const reasons: string[] = [];
  const versionSupported =
    submission.version === SUBMISSION_VERSION || submission.version === SUBMISSION_VERSION_V2;
  if (!versionSupported) {
    reasons.push(
      `Unsupported submission version "${submission.version}". Accepted: ${SUBMISSION_VERSION}, ${SUBMISSION_VERSION_V2}.`,
    );
  }
  if (submission.caseId !== benchmarkCase.id) {
    reasons.push(
      `Submission is for case "${submission.caseId}", which does not match this case "${benchmarkCase.id}".`,
    );
  }
  const packet = buildReviewerPacket(benchmarkCase);
  if (submission.packetHash !== packet.packetHash) {
    reasons.push(
      'Stale submission: its packet hash does not match the case input, which changed since the packet was issued.',
    );
  }

  // Reviewer identity is canonical, so one person cannot submit twice by changing capitalisation and be
  // counted as a second reviewer agreeing with themselves.
  const reviewerKey = reviewerIdentity(submission.reviewer);
  if (reviewerKey === '') {
    reasons.push('A submission must carry a reviewer label; the tool will not invent one.');
  } else {
    const roster = declaredRoster(benchmarkCase);
    if (roster.length === 0) {
      reasons.push(
        'No reviewer is declared in provenance.reviewedBy for this case, so nobody is authorised to submit. Declaring a reviewer is a human decision this tool will not make.',
      );
    } else if (!roster.includes(reviewerKey)) {
      reasons.push(
        `Reviewer "${submission.reviewer.trim()}" is not in the declared roster (provenance.reviewedBy: ${roster.join(', ')}). A merge never authorises a reviewer; add the name to the case deliberately, which a release verify will then show as a change.`,
      );
    }
  }

  const suppliedTimestamp = submission.submittedAt.trim();
  let submittedAt = '';
  if (suppliedTimestamp === '') {
    reasons.push(
      'A submission must carry a reviewer-supplied timestamp; the tool will not invent one.',
    );
  } else if (submission.version === SUBMISSION_VERSION_V2) {
    // v2 only: a value that is not an instant cannot anchor a review in time. v1 stays as recorded, so a
    // submission file written before v0.7 still merges.
    const checked = isoDateTime(suppliedTimestamp, 'submission.submittedAt');
    if (checked.ok) {
      submittedAt = checked.value;
    } else {
      reasons.push(
        checked.issues[0]?.message ?? 'The submission timestamp is not a valid instant.',
      );
    }
  } else {
    submittedAt = suppliedTimestamp;
  }

  const priorKeys = new Set([
    ...benchmarkCase.reviewerLabels.map((label) => reviewerIdentity(label.reviewer)),
    ...alreadyMergedReviewers.map(reviewerIdentity),
  ]);
  if (reviewerKey !== '' && priorKeys.has(reviewerKey)) {
    reasons.push(`Duplicate submission: reviewer "${reviewerKey}" has already labelled this case.`);
  }
  if (submission.annotations.length === 0) {
    reasons.push('The submission records no annotations.');
  }

  const subjectKeys = new Set(
    packet.subjects.map((subject) => `${subject.dimension}/${subject.subjectId}`),
  );
  const annotatedKeys = new Set<string>();
  submission.annotations.forEach((annotation, index) => {
    const key = `${annotation.dimension}/${annotation.subjectId}`;
    if (!subjectKeys.has(key)) {
      reasons.push(
        `Annotation ${String(index)} targets "${key}", which is not a subject of this case.`,
      );
    }
    if (annotatedKeys.has(key)) {
      reasons.push(`Annotation ${String(index)} repeats the subject "${key}".`);
    }
    annotatedKeys.add(key);
    if (!benchmarkDimensionLabels(annotation.dimension).includes(annotation.label)) {
      reasons.push(
        `Annotation ${String(index)} label "${annotation.label}" is not valid for ${annotation.dimension}.`,
      );
    }
    if (annotation.rationale.trim() === '') {
      reasons.push(
        `Annotation ${String(index)} has no rationale. The rubric requires one, and an unexplained gold label cannot be reviewed later.`,
      );
    }
  });
  for (const subject of packet.subjects) {
    if (!annotatedKeys.has(`${subject.dimension}/${subject.subjectId}`)) {
      reasons.push(`Subject "${subject.dimension}/${subject.subjectId}" was not annotated.`);
    }
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }
  const provenance: LabelProvenance = {
    reviewerKey,
    submittedAt,
    packetHash: packet.packetHash,
    submissionHash: submissionHash(submission),
  };
  const appended: BenchmarkReviewerLabel[] = submission.annotations.map((annotation) =>
    reviewerLabelFromAnnotation(annotation, provenance),
  );
  return {
    ok: true,
    case: { ...benchmarkCase, reviewerLabels: [...benchmarkCase.reviewerLabels, ...appended] },
  };
}

export interface MergeOutcome {
  readonly mergedCases: readonly BenchmarkCase[];
  readonly applied: readonly { readonly caseId: string; readonly reviewer: string }[];
  readonly rejected: readonly {
    readonly caseId: string;
    readonly reviewer: string;
    readonly reasons: readonly string[];
  }[];
}

/**
 * Merge a batch of submissions into a set of cases, tracking per-case reviewers already applied in the
 * batch so a second submission from the same reviewer in the same run is rejected as a duplicate. A
 * submission whose case is not in the set is rejected (mismatched case). Order is deterministic.
 */
export function mergeSubmissions(
  cases: readonly BenchmarkCase[],
  submissions: readonly AnnotationSubmission[],
): MergeOutcome {
  const byId = new Map(cases.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]));
  const mergedReviewers = new Map<string, string[]>();
  const mergedById = new Map<string, BenchmarkCase>(byId);
  const applied: { caseId: string; reviewer: string }[] = [];
  const rejected: { caseId: string; reviewer: string; reasons: readonly string[] }[] = [];
  for (const submission of submissions) {
    const benchmarkCase = byId.get(submission.caseId);
    if (benchmarkCase === undefined) {
      rejected.push({
        caseId: submission.caseId,
        reviewer: submission.reviewer,
        reasons: ['No case in the corpus matches this submission’s case id.'],
      });
      continue;
    }
    const current = mergedById.get(submission.caseId) as BenchmarkCase;
    const already = mergedReviewers.get(submission.caseId) ?? [];
    const result = mergeSubmission(current, submission, already);
    if (result.ok) {
      mergedById.set(submission.caseId, result.case);
      mergedReviewers.set(submission.caseId, [...already, submission.reviewer.trim()]);
      applied.push({ caseId: submission.caseId, reviewer: submission.reviewer.trim() });
    } else {
      rejected.push({
        caseId: submission.caseId,
        reviewer: submission.reviewer,
        reasons: result.reasons,
      });
    }
  }
  // Emit in the original case order for determinism.
  const mergedCases = cases
    .map((benchmarkCase) => mergedById.get(benchmarkCase.id))
    .filter((value): value is BenchmarkCase => value !== undefined);
  return { mergedCases, applied, rejected };
}

/** How a subject's reviewer labels stand relative to each other. */
export type SubjectAgreementStatus =
  'UNANNOTATED' | 'SINGLE_REVIEWER' | 'UNANIMOUS' | 'ADJUDICATED' | 'UNRESOLVED';

export interface SubjectAgreement {
  readonly dimension: BenchmarkDimension;
  readonly subjectId: string;
  readonly reviewers: readonly string[];
  readonly labels: readonly string[];
  readonly status: SubjectAgreementStatus;
  readonly adjudicatedLabel: string | null;
  /** Why this subject stands where it does, when an adjudication is involved. `null` when none is. */
  readonly binding: AdjudicationBinding | null;
}

export interface DisagreementReport {
  readonly caseId: string;
  readonly subjects: readonly SubjectAgreement[];
  readonly unanimous: number;
  readonly adjudicated: number;
  readonly unresolved: number;
  /** Bound decisions whose disagreement has moved. These are counted inside `unresolved`, not instead of it. */
  readonly stale: number;
  /** Legacy decisions with no binding. They settle a subject and are reported as unverified provenance. */
  readonly unbound: number;
}

/** How many subjects in the case genuinely disagree, which is what a v1 unscoped record could settle. */
function disagreeingSubjectCount(benchmarkCase: BenchmarkCase): number {
  const grouped = new Map<string, Set<string>>();
  for (const label of benchmarkCase.reviewerLabels) {
    const key = `${label.dimension}/${label.subjectId}`;
    const bucket = grouped.get(key) ?? new Set<string>();
    bucket.add(label.label);
    grouped.set(key, bucket);
  }
  return [...grouped.values()].filter((labels) => labels.size > 1).length;
}

/**
 * Report agreement per subject without ever resolving it. A subject needs at least two distinct canonical
 * reviewers before a shared label is called agreement; a lone label is `SINGLE_REVIEWER`, not consensus. A
 * split is `UNRESOLVED` unless the shared resolver finds a decision that still binds it, in which case it is
 * `ADJUDICATED` and `binding` says whether that binding matches the current disagreement or is a legacy
 * record that predates bindings.
 *
 * A `STALE` binding leaves the subject `UNRESOLVED`, and its adjudicated label is never echoed: a decision
 * about a different split must not supply this one's answer. Reviewer names stay operator-asserted.
 */
export function disagreementReport(benchmarkCase: BenchmarkCase): DisagreementReport {
  const packet = buildReviewerPacket(benchmarkCase);
  const disagreementCount = disagreeingSubjectCount(benchmarkCase);
  let unanimous = 0;
  let adjudicated = 0;
  let unresolved = 0;
  let stale = 0;
  let unbound = 0;
  const subjects: SubjectAgreement[] = packet.subjects.map((subject) => {
    const matching = benchmarkCase.reviewerLabels.filter(
      (label) => label.dimension === subject.dimension && label.subjectId === subject.subjectId,
    );
    const reviewers = [...new Set(matching.map((label) => reviewerIdentity(label.reviewer)))].sort(
      compareStrings,
    );
    const distinctLabels = [...new Set(matching.map((label) => label.label))].sort(compareStrings);
    const settling = resolveSettlingAdjudication(
      benchmarkCase,
      packet.packetHash,
      subject.dimension,
      subject.subjectId,
      disagreementCount,
    );
    const binding = settling.binding;
    if (binding === 'STALE') {
      stale += 1;
    }
    let status: SubjectAgreementStatus;
    if (matching.length === 0) {
      status = 'UNANNOTATED';
    } else if (reviewers.length < 2) {
      status = 'SINGLE_REVIEWER';
    } else if (distinctLabels.length === 1) {
      status = 'UNANIMOUS';
    } else if (binding === 'MATCHING' || binding === 'UNBOUND') {
      status = 'ADJUDICATED';
    } else {
      status = 'UNRESOLVED';
    }
    if (status === 'UNANIMOUS') {
      unanimous += 1;
    }
    if (status === 'ADJUDICATED') {
      adjudicated += 1;
    }
    if (binding === 'UNBOUND') {
      unbound += 1;
    }
    if (status === 'UNRESOLVED') {
      unresolved += 1;
    }
    return {
      dimension: subject.dimension,
      subjectId: subject.subjectId,
      reviewers,
      labels: matching.map((label) => label.label),
      status,
      adjudicatedLabel:
        status === 'ADJUDICATED' && settling.adjudication?.outcome === 'RESOLVED'
          ? (settling.adjudication.label ?? null)
          : null,
      binding,
    };
  });
  return { caseId: benchmarkCase.id, subjects, unanimous, adjudicated, unresolved, stale, unbound };
}

export const ADJUDICATION_TEMPLATE_VERSION = BENCHMARK_ADJUDICATION_VERSION;
export const ADJUDICATION_TEMPLATE_VERSION_V2 = BENCHMARK_ADJUDICATION_VERSION_V2;

export interface AdjudicationTemplateEntry {
  readonly dimension: BenchmarkDimension;
  readonly subjectId: string;
  /** The exact disagreement this entry would settle, so a later application can be checked against it. */
  readonly disagreementHash: string;
  readonly outcome: '';
  readonly label: '';
  readonly reason: '';
  readonly adjudicatedBy: '';
  readonly adjudicatedAt: '';
}

export interface AdjudicationTemplate {
  readonly version: string;
  readonly caseId: string;
  readonly templateHash: string;
  readonly adjudications: readonly AdjudicationTemplateEntry[];
}

/** The binding hash a template entry carries, computed from the case exactly as it stands now. */
export function adjudicationBindingHash(
  benchmarkCase: BenchmarkCase,
  dimension: BenchmarkDimension,
  subjectId: string,
): string {
  return disagreementStateHash({
    packetHash: buildReviewerPacket(benchmarkCase).packetHash,
    dimension,
    subjectId,
    entries: subjectLabelEntries(benchmarkCase, dimension, subjectId),
  });
}

/**
 * A fill-in skeleton for the subjects still in unresolved disagreement — one bound entry each. The outcome,
 * label, reason, adjudicator and moment are left empty on purpose: resolving a disagreement is a human act,
 * and the tool never pre-selects a side.
 *
 * Subjects whose recorded decision has gone stale appear here again, because they genuinely are unsettled.
 */
export function adjudicationTemplate(benchmarkCase: BenchmarkCase): AdjudicationTemplate {
  const report = disagreementReport(benchmarkCase);
  const entries = report.subjects
    .filter((subject) => subject.status === 'UNRESOLVED')
    .map((subject) => ({
      dimension: subject.dimension,
      subjectId: subject.subjectId,
      disagreementHash: adjudicationBindingHash(
        benchmarkCase,
        subject.dimension,
        subject.subjectId,
      ),
      outcome: '' as const,
      label: '' as const,
      reason: '' as const,
      adjudicatedBy: '' as const,
      adjudicatedAt: '' as const,
    }));
  const content = {
    version: ADJUDICATION_TEMPLATE_VERSION_V2,
    caseId: benchmarkCase.id,
    adjudications: entries,
  };
  return { ...content, templateHash: contentHash(content) };
}

export type AdjudicationResult =
  | { readonly ok: true; readonly case: BenchmarkCase }
  | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * A human's proposed adjudication for one subject, before it is accepted onto the case. The label is
 * `null` for a genuinely-ambiguous outcome and a real value only for a RESOLVED one.
 *
 * `disagreementHash` and `adjudicatedAt` are part of the contract from v0.7: a decision must name the split
 * it settles and the moment a human filed it. Both are supplied by the person or copied from the template —
 * the tool infers neither.
 */
export interface PendingAdjudication {
  readonly caseId: string;
  readonly dimension: BenchmarkDimension;
  readonly subjectId: string;
  readonly outcome: string;
  readonly label: string | null;
  readonly reason: string;
  readonly adjudicatedBy: string;
  readonly disagreementHash: string;
  readonly adjudicatedAt: string;
}

/**
 * Read a field a caller may not have validated as text.
 *
 * `scripts/benchmark-case.ts` already refuses a malformed adjudication file before this function runs. This
 * is the second layer: `applyAdjudication` is a public pure API, and a caller that hands it parsed JSON
 * directly must get a refusal rather than a `TypeError` from `.trim()` on undefined.
 */
function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Apply a scoped, state-bound adjudication to a case — but only where it is genuinely warranted, so an
 * adjudication can never manufacture a consensus or settle a split it was not written against.
 *
 * It refuses, leaving the case untouched, unless: the named subject is a real, current `UNRESOLVED`
 * disagreement; the submission carries the binding hash of that exact disagreement; and that hash still
 * matches the state as it now stands. The third condition is what closes defect 4 — a decision written
 * against Monday's split cannot be applied to Tuesday's different one, because the state it named is gone.
 *
 * A `RESOLVED` outcome must carry a label drawn from that dimension's vocabulary; a `GENUINELY_AMBIGUOUS`
 * outcome must carry **no** label, because recording a decision that decides nothing is how an unresolved
 * case would quietly become gold. The reason, adjudicator and a human-supplied instant are all required.
 *
 * On success it appends one bound `BenchmarkAdjudication` and never deletes an earlier one: a decision that
 * went stale stays in the record, because erasing it would hide that the disagreement moved.
 */
export function applyAdjudication(
  benchmarkCase: BenchmarkCase,
  adjudication: PendingAdjudication,
): AdjudicationResult {
  const reasons: string[] = [];
  if (adjudication.caseId !== benchmarkCase.id) {
    reasons.push(
      `Adjudication is for case "${adjudication.caseId}", which does not match this case "${benchmarkCase.id}".`,
    );
  }
  const submittedHash = textOf(adjudication.disagreementHash);
  const report = disagreementReport(benchmarkCase);
  const subject = report.subjects.find(
    (entry) =>
      entry.dimension === adjudication.dimension && entry.subjectId === adjudication.subjectId,
  );
  if (subject === undefined) {
    reasons.push(
      `Adjudication targets "${adjudication.dimension}/${adjudication.subjectId}", which is not a subject of this case.`,
    );
  } else if (subject.status !== 'UNRESOLVED') {
    reasons.push(
      `Adjudication refuses to act on "${subject.dimension}/${subject.subjectId}": it is ${subject.status}, not an unresolved disagreement. There is nothing to settle, so adjudicating here would manufacture a decision.`,
    );
  }

  // The binding: a decision must name the disagreement it was written against, and that disagreement must
  // still be the one on the case.
  const currentHash = adjudicationBindingHash(
    benchmarkCase,
    adjudication.dimension,
    adjudication.subjectId,
  );
  if (!isContentHash(submittedHash)) {
    reasons.push(
      'An adjudication must carry the disagreement hash issued with its template. Without a binding there is no way to tell which split it settles, so it is refused rather than trusted.',
    );
  } else if (submittedHash !== currentHash) {
    reasons.push(
      `Adjudication is stale: "${adjudication.dimension}/${adjudication.subjectId}" is no longer the disagreement this decision was written against. Issue a fresh template and adjudicate the current state, so the record shows which split was actually settled.`,
    );
  }

  const outcome = adjudication.outcome;
  if (outcome !== 'RESOLVED' && outcome !== 'GENUINELY_AMBIGUOUS') {
    reasons.push(`Adjudication outcome "${outcome}" must be RESOLVED or GENUINELY_AMBIGUOUS.`);
  }
  if (outcome === 'RESOLVED') {
    const settledLabel = textOf(adjudication.label);
    if (settledLabel === '') {
      reasons.push('A RESOLVED adjudication must name the label it settled.');
    } else if (!benchmarkDimensionLabels(adjudication.dimension).includes(settledLabel)) {
      reasons.push(
        `Adjudicated label "${settledLabel}" is not valid for ${adjudication.dimension}.`,
      );
    }
  }
  if (outcome === 'GENUINELY_AMBIGUOUS') {
    if (textOf(adjudication.label) !== '') {
      reasons.push(
        'A GENUINELY_AMBIGUOUS outcome may not carry a label; recording one would score an unresolved subject as ordinary gold.',
      );
    }
  }
  if (textOf(adjudication.reason) === '') {
    reasons.push(
      'An adjudication must state the reason a human settled (or declined to settle) it.',
    );
  }
  const adjudicator = reviewerIdentity(textOf(adjudication.adjudicatedBy));
  if (adjudicator === '') {
    reasons.push(
      'An adjudication must name its adjudicator; the tool will not invent one. The name is operator-asserted.',
    );
  } else if (!isDeclaredReviewer(benchmarkCase, adjudicator)) {
    reasons.push(
      `Adjudicator "${textOf(adjudication.adjudicatedBy)}" is not in the declared roster (provenance.reviewedBy). Settling a disagreement is an act the case has to authorise, and a merge or adjudication never widens the roster itself.`,
    );
  }
  const filedAt = textOf(adjudication.adjudicatedAt);
  let adjudicatedAt = '';
  if (filedAt === '') {
    reasons.push(
      'An adjudication must carry the moment a human filed it; the tool has no clock and will not supply one.',
    );
  } else {
    const checked = isoDateTime(filedAt, 'adjudication.adjudicatedAt');
    if (checked.ok) {
      adjudicatedAt = checked.value;
    } else {
      reasons.push(
        checked.issues[0]?.message ?? 'The adjudication timestamp is not a valid instant.',
      );
    }
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }
  const entry: BenchmarkAdjudication = {
    dimension: adjudication.dimension,
    subjectId: adjudication.subjectId,
    outcome: outcome as BenchmarkAdjudication['outcome'],
    label: outcome === 'RESOLVED' ? textOf(adjudication.label) : null,
    reason: adjudication.reason,
    adjudicatedBy: adjudicator,
    disagreementHash: submittedHash,
    adjudicatedAt,
  };
  return {
    ok: true,
    case: {
      ...benchmarkCase,
      adjudications: [...(benchmarkCase.adjudications ?? []), entry],
    },
  };
}

export const AUDIT_VERSION = BENCHMARK_AUDIT_VERSION;

export interface CaseReadiness {
  readonly id: string;
  readonly stratum: string;
  readonly authorizedForStorage: boolean;
  readonly reviewedAt: string;
  readonly reviewerCount: number;
  readonly incompleteSubjects: number;
  readonly singleReviewerSubjects: number;
  readonly unanimousSubjects: number;
  readonly adjudicatedSubjects: number;
  readonly unresolvedSubjects: number;
}

export interface CorpusAudit {
  readonly version: string;
  readonly caseCount: number;
  readonly missingStrata: readonly string[];
  readonly cases: readonly CaseReadiness[];
  readonly summary: {
    readonly casesMissingAuthorisation: number;
    readonly casesBelowTwoReviewers: number;
    readonly incompleteSubjects: number;
    readonly unresolvedSubjects: number;
  };
  readonly accuracyClaimable: false;
  readonly accuracyReason: string;
}

/**
 * Report corpus readiness and provenance honestly. This is a *readiness* audit, not a score: it names
 * missing strata, cases without storage authorisation or a review date, subjects nobody or only one
 * reviewer has judged, and disagreements still unresolved — and it keeps `accuracyClaimable` false,
 * because none of that is a claim that the evaluator is accurate. A thin, honest corpus reads as
 * under-ready; the audit never pads a case to look complete.
 */
export function auditCorpus(cases: readonly BenchmarkCase[]): CorpusAudit {
  const present = new Set(cases.map((benchmarkCase) => benchmarkCase.stratum));
  const missingStrata = BENCHMARK_STRATA.filter((stratum) => !present.has(stratum));
  let casesMissingAuthorisation = 0;
  let casesBelowTwoReviewers = 0;
  let incompleteSubjectsTotal = 0;
  let unresolvedSubjectsTotal = 0;
  const caseReports: CaseReadiness[] = cases.map((benchmarkCase) => {
    const report = disagreementReport(benchmarkCase);
    const reviewerLabels = benchmarkCase.reviewerLabels;
    const reviewerCount = new Set(reviewerLabels.map((label) => label.reviewer)).size;
    const statusCount = (status: SubjectAgreementStatus): number =>
      report.subjects.filter((subject) => subject.status === status).length;
    const incomplete = statusCount('UNANNOTATED');
    const authorized = benchmarkCase.provenance.authorizedForStorage === true;
    if (!authorized) {
      casesMissingAuthorisation += 1;
    }
    if (reviewerCount < 2) {
      casesBelowTwoReviewers += 1;
    }
    incompleteSubjectsTotal += incomplete;
    unresolvedSubjectsTotal += statusCount('UNRESOLVED');
    return {
      id: benchmarkCase.id,
      stratum: benchmarkCase.stratum,
      authorizedForStorage: authorized,
      reviewedAt: benchmarkCase.provenance.reviewedAt,
      reviewerCount,
      incompleteSubjects: incomplete,
      singleReviewerSubjects: statusCount('SINGLE_REVIEWER'),
      unanimousSubjects: statusCount('UNANIMOUS'),
      adjudicatedSubjects: statusCount('ADJUDICATED'),
      unresolvedSubjects: statusCount('UNRESOLVED'),
    };
  });
  return {
    version: AUDIT_VERSION,
    caseCount: cases.length,
    missingStrata,
    cases: caseReports,
    summary: {
      casesMissingAuthorisation,
      casesBelowTwoReviewers,
      incompleteSubjects: incompleteSubjectsTotal,
      unresolvedSubjects: unresolvedSubjectsTotal,
    },
    accuracyClaimable: false,
    accuracyReason:
      'Readiness is not accuracy. This audit counts coverage, authorisation and agreement state from ' +
      'operator-asserted reviewer labels; it does not and cannot establish that the evaluator is ' +
      'accurate, which would require a genuinely reviewed corpus and measures this build does not have.',
  };
}
