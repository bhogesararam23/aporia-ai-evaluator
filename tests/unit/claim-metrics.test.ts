import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeRunMetrics,
  type ObservationInput,
  type RunMetricsInput,
} from '../../src/core/metrics.ts';
import type { AnswerClaimCitationInput, AnswerClaimInput } from '../../src/core/claimMetrics.ts';

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

function mapping(
  support: string,
  overrides: { readonly citationId?: string; readonly citationVoided?: boolean } = {},
): AnswerClaimCitationInput {
  return {
    citationId: overrides.citationId ?? 'cit_1',
    support,
    citationVoided: overrides.citationVoided ?? false,
  };
}

function claim(overrides: ClaimOverrides = {}): AnswerClaimInput {
  return {
    claimId: 'acs_1',
    observationId: 'obs_1',
    revisionId: 'acr_1',
    relevance: 'ADDRESSES',
    voided: false,
    fidelityLabel: 'ACCURATE',
    attributionLabel: 'NOT_ADDRESSED',
    citationMappings: [mapping('SUPPORTS')],
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
      // Each gap label is paired with the relevance that makes it honest, so the exclusion names the
      // gap rather than a recording conflict. The proposition link is dropped on those rows because a
      // statement that omits, refuses or stands unrelated cannot also assert the target.
      claim({
        claimId: 'e',
        relevance: 'OMISSION',
        fidelityLabel: 'OMITTED',
        propositionRelations: [],
      }),
      claim({
        claimId: 'f',
        relevance: 'REFUSAL',
        fidelityLabel: 'REFUSED',
        propositionRelations: [],
      }),
      claim({
        claimId: 'g',
        relevance: 'UNAVAILABLE',
        fidelityLabel: 'UNAVAILABLE',
        propositionRelations: [],
      }),
      claim({
        claimId: 'h',
        relevance: 'UNRELATED',
        fidelityLabel: 'NOT_ADDRESSED',
        propositionRelations: [],
      }),
      claim({ claimId: 'i', fidelityLabel: 'NOT_ASSESSABLE', propositionRelations: [] }),
      claim({ claimId: 'j', fidelityLabel: undefined, propositionRelations: [] }),
    ]),
  );
  assert.equal(claimLevel.claimFidelityRate.denominator, 4);
  assert.equal(claimLevel.claimFidelityRate.numerator, 1);
  assert.equal(claimLevel.unassessedClaims, 1);
  assert.equal(claimLevel.labelConflictClaims, 0, 'every pair above is internally consistent');
  const reasons = claimLevel.claimFidelityRate.exclusions.map((row) => row.reason).sort();
  assert.deepEqual(reasons, [
    'CLAIM_FIDELITY_UNASSESSED',
    'CLAIM_NOT_ASSESSABLE',
    'CLAIM_OMITTED',
    'CLAIM_REFUSED',
    'CLAIM_UNAVAILABLE',
    'CLAIM_UNRELATED',
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
  // A refusal, an abstention and an omission assert nothing, so nothing cited can support them.
  // Under metrics-v3 these three mappings scored; under the contract they cannot.
  assert.equal(claimLevel.claimCitationSupportRate.denominator, 0);
  assert.deepEqual(
    claimLevel.claimCitationSupportRate.exclusions.map((row) => [row.reason, row.count]),
    [['CLAIM_CITATION_NON_ASSERTING', 3]],
  );
});

test('citation support counts each mapping and never folds partial support into supported', () => {
  const { claimLevel } = block(
    baseInput([
      claim({ claimId: 'a', citationMappings: [mapping('SUPPORTS')] }),
      claim({ claimId: 'b', citationMappings: [mapping('PARTIALLY_SUPPORTS')] }),
      claim({ claimId: 'c', citationMappings: [mapping('SUPPORTS_WITH_CONDITIONS')] }),
      claim({ claimId: 'd', citationMappings: [mapping('DOES_NOT_SUPPORT')] }),
      claim({ claimId: 'e', citationMappings: [mapping('UNCLEAR')] }),
      claim({ claimId: 'f', citationMappings: [mapping('METADATA_MISSING')] }),
      claim({ claimId: 'g', citationMappings: [] }),
      // One statement carried by two citations counts twice, as two separate judgements.
      claim({
        claimId: 'h',
        citationMappings: [
          mapping('SUPPORTS', { citationId: 'cit_1' }),
          mapping('DOES_NOT_SUPPORT', { citationId: 'cit_2' }),
        ],
      }),
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
        citationMappings: [],
        propositionRelations: [],
      }),
      claim({
        claimId: 'b',
        relevance: 'AMBIGUOUS',
        fidelityLabel: undefined,
        citationMappings: [],
        propositionRelations: [],
      }),
    ]),
  );
  assert.match(claimLevel.notes.join(' '), /no factual assertion/);
  assert.equal(claimLevel.claimFidelityRate.value, null);
  // A refusal or an unrelated row with no citation is a complete record, not a missing check.
  assert.deepEqual(claimLevel.claimCitationSupportRate.exclusions, []);
});

