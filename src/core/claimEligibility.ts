/**
 * The claim-level eligibility contract (`metrics-v4`, ADR-023).
 *
 * `metrics-v3` recorded a relevance for every statement and a label for every axis, but the metric
 * calculation only looked at the label. A statement filed as a refusal that also carried an
 * `ACCURATE` fidelity assessment was counted as an accurate factual statement, because nothing
 * decided which of the two fields governs. This module is that decision, written down once, so the
 * validator, the repository, the database trigger and the calculation all enforce the same rule
 * instead of each inventing one.
 *
 * The rule in one sentence: **relevance decides whether an assertion was made; the label decides
 * only what was asserted about it.** A label can never promote a non-assertion into a scored
 * assertion, and a non-assertion is excluded with a reason that names which kind it was.
 */
import {
  CLAIM_RELEVANCES,
  isAssertingRelevance,
  isClaimAttributionLabel,
  isClaimFidelityLabel,
  type ClaimAttributionLabel,
  type ClaimCitationSupportLabel,
  type ClaimFidelityLabel,
  type ClaimPropositionRelation,
  type ClaimRelevance,
} from './answerClaims.ts';
import type { ExclusionReason } from './metricsCommon.ts';

/**
 * Why one unit left a denominator. `excluded` is the operative answer; `reason` is what a report
 * must be able to print, and `explanation` is the sentence for a reader who asks why.
 */
export interface EligibilityDecision {
  readonly eligible: boolean;
  readonly reason: ExclusionReason | null;
  readonly explanation: string;
}

/**
 * Relevance values that engage the evaluation target closely enough that a statement carrying them
 * can record something the answer left unsaid.
 *
 * `OMISSION` is here because it is the reviewer's own record of a gap, which is the one case the
 * measure is built for. The four asserting values are here because an answer that addresses a
 * target can still leave part of it out. `UNRELATED`, `AMBIGUOUS`, `DOES_NOT_ADDRESS`, `REFUSAL`,
 * `ABSTENTION`, `UNAVAILABLE` and `NOT_ASSESSABLE` are absent: a statement that never engaged the
 * target cannot establish that the target was omitted from it.
 */
const TARGET_ENGAGING_RELEVANCES: readonly ClaimRelevance[] = [
  'ADDRESSES',
  'PARTIALLY_ADDRESSES',
  'QUALIFIES',
  'CONTRADICTS',
  'OMISSION',
];

/**
 * The reason a non-asserting relevance gives for leaving a factual denominator.
 *
 * Each value maps to the reason that names it, so a report can distinguish "the answer refused" from
 * "the answer was unrelated" instead of collapsing both into one unexplained gap. Asserting values
 * map to `null`: they belong in the denominator.
 */
const NON_ASSERTION_REASONS: Record<ClaimRelevance, ExclusionReason | null> = {
  ADDRESSES: null,
  PARTIALLY_ADDRESSES: null,
  QUALIFIES: null,
  CONTRADICTS: null,
  DOES_NOT_ADDRESS: 'CLAIM_NOT_ADDRESSED',
  AMBIGUOUS: 'CLAIM_AMBIGUOUS',
  UNRELATED: 'CLAIM_UNRELATED',
  REFUSAL: 'CLAIM_REFUSED',
  ABSTENTION: 'CLAIM_ABSTENTION',
  OMISSION: 'CLAIM_OMITTED',
  UNAVAILABLE: 'CLAIM_UNAVAILABLE',
  NOT_ASSESSABLE: 'CLAIM_NOT_ASSESSABLE',
};

/**
 * Fidelity labels that may be recorded against each relevance.
 *
 * A non-asserting relevance admits only labels that assert nothing: `NOT_ADDRESSED`,
 * `NOT_ASSESSABLE`, and the one label that names its own kind of non-assertion (`REFUSED` for a
 * refusal, `OMITTED` for an omission, `UNAVAILABLE` for unavailable content). The four definitive
 * labels are unreachable from those rows, which is exactly what stops a refusal being scored as an
 * accurate statement.
 */
