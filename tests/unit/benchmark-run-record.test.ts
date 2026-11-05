import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BENCHMARK_CASE_VERSION,
  BENCHMARK_CASE_VERSION_V1,
  type BenchmarkCase,
} from '../../src/benchmark/types.ts';
import {
  EVIDENCE_RULE_VERSION,
  METHODOLOGY_VERSION,
  METRICS_VERSION,
} from '../../src/core/versions.ts';
import {
  buildRunRecord,
  runRecordText,
  RUN_RECORD_ALGORITHM,
  type RunRecordInput,
} from '../../src/benchmark/execution.ts';
import { bindRunToRelease } from '../../src/benchmark/execution.ts';
import { buildReleaseManifest } from '../../src/benchmark/release.ts';
import { canonicalise, sha256Hex } from '../../src/benchmark/hashing.ts';
import { validateBenchmarkCorpus } from '../../src/benchmark/validate.ts';
import { BENCHMARK_REPORT_VERSION, buildBenchmarkReport } from '../../src/benchmark/report.ts';
import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';

/**
 * The run receipt (v0.8, spec §5).
 *
 * A receipt is only useful if it is boring: same inputs, same bytes, on every machine, with nothing in it that
 * could have been invented. These tests are mostly about what must be `null` — a run that was not bound to a
 * release, an operator who supplied no source revision — because those are the fields a tool could be tempted to
 * fill in, and a filled-in field would be the most misleading part of the artifact.
 */

