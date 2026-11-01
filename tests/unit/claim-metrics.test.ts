import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeRunMetrics,
  type ObservationInput,
  type RunMetricsInput,
} from '../../src/core/metrics.ts';
import type { AnswerClaimInput } from '../../src/core/claimMetrics.ts';

const OBSERVATION: ObservationInput = {
  id: 'obs_1',
  queryId: 'qry_1',
  status: 'COMPLETED',
  voided: false,
  citationCapture: 'CAPTURED',
  citations: [{ id: 'cit_1', targetOwned: true, voided: false }],
  assessments: [{ dimension: 'PRESENCE', version: 1, label: 'MENTIONED' }],
};

function baseInput(claims: readonly AnswerClaimInput[]): RunMetricsInput {
  return {
    runStatus: 'FINALIZED',
    queries: [{ id: 'qry_1', intent: 'IDENTITY' }],
    observations: [OBSERVATION],
    claims,
  };
}

/** `exactOptionalPropertyTypes` forbids `Partial` with an explicit `undefined`, which the fixtures need. */
type ClaimOverrides = Partial<Omit<AnswerClaimInput, 'fidelityLabel' | 'attributionLabel'>> & {
  readonly fidelityLabel?: string | undefined;
  readonly attributionLabel?: string | undefined;
};

function claim(overrides: ClaimOverrides = {}): AnswerClaimInput {
  return {
    claimId: 'acs_1',
    observationId: 'obs_1',
    revisionId: 'acr_1',
    relevance: 'ADDRESSES',
    fidelityLabel: 'ACCURATE',
    attributionLabel: 'NOT_ADDRESSED',
    citationSupports: ['SUPPORTS'],
    propositionRelations: [{ propositionId: 'prp_1', relation: 'SUPPORTS_TARGET' }],
    ...overrides,
  };
}

function block(input: RunMetricsInput) {
  const metrics = computeRunMetrics(input);
  const claimLevel = metrics.claimLevel;
  assert.notEqual(claimLevel, undefined, 'expected a claim-level block');
  if (claimLevel === undefined) {
    throw new Error('unreachable');
  }
  return { metrics, claimLevel };
}

test('no recorded statements means no claim-level block, not a zero', () => {
  const metrics = computeRunMetrics(baseInput([]));
  assert.equal(metrics.claimLevel, undefined);
});

test('claim-level output never changes the observation-level rates', () => {
  const withoutClaims = computeRunMetrics(baseInput([]));
  const withClaims = block(baseInput([claim()])).metrics;
  for (const key of [
    'mentionRate',
    'targetSourceCitationRate',
    'anySourceCitationRate',
    'citationSupportRate',
    'claimFidelityRate',
    'attributionCorrectnessRate',
    'observedAnswerCoverage',
  ] as const) {
    assert.deepEqual(
      { ...withClaims[key], notes: withoutClaims[key].notes },
      withoutClaims[key],
      `${key} must keep its metrics-v2 meaning`,
    );
  }
  assert.equal(withClaims.version, 'metrics-v3');
});

test('the fidelity denominator holds only definitive assessments', () => {
  const { claimLevel } = block(
    baseInput([
      claim({ claimId: 'a', fidelityLabel: 'ACCURATE' }),
      claim({ claimId: 'b', fidelityLabel: 'CONTRADICTED' }),
      claim({ claimId: 'c', fidelityLabel: 'UNSUPPORTED' }),
      claim({ claimId: 'd', fidelityLabel: 'PARTIALLY_ACCURATE' }),
      claim({ claimId: 'e', fidelityLabel: 'OMITTED' }),
      claim({ claimId: 'f', fidelityLabel: 'REFUSED' }),
      claim({ claimId: 'g', fidelityLabel: 'UNAVAILABLE' }),
      claim({ claimId: 'h', fidelityLabel: 'NOT_ADDRESSED' }),
      claim({ claimId: 'i', fidelityLabel: 'NOT_ASSESSABLE' }),
      claim({ claimId: 'j', fidelityLabel: undefined }),
    ]),
  );
  assert.equal(claimLevel.claimFidelityRate.denominator, 4);
  assert.equal(claimLevel.claimFidelityRate.numerator, 1);
  assert.equal(claimLevel.unassessedClaims, 1);
  const reasons = claimLevel.claimFidelityRate.exclusions.map((row) => row.reason).sort();
  assert.deepEqual(reasons, [
    'CLAIM_FIDELITY_UNASSESSED',
    'CLAIM_NOT_ADDRESSED',
    'CLAIM_NOT_ASSESSABLE',
    'CLAIM_OMITTED',
    'CLAIM_REFUSED',
    'CLAIM_UNAVAILABLE',
  ]);
});

