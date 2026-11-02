/**
 * Shared metric vocabulary (`metrics-v4`, ADR-019 as amended by ADR-023).
 *
 * These types are used by both the observation-level metrics and the claim-level metrics, so the
 * two can be assembled without one importing the other. Exclusion reasons are a controlled list
 * because a report must be able to name why a unit left a denominator.
 */

export const EXCLUSION_REASONS = [
  'VOIDED_OBSERVATION',
  'PROVIDER_ERROR',
  'BLOCKED',
  'TIMEOUT',
  'UNAVAILABLE_TOOL',
  'POLICY_REFUSAL',
  'NO_ANSWER',
  'PRESENCE_UNASSESSED',
  'PRESENCE_NOT_ASSESSABLE',
  'FIDELITY_UNASSESSED',
  'FIDELITY_NOT_ASSESSABLE',
  'CITATION_METADATA_UNAVAILABLE',
  'NO_ACTIVE_CITATIONS',
  'CITATION_SUPPORT_UNASSESSED',
  'CITATION_SUPPORT_NOT_ASSESSABLE',
  'ATTRIBUTION_NOT_ADDRESSED',
  'ATTRIBUTION_UNASSESSED',
  'ATTRIBUTION_NOT_ASSESSABLE',
  'QUERY_UNTESTED',
  'QUERY_PRESENCE_UNASSESSED',
  'CLAIM_OBSERVATION_INELIGIBLE',
  'CLAIM_FIDELITY_UNASSESSED',
  'CLAIM_OMITTED',
  'CLAIM_REFUSED',
  'CLAIM_UNAVAILABLE',
  'CLAIM_NOT_ADDRESSED',
  'CLAIM_NOT_ASSESSABLE',
  'CLAIM_ATTRIBUTION_UNASSESSED',
  'CLAIM_ATTRIBUTION_NOT_ADDRESSED',
  'CLAIM_ATTRIBUTION_NOT_ASSESSABLE',
  'CLAIM_NO_MAPPED_CITATION',
  'CLAIM_CITATION_UNCLEAR',
  'CLAIM_CITATION_METADATA_MISSING',
  'CLAIM_CITATION_NOT_ASSESSABLE',
  'CLAIM_NO_PROPOSITION_RELATION',
  'CLAIM_LABEL_INVALID',
  'CLAIM_VOIDED',
  'CLAIM_UNRELATED',
  'CLAIM_AMBIGUOUS',
  'CLAIM_ABSTENTION',
  'CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE',
  'CLAIM_CITATION_VOIDED',
  'CLAIM_CITATION_NON_ASSERTING',
  'CLAIM_OMISSION_NON_ENGAGING',
] as const;

