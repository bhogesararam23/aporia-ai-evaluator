import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';
import type { BenchmarkCase, BenchmarkStratum } from '../../src/benchmark/types.ts';

/**
 * The `benchmark:release` command (ADR-027).
 *
 * These run the real CLI over real temporary directories, because the properties that matter — byte-stable
 * freezes, drift detection, refusals instead of stack traces, and no machine-specific bytes — are properties
 * of the tool an operator actually runs, not of the pure functions underneath it.
 */

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const CLI = join(ROOT, 'scripts/benchmark-release.ts');

type Run = { code: number; stdout: string; stderr: string };

async function cli(args: readonly string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { cwd: ROOT });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

function tempDir(): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'aporia-release-'));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

/**
 * A fully reviewed case: two declared reviewers, every subject annotated, unanimous so nothing is left
 * unresolved. A release corpus that skips a subject *should* fail a blocking gate, and the gates test relies
 * on that, so the happy path has to be genuinely complete rather than merely valid.
 */
const SUBJECT_LABELS: readonly (readonly [
  BenchmarkCase['reviewerLabels'][number]['dimension'],
  string,
  string,
])[] = [
  ['EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'],
  ['ANSWER_FIDELITY', 'st1', 'NOT_ASSESSABLE'],
  ['CITATION_SUPPORT', 'st1', 'NOT_ASSESSABLE'],
  ['ATTRIBUTION', 'st1', 'NOT_ASSESSABLE'],
];

function reviewedCase(id: string, stratum?: BenchmarkStratum): BenchmarkCase {
  const reviewerLabels = (['dana', 'erin'] as const).flatMap((reviewer) =>
    SUBJECT_LABELS.map(([dimension, subjectId, value]) =>
      labelFor(reviewer, dimension, subjectId, value),
    ),
  );
  const base = { id, reviewedBy: ['dana', 'erin'], reviewerLabels } as const;
  // `stratum` is supplied only when given, because an explicit `undefined` is a different record under
  // `exactOptionalPropertyTypes` and the fixture must not receive one.
  return stratum === undefined ? fixtureCase(base) : fixtureCase({ ...base, stratum });
}

function writeCorpus(directory: string, cases: readonly BenchmarkCase[]): void {
  cases.forEach((benchmarkCase, index) => {
    writeFileSync(join(directory, `${index}.json`), JSON.stringify(benchmarkCase), 'utf8');
  });
}

function readManifest(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/** A refusal is printed with a reason; a crash is a stack. The two must not be confused. */
function assertRefused(result: Run, expectation: RegExp): void {
  assert.notEqual(result.code, 0, `expected a refusal, got success: ${result.stderr}`);
  assert.doesNotMatch(
    result.stderr,
    /TypeError|RangeError|Cannot read prop|is not a function/,
    `input was thrown on instead of refused: ${result.stderr}`,
  );
  assert.match(result.stderr, expectation);
}

test('freeze writes a manifest, and re-freezing the same corpus yields identical bytes', async () => {
  const corpus = tempDir();
  const out = tempDir();
  try {
    writeCorpus(corpus.path, [reviewedCase('case-a'), reviewedCase('case-b')]);
    const first = join(out.path, 'release-1.json');
    const second = join(out.path, 'release-2.json');
    assert.equal(
      (await cli(['freeze', '--corpus', corpus.path, '--out', first])).code,
      0,
      `a well-formed corpus freezes: ${(await cli(['freeze', '--corpus', corpus.path, '--out', first])).stderr}`,
    );
    assert.equal((await cli(['freeze', '--corpus', corpus.path, '--out', second])).code, 0);
    assert.equal(readFileSync(first, 'utf8'), readFileSync(second, 'utf8'));

    const manifest = readManifest(first);
    assert.equal(manifest['version'], 'benchmark-release-manifest-v1');
    assert.equal(manifest['caseCount'], 2);
    assert.equal(manifest['accuracyClaimable'], false);
    assert.match(String(manifest['releaseId']), /^release-[0-9a-f]{12}$/);
  } finally {
    corpus.remove();
    out.remove();
  }
});

test('a manifest records no absolute path, no timestamp and no machine identity', async () => {
  const corpus = tempDir();
  const out = tempDir();
  try {
    writeCorpus(corpus.path, [reviewedCase('case-a')]);
    const manifestPath = join(out.path, 'release.json');
    assert.equal((await cli(['freeze', '--corpus', corpus.path, '--out', manifestPath])).code, 0);
    const text = readFileSync(manifestPath, 'utf8');
    assert.ok(!text.includes(corpus.path), `the corpus directory leaked: ${corpus.path}`);
    assert.ok(!text.includes(tmpdir()), 'the temp root must not appear in a release document');
    assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T\d{2}:/, 'no clock value may be frozen');
    assert.doesNotMatch(text, /"file": "[^"]*[\\]/, 'no path separator may appear in a file name');
  } finally {
    corpus.remove();
    out.remove();
  }
});

