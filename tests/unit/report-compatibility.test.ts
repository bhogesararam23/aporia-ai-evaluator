import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderReport } from '../../src/app/views/report.ts';
import { buildReportSnapshot } from '../../src/reporting/snapshot.ts';
import { baseInput } from '../helpers/reporting.ts';

test('a stored metrics-v1 snapshot still renders its own values and shape', () => {
  const v2 = buildReportSnapshot(baseInput());
  const v1 = structuredClone(v2);
  (v1 as { templateVersion: string }).templateVersion = 'report-template-v1';
  (v1.report as { metricsVersion: string }).metricsVersion = 'metrics-v1';
  for (const run of v1.runs) {
    const coverage = run.metrics.coverage as unknown as Record<string, unknown>;
    delete coverage['byIntent'];
    delete coverage['plannedIntents'];
    delete coverage['testedIntents'];
    delete coverage['untestedIntents'];
    delete coverage['coveredIntents'];
    delete coverage['notMentionedIntents'];
    delete coverage['unassessedIntents'];
    delete coverage['partialAssessmentIntents'];
  }

  const html = renderReport(v1, { supersededByReportId: null }).value;

  assert.match(html, /Observed answer-level coverage/);
  assert.equal(v1.runs[0]?.metrics.observedAnswerCoverage.value, 1);
  assert.equal(v1.runs[0]?.metrics.observedAnswerCoverage.numerator, 2);
  assert.equal(v1.runs[0]?.metrics.observedAnswerCoverage.denominator, 2);
  assert.doesNotMatch(html, /Intent-group coverage/);
  assert.match(html, /100/);
});

test('a metrics-v2 snapshot renders the intent-group table', () => {
  const snapshot = buildReportSnapshot(baseInput());
  const html = renderReport(snapshot, { supersededByReportId: null }).value;

  assert.match(html, /Intent-group coverage/);
  assert.match(html, /Repeated queries for one intent count once/);
});
