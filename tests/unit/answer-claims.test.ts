import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ANSWER_OFFSET_BASES,
  ANSWER_OFFSET_BASIS_DESCRIPTIONS,
  ANSWER_OFFSET_BASIS_LABELS,
  ANSWER_STATEMENT_KINDS,
  ANSWER_STATEMENT_KIND_DESCRIPTIONS,
  ANSWER_STATEMENT_KIND_LABELS,
  CLAIM_ATTRIBUTION_DESCRIPTIONS,
  CLAIM_ATTRIBUTION_DISPLAY,
  CLAIM_ATTRIBUTION_LABELS,
  CLAIM_CITATION_SUPPORT_DESCRIPTIONS,
  CLAIM_CITATION_SUPPORT_DISPLAY,
  CLAIM_CITATION_SUPPORT_LABELS,
  CLAIM_DIMENSIONS,
  CLAIM_DIMENSION_LABELS,
  CLAIM_FIDELITY_DESCRIPTIONS,
  CLAIM_FIDELITY_DISPLAY,
  CLAIM_FIDELITY_LABELS,
  CLAIM_PROPOSITION_RELATION_DESCRIPTIONS,
  CLAIM_PROPOSITION_RELATION_LABELS,
  CLAIM_PROPOSITION_RELATIONS,
  CLAIM_RELEVANCE_DESCRIPTIONS,
  CLAIM_RELEVANCE_LABELS,
  CLAIM_RELEVANCES,
  isAssertingAttributionLabel,
  isAssertingPropositionRelation,
  isAssertingRelevance,
  isClaimAttributionLabel,
  isClaimFidelityLabel,
  isClaimRelevance,
  isNonVerdictRelevance,
  type ClaimAttributionLabel,
  type ClaimPropositionRelation,
} from '../../src/core/answerClaims.ts';

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      repeated.add(value);
    }
    seen.add(value);
  }
  return [...repeated];
}

test('answer-claim vocabularies contain no duplicate values', () => {
  for (const list of [
    ANSWER_OFFSET_BASES,
    ANSWER_STATEMENT_KINDS,
    CLAIM_RELEVANCES,
    CLAIM_PROPOSITION_RELATIONS,
    CLAIM_CITATION_SUPPORT_LABELS,
    CLAIM_FIDELITY_LABELS,
    CLAIM_ATTRIBUTION_LABELS,
    CLAIM_DIMENSIONS,
  ]) {
    assert.deepEqual(duplicates(list), []);
  }
});

test('every answer-claim label has a human display string and a description', () => {
  for (const value of ANSWER_OFFSET_BASES) {
    assert.ok(ANSWER_OFFSET_BASIS_LABELS[value].length > 0);
    assert.ok(ANSWER_OFFSET_BASIS_DESCRIPTIONS[value].length > 20);
  }
  for (const value of ANSWER_STATEMENT_KINDS) {
    assert.ok(ANSWER_STATEMENT_KIND_LABELS[value].length > 0);
    assert.ok(ANSWER_STATEMENT_KIND_DESCRIPTIONS[value].length > 20);
  }
  for (const value of CLAIM_RELEVANCES) {
    assert.ok(CLAIM_RELEVANCE_LABELS[value].length > 0);
    assert.ok(CLAIM_RELEVANCE_DESCRIPTIONS[value].length > 20);
  }
  for (const value of CLAIM_PROPOSITION_RELATIONS) {
    assert.ok(CLAIM_PROPOSITION_RELATION_LABELS[value].length > 0);
    assert.ok(CLAIM_PROPOSITION_RELATION_DESCRIPTIONS[value].length > 20);
  }
  for (const value of CLAIM_CITATION_SUPPORT_LABELS) {
    assert.ok(CLAIM_CITATION_SUPPORT_DISPLAY[value].length > 0);
    assert.ok(CLAIM_CITATION_SUPPORT_DESCRIPTIONS[value].length > 20);
  }
  for (const value of CLAIM_FIDELITY_LABELS) {
    assert.ok(CLAIM_FIDELITY_DISPLAY[value].length > 0);
    assert.ok(CLAIM_FIDELITY_DESCRIPTIONS[value].length > 20);
  }
  for (const value of CLAIM_ATTRIBUTION_LABELS) {
    assert.ok(CLAIM_ATTRIBUTION_DISPLAY[value].length > 0);
    assert.ok(CLAIM_ATTRIBUTION_DESCRIPTIONS[value].length > 20);
  }
  for (const value of CLAIM_DIMENSIONS) {
    assert.ok(CLAIM_DIMENSION_LABELS[value].length > 0);
  }
});

