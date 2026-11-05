import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';
import { scratchDirectory } from '../helpers/temp.ts';
import { canonicalise } from '../../src/benchmark/hashing.ts';

/**
 * Release-bound execution end to end (v0.8, spec §4–§6).
 *
 * The pure layer decides *what* a binding means; this file is where it earns its keep: a manifest frozen from a
 * real corpus, then the harness refusing the same corpus after one edited sentence, and writing no report on the
 * way out. A run that prints a refusal and still leaves a report behind is the failure mode this exists to
 * prevent, because the next reader cannot tell which is which.
 */

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function script(relative: string, args: readonly string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await run(process.execPath, [join(ROOT, relative), ...args], {
      cwd: ROOT,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

/** A case both declared reviewers agree on, so the blocking gates can pass for a one-case corpus. */
function agreedCase(id: string): ReturnType<typeof fixtureCase> {
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

interface Fixture {
  readonly temp: ReturnType<typeof scratchDirectory>;
  readonly corpus: string;
  readonly manifest: string;
}

/** Freeze a corpus the way an operator would: write cases, then `benchmark:release freeze`. */
function frozenRelease(cases: readonly unknown[]): Fixture {
  const temp = scratchDirectory('aporia-bound-');
  const corpus = join(temp.path, 'corpus');
  mkdirSync(corpus, { recursive: true });
  for (const [index, value] of cases.entries()) {
    writeFileSync(join(corpus, `case-${String(index)}.json`), JSON.stringify(value), 'utf8');
  }
  const manifest = join(temp.path, 'release.json');
  return { temp, corpus, manifest };
}

async function freeze(fixture: Fixture): Promise<Run> {
  return script('scripts/benchmark-release.ts', [
    'freeze',
    '--corpus',
    fixture.corpus,
    '--out',
    fixture.manifest,
  ]);
}

test('a corpus that matches its frozen release runs, and the binding is reported', async () => {
  const fixture = frozenRelease([agreedCase('bound-a')]);
  try {
    const frozen = await freeze(fixture);
    assert.equal(frozen.code, 0, frozen.stderr);
    const result = await script('scripts/benchmark.ts', [
      '--corpus',
      fixture.corpus,
      '--release',
      fixture.manifest,
    ]);
    // The one-case corpus still fails the stratum requirement, which is a different refusal from the binding.
    assert.match(result.stderr, /bound-[0-9a-f]{12}|release-/);
    assert.match(result.stdout, /benchmark-report-v2/);
    assert.doesNotMatch(result.stderr, /CHANGED|ADDED|REMOVED|GATE /);
  } finally {
    fixture.temp.remove();
  }
});

test('one edited sentence is refused by case id, and no report is written', async () => {
  const fixture = frozenRelease([agreedCase('drift-a'), agreedCase('drift-b')]);
  try {
    assert.equal((await freeze(fixture)).code, 0);
    const target = join(fixture.corpus, 'case-0.json');
    const edited = { ...agreedCase('drift-a'), title: 'edited after the freeze' };
    writeFileSync(target, JSON.stringify(edited), 'utf8');

    const report = join(fixture.temp.path, 'report.json');
    const result = await script('scripts/benchmark.ts', [
      '--corpus',
      fixture.corpus,
      '--release',
      fixture.manifest,
      '--out',
      report,
    ]);
    assert.notEqual(result.code, 0, 'a drifted corpus was scored as though it were the release');
    assert.match(result.stderr, /^.*CHANGED drift-a/m);
    assert.equal(existsSync(report), false, 'a refused binding still published a report');
  } finally {
    fixture.temp.remove();
  }
});

test('a case added after the freeze is refused, not silently measured', async () => {
  const fixture = frozenRelease([agreedCase('extra-a')]);
  try {
    assert.equal((await freeze(fixture)).code, 0);
    writeFileSync(
      join(fixture.corpus, 'case-9.json'),
      JSON.stringify(agreedCase('extra-b')),
      'utf8',
    );
    const result = await script('scripts/benchmark.ts', [
      '--corpus',
      fixture.corpus,
      '--release',
      fixture.manifest,
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /ADDED extra-b/);
  } finally {
    fixture.temp.remove();
  }
});

test('a removed case is refused with its id', async () => {
  const fixture = frozenRelease([agreedCase('kept-a'), agreedCase('gone-a')]);
  try {
    assert.equal((await freeze(fixture)).code, 0);
    const manifest = JSON.parse(readFileSync(fixture.manifest, 'utf8')) as {
      cases: { file: string }[];
    };
    for (const entry of manifest.cases) {
      if (entry.file === 'case-1.json') {
        writeFileSync(join(fixture.corpus, 'case-1.json'), '{}', 'utf8');
      }
    }
    const result = await script('scripts/benchmark.ts', [
      '--corpus',
      fixture.corpus,
      '--release',
      fixture.manifest,
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /REMOVED gone-a|INVALID/);
  } finally {
    fixture.temp.remove();
  }
});

test('a manifest from another contract version is refused before the corpus is scored', async () => {
  const fixture = frozenRelease([agreedCase('stale-a')]);
  try {
    assert.equal((await freeze(fixture)).code, 0);
    const original = JSON.parse(readFileSync(fixture.manifest, 'utf8')) as Record<string, unknown>;
    writeFileSync(
      fixture.manifest,
      JSON.stringify(canonicalise({ ...original, version: 'benchmark-release-manifest-v2' })),
      'utf8',
    );
    const result = await script('scripts/benchmark.ts', [
      '--corpus',
      fixture.corpus,
      '--release',
      fixture.manifest,
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /MANIFEST/);
    assert.match(result.stderr, /benchmark-release-manifest-v1/);
  } finally {
    fixture.temp.remove();
  }
});

test('an unreadable manifest path is a stated refusal, never a stack trace', async () => {
  const fixture = frozenRelease([agreedCase('missing-a')]);
  try {
    const result = await script('scripts/benchmark.ts', [
      '--corpus',
      fixture.corpus,
      '--release',
      join(fixture.temp.path, 'never-written.json'),
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /never-written\.json/);
    assert.ok(
      !/at .*\.(?:ts|mts):\d+:\d+/.test(result.stderr),
      `a missing manifest crashed instead of refusing:\n${result.stderr.slice(0, 300)}`,
    );
  } finally {
    fixture.temp.remove();
  }
});

test('without --release the harness behaves as it always did', async () => {
  const fixture = frozenRelease([agreedCase('unbound-a')]);
  try {
    const result = await script('scripts/benchmark.ts', ['--corpus', fixture.corpus]);
    // Same exit behaviour and same report as v0.7: the binding is opt-in, so CI step 17 and every documented
    // invocation keep working unchanged.
    assert.match(result.stdout, /benchmark-report-v2/);
    assert.doesNotMatch(
      result.stderr,
      /NOT-RELEASE-BOUND/,
      'the harness itself should not print the warning',
    );
  } finally {
    fixture.temp.remove();
  }
});

test('a non-blocking provenance gap is disclosed but never blocks the run', async () => {
  // Legacy unbound decision, exactly the shape the owner asked to keep readable.
  const legacy = {
    ...agreedCase('legacy-a'),
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
        dimension: 'EVIDENCE_SUPPORT',
        subjectId: 'p1',
        outcome: 'RESOLVED',
        label: 'SUPPORTED_WITHIN_SCOPE',
        reason: 'Settled before bindings existed.',
        adjudicatedBy: 'dana',
      },
    ],
  };
  const fixture = frozenRelease([legacy]);
  try {
    const frozen = await freeze(fixture);
    // The stale/unbound record is a non-blocking gate, so a freeze still writes; a blocking gate would not.
    assert.equal(existsSync(fixture.manifest), true, frozen.stderr);
    const result = await script('scripts/benchmark.ts', [
      '--corpus',
      fixture.corpus,
      '--release',
      fixture.manifest,
    ]);
    assert.match(
      result.stderr,
      /allAdjudicationsBound|unbound/i,
      `an unbound decision was not disclosed:\n${result.stderr}`,
    );
  } finally {
    fixture.temp.remove();
  }
});
