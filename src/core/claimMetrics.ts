/**
 * Claim-level answer metrics (`metrics-v4`, ADR-019 as amended by ADR-023).
 *
 * ADR-019 introduced this block; ADR-023 fixed which statements may enter a denominator. Every
 * rate here is gated by src/core/claimEligibility.ts, so a recorded label can never promote a
 * non-assertion into a scored assertion.
 *
 * These measures describe individual statements the reviewer extracted from a captured answer. They
 * sit beside, and never inside, the observation-level rates: an answer can read as broadly accurate
 * while containing one contradicted statement, and collapsing the two would hide exactly that.
 */
import {
  ANSWER_CLAIM_VERSIONS,
  CLAIM_CITATION_SUPPORT_LABELS,
  isAssertingRelevance,
  type ClaimCitationSupportLabel,
  type ClaimRelevance,
} from './answerClaims.ts';
import {
  attributionEligibility,
  citationSupportEligibility,
  fidelityEligibility,
  isKnownRelevance,
  nonAssertionReason,
  omissionEligibility,
} from './claimEligibility.ts';
import { countExclusions, type ExclusionReason, type MetricResult } from './metricsCommon.ts';

export interface AnswerClaimPropositionInput {
  readonly propositionId: string;
  readonly relation: string;
}

/**
 * One claim-to-citation mapping, carrying the state of the cited record.
 *
 * `citationVoided` travels with the mapping because the mapping and the citation have separate
 * lifecycles: a citation can be withdrawn after a statement was linked to it, and a metric that
 * reads only the support label would keep scoring withdrawn material as support.
 */
export interface AnswerClaimCitationInput {
  readonly citationId: string;
  readonly support: ClaimCitationSupportLabel | string;
  readonly citationVoided: boolean;
}

export interface AnswerClaimInput {
  readonly claimId: string;
  readonly observationId: string;
  readonly revisionId: string;
  readonly relevance: ClaimRelevance | string;
  /** A voided statement stays in the record and contributes to no current metric. */
  readonly voided: boolean;
  /** Latest fidelity label recorded against the current revision, if any. */
  readonly fidelityLabel?: string | undefined;
  /** Latest attribution label recorded against the current revision, if any. */
  readonly attributionLabel?: string | undefined;
  /** Active claim-to-citation mappings, with the state of each cited record. */
  readonly citationMappings: readonly AnswerClaimCitationInput[];
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
  /**
   * Answers whose recorded statements are only part-way through fidelity review.
   *
   * Named for the work it measures. `metrics-v3` called this `partiallyDecomposedObservations`, but
   * it counted observations where some statements already carry a label and some do not — which is
   * review progress, not whether the answer was decomposed. Decomposition coverage is the separate
   * `decompositionCoverage` rate, and the counts below split the two apart instead of letting a
   * reader mistake reviewer effort for AI performance.
   */
  readonly partiallyAssessedObservations: number;
  readonly statementsRecorded: number;
  readonly statementsFidelityAssessed: number;
  readonly statementsAttributionAssessed: number;
  readonly citationMappingsRecorded: number;
  readonly citationMappingsAssessed: number;
  readonly unassessedClaims: number;
  readonly voidedClaims: number;
  /** Statements whose recorded label asserts more than their recorded relevance permits. */
  readonly labelConflictClaims: number;
  readonly claimFidelityRate: MetricResult;
  readonly claimContradictionRate: MetricResult;
  readonly claimUnsupportedRate: MetricResult;
  readonly claimCitationSupportRate: MetricResult;
  readonly claimAttributionRate: MetricResult;
  readonly relevantOmissionRate: MetricResult;
  readonly notes: readonly string[];
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
  // Decomposition coverage counts eligible observations that still hold a live statement. A voided
  // statement is history rather than a decomposed answer, so an observation whose only statement was
  // withdrawn must not read as covered.
  const observationsWithClaims = new Set(
    input.claims
      .filter((item) => !item.voided && eligible.has(item.observationId))
      .map((item) => item.observationId),
  );

  const globalReasons: ExclusionReason[] = [];
  for (const claim of input.claims) {
    if (!eligible.has(claim.observationId)) {
      globalReasons.push('CLAIM_OBSERVATION_INELIGIBLE');
    }
  }
  // Statements on an ineligible observation are outside scoring entirely. Voided statements stay in
  // this list on purpose: they must be excluded by every denominator, which is only honest if the
  // report can say that it happened and how many.
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
  const omissionReasons: ExclusionReason[] = [];
  let unassessedClaims = 0;
  let claimsWithNoAssertion = 0;
  let conflictingLabels = 0;
  let voidedClaims = 0;
  let statementsRecorded = 0;
  let statementsFidelityAssessed = 0;
  let statementsAttributionAssessed = 0;
  let citationMappingsRecorded = 0;
  let citationMappingsAssessed = 0;

