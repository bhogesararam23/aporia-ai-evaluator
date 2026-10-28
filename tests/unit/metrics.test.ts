import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeRunMetrics,
  EXCLUSION_REASONS,
  type CitationInput,
  type ObservationAssessmentInput,
  type ObservationInput,
  type QueryInput,
  type RunMetricsInput,
} from '../../src/core/metrics.ts';

function presence(
  label: 'MENTIONED' | 'NOT_MENTIONED' | 'NOT_ASSESSABLE',
  version = 1,
): ObservationAssessmentInput {
  return { dimension: 'PRESENCE', label, version };
}

function fidelity(
  label: 'ACCURATE' | 'PARTIALLY_ACCURATE' | 'CONTRADICTED' | 'UNSUPPORTED' | 'NOT_ASSESSABLE',
  version = 1,
): ObservationAssessmentInput {
  return { dimension: 'FIDELITY', label, version };
}

function citationSupport(
  label: 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'NOT_SUPPORTED' | 'NOT_ASSESSABLE',
  version = 1,
): ObservationAssessmentInput {
  return { dimension: 'CITATION_SUPPORT', label, version };
}

function attribution(
  label: 'CORRECT' | 'PARTIALLY_CORRECT' | 'INCORRECT' | 'NOT_ADDRESSED' | 'NOT_ASSESSABLE',
  version = 1,
): ObservationAssessmentInput {
  return { dimension: 'ATTRIBUTION', label, version };
}

function citation(id: string, targetOwned: boolean, voided = false): CitationInput {
  return { id, targetOwned, voided };
}

function observation(
  id: string,
  queryId: string,
  overrides: Partial<ObservationInput> = {},
): ObservationInput {
  return {
    id,
    queryId,
    status: 'COMPLETED',
    voided: false,
    citationCapture: 'CAPTURED',
    citations: [],
    assessments: [],
    ...overrides,
  };
}

const queries: QueryInput[] = [
  { id: 'q1', intent: 'DISCOVERY' },
  { id: 'q2', intent: 'FACTUAL_VERIFICATION' },
  { id: 'q3', intent: 'ATTRIBUTION' },
];

function baseInput(): RunMetricsInput {
  return {
    runStatus: 'FINALIZED',
    queries,
    observations: [
      observation('o1', 'q1', {
        citations: [citation('c1', true)],
        assessments: [
          presence('MENTIONED'),
          fidelity('ACCURATE'),
          citationSupport('SUPPORTED'),
          attribution('CORRECT'),
        ],
      }),
      observation('o2', 'q2', {
        citations: [citation('c2', false)],
        assessments: [
          presence('NOT_MENTIONED'),
          fidelity('PARTIALLY_ACCURATE'),
          citationSupport('PARTIALLY_SUPPORTED'),
          attribution('NOT_ADDRESSED'),
        ],
      }),
      observation('o3', 'q3', { status: 'ERROR', citationCapture: 'UNKNOWN' }),
      observation('o4', 'q3', { status: 'REFUSAL', citationCapture: 'UNKNOWN' }),
    ],
  };
}

function exclusionCount(
  metric: { exclusions: readonly { reason: string; count: number }[] },
  reason: string,
): number {
  return metric.exclusions.find((exclusion) => exclusion.reason === reason)?.count ?? 0;
}

