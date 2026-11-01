import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReportSnapshot, comparabilityReasons } from '../../src/reporting/snapshot.ts';
import { metricsCsv } from '../../src/reporting/csv.ts';
import { renderReport } from '../../src/app/views/report.ts';
import { answerClaim, baseInput, observation, runInput } from '../helpers/reporting.ts';
import type { ReportBuildInput, ReportRunView } from '../../src/reporting/types.ts';

function inputWithClaims(
  claimsByObservation: Record<string, ReturnType<typeof answerClaim>[]>,
  overrides: Partial<ReportBuildInput> = {},
): ReportBuildInput {
  const base = baseInput();
  return {
    ...base,
    ...overrides,
    runs: base.runs.map((run) => ({
      ...run,
      observations: run.observations.map((row) => ({
        ...row,
        answerClaims: claimsByObservation[row.id] ?? [],
      })),
    })),
  };
}

function firstRun(snapshot: ReturnType<typeof buildReportSnapshot>): ReportRunView {
  const run = snapshot.runs[0];
  assert.ok(run);
  return run;
}

test('a run without decomposed answers has no claim-level block and says so', () => {
  const snapshot = buildReportSnapshot(baseInput());
  const run = firstRun(snapshot);
  assert.equal(run.metrics.claimLevel, undefined);
  assert.deepEqual(
    Object.keys(snapshot.coverage).includes('answerClaims'),
    true,
    'coverage still reports the claim-level counts',
  );
  assert.equal(snapshot.coverage.answerClaims, 0);
  assert.equal(snapshot.coverage.decomposedObservations, 0);
  assert.ok(
    snapshot.limitations.some((line) =>
      /none were recorded, not that the answers were wrong/.test(line),
    ),
    'the absence must be explained, not left as a silent gap',
  );
});

test('recorded statements produce the claim-level block and coverage counts', () => {
  const snapshot = buildReportSnapshot(
    inputWithClaims({
      obs_1: [answerClaim('acs_1'), answerClaim('acs_2', { ordinal: 2, labels: {} })],
      obs_2: [
        answerClaim('acs_3', {
          ordinal: 1,
          quoteText: 'nobody knows',
          relevance: 'ABSTENTION',
          propositionLinks: [{ propositionId: 'prp_1', relation: 'ABSTAINS_TARGET' }],
          citationSupports: [],
          labels: { FIDELITY: 'REFUSED' },
        }),
      ],
    }),
  );
  const run = firstRun(snapshot);
  const claimLevel = run.metrics.claimLevel;
  assert.notEqual(claimLevel, undefined);
  if (claimLevel === undefined) {
    return;
  }
  // acs_1 is accurate; acs_2 has no label; acs_3 is a refusal, which is never a factual verdict.
  assert.equal(claimLevel.claimFidelityRate.numerator, 1);
  assert.equal(claimLevel.claimFidelityRate.denominator, 1);
  assert.equal(claimLevel.unassessedClaims, 1);
  assert.equal(claimLevel.observationsWithClaims, 2);
  assert.equal(snapshot.coverage.answerClaims, 3);
  assert.equal(snapshot.coverage.assessedAnswerClaims, 2);
  assert.equal(snapshot.coverage.decomposedObservations, 2);
  assert.equal(snapshot.coverage.citationClaimMappings, 2);
  assert.equal(claimLevel.partiallyDecomposedObservations, 1);
});

test('a voided statement stays readable but leaves every denominator', () => {
  const snapshot = buildReportSnapshot(
    inputWithClaims({
      obs_1: [
        answerClaim('acs_1'),
        answerClaim('acs_2', { ordinal: 2, voidedAt: '2026-10-09T10:00:00.000Z' }),
      ],
      obs_2: [],
    }),
  );
  const run = firstRun(snapshot);
  const claimLevel = run.metrics.claimLevel;
  assert.notEqual(claimLevel, undefined);
  assert.equal(snapshot.coverage.answerClaims, 1, 'only the live statement is counted');
  const observations = run.observations.filter((row) => row.id === 'obs_1');
  assert.equal(observations.length, 1);
  assert.equal(
    (observations[0]?.answerClaims ?? []).length,
    2,
    'the voided row is still in the snapshot',
  );
});

test('an excluded observation names its statements as ineligible rather than dropping them', () => {
  const snapshot = buildReportSnapshot({
    ...inputWithClaims({
      obs_1: [answerClaim('acs_1')],
      obs_2: [answerClaim('acs_2')],
    }),
    runs: [
      {
        ...runInput('run_1'),
        observations: [
          observation('obs_1', 'qry_1', { answerClaims: [answerClaim('acs_1')] }),
          // A refusal is a real captured answer that a reviewer can decompose, and it is outside
          // answer scoring. Its statements must be excluded with a stated reason.
          observation('obs_2', 'qry_2', {
            status: 'REFUSAL',
            answerText: 'I cannot say who created it.',
            answerClaims: [
              answerClaim('acs_2', {
                quoteText: 'I cannot say who created it.',
                relevance: 'REFUSAL',
                labels: { FIDELITY: 'REFUSED' },
              }),
            ],
          }),
        ],
      },
    ],
  });
  const run = firstRun(snapshot);
  const claimLevel = run.metrics.claimLevel;
  assert.notEqual(claimLevel, undefined);
  if (claimLevel === undefined) {
    return;
  }
  assert.equal(claimLevel.eligibleObservations, 1);
  assert.equal(claimLevel.observationsWithClaims, 1);
  assert.equal(
    claimLevel.decompositionCoverage.exclusions.some(
      (exclusion) => exclusion.reason === 'CLAIM_OBSERVATION_INELIGIBLE',
    ),
    true,
    'the excluded statement must be named, not quietly dropped',
  );
});

