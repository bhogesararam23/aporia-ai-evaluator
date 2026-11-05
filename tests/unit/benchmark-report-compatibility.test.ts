/**
 * v0.7 report serialisation is pinned, not merely "similar".
 *
 * v0.8 binds a run to a release through a separate artifact (`benchmark-run-record-v1`) and deliberately
 * adds **no** field to `benchmark-report-v2`, so every report already stored stays byte-comparable. That is a
 * promise about bytes, so it is tested about bytes: the digest below was produced by the merged v0.7 code
 * path (`e72e77a`) over the synthetic fixture corpus built below, on 2026-11-05.
 *
 * It is exactly what it says: a v0.7-generated serialization of a **synthetic test fixture**. No real
 * reviewed report exists for this project, and inventing one to compare against would be worse than having
 * no baseline at all.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';
import { BENCHMARK_DIMENSIONS, type BenchmarkCase } from '../../src/benchmark/types.ts';
import { validateBenchmarkCorpus } from '../../src/benchmark/validate.ts';
import { regressionResults, unusableEvidenceRecords } from '../../src/benchmark/regression.ts';
import {
  agreementRows,
  annotationSummaries,
  scoreByDimension,
  type ScoredPair,
} from '../../src/benchmark/scoring.ts';
import {
  BENCHMARK_REPORT_VERSION,
  caseDigest,
  serialiseBenchmarkReport,
  buildBenchmarkReport,
  type CorpusDigest,
} from '../../src/benchmark/report.ts';

/**
 * The digest the merged v0.7 tree (`e72e77a`, before any v0.8 edit) writes for the fixture corpus above.
 * Captured by running this file against that tree and recording the value the assertion reported.
 */
const REPORT_V07_SERIALISED_SHA256 =
  '99f5eb3c89909280141d9312a30f099ec9ef455d28ada71de7e6ceb5ebb1180b';

/**
 * A corpus that reaches every part of the report: a clean case, a reviewer split with no decision, and a
 * split settled by a legacy unbound adjudication (so `excludedUnboundAdjudication` is non-zero).
 */
function pinnedCorpus(): unknown[] {
  const basic = fixtureCase({ id: 'pin-basic' });
  const split = fixtureCase({
    id: 'pin-split',
    reviewedBy: ['dana', 'sam'],
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('sam', 'EVIDENCE_SUPPORT', 'p1', 'INSUFFICIENT_EVIDENCE'),
    ],
  });
  const legacy = {
    ...fixtureCase({
      id: 'pin-legacy',
      reviewedBy: ['dana', 'sam'],
      reviewerLabels: [
        labelFor('dana', 'ANSWER_FIDELITY', 'st1', 'ACCURATE'),
        labelFor('sam', 'ANSWER_FIDELITY', 'st1', 'NOT_ASSESSABLE'),
      ],
    }),
    // No `disagreementHash`: an unbound record from before v0.7 binding.
    adjudications: [
      {
        dimension: 'ANSWER_FIDELITY',
        subjectId: 'st1',
        outcome: 'RESOLVED',
        label: 'ACCURATE',
        reason: 'Settled by a decision recorded before bindings existed.',
        adjudicatedBy: 'dana',
      },
    ],
  } satisfies BenchmarkCase;
  return [basic, split, legacy];
}

