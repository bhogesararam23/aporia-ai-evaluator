/**
 * Benchmark case contracts.
 *
 * `benchmark-case-v1` (ADR-020) used one identifier per evidence record, which the scorer copied into
 * both the relationship id and the source id. Two excerpts from one press release therefore looked
 * like two independent sources, so the `DUPLICATE_OR_SYNDICATED_SOURCES` stratum could be listed as
 * required and still be untestable. v2 separates the two identities and scopes adjudication to the
 * subject it resolves.
 *
 * v1 is still accepted, because a corpus file is a record someone wrote; a v1 case is read with its
 * evidence ids standing in for source ids, and the report says the corpus is on the older contract.
 *
 * A benchmark case is a frozen input pack plus the gold labels a human reviewer assigned to it, and
 * optionally the labels individual reviewers assigned before adjudication. Nothing in this module
 * reaches the network or the database: scoring is pure, so a case stays reproducible after the
 * project that inspired it changes or is deleted.
 */

export const BENCHMARK_CASE_VERSION = 'benchmark-case-v2';
/** Accepted for reading. A v1 case cannot express a shared source, which the report states. */
export const BENCHMARK_CASE_VERSION_V1 = 'benchmark-case-v1';
export const KNOWN_BENCHMARK_CASE_VERSIONS = [
  BENCHMARK_CASE_VERSION_V1,
  BENCHMARK_CASE_VERSION,
] as const;

/**
 * Review-workflow artifact versions (ADR-026).
 *
 * These are the versions of the *offline human-review files* the `benchmark:case` review workflow
 * produces: a blinded reviewer packet, a reviewer's separate annotation submission, a scoped
 * adjudication template, and a corpus-readiness audit. They are deliberately distinct from the
 * benchmark **case** contract above: introducing them never changes how a `benchmark-case-v1`/`v2`
 * file is read, so no corpus migration is implied and existing benchmark reports stay compatible.
 * Each artifact carries its own version so a stale or mismatched file is refused rather than silently
 * accepted — a submission bound to a packet whose input has since changed fails its hash check.
 */
export const BENCHMARK_PACKET_VERSION = 'benchmark-packet-v1';
export const BENCHMARK_SUBMISSION_VERSION = 'benchmark-submission-v1';
/**
 * v0.7. Same fields as v1, with a stricter `submittedAt`: a v2 timestamp must be an ISO-8601 date-time
 * carrying a timezone offset, because a string that is not a instant cannot anchor a review in time.
 * v1 stays accepted and its recorded value is persisted verbatim, so no submission file written before
 * v0.7 becomes unreadable.
 */
export const BENCHMARK_SUBMISSION_VERSION_V2 = 'benchmark-submission-v2';
export const BENCHMARK_ADJUDICATION_VERSION = 'benchmark-adjudication-v1';
/**
 * v0.7. Adds `disagreementHash`, the binding that says exactly which reviewer split a decision settles,
 * and a human-supplied `adjudicatedAt`. A v1 entry names no split, so it is read as *unbound*: still
 * honoured, never presented as verified provenance.
 */
export const BENCHMARK_ADJUDICATION_VERSION_V2 = 'benchmark-adjudication-v2';
export const BENCHMARK_AUDIT_VERSION = 'benchmark-audit-v1';
/**
 * v0.7 corpus release artifacts. A release manifest is a *description* of a corpus, never a case, and it
 * carries no clock, path or machine identity, so the same corpus always produces the same bytes.
 */
export const BENCHMARK_RELEASE_MANIFEST_VERSION = 'benchmark-release-manifest-v1';
/** The journal a staged batch leaves behind, which is the only record of an interrupted write. */
export const BENCHMARK_BATCH_JOURNAL_VERSION = 'benchmark-batch-journal-v1';
export const KNOWN_BENCHMARK_REVIEW_ARTIFACT_VERSIONS = [
  BENCHMARK_PACKET_VERSION,
  BENCHMARK_SUBMISSION_VERSION,
  BENCHMARK_SUBMISSION_VERSION_V2,
  BENCHMARK_ADJUDICATION_VERSION,
  BENCHMARK_ADJUDICATION_VERSION_V2,
  BENCHMARK_AUDIT_VERSION,
  BENCHMARK_RELEASE_MANIFEST_VERSION,
  BENCHMARK_BATCH_JOURNAL_VERSION,
] as const;

