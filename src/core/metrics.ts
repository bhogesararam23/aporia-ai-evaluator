import { METRICS_VERSION } from './versions.ts';
import type {
  AssessmentDimension,
  AttributionLabel,
  CitationCaptureState,
  CitationSupportLabel,
  FidelityLabel,
  ObservationStatus,
  PresenceLabel,
  QueryIntent,
  RunStatus,
} from './vocabulary.ts';

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
};

export interface CitationInput {
  readonly id: string;
  readonly targetOwned: boolean;
  readonly voided: boolean;
}

export type ObservationAssessmentInput =
  | { readonly dimension: 'PRESENCE'; readonly version: number; readonly label: PresenceLabel }
  | { readonly dimension: 'FIDELITY'; readonly version: number; readonly label: FidelityLabel }
  | {
      readonly dimension: 'CITATION_SUPPORT';
      readonly version: number;
      readonly label: CitationSupportLabel;
    }
  | {
      readonly dimension: 'ATTRIBUTION';
      readonly version: number;
      readonly label: AttributionLabel;
    };

export interface ObservationInput {
  readonly id: string;
  readonly queryId: string;
  readonly status: ObservationStatus;
  readonly voided: boolean;
  readonly citationCapture: CitationCaptureState;
  readonly citations: readonly CitationInput[];
  readonly assessments: readonly ObservationAssessmentInput[];
}

export interface QueryInput {
  readonly id: string;
  readonly intent: QueryIntent;
}

export interface RunMetricsInput {
  readonly runStatus: RunStatus;
  readonly queries: readonly QueryInput[];
  readonly observations: readonly ObservationInput[];
}

export interface MetricExclusion {
  readonly reason: ExclusionReason;
  readonly count: number;
  readonly description: string;
}

export interface MetricResult {
  readonly id: string;
  readonly label: string;
  readonly definition: string;
  readonly unit: 'observations' | 'query intents';
  readonly numerator: number | null;
  readonly denominator: number;
  readonly value: number | null;
  readonly exclusions: readonly MetricExclusion[];
  readonly breakdown?: Readonly<Record<string, number>>;
  readonly notes: readonly string[];
}

export type QueryCoverageStatus =
  'TESTED_COVERED' | 'TESTED_NOT_MENTIONED' | 'TESTED_UNASSESSED' | 'UNTESTED';

export interface QueryCoverage {
  readonly queryId: string;
  readonly intent: QueryIntent;
  readonly observations: number;
  readonly eligibleObservations: number;
  readonly presenceAssessed: number;
  readonly mentioned: number;
  readonly status: QueryCoverageStatus;
}

export type IntentCoverageStatus = QueryCoverageStatus;

/**
 * Coverage for one controlled query intent. Repeated queries with the same intent are one group.
 * `partialAssessment` is true when some eligible observations in the group have a presence
 * assessment and some do not; the group remains in the denominator because the documented unit
 * enters on at least one assessed observation, and the unassessed count stays visible.
 */
export interface IntentCoverage {
  readonly intent: QueryIntent;
  readonly queries: number;
  readonly testedQueries: number;
  readonly untestedQueries: number;
  readonly observations: number;
  readonly eligibleObservations: number;
  readonly presenceAssessed: number;
  readonly unassessedEligibleObservations: number;
  readonly mentioned: number;
  readonly status: IntentCoverageStatus;
  readonly partialAssessment: boolean;
}

