import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bindRunToRelease,
  buildRunRecord,
  runRecordProblem,
  verifyRunRecord,
  type BenchmarkRunRecord,
  type RunRecordReplay,
} from '../../src/benchmark/execution.ts';
import { buildReleaseManifest } from '../../src/benchmark/release.ts';
import { validateBenchmarkCorpus } from '../../src/benchmark/validate.ts';
import { canonicalise, contentHash, sha256Hex } from '../../src/benchmark/hashing.ts';
import { BENCHMARK_REPORT_VERSION, buildBenchmarkReport } from '../../src/benchmark/report.ts';
import { type BenchmarkCase } from '../../src/benchmark/types.ts';
import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';
import { METHODOLOGY_VERSION, METRICS_VERSION } from '../../src/core/versions.ts';

/**
 * Verifying a receipt (v0.8, spec §6).
 *
 * A receipt is worth having only if something can disagree with it. This is that something: it replays the run
 * over the corpus and manifest it is handed, and names every field that no longer agrees. Each test below
 * corrupts exactly one thing, because a check that fires for six reasons tells an operator nothing about which
 * one to fix.
 */

function agreedCase(id: string): BenchmarkCase {
  return fixtureCase({
    id,
    reviewedBy: ['dana', 'sam'],
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('sam', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('dana', 'ANSWER_FIDELITY', 'st1', 'NOT_ASSESSABLE'),
      labelFor('sam', 'ANSWER_FIDELITY', 'st1', 'NOT_ASSESSABLE'),
      labelFor('dana', 'CITATION_SUPPORT', 'st1', 'NOT_ASSESSABLE'),
      labelFor('sam', 'CITATION_SUPPORT', 'st1', 'NOT_ASSESSABLE'),
      labelFor('dana', 'ATTRIBUTION', 'st1', 'NOT_ASSESSABLE'),
      labelFor('sam', 'ATTRIBUTION', 'st1', 'NOT_ASSESSABLE'),
    ],
  });
}

function validationOf(cases: readonly BenchmarkCase[]) {
  return validateBenchmarkCorpus(cases.map((value, index) => ({ index, value: value as unknown })));
}

function reportOf(cases: readonly BenchmarkCase[]) {
  return buildBenchmarkReport(validationOf(cases), [], [], [], [], [], []);
}

interface Scene {
  readonly record: BenchmarkRunRecord;
  readonly replay: RunRecordReplay;
  readonly manifestText: string;
  readonly cases: readonly BenchmarkCase[];
}

function verify(): Scene {
  const cases = [agreedCase('verify-a')];
  const manifest = buildReleaseManifest(cases, null, 'verifier', validationOf(cases));
  const manifestText = `${JSON.stringify(canonicalise(manifest))}\n`;
  const binding = bindRunToRelease({
    manifest: JSON.parse(manifestText),
    cases,
    validation: validationOf(cases),
    manifestText,
  });
  assert.equal(binding.ok, true, binding.refused.join('; '));
  const report = reportOf(cases);
  const reportText = JSON.stringify(report, null, 2);
  const replay: RunRecordReplay = {
    report,
    reportText,
    binding,
    cases,
    sourceRevision: null,
    manifestText,
  };
  return {
    record: buildRunRecord({ report, reportText, binding, cases, sourceRevision: null }),
    replay,
    manifestText,
    cases,
  };
}

test('a replay over the same release verifies clean', () => {
  const scene = verify();
  const result = verifyRunRecord(scene.record, scene.replay);
  assert.equal(result.ok, true, `a clean replay was refused: ${result.mismatches.join('; ')}`);
  assert.deepEqual(result.mismatches, []);
  assert.ok(
    result.checked.length >= 6,
    'a verification that checked almost nothing is not a verification',
  );
});

test('a tampered manifest is caught by its byte digest', () => {
  const scene = verify();
  const result = verifyRunRecord(scene.record, {
    ...scene.replay,
    manifestText: `${scene.manifestText}appended\n`,
  });
  assert.equal(result.ok, false);
  assert.ok(
    result.mismatches.some((line) => line.startsWith('MANIFEST-TAMPERED')),
    result.mismatches.join('; '),
  );
});

test('a corpus that moved since the receipt is caught, naming the case', () => {
  const scene = verify();
  const cases = [agreedCase('verify-a'), agreedCase('verify-extra')];
  const manifest = buildReleaseManifest(cases, null, 'verifier', validationOf(cases));
  const manifestText = `${JSON.stringify(canonicalise(manifest))}\n`;
  const binding = bindRunToRelease({
    manifest: JSON.parse(manifestText),
    cases,
    validation: validationOf(cases),
    manifestText,
  });
  // The receipt was written for one case; this run has two, and the old manifest no longer describes them.
  const drifted = bindRunToRelease({
    manifest: JSON.parse(scene.manifestText),
    cases,
    validation: validationOf(cases),
    manifestText: scene.manifestText,
  });
  assert.equal(binding.ok, true);
  const result = verifyRunRecord(scene.record, {
    report: reportOf(cases),
    reportText: JSON.stringify(reportOf(cases), null, 2),
    binding: drifted,
    cases,
    sourceRevision: null,
    manifestText: scene.manifestText,
  });
  assert.equal(result.ok, false, 'a corpus that grew was verified against the old receipt');
  assert.ok(
    result.mismatches.some(
      (line) => line.startsWith('CORPUS-DRIFTED') || line.startsWith('RECORD-GATES'),
    ),
    result.mismatches.join('; '),
  );
});