/** The four scored dimensions. There is no overall benchmark score (ADR-003). */
export const BENCHMARK_DIMENSIONS = [
  'EVIDENCE_SUPPORT',
  'ANSWER_FIDELITY',
  'CITATION_SUPPORT',
  'ATTRIBUTION',
] as const;
export type BenchmarkDimension = (typeof BENCHMARK_DIMENSIONS)[number];

export const BENCHMARK_DIMENSION_LABELS: Record<BenchmarkDimension, string> = {
  EVIDENCE_SUPPORT: 'Evidence support for the target proposition',
  ANSWER_FIDELITY: 'Fidelity of a captured answer statement',
  CITATION_SUPPORT: 'Whether cited material supports the statement',
  ATTRIBUTION: 'Correctness of the attribution in the statement',
};

/**
 * Strata the corpus must cover. These are chosen because they are the cases where an evaluator most
 * easily lies to itself: a refusal read as a denial, missing evidence read as contradiction, a
 * citation present but non-supporting, and shared credit reported as sole authorship.
 */
export const BENCHMARK_STRATA = [
  'SUPPORTED_PRIMARY_EVIDENCE',
  'PARTIALLY_SUPPORTED_WITH_CONDITIONS',
  'CONTRADICTED_BY_CREDIBLE_EVIDENCE',
  'CONFLICTING_EVIDENCE',
  'INSUFFICIENT_EVIDENCE',
  'VERSION_OR_DATE_SENSITIVE',
  'IDENTITY_OR_ATTRIBUTION_AMBIGUITY',
  'COLLABORATIVE_MULTIPLE_ROLES',
  'DUPLICATE_OR_SYNDICATED_SOURCES',
  'INACCESSIBLE_OR_UNAVAILABLE',
  'REFUSAL_NOT_A_DENIAL',
  'CITATION_DOES_NOT_SUPPORT',
  'CITATION_SUPPORTS_WITH_CONDITIONS',
  'FALSE_SOLE_CREDIT',
  'MIXED_TRUE_AND_FALSE_SUBCLAIMS',
  'MULTILINGUAL_OR_REGIONAL',
] as const;
export type BenchmarkStratum = (typeof BENCHMARK_STRATA)[number];

export const BENCHMARK_STRATUM_LABELS: Record<BenchmarkStratum, string> = {
  SUPPORTED_PRIMARY_EVIDENCE: 'Strongly supported by primary evidence',
  PARTIALLY_SUPPORTED_WITH_CONDITIONS: 'Partially supported with important conditions',
  CONTRADICTED_BY_CREDIBLE_EVIDENCE: 'Contradicted by credible evidence',
  CONFLICTING_EVIDENCE: 'Conflicting evidence',
  INSUFFICIENT_EVIDENCE: 'Insufficient evidence after a bounded search',
  VERSION_OR_DATE_SENSITIVE: 'Version or date sensitive',
  IDENTITY_OR_ATTRIBUTION_AMBIGUITY: 'Identity or attribution ambiguity',
  COLLABORATIVE_MULTIPLE_ROLES: 'Collaborative work with multiple contribution roles',
  DUPLICATE_OR_SYNDICATED_SOURCES: 'Duplicate or syndicated sources',
  INACCESSIBLE_OR_UNAVAILABLE: 'Inaccessible page, block, or missing citation metadata',
  REFUSAL_NOT_A_DENIAL: 'Safety or capability refusal that is not a factual denial',
  CITATION_DOES_NOT_SUPPORT: 'Citation present that does not support the statement',
  CITATION_SUPPORTS_WITH_CONDITIONS: 'Citation supports only under a stated condition',
  FALSE_SOLE_CREDIT: 'Shared or others’ work credited as sole authorship',
  MIXED_TRUE_AND_FALSE_SUBCLAIMS: 'One answer mixing true and false subclaims',
  MULTILINGUAL_OR_REGIONAL: 'Multilingual or regional variation',
};

/** How a case's material was obtained and reviewed. A case without this is not scoreable. */
export interface BenchmarkProvenance {
  readonly origin: string;
  readonly authorizedForStorage: boolean;
  readonly reviewedBy: readonly string[];
  readonly reviewedAt: string;
  readonly unverified: readonly string[];
  readonly limitation: string;
}