const PERMITTED_FIDELITY: Record<ClaimRelevance, readonly ClaimFidelityLabel[]> = {
  ADDRESSES: ['ACCURATE', 'PARTIALLY_ACCURATE', 'CONTRADICTED', 'UNSUPPORTED', 'NOT_ASSESSABLE'],
  PARTIALLY_ADDRESSES: [
    'ACCURATE',
    'PARTIALLY_ACCURATE',
    'CONTRADICTED',
    'UNSUPPORTED',
    'NOT_ASSESSABLE',
  ],
  QUALIFIES: ['ACCURATE', 'PARTIALLY_ACCURATE', 'CONTRADICTED', 'UNSUPPORTED', 'NOT_ASSESSABLE'],
  CONTRADICTS: ['ACCURATE', 'PARTIALLY_ACCURATE', 'CONTRADICTED', 'UNSUPPORTED', 'NOT_ASSESSABLE'],
  DOES_NOT_ADDRESS: ['NOT_ADDRESSED', 'NOT_ASSESSABLE'],
  UNRELATED: ['NOT_ADDRESSED', 'NOT_ASSESSABLE'],
  AMBIGUOUS: ['NOT_ADDRESSED', 'NOT_ASSESSABLE'],
  REFUSAL: ['REFUSED', 'NOT_ADDRESSED', 'NOT_ASSESSABLE'],
  ABSTENTION: ['NOT_ADDRESSED', 'NOT_ASSESSABLE'],
  OMISSION: ['OMITTED', 'NOT_ADDRESSED', 'NOT_ASSESSABLE'],
  UNAVAILABLE: ['UNAVAILABLE', 'NOT_ADDRESSED', 'NOT_ASSESSABLE'],
  NOT_ASSESSABLE: ['NOT_ASSESSABLE'],
};

/**
 * The reason each non-definitive fidelity label gives for staying outside the denominator.
 *
 * A label that names its own kind of gap is more useful to a reader than a single "excluded" bucket,
 * which is why an omission and an unavailable check are reported apart from each other.
 */
const NON_DEFINITIVE_FIDELITY_REASONS: Record<string, ExclusionReason> = {
  OMITTED: 'CLAIM_OMITTED',
  REFUSED: 'CLAIM_REFUSED',
  UNAVAILABLE: 'CLAIM_UNAVAILABLE',
  NOT_ADDRESSED: 'CLAIM_NOT_ADDRESSED',
  NOT_ASSESSABLE: 'CLAIM_NOT_ASSESSABLE',
};

/**
 * Attribution labels that may be recorded against each relevance.
 *
 * Only the four asserting values can carry a credit claim: a statement that refuses, hedges, is
 * unrelated, is ambiguous about its referent, or records a gap makes no claim about who did what, so
 * `NOT_ADDRESSED` or `NOT_ASSESSABLE` are the only honest entries.
 */
const ASSERTING_FOR_ATTRIBUTION: readonly ClaimRelevance[] = [
  'ADDRESSES',
  'PARTIALLY_ADDRESSES',
  'QUALIFIES',
  'CONTRADICTS',
];

const NON_ASSERTING_ATTRIBUTION: readonly ClaimAttributionLabel[] = [
  'NOT_ADDRESSED',
  'NOT_ASSESSABLE',
];

/**
 * Support labels that may be recorded against a claim-to-citation mapping for each relevance.
 *
 * Support is a judgement that cited material backs an assertion. With no assertion there is nothing
 * to back, so a non-asserting statement can only record that the material was unclear, absent, or
 * unassessable.
 */
const NON_ASSERTING_SUPPORT: readonly ClaimCitationSupportLabel[] = [
  'UNCLEAR',
  'METADATA_MISSING',
  'NOT_ASSESSABLE',
];

/**
 * Proposition relations that may be recorded for each relevance.
 *
 * This is the table that stops an inconsistent link manufacturing a result. `OMITS_TARGET` is
 * reachable only from `PARTIALLY_ADDRESSES` (the answer covered part of a proposition and left the
 * rest out) and `OMISSION` (the reviewer's own record of a gap). `UNRELATED`, `AMBIGUOUS`,
 * `REFUSAL`, `ABSTENTION` and `DOES_NOT_ADDRESS` therefore cannot contribute an omission, and
 * `NOT_ASSESSABLE_TARGET` is always available because "the reviewer could not tell" is a legitimate
 * answer to any pairing.
 */