test('contradiction and unsupported rates are visible beside a favourable fidelity rate', () => {
  const { claimLevel } = block(
    baseInput([
      claim({ claimId: 'a', fidelityLabel: 'ACCURATE' }),
      claim({ claimId: 'b', fidelityLabel: 'CONTRADICTED' }),
      claim({ claimId: 'c', fidelityLabel: 'UNSUPPORTED' }),
    ]),
  );
  assert.equal(claimLevel.claimFidelityRate.numerator, 1);
  assert.equal(claimLevel.claimContradictionRate.numerator, 1);
  assert.equal(claimLevel.claimUnsupportedRate.numerator, 1);
  // All three share one denominator so the three figures can be read as a partition.
  assert.equal(claimLevel.claimContradictionRate.denominator, 3);
  assert.equal(claimLevel.claimUnsupportedRate.denominator, 3);
});

test('an answer of only refusals and omissions produces null, never zero', () => {
  const { claimLevel } = block(
    baseInput([
      claim({ claimId: 'a', relevance: 'REFUSAL', fidelityLabel: 'REFUSED' }),
      claim({ claimId: 'b', relevance: 'ABSTENTION', fidelityLabel: 'NOT_ASSESSABLE' }),
      claim({
        claimId: 'c',
        relevance: 'OMISSION',
        fidelityLabel: 'OMITTED',
        propositionRelations: [{ propositionId: 'prp_1', relation: 'OMITS_TARGET' }],
      }),
    ]),
  );
  assert.equal(claimLevel.claimFidelityRate.value, null);
  assert.equal(claimLevel.claimFidelityRate.numerator, null);
  assert.equal(claimLevel.claimAttributionRate.value, null);
  assert.equal(claimLevel.claimCitationSupportRate.denominator, 3);
});

test('citation support counts each mapping and never folds partial support into supported', () => {
  const { claimLevel } = block(
    baseInput([
      claim({ claimId: 'a', citationSupports: ['SUPPORTS'] }),
      claim({ claimId: 'b', citationSupports: ['PARTIALLY_SUPPORTS'] }),
      claim({ claimId: 'c', citationSupports: ['SUPPORTS_WITH_CONDITIONS'] }),
      claim({ claimId: 'd', citationSupports: ['DOES_NOT_SUPPORT'] }),
      claim({ claimId: 'e', citationSupports: ['UNCLEAR'] }),
      claim({ claimId: 'f', citationSupports: ['METADATA_MISSING'] }),
      claim({ claimId: 'g', citationSupports: [] }),
      // One statement carried by two citations counts twice, as two separate judgements.
      claim({ claimId: 'h', citationSupports: ['SUPPORTS', 'DOES_NOT_SUPPORT'] }),
    ]),
  );
  assert.equal(claimLevel.claimCitationSupportRate.denominator, 6);
  assert.equal(claimLevel.claimCitationSupportRate.numerator, 2);
  assert.deepEqual(claimLevel.claimCitationSupportRate.breakdown, {
    SUPPORTS: 2,
    PARTIALLY_SUPPORTS: 1,
    SUPPORTS_WITH_CONDITIONS: 1,
    DOES_NOT_SUPPORT: 2,
  });
  const reasons = claimLevel.claimCitationSupportRate.exclusions.map((row) => [
    row.reason,
    row.count,
  ]);
  assert.deepEqual(reasons, [
    ['CLAIM_NO_MAPPED_CITATION', 1],
    ['CLAIM_CITATION_UNCLEAR', 1],
    ['CLAIM_CITATION_METADATA_MISSING', 1],
  ]);
});

