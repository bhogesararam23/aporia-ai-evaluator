export const EVIDENCE_RELATIONS = [
  'SUPPORTS',
  'CONTRADICTS',
  'QUALIFIES',
  'CONTEXTUALIZES',
  'DOES_NOT_ADDRESS',
  'UNAVAILABLE',
] as const;
export type EvidenceRelation = (typeof EVIDENCE_RELATIONS)[number];

export const PROPOSITION_STATUSES = [
  'SUPPORTED_WITHIN_SCOPE',
  'PARTIALLY_SUPPORTED',
  'CONTRADICTED',
  'INSUFFICIENT_EVIDENCE',
  'CONFLICTING_EVIDENCE',
  'NOT_ASSESSED',
  'UNAVAILABLE',
] as const;
export type PropositionStatus = (typeof PROPOSITION_STATUSES)[number];

export const PROPOSITION_STATUS_LABELS: Record<PropositionStatus, string> = {
  SUPPORTED_WITHIN_SCOPE: 'Support recorded within scope',
  PARTIALLY_SUPPORTED: 'Partial support recorded',
  CONTRADICTED: 'Contradiction recorded',
  INSUFFICIENT_EVIDENCE: 'Insufficient recorded evidence',
  CONFLICTING_EVIDENCE: 'Conflicting evidence recorded',
  NOT_ASSESSED: 'Not assessed',
  UNAVAILABLE: 'Evidence unavailable',
};

export const PROPOSITION_STATUS_DESCRIPTIONS: Record<PropositionStatus, string> = {
  SUPPORTED_WITHIN_SCOPE:
    'At least one reviewer-recorded supporting relationship exists, with no recorded contradiction or qualifier, within the stated scope. This summarizes human records; it is not independent verification or universal proof.',
  PARTIALLY_SUPPORTED:
    'Recorded support coexists with a recorded qualifier, or only qualifiers are recorded. Conditions or scope remain unresolved; this is not independent verification.',
  CONTRADICTED:
    'At least one reviewer-recorded contradiction exists, with no recorded support. This is a recorded relationship, not an Aporia verification that the proposition is false.',
  INSUFFICIENT_EVIDENCE:
    'The recorded relationships do not decide the proposition: they are contextual, do not address it, or otherwise leave it unresolved. This is not a factual negative.',
  CONFLICTING_EVIDENCE:
    'Reviewer-recorded support and contradiction coexist. The conflict remains unresolved unless a human assessment documents an adjudication.',
  NOT_ASSESSED: 'No evidence relationships have been recorded for this proposition.',
  UNAVAILABLE:
    'The evidence could not be inspected reliably. This is not support or contradiction.',
};

export const CLAIM_STATUSES = [
  'SUBMITTED',
  'DECOMPOSED',
  'UNDER_REVIEW',
  'ASSESSED',
  'DISPUTED',
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  SUBMITTED: 'Submitted',
  DECOMPOSED: 'Decomposed',
  UNDER_REVIEW: 'Under review',
  ASSESSED: 'Assessed',
  DISPUTED: 'Disputed',
};

export const CLAIM_STATUS_DESCRIPTIONS: Record<ClaimStatus, string> = {
  SUBMITTED: 'The claim revision exists but has no propositions yet.',
  DECOMPOSED: 'The claim revision has at least one atomic proposition.',
  UNDER_REVIEW: 'Evidence and propositions are being reviewed.',
  ASSESSED: 'A review conclusion has been recorded.',
  DISPUTED: 'A material challenge or correction is under review.',
};

export const CLAIM_TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  SUBMITTED: ['DECOMPOSED', 'DISPUTED'],
  DECOMPOSED: ['UNDER_REVIEW', 'DISPUTED'],
  UNDER_REVIEW: ['ASSESSED', 'DISPUTED'],
  ASSESSED: ['UNDER_REVIEW', 'DISPUTED'],
  DISPUTED: ['UNDER_REVIEW'],
};

export const ENTITY_TYPES = [
  'PERSON',
  'ORGANIZATION',
  'PRODUCT',
  'REPOSITORY',
  'PUBLICATION',
  'PROJECT_ARTIFACT',
  'OTHER',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  PERSON: 'Person',
  ORGANIZATION: 'Organization',
  PRODUCT: 'Product',
  REPOSITORY: 'Repository',
  PUBLICATION: 'Publication',
  PROJECT_ARTIFACT: 'Project artifact',
  OTHER: 'Other',
};

export const IDENTITY_STATUSES = ['UNVERIFIED', 'SELF_DECLARED'] as const;
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