const PERMITTED_RELATIONS: Record<ClaimRelevance, readonly ClaimPropositionRelation[]> = {
  ADDRESSES: ['SUPPORTS_TARGET', 'CONTRADICTS_TARGET', 'QUALIFIES_TARGET', 'NOT_ASSESSABLE_TARGET'],
  PARTIALLY_ADDRESSES: [
    'PARTIALLY_SUPPORTS_TARGET',
    'SUPPORTS_TARGET',
    'QUALIFIES_TARGET',
    'CONTRADICTS_TARGET',
    'OMITS_TARGET',
    'NOT_ASSESSABLE_TARGET',
  ],
  QUALIFIES: [
    'QUALIFIES_TARGET',
    'SUPPORTS_TARGET',
    'PARTIALLY_SUPPORTS_TARGET',
    'NOT_ASSESSABLE_TARGET',
  ],
  CONTRADICTS: ['CONTRADICTS_TARGET', 'QUALIFIES_TARGET', 'NOT_ASSESSABLE_TARGET'],
  DOES_NOT_ADDRESS: ['DOES_NOT_ADDRESS_TARGET', 'NOT_ASSESSABLE_TARGET'],
  UNRELATED: ['DOES_NOT_ADDRESS_TARGET', 'NOT_ASSESSABLE_TARGET'],
  AMBIGUOUS: ['AMBIGUOUS_TARGET', 'DOES_NOT_ADDRESS_TARGET', 'NOT_ASSESSABLE_TARGET'],
  REFUSAL: ['REFUSES_TARGET', 'DOES_NOT_ADDRESS_TARGET', 'NOT_ASSESSABLE_TARGET'],
  ABSTENTION: ['ABSTAINS_TARGET', 'DOES_NOT_ADDRESS_TARGET', 'NOT_ASSESSABLE_TARGET'],
  OMISSION: ['OMITS_TARGET', 'DOES_NOT_ADDRESS_TARGET', 'NOT_ASSESSABLE_TARGET'],
  UNAVAILABLE: ['DOES_NOT_ADDRESS_TARGET', 'NOT_ASSESSABLE_TARGET'],
  NOT_ASSESSABLE: ['NOT_ASSESSABLE_TARGET', 'DOES_NOT_ADDRESS_TARGET'],
};

/**
 * The decision a non-asserting relevance forces, or `null` when that value does carry an assertion.
 *
 * Returning `null` for an asserting value is the point: the caller must not be able to read
 * "not eligible" out of a row that was never a rejection.
 */
function nonAssertionDecision(relevance: ClaimRelevance): EligibilityDecision | null {
  const reason = NON_ASSERTION_REASONS[relevance];
  if (reason === null) {
    return null;
  }
  return {
    eligible: false,
    reason,
    explanation: `The statement is recorded as ${relevance.toLowerCase()}, which makes no factual assertion about the target, so it is outside the denominator.`,
  };
}

const ELIGIBLE: EligibilityDecision = {
  eligible: true,
  reason: null,
  explanation: 'The recorded statement makes an assertion that this axis can score.',
};

function notAssessed(): EligibilityDecision {
  return {
    eligible: false,
    reason: 'CLAIM_FIDELITY_UNASSESSED',
    explanation: 'No fidelity assessment was recorded for this statement.',
  };
}

/** Whether a statement's relevance engages the target at all. */
export function engagesTarget(relevance: ClaimRelevance): boolean {
  return TARGET_ENGAGING_RELEVANCES.includes(relevance);
}

/** The exclusion reason a non-asserting relevance produces, or `null` when the value does assert. */
export function nonAssertionReason(relevance: ClaimRelevance): ExclusionReason | null {
  return NON_ASSERTION_REASONS[relevance] ?? null;
}

/**
 * Fidelity labels that may legitimately be recorded for a relevance.
 *
 * Exported so the form, the repository guard, the database trigger and the tests all read one list
 * rather than each restating it.
 */
export function permittedFidelityLabels(relevance: ClaimRelevance): readonly ClaimFidelityLabel[] {
  return PERMITTED_FIDELITY[relevance] ?? ['NOT_ASSESSABLE'];
}