test('attribution keeps wrong role, sole credit and unattributed apart from a flat incorrect', () => {
  const { claimLevel } = block(
    baseInput([
      claim({ claimId: 'a', attributionLabel: 'CORRECT' }),
      claim({ claimId: 'b', attributionLabel: 'WRONG_ROLE' }),
      claim({ claimId: 'c', attributionLabel: 'FALSE_SOLE_CREDIT' }),
      claim({ claimId: 'd', attributionLabel: 'COLLABORATIVE_PARTIAL' }),
      claim({ claimId: 'e', attributionLabel: 'UNATTRIBUTED' }),
      claim({ claimId: 'f', attributionLabel: 'INCORRECT' }),
      claim({ claimId: 'g', attributionLabel: 'NOT_ADDRESSED' }),
      claim({ claimId: 'h', attributionLabel: 'NOT_ASSESSABLE' }),
      claim({ claimId: 'i', attributionLabel: undefined }),
    ]),
  );
  assert.equal(claimLevel.claimAttributionRate.numerator, 1);
  assert.equal(claimLevel.claimAttributionRate.denominator, 6);
  assert.deepEqual(claimLevel.claimAttributionRate.breakdown, {
    CORRECT: 1,
    PARTIALLY_CORRECT: 0,
    WRONG_ROLE: 1,
    WRONG_PERSON: 0,
    AMBIGUOUS: 0,
    COLLABORATIVE_PARTIAL: 1,
    FALSE_SOLE_CREDIT: 1,
    UNATTRIBUTED: 1,
    INCORRECT: 1,
  });
});

test('the omission measure counts propositions once and never enters fidelity', () => {
  const { claimLevel } = block(
    baseInput([
      // Two answers omit the same proposition.
      claim({
        claimId: 'a',
        relevance: 'OMISSION',
        fidelityLabel: undefined,
        propositionRelations: [{ propositionId: 'prp_1', relation: 'OMITS_TARGET' }],
      }),
      claim({
        claimId: 'b',
        relevance: 'OMISSION',
        fidelityLabel: undefined,
        propositionRelations: [{ propositionId: 'prp_1', relation: 'OMITS_TARGET' }],
      }),
      claim({
        claimId: 'c',
        propositionRelations: [{ propositionId: 'prp_2', relation: 'SUPPORTS_TARGET' }],
      }),
    ]),
  );
  assert.equal(claimLevel.relevantOmissionRate.numerator, 1);
  assert.equal(claimLevel.relevantOmissionRate.denominator, 2);
  assert.equal(claimLevel.claimFidelityRate.denominator, 1, 'only the asserting claim is scored');
});

test('decomposition coverage names the reviewer effort behind every claim-level rate', () => {
  const metrics = computeRunMetrics({
    runStatus: 'FINALIZED',
    queries: [{ id: 'qry_1', intent: 'IDENTITY' }],
    observations: [
      OBSERVATION,
      { ...OBSERVATION, id: 'obs_2' },
      { ...OBSERVATION, id: 'obs_3' },
      { ...OBSERVATION, id: 'obs_err', status: 'ERROR', assessments: [] },
    ],
    claims: [claim({ claimId: 'a', observationId: 'obs_1' })],
  });
  const claimLevel = metrics.claimLevel;
  assert.notEqual(claimLevel, undefined);
  if (claimLevel === undefined) {
    return;
  }
  assert.equal(claimLevel.eligibleObservations, 3, 'the error observation is not eligible');
  assert.equal(claimLevel.observationsWithClaims, 1);
  assert.equal(claimLevel.decompositionCoverage.numerator, 1);
  assert.equal(claimLevel.decompositionCoverage.denominator, 3);
  assert.match(claimLevel.notes.join(' '), /1 of 3 eligible observations/);
});

