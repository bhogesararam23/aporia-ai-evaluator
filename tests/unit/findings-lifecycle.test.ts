import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FINDING_STATUS_DESCRIPTIONS,
  FINDING_STATUS_LABELS,
  FINDING_STATUSES,
  FINDING_TRANSITIONS,
  MEASUREMENT_ONLY_STATUSES,
  isFindingTransition,
  isMeasurementOnlyStatus,
  requiresClosureRationale,
  statusAllowedForOutcome,
} from '../../src/core/findings.ts';
import {
  CAUSAL_BOUNDARY,
  claimComparisonNote,
  COMPARISON_METRICS,
  comparabilityReasons,
  directionFor,
  isFocusMetric,
  outcomeFromComparison,
  polarityOf,
  rowDirection,
  type MetricComparisonRow,
} from '../../src/core/runComparison.ts';

function config(overrides: Record<string, unknown> = {}) {
  return {
    querySetId: 'qst_1',
    providerLabel: 'Example assistant',
    modelLabel: 'model-a',
    interfaceLabel: 'Consumer interface',
    groundingMode: 'SEARCH_GROUNDED',
    locale: 'en',
    region: null,
    ...overrides,
  };
}

function row(metricId: string, prior: number | null, current: number | null): MetricComparisonRow {
  return {
    metricId,
    label: metricId,
    unit: 'observations',
    polarity: polarityOf(metricId),
    prior,
    current,
    priorNumerator: prior === null ? null : 1,
    priorDenominator: 2,
    currentNumerator: current === null ? null : 1,
    currentDenominator: 2,
    delta: prior === null || current === null ? null : current - prior,
    direction: rowDirection(prior, current, metricId),
  };
}

test('every finding status carries a label and a description', () => {
  for (const status of FINDING_STATUSES) {
    assert.ok(FINDING_STATUS_LABELS[status].length > 0);
    assert.ok(FINDING_STATUS_DESCRIPTIONS[status].length > 20);
  }
  assert.deepEqual(Object.keys(FINDING_STATUS_LABELS).sort(), [...FINDING_STATUSES].sort());
  assert.deepEqual(Object.keys(FINDING_TRANSITIONS).sort(), [...FINDING_STATUSES].sort());
});

test('terminal statuses absorb nothing, so a closed finding cannot be reopened in place', () => {
  assert.deepEqual(FINDING_TRANSITIONS.CLOSED_WITH_RATIONALE, []);
  assert.deepEqual(FINDING_TRANSITIONS.WONT_FIX, []);
  assert.equal(isFindingTransition('CLOSED_WITH_RATIONALE', 'OPEN'), false);
  assert.equal(isFindingTransition('WONT_FIX', 'IN_PROGRESS'), false);
});

test('no finding transition skips through triage or reaches a measured state by hand', () => {
  // OPEN is the only entry point, and the measured outcomes sit behind RETEST_REQUIRED.
  for (const status of MEASUREMENT_ONLY_STATUSES) {
    assert.equal(isFindingTransition('OPEN', status), false, status);
    assert.equal(isFindingTransition('ACCEPTED', status), false, status);
    assert.equal(isFindingTransition('IN_PROGRESS', status), false, status);
    assert.equal(isFindingTransition('RETEST_REQUIRED', status), true, status);
  }
  assert.equal(isFindingTransition('OPEN', 'RETEST_REQUIRED'), false);
  assert.equal(isFindingTransition('OPEN', 'ACCEPTED'), true);
});

test('"unable to verify" only follows an attempted comparison', () => {
  // Parking a finding in UNABLE_TO_VERIFY before any retest was set up would read like closure with
  // no measurement behind it.
  assert.equal(isMeasurementOnlyStatus('UNABLE_TO_VERIFY'), true);
  for (const status of ['OPEN', 'ACCEPTED', 'IN_PROGRESS', 'AWAITING_EXTERNAL_CHANGE'] as const) {
    assert.equal(FINDING_TRANSITIONS[status].includes('UNABLE_TO_VERIFY'), false, status);
  }
});

test('closure and refusal both require a written rationale', () => {
  assert.equal(requiresClosureRationale('CLOSED_WITH_RATIONALE'), true);
  assert.equal(requiresClosureRationale('WONT_FIX'), true);
  assert.equal(requiresClosureRationale('IN_PROGRESS'), false);
});

test('a non-comparable pair can only ever yield unable to verify', () => {
  assert.equal(statusAllowedForOutcome('IMPROVED', 'NOT_COMPARABLE'), false);
  assert.equal(statusAllowedForOutcome('REGRESSED', 'NOT_COMPARABLE'), false);
  assert.equal(statusAllowedForOutcome('UNABLE_TO_VERIFY', 'NOT_COMPARABLE'), true);
  assert.equal(statusAllowedForOutcome('IMPROVED', 'IMPROVED'), true);
  // A finding cannot be talked into "improved" by pointing at a comparison that said otherwise.
  assert.equal(statusAllowedForOutcome('IMPROVED', 'REGRESSED'), false);
});

test('comparability names each condition that broke, in time order', () => {
  assert.deepEqual(comparabilityReasons({ prior: config(), current: config() }), []);
  assert.deepEqual(comparabilityReasons({ prior: config(), current: config({ locale: 'fr' }) }), [
    'The locale differs: en then, fr now.',
  ]);
  const reasons = comparabilityReasons({
    prior: config({ modelLabel: null, groundingMode: 'NO_SEARCH', querySetId: 'qst_2' }),
    current: config({ modelLabel: 'model-a' }),
  });
  assert.equal(reasons.length, 3);
  // Each reason states the recorded values, so an operator can see which label moved.
  assert.ok(reasons.some((reason) => reason.includes('model-a')));
  assert.ok(reasons.some((reason) => reason.includes('NO_SEARCH')));
});