export function permittedAttributionLabels(
  relevance: ClaimRelevance,
): readonly ClaimAttributionLabel[] {
  return ASSERTING_FOR_ATTRIBUTION.includes(relevance)
    ? [
        'CORRECT',
        'PARTIALLY_CORRECT',
        'WRONG_ROLE',
        'WRONG_PERSON',
        'AMBIGUOUS',
        'COLLABORATIVE_PARTIAL',
        'FALSE_SOLE_CREDIT',
        'UNATTRIBUTED',
        'INCORRECT',
        ...NON_ASSERTING_ATTRIBUTION,
      ]
    : NON_ASSERTING_ATTRIBUTION;
}

export function permittedCitationSupportLabels(
  relevance: ClaimRelevance,
): readonly ClaimCitationSupportLabel[] {
  return isAssertingRelevance(relevance)
    ? [
        'SUPPORTS',
        'PARTIALLY_SUPPORTS',
        'SUPPORTS_WITH_CONDITIONS',
        'DOES_NOT_SUPPORT',
        ...NON_ASSERTING_SUPPORT,
      ]
    : NON_ASSERTING_SUPPORT;
}

export function permittedPropositionRelations(
  relevance: ClaimRelevance,
): readonly ClaimPropositionRelation[] {
  return PERMITTED_RELATIONS[relevance] ?? ['NOT_ASSESSABLE_TARGET'];
}

/**
 * Whether a proposition relation is consistent with the relevance recorded on the same statement.
 *
 * The pair is the unit of review: the relevance says how the answer engages the target and the
 * relation says how it engages *this* proposition. An inconsistent pair is a recording error, not a
 * judgement, and it must not be allowed to reach a metric.
 */
export function isRelationConsistentWithRelevance(
  relevance: ClaimRelevance,
  relation: ClaimPropositionRelation,
): boolean {
  return permittedPropositionRelations(relevance).includes(relation);
}

export function isFidelityConsistentWithRelevance(
  relevance: ClaimRelevance,
  label: ClaimFidelityLabel,
): boolean {
  return permittedFidelityLabels(relevance).includes(label);
}

export function isAttributionConsistentWithRelevance(
  relevance: ClaimRelevance,
  label: ClaimAttributionLabel,
): boolean {
  return permittedAttributionLabels(relevance).includes(label);
}

export function isSupportConsistentWithRelevance(
  relevance: ClaimRelevance,
  support: ClaimCitationSupportLabel,
): boolean {
  return permittedCitationSupportLabels(relevance).includes(support);
}

/**
 * Is this statement inside the fidelity denominator?
 *
 * Order matters and is deliberate. A voided statement leaves first, because its own record is no
 * longer part of the current evaluation. An unrecognised relevance leaves next, because nothing can
 * be derived from a value outside the vocabulary. Then relevance decides whether an assertion
 * exists, and only then is the label consulted — so a stale or mistyped label can never pull a
 * non-assertion back in. A definitive label on a non-asserting statement is reported as a conflict
 * rather than dropped quietly, because the operator needs to know the record is inconsistent.
 */
export function fidelityEligibility(input: {
  readonly relevance: ClaimRelevance | string;
  readonly fidelityLabel?: string | undefined;
  readonly voided: boolean;
}): EligibilityDecision {
  if (input.voided) {
    return {
      eligible: false,
      reason: 'CLAIM_VOIDED',
      explanation:
        'The reviewer voided this statement. It stays in the record and the history, and contributes to no current metric.',
    };
  }
  if (!isKnownRelevance(input.relevance)) {
    return {
      eligible: false,
      reason: 'CLAIM_LABEL_INVALID',
      explanation:
        'The recorded relevance is outside the vocabulary, so nothing can be derived from this statement.',
    };
  }
  const relevance = input.relevance as ClaimRelevance;
  if (input.fidelityLabel === undefined) {
    return notAssessed();
  }
  if (!isClaimFidelityLabel(input.fidelityLabel)) {
    return {
      eligible: false,
      reason: 'CLAIM_LABEL_INVALID',
      explanation:
        'The stored fidelity label does not belong to the fidelity axis, so it is reported rather than trusted.',
    };
  }
  const rejection = nonAssertionDecision(relevance);
  if (rejection !== null) {
    if (isDefinitiveFidelityLabel(input.fidelityLabel)) {
      return {
        eligible: false,
        reason: 'CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE',
        explanation: `The statement is recorded as ${relevance.toLowerCase()} but carries a ${input.fidelityLabel} fidelity assessment. Relevance governs, so it is excluded, and the conflict is reported for correction.`,
      };
    }
    return rejection;
  }
  if (!isFidelityConsistentWithRelevance(relevance, input.fidelityLabel)) {
    return {
      eligible: false,
      reason: 'CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE',
      explanation: `A ${input.fidelityLabel} fidelity assessment is not reachable from a statement recorded as ${relevance.toLowerCase()}.`,
    };
  }
  // Consistent is not the same as scorable. `NOT_ASSESSABLE` is the honest label for an answer that
  // addressed the target and still cannot be judged, and it must widen the recorded unknowns rather
  // than join the denominator and pull the rate down.
  if (!isDefinitiveFidelityLabel(input.fidelityLabel)) {
    return {
      eligible: false,
      reason: NON_DEFINITIVE_FIDELITY_REASONS[input.fidelityLabel] ?? 'CLAIM_NOT_ASSESSABLE',
      explanation:
        'This fidelity label records a gap, a refusal, an omission or an unknown rather than a verdict, so it stays outside the denominator.',
    };
  }
  return ELIGIBLE;
}