test('computes separate rates with explicit denominators and exclusions', () => {
  const metrics = computeRunMetrics(baseInput());

  assert.deepEqual(
    {
      numerator: metrics.mentionRate.numerator,
      denominator: metrics.mentionRate.denominator,
      value: metrics.mentionRate.value,
    },
    { numerator: 1, denominator: 2, value: 0.5 },
  );
  assert.equal(metrics.mentionRate.breakdown?.['MENTIONED'], 1);
  assert.equal(metrics.mentionRate.breakdown?.['NOT_MENTIONED'], 1);

  assert.equal(metrics.targetSourceCitationRate.numerator, 1);
  assert.equal(metrics.targetSourceCitationRate.denominator, 2);
  assert.equal(metrics.anySourceCitationRate.numerator, 2);
  assert.equal(metrics.anySourceCitationRate.denominator, 2);

  assert.equal(metrics.citationSupportRate.numerator, 1);
  assert.equal(metrics.citationSupportRate.denominator, 2);
  assert.equal(metrics.citationSupportRate.breakdown?.['PARTIALLY_SUPPORTED'], 1);

  assert.equal(metrics.claimFidelityRate.numerator, 1);
  assert.equal(metrics.claimFidelityRate.denominator, 2);
  assert.equal(metrics.claimFidelityRate.breakdown?.['PARTIALLY_ACCURATE'], 1);

  assert.equal(metrics.attributionCorrectnessRate.numerator, 1);
  assert.equal(metrics.attributionCorrectnessRate.denominator, 1);
  assert.equal(exclusionCount(metrics.attributionCorrectnessRate, 'ATTRIBUTION_NOT_ADDRESSED'), 1);

  assert.equal(metrics.observedAnswerCoverage.numerator, 1);
  assert.equal(metrics.observedAnswerCoverage.denominator, 2);
  assert.equal(metrics.observedAnswerCoverage.value, 0.5);
  assert.equal(exclusionCount(metrics.observedAnswerCoverage, 'QUERY_UNTESTED'), 1);
});

test('errors and refusals are excluded, never counted as negative answers', () => {
  const metrics = computeRunMetrics(baseInput());
  assert.equal(exclusionCount(metrics.mentionRate, 'PROVIDER_ERROR'), 1);
  assert.equal(exclusionCount(metrics.mentionRate, 'POLICY_REFUSAL'), 1);
  assert.equal(metrics.coverage.observationsRecorded, 4);
  assert.equal(metrics.coverage.eligibleObservations, 2);
  assert.equal(metrics.coverage.exclusions.find((e) => e.reason === 'PROVIDER_ERROR')?.count, 1);
  assert.equal(metrics.coverage.exclusions.find((e) => e.reason === 'POLICY_REFUSAL')?.count, 1);
  assert.equal(
    metrics.mentionRate.denominator +
      metrics.mentionRate.exclusions.reduce((sum, e) => sum + e.count, 0),
    4,
  );
});

test('coverage distinguishes tested, untested, and unassessed query intents', () => {
  const metrics = computeRunMetrics(baseInput());
  assert.equal(metrics.coverage.plannedQueries, 3);
  assert.equal(metrics.coverage.testedQueries, 2);
  assert.equal(metrics.coverage.untestedQueries, 1);
  assert.deepEqual(
    metrics.coverage.byQuery.map((query) => [query.queryId, query.status]),
    [
      ['q1', 'TESTED_COVERED'],
      ['q2', 'TESTED_NOT_MENTIONED'],
      ['q3', 'UNTESTED'],
    ],
  );
});

test('voided observations are retained for coverage but excluded from rates', () => {
  const metrics = computeRunMetrics({
    runStatus: 'FINALIZED',
    queries: [queries[0] as QueryInput],
    observations: [
      observation('o1', 'q1', {
        voided: true,
        assessments: [presence('MENTIONED'), fidelity('ACCURATE')],
      }),
    ],
  });
  assert.equal(metrics.coverage.observationsVoided, 1);
  assert.equal(metrics.coverage.eligibleObservations, 0);
  assert.equal(metrics.mentionRate.denominator, 0);
  assert.equal(metrics.mentionRate.numerator, null);
  assert.equal(metrics.mentionRate.value, null);
  assert.equal(exclusionCount(metrics.mentionRate, 'VOIDED_OBSERVATION'), 1);
  assert.equal(metrics.observedAnswerCoverage.value, null);
  assert.equal(exclusionCount(metrics.observedAnswerCoverage, 'QUERY_UNTESTED'), 1);
});

test('missing citation metadata is excluded from citation denominators', () => {
  const metrics = computeRunMetrics({
    runStatus: 'FINALIZED',
    queries: [queries[0] as QueryInput],
    observations: [
      observation('o1', 'q1', {
        citationCapture: 'NOT_SHOWN',
        assessments: [presence('MENTIONED')],
      }),
    ],
  });
  assert.equal(metrics.targetSourceCitationRate.denominator, 0);
  assert.equal(metrics.targetSourceCitationRate.value, null);
  assert.equal(metrics.anySourceCitationRate.denominator, 0);
  assert.equal(
    exclusionCount(metrics.targetSourceCitationRate, 'CITATION_METADATA_UNAVAILABLE'),
    1,
  );
  assert.equal(exclusionCount(metrics.citationSupportRate, 'CITATION_METADATA_UNAVAILABLE'), 1);
});