export const IDENTITY_STATUS_LABELS: Record<IdentityStatus, string> = {
  UNVERIFIED: 'Unverified',
  SELF_DECLARED: 'Self-declared by operator',
};

export const IDENTITY_STATUS_DESCRIPTIONS: Record<IdentityStatus, string> = {
  UNVERIFIED: 'No identity claim has been made beyond this local record.',
  SELF_DECLARED:
    'The operator states this identity relationship. Aporia v0.1 performed no independent identity or account-control verification.',
};

export const SOURCE_TYPES = [
  'PRIMARY_ARTIFACT',
  'REPRODUCIBLE_RESULT',
  'INDEPENDENT_SOURCE',
  'SECONDARY_REPORT',
  'SELF_PUBLISHED',
  'UNATTRIBUTED',
  'OTHER',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  PRIMARY_ARTIFACT: 'Primary artifact',
  REPRODUCIBLE_RESULT: 'Reproducible result',
  INDEPENDENT_SOURCE: 'Independent source (recorded)',
  SECONDARY_REPORT: 'Secondary report',
  SELF_PUBLISHED: 'Self-published',
  UNATTRIBUTED: 'Unattributed',
  OTHER: 'Other',
};

export const SOURCE_TYPE_DESCRIPTIONS: Record<SourceType, string> = {
  PRIMARY_ARTIFACT:
    'A repository, release, paper, test log, official record, or demonstration that directly bears on the proposition.',
  REPRODUCIBLE_RESULT: 'A result others can inspect or repeat under documented conditions.',
  INDEPENDENT_SOURCE:
    'A source the reviewer recorded as not dependent on the claim-maker, with direct access to the facts. Aporia has not verified the independence or credibility of the source.',
  SECONDARY_REPORT:
    'Reporting that cites primary evidence; still secondary to the underlying artifact.',
  SELF_PUBLISHED: 'A description published by the claim-maker or an affiliated party.',
  UNATTRIBUTED: 'A claim or aggregation without a clear author, origin, or context.',
  OTHER: 'A source type that does not fit the listed categories; describe it in notes.',
};

export const SOURCE_INDEPENDENCE = ['INDEPENDENT', 'SELF_PUBLISHED', 'RELATED', 'UNKNOWN'] as const;
export type SourceIndependence = (typeof SOURCE_INDEPENDENCE)[number];

export const SOURCE_INDEPENDENCE_LABELS: Record<SourceIndependence, string> = {
  INDEPENDENT: 'Recorded as independent',
  SELF_PUBLISHED: 'Self-published / affiliated (recorded)',
  RELATED: 'Related or syndicated (recorded)',
  UNKNOWN: 'Independence unknown',
};

export const SOURCE_INDEPENDENCE_DESCRIPTIONS: Record<SourceIndependence, string> = {
  INDEPENDENT:
    'The reviewer recorded this source as independent of the claim-maker. Aporia did not verify that relationship, the source’s credibility, or its accuracy.',
  SELF_PUBLISHED:
    'The reviewer recorded this source as published by the claim-maker or an affiliated party.',
  RELATED:
    'The reviewer recorded this source as related, syndicated, or sharing an origin with another source.',
  UNKNOWN:
    'Independence has not been recorded. Unknown is not independent and is not a negative finding.',
};

export const SOURCE_ACCESS_ROUTES = [
  'MANUAL_ENTRY',
  'PASTED_EXCERPT',
  'LOCAL_FILE',
  'OTHER',
] as const;
export type SourceAccessRoute = (typeof SOURCE_ACCESS_ROUTES)[number];

export const SOURCE_ACCESS_ROUTE_LABELS: Record<SourceAccessRoute, string> = {
  MANUAL_ENTRY: 'Entered manually',
  PASTED_EXCERPT: 'Pasted excerpt',
  LOCAL_FILE: 'Local file',
  OTHER: 'Other',
};

export const EVIDENCE_EXTRACTION_METHODS = [
  'MANUAL_ENTRY',
  'PASTED_TEXT',
  'LOCAL_FILE',
  'OTHER',
] as const;
export type EvidenceExtractionMethod = (typeof EVIDENCE_EXTRACTION_METHODS)[number];

export const EVIDENCE_EXTRACTION_METHOD_LABELS: Record<EvidenceExtractionMethod, string> = {
  MANUAL_ENTRY: 'Entered manually',
  PASTED_TEXT: 'Pasted text',
  LOCAL_FILE: 'Local file',
  OTHER: 'Other',
};

