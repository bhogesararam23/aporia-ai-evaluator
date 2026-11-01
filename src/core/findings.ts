/**
 * Remediation finding lifecycle (ADR-021).
 *
 * A finding is a tracked evaluation problem, not a task-management ticket. The statuses below exist
 * so that "someone did something" can never be recorded without a measurement, and so that "we could
 * not verify" stays a respectable outcome rather than being quietly relabelled as progress.
 */

export const FINDING_STATUSES = [
  'OPEN',
  'ACCEPTED',
  'IN_PROGRESS',
  'AWAITING_EXTERNAL_CHANGE',
  'RETEST_REQUIRED',
  'IMPROVED',
  'UNCHANGED',
  'REGRESSED',
  'UNABLE_TO_VERIFY',
  'CLOSED_WITH_RATIONALE',
  'WONT_FIX',
] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const FINDING_STATUS_LABELS: Record<FindingStatus, string> = {
  OPEN: 'Open',
  ACCEPTED: 'Accepted',
  IN_PROGRESS: 'In progress',
  AWAITING_EXTERNAL_CHANGE: 'Awaiting an external change',
  RETEST_REQUIRED: 'Retest required',
  IMPROVED: 'Improved on retest',
  UNCHANGED: 'Unchanged on retest',
  REGRESSED: 'Regressed on retest',
  UNABLE_TO_VERIFY: 'Unable to verify',
  CLOSED_WITH_RATIONALE: 'Closed with rationale',
  WONT_FIX: 'Will not fix',
};

export const FINDING_STATUS_DESCRIPTIONS: Record<FindingStatus, string> = {
  OPEN: 'Recorded and not yet triaged. A report suggestion becomes a finding only when someone records it.',
  ACCEPTED:
    'The reviewer accepts that the finding is real and worth acting on. Nothing has changed yet.',
  IN_PROGRESS:
    'Work on the underlying issue is underway. No claim is made that any later answer improved.',
  AWAITING_EXTERNAL_CHANGE:
    'The next step belongs to someone outside this tool, such as a site change or a source correction. Nothing here can confirm when they act.',
  RETEST_REQUIRED:
    'A change was made and a later evaluation is needed. Recording this intent schedules nothing and calls no provider: a genuine later observation must be captured manually.',
  IMPROVED:
    'A stored, comparability-checked comparison found the measured value higher in the later run. This is an association, not proof that the change caused it.',
  UNCHANGED: 'A stored comparison found the measured value the same in the later run.',
  REGRESSED: 'A stored comparison found the measured value lower in the later run.',
  UNABLE_TO_VERIFY:
    'The later measurement could not be compared, or no comparable later run exists. This is not “fixed”, and it is never rendered as one.',
  CLOSED_WITH_RATIONALE:
    'Closed with a written reason. The finding and its history remain readable.',
  WONT_FIX:
    'The reviewer recorded a decision not to act, with a reason. The finding stays visible rather than disappearing.',
};

/**
 * Statuses that can only be reached through a stored retest comparison. Enforced in the database as
 * well as here, because the ability to mark a finding "improved" by hand is exactly how a tool
 * manufactures its own success story.
 */
export const MEASUREMENT_ONLY_STATUSES: readonly FindingStatus[] = [
  'IMPROVED',
  'UNCHANGED',
  'REGRESSED',
  'UNABLE_TO_VERIFY',
];

export function isMeasurementOnlyStatus(status: FindingStatus): boolean {
  return MEASUREMENT_ONLY_STATUSES.includes(status);
}

export const COMPARISON_OUTCOMES = [
  'IMPROVED',
  'UNCHANGED',
  'REGRESSED',
  'UNABLE_TO_VERIFY',
  'NOT_COMPARABLE',
] as const;
export type ComparisonOutcome = (typeof COMPARISON_OUTCOMES)[number];

export const COMPARISON_OUTCOME_LABELS: Record<ComparisonOutcome, string> = {
  IMPROVED: 'The measured value is higher in the later run',
  UNCHANGED: 'The measured value is the same in the later run',
  REGRESSED: 'The measured value is lower in the later run',
  UNABLE_TO_VERIFY: 'A comparison was attempted and could not decide',
  NOT_COMPARABLE: 'The runs differ in a condition that makes a delta meaningless',
};

/**
 * A non-comparable pair may only ever produce `UNABLE_TO_VERIFY`. This is the guard that stops a
 * website edit and a later, differently-configured answer from being recorded as an improvement.
 */