/**
 * One recorded relationship between a proposition and a piece of material.
 *
 * `id` identifies the relationship; `sourceId` identifies the underlying source. They are separate
 * because two excerpts from one press release are two relationships and one source, and the
 * anti-corroboration rule in `deriveEvidenceStatus` counts sources. A v1 case has no `sourceId`, and
 * the loader substitutes the evidence id — which is precisely the behaviour v2 exists to remove.
 */
export interface BenchmarkEvidenceRecord {
  readonly id: string;
  /** A reviewer-recorded relationship, not a verified property of the source. */
  readonly relation: string;
  /** Identity of the underlying source, so duplicate and syndicated material collapses. Absent on a v1 case, where the relationship id stands in — which is reported, not repaired silently. */
  readonly sourceId?: string;
  /**
   * The canonical URI of the underlying source, when the reviewer recorded one (ADR-025 §1 rule 1).
   *
   * Optional and additive, so an older v1/v2 file still reads: it is simply absent. `evidence-aggregation-v2`
   * uses it to recognise two records that are the same document reached differently, and counts them once.
   */
  readonly canonicalUri?: string | null;
  readonly sourceType: string;
  readonly independence: string;
  readonly locator: string;
}

export interface BenchmarkProposition {
  readonly id: string;
  readonly text: string;
  readonly evidence: readonly BenchmarkEvidenceRecord[];
}

/**
 * One citation the reviewer read in the captured answer.
 *
 * `supportsStatement` is a judgement about the material. `voided` is the reviewer withdrawing the
 * cited record afterwards — a different fact, and the one that decides whether a mapping still
 * counts as support under `metrics-v4`.
 */
export interface BenchmarkCitation {
  readonly id: string;
  readonly url: string;
  readonly supportsStatement: boolean;
  /** v2. Whether the reviewer withdrew this cited record. */
  readonly voided?: boolean;
  readonly note: string | null;
}

export interface BenchmarkStatement {
  readonly id: string;
  readonly text: string;
  readonly relevance: string;
  readonly propositionIds: readonly string[];
  readonly citationIds: readonly string[];
}

/** The frozen input pack. The scorer runs the current implementation over exactly these fields. */
export interface BenchmarkInputPack {
  readonly claimText: string;
  readonly propositions: readonly BenchmarkProposition[];
  readonly answerText: string | null;
  readonly citationCapture: string;
  readonly citations: readonly BenchmarkCitation[];
  readonly statements: readonly BenchmarkStatement[];
  readonly providerLabel: string;
  readonly locale: string;
}

/** One gold label for one dimension, with the rationale the rubric requires. */
export interface BenchmarkGoldLabel {
  readonly dimension: BenchmarkDimension;
  readonly label: string;
  readonly rationale: string;
  /** Which statement or proposition in the input pack the label judges. */
  readonly subjectId: string;
}

/**
 * Whether a stored adjudication still binds the disagreement it was written against.
 *
 * `MATCHING` settles it. `STALE` does not: the reviewers moved after the decision was filed. `UNBOUND` is a
 * v0.6 record that never named a split — honoured for compatibility, and reported as predating binding so no
 * release can present it as verified provenance. Declared here rather than in `provenance.ts` because the
 * case contract and the scorer both depend on it, and the contracts module must not import a behaviour module.
 */
export type AdjudicationBinding = 'MATCHING' | 'STALE' | 'UNBOUND';

/**
 * How one reviewer resolved one subject on one dimension.
 *
 * `label` is the value the reviewer recorded; the vocabulary it must come from is the one belonging
 * to `dimension`, which the validator checks. `reviewer` is an operator-asserted name: the
 * application has no authentication, so this records who the operator says reviewed it and proves
 * nothing about who did.
 *
 * The four v0.7 fields are the review provenance that v0.6 checked and then discarded. They are optional
 * and additive on purpose: a case written before v0.7 has none of them, and that means *not recorded*,
 * never *recorded as empty* or *verified*. Nothing here authenticates a reviewer — `submittedAt` is
 * supplied by the human, and `packetHash` binds the judgement to the input the packet froze.
 */