export interface RunCoverage {
  readonly plannedQueries: number;
  readonly testedQueries: number;
  readonly untestedQueries: number;
  readonly observationsRecorded: number;
  readonly observationsVoided: number;
  readonly eligibleObservations: number;
  /** Absent in historical `metrics-v1` snapshots. */
  readonly plannedIntents?: number;
  /** Absent in historical `metrics-v1` snapshots. */
  readonly testedIntents?: number;
  /** Absent in historical `metrics-v1` snapshots. */
  readonly untestedIntents?: number;
  /** Absent in historical `metrics-v1` snapshots. */
  readonly coveredIntents?: number;
  /** Absent in historical `metrics-v1` snapshots. */
  readonly notMentionedIntents?: number;
  /** Absent in historical `metrics-v1` snapshots. */
  readonly unassessedIntents?: number;
  /** Absent in historical `metrics-v1` snapshots. */
  readonly partialAssessmentIntents?: number;
  /** Absent in historical `metrics-v1` snapshots. */
  readonly byIntent?: readonly IntentCoverage[];
  readonly exclusions: readonly MetricExclusion[];
  readonly byQuery: readonly QueryCoverage[];
}

export interface RunMetrics {
  readonly version: string;
  readonly runStatus: RunStatus;
  readonly coverage: RunCoverage;
  readonly mentionRate: MetricResult;
  readonly targetSourceCitationRate: MetricResult;
  readonly anySourceCitationRate: MetricResult;
  readonly citationSupportRate: MetricResult;
  readonly claimFidelityRate: MetricResult;
  readonly attributionCorrectnessRate: MetricResult;
  readonly observedAnswerCoverage: MetricResult;
  readonly notes: readonly string[];
}

type Eligibility =
  { readonly eligible: true } | { readonly eligible: false; readonly reason: ExclusionReason };

function eligibilityOf(observation: ObservationInput): Eligibility {
  if (observation.voided) {
    return { eligible: false, reason: 'VOIDED_OBSERVATION' };
  }
  switch (observation.status) {
    case 'COMPLETED':
      return { eligible: true };
    case 'REFUSAL':
      return { eligible: false, reason: 'POLICY_REFUSAL' };
    case 'NO_ANSWER':
      return { eligible: false, reason: 'NO_ANSWER' };
    case 'ERROR':
      return { eligible: false, reason: 'PROVIDER_ERROR' };
    case 'BLOCKED':
      return { eligible: false, reason: 'BLOCKED' };
    case 'TIMEOUT':
      return { eligible: false, reason: 'TIMEOUT' };
    case 'UNAVAILABLE':
      return { eligible: false, reason: 'UNAVAILABLE_TOOL' };
  }
}

function latestLabel(
  observation: ObservationInput,
  dimension: AssessmentDimension,
): string | undefined {
  let latest: { version: number; label: string } | undefined;
  for (const assessment of observation.assessments) {
    if (assessment.dimension !== dimension) {
      continue;
    }
    if (latest === undefined || assessment.version > latest.version) {
      latest = { version: assessment.version, label: assessment.label };
    }
  }
  return latest?.label;
}

