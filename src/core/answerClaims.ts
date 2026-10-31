/**
 * Claim-level answer evaluation vocabulary (ADR-018).
 *
 * These controlled lists describe what an operator recorded about one factual statement inside a
 * captured AI answer. They never describe whether a proposition is true in the world, and no label
 * here is a substitution for evidence support, discoverability, or attribution.
 */

export const ANSWER_OFFSET_BASES = ['EXACT_MATCH', 'NORMALIZED_MATCH', 'NOT_ESTABLISHED'] as const;
export type AnswerOffsetBasis = (typeof ANSWER_OFFSET_BASES)[number];

export const ANSWER_OFFSET_BASIS_LABELS: Record<AnswerOffsetBasis, string> = {
  EXACT_MATCH: 'Verbatim quote, position established',
  NORMALIZED_MATCH: 'Quote matches after whitespace/character normalisation',
  NOT_ESTABLISHED: 'No reliable position in the answer',
};

export const ANSWER_OFFSET_BASIS_DESCRIPTIONS: Record<AnswerOffsetBasis, string> = {
  EXACT_MATCH:
    'The quote appears character-for-character in the captured answer, and the stored range is that occurrence recomputed from the raw answer at write time.',
  NORMALIZED_MATCH:
    'The quote matches once runs of whitespace are collapsed and compatibility-equivalent characters are normalised (Unicode NFKC). The range is mapped back to the original text and re-verified; it is still the same bytes as the captured answer.',
  NOT_ESTABLISHED:
    'No reliable range exists — for example the operator summarised several sentences, or the answer text was re-keyed rather than pasted. No offsets are stored, because a precise-looking range that cannot be re-derived would be false precision.',
};

/**
 * Whether a stored statement text is words the answer actually contained, or the reviewer's own
 * description. Without this split, a paraphrase recorded with no locatable range would sit in a
 * column called "quote" and read back as if the model had said it.
 */
export const ANSWER_STATEMENT_KINDS = ['QUOTED', 'REVIEWER_DESCRIPTION'] as const;
export type AnswerStatementKind = (typeof ANSWER_STATEMENT_KINDS)[number];

export const ANSWER_STATEMENT_KIND_LABELS: Record<AnswerStatementKind, string> = {
  QUOTED: 'Quoted from the answer',
  REVIEWER_DESCRIPTION: 'Described in the reviewer’s own words',
};

export const ANSWER_STATEMENT_KIND_DESCRIPTIONS: Record<AnswerStatementKind, string> = {
  QUOTED:
    'These are words the captured answer contained. A range is recorded and re-checked against the raw answer, so a later reader can locate the statement in the original.',
  REVIEWER_DESCRIPTION:
    'These are the reviewer’s own words summarising, or pointing to the absence of, something in the answer. No range is recorded, because the answer did not contain this text. This row describes the evaluation; it is not evidence of what the model said.',
};

export const CLAIM_RELEVANCES = [
  'ADDRESSES',
  'PARTIALLY_ADDRESSES',
  'QUALIFIES',
  'CONTRADICTS',
  'DOES_NOT_ADDRESS',
  'AMBIGUOUS',
  'UNRELATED',
  'REFUSAL',
  'ABSTENTION',
  'OMISSION',
  'UNAVAILABLE',
  'NOT_ASSESSABLE',
] as const;
export type ClaimRelevance = (typeof CLAIM_RELEVANCES)[number];

export const CLAIM_RELEVANCE_LABELS: Record<ClaimRelevance, string> = {
  ADDRESSES: 'States something about the target',
  PARTIALLY_ADDRESSES: 'Partially addresses the target',
  QUALIFIES: 'Adds a condition or scope',
  CONTRADICTS: 'Contradicts the target',
  DOES_NOT_ADDRESS: 'Does not address the target',
  AMBIGUOUS: 'Ambiguous — cannot be tied to a target',
  UNRELATED: 'Unrelated to the evaluation',
  REFUSAL: 'Refusal to answer',
  ABSTENTION: 'Expressed uncertainty or lack of knowledge',
  OMISSION: 'Relevant omission recorded by the reviewer',
  UNAVAILABLE: 'Answer content unavailable at statement level',
  NOT_ASSESSABLE: 'Not assessable as a statement',
};