test('a metric that improves by falling is not read as an improvement when it rises', () => {
  // The three rates below get worse as they grow. Ranking them like a mention rate would have
  // turned a worse answer into a recorded "improved" finding.
  assert.equal(polarityOf('mention_rate'), 'HIGHER_IS_BETTER');
  assert.equal(polarityOf('relevant_omission_rate'), 'LOWER_IS_BETTER');
  assert.equal(rowDirection(0.2, 0.6, 'relevant_omission_rate'), 'REGRESSED');
  assert.equal(rowDirection(0.2, 0.6, 'answer_statement_contradiction_rate'), 'REGRESSED');
  assert.equal(rowDirection(0.6, 0.2, 'answer_statement_unsupported_rate'), 'IMPROVED');
  assert.equal(rowDirection(0.2, 0.6, 'mention_rate'), 'IMPROVED');
  const rows = [row('relevant_omission_rate', 0.2, 0.6)];
  assert.equal(outcomeFromComparison(true, rows, 'relevant_omission_rate'), 'REGRESSED');
});

test('decomposition coverage is context, so it can never carry a retest verdict', () => {
  // Recording more statements is more review work, not a better answer.
  assert.equal(polarityOf('answer_decomposition_coverage'), 'CONTEXT');
  assert.equal(rowDirection(0.2, 1, 'answer_decomposition_coverage'), 'NOT_A_VERDICT');
  assert.equal(
    outcomeFromComparison(
      true,
      [row('answer_decomposition_coverage', 0.2, 1)],
      'answer_decomposition_coverage',
    ),
    'UNABLE_TO_VERIFY',
  );
  assert.equal(COMPARISON_METRICS.includes('answer_decomposition_coverage'), true);
  assert.equal(isFocusMetric('answer_decomposition_coverage'), false);
});

test('a comparison of identical configuration still refuses a self-comparison upstream', () => {
  // The repository refuses base === later; the pure layer documents why direction matters.
  assert.equal(directionFor(0.5, 0.75), 'IMPROVED');
  assert.equal(directionFor(0.5, 0.5), 'UNCHANGED');
  assert.equal(directionFor(0.5, 0.25), 'REGRESSED');
});

test('an unavailable side is never ranked as an improvement', () => {
  // A null value means no eligible unit, not zero. Treating it as zero would turn a missing
  // measurement into a fabricated regression or improvement.
  assert.equal(directionFor(null, 0.5), 'UNABLE_TO_VERIFY');
  assert.equal(directionFor(0.5, null), 'UNABLE_TO_VERIFY');
  assert.equal(directionFor(null, null), 'UNABLE_TO_VERIFY', 'two unknowns are not a match');
});

test('the comparison outcome follows the metric the finding was about', () => {
  const rows = [row('mention_rate', 0.4, 0.6), row('citation_support_rate', 0.9, 0.2)];
  assert.equal(outcomeFromComparison(true, rows, 'mention_rate'), 'IMPROVED');
  assert.equal(outcomeFromComparison(true, rows, 'citation_support_rate'), 'REGRESSED');
  assert.equal(outcomeFromComparison(false, rows, 'mention_rate'), 'NOT_COMPARABLE');
  // A metric that neither run produced cannot support any conclusion.
  assert.equal(outcomeFromComparison(true, rows, 'relevant_omission_rate'), 'UNABLE_TO_VERIFY');
});

test('a focus metric must be one the comparison can actually carry', () => {
  assert.equal(isFocusMetric('mention_rate'), true);
  assert.equal(isFocusMetric('answer_statement_fidelity_rate'), true);
  // Invented or internal identifiers are refused rather than silently producing no delta.
  assert.equal(isFocusMetric('overall_score'), false);
  assert.equal(isFocusMetric('notes'), false);
  // Every focusable metric must actually be stored, or a focus choice could never resolve.
  for (const metric of COMPARISON_METRICS) {
    assert.equal(typeof polarityOf(metric), 'string', metric);
  }
});

test('a change in decomposition effort is reported, not read as answer behaviour', () => {
  // Both sides decomposed every eligible answer, so a statement-level trend is fair to read.
  assert.equal(
    claimComparisonNote({
      priorObservations: 4,
      priorDecomposed: 4,
      currentObservations: 1,
      currentDecomposed: 1,
    }),
    null,
  );
  const note = claimComparisonNote({
    priorObservations: 4,
    priorDecomposed: 4,
    currentObservations: 4,
    currentDecomposed: 0,
  });
  assert.match(note ?? '', /no recorded answer statements/);
  const partial = claimComparisonNote({
    priorObservations: 2,
    priorDecomposed: 2,
    currentObservations: 4,
    currentDecomposed: 1,
  });
  assert.match(partial ?? '', /not compared as a trend/);
  assert.match(partial ?? '', /2 of 2/);
  assert.match(partial ?? '', /1 of 4/);
});

test('the causal boundary is carried with every comparison', () => {
  assert.match(CAUSAL_BOUNDARY, /association, not a cause/);
  assert.match(CAUSAL_BOUNDARY, /Aporia observed none of them/);
  assert.match(CAUSAL_BOUNDARY, /Nothing here can show that a website change/);
  // The sentence must name what could have changed outside the tool's view, not just say "caveat".
  assert.match(CAUSAL_BOUNDARY, /Provider, model, interface/);
});
