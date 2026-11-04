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
  declaredRoster,
  reviewerIdentity,
  reviewerLabelFromAnnotation,
  submissionHash,
  type LabelProvenance,
} from './provenance.ts';

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

export const ADJUDICATION_TEMPLATE_VERSION = BENCHMARK_ADJUDICATION_VERSION;

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

export type AdjudicationResult =
  | { readonly ok: true; readonly case: BenchmarkCase }
  | { readonly ok: false; readonly reasons: readonly string[] };

/**
 * A human's proposed adjudication for one subject, before it is accepted onto the case. The label is
 * `null` for a genuinely-ambiguous outcome and a real value only for a RESOLVED one.
 */
export interface PendingAdjudication {
  readonly dimension: BenchmarkDimension;
  readonly subjectId: string;
  readonly outcome: string;
  readonly label: string | null;
  readonly reason: string;
  readonly adjudicatedBy: string;
}

/**
 * Apply a scoped adjudication to a case — but only where it is genuinely warranted, so an adjudication
 * can never manufacture a consensus.
 *
 * It refuses (leaving the case untouched) unless the named subject is a real, current `UNRESOLVED`
 * disagreement: something is only "adjudicated" if reviewers actually split, so this cannot settle a
 * subject nobody disputed, overwrite an existing adjudication, or decide for a unanimous or lone
 * reviewer. A `RESOLVED` outcome must carry a label drawn from that dimension's vocabulary; a
 * `GENUINELY_AMBIGUOUS` outcome must carry **no** label, because recording a decision that decides
 * nothing is how an unresolved case would quietly become gold. The reason and adjudicator must be
 * present (the adjudicator is operator-asserted, not authenticated). On success it appends one scoped
 * `BenchmarkAdjudication`; it never edits the gold `expected` array or a reviewer's label.
 */
export function applyAdjudication(
  benchmarkCase: BenchmarkCase,
  adjudication: PendingAdjudication,
): AdjudicationResult {
  const reasons: string[] = [];
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

  const outcome = adjudication.outcome;
  if (outcome !== 'RESOLVED' && outcome !== 'GENUINELY_AMBIGUOUS') {
    reasons.push(`Adjudication outcome "${outcome}" must be RESOLVED or GENUINELY_AMBIGUOUS.`);
  }
  if (outcome === 'RESOLVED') {
    if (adjudication.label === null || adjudication.label.trim() === '') {
      reasons.push('A RESOLVED adjudication must name the label it settled.');
    } else if (
      adjudication.label !== null &&
      !benchmarkDimensionLabels(adjudication.dimension).includes(adjudication.label)
    ) {
      reasons.push(
        `Adjudicated label "${adjudication.label}" is not valid for ${adjudication.dimension}.`,
      );
    }
  }
  if (outcome === 'GENUINELY_AMBIGUOUS') {
    if (adjudication.label !== null && adjudication.label.trim() !== '') {
      reasons.push(
        'A GENUINELY_AMBIGUOUS outcome may not carry a label; recording one would score an unresolved subject as ordinary gold.',
      );
    }
  }
  if (adjudication.reason.trim() === '') {
    reasons.push(
      'An adjudication must state the reason a human settled (or declined to settle) it.',
    );
  }
  if (adjudication.adjudicatedBy.trim() === '') {
    reasons.push(
      'An adjudication must name its adjudicator; the tool will not invent one. The name is operator-asserted.',
    );
  }

  if (reasons.length > 0) {
    return { ok: false, reasons };
  }
  const entry: BenchmarkAdjudication = {
    dimension: adjudication.dimension,
    subjectId: adjudication.subjectId,
    outcome: outcome as BenchmarkAdjudication['outcome'],
    label: outcome === 'RESOLVED' ? (adjudication.label as string) : null,
    reason: adjudication.reason,
    adjudicatedBy: adjudication.adjudicatedBy.trim(),
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