export interface BenchmarkReviewerLabel {
  readonly reviewer: string;
  readonly dimension: BenchmarkDimension;
  readonly label: string;
  readonly subjectId: string;
  readonly note: string | null;
  /** The reviewer's own rubric rationale, preserved verbatim rather than dropped on merge. */
  readonly rationale?: string | null;
  /** The submission timestamp the reviewer supplied, recorded as supplied or normalised to UTC. */
  readonly submittedAt?: string | null;
  /** The hash of the blinded packet the reviewer was shown, so the judgement is tied to one frozen input. */
  readonly packetHash?: string | null;
  /** The hash of the submission record this label arrived in. */
  readonly submissionHash?: string | null;
}

/**
 * An adjudication of one disagreement, scoped to the subject it settles.
 *
 * v1 carried a single unscoped `adjudication` per case, which let one `RESOLVED` record mask every
 * disagreeing subject in that case, across unrelated dimensions. v2 requires the scope, and requires
 * the settled label when the outcome is `RESOLVED`: an adjudication that decides nothing cannot
 * become a gold label.
 *
 * v0.7 adds `disagreementHash`, the exact reviewer-disagreement state the decision was written against,
 * and `adjudicatedAt`, the human-supplied moment it was filed. A record without a hash is *unbound*: it
 * still settles as it did in v0.6, and every report says it predates binding rather than crediting it as
 * verified provenance.
 */
export interface BenchmarkAdjudication {
  readonly dimension: BenchmarkDimension;
  readonly subjectId: string;
  readonly outcome: 'RESOLVED' | 'GENUINELY_AMBIGUOUS';
  /** The label the adjudicator settled on. Required when `outcome` is `RESOLVED`. */
  readonly label: string | null;
  readonly reason: string;
  readonly adjudicatedBy: string;
  /** SHA-256 over the frozen input, the subject, and the reviewer labels that split. Absent on a v0.6 record. */
  readonly disagreementHash?: string | null;
  /** Supplied by the human adjudicating; never taken from a clock. */
  readonly adjudicatedAt?: string | null;
}

/**
 * A v1 case's unscoped adjudication, kept so an older file still reads.
 *
 * It is applied only when the case has exactly one disagreeing subject; otherwise the disagreement
 * stays unresolved, because a decision that names nothing cannot be attributed to a subject.
 */
export interface BenchmarkLegacyAdjudication {
  readonly outcome: 'RESOLVED' | 'GENUINELY_AMBIGUOUS';
  readonly reason: string;
  readonly adjudicatedBy: string;
}

/**
 * Annotation agreement for one dimension.
 *
 * A human-versus-human and human-versus-gold figure. It says nothing about software behaviour and is
 * not evaluator accuracy: reviewer identity in a case file is operator-asserted, and the harness cannot
 * verify that two names are two independent reviewers.
 */
export interface AnnotationSummary {
  readonly dimension: BenchmarkDimension;
  readonly subjects: number;
  readonly scorable: number;
  readonly agreeingWithGold: number;
  readonly agreementRate: number | null;
  readonly excludedUnresolved: number;
  readonly excludedAmbiguous: number;
  readonly excludedSingleReviewer: number;
  readonly excludedNoGoldLabel: number;
  readonly excludedAdjudicatedWithoutLabel: number;
  /** Subjects left unresolved because the decision binding them has gone stale (additive in v0.7). */
  readonly excludedStaleAdjudication: number;
  /** Subjects settled only by a legacy record that carries no binding (additive in v0.7). */
  readonly excludedUnboundAdjudication: number;
  readonly note: string;
}

export interface BenchmarkCase {
  readonly version: string;
  readonly id: string;
  readonly stratum: BenchmarkStratum;
  readonly title: string;
  readonly provenance: BenchmarkProvenance;
  readonly input: BenchmarkInputPack;
  readonly expected: readonly BenchmarkGoldLabel[];
  readonly reviewerLabels: readonly BenchmarkReviewerLabel[];
  /** v2. Each entry names the dimension and subject it settles. */
  readonly adjudications?: readonly BenchmarkAdjudication[];
  /** v1 only, and only read when it can be attached to exactly one disagreement. */
  readonly adjudication?: BenchmarkLegacyAdjudication | null;
  readonly limitations: readonly string[];
}

/** One label a reviewer recorded for one subject, in their own separate submission. */
export interface SubmissionAnnotation {
  readonly dimension: BenchmarkDimension;
  readonly subjectId: string;
  readonly label: string;
  readonly rationale: string;
}