  for (const claim of scoredClaims) {
    if (claim.voided) {
      voidedClaims += 1;
    } else {
      statementsRecorded += 1;
      if (claim.fidelityLabel !== undefined) {
        statementsFidelityAssessed += 1;
      }
      if (claim.attributionLabel !== undefined) {
        statementsAttributionAssessed += 1;
      }
      citationMappingsRecorded += claim.citationMappings.length;
      citationMappingsAssessed += claim.citationMappings.filter((mapping) =>
        CLAIM_CITATION_SUPPORT_LABELS.includes(mapping.support as ClaimCitationSupportLabel),
      ).length;
    }
    // One flag per statement, so a row whose fidelity and attribution both overstate the recorded
    // relevance is reported once. A conflict is a recording error the operator should see and fix,
    // not something the metric should silently resolve by preferring one field.
    let conflict = false;
    if (!claim.voided && isKnownRelevance(claim.relevance)) {
      const reason = nonAssertionReason(claim.relevance);
      if (reason !== null) {
        claimsWithNoAssertion += 1;
      }
    }

    // The pair is checked, not the relation alone. A statement recorded as unrelated cannot show
    // that anything was left unsaid, however its proposition link was labelled, so an inconsistent
    // link is excluded here instead of inflating the relevant-omission numerator.
    for (const relation of claim.propositionRelations) {
      const omission = omissionEligibility({
        relevance: claim.relevance,
        relation: relation.relation,
        voided: claim.voided,
      });
      if (omission.eligible) {
        propositionsRelated.add(relation.propositionId);
        if (relation.relation === 'OMITS_TARGET') {
          propositionsOmitted.add(relation.propositionId);
        }
      } else {
        if (omission.reason === 'CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE') {
          conflict = true;
        }
        omissionReasons.push(omission.reason as ExclusionReason);
      }
    }

    // Relevance decides whether an assertion exists; the label decides only what was asserted about
    // it. The order is the whole defect fix: a stale or mistyped label can no longer pull a refusal,
    // an omission or an unrelated row back into a factual denominator.
    const fidelity = fidelityEligibility({
      relevance: claim.relevance,
      fidelityLabel: claim.fidelityLabel,
      voided: claim.voided,
    });
    if (fidelity.eligible) {
      const label = claim.fidelityLabel as string;
      fidelityDenominator += 1;
      fidelityBreakdown[label] = (fidelityBreakdown[label] ?? 0) + 1;
      if (label === 'ACCURATE') {
        fidelityNumerator += 1;
      } else if (label === 'CONTRADICTED') {
        contradictionNumerator += 1;
      } else if (label === 'UNSUPPORTED') {
        unsupportedNumerator += 1;
      }
    } else {
      const reason = fidelity.reason as ExclusionReason;
      fidelityReasons.push(reason);
      if (
        !claim.voided &&
        (reason === 'CLAIM_FIDELITY_UNASSESSED' || reason === 'CLAIM_LABEL_INVALID')
      ) {
        unassessedClaims += 1;
      }
      if (reason === 'CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE') {
        conflict = true;
      }
    }

    const attribution = attributionEligibility({
      relevance: claim.relevance,
      attributionLabel: claim.attributionLabel,
      voided: claim.voided,
    });
    if (attribution.eligible) {
      const label = claim.attributionLabel as string;
      attributionDenominator += 1;
      attributionBreakdown[label] = (attributionBreakdown[label] ?? 0) + 1;
      if (label === 'CORRECT') {
        attributionNumerator += 1;
      }
    } else {
      const reason = attribution.reason as ExclusionReason;
      attributionReasons.push(reason);
      if (reason === 'CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE') {
        conflict = true;
      }
    }

    // Absence of a citation is only a gap when there was an assertion to support. A refusal with no
    // citation is a complete record, not a missing check.
    if (
      !claim.voided &&
      isKnownRelevance(claim.relevance) &&
      isAssertingRelevance(claim.relevance) &&
      claim.citationMappings.length === 0
    ) {
      citationReasons.push('CLAIM_NO_MAPPED_CITATION');
    }
    for (const mapping of claim.citationMappings) {
      const support = citationSupportEligibility({
        relevance: claim.relevance,
        support: mapping.support,
        citationVoided: mapping.citationVoided,
        claimVoided: claim.voided,
      });
      if (support.eligible) {
        const label = mapping.support as string;
        citationDenominator += 1;
        citationBreakdown[label] = (citationBreakdown[label] ?? 0) + 1;
        if (label === 'SUPPORTS') {
          citationNumerator += 1;
        }
      } else {
        if (support.reason === 'CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE') {
          conflict = true;
        }
        citationReasons.push(support.reason as ExclusionReason);
      }
    }
    if (conflict) {
      conflictingLabels += 1;
    }
  }