/** The same report the harness composes: validation, regression, scoring, agreement, annotation, digests. */
function pinnedReport() {
  const values = pinnedCorpus();
  const validation = validateBenchmarkCorpus(
    values.map((value, index) => ({ index, value: value as unknown })),
  );
  const regression = regressionResults(validation.cases);
  const deterministicPairs: ScoredPair[] = regression.map((row) => ({
    caseId: row.caseId,
    dimension: row.dimension,
    subjectId: row.subjectId,
    expected: row.expected,
    predicted: row.produced,
    component: row.component,
  }));
  const dimensions = scoreByDimension(deterministicPairs, BENCHMARK_DIMENSIONS);
  const agreement = agreementRows(validation.cases);
  const annotation = annotationSummaries(agreement, BENCHMARK_DIMENSIONS);
  const unusable = unusableEvidenceRecords(validation.cases).map((row) => ({
    caseId: row.caseId,
    propositionId: row.propositionId,
    evidenceId: row.evidence.id,
  }));
  const digests: CorpusDigest[] = values.map((value, index) => {
    const text = JSON.stringify(value);
    return {
      kind: 'file',
      source: `pinned-${String(index)}.json`,
      caseCount: 1,
      digest: createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16),
      bytes: Buffer.byteLength(text, 'utf8'),
      accepted: true,
    };
  });
  for (const benchmarkCase of validation.cases) {
    digests.push({
      kind: 'case',
      source: benchmarkCase.id,
      caseCount: 1,
      digest: caseDigest(benchmarkCase),
      bytes: Buffer.byteLength(JSON.stringify(benchmarkCase), 'utf8'),
      accepted: true,
    });
  }
  return buildBenchmarkReport(
    validation,
    regression,
    dimensions,
    agreement,
    annotation,
    unusable,
    digests,
  );
}

test('the pinned corpus is genuinely exercised by the report it produces', () => {
  const report = pinnedReport();
  // If this stops being true the pin has silently narrowed to an empty corpus, which would prove nothing.
  assert.equal(report.corpus.caseCount, 3);
  assert.ok(report.methodology.agreement.length >= 2, 'the fixture must produce agreement rows');
  assert.ok(
    report.methodology.annotation.some((row) => row.excludedUnboundAdjudication > 0),
    'the fixture must exercise the v0.7 unbound disclosure',
  );
});

test('benchmark-report-v2 bytes are unchanged by v0.8', () => {
  const text = serialiseBenchmarkReport(pinnedReport());
  assert.equal(
    createHash('sha256').update(text, 'utf8').digest('hex'),
    REPORT_V07_SERIALISED_SHA256,
    'report serialisation drifted; v0.8 must not change benchmark-report-v2 bytes',
  );
});

test('the v0.7 key order inside structuralReadiness is preserved verbatim', () => {
  const text = serialiseBenchmarkReport(pinnedReport());
  const without = text.indexOf('"subjectsWithout"');
  const withTwo = text.indexOf('"subjectsWithTwoDistinctReviewers"');
  assert.ok(without > -1 && withTwo > -1, 'both readiness keys must still be present');
  // The merged v0.7 serialiser sorts with localeCompare, which puts `subjectsWithout` first. Freezing that
  // order is the whole point of pinning bytes rather than content: a stored report stays byte-equal.
  assert.ok(without < withTwo, 'key order changed: v0.8 must not reorder benchmark-report-v2 keys');
});

test('the report carries no release, manifest or receipt field of any kind', () => {
  const text = serialiseBenchmarkReport(pinnedReport());
  for (const forbidden of ['releaseId', 'manifest', 'runRecord', 'reportSha256']) {
    assert.ok(
      !text.includes(`"${forbidden}"`),
      `binding belongs in benchmark-run-record-v1, not in the report: found ${forbidden}`,
    );
  }
  assert.ok(text.includes(`"version": "${BENCHMARK_REPORT_VERSION}"`));
});

test('the report still refuses to claim accuracy', () => {
  const report = pinnedReport();
  assert.equal(report.statement.accuracyClaimable, false);
  assert.ok(report.statement.reason.length > 0);
});

test('the existing digest fields keep their exact shape and are not repurposed', () => {
  const report = pinnedReport();
  const fileDigests = report.corpus.digests.filter((entry) => entry.kind === 'file');
  const caseDigests = report.corpus.digests.filter((entry) => entry.kind === 'case');
  assert.equal(fileDigests.length, 3);
  assert.equal(caseDigests.length, 3);
  // 16 hex characters: the truncated file digest and the FNV case digest. A v0.8 full SHA-256 identity must
  // live in the receipt, never by quietly widening a field a stored report already filled in.
  for (const entry of report.corpus.digests) {
    assert.match(entry.digest, /^[0-9a-f]{16}$/);
  }
  // Two different cases must still produce two different case digests: a pin is only meaningful if the
  // field it freezes actually discriminates.
  const digests = new Set(caseDigests.map((entry) => entry.digest));
  assert.equal(digests.size, 3);
});
