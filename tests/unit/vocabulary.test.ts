import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ASSESSMENT_DIMENSIONS,
  ASSESSMENT_LABELS_BY_DIMENSION,
  CLAIM_STATUSES,
  CLAIM_STATUS_DESCRIPTIONS,
  CLAIM_STATUS_LABELS,
  EVIDENCE_RELATIONS,
  EVIDENCE_RELATION_DESCRIPTIONS,
  ENTITY_TYPES,
  IDENTITY_STATUSES,
  OBSERVATION_STATUSES,
  OBSERVATION_STATUS_DESCRIPTIONS,
  PROPOSITION_STATUSES,
  PROPOSITION_STATUS_DESCRIPTIONS,
  PROPOSITION_STATUS_LABELS,
  QUERY_INTENTS,
  SOURCE_INDEPENDENCE_DESCRIPTIONS,
  SOURCE_INDEPENDENCE_LABELS,
  SOURCE_TYPES,
  SOURCE_TYPE_DESCRIPTIONS,
  assessmentLabelDisplay,
  isAssessmentLabelForDimension,
  isOneOf,
} from '../../src/core/vocabulary.ts';

function assertUnique(values: readonly string[]): void {
  assert.equal(new Set(values).size, values.length);
}

test('controlled vocabularies contain no duplicate values', () => {
  for (const vocabulary of [
    CLAIM_STATUSES,
    PROPOSITION_STATUSES,
    EVIDENCE_RELATIONS,
    ENTITY_TYPES,
    IDENTITY_STATUSES,
    SOURCE_TYPES,
    QUERY_INTENTS,
    OBSERVATION_STATUSES,
    ASSESSMENT_DIMENSIONS,
  ]) {
    assertUnique(vocabulary);
  }
});

test('every status and relation has a human description', () => {
  for (const status of CLAIM_STATUSES) {
    assert.ok(CLAIM_STATUS_LABELS[status].length > 0);
    assert.ok(CLAIM_STATUS_DESCRIPTIONS[status].length > 0);
  }
  for (const status of PROPOSITION_STATUSES) {
    assert.ok(PROPOSITION_STATUS_DESCRIPTIONS[status].length > 0);
  }
  for (const relation of EVIDENCE_RELATIONS) {
    assert.ok(EVIDENCE_RELATION_DESCRIPTIONS[relation].length > 0);
  }
  for (const status of OBSERVATION_STATUSES) {
    assert.ok(OBSERVATION_STATUS_DESCRIPTIONS[status].length > 0);
  }
});

test('assessment labels are dimension-specific', () => {
  assert.equal(isAssessmentLabelForDimension('PRESENCE', 'MENTIONED'), true);
  assert.equal(isAssessmentLabelForDimension('PRESENCE', 'ACCURATE'), false);
  assert.equal(isAssessmentLabelForDimension('FIDELITY', 'ACCURATE'), true);
  assert.equal(isAssessmentLabelForDimension('FIDELITY', 'MENTIONED'), false);
  assert.equal(isAssessmentLabelForDimension('CITATION_SUPPORT', 'SUPPORTED'), true);
  assert.equal(isAssessmentLabelForDimension('ATTRIBUTION', 'NOT_ADDRESSED'), true);
  assert.equal(isAssessmentLabelForDimension('ATTRIBUTION', 'SUPPORTED'), false);
  for (const dimension of ASSESSMENT_DIMENSIONS) {
    assert.ok(ASSESSMENT_LABELS_BY_DIMENSION[dimension].length > 0);
  }
});

test('display labels fall back to the raw label', () => {
  assert.equal(assessmentLabelDisplay('PARTIALLY_ACCURATE'), 'Partially accurate / qualified');
  assert.equal(assessmentLabelDisplay('UNKNOWN_LABEL'), 'UNKNOWN_LABEL');
});

test('generic enum guard rejects unknown values', () => {
  assert.equal(isOneOf('SUPPORTS', EVIDENCE_RELATIONS), true);
  assert.equal(isOneOf('supports', EVIDENCE_RELATIONS), false);
  assert.equal(isOneOf('OTHER', EVIDENCE_RELATIONS), false);
});

test('evidence labels name recorded relationships and do not claim verification', () => {
  assert.equal(PROPOSITION_STATUS_LABELS.CONTRADICTED, 'Contradiction recorded');
  assert.equal(PROPOSITION_STATUS_LABELS.SUPPORTED_WITHIN_SCOPE, 'Support recorded within scope');
  for (const status of PROPOSITION_STATUSES) {
    assert.doesNotMatch(
      PROPOSITION_STATUS_DESCRIPTIONS[status],
      /credible|independently verified/i,
      status,
    );
  }
  for (const relation of EVIDENCE_RELATIONS) {
    assert.match(EVIDENCE_RELATION_DESCRIPTIONS[relation], /reviewer recorded/, relation);
  }
  assert.equal(SOURCE_INDEPENDENCE_LABELS.INDEPENDENT, 'Recorded as independent');
  assert.match(SOURCE_INDEPENDENCE_DESCRIPTIONS.INDEPENDENT, /did not verify/);
  assert.match(SOURCE_TYPE_DESCRIPTIONS.INDEPENDENT_SOURCE, /has not verified/);
});