  const decompositionDenominator = eligible.size;
  const notes = [
    'Claim-level rates count statements the reviewer extracted, not answers. They can disagree with the observation-level rates for the same run; both are reported.',
    `Only ${observationsWithClaims.size} of ${eligible.size} eligible observations still hold a live statement, so these denominators describe decomposed answers rather than the whole sample.`,
    'Relevance decides whether a statement asserts anything. A refusal, abstention, omission, unrelated or unavailable statement is outside every factual denominator whatever label was recorded against it, and the reason names which kind it was.',
    'A label that contradicts the recorded relevance is excluded and reported as a conflict. It is never resolved by preferring the label, because a refusal scored as an accurate statement is the exact error this block exists to avoid.',
  ];
  notes.push(
    `Review progress, kept apart from every rate: ${statementsFidelityAssessed} of ${statementsRecorded} live statement(s) carry a fidelity assessment, ${statementsAttributionAssessed} carry an attribution assessment, and ${citationMappingsAssessed} of ${citationMappingsRecorded} citation mapping(s) carry a recorded support label. Finishing review moves these figures, not an answer's score.`,
  );
  if (claimsWithNoAssertion > 0) {
    notes.push(
      `${claimsWithNoAssertion} recorded statement(s) make no factual assertion about the target and are outside the fidelity, attribution and citation-support denominators.`,
    );
  }
  if (voidedClaims > 0) {
    notes.push(
      `${voidedClaims} statement(s) were voided by the reviewer. They stay in the record and the history and contribute to no current metric.`,
    );
  }
  if (conflictingLabels > 0) {
    notes.push(
      `${conflictingLabels} assessment(s) assert more than the recorded relevance supports. Correct either the relevance or the label; until then the statement is excluded and the conflict is visible here.`,
    );
  }

  return {
    decompositionVersion: ANSWER_CLAIM_VERSIONS.decomposition,
    observationsWithClaims: observationsWithClaims.size,
    eligibleObservations: eligible.size,
    partiallyAssessedObservations: countPartiallyAssessed(
      scoredClaims.filter((claim) => !claim.voided),
    ),
    statementsRecorded,
    statementsFidelityAssessed,
    statementsAttributionAssessed,
    citationMappingsRecorded,
    citationMappingsAssessed,
    unassessedClaims,
    voidedClaims,
    labelConflictClaims: conflictingLabels,
    decompositionCoverage: claimMetric({
      id: 'answer_decomposition_coverage',
      label: 'Answer decomposition coverage',
      definition:
        'Eligible completed observations with at least one live answer statement, divided by eligible completed observations. Read this before any other claim-level rate: a small denominator here means the claim-level figures describe a chosen subset of the answers.',
      unit: 'observations',
      numerator: observationsWithClaims.size,
      denominator: decompositionDenominator,
      reasons: globalReasons,
      notes: [
        'An observation without statements contributes to the denominator only, and is not evidence that the answer was wrong.',
        'Decomposition is human work; this coverage figure is a measure of reviewer effort as much as of the sample.',
        'Statements recorded against an ineligible observation are excluded here and from every other claim-level rate.',
        'An observation whose only statements were voided counts as not decomposed. The voided rows are still readable in the record and are reported as an exclusion elsewhere.',
      ],
    }),
    claimFidelityRate: claimMetric({
      id: 'answer_statement_fidelity_rate',
      label: 'Statement fidelity rate',
      definition:
        'Statements recorded as making a factual assertion about the target and assessed accurate within the recorded scope, divided by asserted statements carrying a definitive fidelity assessment (accurate, partially accurate, contradicted, or unsupported by recorded evidence). Refusals, abstentions, omissions, unrelated and unavailable statements, voided rows, and unassessed statements are excluded and each exclusion names its reason.',
      unit: 'answer statements',
      numerator: fidelityNumerator,
      denominator: fidelityDenominator,
      reasons: fidelityReasons,
      breakdown: fidelityBreakdown,
      notes: [
        'Accurate means accurate against the evidence the reviewer recorded, within the recorded scope. It is not independent verification.',
        'Partial accuracy and contradiction are shown separately and are not absorbed into this rate.',
        'Relevance decides whether a statement asserts anything at all, so a refusal cannot be counted as an accurate factual statement.',
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
      reasons:
        propositionsRelated.size === 0
          ? [...omissionReasons, 'CLAIM_NO_PROPOSITION_RELATION']
          : omissionReasons,
      notes: [
        'An omission is a visibility gap. It is not a contradiction and never enters a fidelity denominator.',
        'The unit is the proposition, so several answers omitting the same fact counts once.',
        'A proposition no statement relates to at all is absent from this measure, not counted as omitted.',
        'Only a statement that engages the target can record an omission. A link from an unrelated, ambiguous, refusing or unavailable statement is excluded here and reported as a conflict where the pair is inconsistent.',
      ],
    }),
    notes,
  };
}

/**
 * Answers part-way through fidelity review.
 *
 * The unit is the answer, and what it measures is whether the reviewer finished the statements that
 * were already recorded. It says nothing about the answer itself, which is why the name says review
 * rather than decomposition.
 */
function countPartiallyAssessed(claims: readonly AnswerClaimInput[]): number {
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