export function statusAllowedForOutcome(
  status: FindingStatus,
  outcome: ComparisonOutcome,
): boolean {
  if (status === 'UNABLE_TO_VERIFY') {
    return outcome === 'UNABLE_TO_VERIFY' || outcome === 'NOT_COMPARABLE';
  }
  return isMeasurementOnlyStatus(status) && status === outcome;
}

/**
 * The declared transition graph. `OPEN` is reachable again only through an explicit new finding, so
 * a closed finding cannot be silently reopened and its history reinterpreted.
 *
 * `UNABLE_TO_VERIFY` is reachable only from `RETEST_REQUIRED`, because "we could not verify" is a
 * statement about a comparison that was attempted. Claiming it before any retest was set up would let
 * a finding be parked in a state that reads like closure without any measurement behind it.
 */
export const FINDING_TRANSITIONS: Record<FindingStatus, readonly FindingStatus[]> = {
  OPEN: [
    'ACCEPTED',
    'IN_PROGRESS',
    'AWAITING_EXTERNAL_CHANGE',
    'WONT_FIX',
    'CLOSED_WITH_RATIONALE',
  ],
  ACCEPTED: [
    'IN_PROGRESS',
    'AWAITING_EXTERNAL_CHANGE',
    'RETEST_REQUIRED',
    'WONT_FIX',
    'CLOSED_WITH_RATIONALE',
  ],
  IN_PROGRESS: ['AWAITING_EXTERNAL_CHANGE', 'RETEST_REQUIRED', 'WONT_FIX', 'CLOSED_WITH_RATIONALE'],
  AWAITING_EXTERNAL_CHANGE: ['IN_PROGRESS', 'RETEST_REQUIRED', 'WONT_FIX', 'CLOSED_WITH_RATIONALE'],
  RETEST_REQUIRED: [
    'IMPROVED',
    'UNCHANGED',
    'REGRESSED',
    'UNABLE_TO_VERIFY',
    'CLOSED_WITH_RATIONALE',
  ],
  IMPROVED: ['RETEST_REQUIRED', 'CLOSED_WITH_RATIONALE'],
  UNCHANGED: ['IN_PROGRESS', 'RETEST_REQUIRED', 'CLOSED_WITH_RATIONALE'],
  REGRESSED: ['IN_PROGRESS', 'RETEST_REQUIRED', 'CLOSED_WITH_RATIONALE'],
  UNABLE_TO_VERIFY: ['RETEST_REQUIRED', 'IN_PROGRESS', 'WONT_FIX', 'CLOSED_WITH_RATIONALE'],
  CLOSED_WITH_RATIONALE: [],
  WONT_FIX: [],
};

export function isFindingTransition(from: FindingStatus, to: FindingStatus): boolean {
  return FINDING_TRANSITIONS[from].includes(to);
}

/** Terminal statuses require a written reason, enforced by a trigger as well as here. */
export const TERMINAL_STATUSES: readonly FindingStatus[] = ['CLOSED_WITH_RATIONALE', 'WONT_FIX'];

