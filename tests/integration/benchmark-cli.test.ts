import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { BENCHMARK_CASE_VERSION } from '../../src/benchmark/types.ts';
import { METRICS_VERSION } from '../../src/core/versions.ts';
import type { BenchmarkReport } from '../../src/benchmark/report.ts';

function parseReport(stdout: string): BenchmarkReport {
  return JSON.parse(stdout) as BenchmarkReport;
}

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const CLI = join(ROOT, 'scripts/benchmark.ts');

function tempDir(): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'aporia-benchmark-'));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

async function cli(
  args: readonly string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { cwd: ROOT });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

function caseJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: BENCHMARK_CASE_VERSION,
    id: 'cli-case-1',
    stratum: 'SUPPORTED_PRIMARY_EVIDENCE',
    title: 'CLI fixture',
    provenance: {
      origin: 'Synthetic CLI fixture. Not a gold case.',
      authorizedForStorage: true,
      reviewedBy: ['reviewer-a'],
      reviewedAt: '2026-11-01',
      unverified: [],
      limitation: 'Fixture only.',
    },
    input: {
      claimText: 'A fixture claim that is long enough.',
      propositions: [
        {
          id: 'prop-1',
          text: 'A fixture proposition.',
          evidence: [
            {
              id: 'ev-1',
              relation: 'SUPPORTS',
              sourceType: 'PRIMARY_ARTIFACT',
              independence: 'INDEPENDENT',
              locator: 'section 1',
            },
          ],
        },
      ],
      answerText: 'A fixture answer.',
      citationCapture: 'CAPTURED',
      citations: [],
      statements: [
        {
          id: 'stmt-1',
          text: 'A fixture statement.',
          relevance: 'ADDRESSES',
          propositionIds: ['prop-1'],
          citationIds: [],
        },
      ],
      providerLabel: 'Fixture',
      locale: 'en',
    },
    expected: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        rationale: 'One recorded support and no contradiction.',
        subjectId: 'prop-1',
      },
    ],
    reviewerLabels: [],
    adjudication: null,
    limitations: ['Synthetic fixture used only to exercise the runner.'],
    ...overrides,
  });
}

test('an empty corpus exits non-zero and refuses to print a percentage', async () => {
  const temp = tempDir();
  try {
    const result = await cli(['--corpus', temp.path]);
    assert.notEqual(result.code, 0);
    assert.equal(result.stdout.trim(), '', 'an empty corpus must not emit a report with numbers');
    assert.match(result.stderr, /No accuracy claim is supportable/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /\d+(\.\d+)?%/);
  } finally {
    temp.remove();
  }
});

test('a missing corpus directory is reported, not crashed on', async () => {
  const result = await cli(['--corpus', join(tmpdir(), 'aporia-does-not-exist-xyz')]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /could not be read/);
});

test('a malformed JSON file fails the run with the filename named', async () => {
  const temp = tempDir();
  try {
    writeFileSync(join(temp.path, 'broken.json'), '{ not json at all');
    const result = await cli(['--corpus', temp.path]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /broken\.json is not valid JSON/);
  } finally {
    temp.remove();
  }
});

test('an unknown case version is a validation problem, not a silent skip', async () => {
  const temp = tempDir();
  try {
    writeFileSync(join(temp.path, 'a.json'), caseJson({ version: 'benchmark-case-v0' }), 'utf8');
    const result = await cli(['--corpus', temp.path]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /case problem/);
    assert.match(result.stderr, /version/);
  } finally {
    temp.remove();
  }
});

test('an oversized case file is refused before it is parsed', async () => {
  const temp = tempDir();
  try {
    writeFileSync(
      join(temp.path, 'huge.json'),
      JSON.stringify({ padding: 'x'.repeat(300_000) }),
      'utf8',
    );
    const result = await cli(['--corpus', temp.path]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /per-file limit/);
  } finally {
    temp.remove();
  }
});

function caseJsonInput(): Record<string, unknown> {
  return (JSON.parse(caseJson()) as { input: Record<string, unknown> }).input;
}

test('a valid corpus reports, names the missing strata, and exits non-zero', async () => {
  const temp = tempDir();
  try {
    writeFileSync(join(temp.path, 'a.json'), caseJson(), 'utf8');
    const result = await cli(['--corpus', temp.path]);
    assert.notEqual(result.code, 0, 'an incomplete strata set must not pass');
    assert.match(result.stderr, /required stratum/);
    const report = parseReport(result.stdout);
    assert.equal(report.corpus.caseCount, 1);
    assert.equal(report.corpus.invalidCount, 0);
    assert.equal(
      report.statement.accuracyClaimable,
      false,
      'a framework result is not an accuracy claim',
    );
    assert.equal(report.caseFormat, BENCHMARK_CASE_VERSION);
    assert.equal(report.metricsVersion, METRICS_VERSION);
  } finally {
    temp.remove();
  }
});

