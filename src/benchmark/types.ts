/**
 * The `benchmark-case-v1` contract (ADR-020).
 *
 * A benchmark case is a frozen input pack plus the gold labels a human reviewer assigned to it, and
 * optionally the labels individual reviewers assigned before adjudication. Nothing in this module
 * reaches the network or the database: scoring is pure, so a case stays reproducible after the
 * project that inspired it changes or is deleted.
 */

export const BENCHMARK_CASE_VERSION = 'benchmark-case-v1';

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

export interface BenchmarkEvidenceRecord {
  readonly id: string;
  /** A reviewer-recorded relationship, not a verified property of the source. */
  readonly relation: string;
  readonly sourceType: string;
  readonly independence: string;
  readonly locator: string;
}

export interface BenchmarkProposition {
  readonly id: string;
  readonly text: string;
  readonly evidence: readonly BenchmarkEvidenceRecord[];
}

export interface BenchmarkCitation {
  readonly id: string;
  readonly url: string;
  readonly supportsStatement: boolean;
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

/** A single reviewer's pre-adjudication label, retained so disagreement stays visible. */
export interface BenchmarkReviewerLabel {
  readonly reviewer: string;
  readonly dimension: BenchmarkDimension;
  readonly label: string;
  readonly subjectId: string;
  readonly note: string | null;
}

export interface BenchmarkAdjudication {
  readonly outcome: 'RESOLVED' | 'GENUINELY_AMBIGUOUS';
  readonly reason: string;
  readonly adjudicatedBy: string;
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
  readonly adjudication: BenchmarkAdjudication | null;
  readonly limitations: readonly string[];
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

export interface AgreementRow {
  readonly caseId: string;
  readonly dimension: BenchmarkDimension;
  readonly subjectId: string;
  readonly reviewers: readonly string[];
  readonly labels: readonly string[];
  readonly unanimous: boolean;
  readonly adjudication: 'RESOLVED' | 'GENUINELY_AMBIGUOUS' | 'UNRESOLVED' | 'NOT_APPLICABLE';
}