test('a refusal carrying an accurate label cannot be scored as an accurate statement', () => {
  const { claimLevel } = block(
    baseInput([
      claim({ claimId: 'live', fidelityLabel: 'ACCURATE' }),
      // The exact shape that metrics-v3 counted: the relevance says the answer refused, the stored
      // label says somebody judged it accurate. This is the regression D-1 exists to stop.
      claim({ claimId: 'refusal', relevance: 'REFUSAL', fidelityLabel: 'ACCURATE' }),
      claim({ claimId: 'omission', relevance: 'OMISSION', fidelityLabel: 'CONTRADICTED' }),
      claim({ claimId: 'unrelated', relevance: 'UNRELATED', fidelityLabel: 'UNSUPPORTED' }),
    ]),
  );
  assert.equal(
    claimLevel.claimFidelityRate.denominator,
    1,
    'only the genuinely asserting statement is scored',
  );
  assert.equal(claimLevel.claimFidelityRate.numerator, 1);
  assert.equal(claimLevel.claimContradictionRate.numerator, 0);
  assert.equal(claimLevel.claimUnsupportedRate.numerator, 0);
  assert.equal(claimLevel.labelConflictClaims, 3);
  assert.deepEqual(
    claimLevel.claimFidelityRate.exclusions
      .filter((row) => row.reason === 'CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE')
      .map((row) => row.count),
    [3],
  );
  assert.match(claimLevel.notes.join(' '), /Relevance decides whether a statement asserts/);
});

test('a voided statement is excluded with a reason instead of vanishing from the report', () => {
  const { claimLevel } = block(
    baseInput([
      claim({ claimId: 'live', fidelityLabel: 'ACCURATE' }),
      claim({ claimId: 'gone', voided: true, fidelityLabel: 'CONTRADICTED' }),
    ]),
  );
  assert.equal(claimLevel.claimFidelityRate.denominator, 1);
  assert.equal(claimLevel.claimFidelityRate.numerator, 1);
  assert.equal(claimLevel.voidedClaims, 1);
  assert.deepEqual(
    claimLevel.claimFidelityRate.exclusions
      .filter((row) => row.reason === 'CLAIM_VOIDED')
      .map((row) => row.count),
    [1],
    'the exclusion is named so a reader can see the record was withdrawn rather than absent',
  );
  assert.match(claimLevel.notes.join(' '), /1 statement\(s\) were voided/);
});

test('voiding every statement on an answer leaves it undecomposed, not covered', () => {
  const { claimLevel } = block(baseInput([claim({ claimId: 'gone', voided: true })]));
  assert.equal(claimLevel.observationsWithClaims, 0);
  assert.equal(claimLevel.decompositionCoverage.numerator, 0);
  assert.equal(claimLevel.decompositionCoverage.denominator, 1);
  assert.equal(claimLevel.claimFidelityRate.denominator, 0);
  assert.equal(claimLevel.voidedClaims, 1);
});

test('a citation voided after the mapping was recorded stops supporting the statement', () => {
  const { claimLevel } = block(
    baseInput([
      claim({ claimId: 'live', citationMappings: [mapping('SUPPORTS')] }),
      claim({
        claimId: 'withdrawn',
        citationMappings: [mapping('SUPPORTS', { citationId: 'cit_9', citationVoided: true })],
      }),
    ]),
  );
  assert.equal(claimLevel.claimCitationSupportRate.denominator, 1);
  assert.equal(claimLevel.claimCitationSupportRate.numerator, 1);
  assert.deepEqual(
    claimLevel.claimCitationSupportRate.exclusions
      .filter((row) => row.reason === 'CLAIM_CITATION_VOIDED')
      .map((row) => row.count),
    [1],
    'the withdrawn mapping is reported, not quietly deleted from the record',
  );
});

test('an unrelated statement cannot manufacture a relevant omission', () => {
  const { claimLevel } = block(
    baseInput([
      claim({
        claimId: 'unrelated',
        relevance: 'UNRELATED',
        fidelityLabel: undefined,
        citationMappings: [],
        propositionRelations: [{ propositionId: 'prp_x', relation: 'OMITS_TARGET' }],
      }),
      claim({
        claimId: 'refusal',
        relevance: 'REFUSAL',
        fidelityLabel: undefined,
        citationMappings: [],
        propositionRelations: [{ propositionId: 'prp_y', relation: 'OMITS_TARGET' }],
      }),
      claim({
        claimId: 'real',
        relevance: 'OMISSION',
        fidelityLabel: undefined,
        citationMappings: [],
        propositionRelations: [{ propositionId: 'prp_z', relation: 'OMITS_TARGET' }],
      }),
    ]),
  );
  assert.equal(claimLevel.relevantOmissionRate.numerator, 1);
  assert.equal(claimLevel.relevantOmissionRate.denominator, 1);
  assert.deepEqual(
    claimLevel.relevantOmissionRate.exclusions
      .filter((row) => row.reason === 'CLAIM_OMISSION_NON_ENGAGING')
      .map((row) => row.count),
    [2],
  );
});

test('an inconsistent proposition link is reported as a conflict, never silently dropped', () => {
  const { claimLevel } = block(
    baseInput([
      claim({
        claimId: 'contradicts-self',
        relevance: 'ADDRESSES',
        propositionRelations: [{ propositionId: 'prp_1', relation: 'OMITS_TARGET' }],
      }),
    ]),
  );
  assert.equal(claimLevel.relevantOmissionRate.denominator, 0);
  assert.equal(claimLevel.labelConflictClaims, 1);
});

test('a label on the wrong side of the relevance line cannot rescue an unassessed statement', () => {
  // Attribution and fidelity disagree about whether anything was asserted; both must fall out.
  const { claimLevel } = block(
    baseInput([
      claim({
        claimId: 'a',
        relevance: 'ABSTENTION',
        fidelityLabel: 'PARTIALLY_ACCURATE',
        attributionLabel: 'WRONG_PERSON',
      }),
    ]),
  );
  assert.equal(claimLevel.claimFidelityRate.denominator, 0);
  assert.equal(claimLevel.claimAttributionRate.denominator, 0);
  assert.equal(claimLevel.labelConflictClaims, 1);
  assert.equal(claimLevel.unassessedClaims, 0, 'a conflict is not the same thing as a gap');
});