test('a different report content is caught, and a reformat alone is only noted', () => {
  const scene = verify();
  const changed = verifyRunRecord(scene.record, {
    ...scene.replay,
    report: { ...scene.replay.report, version: 'benchmark-report-v3' },
  });
  assert.ok(
    changed.mismatches.some((line) => line.startsWith('REPORT-CONTENT')),
    changed.mismatches.join('; '),
  );

  // Re-serialised bytes, same content. A receipt that compared text alone would call this tampering; comparing
  // content alone would hide a rewritten file. Both are reported, and only the content difference is a failure.
  const reformatted = verifyRunRecord(scene.record, {
    ...scene.replay,
    reportText: JSON.stringify(scene.replay.report, null, 4),
  });
  assert.equal(reformatted.ok, true, reformatted.mismatches.join('; '));
  assert.ok(
    reformatted.notes.some((note) => /serialisation-order difference only/.test(note)),
    reformatted.notes.join('; '),
  );
});

test('every applicable version is checked by name, so a drift says which one moved', () => {
  const scene = verify();
  const expectations: [string, BenchmarkRunRecord][] = [
    [
      'methodologyVersion',
      {
        ...scene.record,
        versions: { ...scene.record.versions, methodologyVersion: 'methodology-1999-01-01' },
      },
    ],
    [
      'metricsVersion',
      { ...scene.record, versions: { ...scene.record.versions, metricsVersion: 'metrics-v9' } },
    ],
    [
      'reportVersion',
      {
        ...scene.record,
        versions: { ...scene.record.versions, reportVersion: 'benchmark-report-v9' },
      },
    ],
    [
      'evidenceRuleVersion',
      {
        ...scene.record,
        versions: { ...scene.record.versions, evidenceRuleVersion: 'evidence-aggregation-v9' },
      },
    ],
    [
      'caseContractVersions',
      { ...scene.record, versions: { ...scene.record.versions, caseContractVersions: ['nope'] } },
    ],
    ['caseCount', { ...scene.record, caseCount: 42 }],
    ['sourceRevision', { ...scene.record, sourceRevision: 'invented' }],
    ['releaseId', { ...scene.record, releaseId: 'release-000000000000' }],
    ['corpusHash', { ...scene.record, corpusHash: 'e'.repeat(64) }],
  ];
  for (const [field, tampered] of expectations) {
    const result = verifyRunRecord(tampered, scene.replay);
    assert.equal(result.ok, false, `${field} was accepted after being changed`);
    assert.ok(
      result.mismatches.some((line) => line.includes(field)),
      `${field} refused without naming itself: ${result.mismatches.join('; ')}`,
    );
  }
});

test('a receipt bound to a release cannot be verified without that release present', () => {
  const scene = verify();
  const result = verifyRunRecord(scene.record, { ...scene.replay, manifestText: null });
  assert.equal(result.ok, false);
  assert.ok(
    result.mismatches.some((line) => line.startsWith('INCOMPLETE-ARTIFACT')),
    result.mismatches.join('; '),
  );
});

test('an unbound receipt stays honest when replayed unbound, and lies when replayed bound', () => {
  const cases = [agreedCase('quiet-a')];
  const report = reportOf(cases);
  const reportText = JSON.stringify(report, null, 2);
  const unbound = bindRunToRelease({
    manifest: null,
    cases,
    validation: validationOf(cases),
    manifestText: null,
  });
  const record = buildRunRecord({
    report,
    reportText,
    binding: unbound,
    cases,
    sourceRevision: null,
  });
  const clean = verifyRunRecord(record, {
    report,
    reportText,
    binding: unbound,
    cases,
    sourceRevision: null,
    manifestText: null,
  });
  assert.equal(clean.ok, true, clean.mismatches.join('; '));

  // The same corpus presented as release-bound now: the receipt says otherwise, and the verification must side
  // with the receipt rather than with whichever manifest happened to be lying around.
  const manifest = buildReleaseManifest(cases, null, 'later', validationOf(cases));
  const manifestText = `${JSON.stringify(canonicalise(manifest))}\n`;
  const bound = bindRunToRelease({
    manifest: JSON.parse(manifestText),
    cases,
    validation: validationOf(cases),
    manifestText,
  });
  const mismatched = verifyRunRecord(record, {
    report,
    reportText,
    binding: bound,
    cases,
    sourceRevision: null,
    manifestText,
  });
  assert.equal(mismatched.ok, false, 'a receipt and a binding disagreed and nobody noticed');
  assert.ok(
    mismatched.mismatches.some((line) => line.startsWith('RECORD-BOUND-STATE')),
    mismatched.mismatches.join('; '),
  );
});

test('a value that is not a receipt is refused before it is compared', () => {
  const scene = verify();
  assert.equal(runRecordProblem(scene.record), null);
  const asRecord = JSON.parse(JSON.stringify(scene.record)) as Record<string, unknown>;
  for (const bad of [
    'text',
    null,
    [],
    { ...asRecord, version: 'benchmark-run-record-v0' },
    { ...asRecord, reportSha256: 'short' },
    { ...asRecord, accuracyClaimable: true },
    { ...asRecord, caseCount: -1 },
    { ...asRecord, releaseId: 42 },
  ]) {
    assert.notEqual(runRecordProblem(bad), null, `${JSON.stringify(bad)} was treated as a receipt`);
  }
});

test('the report hashes a receipt stores are the two the run actually produced', () => {
  const scene = verify();
  assert.equal(scene.record.reportTextSha256, sha256Hex(scene.replay.reportText));
  assert.equal(scene.record.reportSha256, contentHash(scene.replay.report));
  assert.equal(scene.record.versions.reportVersion, BENCHMARK_REPORT_VERSION);
  assert.equal(scene.record.versions.methodologyVersion, METHODOLOGY_VERSION);
  assert.equal(scene.record.versions.metricsVersion, METRICS_VERSION);
});