test('captured citation metadata with no citations is a known zero', () => {
  const metrics = computeRunMetrics({
    runStatus: 'FINALIZED',
    queries: [queries[0] as QueryInput],
    observations: [observation('o1', 'q1', { assessments: [presence('MENTIONED')] })],
  });
  assert.equal(metrics.targetSourceCitationRate.numerator, 0);
  assert.equal(metrics.targetSourceCitationRate.denominator, 1);
  assert.equal(metrics.targetSourceCitationRate.value, 0);
  assert.equal(metrics.anySourceCitationRate.value, 0);
  assert.equal(exclusionCount(metrics.citationSupportRate, 'NO_ACTIVE_CITATIONS'), 1);
});

test('unassessed dimensions remain unknown rather than zero', () => {
  const metrics = computeRunMetrics({
    runStatus: 'FINALIZED',
    queries: [queries[0] as QueryInput],
    observations: [observation('o1', 'q1')],
  });
  assert.equal(metrics.mentionRate.denominator, 0);
  assert.equal(metrics.mentionRate.value, null);
  assert.equal(exclusionCount(metrics.mentionRate, 'PRESENCE_UNASSESSED'), 1);
  assert.equal(metrics.claimFidelityRate.denominator, 0);
  assert.equal(metrics.claimFidelityRate.value, null);
  assert.equal(exclusionCount(metrics.claimFidelityRate, 'FIDELITY_UNASSESSED'), 1);
  assert.equal(metrics.attributionCorrectnessRate.denominator, 0);
  assert.equal(exclusionCount(metrics.attributionCorrectnessRate, 'ATTRIBUTION_UNASSESSED'), 1);
  assert.equal(metrics.observedAnswerCoverage.denominator, 0);
  assert.equal(metrics.observedAnswerCoverage.value, null);
  assert.equal(exclusionCount(metrics.observedAnswerCoverage, 'QUERY_PRESENCE_UNASSESSED'), 1);
  assert.equal(metrics.coverage.byQuery[0]?.status, 'TESTED_UNASSESSED');
});

test('not-assessable labels are excluded with distinct reasons', () => {
  const metrics = computeRunMetrics({
    runStatus: 'FINALIZED',
    queries: [queries[0] as QueryInput],
    observations: [
      observation('o1', 'q1', {
        citations: [citation('c1', true)],
        assessments: [
          presence('NOT_ASSESSABLE'),
          fidelity('NOT_ASSESSABLE'),
          citationSupport('NOT_ASSESSABLE'),
          attribution('NOT_ASSESSABLE'),
        ],
      }),
    ],
  });
  assert.equal(exclusionCount(metrics.mentionRate, 'PRESENCE_NOT_ASSESSABLE'), 1);
  assert.equal(exclusionCount(metrics.claimFidelityRate, 'FIDELITY_NOT_ASSESSABLE'), 1);
  assert.equal(exclusionCount(metrics.citationSupportRate, 'CITATION_SUPPORT_NOT_ASSESSABLE'), 1);
  assert.equal(exclusionCount(metrics.attributionCorrectnessRate, 'ATTRIBUTION_NOT_ASSESSABLE'), 1);
  assert.equal(metrics.targetSourceCitationRate.denominator, 1);
});

test('the latest assessment version determines the outcome', () => {
  const metrics = computeRunMetrics({
    runStatus: 'FINALIZED',
    queries: [queries[0] as QueryInput],
    observations: [
      observation('o1', 'q1', {
        assessments: [presence('MENTIONED', 1), presence('NOT_MENTIONED', 2)],
      }),
    ],
  });
  assert.equal(metrics.mentionRate.numerator, 0);
  assert.equal(metrics.mentionRate.denominator, 1);
  assert.equal(metrics.mentionRate.value, 0);
});

test('open runs produce a preview note but no data fabrication', () => {
  const metrics = computeRunMetrics({ ...baseInput(), runStatus: 'OPEN' });
  assert.ok(metrics.notes.some((note) => /Preview only/.test(note)));
  assert.equal(metrics.mentionRate.denominator, 2);
});

