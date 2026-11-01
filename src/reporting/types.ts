import type {
  DerivedEvidenceStatus,
  EvidenceRelationshipRecord,
  PropositionConclusion,
} from '../core/evidence.ts';
import type { RunMetrics, MetricUnit } from '../core/metrics.ts';
import type {
  AnswerOffsetBasis,
  AnswerStatementKind,
  ClaimCitationSupportLabel,
  ClaimDimension,
  ClaimPropositionRelation,
  ClaimRelevance,
} from '../core/answerClaims.ts';
import type {
  AssessmentMethod,
  AttributionRole,
  ClaimStatus,
  EvidenceRelation,
  GroundingMode,
  ObservationStatus,
  PropositionStatus,
  QueryIntent,
  QuerySetStatus,
  RunStatus,
  SourceIndependence,
  SourceType,
} from '../core/vocabulary.ts';

export const REPORT_SCHEMA_VERSION = 'report-snapshot-v1';
/**
 * v3 adds the statement-level section (`metrics-v3`) and tracked remediation findings (ADR-021).
 * v1 and v2 snapshots are still rendered from their stored JSON and are never recomputed.
 */
export const REPORT_TEMPLATE_VERSION = 'report-template-v3';
export const KNOWN_REPORT_TEMPLATE_VERSIONS = [
  'report-template-v1',
  'report-template-v2',
  REPORT_TEMPLATE_VERSION,
] as const;