test('verify passes an untouched corpus and pinpoints a tampered case', async () => {
  const corpus = tempDir();
  const out = tempDir();
  try {
    writeCorpus(corpus.path, [reviewedCase('case-a'), reviewedCase('case-b')]);
    const manifestPath = join(out.path, 'release.json');
    assert.equal((await cli(['freeze', '--corpus', corpus.path, '--out', manifestPath])).code, 0);
    const clean = await cli(['verify', '--corpus', corpus.path, '--manifest', manifestPath]);
    assert.equal(clean.code, 0, clean.stderr);
    assert.match(clean.stderr, /VERIFIED/);

    const edited = reviewedCase('case-b');
    writeCorpus(corpus.path, [
      reviewedCase('case-a'),
      { ...edited, title: 'Edited after the freeze.' },
    ]);
    const drifted = await cli(['verify', '--corpus', corpus.path, '--manifest', manifestPath]);
    assertRefused(drifted, /DRIFTED/);
    assert.match(drifted.stderr, /CHANGED\s+case-b/);
    assert.match(drifted.stderr, /integrity checks over recorded content/);
  } finally {
    corpus.remove();
    out.remove();
  }
});

test('diff reports an added and a changed case between two frozen releases', async () => {
  const first = tempDir();
  const second = tempDir();
  const out = tempDir();
  try {
    writeCorpus(first.path, [reviewedCase('case-a')]);
    writeCorpus(second.path, [reviewedCase('case-a'), reviewedCase('case-b')]);
    const before = join(out.path, 'before.json');
    const after = join(out.path, 'after.json');
    assert.equal((await cli(['freeze', '--corpus', first.path, '--out', before])).code, 0);
    assert.equal((await cli(['freeze', '--corpus', second.path, '--out', after])).code, 0);
    const result = await cli(['diff', '--before', before, '--after', after]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /ADDED\s+case-b/);
    assert.match(result.stderr, /not a claim that the later release is better/);
  } finally {
    first.remove();
    second.remove();
    out.remove();
  }
});

test('gates reports provenance and completeness, and fails a blocking gate', async () => {
  const good = tempDir();
  const bad = tempDir();
  try {
    writeCorpus(good.path, [reviewedCase('case-a'), reviewedCase('case-b')]);
    const passing = await cli(['gates', '--corpus', good.path]);
    assert.equal(passing.code, 0, passing.stderr);
    assert.match(passing.stderr, /PASS\s+everyCaseAuthorisedForStorage/);
    assert.match(passing.stderr, /NOTE\s+strataCovered/);

    const unauthorised = reviewedCase('case-x');
    writeCorpus(bad.path, [
      { ...unauthorised, provenance: { ...unauthorised.provenance, authorizedForStorage: false } },
    ]);
    const failing = await cli(['gates', '--corpus', bad.path]);
    // An unauthorised case never validates at all, so the gate that reports it is `everyCaseValidates`.
    assertRefused(failing, /FAIL\s+everyCaseValidates/);

    // A case that validates but leaves a real reviewer split unresolved is the blocking failure a release
    // must not paper over: the corpus is internally consistent, and still not settled.
    const splitCase = fixtureCase({
      id: 'case-split',
      reviewedBy: ['dana', 'erin'],
      reviewerLabels: [
        labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
        labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'PARTIALLY_SUPPORTED'),
        labelFor('dana', 'ANSWER_FIDELITY', 'st1', 'NOT_ASSESSABLE'),
        labelFor('erin', 'ANSWER_FIDELITY', 'st1', 'NOT_ASSESSABLE'),
        labelFor('dana', 'CITATION_SUPPORT', 'st1', 'NOT_ASSESSABLE'),
        labelFor('erin', 'CITATION_SUPPORT', 'st1', 'NOT_ASSESSABLE'),
        labelFor('dana', 'ATTRIBUTION', 'st1', 'NOT_ASSESSABLE'),
        labelFor('erin', 'ATTRIBUTION', 'st1', 'NOT_ASSESSABLE'),
      ],
    });
    const splitDir = tempDir();
    try {
      writeCorpus(splitDir.path, [splitCase]);
      const splitGates = await cli(['gates', '--corpus', splitDir.path]);
      assertRefused(splitGates, /FAIL\s+noUnresolvedDisagreements/);
      assert.match(splitGates.stderr, /PASS\s+everyCaseAuthorisedForStorage/);
      assert.equal(
        (await cli(['freeze', '--corpus', splitDir.path, '--out', join(splitDir.path, 'r.json')]))
          .code,
        1,
        'a corpus with an unresolved split freezes with a failed blocking gate',
      );
    } finally {
      splitDir.remove();
    }
  } finally {
    good.remove();
    bad.remove();
  }
});