export const EVIDENCE_RELATION_LABELS: Record<EvidenceRelation, string> = {
  SUPPORTS: 'Supports',
  CONTRADICTS: 'Contradicts',
  QUALIFIES: 'Qualifies',
  CONTEXTUALIZES: 'Contextualizes',
  DOES_NOT_ADDRESS: 'Does not address',
  UNAVAILABLE: 'Unavailable / unreadable',
};

export const EVIDENCE_RELATION_DESCRIPTIONS: Record<EvidenceRelation, string> = {
  SUPPORTS:
    'The reviewer recorded that the content materially increases support for the exact proposition.',
  CONTRADICTS: 'The reviewer recorded that the content materially conflicts with the proposition.',
  QUALIFIES:
    'The reviewer recorded that the content supports the proposition only under conditions or a narrower scope.',
  CONTEXTUALIZES:
    'The reviewer recorded useful background that is neither direct support nor contradiction.',
  DOES_NOT_ADDRESS: 'The reviewer recorded that the source is not probative for this proposition.',
  UNAVAILABLE: 'The reviewer recorded that the content could not be inspected reliably.',
};

export const QUERY_INTENTS = [
  'IDENTITY',
  'DESCRIPTION',
  'FACTUAL_VERIFICATION',
  'DISCOVERY',
  'SOURCE_SEEKING',
  'COMPARISON',
  'ATTRIBUTION',
  'TIME_SENSITIVE',
  'OTHER',
] as const;
export type QueryIntent = (typeof QUERY_INTENTS)[number];

export const QUERY_INTENT_LABELS: Record<QueryIntent, string> = {
  IDENTITY: 'Identity / disambiguation',
  DESCRIPTION: 'Description',
  FACTUAL_VERIFICATION: 'Factual verification',
  DISCOVERY: 'Discovery / recommendation',
  SOURCE_SEEKING: 'Source / evidence seeking',
  COMPARISON: 'Comparison / alternatives',
  ATTRIBUTION: 'Attribution / ownership',
  TIME_SENSITIVE: 'Time-sensitive status',
  OTHER: 'Other',
};

export const QUERY_SET_STATUSES = ['DRAFT', 'APPROVED'] as const;
export type QuerySetStatus = (typeof QUERY_SET_STATUSES)[number];

export const RUN_STATUSES = ['OPEN', 'FINALIZED', 'CANCELLED'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  OPEN: ['FINALIZED', 'CANCELLED'],
  FINALIZED: [],
  CANCELLED: [],
};

export const GROUNDING_MODES = [
  'NOT_APPLICABLE',
  'NO_SEARCH',
  'SEARCH_GROUNDED',
  'UNKNOWN',
] as const;
export type GroundingMode = (typeof GROUNDING_MODES)[number];

export const GROUNDING_MODE_LABELS: Record<GroundingMode, string> = {
  NOT_APPLICABLE: 'Not applicable',
  NO_SEARCH: 'No search / grounding',
  SEARCH_GROUNDED: 'Search or retrieval grounded',
  UNKNOWN: 'Unknown',
};

export const OBSERVATION_STATUSES = [
  'COMPLETED',
  'REFUSAL',
  'NO_ANSWER',
  'ERROR',
  'BLOCKED',
  'TIMEOUT',
  'UNAVAILABLE',
] as const;
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];

export const OBSERVATION_STATUS_LABELS: Record<ObservationStatus, string> = {
  COMPLETED: 'Completed answer',
  REFUSAL: 'Policy or safety refusal',
  NO_ANSWER: 'No answer / abstention',
  ERROR: 'Provider or capture error',
  BLOCKED: 'Blocked by access or policy',
  TIMEOUT: 'Timed out',
  UNAVAILABLE: 'Unavailable',
};

export const OBSERVATION_STATUS_DESCRIPTIONS: Record<ObservationStatus, string> = {
  COMPLETED: 'An answer was captured and is eligible for answer-level assessment.',
  REFUSAL: 'The system refused on policy or safety grounds. This is not a factual denial.',
  NO_ANSWER:
    'The system produced no answer or abstained. Silence is not scored as an incorrect statement.',
  ERROR: 'A capture, provider, or interface error occurred. This is not a negative mention.',
  BLOCKED: 'Access was blocked. This is not evidence against the claim.',
  TIMEOUT: 'The capture timed out. This is not evidence against the claim.',
  UNAVAILABLE:
    'The system or capture route was unavailable. This is not evidence against the claim.',
};

export const CITATION_CAPTURE_STATES = ['CAPTURED', 'NOT_SHOWN', 'UNKNOWN'] as const;
export type CitationCaptureState = (typeof CITATION_CAPTURE_STATES)[number];