function agreedCase(id: string, version = BENCHMARK_CASE_VERSION): BenchmarkCase {
  return fixtureCase({
    id,
    version,
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

function reportFor(cases: readonly BenchmarkCase[]) {
  const validation = validateBenchmarkCorpus(
    cases.map((value, index) => ({ index, value: value as unknown })),
  );
  return buildBenchmarkReport(validation, [], [], [], [], [], []);
}

function unboundBinding(cases: readonly BenchmarkCase[]) {
  const validation = validateBenchmarkCorpus(
    cases.map((value, index) => ({ index, value: value as unknown })),
  );
  return bindRunToRelease({ manifest: null, cases, validation, manifestText: null });
}

function recordFor(cases: readonly BenchmarkCase[], sourceRevision: string | null) {
  const report = reportFor(cases);
  const input: RunRecordInput = {
    report,
    reportText: JSON.stringify(report),
    binding: unboundBinding(cases),
    cases,
    sourceRevision,
  };
  return buildRunRecord(input);
}

test('a receipt records the report by content and by bytes, and they are different questions', () => {
  const cases = [agreedCase('record-a')];
  const report = reportFor(cases);
  const text = JSON.stringify(report, null, 2);
  const record = buildRunRecord({
    report,
    reportText: text,
    binding: unboundBinding(cases),
    cases,
    sourceRevision: null,
  });
  assert.equal(record.reportTextSha256, sha256Hex(text));
  // Two serialisations of the same report: identical content, different bytes. A replay that compares only the
  // text would call this a mismatch; a replay that compares only content could not see a reformat. The receipt
  // records both and says which one it checked.
  const reserialised = JSON.stringify(JSON.parse(text), null, 4);
  const second = buildRunRecord({
    report,
    reportText: reserialised,
    binding: unboundBinding(cases),
    cases,
    sourceRevision: null,
  });
  assert.equal(second.reportSha256, record.reportSha256);
  assert.notEqual(second.reportTextSha256, record.reportTextSha256);
});

test('the receipt carries the contract versions that actually applied to the run', () => {
  const cases = [agreedCase('mixed-a'), agreedCase('mixed-b', BENCHMARK_CASE_VERSION_V1)];
  const record = recordFor(cases, null);
  assert.deepEqual([...record.versions.caseContractVersions].sort(), [
    BENCHMARK_CASE_VERSION_V1,
    BENCHMARK_CASE_VERSION,
  ]);
  assert.equal(record.versions.reportVersion, BENCHMARK_REPORT_VERSION);
  assert.equal(record.versions.methodologyVersion, METHODOLOGY_VERSION);
  assert.equal(record.versions.metricsVersion, METRICS_VERSION);
  // The rule in force, not the proposal: recording `evidence-aggregation-v2` here would claim a default the
  // owner has not accepted (ADR-025 stays Proposed).
  assert.equal(record.versions.evidenceRuleVersion, EVIDENCE_RULE_VERSION);
  assert.equal(EVIDENCE_RULE_VERSION, 'evidence-aggregation-v1');
});

test('an unbound run says so instead of inventing a release identity', () => {
  const record = recordFor([agreedCase('unbound-rec')], null);
  assert.equal(record.version, 'benchmark-run-record-v1');
  assert.equal(record.algorithm, RUN_RECORD_ALGORITHM);
  assert.equal(record.releaseId, null);
  assert.equal(record.corpusHash, null);
  assert.equal(record.manifestSha256, null);
  assert.equal(record.manifestLabel, null);
  assert.equal(record.warnings.notReleaseBound, true);
  assert.equal(record.caseCount, 1);
});

test('a bound run carries the binding, and the manifest label is the operator name for it only', () => {
  const cases = [agreedCase('bound-rec')];
  const manifest = buildReleaseManifest(cases, null, 'my release', validateBenchmarkCorpus([]));
  const manifestText = `${JSON.stringify(canonicalise(manifest))}\n`;
  const validation = validateBenchmarkCorpus(
    cases.map((value, index) => ({ index, value: value as unknown })),
  );
  const binding = bindRunToRelease({
    manifest: JSON.parse(manifestText),
    cases,
    validation,
    manifestText,
  });
  assert.equal(binding.ok, true, binding.refused.join('; '));
  const report = reportFor(cases);
  const record = buildRunRecord({
    report,
    reportText: JSON.stringify(report),
    binding,
    cases,
    sourceRevision: null,
  });
  assert.equal(record.releaseId, manifest.releaseId);
  assert.equal(record.corpusHash, manifest.corpusHash);
  assert.equal(record.manifestSha256, sha256Hex(manifestText));
  assert.equal(record.manifestLabel, 'my release');
  assert.equal(record.warnings.notReleaseBound, false);
});

test('a source revision is stored only when an operator supplied one, and verbatim', () => {
  const cases = [agreedCase('rev-a')];
  const absent = recordFor(cases, null);
  assert.equal(absent.sourceRevision, null, 'the tool recorded a revision it never read');
  const supplied = recordFor(cases, 'e72e77aff6fa8e27d2b10a42920f53712a9cda98');
  assert.equal(supplied.sourceRevision, 'e72e77aff6fa8e27d2b10a42920f53712a9cda98');
  // Not a git call, not a guess: any text the operator typed is stored as text, including a tag or a branch.
  const loose = recordFor(cases, 'main at the time I ran it');
  assert.equal(loose.sourceRevision, 'main at the time I ran it');
});

test('a receipt is deterministic: same inputs, identical bytes, twice', () => {
  const cases = [agreedCase('det-a'), agreedCase('det-b')];
  const first = runRecordText(recordFor(cases, 'abc123'));
  const second = runRecordText(recordFor(cases, 'abc123'));
  assert.equal(first, second);
  // A different case order in the same corpus is a different run, and must not hash the same.
  const swapped = runRecordText(recordFor([agreedCase('det-b'), agreedCase('det-a')], 'abc123'));
  assert.notEqual(first, swapped);
});

test('the receipt contains no clock, path, hostname or environment value', () => {
  const record = recordFor([agreedCase('clean-a')], null);
  const text = runRecordText(record);
  assert.ok(
    !/20\d\d-\d\d-\d\dT\d\d:\d\d/.test(text),
    'a receipt that records a wall-clock time cannot be reproduced',
  );
  assert.ok(!/[A-Za-z]:[\\/]/.test(text), 'an absolute Windows path leaked into the receipt');
  assert.ok(!text.includes(process.cwd()), 'the working directory leaked into the receipt');
  // Checked against the schema rather than the machine: a field named for time, place or host could not be
  // reproduced elsewhere, so it must not exist at all.
  for (const forbidden of [
    '"generatedAt"',
    '"timestamp"',
    '"hostname"',
    '"path"',
    '"cwd"',
    '"directory"',
    '"env"',
  ]) {
    assert.ok(
      !text.includes(forbidden),
      `the receipt carries a non-reproducible field: ${forbidden}`,
    );
  }
});

test('accuracy is not claimable, in the type and in the text', () => {
  const record = recordFor([agreedCase('honest-a')], null);
  assert.equal(record.accuracyClaimable, false);
  assert.equal(typeof record.note, 'string');
  assert.ok(
    record.note.length > 40,
    'the note has to say what the receipt does and does not prove',
  );
  const text = runRecordText(record);
  assert.ok(text.includes('"accuracyClaimable": false'));
});

test('a legacy unbound decision is counted from the corpus, not read out of the manifest', () => {
  const legacy = {
    ...agreedCase('legacy-rec'),
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('sam', 'EVIDENCE_SUPPORT', 'p1', 'INSUFFICIENT_EVIDENCE'),
      labelFor('dana', 'ANSWER_FIDELITY', 'st1', 'NOT_ASSESSABLE'),
      labelFor('sam', 'ANSWER_FIDELITY', 'st1', 'NOT_ASSESSABLE'),
      labelFor('dana', 'CITATION_SUPPORT', 'st1', 'NOT_ASSESSABLE'),
      labelFor('sam', 'CITATION_SUPPORT', 'st1', 'NOT_ASSESSABLE'),
      labelFor('dana', 'ATTRIBUTION', 'st1', 'NOT_ASSESSABLE'),
      labelFor('sam', 'ATTRIBUTION', 'st1', 'NOT_ASSESSABLE'),
    ],
    adjudications: [
      {
        dimension: 'EVIDENCE_SUPPORT' as const,
        subjectId: 'p1',
        outcome: 'RESOLVED' as const,
        label: 'SUPPORTED_WITHIN_SCOPE',
        reason: 'Settled before bindings existed.',
        adjudicatedBy: 'dana',
      },
    ],
  };
  const cases = [legacy as unknown as BenchmarkCase];
  const record = recordFor(cases, null);
  assert.equal(
    record.warnings.unboundAdjudications,
    1,
    'an unbound decision was not counted, so the receipt hides the provenance gap',
  );
  assert.ok(record.warnings.gateNotes.length >= 0);
  assert.ok(
    record.warnings.strataMissing.length > 0,
    'a one-case corpus must report the strata it does not cover',
  );
});