test('no eligible observations yields explicit unknown rates', () => {
  const metrics = computeRunMetrics({
    runStatus: 'FINALIZED',
    queries: [queries[0] as QueryInput],
    observations: [],
  });
  for (const metric of [
    metrics.mentionRate,
    metrics.targetSourceCitationRate,
    metrics.anySourceCitationRate,
    metrics.citationSupportRate,
    metrics.claimFidelityRate,
    metrics.attributionCorrectnessRate,
    metrics.observedAnswerCoverage,
  ]) {
    assert.equal(metric.numerator, null);
    assert.equal(metric.denominator, 0);
    assert.equal(metric.value, null);
    assert.ok(metric.definition.length > 0);
  }
  assert.equal(metrics.coverage.untestedQueries, 1);
});

test('metrics are deterministic and ignore unrelated commercial state', () => {
  const metrics = computeRunMetrics(baseInput());
  const again = computeRunMetrics(baseInput());
  assert.deepEqual(metrics, again);

  const withCommercialState = {
    ...baseInput(),
    commercialPlan: 'enterprise',
    invoiceStatus: 'paid',
  } as RunMetricsInput;
  assert.deepEqual(computeRunMetrics(withCommercialState), metrics);
});

test('the output contains no composite score', () => {
  const metrics = computeRunMetrics(baseInput()) as unknown as Record<string, unknown>;
  assert.equal('score' in metrics, false);
  assert.equal('composite' in metrics, false);
  assert.deepEqual(Object.keys(metrics).sort(), [
    'anySourceCitationRate',
    'attributionCorrectnessRate',
    'citationSupportRate',
    'claimFidelityRate',
    'coverage',
    'mentionRate',
    'notes',
    'observedAnswerCoverage',
    'runStatus',
    'targetSourceCitationRate',
    'version',
  ]);
});

test('observation metrics partition every observation into assessed or excluded', () => {
  const metrics = computeRunMetrics(baseInput());
  for (const metric of [
    metrics.mentionRate,
    metrics.targetSourceCitationRate,
    metrics.anySourceCitationRate,
    metrics.citationSupportRate,
    metrics.claimFidelityRate,
    metrics.attributionCorrectnessRate,
  ]) {
    const excluded = metric.exclusions.reduce((sum, exclusion) => sum + exclusion.count, 0);
    assert.equal(metric.denominator + excluded, 4, metric.id);
  }
  const coverageExcluded = metrics.observedAnswerCoverage.exclusions.reduce(
    (sum, exclusion) => sum + exclusion.count,
    0,
  );
  assert.equal(metrics.observedAnswerCoverage.denominator + coverageExcluded, 3);
});

test('all exclusion reasons have descriptions', () => {
  const metrics = computeRunMetrics(baseInput());
  assert.ok(EXCLUSION_REASONS.length > 0);
  for (const exclusion of [
    ...metrics.mentionRate.exclusions,
    ...metrics.citationSupportRate.exclusions,
    ...metrics.observedAnswerCoverage.exclusions,
  ]) {
    assert.ok(exclusion.description.length > 0);
  }
});

test('observations referencing unknown queries fail loudly', () => {
  assert.throws(
    () =>
      computeRunMetrics({
        runStatus: 'FINALIZED',
        queries: [queries[0] as QueryInput],
        observations: [observation('o1', 'missing-query')],
      }),
    /unknown query/,
  );
});

test('partial citation support is reported separately from supported', () => {
  const metrics = computeRunMetrics({
    runStatus: 'FINALIZED',
    queries: [queries[0] as QueryInput],
    observations: [
      observation('o1', 'q1', {
        citations: [citation('c1', true)],
        assessments: [citationSupport('PARTIALLY_SUPPORTED')],
      }),
    ],
  });
  assert.equal(metrics.citationSupportRate.numerator, 0);
  assert.equal(metrics.citationSupportRate.denominator, 1);
  assert.equal(metrics.citationSupportRate.value, 0);
  assert.equal(metrics.citationSupportRate.breakdown?.['PARTIALLY_SUPPORTED'], 1);
});
