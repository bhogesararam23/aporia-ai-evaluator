import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReportSnapshot } from '../../src/reporting/snapshot.ts';
import { baseInput, observation, runInput } from '../helpers/reporting.ts';

test('builds a reproducible snapshot with separate evidence conclusions', () => {
  const snapshot = buildReportSnapshot(baseInput());
  assert.equal(snapshot.schemaVersion, 'report-snapshot-v1');
  assert.equal(snapshot.report.number, 1);
  assert.equal(snapshot.report.metricsVersion, 'metrics-v1');
  assert.equal(snapshot.claims.length, 1);
  const first = snapshot.claims[0]?.propositions[0];
  assert.equal(first?.derivedStatus.status, 'CONFLICTING_EVIDENCE');
  assert.equal(first?.humanAssessment?.label, 'SUPPORTED_WITHIN_SCOPE');
  assert.equal(first?.primaryConclusion.method, 'HUMAN');
  assert.equal(first?.disagreement, true);
  assert.equal(first?.evidence.length, 2);
  assert.equal(snapshot.claims[0]?.propositions[1]?.primaryConclusion.status, 'NOT_ASSESSED');
  assert.equal(snapshot.coverage.unassessedPropositions, 1);
  assert.equal(snapshot.coverage.claimsWithoutPropositions, 0);
  assert.equal(snapshot.runs.length, 1);
  const metrics = snapshot.runs[0]?.metrics;
  assert.equal(metrics?.mentionRate.numerator, 2);
  assert.equal(metrics?.mentionRate.denominator, 2);
  assert.equal(metrics?.claimFidelityRate.value, 1);
  assert.equal(metrics?.citationSupportRate.value, 1);
  assert.equal(metrics?.attributionCorrectnessRate.value, 1);
  assert.equal(metrics?.observedAnswerCoverage.value, 1);
  assert.equal(snapshot.comparisons.length, 1);
  assert.equal(snapshot.comparisons[0]?.comparable, false);
  assert.equal(
    snapshot.remediation.some((item) => item.id === 'proposition.prp_1.conflict'),
    true,
  );
  assert.equal(
    snapshot.remediation.some((item) => item.id === 'proposition.prp_2.unassessed'),
    true,
  );
  assert.equal(
    snapshot.remediation.some((item) => item.id === 'audit.wsa_1.meta_robots_noindex.blocking'),
    true,
  );
  assert.ok(snapshot.limitations.some((item) => /manually captured/.test(item)));
  assert.ok(snapshot.limitations.some((item) => /supplied HTML bytes/.test(item)));
  assert.equal(snapshot.unavailableChecks.length, 1);
  assert.equal(snapshot.audit.eventCount, 12);
  assert.equal('score' in snapshot, false);
});

test('snapshot construction is deterministic', () => {
  const first = buildReportSnapshot(baseInput());
  const second = buildReportSnapshot(baseInput());
  assert.deepEqual(first, second);
});

test('compares only finalized runs with identical query sets and configuration', () => {
  const input = baseInput();
  const first = runInput('run_1', 'FINALIZED', '2026-10-06T10:00:00.000Z');
  const secondObservation = observation('obs_3', 'qry_1', {
    assessments: [
      {
        id: 'oasm_3_p',
        dimension: 'PRESENCE',
        version: 1,
        label: 'NOT_MENTIONED',
        rationale: 'The answer omits the entity.',
        reviewer: 'Ram',
        attributionRole: null,
        createdAt: '2026-10-08T10:00:00.000Z',
      },
    ],
  });
  const second = {
    ...runInput('run_2', 'FINALIZED', '2026-10-07T10:00:00.000Z'),
    observations: [secondObservation],
  };
  const snapshot = buildReportSnapshot({ ...input, runs: [first, second] });
  assert.equal(snapshot.runs.length, 2);
  const comparison = snapshot.comparisons.find((item) => item.runId === 'run_2');
  assert.equal(comparison?.comparable, true);
  assert.equal(comparison?.priorRunId, 'run_1');
  const mention = comparison?.metricDeltas.find((item) => item.metricId === 'mention_rate');
  assert.equal(mention?.current, 0);
  assert.equal(mention?.prior, 1);
  assert.equal(mention?.delta, -1);
});

test('records non-comparability when provider conditions differ', () => {
  const input = baseInput();
  const first = runInput('run_1', 'FINALIZED', '2026-10-06T10:00:00.000Z');
  const baseSecond = runInput('run_2', 'FINALIZED', '2026-10-07T10:00:00.000Z');
  const second = {
    ...baseSecond,
    run: { ...baseSecond.run, providerLabel: 'Different assistant' },
  };
  const snapshot = buildReportSnapshot({ ...input, runs: [first, second] });
  const comparison = snapshot.comparisons.find((item) => item.runId === 'run_2');
  assert.equal(comparison?.comparable, false);
  assert.match(comparison?.reasons[0] ?? '', /differs/);
});

test('open and cancelled runs are counted but excluded from metrics', () => {
  const input = baseInput();
  const openRun = runInput('run_2', 'OPEN');
  const cancelledBase = runInput('run_3', 'OPEN');
  const cancelledRun = {
    ...cancelledBase,
    run: {
      ...cancelledBase.run,
      status: 'CANCELLED' as const,
      cancelledAt: '2026-10-07T10:00:00.000Z',
      cancelReason: 'Wrong set.',
    },
  };
  const snapshot = buildReportSnapshot({
    ...input,
    runs: [runInput('run_1', 'FINALIZED'), openRun, cancelledRun],
  });
  assert.equal(snapshot.runs.length, 1);
  assert.equal(snapshot.coverage.finalizedRuns, 1);
  assert.equal(snapshot.coverage.openRuns, 1);
  assert.equal(snapshot.coverage.cancelledRuns, 1);
});