export function requiresClosureRationale(status: FindingStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export const FINDING_SEVERITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const FINDING_SEVERITY_LABELS: Record<FindingSeverity, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

export const FINDING_SEVERITY_DESCRIPTIONS: Record<FindingSeverity, string> = {
  HIGH: 'The finding materially affects whether a claim can be supported, attributed, or discovered as recorded. The severity rationale must say what depends on it.',
  MEDIUM:
    'The finding limits confidence or completeness without invalidating the recorded evaluation.',
  LOW: 'The finding is worth tracking for clarity or coverage rather than correctness.',
};

/**
 * Cause classes come from the remediation specification. They exist so a remedy is aimed at the right
 * thing: an unsupported assertion and a source-access failure look similar in a score and are not
 * similar in what anyone can do about them.
 */
export const FINDING_CAUSES = [
  'MISSING_OR_UNCLEAR_FIRST_PARTY_CONTENT',
  'WEAK_INDEPENDENT_CORROBORATION',
  'AMBIGUOUS_ENTITY_IDENTITY',
  'STALE_SOURCE',
  'UNSUPPORTED_CLAIM',
  'MODEL_MISREAD_OR_OMISSION',
  'WRONG_ATTRIBUTION',
  'CITATION_DOES_NOT_SUPPORT',
  'MEASUREMENT_DEFECT',
  'PROVIDER_OR_INTERFACE_LIMITATION',
  'CAPTURE_OR_METADATA_UNAVAILABLE',
  'OTHER',
] as const;
export type FindingCause = (typeof FINDING_CAUSES)[number];

export const FINDING_CAUSE_LABELS: Record<FindingCause, string> = {
  MISSING_OR_UNCLEAR_FIRST_PARTY_CONTENT: 'Missing or unclear first-party content',
  WEAK_INDEPENDENT_CORROBORATION: 'Weak independent corroboration',
  AMBIGUOUS_ENTITY_IDENTITY: 'Ambiguous entity identity',
  STALE_SOURCE: 'Stale source',
  UNSUPPORTED_CLAIM: 'Unsupported claim',
  MODEL_MISREAD_OR_OMISSION: 'Answer misread or omitted the target',
  WRONG_ATTRIBUTION: 'Wrong attribution in the answer',
  CITATION_DOES_NOT_SUPPORT: 'Citation does not support the statement',
  MEASUREMENT_DEFECT: 'Measurement or evaluation defect',
  PROVIDER_OR_INTERFACE_LIMITATION: 'Provider or interface limitation',
  CAPTURE_OR_METADATA_UNAVAILABLE: 'Capture or citation metadata unavailable',
  OTHER: 'Another cause',
};

export const FINDING_CAUSE_DESCRIPTIONS: Record<FindingCause, string> = {
  MISSING_OR_UNCLEAR_FIRST_PARTY_CONTENT:
    'The subject’s own material does not state the fact clearly enough for an answer or a citation to reflect it. A proportionate remedy improves the real content; it never manufactures signals.',
  WEAK_INDEPENDENT_CORROBORATION:
    'Only affiliated or self-published sources were recorded. The remedy is any genuinely independent source that exists — not one invented to fill a gap.',
  AMBIGUOUS_ENTITY_IDENTITY:
    'The target cannot be resolved confidently, so answers may be describing a different party. Identity remains unverified; this finding does not settle who anyone is.',
  STALE_SOURCE: 'A recorded source no longer reflects the current state of the thing it describes.',
  UNSUPPORTED_CLAIM:
    'The claim itself is not supported by the recorded evidence. The remedy may be to withdraw or narrow the claim, not to find friendlier sources.',
  MODEL_MISREAD_OR_OMISSION:
    'The evidence supports the target and the captured answer still left it out or restated it wrongly. This is an observation about one captured response under one configuration, not a property of the provider.',
  WRONG_ATTRIBUTION:
    'The answer credited the wrong party or role. It labels the answer’s wording and establishes no legal authorship or ownership.',
  CITATION_DOES_NOT_SUPPORT:
    'The cited material was located and read, and does not support the statement it accompanied. Citation presence is not citation support.',
  MEASUREMENT_DEFECT:
    'The finding is in Aporia’s own method or code — a metric denominator, an exclusion, or a rule that does not behave as documented. This class is what the benchmark harness is for.',
  PROVIDER_OR_INTERFACE_LIMITATION:
    'The behaviour sits with the system that produced the answer. Aporia can record it and cannot change it, and must not promise otherwise.',
  CAPTURE_OR_METADATA_UNAVAILABLE:
    'The interface did not expose citations, or the capture could not be read. This is an unavailable check, not a failure of the answer.',
  OTHER: 'None of the listed causes fits. The rationale must describe what was actually observed.',
};

/** Report suggestion priorities map onto finding severities when a suggestion is tracked. */
export const SUGGESTION_PRIORITY_TO_SEVERITY: Record<'HIGH' | 'MEDIUM' | 'LOW', FindingSeverity> = {
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
};

export const FINDING_REFERENCE_TYPES = [
  'claim',
  'proposition',
  'query',
  'run',
  'observation',
  'answer_claim',
  'citation',
  'website_audit',
  'report_suggestion',
] as const;
export type FindingReferenceType = (typeof FINDING_REFERENCE_TYPES)[number];

export const FINDING_REFERENCE_LABELS: Record<FindingReferenceType, string> = {
  claim: 'Claim',
  proposition: 'Target proposition',
  query: 'Query',
  run: 'Evaluation run',
  observation: 'Captured answer',
  answer_claim: 'Answer statement',
  citation: 'Citation',
  website_audit: 'HTML audit',
  report_suggestion: 'Report suggestion',
};

export const FINDING_VERSIONS = { lifecycle: 'finding-lifecycle-v1' } as const;