test('freeze refuses a corpus that does not validate instead of certifying an inconsistency', async () => {
  const corpus = tempDir();
  const out = tempDir();
  try {
    writeCorpus(corpus.path, [reviewedCase('case-a')]);
    writeFileSync(
      join(corpus.path, 'broken.json'),
      JSON.stringify({ version: 'benchmark-case-v2', id: 'case-broken' }),
      'utf8',
    );
    const manifestPath = join(out.path, 'release.json');
    const result = await cli(['freeze', '--corpus', corpus.path, '--out', manifestPath]);
    assertRefused(result, /Refusing to freeze/);
    assert.equal(existsSync(manifestPath), false, 'a refused freeze writes no manifest');
  } finally {
    corpus.remove();
    out.remove();
  }
});

test('a malformed manifest or an unreadable corpus is refused with a reason, never thrown on', async () => {
  const corpus = tempDir();
  const out = tempDir();
  try {
    writeCorpus(corpus.path, [reviewedCase('case-a')]);
    const brokenManifest = join(out.path, 'broken.json');
    writeFileSync(brokenManifest, '{ not json', 'utf8');
    assertRefused(
      await cli(['verify', '--corpus', corpus.path, '--manifest', brokenManifest]),
      /could not be read or parsed/,
    );
    writeFileSync(brokenManifest, JSON.stringify({ version: 'x' }), 'utf8');
    assertRefused(
      await cli(['verify', '--corpus', corpus.path, '--manifest', brokenManifest]),
      /no version or case list/,
    );
    // An unreadable corpus is refused too, once the manifest itself is sound: verify reads the manifest
    // first, so that is the error a caller with both problems sees.
    const goodManifest = join(out.path, 'good.json');
    assert.equal((await cli(['freeze', '--corpus', corpus.path, '--out', goodManifest])).code, 0);
    assertRefused(
      await cli(['verify', '--corpus', join(corpus.path, 'nowhere'), '--manifest', goodManifest]),
      /could not be read/,
    );
    assertRefused(
      await cli(['gates', '--corpus', join(corpus.path, 'nowhere')]),
      /could not be read/,
    );
  } finally {
    corpus.remove();
    out.remove();
  }
});

test('--snapshot copies canonical cases, and a default freeze duplicates no case material', async () => {
  const corpus = tempDir();
  const out = tempDir();
  try {
    writeCorpus(corpus.path, [reviewedCase('case-a'), reviewedCase('case-b')]);
    const plain = join(out.path, 'plain.json');
    assert.equal((await cli(['freeze', '--corpus', corpus.path, '--out', plain])).code, 0);
    assert.deepEqual(
      readdirJson(out.path).filter((name) => name.endsWith('.json') && name !== 'plain.json'),
      [],
      'without --snapshot a freeze writes only the manifest',
    );

    const snapshot = join(out.path, 'snapshot');
    const frozen = join(out.path, 'with-snapshot.json');
    const result = await cli([
      'freeze',
      '--corpus',
      corpus.path,
      '--out',
      frozen,
      '--snapshot',
      snapshot,
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /second location/);
    assert.deepEqual(readdirJson(snapshot).sort(), ['case-a.json', 'case-b.json']);
    const copied = readManifest(join(snapshot, 'case-a.json')) as { reviewerLabels: unknown[] };
    assert.equal(copied.reviewerLabels.length, 8, 'the copy carries every reviewed label');
  } finally {
    corpus.remove();
    out.remove();
  }
});

function readdirJson(directory: string): string[] {
  try {
    return readdirSync(directory).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
}

test('the release CLI prints usage and never claims a subcommand it does not implement', async () => {
  const result = await cli(['--help']);
  assert.equal(result.code, 0, result.stderr);
  for (const command of ['freeze', 'verify', 'diff', 'gates']) {
    assert.ok(result.stdout.includes(command), `usage should list ${command}`);
  }
  assert.match(result.stdout, /accuracyClaimable is false/);
  assertRefused(await cli(['froze', '--corpus', 'x']), /Unknown subcommand/);
});