/**
 * A reviewer's separate submission, bound to a packet by its hash.
 *
 * This lives with the other contracts because both the review workflow and the batch planner read it, and
 * a shared contract must not create an import cycle between them. `reviewer` and `submittedAt` are supplied
 * by the human: the tool has no authentication and no clock, so it refuses a blank one rather than filling
 * it in.
 */
export interface AnnotationSubmission {
  readonly version: string;
  readonly caseId: string;
  readonly packetHash: string;
  readonly reviewer: string;
  readonly submittedAt: string;
  readonly annotations: readonly SubmissionAnnotation[];
}

export interface BenchmarkCaseIssue {
  readonly caseId: string;
  readonly field: string;
  readonly message: string;
}

export interface BenchmarkCorpusValidation {
  readonly cases: readonly BenchmarkCase[];
  readonly issues: readonly BenchmarkCaseIssue[];
  readonly strataPresent: readonly BenchmarkStratum[];
  readonly strataMissing: readonly BenchmarkStratum[];
  readonly caseCount: number;
}

export interface LabelScoreRow {
  readonly label: string;
  readonly support: number;
  readonly predicted: number;
  readonly truePositive: number;
  readonly precision: number | null;
  readonly recall: number | null;
  readonly f1: number | null;
}

export interface ConfusionCell {
  readonly actual: string;
  readonly predicted: string;
  readonly count: number;
}

export interface DimensionScore {
  readonly dimension: BenchmarkDimension;
  readonly scored: number;
  readonly correct: number;
  readonly accuracy: number | null;
  readonly labels: readonly LabelScoreRow[];
  readonly macroF1: number | null;
  readonly macroF1Reason: string | null;
  readonly confusion: readonly ConfusionCell[];
  readonly confusionSuppressedReason: string | null;
  readonly notes: readonly string[];
}

export interface RegressionResultRow {
  readonly caseId: string;
  readonly dimension: BenchmarkDimension;
  readonly subjectId: string;
  readonly expected: string;
  readonly produced: string;
  readonly matched: boolean;
  readonly component: string;
}

/**
 * One proposition scored under one evidence-aggregation rule version.
 *
 * The pipeline is deliberately version-aware: it runs `evidence-aggregation-v1` and
 * `evidence-aggregation-v2` over the same frozen evidence and records **both the verdict and the
 * corroboration count** for each, so a reader can see a rule change move the corroborating-source
 * figure even where the verdict label is unchanged. `statusMatched` compares the produced verdict to
 * the case's gold label; `corroborationCollapsed` is true where v2 counts fewer underlying sources
 * than v1. A v1/v2 disagreement is a methodology signal, not a code regression — v2 is only a
 * proposal (ADR-025) and the product default stays v1.
 */
export interface EvidenceRuleRow {
  readonly caseId: string;
  readonly propositionId: string;
  readonly ruleVersion: string;
  readonly expected: string | null;
  readonly produced: string;
  readonly statusMatched: boolean;
  readonly supportingSourceCount: number;
  readonly apparentCorroboratingSourceCount: number | null;
}

/**
 * One (dimension, subject) pair of reviewer labels, with how far they got.
 *
 * `reviewers` is the list of operator-asserted names that labelled this subject. Fewer than two
 * entries means the pair is a single reviewer's note, not agreement, and `status` says so rather
 * than leaving a reader to infer it from a count.
 */
export interface AgreementRow {
  readonly caseId: string;
  readonly dimension: BenchmarkDimension;
  readonly subjectId: string;
  readonly reviewers: readonly string[];
  readonly labels: readonly string[];
  readonly unanimous: boolean;
  readonly status:
    | 'NOT_ENOUGH_REVIEWERS'
    | 'UNANIMOUS'
    | 'RESOLVED_BY_ADJUDICATION'
    | 'GENUINELY_AMBIGUOUS'
    | 'UNRESOLVED';
  /** The label the adjudication settled on, when one resolved this subject. */
  readonly adjudicatedLabel: string | null;
  /** The case's gold label for the same subject, when one exists. */
  readonly goldLabel: string | null;
  /**
   * How the settling decision relates to the current disagreement (additive in v0.7).
   *
   * `status` deliberately keeps its existing values so a reader that switches on them does not break: a stale
   * decision shows as `UNRESOLVED` here and explains itself through this field.
   */
  readonly adjudicationBinding?: AdjudicationBinding | null;
}