export const CLAIM_RELEVANCE_DESCRIPTIONS: Record<ClaimRelevance, string> = {
  ADDRESSES:
    'The statement makes a claim that bears directly on at least one target proposition. It says nothing yet about whether the statement is correct.',
  PARTIALLY_ADDRESSES:
    'The statement covers part of a target proposition — for example the act but not the date, or the person but not the role. The uncovered part stays visible rather than being treated as silence.',
  QUALIFIES:
    'The statement narrows or conditions what is claimed, such as a date range, a jurisdiction, or “one of” wording. A qualifier is not a contradiction.',
  CONTRADICTS:
    'The statement asserts something incompatible with a target proposition as recorded. This labels the answer’s wording; it is not a finding that the proposition is false.',
  DOES_NOT_ADDRESS:
    'The statement is about the subject area but carries no bearing on any target proposition the reviewer recorded.',
  AMBIGUOUS:
    'The statement could relate to more than one target, or its referent cannot be resolved from the answer alone. It is left unresolved rather than forced into a verdict.',
  UNRELATED:
    'The statement has nothing to do with the evaluation target. It is recorded so the decomposition is complete, and it is excluded from every rate.',
  REFUSAL:
    'The answer declined to respond on policy or capability grounds. A refusal is not a factual denial of the target.',
  ABSTENTION:
    'The answer hedged or said it did not know. Abstention is not a negative verdict and is not scored as an incorrect statement.',
  OMISSION:
    'The reviewer recorded that a target the answer should have addressed was left unsaid. An omission is a visibility gap, not a contradiction.',
  UNAVAILABLE:
    'The answer text exists but could not be inspected reliably at statement level — for example truncated capture or unreadable formatting.',
  NOT_ASSESSABLE:
    'The statement cannot responsibly be classified. Choosing this is a recorded unknown, not a hidden negative.',
};

/** Relevance values that describe a factual assertion the evaluator can score. */
const ASSERTING_RELEVANCES: readonly ClaimRelevance[] = [
  'ADDRESSES',
  'PARTIALLY_ADDRESSES',
  'QUALIFIES',
  'CONTRADICTS',
];

export function isAssertingRelevance(relevance: ClaimRelevance): boolean {
  return ASSERTING_RELEVANCES.includes(relevance);
}

/** Relevance values that must never be counted as a negative factual verdict. */
const NON_VERDICT_RELEVANCES: readonly ClaimRelevance[] = [
  'REFUSAL',
  'ABSTENTION',
  'OMISSION',
  'UNAVAILABLE',
  'DOES_NOT_ADDRESS',
  'UNRELATED',
  'AMBIGUOUS',
  'NOT_ASSESSABLE',
];

export function isNonVerdictRelevance(relevance: ClaimRelevance): boolean {
  return NON_VERDICT_RELEVANCES.includes(relevance);
}

export const CLAIM_PROPOSITION_RELATIONS = [
  'SUPPORTS_TARGET',
  'PARTIALLY_SUPPORTS_TARGET',
  'CONTRADICTS_TARGET',
  'QUALIFIES_TARGET',
  'DOES_NOT_ADDRESS_TARGET',
  'AMBIGUOUS_TARGET',
  'REFUSES_TARGET',
  'ABSTAINS_TARGET',
  'OMITS_TARGET',
  'NOT_ASSESSABLE_TARGET',
] as const;
export type ClaimPropositionRelation = (typeof CLAIM_PROPOSITION_RELATIONS)[number];