test('comparability is decided in one shared helper', () => {
  const base = firstRun(buildReportSnapshot(baseInput()));
  assert.deepEqual(comparabilityReasons({ prior: base, current: base }), []);
  // The pair is named, not positional, and the sentence reads in time order: earlier value first.
  assert.deepEqual(
    comparabilityReasons({ prior: base, current: { ...base, modelLabel: 'other' } }),
    ['The model or version label differs: "unknown-model" then, "other" now.'],
  );
  const reasons = comparabilityReasons({
    prior: base,
    current: { ...base, locale: 'fr', groundingMode: 'NO_SEARCH' },
  });
  assert.equal(reasons.length, 2);
  assert.ok(
    reasons.every((reason) => reason.length > 10),
    'each condition is stated in plain language',
  );
});

test('a claim-level delta is withheld when only one side decomposed its answers', () => {
  const decomposed = runInput('run_1');
  const observations = decomposed.observations.map((row) => ({
    ...row,
    answerClaims: [answerClaim(`acs_${row.id}`)],
  }));
  const snapshot = buildReportSnapshot({
    ...baseInput(),
    runs: [
      { ...decomposed, run: { ...decomposed.run, id: 'run_1' }, observations },
      // Same query set and identical declared configuration, but nobody decomposed these answers.
      {
        ...decomposed,
        run: { ...decomposed.run, id: 'run_2', createdAt: '2026-10-09T10:00:00.000Z' },
        observations: decomposed.observations.map((row) => ({ ...row, answerClaims: [] })),
      },
    ],
  });
  const comparison = snapshot.comparisons.find((row) => row.runId === 'run_2');
  assert.ok(comparison, 'the later run should have a prior to compare against');
  assert.equal(comparison.comparable, true, 'the runs are still configuration-comparable overall');
  assert.ok(
    comparison.reasons.some((reason) => /one side has no recorded answer statements/.test(reason)),
    comparison.reasons.join(' | '),
  );
  // Observation-level deltas remain available; only the statement comparison is withheld.
  assert.ok(comparison.metricDeltas.length > 0);
});

test('metrics csv carries the claim-level rows with their units and exclusions', () => {
  const snapshot = buildReportSnapshot(
    inputWithClaims({
      obs_1: [answerClaim('acs_1'), answerClaim('acs_2', { ordinal: 2, labels: {} })],
      obs_2: [],
    }),
  );
  const csv = metricsCsv(snapshot);
  assert.match(csv, /answer_statement_fidelity_rate/);
  assert.match(csv, /answer_decomposition_coverage/);
  assert.match(csv, /relevant_omission_rate/);
  assert.match(csv, /answer statements/);
  assert.match(csv, /claim-citation mappings/);
  assert.match(csv, /propositions/);
  // The whole-answer family keeps its own identifiers untouched, and each appears once per run.
  assert.equal(csv.split('"claim_fidelity_rate"').length - 1, 1);
  assert.equal(csv.split('"answer_statement_fidelity_rate"').length - 1, 1);
  // A metric absent from a v2 snapshot simply does not appear.
  const plain = metricsCsv(buildReportSnapshot(baseInput()));
  assert.doesNotMatch(plain, /answer_statement_fidelity_rate/);
  assert.match(plain, /mention_rate/);
});

test('no claim-level metric identifier collides with an observation-level one', () => {
  const snapshot = buildReportSnapshot(
    inputWithClaims({ obs_1: [answerClaim('acs_1')], obs_2: [] }),
  );
  const run = firstRun(snapshot);
  const observationLevel = [
    run.metrics.mentionRate,
    run.metrics.targetSourceCitationRate,
    run.metrics.anySourceCitationRate,
    run.metrics.citationSupportRate,
    run.metrics.claimFidelityRate,
    run.metrics.attributionCorrectnessRate,
    run.metrics.observedAnswerCoverage,
  ].map((metric) => metric.id);
  const claimLevel = run.metrics.claimLevel;
  assert.notEqual(claimLevel, undefined);
  if (claimLevel === undefined) {
    return;
  }
  const claimIds = [
    claimLevel.decompositionCoverage,
    claimLevel.claimFidelityRate,
    claimLevel.claimContradictionRate,
    claimLevel.claimUnsupportedRate,
    claimLevel.claimCitationSupportRate,
    claimLevel.claimAttributionRate,
    claimLevel.relevantOmissionRate,
  ].map((metric) => metric.id);
  // Two rows in one export sharing an id but meaning different units would be unreadable.
  assert.deepEqual(
    claimIds.filter((id) => observationLevel.includes(id)),
    [],
  );
  assert.equal(
    new Set([...observationLevel, ...claimIds]).size,
    observationLevel.length + claimIds.length,
  );
});

test('the rendered report shows the statement section, and explains its absence otherwise', () => {
  const withClaims = buildReportSnapshot(
    inputWithClaims({ obs_1: [answerClaim('acs_1')], obs_2: [] }),
  );
  const text = renderReport(withClaims).value;
  assert.match(text, /Answer statements/);
  assert.match(text, /Statement-level metrics for/);
  assert.match(text, /created by Ram/);
  assert.match(text, /read the unit column/);

  const plainText = renderReport(buildReportSnapshot(baseInput())).value;
  assert.match(plainText, /no statement-level figure is available/);
  assert.doesNotMatch(plainText, /claim_fidelity_rate|Statement-level metrics for/);
});