test('statements on an ineligible observation are excluded, not counted', () => {
  const metrics = computeRunMetrics({
    runStatus: 'FINALIZED',
    queries: [{ id: 'qry_1', intent: 'IDENTITY' }],
    observations: [
      OBSERVATION,
      // A refusal is outside answer scoring, so its statements must not reach any claim denominator.
      { ...OBSERVATION, id: 'obs_2', status: 'REFUSAL' },
    ],
    claims: [
      claim({ claimId: 'a', observationId: 'obs_1', fidelityLabel: 'ACCURATE' }),
      claim({ claimId: 'b', observationId: 'obs_2', fidelityLabel: 'CONTRADICTED' }),
    ],
  });
  const claimLevel = metrics.claimLevel;
  assert.notEqual(claimLevel, undefined);
  if (claimLevel === undefined) {
    return;
  }
  assert.equal(claimLevel.claimFidelityRate.denominator, 1);
  assert.equal(claimLevel.claimFidelityRate.numerator, 1);
  assert.deepEqual(
    claimLevel.claimFidelityRate.exclusions.map((row) => row.reason),
    [],
    'the ineligible statement is excluded from the block, not from one rate',
  );
  assert.equal(claimLevel.observationsWithClaims, 1);
  assert.equal(claimLevel.decompositionCoverage.numerator, 1);
});

test('a partially decomposed answer is counted rather than smoothed over', () => {
  const { claimLevel } = block(
    baseInput([
      claim({ claimId: 'a', fidelityLabel: 'ACCURATE' }),
      claim({ claimId: 'b', fidelityLabel: undefined }),
    ]),
  );
  assert.equal(claimLevel.partiallyDecomposedObservations, 1);
  assert.equal(claimLevel.unassessedClaims, 1);
});

test('a stored label on the wrong axis is reported as invalid, not trusted', () => {
  const { claimLevel } = block(
    baseInput([
      claim({ claimId: 'a', fidelityLabel: 'INCORRECT', attributionLabel: undefined }),
      claim({ claimId: 'b', fidelityLabel: undefined, attributionLabel: 'CONTRADICTED' }),
    ]),
  );
  assert.equal(claimLevel.claimFidelityRate.denominator, 0);
  assert.deepEqual(claimLevel.claimFidelityRate.exclusions.map((row) => row.reason).sort(), [
    'CLAIM_FIDELITY_UNASSESSED',
    'CLAIM_LABEL_INVALID',
  ]);
  assert.deepEqual(claimLevel.claimAttributionRate.exclusions.map((row) => row.reason).sort(), [
    'CLAIM_ATTRIBUTION_UNASSESSED',
    'CLAIM_LABEL_INVALID',
  ]);
});

test('claim-level units are named so a reader cannot assume observations', () => {
  const { claimLevel } = block(baseInput([claim()]));
  assert.equal(claimLevel.claimFidelityRate.unit, 'answer statements');
  assert.equal(claimLevel.claimCitationSupportRate.unit, 'claim-citation mappings');
  assert.equal(claimLevel.relevantOmissionRate.unit, 'propositions');
  assert.equal(claimLevel.decompositionCoverage.unit, 'observations');
  assert.equal(claimLevel.claimFidelityRate.definition.length > 40, true);
});

test('a non-asserting statement is kept outside fidelity but stays visible', () => {
  const { claimLevel } = block(
    baseInput([
      claim({
        claimId: 'a',
        relevance: 'UNRELATED',
        fidelityLabel: undefined,
        citationSupports: [],
        propositionRelations: [],
      }),
      claim({
        claimId: 'b',
        relevance: 'AMBIGUOUS',
        fidelityLabel: undefined,
        citationSupports: [],
        propositionRelations: [],
      }),
    ]),
  );
  assert.match(claimLevel.notes.join(' '), /no factual assertion/);
  assert.equal(claimLevel.claimFidelityRate.value, null);
});
