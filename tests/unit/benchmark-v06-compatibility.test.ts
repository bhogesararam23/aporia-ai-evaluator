import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildReviewerPacket,
  buildSubmissionTemplate,
  mergeSubmission,
  disagreementReport,
} from '../../src/benchmark/review.ts';
import { validateBenchmarkCorpus } from '../../src/benchmark/validate.ts';
import {
  agreementRows,
  annotationSummaries,
  scoreByDimension,
} from '../../src/benchmark/scoring.ts';
import { releaseGates } from '../../src/benchmark/release.ts';
import { buildBenchmarkReport, BENCHMARK_REPORT_VERSION } from '../../src/benchmark/report.ts';
import {
  BENCHMARK_CASE_VERSION_V1,
  BENCHMARK_DIMENSIONS,
  BENCHMARK_SUBMISSION_VERSION,
  type BenchmarkCase,
} from '../../src/benchmark/types.ts';
import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';

/**
 * v0.6 artifacts and older case contracts still work (ADR-027 compatibility).
 *
 * v0.7 changes behaviour on purpose — an undeclared reviewer is now refused, batch writes are atomic, a new
 * adjudication must bind to a disagreement. None of that may invalidate what v0.6 already produced: a
 * `benchmark-case-v1` file, a `benchmark-case-v2` file, a `benchmark-submission-v1` file with a date-only
 * timestamp, an unbound legacy adjudication, and a `benchmark-report-v2` document. Compatibility here is
 * about *reading* the older artifacts, not about keeping the unsafe acceptances.
 */

/** A v1 case: one evidence record with no `sourceId`, and one unscoped adjudication. */
function legacyV1Case(): BenchmarkCase {
  return fixtureCase({
    id: 'case-legacy-v1',
    stratum: 'CONFLICTING_EVIDENCE',
    version: BENCHMARK_CASE_VERSION_V1,
    reviewedBy: ['dana', 'sam'],
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('sam', 'EVIDENCE_SUPPORT', 'p1', 'CONTRADICTED'),
    ],
  });
}

test('a v0.6 submission artifact with a date-only timestamp still merges', () => {
  const benchmarkCase = fixtureCase({
    id: 'case-v06-submission',
    reviewedBy: ['dana', 'erin'],
  });
  const packet = buildReviewerPacket(benchmarkCase);
  const template = buildSubmissionTemplate(packet);
  // Exactly what a v0.6 reviewer would have written: v1 artifact, bare date, declared reviewer.
  const v06Submission = {
    ...template,
    version: BENCHMARK_SUBMISSION_VERSION,
    reviewer: 'erin',
    submittedAt: '2026-11-05',
    annotations: template.annotations.map((annotation) => ({
      ...annotation,
      label:
        annotation.dimension === 'EVIDENCE_SUPPORT' ? 'SUPPORTED_WITHIN_SCOPE' : 'NOT_ASSESSABLE',
      rationale: 'v0.6-era rationale from the frozen input.',
    })),
  };
  const result = mergeSubmission(benchmarkCase, v06Submission);
  assert.equal(result.ok, true, JSON.stringify(!result.ok && result.reasons));
  if (!result.ok) {
    return;
  }
  const applied = result.case.reviewerLabels.filter((entry) => entry.reviewer === 'erin');
  assert.equal(applied.length, 4);
  // The lenient value is stored as recorded, and the provenance v0.7 keeps is still attached.
  assert.equal(applied[0]?.submittedAt, '2026-11-05');
  assert.equal(applied[0]?.packetHash, packet.packetHash);
  assert.match(String(applied[0]?.rationale), /v0.6-era rationale/);
});

test('a benchmark-case-v1 file still validates, and an unscoped adjudication is refused with its reason', () => {
  // The v1 contract itself reads unchanged: no new issue appears because of v0.7.
  const clean = validateBenchmarkCorpus([{ index: 0, value: legacyV1Case() }]);
  assert.deepEqual(
    clean.issues,
    [],
    `a v1 case must read unchanged: ${JSON.stringify(clean.issues)}`,
  );
  assert.equal(clean.cases.length, 1);

  // A v1 case that also carries an unscoped `adjudication` is refused, exactly as v0.6 refused it: the record
  // cannot say which subject it settles. v0.7 neither started accepting it silently nor started rejecting it
  // newly — the issue text is the one v0.6 already printed.
  const legacy: BenchmarkCase = {
    ...legacyV1Case(),
    adjudication: {
      outcome: 'RESOLVED',
      reason: 'One decision for the whole case, as v1 recorded it.',
      adjudicatedBy: 'sam',
    },
    adjudications: [],
  };
  const issues = validateBenchmarkCorpus([{ index: 0, value: legacy }]).issues;
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.field, 'adjudication');
  assert.match(issues[0]?.message ?? '', /cannot say which subject it settles/);

  // Where the resolver does honour such a record — one disagreement on the case — it settles as before and is
  // labelled unbound rather than verified.
  const report = disagreementReport(legacy);
  const subject = report.subjects.find((entry) => entry.subjectId === 'p1');
  assert.equal(subject?.status, 'ADJUDICATED');
  assert.equal(subject?.binding, 'UNBOUND');

  const rows = agreementRows([legacy]);
  const evidence = rows.find((row) => row.dimension === 'EVIDENCE_SUPPORT');
  assert.equal(evidence?.status, 'RESOLVED_BY_ADJUDICATION', 'scoring must agree with the report');
  assert.equal(evidence?.adjudicationBinding, 'UNBOUND');
  // A v1 record names no settled label, so it cannot become a scorable gold value.
  assert.equal(evidence?.adjudicatedLabel, null);
});

