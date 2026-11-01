/**
 * Claim-level answer metrics (`metrics-v3`, ADR-019).
 *
 * These measures describe individual statements the reviewer extracted from a captured answer. They
 * sit beside, and never inside, the observation-level rates: an answer can read as broadly accurate
 * while containing one contradicted statement, and collapsing the two would hide exactly that.
 */
import {
  ANSWER_CLAIM_VERSIONS,
  isAssertingAttributionLabel,
  isAssertingRelevance,
  isClaimAttributionLabel,
  isClaimFidelityLabel,
  type ClaimCitationSupportLabel,
  type ClaimFidelityLabel,
  type ClaimPropositionRelation,
  type ClaimRelevance,
} from './answerClaims.ts';
import { countExclusions, type ExclusionReason, type MetricResult } from './metricsCommon.ts';

export interface AnswerClaimPropositionInput {
  readonly propositionId: string;
  readonly relation: ClaimPropositionRelation | string;
}

export interface AnswerClaimInput {
  readonly claimId: string;
  readonly observationId: string;
  readonly revisionId: string;
  readonly relevance: ClaimRelevance | string;
  /** Latest fidelity label recorded against the current revision, if any. */
  readonly fidelityLabel?: string | undefined;
  /** Latest attribution label recorded against the current revision, if any. */
  readonly attributionLabel?: string | undefined;
  /** Support assessment of each active claim-to-citation mapping. */
  readonly citationSupports: readonly (ClaimCitationSupportLabel | string)[];
  readonly propositionRelations: readonly AnswerClaimPropositionInput[];
}

export interface ClaimLevelMetricsInput {
  readonly claims: readonly AnswerClaimInput[];
  /** Observations that are eligible for answer scoring under the run's own rules. */
  readonly eligibleObservationIds: readonly string[];
}

export interface ClaimLevelMetrics {
  readonly decompositionVersion: string;
  readonly observationsWithClaims: number;
  readonly eligibleObservations: number;
  readonly decompositionCoverage: MetricResult;
  readonly partiallyDecomposedObservations: number;
  readonly unassessedClaims: number;
  readonly claimFidelityRate: MetricResult;
  readonly claimContradictionRate: MetricResult;
  readonly claimUnsupportedRate: MetricResult;
  readonly claimCitationSupportRate: MetricResult;
  readonly claimAttributionRate: MetricResult;
  readonly relevantOmissionRate: MetricResult;
  readonly notes: readonly string[];
}

const FIDELITY_DEFINITIVE: readonly ClaimFidelityLabel[] = [
  'ACCURATE',
  'PARTIALLY_ACCURATE',
  'CONTRADICTED',
  'UNSUPPORTED',
];

const ATTRIBUTION_EXCLUSIONS: Record<string, ExclusionReason> = {
  NOT_ADDRESSED: 'CLAIM_ATTRIBUTION_NOT_ADDRESSED',
  NOT_ASSESSABLE: 'CLAIM_ATTRIBUTION_NOT_ASSESSABLE',
};

const CITATION_EXCLUSIONS: Record<string, ExclusionReason> = {
  UNCLEAR: 'CLAIM_CITATION_UNCLEAR',
  METADATA_MISSING: 'CLAIM_CITATION_METADATA_MISSING',
  NOT_ASSESSABLE: 'CLAIM_CITATION_NOT_ASSESSABLE',
};

function fidelityExclusionOf(label: string): ExclusionReason | null {
  switch (label) {
    case 'OMITTED':
      return 'CLAIM_OMITTED';
    case 'REFUSED':
      return 'CLAIM_REFUSED';
    case 'UNAVAILABLE':
      return 'CLAIM_UNAVAILABLE';
    case 'NOT_ADDRESSED':
      return 'CLAIM_NOT_ADDRESSED';
    case 'NOT_ASSESSABLE':
      return 'CLAIM_NOT_ASSESSABLE';
    default:
      return null;
  }
}

function claimMetric(input: {
  id: string;
  label: string;
  definition: string;
  unit: MetricResult['unit'];
  numerator: number;
  denominator: number;
  reasons: readonly ExclusionReason[];
  breakdown?: Record<string, number>;
  notes: readonly string[];
}): MetricResult {
  const hasUnit = input.denominator > 0;
  return {
    id: input.id,
    label: input.label,
    definition: input.definition,
    unit: input.unit,
    numerator: hasUnit ? input.numerator : null,
    denominator: input.denominator,
    value: hasUnit ? input.numerator / input.denominator : null,
    exclusions: countExclusions(input.reasons),
    ...(input.breakdown === undefined ? {} : { breakdown: input.breakdown }),
    notes: input.notes,
  };
}