export const CLAIM_PROPOSITION_RELATION_LABELS: Record<ClaimPropositionRelation, string> = {
  SUPPORTS_TARGET: 'Asserts the target proposition',
  PARTIALLY_SUPPORTS_TARGET: 'Asserts part of the target proposition',
  CONTRADICTS_TARGET: 'Asserts against the target proposition',
  QUALIFIES_TARGET: 'Asserts the target only under conditions',
  DOES_NOT_ADDRESS_TARGET: 'Does not address the target proposition',
  AMBIGUOUS_TARGET: 'Referent to the target proposition is unclear',
  REFUSES_TARGET: 'Refused to address the target proposition',
  ABSTAINS_TARGET: 'Abstained on the target proposition',
  OMITS_TARGET: 'Omitted the target proposition',
  NOT_ASSESSABLE_TARGET: 'Relationship not assessable',
};

export const CLAIM_PROPOSITION_RELATION_DESCRIPTIONS: Record<ClaimPropositionRelation, string> = {
  SUPPORTS_TARGET:
    'The answer statement asserts what the target proposition states. It is the answer’s wording agreeing with the target, which is not the same as the target being independently supported.',
  PARTIALLY_SUPPORTS_TARGET:
    'The answer statement asserts part of the target proposition and leaves the rest unaddressed or differently scoped.',
  CONTRADICTS_TARGET:
    'The answer statement asserts something incompatible with the target proposition as the reviewer recorded it.',
  QUALIFIES_TARGET:
    'The answer statement asserts the target only under a condition, narrower scope, or stated uncertainty.',
  DOES_NOT_ADDRESS_TARGET:
    'The statement was recorded for completeness and does not bear on this proposition.',
  AMBIGUOUS_TARGET:
    'The statement probably relates to this proposition, but its referent or scope cannot be resolved from the answer.',
  REFUSES_TARGET: 'The answer declined on this proposition. This is a refusal, not a denial.',
  ABSTAINS_TARGET: 'The answer expressed uncertainty or lack of knowledge on this proposition.',
  OMITS_TARGET:
    'The reviewer recorded that the answer left this proposition unsaid while addressing the same subject.',
  NOT_ASSESSABLE_TARGET:
    'The reviewer could not responsibly classify the relationship. It remains an unknown.',
};

/** Relations that carry a factual assertion about the target, and so may enter fidelity scoring. */
const ASSERTING_PROPOSITION_RELATIONS: readonly ClaimPropositionRelation[] = [
  'SUPPORTS_TARGET',
  'PARTIALLY_SUPPORTS_TARGET',
  'CONTRADICTS_TARGET',
  'QUALIFIES_TARGET',
];

export function isAssertingPropositionRelation(relation: ClaimPropositionRelation): boolean {
  return ASSERTING_PROPOSITION_RELATIONS.includes(relation);
}

export const CLAIM_CITATION_SUPPORT_LABELS = [
  'SUPPORTS',
  'PARTIALLY_SUPPORTS',
  'SUPPORTS_WITH_CONDITIONS',
  'DOES_NOT_SUPPORT',
  'UNCLEAR',
  'METADATA_MISSING',
  'NOT_ASSESSABLE',
] as const;
export type ClaimCitationSupportLabel = (typeof CLAIM_CITATION_SUPPORT_LABELS)[number];

export const CLAIM_CITATION_SUPPORT_DISPLAY: Record<ClaimCitationSupportLabel, string> = {
  SUPPORTS: 'Cited material supports the statement',
  PARTIALLY_SUPPORTS: 'Cited material supports part of the statement',
  SUPPORTS_WITH_CONDITIONS: 'Cited material supports the statement only under conditions',
  DOES_NOT_SUPPORT: 'Cited material does not support the statement',
  UNCLEAR: 'Support relationship unclear from the cited material',
  METADATA_MISSING: 'No citation content was captured to compare',
  NOT_ASSESSABLE: 'Support not assessable',
};

