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
import { releaseGates, buildReleaseManifest } from '../../src/benchmark/release.ts';
import {
  bindRunToRelease,
  buildRunRecord,
  composeRunReport,
} from '../../src/benchmark/execution.ts';
import { canonicalise } from '../../src/benchmark/hashing.ts';
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

/**
 * Labels from both reviewers over every subject the fixture exposes.
 *
 * A case with unannotated subjects fails a blocking release gate, and an incompatible corpus that cannot be
 * frozen cannot show anything about compatibility — so the ledger tests label the whole fixture and vary only
 * the thing under test.
 */
function annotatedPair(first: string, second: string, secondEvidenceLabel?: string) {
  const subjects: [
    'EVIDENCE_SUPPORT' | 'ANSWER_FIDELITY' | 'CITATION_SUPPORT' | 'ATTRIBUTION',
    string,
    string,
  ][] = [
    ['EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'],
    ['ANSWER_FIDELITY', 'st1', 'NOT_ASSESSABLE'],
    ['CITATION_SUPPORT', 'st1', 'NOT_ASSESSABLE'],
    ['ATTRIBUTION', 'st1', 'NOT_ASSESSABLE'],
  ];
  return subjects.flatMap(([dimension, subjectId, value]) => [
    labelFor(first, dimension, subjectId, value),
    labelFor(
      second,
      dimension,
      subjectId,
      dimension === 'EVIDENCE_SUPPORT' && secondEvidenceLabel !== undefined
        ? secondEvidenceLabel
        : value,
    ),
  ]);
}

/**
 * v0.8 changed a corpus read, a report construction, an id rule and every output path, and claimed none of it
 * would break an older artifact. Each test below takes something written before v0.8 and runs it through the
 * v0.8 code, because a compatibility promise that is only asserted in prose is a guess.
 */

test('a v0.7 release manifest still binds a v0.8 run, and its unbound decision still settles', () => {
  const legacy = {
    ...fixtureCase({
      id: 'v07-manifest-case',
      reviewedBy: ['dana', 'sam'],
      reviewerLabels: annotatedPair('dana', 'sam', 'INSUFFICIENT_EVIDENCE'),
    }),
    adjudications: [
      {
        dimension: 'EVIDENCE_SUPPORT' as const,
        subjectId: 'p1',
        outcome: 'RESOLVED' as const,
        label: 'INSUFFICIENT_EVIDENCE',
        reason: 'A decision recorded before bindings existed.',
        adjudicatedBy: 'dana',
      },
    ],
  } as unknown as BenchmarkCase;

  // Built by the v0.7 release code, read by the v0.8 binder: no migration, no re-freeze.
  const manifest = buildReleaseManifest([legacy], null, 'v07 freeze', {
    issues: [],
  });
  const binding = bindRunToRelease({
    manifest: JSON.parse(JSON.stringify(canonicalise(manifest))),
    cases: [legacy],
    validation: validateBenchmarkCorpus([{ index: 0, value: legacy }]),
    manifestText: JSON.stringify(manifest),
  });
  assert.equal(binding.ok, true, binding.refused.join('; '));
  // The unbound record still settles the subject - and is still disclosed rather than credited.
  assert.ok(binding.warnings.some((warning) => warning.includes('allAdjudicationsBound')));
  assert.equal(disagreementReport(legacy).unbound, 1);
  assert.equal(disagreementReport(legacy).unresolved, 0);
});

test('both case contracts score through the shared pipeline exactly as the harness scored them', () => {
  const v1 = fixtureCase({
    id: 'compat-v1',
    version: BENCHMARK_CASE_VERSION_V1,
    reviewedBy: ['dana', 'sam'],
    reviewerLabels: annotatedPair('dana', 'sam'),
  });
  const v2 = fixtureCase({
    id: 'compat-v2',
    reviewedBy: ['dana', 'sam'],
    reviewerLabels: annotatedPair('dana', 'sam'),
  });
  const validation = validateBenchmarkCorpus([
    { index: 0, value: v1 },
    { index: 1, value: v2 },
  ]);
  assert.equal(validation.cases.length, 2, 'an older contract stopped reading');
  const { report, reportText } = composeRunReport(
    [
      { name: 'v1.json', text: JSON.stringify(v1), values: [v1] },
      { name: 'v2.json', text: JSON.stringify(v2), values: [v2] },
    ],
    validation,
  );
  assert.equal(report.version, BENCHMARK_REPORT_VERSION);
  assert.equal(report.statement.structuralReadiness.legacyContractCases, 1);
  assert.deepEqual([...report.caseFormatsPresent].sort(), [
    BENCHMARK_CASE_VERSION_V1,
    'benchmark-case-v2',
  ]);
  // The digests the harness used to build inline are still built, with their old truncated shapes intact.
  assert.ok(report.corpus.digests.some((entry) => entry.kind === 'file' && entry.caseCount === 1));
  for (const entry of report.corpus.digests) {
    assert.match(entry.digest, /^[0-9a-f]{16}$/);
  }
  assert.ok(reportText.endsWith('\n'));
  assert.equal(report.statement.accuracyClaimable, false);
});

test('a v0.8 receipt can be built over a v0.7-shaped corpus without any new case fields', () => {
  const plain = fixtureCase({
    id: 'receipt-legacy',
    reviewedBy: ['dana', 'sam'],
    reviewerLabels: annotatedPair('dana', 'sam'),
  });
  const validation = validateBenchmarkCorpus([{ index: 0, value: plain }]);
  const cases = validation.cases as unknown as readonly BenchmarkCase[];
  const manifest = buildReleaseManifest(cases, null, null, validation);
  const manifestText = `${JSON.stringify(canonicalise(manifest))}\n`;
  const binding = bindRunToRelease({
    manifest: JSON.parse(manifestText),
    cases,
    validation,
    manifestText,
  });
  assert.equal(binding.ok, true, binding.refused.join('; '));
  const composed = composeRunReport(
    [{ name: 'plain.json', text: JSON.stringify(plain), values: [plain] }],
    validation,
  );
  const record = buildRunRecord({
    report: composed.report,
    reportText: composed.reportText,
    binding,
    cases,
    sourceRevision: null,
  });
  // A case with none of the v0.7 provenance fields yields a receipt that invents none.
  assert.equal(record.caseCount, 1);
  assert.equal(record.warnings.unboundAdjudications, 0);
  assert.equal(record.sourceRevision, null);
  assert.deepEqual(record.versions.caseContractVersions, ['benchmark-case-v2']);
});