/**
 * Compute the claim-level block. An input with no claims produces no block at all: a run whose
 * answers were never decomposed has no claim-level answer, which is different from a run whose
 * claims were all wrong.
 */
export function computeClaimLevelMetrics(input: ClaimLevelMetricsInput): ClaimLevelMetrics | null {
  if (input.claims.length === 0) {
    return null;
  }
  const eligible = new Set(input.eligibleObservationIds);
  // Decomposition coverage counts eligible observations only. An ineligible observation's statements
  // are outside scoring altogether, so counting them here would inflate the figure that tells a
  // reader how much of the sample the other claim-level rates describe.
  const observationsWithClaims = new Set(
    input.claims
      .filter((item) => eligible.has(item.observationId))
      .map((item) => item.observationId),
  );

  const globalReasons: ExclusionReason[] = [];
  for (const claim of input.claims) {
    if (!eligible.has(claim.observationId)) {
      globalReasons.push('CLAIM_OBSERVATION_INELIGIBLE');
    }
  }
  const scoredClaims = input.claims.filter((claim) => eligible.has(claim.observationId));

  let fidelityNumerator = 0;
  let fidelityDenominator = 0;
  let contradictionNumerator = 0;
  let unsupportedNumerator = 0;
  const fidelityReasons: ExclusionReason[] = [];
  const fidelityBreakdown: Record<string, number> = {
    ACCURATE: 0,
    PARTIALLY_ACCURATE: 0,
    CONTRADICTED: 0,
    UNSUPPORTED: 0,
  };

  let citationNumerator = 0;
  let citationDenominator = 0;
  const citationReasons: ExclusionReason[] = [];
  const citationBreakdown: Record<string, number> = {
    SUPPORTS: 0,
    PARTIALLY_SUPPORTS: 0,
    SUPPORTS_WITH_CONDITIONS: 0,
    DOES_NOT_SUPPORT: 0,
  };

  let attributionNumerator = 0;
  let attributionDenominator = 0;
  const attributionReasons: ExclusionReason[] = [];
  const attributionBreakdown: Record<string, number> = {
    CORRECT: 0,
    PARTIALLY_CORRECT: 0,
    WRONG_ROLE: 0,
    WRONG_PERSON: 0,
    AMBIGUOUS: 0,
    COLLABORATIVE_PARTIAL: 0,
    FALSE_SOLE_CREDIT: 0,
    UNATTRIBUTED: 0,
    INCORRECT: 0,
  };

  const propositionsRelated = new Set<string>();
  const propositionsOmitted = new Set<string>();
  let unassessedClaims = 0;
  let claimsWithNoAssertion = 0;

  for (const claim of scoredClaims) {
    // Relevance governs whether the statement asserts anything. A statement can be linked to a
    // proposition and still be a refusal or an omission, and the reviewer's relevance label is the
    // authority on that; proposition relations say which target is involved, not whether an
    // assertion was made.
    const asserting = isAssertingRelevance(claim.relevance as ClaimRelevance);
    if (!asserting) {
      // An unrelated, ambiguous, refusal, abstention or omission statement carries no factual
      // assertion about the target, so it cannot be scored for fidelity.
      claimsWithNoAssertion += 1;
    }

    for (const relation of claim.propositionRelations) {
      propositionsRelated.add(relation.propositionId);
      if (relation.relation === 'OMITS_TARGET') {
        propositionsOmitted.add(relation.propositionId);
      }
    }

    if (claim.fidelityLabel === undefined) {
      unassessedClaims += 1;
      fidelityReasons.push('CLAIM_FIDELITY_UNASSESSED');
    } else if (!isClaimFidelityLabel(claim.fidelityLabel)) {
      unassessedClaims += 1;
      fidelityReasons.push('CLAIM_LABEL_INVALID');
    } else {
      const exclusion = fidelityExclusionOf(claim.fidelityLabel);
      if (exclusion !== null) {
        fidelityReasons.push(exclusion);
      } else if (FIDELITY_DEFINITIVE.includes(claim.fidelityLabel)) {
        fidelityDenominator += 1;
        fidelityBreakdown[claim.fidelityLabel] = (fidelityBreakdown[claim.fidelityLabel] ?? 0) + 1;
        if (claim.fidelityLabel === 'ACCURATE') {
          fidelityNumerator += 1;
        } else if (claim.fidelityLabel === 'CONTRADICTED') {
          contradictionNumerator += 1;
        } else if (claim.fidelityLabel === 'UNSUPPORTED') {
          unsupportedNumerator += 1;
        }
      } else {
        fidelityReasons.push('CLAIM_NOT_ASSESSABLE');
      }
    }

    if (claim.attributionLabel === undefined) {
      attributionReasons.push('CLAIM_ATTRIBUTION_UNASSESSED');
    } else if (!isClaimAttributionLabel(claim.attributionLabel)) {
      attributionReasons.push('CLAIM_LABEL_INVALID');
    } else {
      const exclusion = ATTRIBUTION_EXCLUSIONS[claim.attributionLabel];
      if (exclusion !== undefined) {
        attributionReasons.push(exclusion);
      } else if (isAssertingAttributionLabel(claim.attributionLabel)) {
        attributionDenominator += 1;
        attributionBreakdown[claim.attributionLabel] =
          (attributionBreakdown[claim.attributionLabel] ?? 0) + 1;
        if (claim.attributionLabel === 'CORRECT') {
          attributionNumerator += 1;
        }
      } else {
        attributionReasons.push('CLAIM_ATTRIBUTION_UNASSESSED');
      }
    }

    if (claim.citationSupports.length === 0) {
      citationReasons.push('CLAIM_NO_MAPPED_CITATION');
    }
    for (const support of claim.citationSupports) {
      const exclusion = CITATION_EXCLUSIONS[support];
      if (exclusion !== undefined) {
        citationReasons.push(exclusion);
      } else if (
        support === 'SUPPORTS' ||
        support === 'PARTIALLY_SUPPORTS' ||
        support === 'SUPPORTS_WITH_CONDITIONS' ||
        support === 'DOES_NOT_SUPPORT'
      ) {
        citationDenominator += 1;
        citationBreakdown[support] = (citationBreakdown[support] ?? 0) + 1;
        if (support === 'SUPPORTS') {
          citationNumerator += 1;
        }
      }
    }
  }

  const decompositionDenominator = eligible.size;
  const notes = [
    'Claim-level rates count statements the reviewer extracted, not answers. They can disagree with the observation-level rates for the same run; both are reported.',
    `Only ${observationsWithClaims.size} of ${eligible.size} eligible observations had any statement recorded, so these denominators describe decomposed answers rather than the whole sample.`,
    'A refusal, abstention, omission, unavailable answer, or unassessed statement is excluded with a named reason and never counted as an inaccurate statement.',
  ];
  if (claimsWithNoAssertion > 0) {
    notes.push(
      `${claimsWithNoAssertion} recorded statement(s) make no factual assertion about the target and are outside the fidelity denominator.`,
    );
  }

  return {
    decompositionVersion: ANSWER_CLAIM_VERSIONS.decomposition,
    observationsWithClaims: observationsWithClaims.size,
    eligibleObservations: eligible.size,
    partiallyDecomposedObservations: countPartiallyDecomposed(scoredClaims),
    unassessedClaims,
    decompositionCoverage: claimMetric({
      id: 'answer_decomposition_coverage',
      label: 'Answer decomposition coverage',
      definition:
        'Eligible completed observations with at least one recorded answer statement, divided by eligible completed observations. Read this before any other claim-level rate: a small denominator here means the claim-level figures describe a chosen subset of the answers.',
      unit: 'observations',
      numerator: observationsWithClaims.size,
      denominator: decompositionDenominator,
      reasons: globalReasons,
      notes: [
        'An observation without statements contributes to the denominator only, and is not evidence that the answer was wrong.',
        'Decomposition is human work; this coverage figure is a measure of reviewer effort as much as of the sample.',
        'Statements recorded against an ineligible observation are excluded here and from every other claim-level rate.',
      ],
    }),
    claimFidelityRate: claimMetric({
      id: 'answer_statement_fidelity_rate',
      label: 'Statement fidelity rate',
      definition:
        'Recorded statements assessed accurate within the recorded scope, divided by statements with a definitive fidelity assessment (accurate, partially accurate, contradicted, or unsupported by recorded evidence). Omissions, refusals, unavailable checks, non-assertions, and unassessed statements are excluded and reported.',
      unit: 'answer statements',
      numerator: fidelityNumerator,
      denominator: fidelityDenominator,
      reasons: fidelityReasons,
      breakdown: fidelityBreakdown,
      notes: [
        'Accurate means accurate against the evidence the reviewer recorded, within the recorded scope. It is not independent verification.',
        'Partial accuracy and contradiction are shown separately and are not absorbed into this rate.',
      ],
    }),
    claimContradictionRate: claimMetric({
      id: 'answer_statement_contradiction_rate',
      label: 'Statement contradiction rate',
      definition:
        'Statements assessed contradicted by recorded evidence, divided by statements with a definitive fidelity assessment. Reported separately so a favourable fidelity rate cannot conceal recorded contradictions.',
      unit: 'answer statements',
      numerator: contradictionNumerator,
      denominator: fidelityDenominator,
      reasons: fidelityReasons,
      notes: [
        'A recorded contradiction describes the answer against the reviewer’s record, not a proven fact.',
        'The denominator is shared with the statement fidelity rate so the two can be read together.',
      ],
    }),
    claimUnsupportedRate: claimMetric({
      id: 'answer_statement_unsupported_rate',
      label: 'Statement unsupported rate',
      definition:
        'Statements assessed unsupported by the recorded evidence, divided by statements with a definitive fidelity assessment. Absence of recorded support is not treated as contradiction.',
      unit: 'answer statements',
      numerator: unsupportedNumerator,
      denominator: fidelityDenominator,
      reasons: fidelityReasons,
      notes: ['Unsupported is an evidence gap, not a negative verdict on the statement.'],
    }),
    claimCitationSupportRate: claimMetric({
      id: 'answer_statement_citation_support_rate',
      label: 'Statement citation support rate',
      definition:
        'Claim-to-citation mappings assessed as supported by the cited material, divided by mappings with a definitive assessment. Partial support and support only under conditions stay in the denominator and are shown separately, never folded into supported.',
      unit: 'claim-citation mappings',
      numerator: citationNumerator,
      denominator: citationDenominator,
      reasons: citationReasons,
      breakdown: citationBreakdown,
      notes: [
        'This measures whether cited material supports a specific statement. Citation presence is not citation support.',
        'One citation mapped to several statements is assessed once per statement, so a shared citation is visible rather than averaged away.',
      ],
    }),
    claimAttributionRate: claimMetric({
      id: 'answer_statement_attribution_rate',
      label: 'Statement attribution rate',
      definition:
        'Statements assessed as correctly attributed (party and contribution role), divided by statements where the answer made an attribution claim with a definitive assessment. Wrong role, wrong person, ambiguity, incomplete collaborative credit, false sole credit, and unattributed statements are broken out separately.',
      unit: 'answer statements',
      numerator: attributionNumerator,
      denominator: attributionDenominator,
      reasons: attributionReasons,
      breakdown: attributionBreakdown,
      notes: [
        'Correct attribution is the reviewer’s record of the answer’s wording against the evidence held. It establishes no legal authorship or ownership.',
        'A name appearing in an answer is not counted as attribution unless the statement actually credits a contribution.',
      ],
    }),
    relevantOmissionRate: claimMetric({
      id: 'relevant_omission_rate',
      label: 'Relevant omission rate',
      definition:
        'Target propositions a recorded statement relates to as omitted, divided by target propositions any recorded statement relates to. This describes what the captured answers left unsaid, not whether the underlying fact is true.',
      unit: 'propositions',
      numerator: propositionsOmitted.size,
      denominator: propositionsRelated.size,
      reasons: propositionsRelated.size === 0 ? ['CLAIM_NO_PROPOSITION_RELATION'] : [],
      notes: [
        'An omission is a visibility gap. It is not a contradiction and never enters a fidelity denominator.',
        'The unit is the proposition, so several answers omitting the same fact counts once.',
        'A proposition no statement relates to at all is absent from this measure, not counted as omitted.',
      ],
    }),
    notes,
  };
}

function countPartiallyDecomposed(claims: readonly AnswerClaimInput[]): number {
  const byObservation = new Map<string, { unassessed: number; assessed: number }>();
  for (const claim of claims) {
    const entry = byObservation.get(claim.observationId) ?? { unassessed: 0, assessed: 0 };
    if (claim.fidelityLabel === undefined) {
      entry.unassessed += 1;
    } else {
      entry.assessed += 1;
    }
    byObservation.set(claim.observationId, entry);
  }
  let partial = 0;
  for (const entry of byObservation.values()) {
    if (entry.unassessed > 0 && entry.assessed > 0) {
      partial += 1;
    }
  }
  return partial;
}