test('benchmark-report-v2 keeps its version, its status enum, and only additive new fields', () => {
  const legacy = legacyV1Case();
  const validation = validateBenchmarkCorpus([{ index: 0, value: legacy }]);
  const cases = validation.cases as unknown as readonly BenchmarkCase[];
  const rows = agreementRows(cases);
  const dimensions = [...new Set(rows.map((row) => row.dimension))];
  const summaries = annotationSummaries(rows, dimensions);
  const report = buildBenchmarkReport(
    validation,
    // No produced-pipeline rows are asserted here; the compatibility question is the report envelope, the
    // agreement statuses and the annotation summary shape, all of which are built from the case itself.
    [],
    scoreByDimension([], BENCHMARK_DIMENSIONS),
    rows,
    summaries,
    [],
    [],
  );

  assert.equal(report.version, BENCHMARK_REPORT_VERSION);
  assert.equal(BENCHMARK_REPORT_VERSION, 'benchmark-report-v2');
  const allowed = new Set([
    'NOT_ENOUGH_REVIEWERS',
    'UNANIMOUS',
    'RESOLVED_BY_ADJUDICATION',
    'GENUINELY_AMBIGUOUS',
    'UNRESOLVED',
  ]);
  for (const row of report.methodology.agreement) {
    assert.ok(allowed.has(row.status), `report emitted a new status: ${row.status}`);
  }
  // The v0.7 disclosure fields exist, and everything a v0.6 reader expects is still there.
  for (const summary of report.methodology.annotation) {
    for (const key of [
      'dimension',
      'subjects',
      'scorable',
      'agreeingWithGold',
      'agreementRate',
      'excludedUnresolved',
      'excludedAmbiguous',
      'excludedSingleReviewer',
      'note',
      'excludedStaleAdjudication',
      'excludedUnboundAdjudication',
    ]) {
      assert.ok(key in summary, `annotation summary lost ${key}`);
    }
  }
  assert.equal((report.statement as { accuracyClaimable: boolean }).accuracyClaimable, false);
});

test('an unbound legacy adjudication is disclosed by the release gates, never credited as verified', () => {
  const legacy: BenchmarkCase = {
    ...legacyV1Case(),
    adjudications: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        subjectId: 'p1',
        outcome: 'RESOLVED',
        label: 'CONTRADICTED',
        reason: 'Filed under v0.6, with no binding.',
        adjudicatedBy: 'sam',
      },
    ],
  };
  const gates = releaseGates([legacy], { issues: [] });
  const disclosure = gates.find((gate) => gate.name === 'allAdjudicationsBound');
  assert.equal(
    disclosure?.passed,
    false,
    'a legacy record must not be presented as verified provenance',
  );
  assert.equal(
    disclosure?.blocking,
    false,
    'and freezing an honest legacy corpus must not be blocked',
  );
  assert.match(disclosure?.detail ?? '', /predate binding/);
  // The legacy record still settles the subject, which is the compatibility half of the rule.
  assert.equal(
    disagreementReport(legacy).subjects.find((entry) => entry.subjectId === 'p1')?.status,
    'ADJUDICATED',
  );
});

test('a v0.6-era packet file verifies against the same case under v0.7', () => {
  const benchmarkCase = fixtureCase({ id: 'case-packet-compat', reviewedBy: ['dana', 'erin'] });
  const packet = buildReviewerPacket(benchmarkCase);
  // A packet written by v0.6 is byte-identical to one written now: the packet contract did not change, so
  // `packetHash` staleness detection works across the upgrade.
  const reparsed = JSON.parse(JSON.stringify(packet)) as typeof packet;
  assert.equal(reparsed.version, 'benchmark-packet-v1');
  assert.equal(reparsed.packetHash, buildReviewerPacket(benchmarkCase).packetHash);
  // Gold, annotations and provenance are still absent from the blinded view.
  const record = reparsed as unknown as Record<string, unknown>;
  for (const forbidden of [
    'expected',
    'reviewerLabels',
    'adjudications',
    'provenance',
    'stratum',
  ]) {
    assert.ok(!(forbidden in record));
  }
});