/**
 * Is this statement's attribution assessment inside the attribution denominator?
 *
 * The axis has its own non-assertion labels, so a statement can be relevant to the target and still
 * make no credit claim. Relevance is checked first because it is the stronger statement: an answer
 * that refused cannot also have credited somebody.
 */
export function attributionEligibility(input: {
  readonly relevance: ClaimRelevance | string;
  readonly attributionLabel?: string | undefined;
  readonly voided: boolean;
}): EligibilityDecision {
  if (input.voided) {
    return {
      eligible: false,
      reason: 'CLAIM_VOIDED',
      explanation:
        'The reviewer voided this statement, so its attribution is not part of the current result.',
    };
  }
  if (!isKnownRelevance(input.relevance)) {
    return {
      eligible: false,
      reason: 'CLAIM_LABEL_INVALID',
      explanation: 'The recorded relevance is outside the vocabulary.',
    };
  }
  const relevance = input.relevance as ClaimRelevance;
  if (!isAssertingRelevance(relevance)) {
    return {
      eligible: false,
      reason: nonAssertionReason(relevance) ?? 'CLAIM_ATTRIBUTION_NOT_ADDRESSED',
      explanation: `The statement is recorded as ${relevance.toLowerCase()}, so it credits no contribution.`,
    };
  }
  if (input.attributionLabel === undefined) {
    return {
      eligible: false,
      reason: 'CLAIM_ATTRIBUTION_UNASSESSED',
      explanation: 'No attribution assessment was recorded for this statement.',
    };
  }
  if (!isClaimAttributionLabel(input.attributionLabel)) {
    return {
      eligible: false,
      reason: 'CLAIM_LABEL_INVALID',
      explanation: 'The stored label does not belong to the attribution axis.',
    };
  }
  if (!isAttributionConsistentWithRelevance(relevance, input.attributionLabel)) {
    return {
      eligible: false,
      reason: 'CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE',
      explanation: `A ${input.attributionLabel} attribution assessment is not reachable from a statement recorded as ${relevance.toLowerCase()}.`,
    };
  }
  if (input.attributionLabel === 'NOT_ADDRESSED' || input.attributionLabel === 'NOT_ASSESSABLE') {
    return {
      eligible: false,
      reason:
        input.attributionLabel === 'NOT_ADDRESSED'
          ? 'CLAIM_ATTRIBUTION_NOT_ADDRESSED'
          : 'CLAIM_ATTRIBUTION_NOT_ASSESSABLE',
      explanation:
        'The answer made no credit claim in this statement, or the reviewer could not judge one. Silence about credit is not incorrect credit.',
    };
  }
  return ELIGIBLE;
}

/**
 * Is this claim-to-citation mapping inside the citation-support denominator?
 *
 * A voided citation is excluded even though the mapping row is kept, because the reviewer withdrew
 * the cited material. Excluding it with a named reason is what keeps a withdrawn source from
 * silently continuing to count as support, and keeps the mapping inspectable as history.
 */