export const CLAIM_CITATION_SUPPORT_DESCRIPTIONS: Record<ClaimCitationSupportLabel, string> = {
  SUPPORTS:
    'The reviewer compared the cited material with this statement and recorded that it materially supports it. Citation support is a human judgement about one pairing, and it is not proof that the statement is true.',
  PARTIALLY_SUPPORTS:
    'The cited material supports part of the statement — typically a multi-part sentence where only one element is covered.',
  SUPPORTS_WITH_CONDITIONS:
    'The cited material supports the statement only under a condition the citation itself states, such as a date, a jurisdiction, or a narrower scope.',
  DOES_NOT_SUPPORT:
    'The cited material was located and read, and does not support this statement. A citation being present in the answer does not make it supportive.',
  UNCLEAR:
    'The cited material exists but its bearing on this statement cannot be determined from what was captured.',
  METADATA_MISSING:
    'No usable citation content was captured for this statement, so support cannot be evaluated. This is an unavailable check, not a failure.',
  NOT_ASSESSABLE: 'The reviewer could not assess support. Recorded as an unknown.',
};

export const CLAIM_DIMENSIONS = ['FIDELITY', 'ATTRIBUTION'] as const;
export type ClaimDimension = (typeof CLAIM_DIMENSIONS)[number];

export const CLAIM_DIMENSION_LABELS: Record<ClaimDimension, string> = {
  FIDELITY: 'Statement fidelity to the recorded target',
  ATTRIBUTION: 'Statement attribution',
};

export const CLAIM_FIDELITY_LABELS = [
  'ACCURATE',
  'PARTIALLY_ACCURATE',
  'CONTRADICTED',
  'UNSUPPORTED',
  'OMITTED',
  'REFUSED',
  'UNAVAILABLE',
  'NOT_ADDRESSED',
  'NOT_ASSESSABLE',
] as const;
export type ClaimFidelityLabel = (typeof CLAIM_FIDELITY_LABELS)[number];

export const CLAIM_FIDELITY_DISPLAY: Record<ClaimFidelityLabel, string> = {
  ACCURATE: 'Accurate within the recorded scope',
  PARTIALLY_ACCURATE: 'Partially accurate or qualified',
  CONTRADICTED: 'Contradicted by the recorded evidence',
  UNSUPPORTED: 'Unsupported by the recorded evidence',
  OMITTED: 'The answer left this out',
  REFUSED: 'The answer refused this',
  UNAVAILABLE: 'Could not be checked',
  NOT_ADDRESSED: 'Not a factual assertion about the target',
  NOT_ASSESSABLE: 'Not assessable',
};

export const CLAIM_FIDELITY_DESCRIPTIONS: Record<ClaimFidelityLabel, string> = {
  ACCURATE:
    'Against the propositions and evidence the reviewer recorded, the statement is accurate within the stated scope. It is not a claim that the statement is universally or independently proven.',
  PARTIALLY_ACCURATE:
    'The statement is accurate for part of what it asserts, or accurate only under conditions the answer did not state. The partial state is kept separate from both accurate and contradicted.',
  CONTRADICTED:
    'The statement conflicts with recorded evidence the reviewer judged directly relevant. This describes the answer’s wording against the record; it is not a finding that no contrary source exists.',
  UNSUPPORTED:
    'Nothing in the recorded evidence bears on the statement either way, so it cannot be called accurate or inaccurate. Absence of recorded support is not treated as contradiction.',
  OMITTED:
    'The reviewer recorded that the answer did not state this at all. Silence is an omission, never an inaccurate statement.',
  REFUSED: 'The answer declined to state this. A refusal is not a negative factual verdict.',
  UNAVAILABLE:
    'The evidence needed to check the statement could not be inspected. This is an unavailable check, not a failure of the answer.',
  NOT_ADDRESSED:
    'The recorded statement is not a factual assertion about the target — for example opinions or filler — so fidelity does not apply.',
  NOT_ASSESSABLE:
    'The reviewer could not responsibly judge the statement. This stays a recorded unknown.',
};

export const CLAIM_ATTRIBUTION_LABELS = [
  'CORRECT',
  'PARTIALLY_CORRECT',
  'WRONG_ROLE',
  'WRONG_PERSON',
  'AMBIGUOUS',
  'COLLABORATIVE_PARTIAL',
  'FALSE_SOLE_CREDIT',
  'UNATTRIBUTED',
  'INCORRECT',
  'NOT_ADDRESSED',
  'NOT_ASSESSABLE',
] as const;
export type ClaimAttributionLabel = (typeof CLAIM_ATTRIBUTION_LABELS)[number];