test('the description maps cover exactly the declared label sets', () => {
  assert.deepEqual(
    Object.keys(CLAIM_RELEVANCE_LABELS).sort(),
    [...CLAIM_RELEVANCES].sort(),
    'relevance labels',
  );
  assert.deepEqual(
    Object.keys(ANSWER_STATEMENT_KIND_LABELS).sort(),
    [...ANSWER_STATEMENT_KINDS].sort(),
    'statement kind labels',
  );
  assert.deepEqual(
    Object.keys(CLAIM_PROPOSITION_RELATION_LABELS).sort(),
    [...CLAIM_PROPOSITION_RELATIONS].sort(),
    'proposition relation labels',
  );
  assert.deepEqual(
    Object.keys(CLAIM_CITATION_SUPPORT_DISPLAY).sort(),
    [...CLAIM_CITATION_SUPPORT_LABELS].sort(),
    'citation support labels',
  );
  assert.deepEqual(
    Object.keys(CLAIM_FIDELITY_DISPLAY).sort(),
    [...CLAIM_FIDELITY_LABELS].sort(),
    'fidelity labels',
  );
  assert.deepEqual(
    Object.keys(CLAIM_ATTRIBUTION_DISPLAY).sort(),
    [...CLAIM_ATTRIBUTION_LABELS].sort(),
    'attribution labels',
  );
});

test('relevance is split into asserting and non-verdict with no overlap and no gap', () => {
  const asserting = CLAIM_RELEVANCES.filter(isAssertingRelevance);
  const nonVerdict = CLAIM_RELEVANCES.filter(isNonVerdictRelevance);
  for (const value of CLAIM_RELEVANCES) {
    assert.notEqual(
      asserting.includes(value) && nonVerdict.includes(value),
      true,
      `${value} is in both partitions`,
    );
    assert.equal(asserting.includes(value) || nonVerdict.includes(value), true);
  }
  // The standing product rule: these states are never a negative factual verdict.
  for (const value of ['REFUSAL', 'ABSTENTION', 'OMISSION', 'UNAVAILABLE'] as const) {
    assert.equal(isAssertingRelevance(value), false);
    assert.equal(isNonVerdictRelevance(value), true);
  }
});

test('proposition relations mark exactly the asserting subset', () => {
  const asserting = CLAIM_PROPOSITION_RELATIONS.filter(isAssertingPropositionRelation);
  assert.deepEqual(asserting, [
    'SUPPORTS_TARGET',
    'PARTIALLY_SUPPORTS_TARGET',
    'CONTRADICTS_TARGET',
    'QUALIFIES_TARGET',
  ]);
  for (const value of ['REFUSES_TARGET', 'ABSTAINS_TARGET', 'OMITS_TARGET'] as const) {
    assert.equal(
      isAssertingPropositionRelation(value as ClaimPropositionRelation),
      false,
      `${value} must never count as an assertion`,
    );
  }
});

test('attribution distinguishes wrong role from wrong person and sole credit', () => {
  // These are separate because the remedy differs; a flat INCORRECT would hide which.
  const distinct: ClaimAttributionLabel[] = [
    'WRONG_ROLE',
    'WRONG_PERSON',
    'FALSE_SOLE_CREDIT',
    'COLLABORATIVE_PARTIAL',
    'AMBIGUOUS',
    'UNATTRIBUTED',
    'INCORRECT',
  ];
  assert.equal(new Set(distinct).size, distinct.length);
  for (const value of distinct) {
    assert.equal(isClaimAttributionLabel(value), true);
  }
  assert.equal(isClaimAttributionLabel('WRONG_ROLE'), true);
  assert.equal(isClaimAttributionLabel('ACCURATE'), false);
});

test('attribution scoring excludes silence and unassessable states', () => {
  for (const value of ['NOT_ADDRESSED', 'NOT_ASSESSABLE'] as const) {
    assert.equal(isAssertingAttributionLabel(value), false);
  }
  for (const value of ['CORRECT', 'FALSE_SOLE_CREDIT', 'WRONG_ROLE'] as const) {
    assert.equal(isAssertingAttributionLabel(value), true);
  }
});

test('claim fidelity labels are rejected on the attribution axis and vice versa', () => {
  assert.equal(isClaimFidelityLabel('CONTRADICTED'), true);
  assert.equal(isClaimFidelityLabel('INCORRECT'), false);
  assert.equal(isClaimAttributionLabel('INCORRECT'), true);
  assert.equal(isClaimAttributionLabel('CONTRADICTED'), false);
});

test('omission and refusal exist as claim fidelity states distinct from contradiction', () => {
  // The requirement: an omitted fact, a denial, and an unavailable answer must not collapse.
  for (const value of [
    'OMITTED',
    'REFUSED',
    'UNAVAILABLE',
    'CONTRADICTED',
    'UNSUPPORTED',
  ] as const) {
    assert.equal(isClaimFidelityLabel(value), true);
  }
  assert.equal(CLAIM_FIDELITY_DESCRIPTIONS.OMITTED.includes('never an inaccurate statement'), true);
  assert.equal(
    CLAIM_FIDELITY_DESCRIPTIONS.REFUSED.includes('not a negative factual verdict'),
    true,
  );
});

test('relevance states cover the cases the milestone requires', () => {
  for (const value of [
    'UNRELATED',
    'AMBIGUOUS',
    'PARTIALLY_ADDRESSES',
    'NOT_ASSESSABLE',
    'REFUSAL',
    'ABSTENTION',
    'OMISSION',
    'CONTRADICTS',
  ] as const) {
    assert.equal((CLAIM_RELEVANCES as readonly string[]).includes(value), true, value);
    assert.equal(isClaimRelevance(value), true);
  }
});