function countExclusions(reasons: readonly ExclusionReason[]): MetricExclusion[] {
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

function rate(numerator: number | null, denominator: number): number | null {
  if (numerator === null || denominator === 0) {
    return null;
  }
  return numerator / denominator;
}

function activeCitations(observation: ObservationInput): CitationInput[] {
  return observation.citations.filter((citation) => !citation.voided);
}

function metric(input: {
  id: string;
  label: string;
  definition: string;
  numerator: number;
  denominator: number;
  reasons: readonly ExclusionReason[];
  breakdown?: Record<string, number>;
  notes: readonly string[];
}): MetricResult {
  return {
    id: input.id,
    label: input.label,
    definition: input.definition,
    unit: 'observations',
    numerator: input.denominator === 0 ? null : input.numerator,
    denominator: input.denominator,
    value: rate(input.denominator === 0 ? null : input.numerator, input.denominator),
    exclusions: countExclusions(input.reasons),
    ...(input.breakdown === undefined ? {} : { breakdown: input.breakdown }),
    notes: input.notes,
  };
}

export function computeRunMetrics(input: RunMetricsInput): RunMetrics {
  const queryIds = new Set(input.queries.map((query) => query.id));
  for (const observation of input.observations) {
    if (!queryIds.has(observation.queryId)) {
      throw new Error(`Observation ${observation.id} references an unknown query.`);
    }
  }

  const eligibility = new Map<string, Eligibility>();
  for (const observation of input.observations) {
    eligibility.set(observation.id, eligibilityOf(observation));
  }

  const globalReasons: ExclusionReason[] = [];
  let eligibleCount = 0;
  let voidedCount = 0;
  for (const observation of input.observations) {
    if (observation.voided) {
      voidedCount += 1;
    }
    const state = eligibility.get(observation.id);
    if (state === undefined || !state.eligible) {
      if (state !== undefined && !state.eligible) {
        globalReasons.push(state.reason);
      }
    } else {
      eligibleCount += 1;
    }
  }

  let mentionNumerator = 0;
  let mentionDenominator = 0;
  const mentionReasons: ExclusionReason[] = [];
  const mentionBreakdown: Record<string, number> = { MENTIONED: 0, NOT_MENTIONED: 0 };

  let targetCitationNumerator = 0;
  let anyCitationNumerator = 0;
  let citationDenominator = 0;
  const targetCitationReasons: ExclusionReason[] = [];
  const anyCitationReasons: ExclusionReason[] = [];

  let citationSupportNumerator = 0;
  let citationSupportDenominator = 0;
  const citationSupportReasons: ExclusionReason[] = [];
  const citationSupportBreakdown: Record<string, number> = {
    SUPPORTED: 0,
    PARTIALLY_SUPPORTED: 0,
    NOT_SUPPORTED: 0,
  };

  let fidelityNumerator = 0;
  let fidelityDenominator = 0;
  const fidelityReasons: ExclusionReason[] = [];
  const fidelityBreakdown: Record<string, number> = {
    ACCURATE: 0,
    PARTIALLY_ACCURATE: 0,
    CONTRADICTED: 0,
    UNSUPPORTED: 0,
  };

  let attributionNumerator = 0;
  let attributionDenominator = 0;
  const attributionReasons: ExclusionReason[] = [];
  const attributionBreakdown: Record<string, number> = {
    CORRECT: 0,
    PARTIALLY_CORRECT: 0,
    INCORRECT: 0,
  };

  for (const observation of input.observations) {
    const state = eligibility.get(observation.id);
    if (state === undefined || !state.eligible) {
      const reason = state?.reason ?? 'VOIDED_OBSERVATION';
      mentionReasons.push(reason);
      targetCitationReasons.push(reason);
      anyCitationReasons.push(reason);
      citationSupportReasons.push(reason);
      fidelityReasons.push(reason);
      attributionReasons.push(reason);
      continue;
    }

    const presence = latestLabel(observation, 'PRESENCE');
    if (presence === undefined) {
      mentionReasons.push('PRESENCE_UNASSESSED');
    } else if (presence === 'NOT_ASSESSABLE') {
      mentionReasons.push('PRESENCE_NOT_ASSESSABLE');
    } else {
      mentionDenominator += 1;
      mentionBreakdown[presence] = (mentionBreakdown[presence] ?? 0) + 1;
      if (presence === 'MENTIONED') {
        mentionNumerator += 1;
      }
    }

    if (observation.citationCapture !== 'CAPTURED') {
      targetCitationReasons.push('CITATION_METADATA_UNAVAILABLE');
      anyCitationReasons.push('CITATION_METADATA_UNAVAILABLE');
    } else {
      const citations = activeCitations(observation);
      citationDenominator += 1;
      if (citations.some((citation) => citation.targetOwned)) {
        targetCitationNumerator += 1;
      }
      if (citations.length > 0) {
        anyCitationNumerator += 1;
      }
    }

    if (observation.citationCapture !== 'CAPTURED') {
      citationSupportReasons.push('CITATION_METADATA_UNAVAILABLE');
    } else if (activeCitations(observation).length === 0) {
      citationSupportReasons.push('NO_ACTIVE_CITATIONS');
    } else {
      const citationSupport = latestLabel(observation, 'CITATION_SUPPORT');
      if (citationSupport === undefined) {
        citationSupportReasons.push('CITATION_SUPPORT_UNASSESSED');
      } else if (citationSupport === 'NOT_ASSESSABLE') {
        citationSupportReasons.push('CITATION_SUPPORT_NOT_ASSESSABLE');
      } else {
        citationSupportDenominator += 1;
        citationSupportBreakdown[citationSupport] =
          (citationSupportBreakdown[citationSupport] ?? 0) + 1;
        if (citationSupport === 'SUPPORTED') {
          citationSupportNumerator += 1;
        }
      }
    }

    const fidelity = latestLabel(observation, 'FIDELITY');
    if (fidelity === undefined) {
      fidelityReasons.push('FIDELITY_UNASSESSED');
    } else if (fidelity === 'NOT_ASSESSABLE') {
      fidelityReasons.push('FIDELITY_NOT_ASSESSABLE');
    } else {
      fidelityDenominator += 1;
      fidelityBreakdown[fidelity] = (fidelityBreakdown[fidelity] ?? 0) + 1;
      if (fidelity === 'ACCURATE') {
        fidelityNumerator += 1;
      }
    }

    const attribution = latestLabel(observation, 'ATTRIBUTION');
    if (attribution === undefined) {
      attributionReasons.push('ATTRIBUTION_UNASSESSED');
    } else if (attribution === 'NOT_ADDRESSED') {
      attributionReasons.push('ATTRIBUTION_NOT_ADDRESSED');
    } else if (attribution === 'NOT_ASSESSABLE') {
      attributionReasons.push('ATTRIBUTION_NOT_ASSESSABLE');
    } else {
      attributionDenominator += 1;
      attributionBreakdown[attribution] = (attributionBreakdown[attribution] ?? 0) + 1;
      if (attribution === 'CORRECT') {
        attributionNumerator += 1;
      }
    }
  }

  const byQuery: QueryCoverage[] = input.queries.map((query) => {
    const observations = input.observations.filter(
      (observation) => observation.queryId === query.id,
    );
    const eligible = observations.filter(
      (observation) => eligibility.get(observation.id)?.eligible === true,
    );
    let presenceAssessed = 0;
    let mentioned = 0;
    for (const observation of eligible) {
      const presence = latestLabel(observation, 'PRESENCE');
      if (presence === 'MENTIONED') {
        presenceAssessed += 1;
        mentioned += 1;
      } else if (presence === 'NOT_MENTIONED') {
        presenceAssessed += 1;
      }
    }
    let status: QueryCoverageStatus;
    if (eligible.length === 0) {
      status = 'UNTESTED';
    } else if (presenceAssessed === 0) {
      status = 'TESTED_UNASSESSED';
    } else if (mentioned > 0) {
      status = 'TESTED_COVERED';
    } else {
      status = 'TESTED_NOT_MENTIONED';
    }
    return {
      queryId: query.id,
      intent: query.intent,
      observations: observations.length,
      eligibleObservations: eligible.length,
      presenceAssessed,
      mentioned,
      status,
    };
  });

  const testedQueries = byQuery.filter((query) => query.status !== 'UNTESTED').length;
  const untestedQueries = byQuery.length - testedQueries;

  // The documented unit is the query intent, not the query row. Repeated prompts for one intent
  // are one group, and an entirely untested group is visible as such instead of disappearing into
  // a list of untested query rows.
  const intents = [...new Set(input.queries.map((query) => query.intent))];
  const byIntent: IntentCoverage[] = intents.map((intent) => {
    const intentQueries = byQuery.filter((query) => query.intent === intent);
    const observations = intentQueries.reduce((sum, query) => sum + query.observations, 0);
    const eligibleObservations = intentQueries.reduce(
      (sum, query) => sum + query.eligibleObservations,
      0,
    );
    const presenceAssessed = intentQueries.reduce((sum, query) => sum + query.presenceAssessed, 0);
    const mentioned = intentQueries.reduce((sum, query) => sum + query.mentioned, 0);
    const testedInGroup = intentQueries.filter((query) => query.status !== 'UNTESTED').length;
    const untestedInGroup = intentQueries.length - testedInGroup;
    const unassessedEligibleObservations = eligibleObservations - presenceAssessed;
    let status: IntentCoverageStatus;
    if (eligibleObservations === 0) {
      status = 'UNTESTED';
    } else if (presenceAssessed === 0) {
      status = 'TESTED_UNASSESSED';
    } else if (mentioned > 0) {
      status = 'TESTED_COVERED';
    } else {
      status = 'TESTED_NOT_MENTIONED';
    }
    return {
      intent,
      queries: intentQueries.length,
      testedQueries: testedInGroup,
      untestedQueries: untestedInGroup,
      observations,
      eligibleObservations,
      presenceAssessed,
      unassessedEligibleObservations,
      mentioned,
      status,
      partialAssessment: presenceAssessed > 0 && unassessedEligibleObservations > 0,
    };
  });

  const coveredIntents = byIntent.filter((intent) => intent.status === 'TESTED_COVERED').length;
  const notMentionedIntents = byIntent.filter(
    (intent) => intent.status === 'TESTED_NOT_MENTIONED',
  ).length;
  const unassessedIntents = byIntent.filter(
    (intent) => intent.status === 'TESTED_UNASSESSED',
  ).length;
  const untestedIntents = byIntent.filter((intent) => intent.status === 'UNTESTED').length;
  const includedIntents = coveredIntents + notMentionedIntents;
  const partialAssessmentIntents = byIntent.filter((intent) => intent.partialAssessment).length;

  const coverageMetric: MetricResult = {
    id: 'observed_answer_coverage',
    label: 'Observed answer-level coverage',
    definition:
      'Query-intent groups with at least one eligible observation assessed as mentioning the target, divided by query-intent groups with at least one eligible observation and an assessed presence result. Repeated queries for one intent count once. This is observed answer-level coverage, not internal retrieval coverage.',
    unit: 'query intents',
    numerator: includedIntents === 0 ? null : coveredIntents,
    denominator: includedIntents,
    value: rate(includedIntents === 0 ? null : coveredIntents, includedIntents),
    exclusions: countExclusions([
      ...(untestedIntents > 0
        ? (Array.from({ length: untestedIntents }, () => 'QUERY_UNTESTED') as ExclusionReason[])
        : []),
      ...(unassessedIntents > 0
        ? (Array.from(
            { length: unassessedIntents },
            () => 'QUERY_PRESENCE_UNASSESSED',
          ) as ExclusionReason[])
        : []),
    ]),
    breakdown: {
      COVERED: coveredIntents,
      TESTED_NOT_MENTIONED: notMentionedIntents,
    },
    notes: [
      'The unit is the query-intent group; repeated queries for one intent count once. Per-query detail is reported separately.',
      'Only intent groups with at least one eligible observation and an assessed presence result enter the denominator.',
      ...(partialAssessmentIntents > 0
        ? [
            `${partialAssessmentIntents} intent group(s) had some eligible observations without a presence assessment; each remains in the denominator because at least one eligible observation was assessed.`,
          ]
        : []),
      'Answer-level presence does not establish which retrieval steps a provider performed.',
    ],
  };

  const notes: string[] = [
    'Purposive manual sample; no confidence interval or universal visibility probability is calculated.',
    'Metrics are descriptive of the captured observations under the recorded conditions.',
    'No composite score is calculated; dimensions remain separate.',
  ];
  if (input.runStatus !== 'FINALIZED') {
    notes.push(`Preview only: the run is ${input.runStatus}, not FINALIZED.`);
  }

  return {
    version: METRICS_VERSION,
    runStatus: input.runStatus,
    coverage: {
      plannedQueries: input.queries.length,
      testedQueries,
      untestedQueries,
      observationsRecorded: input.observations.length,
      observationsVoided: voidedCount,
      eligibleObservations: eligibleCount,
      plannedIntents: byIntent.length,
      testedIntents: byIntent.length - untestedIntents,
      untestedIntents,
      coveredIntents,
      notMentionedIntents,
      unassessedIntents,
      partialAssessmentIntents,
      byIntent,
      exclusions: countExclusions(globalReasons),
      byQuery,
    },
    mentionRate: metric({
      id: 'mention_rate',
      label: 'Mention rate',
      definition:
        'Eligible completed observations whose answer mentions the target entity, divided by eligible completed observations with a presence assessment. Errors, refusals, abstentions, voided captures, and unassessed outputs are excluded and reported.',
      numerator: mentionNumerator,
      denominator: mentionDenominator,
      reasons: mentionReasons,
      breakdown: mentionBreakdown,
      notes: [
        'A mention does not imply endorsement, recommendation, factual accuracy, or citation.',
        'This rate is specific to the captured query set, provider configuration, date, and locale.',
      ],
    }),
    targetSourceCitationRate: metric({
      id: 'target_source_citation_rate',
      label: 'Target-source citation rate',
      definition:
        'Eligible completed observations citing at least one target-owned canonical source, divided by eligible completed observations with captured citation metadata. Observations whose interface did not show citations are excluded.',
      numerator: targetCitationNumerator,
      denominator: citationDenominator,
      reasons: targetCitationReasons,
      notes: [
        'A returned citation does not prove that the cited URL supports every assertion in the answer.',
        'Target-owned and independent citations are reported separately by design.',
      ],
    }),
    anySourceCitationRate: metric({
      id: 'any_source_citation_rate',
      label: 'Any-source citation rate',
      definition:
        'Eligible completed observations citing at least one source of any kind, divided by eligible completed observations with captured citation metadata.',
      numerator: anyCitationNumerator,
      denominator: citationDenominator,
      reasons: anyCitationReasons,
      notes: ['Citation presence is not citation support.'],
    }),
    citationSupportRate: metric({
      id: 'citation_support_rate',
      label: 'Citation support rate',
      definition:
        'Observations whose cited material materially supports the assessed answer claim, divided by eligible observations with captured citations, at least one active citation, and a definitive citation-support assessment. Partial support is reported separately and is not counted as supported.',
      numerator: citationSupportNumerator,
      denominator: citationSupportDenominator,
      reasons: citationSupportReasons,
      breakdown: citationSupportBreakdown,
      notes: [
        'Citation support is a human assessment of cited material against the answer claim.',
        'A citation may support only part of a multi-part statement.',
      ],
    }),
    claimFidelityRate: metric({
      id: 'claim_fidelity_rate',
      label: 'Claim fidelity rate',
      definition:
        'Eligible observations assessed accurate within scope, divided by eligible observations with a definitive fidelity assessment (accurate, partially accurate, contradicted, or unsupported by available evidence). Silence, refusals, voided captures, and not-assessable outputs are excluded.',
      numerator: fidelityNumerator,
      denominator: fidelityDenominator,
      reasons: fidelityReasons,
      breakdown: fidelityBreakdown,
      notes: [
        'Partial accuracy and contradiction counts are shown separately; they are not hidden in the rate.',
        'Silence is not scored as an incorrect statement.',
      ],
    }),
    attributionCorrectnessRate: metric({
      id: 'attribution_correctness_rate',
      label: 'Attribution correctness rate',
      definition:
        'Eligible observations assessed as correct attribution, divided by eligible observations where the answer attributes the accomplishment and a definitive attribution assessment exists (correct, partially correct, or incorrect). Answers that do not address attribution are excluded and reported.',
      numerator: attributionNumerator,
      denominator: attributionDenominator,
      reasons: attributionReasons,
      breakdown: attributionBreakdown,
      notes: [
        'A name mention is not counted as correct attribution unless the assessed role and source are correct.',
        'Identity, contribution, existence, and quality remain distinct dimensions.',
      ],
    }),
    observedAnswerCoverage: coverageMetric,
    notes,
  };
}
