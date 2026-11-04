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
import { createHash } from 'node:crypto';
import type {
  BenchmarkAdjudication,
  BenchmarkCase,
  BenchmarkDimension,
  BenchmarkInputPack,
  BenchmarkReviewerLabel,
} from './types.ts';
import { benchmarkDimensionLabels } from './validate.ts';

export const REVIEW_PACKET_VERSION = 'benchmark-packet-v1';
export const SUBMISSION_VERSION = 'benchmark-submission-v1';

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

/** One label a reviewer recorded for one subject. */
export interface SubmissionAnnotation {
  readonly dimension: BenchmarkDimension;
  readonly subjectId: string;
  readonly label: string;
  readonly rationale: string;
}

/** A reviewer's separate submission, bound to a packet by its hash. */
export interface AnnotationSubmission {
  readonly version: string;
  readonly caseId: string;
  readonly packetHash: string;
  readonly reviewer: string;
  readonly submittedAt: string;
  readonly annotations: readonly SubmissionAnnotation[];
}

/** Recursively sort object keys so a hash depends on content, not on serialisation order. */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, inner]) => [key, canonicalise(inner)]);
    return Object.fromEntries(entries);
  }
  return value;
}

/** A stable, key-order-independent content hash (SHA-256 hex) of any JSON value. */
export function contentHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalise(value)), 'utf8')
    .digest('hex');
}

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
 */
export function buildSubmissionTemplate(packet: ReviewerPacket): AnnotationSubmission {
  return {
    version: SUBMISSION_VERSION,
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
 * It refuses rather than repairs: a submission bound to a different (now-stale) input hash, aimed at
 * another case, from a reviewer who already submitted, containing a subject this case has no gold for,
 * an out-of-vocabulary label, a blank rationale, or a missing reviewer or timestamp is rejected in
 * full and the case is returned untouched. A successful merge never edits the gold `expected` array,
 * never removes an existing reviewer's label, and never invents a label, reviewer, or timestamp.
 */
export function mergeSubmission(
  benchmarkCase: BenchmarkCase,
  submission: AnnotationSubmission,
  alreadyMergedReviewers: readonly string[] = [],
): MergeResult {
  const reasons: string[] = [];
  if (submission.version !== SUBMISSION_VERSION) {
    reasons.push(`Unsupported submission version "${submission.version}".`);
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
  const reviewer = submission.reviewer.trim();
  if (reviewer === '') {
    reasons.push('A submission must carry a reviewer label; the tool will not invent one.');
  }
  if (submission.submittedAt.trim() === '') {
    reasons.push(
      'A submission must carry a reviewer-supplied timestamp; the tool will not invent one.',
    );
  }
  const priorReviewers = new Set([
    ...benchmarkCase.reviewerLabels.map((label) => label.reviewer),
    ...alreadyMergedReviewers.map((name) => name.trim()),
  ]);
  if (reviewer !== '' && priorReviewers.has(reviewer)) {
    reasons.push(`Duplicate submission: reviewer "${reviewer}" has already labelled this case.`);
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
      reasons.push(`Annotation ${String(index)} has no rationale.`);
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
  const appended: BenchmarkReviewerLabel[] = submission.annotations.map((annotation) => ({
    reviewer,
    dimension: annotation.dimension,
    label: annotation.label,
    subjectId: annotation.subjectId,
    note: null,
  }));
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
}

export interface DisagreementReport {
  readonly caseId: string;
  readonly subjects: readonly SubjectAgreement[];
  readonly unanimous: number;
  readonly adjudicated: number;
  readonly unresolved: number;
}

/**
 * Report agreement per subject without ever resolving it. A subject needs at least two distinct
 * reviewers before a shared label is called agreement; a lone label is `SINGLE_REVIEWER`, not
 * consensus. A split is `UNRESOLVED` unless a scoped adjudication names that exact dimension and
 * subject, in which case the adjudication's own label is echoed — never chosen here.
 */
export function disagreementReport(benchmarkCase: BenchmarkCase): DisagreementReport {
  const packet = buildReviewerPacket(benchmarkCase);
  const adjudicationBySubject = new Map<string, BenchmarkAdjudication>();
  for (const adjudication of benchmarkCase.adjudications ?? []) {
    adjudicationBySubject.set(`${adjudication.dimension}/${adjudication.subjectId}`, adjudication);
  }
  let unanimous = 0;
  let adjudicated = 0;
  let unresolved = 0;
  const subjects: SubjectAgreement[] = packet.subjects.map((subject) => {
    const matching = benchmarkCase.reviewerLabels.filter(
      (label) => label.dimension === subject.dimension && label.subjectId === subject.subjectId,
    );
    const reviewers = [...new Set(matching.map((label) => label.reviewer))].sort();
    const distinctLabels = [...new Set(matching.map((label) => label.label))].sort();
    const adjudication = adjudicationBySubject.get(`${subject.dimension}/${subject.subjectId}`);
    let status: SubjectAgreementStatus;
    if (matching.length === 0) {
      status = 'UNANNOTATED';
    } else if (reviewers.length < 2) {
      status = 'SINGLE_REVIEWER';
    } else if (distinctLabels.length === 1) {
      status = 'UNANIMOUS';
    } else if (adjudication !== undefined) {
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
        status === 'ADJUDICATED' && adjudication?.outcome === 'RESOLVED'
          ? (adjudication.label ?? null)
          : null,
    };
  });
  return { caseId: benchmarkCase.id, subjects, unanimous, adjudicated, unresolved };
}

export const ADJUDICATION_TEMPLATE_VERSION = 'benchmark-adjudication-v1';

export interface AdjudicationTemplateEntry {
  readonly dimension: BenchmarkDimension;
  readonly subjectId: string;
  readonly outcome: '';
  readonly label: '';
  readonly reason: '';
  readonly adjudicatedBy: '';
}

export interface AdjudicationTemplate {
  readonly version: string;
  readonly caseId: string;
  readonly adjudications: readonly AdjudicationTemplateEntry[];
}

/**
 * A fill-in skeleton for the subjects still in unresolved disagreement — one blank entry each. The
 * outcome, label, reason and adjudicator are left empty on purpose: resolving a disagreement is a
 * human act, and the tool never pre-selects a side.
 */
export function adjudicationTemplate(benchmarkCase: BenchmarkCase): AdjudicationTemplate {
  const report = disagreementReport(benchmarkCase);
  return {
    version: ADJUDICATION_TEMPLATE_VERSION,
    caseId: benchmarkCase.id,
    adjudications: report.subjects
      .filter((subject) => subject.status === 'UNRESOLVED')
      .map((subject) => ({
        dimension: subject.dimension,
        subjectId: subject.subjectId,
        outcome: '' as const,
        label: '' as const,
        reason: '' as const,
        adjudicatedBy: '' as const,
      })),
  };
}