export function citationSupportEligibility(input: {
  readonly relevance: ClaimRelevance | string;
  readonly support: ClaimCitationSupportLabel | string;
  readonly citationVoided: boolean;
  readonly claimVoided: boolean;
}): EligibilityDecision {
  if (input.claimVoided) {
    return {
      eligible: false,
      reason: 'CLAIM_VOIDED',
      explanation: 'The statement this mapping belongs to was voided.',
    };
  }
  if (input.citationVoided) {
    return {
      eligible: false,
      reason: 'CLAIM_CITATION_VOIDED',
      explanation:
        'The cited record was voided after this mapping was recorded. The mapping stays in the history and supports nothing in the current result.',
    };
  }
  if (!isKnownRelevance(input.relevance)) {
    return {
      eligible: false,
      reason: 'CLAIM_LABEL_INVALID',
      explanation: 'The recorded relevance is outside the vocabulary.',
    };
  }
  const relevance = input.relevance as ClaimRelevance;
  if (!isAssertingRelevance(relevance)) {
    return {
      eligible: false,
      reason: 'CLAIM_CITATION_NON_ASSERTING',
      explanation: `The statement is recorded as ${relevance.toLowerCase()} and asserts nothing, so no citation can support it.`,
    };
  }
  if (
    input.support !== 'SUPPORTS' &&
    input.support !== 'PARTIALLY_SUPPORTS' &&
    input.support !== 'SUPPORTS_WITH_CONDITIONS' &&
    input.support !== 'DOES_NOT_SUPPORT'
  ) {
    return {
      eligible: false,
      reason:
        input.support === 'UNCLEAR'
          ? 'CLAIM_CITATION_UNCLEAR'
          : input.support === 'METADATA_MISSING'
            ? 'CLAIM_CITATION_METADATA_MISSING'
            : input.support === 'NOT_ASSESSABLE'
              ? 'CLAIM_CITATION_NOT_ASSESSABLE'
              : 'CLAIM_LABEL_INVALID',
      explanation:
        'This support label records an unavailable or unresolved check rather than a verdict about the cited material.',
    };
  }
  if (!isSupportConsistentWithRelevance(relevance, input.support as ClaimCitationSupportLabel)) {
    return {
      eligible: false,
      reason: 'CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE',
      explanation: `A ${input.support} support assessment is not reachable from a statement recorded as ${relevance.toLowerCase()}.`,
    };
  }
  return ELIGIBLE;
}

/**
 * Does this proposition link participate in the relevant-omission measure?
 *
 * The pair is checked, not just the relation, because that is the defect this closes: a statement
 * recorded as unrelated cannot establish that anything was omitted, however its link row is labelled.
 */
export function omissionEligibility(input: {
  readonly relevance: ClaimRelevance | string;
  readonly relation: ClaimPropositionRelation | string;
  readonly voided: boolean;
}): EligibilityDecision {
  if (input.voided) {
    return {
      eligible: false,
      reason: 'CLAIM_VOIDED',
      explanation: 'The statement carrying this proposition link was voided.',
    };
  }
  if (!isKnownRelevance(input.relevance)) {
    return {
      eligible: false,
      reason: 'CLAIM_LABEL_INVALID',
      explanation: 'The recorded relevance is outside the vocabulary.',
    };
  }
  const relevance = input.relevance as ClaimRelevance;
  if (!engagesTarget(relevance)) {
    return {
      eligible: false,
      reason: 'CLAIM_OMISSION_NON_ENGAGING',
      explanation: `The statement is recorded as ${relevance.toLowerCase()}, which does not engage the target, so it cannot show that anything was left unsaid.`,
    };
  }
  if (!isRelationConsistentWithRelevance(relevance, input.relation as ClaimPropositionRelation)) {
    return {
      eligible: false,
      reason: 'CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE',
      explanation: `A ${String(input.relation)} link is not reachable from a statement recorded as ${relevance.toLowerCase()}.`,
    };
  }
  return ELIGIBLE;
}

/** Whether a value is inside the relevance vocabulary at all. */
export function isKnownRelevance(value: string): value is ClaimRelevance {
  return (CLAIM_RELEVANCES as readonly string[]).includes(value);
}

/** The four fidelity labels that assert a factual verdict, and so belong in a denominator. */
export function isDefinitiveFidelityLabel(label: string): label is ClaimFidelityLabel {
  return (
    label === 'ACCURATE' ||
    label === 'PARTIALLY_ACCURATE' ||
    label === 'CONTRADICTED' ||
    label === 'UNSUPPORTED'
  );
}