test('a report is byte-identical across runs over the same corpus', async () => {
  const temp = tempDir();
  try {
    writeFileSync(join(temp.path, 'a.json'), caseJson(), 'utf8');
    writeFileSync(
      join(temp.path, 'b.json'),
      caseJson({
        id: 'cli-case-2',
        stratum: 'REFUSAL_NOT_A_DENIAL',
        input: {
          ...caseJsonInput(),
          // No recorded relationship at all, so the deterministic rule must answer NOT_ASSESSED.
          propositions: [{ id: 'prop-1', text: 'A fixture proposition.', evidence: [] }],
        },
        expected: [
          {
            dimension: 'EVIDENCE_SUPPORT',
            label: 'NOT_ASSESSED',
            rationale: 'Nothing was recorded either way, so the rule can reach no verdict.',
            subjectId: 'prop-1',
          },
        ],
      }),
      'utf8',
    );
    const first = await cli(['--corpus', temp.path, '--allow-partial-strata']);
    const second = await cli(['--corpus', temp.path, '--allow-partial-strata']);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(first.stdout, second.stdout, 'the report must be reproducible');
    assert.doesNotMatch(first.stdout, /20\d\d-\d\d-\d\dT/, 'no wall-clock time in the report');
    const report = parseReport(first.stdout);
    assert.equal(report.corpus.caseCount, 2);
    assert.equal(report.regression.scored, 2);
    assert.deepEqual(
      report.cases.map((row) => row.id),
      ['cli-case-1', 'cli-case-2'],
    );
  } finally {
    temp.remove();
  }
});

test('a deterministic mismatch fails the run and names the component', async () => {
  const temp = tempDir();
  try {
    writeFileSync(
      join(temp.path, 'a.json'),
      caseJson({
        expected: [
          {
            dimension: 'EVIDENCE_SUPPORT',
            label: 'CONTRADICTED',
            rationale: 'Deliberately wrong expectation to exercise the mismatch path.',
            subjectId: 'prop-1',
          },
        ],
      }),
      'utf8',
    );
    const result = await cli(['--corpus', temp.path, '--allow-partial-strata']);
    assert.notEqual(result.code, 0);
    const report = parseReport(result.stdout);
    assert.equal(report.regression.mismatches.length, 1);
    assert.match(result.stdout, /evidence-aggregation-v1/);
  } finally {
    temp.remove();
  }
});

test('a human-judgement disagreement is never counted as a regression', async () => {
  const temp = tempDir();
  try {
    writeFileSync(
      join(temp.path, 'a.json'),
      caseJson({
        expected: [
          {
            dimension: 'EVIDENCE_SUPPORT',
            label: 'SUPPORTED_WITHIN_SCOPE',
            rationale: 'Matches the deterministic rule.',
            subjectId: 'prop-1',
          },
          {
            dimension: 'ANSWER_FIDELITY',
            label: 'ACCURATE',
            rationale: 'Reviewer judgement fixture.',
            subjectId: 'stmt-1',
          },
        ],
      }),
      'utf8',
    );
    const result = await cli(['--corpus', temp.path, '--allow-partial-strata']);
    assert.equal(result.code, 0, result.stderr);
    const report = parseReport(result.stdout);
    assert.equal(
      report.regression.scored,
      1,
      'only the deterministic dimension is regression-scored',
    );
    assert.equal(report.regression.mismatches.length, 0);
    assert.equal(report.statement.accuracyClaimable, false);
  } finally {
    temp.remove();
  }
});

test('the report carries the reproducibility and honesty statements the milestone requires', async () => {
  const temp = tempDir();
  try {
    writeFileSync(join(temp.path, 'a.json'), caseJson(), 'utf8');
    const output = join(temp.path, 'nested', 'report.json');
    const result = await cli(['--corpus', temp.path, '--out', output, '--allow-partial-strata']);
    assert.equal(result.code, 0, result.stderr);
    const report = parseReport(readFileSync(output, 'utf8'));
    assert.equal(report.version, 'benchmark-report-v1');
    assert.equal(report.caseFormat, BENCHMARK_CASE_VERSION);
    assert.equal(typeof report.methodologyVersion, 'string');
    assert.equal(typeof report.metricsVersion, 'string');
    assert.equal(typeof report.evidenceRuleVersion, 'string');
    assert.match(report.statement.generalisation, /do not extend to other providers/);
    assert.match(report.statement.statistics, /No confidence interval/);
    assert.match(report.methodology.reviewerIdentityNote, /no authentication/);
    assert.match(
      report.regression.limitations.join(' '),
      /never makes/,
      'the report must state which judgements the software does not make',
    );
  } finally {
    temp.remove();
  }
});

test('unknown arguments and a missing corpus flag print usage instead of guessing', async () => {
  const unknown = await cli(['--corpus', '.', '--bogus']);
  assert.notEqual(unknown.code, 0);
  assert.match(unknown.stderr, /Unknown argument/);
  const missing = await cli([]);
  assert.notEqual(missing.code, 0);
  assert.match(missing.stdout + missing.stderr, /Usage:/);
});