export interface ReportProjectInput {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly primaryDomain: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReportEntityInput {
  readonly id: string;
  readonly type: string;
  readonly canonicalName: string;
  readonly alternateNames: readonly string[];
  readonly publicUrls: readonly string[];
  readonly identityStatus: string;
  readonly identityMethod: string | null;
  readonly identityScope: string | null;
  readonly notes: string | null;
}

export interface ReportRelationshipInput {
  readonly id: string;
  readonly relation: EvidenceRelation;
  readonly rationale: string;
  readonly reviewer: string;
  readonly createdAt: string;
  readonly supersededBy: string | null;
  readonly supersededAt: string | null;
}

export interface ReportEvidenceInput {
  readonly id: string;
  readonly locator: string;
  readonly excerpt: string;
  readonly excerptDigest: string;
  readonly extractedAt: string;
}

export interface ReportSourceInput {
  readonly id: string;
  readonly title: string;
  readonly canonicalUri: string | null;
  readonly publisher: string | null;
  readonly author: string | null;
  readonly sourceType: SourceType;
  readonly independence: SourceIndependence;
  readonly retrievedAt: string;
  readonly publicationDate: string | null;
  readonly language: string;
  readonly notes: string | null;
}

export interface ReportEvidenceRowInput {
  readonly relationship: ReportRelationshipInput;
  readonly evidence: ReportEvidenceInput;
  readonly source: ReportSourceInput;
}

export interface ReportPropositionAssessmentInput {
  readonly id: string;
  readonly version: number;
  readonly label: PropositionStatus;
  readonly rationale: string;
  readonly method: AssessmentMethod;
  readonly reviewer: string;
  readonly evidenceSnapshot: readonly string[];
  readonly createdAt: string;
}

export interface ReportPropositionInput {
  readonly id: string;
  readonly ordinal: number;
  readonly text: string;
  readonly evidenceRequirements: string;
  readonly expectedAnswerCriterion: string | null;
  readonly ambiguityNotes: string | null;
  readonly evidence: readonly ReportEvidenceRowInput[];
  readonly assessments: readonly ReportPropositionAssessmentInput[];
}

export interface ReportClaimRevisionInput {
  readonly id: string;
  readonly revisionNumber: number;
  readonly text: string;
  readonly sourceUrl: string | null;
  readonly intendedMeaning: string | null;
  readonly timeScope: string | null;
  readonly locale: string;
  readonly decompositionVersion: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface ReportClaimInput {
  readonly claim: {
    readonly id: string;
    readonly status: ClaimStatus;
    readonly currentRevisionId: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly currentRevision: ReportClaimRevisionInput | null;
  readonly revisions: readonly ReportClaimRevisionInput[];
  readonly propositions: readonly ReportPropositionInput[];
}

export interface ReportQueryInput {
  readonly id: string;
  readonly ordinal: number;
  readonly text: string;
  readonly intent: QueryIntent;
  readonly locale: string | null;
  readonly region: string | null;
  readonly branded: boolean;
  readonly expectedElements: string;
  readonly inclusionRationale: string;
}

export interface ReportQuerySetInput {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly status: QuerySetStatus;
  readonly description: string | null;
  readonly locale: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly queries: readonly ReportQueryInput[];
}

export interface ReportCitationInput {
  readonly id: string;
  readonly position: number;
  readonly url: string;
  readonly title: string | null;
  readonly snippet: string | null;
  readonly targetOwned: boolean;
  readonly voidedAt: string | null;
  readonly voidReason: string | null;
}

export interface ReportObservationAssessmentInput {
  readonly id: string;
  readonly dimension: string;
  readonly version: number;
  readonly label: string;
  readonly rationale: string;
  readonly reviewer: string;
  readonly attributionRole: AttributionRole | null;
  readonly createdAt: string;
}

export interface ReportAnswerClaimPropositionInput {
  readonly propositionId: string;
  readonly relation: ClaimPropositionRelation | string;
}

/**
 * One recorded answer statement as the report sees it: the current revision only, with the active
 * links and the latest label per assessment dimension. Superseded revisions stay in the database
 * review history and deliberately do not enter a report, so correcting a statement cannot
 * double-count it.
 */
export interface ReportAnswerClaimInput {
  readonly id: string;
  readonly ordinal: number;
  readonly revisionId: string;
  readonly revision: number;
  readonly quoteText: string;
  readonly statementKind: AnswerStatementKind;
  readonly offsetBasis: AnswerOffsetBasis;
  readonly startOffset: number | null;
  readonly endOffset: number | null;
  readonly relevance: ClaimRelevance | string;
  readonly paraphrase: string | null;
  readonly propositionLinks: readonly ReportAnswerClaimPropositionInput[];
  readonly citationSupports: readonly ClaimCitationSupportLabel[];
  readonly labels: Readonly<Partial<Record<ClaimDimension, string>>>;
  readonly voidedAt: string | null;
}

export interface ReportObservationInput {
  readonly id: string;
  readonly queryId: string;
  readonly queryOrdinal: number;
  readonly queryTextSnapshot: string;
  readonly queryIntentSnapshot: QueryIntent;
  readonly status: ObservationStatus;
  readonly capturedAt: string;
  readonly answerText: string | null;
  readonly errorNote: string | null;
  readonly citationCapture: 'CAPTURED' | 'NOT_SHOWN' | 'UNKNOWN';
  readonly contextNotes: string | null;
  readonly voidedAt: string | null;
  readonly voidReason: string | null;
  readonly citations: readonly ReportCitationInput[];
  readonly assessments: readonly ReportObservationAssessmentInput[];
  /**
   * Added with `metrics-v3`. Absent in a `report-template-v1`/`v2` snapshot because the answers were
   * never decomposed; absence must be rendered as "not recorded", never as zero.
   */
  readonly answerClaims?: readonly ReportAnswerClaimInput[];
}

export interface ReportRunInput {
  readonly run: {
    readonly id: string;
    readonly querySetId: string;
    readonly name: string;
    readonly status: RunStatus;
    readonly providerLabel: string;
    readonly modelLabel: string | null;
    readonly interfaceLabel: string;
    readonly groundingMode: GroundingMode;
    readonly locale: string;
    readonly region: string | null;
    readonly captureFrom: string;
    readonly captureTo: string;
    readonly conditions: string;
    readonly notes: string | null;
    readonly createdBy: string;
    readonly createdAt: string;
    readonly finalizedAt: string | null;
    readonly cancelledAt: string | null;
    readonly cancelReason: string | null;
  };
  readonly observations: readonly ReportObservationInput[];
}

export interface ReportWebsiteFindingInput {
  readonly code: string;
  readonly severity: string;
  readonly category: string;
  readonly title: string;
  readonly observation: string;
  readonly rationale: string;
  readonly recommendation: string;
  readonly locator: string;
}

export interface ReportUnavailableCheckInput {
  readonly code: string;
  readonly label: string;
  readonly reason: string;
}

export interface ReportWebsiteAuditInput {
  readonly id: string;
  readonly label: string;
  readonly inputMethod: 'PASTED' | 'UPLOADED';
  readonly inputFilename: string | null;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly auditedAt: string;
  readonly methodologyVersion: string;
  readonly findings: readonly ReportWebsiteFindingInput[];
  readonly unavailableChecks: readonly ReportUnavailableCheckInput[];
  readonly metadata: Record<string, unknown>;
}

export interface ReportAuditInput {
  readonly eventCount: number;
  readonly lastEventAt: string | null;
}

/**
 * A tracked remediation finding, as it stood when the report was generated (ADR-021).
 *
 * The snapshot copies the finding's own text rather than the text of the records it points at,
 * because a pointer stores an identity and the record behind it may be revised later. A report has
 * to keep saying what was believed at the time it was written.
 *
 * Status, severity, cause and outcome stay plain strings here on purpose: a stored snapshot must
 * still render when the vocabulary has gained a value since it was written, rather than failing to
 * parse its own history.
 */
export interface ReportFindingUpdateInput {
  readonly sequence: number;
  readonly previousStatus: string | null;
  readonly newStatus: string | null;
  readonly note: string;
  readonly actor: string;
  readonly at: string;
  readonly comparisonIndex: number | null;
}

export interface ReportFindingComparisonInput {
  readonly baseRunId: string;
  readonly laterRunId: string;
  readonly comparable: boolean;
  readonly outcome: string;
  readonly reasons: readonly string[];
  readonly statementNote: string | null;
  readonly createdBy: string;
  readonly at: string;
}

export interface ReportFindingInput {
  readonly referenceNumber: number;
  readonly title: string;
  readonly observedIssue: string;
  readonly supportingEvidence: string;
  readonly cause: string;
  readonly severity: string;
  readonly severityRationale: string;
  readonly recommendedAction: string;
  readonly ownerLabel: string;
  readonly status: string;
  readonly statusRationale: string | null;
  readonly reportSuggestionKey: string | null;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly references: readonly { readonly type: string; readonly targetId: string }[];
  readonly updates: readonly ReportFindingUpdateInput[];
  readonly comparisons: readonly ReportFindingComparisonInput[];
}

export interface ReportFindingView extends ReportFindingInput {
  /** The project-scoped human reference, rendered rather than stored. */
  readonly reference: string;
}

export interface ReportBuildInput {
  readonly reportNumber: number;
  readonly title: string;
  readonly generatedAt: string;
  readonly project: ReportProjectInput;
  readonly targetEntity: ReportEntityInput | null;
  readonly entities: readonly ReportEntityInput[];
  readonly claims: readonly ReportClaimInput[];
  readonly querySets: readonly ReportQuerySetInput[];
  readonly runs: readonly ReportRunInput[];
  readonly websiteAudits: readonly ReportWebsiteAuditInput[];
  /**
   * Tracked findings at generation time. Absent in a `report-template-v1` or `v2` snapshot, which
   * had no findings section at all; the renderer must say "not carried by this template" rather than
   * "nothing is being tracked".
   */
  readonly findings?: readonly ReportFindingInput[];
  readonly audit: ReportAuditInput;
}

export interface ReportEvidenceView {
  readonly relationship: ReportRelationshipInput;
  readonly evidence: ReportEvidenceInput;
  readonly source: ReportSourceInput;
  readonly active: boolean;
}

export interface ReportHumanAssessmentView {
  readonly id: string;
  readonly version: number;
  readonly label: PropositionStatus;
  readonly rationale: string;
  readonly method: AssessmentMethod;
  readonly reviewer: string;
  readonly createdAt: string;
}

export interface ReportPropositionView {
  readonly id: string;
  readonly ordinal: number;
  readonly text: string;
  readonly evidenceRequirements: string;
  readonly expectedAnswerCriterion: string | null;
  readonly ambiguityNotes: string | null;
  readonly derivedStatus: DerivedEvidenceStatus;
  readonly humanAssessment: ReportHumanAssessmentView | null;
  readonly primaryConclusion: PropositionConclusion['primary'];
  readonly disagreement: boolean;
  readonly evidence: readonly ReportEvidenceView[];
  readonly assessmentHistory: readonly ReportPropositionAssessmentInput[];
}

export interface ReportClaimView {
  readonly id: string;
  readonly status: ClaimStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly currentRevision: ReportClaimRevisionInput | null;
  readonly revisions: readonly ReportClaimRevisionInput[];
  readonly propositions: readonly ReportPropositionView[];
}

export interface ReportQuerySetView extends ReportQuerySetInput {
  readonly runCount: number;
}

export interface ReportObservationView extends ReportObservationInput {
  readonly statusEligibility: 'ELIGIBLE' | 'EXCLUDED';
  /** Statements that carry at least one assessment, so a reader sees the real denominator. */
  readonly assessedClaimCount: number;
}

export interface ReportRunView {
  readonly id: string;
  readonly name: string;
  readonly status: RunStatus;
  readonly querySetId: string;
  readonly querySetName: string;
  readonly querySetVersion: number;
  readonly providerLabel: string;
  readonly modelLabel: string | null;
  readonly interfaceLabel: string;
  readonly groundingMode: GroundingMode;
  readonly locale: string;
  readonly region: string | null;
  readonly captureFrom: string;
  readonly captureTo: string;
  readonly conditions: string;
  readonly notes: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly finalizedAt: string | null;
  readonly observations: readonly ReportObservationView[];
  readonly metrics: RunMetrics;
}

export interface MetricDelta {
  readonly metricId: string;
  readonly label: string;
  readonly unit: MetricUnit;
  readonly current: number | null;
  readonly prior: number | null;
  readonly delta: number | null;
}

export interface RunComparison {
  readonly runId: string;
  readonly priorRunId: string | null;
  readonly comparable: boolean;
  readonly reasons: readonly string[];
  readonly metricDeltas: readonly MetricDelta[];
}

export interface RemediationSuggestion {
  readonly id: string;
  readonly priority: 'HIGH' | 'MEDIUM' | 'LOW';
  readonly action: string;
  readonly rationale: string;
  readonly relatedType: string;
  readonly relatedId: string;
}

export interface ReportCoverage {
  readonly claims: number;
  readonly propositions: number;
  readonly sources: number;
  readonly evidenceItems: number;
  readonly evidenceRelationships: number;
  readonly querySets: number;
  readonly finalizedRuns: number;
  readonly openRuns: number;
  readonly cancelledRuns: number;
  readonly observations: number;
  readonly websiteAudits: number;
  /** Added with `metrics-v3`. Zero in a v2 snapshot means none were recorded, not none exist. */
  readonly answerClaims: number;
  readonly assessedAnswerClaims: number;
  readonly decomposedObservations: number;
  readonly citationClaimMappings: number;
  readonly unassessedPropositions: number;
  readonly claimsWithoutPropositions: number;
  readonly runConfigurationsWithoutMetrics: number;
}

export interface ReportSnapshot {
  readonly schemaVersion: string;
  readonly templateVersion: string;
  readonly report: {
    readonly number: number;
    readonly title: string;
    readonly generatedAt: string;
    readonly methodologyVersion: string;
    readonly metricsVersion: string;
    readonly evidenceRuleVersion: string;
  };
  readonly project: ReportProjectInput;
  readonly targetEntity: ReportEntityInput | null;
  readonly entities: readonly ReportEntityInput[];
  readonly scope: {
    readonly subject: string;
    readonly authorization: string;
    readonly exclusions: readonly string[];
  };
  readonly methodology: {
    readonly answerSource: string;
    readonly evidenceAggregation: string;
    readonly metricDefinitionsVersion: string;
    readonly websiteAuditVersions: readonly string[];
    readonly querySetVersions: readonly string[];
  };
  readonly coverage: ReportCoverage;
  readonly claims: readonly ReportClaimView[];
  readonly querySets: readonly ReportQuerySetView[];
  readonly runs: readonly ReportRunView[];
  readonly comparisons: readonly RunComparison[];
  readonly websiteAudits: readonly ReportWebsiteAuditInput[];
  readonly remediation: readonly RemediationSuggestion[];
  /**
   * Added with `report-template-v3`. Absent in older snapshots, where findings were not carried;
   * an empty list means this project was tracking nothing at the time.
   */
  readonly findings?: readonly ReportFindingView[];
  readonly limitations: readonly string[];
  readonly unavailableChecks: readonly ReportUnavailableCheckInput[];
  readonly audit: ReportAuditInput;
}

export type { EvidenceRelationshipRecord };