export const CLAIM_ATTRIBUTION_DISPLAY: Record<ClaimAttributionLabel, string> = {
  CORRECT: 'Person and contribution role both recorded as correct',
  PARTIALLY_CORRECT: 'Partially correct attribution',
  WRONG_ROLE: 'Right person, wrong contribution role',
  WRONG_PERSON: 'Attributed to the wrong person or organisation',
  AMBIGUOUS: 'Attribution ambiguous',
  COLLABORATIVE_PARTIAL: 'Shared contribution credited, but incompletely',
  FALSE_SOLE_CREDIT: 'Shared or others’ work credited as sole authorship',
  UNATTRIBUTED: 'Statement carries no attribution at all',
  INCORRECT: 'Attribution incorrect',
  NOT_ADDRESSED: 'The answer does not address attribution',
  NOT_ASSESSABLE: 'Attribution not assessable',
};

export const CLAIM_ATTRIBUTION_DESCRIPTIONS: Record<ClaimAttributionLabel, string> = {
  CORRECT:
    'For this statement, the reviewer recorded that the named party and the described contribution role both match the record they hold. It does not establish legal authorship or ownership.',
  PARTIALLY_CORRECT:
    'Some element of the attribution is right and some is not. The specific mismatch is recorded in the rationale rather than absorbed into a single label.',
  WRONG_ROLE:
    'The answer named the right person or organisation but described the wrong contribution role — for example calling a maintainer the author. This is kept separate from naming the wrong party, because the remedy differs.',
  WRONG_PERSON:
    'The answer named a party the reviewer recorded as not responsible for this contribution.',
  AMBIGUOUS:
    'The answer’s attribution cannot be resolved to a specific party, for example a shared surname or an unqualified “the team”.',
  COLLABORATIVE_PARTIAL:
    'The contribution was collaborative and the answer credited some but not all participants.',
  FALSE_SOLE_CREDIT:
    'The answer presented shared work, or work the reviewer recorded as others’, as one party’s sole authorship. Recording this labels the answer’s wording; it is not a legal finding about authorship.',
  UNATTRIBUTED: 'The statement asserts a contribution without naming any party.',
  INCORRECT: 'The attribution is wrong in a way the more specific labels do not describe.',
  NOT_ADDRESSED:
    'The answer made no attribution claim in this statement, so attribution is not scored. Silence about credit is not incorrect credit.',
  NOT_ASSESSABLE: 'The reviewer could not assess attribution from what was captured.',
};

/** Attribution labels that describe an assertion about credit, and so enter the denominator. */
const ASSERTING_ATTRIBUTION_LABELS: readonly ClaimAttributionLabel[] = [
  'CORRECT',
  'PARTIALLY_CORRECT',
  'WRONG_ROLE',
  'WRONG_PERSON',
  'AMBIGUOUS',
  'COLLABORATIVE_PARTIAL',
  'FALSE_SOLE_CREDIT',
  'INCORRECT',
];

export function isAssertingAttributionLabel(label: ClaimAttributionLabel): boolean {
  return ASSERTING_ATTRIBUTION_LABELS.includes(label);
}

export function isClaimFidelityLabel(label: string): label is ClaimFidelityLabel {
  return (CLAIM_FIDELITY_LABELS as readonly string[]).includes(label);
}

export function isClaimAttributionLabel(label: string): label is ClaimAttributionLabel {
  return (CLAIM_ATTRIBUTION_LABELS as readonly string[]).includes(label);
}

export function isClaimRelevance(label: string): label is ClaimRelevance {
  return (CLAIM_RELEVANCES as readonly string[]).includes(label);
}

export const ANSWER_CLAIM_VERSIONS = {
  decomposition: 'answer-claim-decomposition-v1',
  citationMapping: 'claim-citation-mapping-v1',
} as const;
