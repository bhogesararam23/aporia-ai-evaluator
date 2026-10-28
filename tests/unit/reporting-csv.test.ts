import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  csvCell,
  findingsCsv,
  metricsCsv,
  observationsCsv,
  reportJson,
} from '../../src/reporting/csv.ts';
import { buildReportSnapshot } from '../../src/reporting/snapshot.ts';
import { baseInput } from '../helpers/reporting.ts';

test('CSV exports flatten metrics and findings with formula-injection protection', () => {
  const snapshot = buildReportSnapshot(baseInput());
  const metrics = metricsCsv(snapshot);
  assert.match(metrics, /^"run_id","run_name"/);
  assert.match(metrics, /mention_rate/);
  assert.match(metrics, /observed_answer_coverage/);
  assert.equal(metricsCellCount(metrics), 7 + 1);

  const findings = findingsCsv(snapshot);
  assert.match(findings, /PROPOSITION_CONCLUSION/);
  assert.match(findings, /EVIDENCE_RELATIONSHIP/);
  assert.match(findings, /OBSERVATION_ASSESSMENT/);
  assert.match(findings, /WEBSITE_FINDING/);
  assert.match(findings, /UNAVAILABLE_CHECK/);
  assert.equal(csvCell('=SUM(A1)'), `"'=SUM(A1)"`);
  assert.equal(csvCell('+cmd'), `"'+cmd"`);
  assert.equal(csvCell('-1'), `"'-1"`);
  assert.equal(csvCell('@user'), `"'@user"`);

  const json = reportJson(snapshot);
  assert.deepEqual(JSON.parse(json), snapshot);
});

function metricsCellCount(csv: string): number {
  const lines = csv.trimEnd().split('\n');
  return lines.length;
}

test('exports one immutable observation row per captured answer', () => {
  const snapshot = buildReportSnapshot(baseInput());
  const csv = observationsCsv(snapshot);
  assert.match(csv, /^"run_id","run_name"/);
  assert.match(csv, /"query_ordinal"/);
  assert.match(csv, /Project A was created by Ram\./);
  assert.match(csv, /PRESENCE:MENTIONED/);
  assert.equal(csv.trimEnd().split('\n').length, 3);
});