export const CITATION_CAPTURE_LABELS: Record<CitationCaptureState, string> = {
  CAPTURED: 'Citation metadata captured',
  NOT_SHOWN: 'Interface did not show citations',
  UNKNOWN: 'Citation availability unknown',
};

export const ASSESSMENT_DIMENSIONS = [
  'PRESENCE',
  'FIDELITY',
  'CITATION_SUPPORT',
  'ATTRIBUTION',
] as const;
export type AssessmentDimension = (typeof ASSESSMENT_DIMENSIONS)[number];

export const ASSESSMENT_DIMENSION_LABELS: Record<AssessmentDimension, string> = {
  PRESENCE: 'Answer presence',
  FIDELITY: 'Answer fidelity',
  CITATION_SUPPORT: 'Citation support',
  ATTRIBUTION: 'Attribution',
};

export const PRESENCE_LABELS = ['MENTIONED', 'NOT_MENTIONED', 'NOT_ASSESSABLE'] as const;
export type PresenceLabel = (typeof PRESENCE_LABELS)[number];

export const FIDELITY_LABELS = [
  'ACCURATE',
  'PARTIALLY_ACCURATE',
  'CONTRADICTED',
  'UNSUPPORTED',
  'NOT_ASSESSABLE',
] as const;
export type FidelityLabel = (typeof FIDELITY_LABELS)[number];

export const CITATION_SUPPORT_LABELS = [
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'NOT_SUPPORTED',
  'NOT_ASSESSABLE',
] as const;
export type CitationSupportLabel = (typeof CITATION_SUPPORT_LABELS)[number];

export const ATTRIBUTION_LABELS = [
  'CORRECT',
  'PARTIALLY_CORRECT',
  'INCORRECT',
  'NOT_ADDRESSED',
  'NOT_ASSESSABLE',
] as const;
export type AttributionLabel = (typeof ATTRIBUTION_LABELS)[number];

export const ASSESSMENT_LABELS_BY_DIMENSION = {
  PRESENCE: PRESENCE_LABELS,
  FIDELITY: FIDELITY_LABELS,
  CITATION_SUPPORT: CITATION_SUPPORT_LABELS,
  ATTRIBUTION: ATTRIBUTION_LABELS,
} as const;

export const ASSESSMENT_LABEL_DISPLAY: Record<string, string> = {
  MENTIONED: 'Mentioned',
  NOT_MENTIONED: 'Not mentioned',
  NOT_ASSESSABLE: 'Not assessable',
  ACCURATE: 'Accurate within scope',
  PARTIALLY_ACCURATE: 'Partially accurate / qualified',
  CONTRADICTED: 'Contradicted',
  UNSUPPORTED: 'Unsupported by available evidence',
  SUPPORTED: 'Supported by cited material',
  PARTIALLY_SUPPORTED: 'Partially supported by cited material',
  NOT_SUPPORTED: 'Not supported by cited material',
  CORRECT: 'Correct',
  PARTIALLY_CORRECT: 'Partially correct',
  INCORRECT: 'Incorrect',
  NOT_ADDRESSED: 'Attribution not addressed',
};

export const ASSESSMENT_METHODS = ['HUMAN', 'RULE'] as const;
export type AssessmentMethod = (typeof ASSESSMENT_METHODS)[number];

export const ATTRIBUTION_ROLES = [
  'AUTHOR',
  'COAUTHOR',
  'MAINTAINER',
  'CONTRIBUTOR',
  'PROJECT_LEAD',
  'ORGANIZATION',
  'FUNDER',
  'PUBLISHER',
  'UNSPECIFIED',
] as const;
export type AttributionRole = (typeof ATTRIBUTION_ROLES)[number];

export const ATTRIBUTION_ROLE_LABELS: Record<AttributionRole, string> = {
  AUTHOR: 'Author',
  COAUTHOR: 'Co-author',
  MAINTAINER: 'Maintainer',
  CONTRIBUTOR: 'Contributor',
  PROJECT_LEAD: 'Project lead',
  ORGANIZATION: 'Organization',
  FUNDER: 'Funder',
  PUBLISHER: 'Publisher',
  UNSPECIFIED: 'Unspecified role',
};

export function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value);
}

export function isAssessmentLabelForDimension(
  dimension: AssessmentDimension,
  label: string,
): boolean {
  return isOneOf(label, ASSESSMENT_LABELS_BY_DIMENSION[dimension]);
}

export function assessmentLabelDisplay(label: string): string {
  return ASSESSMENT_LABEL_DISPLAY[label] ?? label;
}