export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export const EXCLUSION_DESCRIPTIONS: Record<ExclusionReason, string> = {
  VOIDED_OBSERVATION: 'The operator voided this observation; the original record is retained.',
  PROVIDER_ERROR: 'A capture or provider error occurred. This is not a negative answer.',
  BLOCKED: 'Access was blocked. This is not evidence about the claim.',
  TIMEOUT: 'The capture timed out. This is not evidence about the claim.',
  UNAVAILABLE_TOOL: 'The system or capture route was unavailable. This is not a negative answer.',
  POLICY_REFUSAL:
    'The system refused on policy or safety grounds. A refusal is not a factual denial.',
  NO_ANSWER: 'The system produced no answer or abstained. Silence is not scored as incorrect.',
  PRESENCE_UNASSESSED: 'No presence assessment was recorded.',
  PRESENCE_NOT_ASSESSABLE: 'The presence assessment was marked not assessable.',
  FIDELITY_UNASSESSED: 'No fidelity assessment was recorded.',
  FIDELITY_NOT_ASSESSABLE: 'The fidelity assessment was marked not assessable.',
  CITATION_METADATA_UNAVAILABLE:
    'The capture declares that citations were not shown or their availability is unknown.',
  NO_ACTIVE_CITATIONS: 'The observation has no active citation to evaluate for support.',
  CITATION_SUPPORT_UNASSESSED: 'No citation-support assessment was recorded.',
  CITATION_SUPPORT_NOT_ASSESSABLE: 'The citation-support assessment was marked not assessable.',
  ATTRIBUTION_NOT_ADDRESSED:
    'The answer did not attribute the accomplishment, so attribution is not scored.',
  ATTRIBUTION_UNASSESSED: 'No attribution assessment was recorded.',
  ATTRIBUTION_NOT_ASSESSABLE: 'The attribution assessment was marked not assessable.',
  QUERY_UNTESTED: 'No eligible completed observation was recorded for this query intent.',
  QUERY_PRESENCE_UNASSESSED:
    'The query was tested, but no eligible observation has a presence assessment.',
  CLAIM_OBSERVATION_INELIGIBLE:
    'The statement belongs to an observation that is voided, errored, refused, or otherwise outside answer scoring.',
  CLAIM_FIDELITY_UNASSESSED: 'No fidelity assessment was recorded for this statement.',
  CLAIM_OMITTED:
    'The reviewer recorded that the answer left this out. An omission is not an inaccurate statement.',
  CLAIM_REFUSED: 'The statement is a refusal. A refusal is not a factual denial of the target.',
  CLAIM_UNAVAILABLE:
    'The statement could not be checked against the recorded evidence. This is an unavailable check, not a failure.',
  CLAIM_NOT_ADDRESSED:
    'The recorded statement makes no factual assertion about the target, so fidelity does not apply.',
  CLAIM_NOT_ASSESSABLE: 'The statement was marked not assessable. It remains a recorded unknown.',
  CLAIM_ATTRIBUTION_UNASSESSED: 'No attribution assessment was recorded for this statement.',
  CLAIM_ATTRIBUTION_NOT_ADDRESSED:
    'The statement makes no credit claim, so attribution is not scored. Silence about credit is not incorrect credit.',
  CLAIM_ATTRIBUTION_NOT_ASSESSABLE: 'The attribution assessment was marked not assessable.',
  CLAIM_NO_MAPPED_CITATION:
    'No citation was mapped to this statement. Absence of a citation is not a citation failure.',
  CLAIM_CITATION_UNCLEAR:
    'The cited material exists but its bearing on the statement could not be determined.',
  CLAIM_CITATION_METADATA_MISSING:
    'No usable citation content was captured, so support could be compared. This is an unavailable check.',
  CLAIM_CITATION_NOT_ASSESSABLE: 'The citation-support mapping was marked not assessable.',
  CLAIM_NO_PROPOSITION_RELATION:
    'No recorded statement relates to a target proposition, so the omission measure has no denominator.',
  CLAIM_LABEL_INVALID:
    'A stored label does not belong to its dimension. It is reported as unassessed rather than trusted.',
  CLAIM_VOIDED:
    'The reviewer voided this statement. Its record and reason stay inspectable, and it contributes to no current metric.',
  CLAIM_UNRELATED:
    'The statement has nothing to do with the evaluation target. It is recorded for completeness and scored on nothing.',
  CLAIM_AMBIGUOUS:
    'The statement cannot be tied to one target with confidence. It stays an open question rather than becoming a verdict.',
  CLAIM_ABSTENTION:
    'The answer hedged or said it did not know. Abstention is not a negative verdict and is not scored as an inaccurate statement.',
  CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE:
    'The recorded label asserts something the recorded relevance says was never asserted. Relevance governs, the statement is excluded, and the conflict is reported for correction.',
  CLAIM_CITATION_VOIDED:
    'The cited record was voided. The mapping is kept as history and no longer counts as citation support.',
  CLAIM_CITATION_NON_ASSERTING:
    'The statement makes no factual assertion, so no cited material can support it. The mapping is recorded and excluded.',
  CLAIM_OMISSION_NON_ENGAGING:
    'The statement does not engage the target, so it cannot show that anything was left unsaid. Its proposition link is excluded from the omission measure.',
};

export interface MetricExclusion {
  readonly reason: ExclusionReason;
  readonly count: number;
  readonly description: string;
}

/**
 * The unit a rate is expressed in. `answer statements`, `claim-citation mappings`, and
 * `propositions` are the claim-level units added by `metrics-v3`; the unit is named explicitly
 * because a reader who assumes "observations" would misread every claim-level rate.
 */
export type MetricUnit =
  | 'observations'
  | 'query intents'
  | 'answer statements'
  | 'claim-citation mappings'
  | 'propositions';

export interface MetricResult {
  readonly id: string;
  readonly label: string;
  readonly definition: string;
  readonly unit: MetricUnit;
  readonly numerator: number | null;
  readonly denominator: number;
  readonly value: number | null;
  readonly exclusions: readonly MetricExclusion[];
  readonly breakdown?: Readonly<Record<string, number>>;
  readonly notes: readonly string[];
}

export function countExclusions(reasons: readonly ExclusionReason[]): MetricExclusion[] {
  const counts = new Map<ExclusionReason, number>();
  for (const reason of reasons) {
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return EXCLUSION_REASONS.filter((reason) => (counts.get(reason) ?? 0) > 0).map((reason) => ({
    reason,
    count: counts.get(reason) ?? 0,
    description: EXCLUSION_DESCRIPTIONS[reason],
  }));
}

export function rate(numerator: number | null, denominator: number): number | null {
  if (numerator === null || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}
