import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { MAX_ARTIFACT_BYTES } from '../../scripts/corpus-io.ts';
import { BENCHMARK_CASE_VERSION } from '../../src/benchmark/types.ts';
import { BENCHMARK_LIMITS } from '../../src/benchmark/validate.ts';
import { scratchDirectory } from '../helpers/temp.ts';

/**
 * Hostile input reaches every benchmark command, and each one must answer in words.
 *
 * v0.7's `benchmark:case` and `benchmark:release` shared a loader that had never looked at what a directory
 * entry actually was, so a subdirectory named `nested.json` produced a raw `EISDIR` and a stack trace, while
 * `npm run benchmark` — with a different loader — skipped the same entry without comment. These tests hold
 * all three to one behaviour: refuse with the entry named. `scripts/benchmark.ts` is covered once it shares
 * the loader.
 */

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function script(relative: string, args: readonly string[]): Promise<CliResult> {
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

/** A validating case *object*. Callers serialise it — double-encoding here once produced an array of strings. */
function validCase(id: string): Record<string, unknown> {
  return {
    version: BENCHMARK_CASE_VERSION,
    id,
    stratum: 'REFUSAL_NOT_A_DENIAL',
    title: 'A refusal that is not a denial',
    provenance: {
      origin: 'Synthetic CLI test fixture; no real capture.',
      authorizedForStorage: true,
      reviewedBy: ['dana'],
      reviewedAt: '2026-11-05',
      unverified: ['fixture only'],
      limitation: 'Synthetic fixture.',
    },
    input: {
      claimText: 'The tool announced version 2.',
      propositions: [
        {
          id: 'p1',
          text: 'The announcement was made.',
          evidence: [
            {
              id: 'e1',
              relation: 'SUPPORTS',
              sourceId: 's1',
              sourceType: 'PRIMARY_ARTIFACT',
              independence: 'INDEPENDENT',
              locator: 'section 1',
            },
          ],
        },
      ],
      answerText: 'I cannot confirm that.',
      citationCapture: 'NOT_SHOWN',
      citations: [
        { id: 'c1', url: 'https://example.invalid/a', supportsStatement: false, note: null },
      ],
      statements: [
        {
          id: 'st1',
          text: 'I cannot confirm that.',
          relevance: 'REFUSAL',
          propositionIds: ['p1'],
          citationIds: [],
        },
      ],
      providerLabel: 'Synthetic Fixture',
      locale: 'en',
    },
    expected: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        rationale: 'The recorded primary artifact states it.',
        subjectId: 'p1',
      },
      {
        dimension: 'ANSWER_FIDELITY',
        label: 'NOT_ASSESSABLE',
        rationale: 'A refusal asserts nothing.',
        subjectId: 'st1',
      },
      {
        dimension: 'CITATION_SUPPORT',
        label: 'NOT_ASSESSABLE',
        rationale: 'The answer cited nothing.',
        subjectId: 'st1',
      },
      {
        dimension: 'ATTRIBUTION',
        label: 'NOT_ASSESSABLE',
        rationale: 'A refusal attributes nothing.',
        subjectId: 'st1',
      },
    ],
    reviewerLabels: [],
    adjudications: [],
    limitations: ['Synthetic fixture only.'],
  };
}

/** A frame from the TypeScript runner is what an operator must never be handed. */
function assertNoStack(stderr: string, label: string): void {
  assert.ok(
    !/at .*\.(?:ts|mts):\d+:\d+/.test(stderr),
    `${label} printed a stack trace instead of a refusal:\n${stderr.slice(0, 400)}`,
  );
  assert.ok(
    !stderr.includes('node:fs'),
    `${label} printed a node:fs frame:\n${stderr.slice(0, 400)}`,
  );
}

test('benchmark:case refuses a directory named *.json with the entry named', async () => {
  const temp = scratchDirectory('aporia-corpus-cli-');
  try {
    writeFileSync(join(temp.path, 'good.json'), JSON.stringify(validCase('cli-good')), 'utf8');
    mkdirSync(join(temp.path, 'nested.json'));
    const result = await script('scripts/benchmark-case.ts', ['validate', '--corpus', temp.path]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /nested\.json/);
    assert.match(result.stderr, /not a regular file/);
    assertNoStack(result.stderr, 'benchmark:case validate');
  } finally {
    temp.remove();
  }
});

test('npm run benchmark refuses a hostile entry it used to skip', async () => {
  // v0.7's harness loader stat'd each entry and `continue`d past anything that was not a regular file, so a
  // directory named nested.json silently produced a report over a smaller corpus than the operator supplied.
  // Skipping is not the same as refusing: it reports a number as if nothing were missing.
  const temp = scratchDirectory('aporia-harness-nested-');
  try {
    writeFileSync(join(temp.path, 'good.json'), JSON.stringify(validCase('cli-good')), 'utf8');
    mkdirSync(join(temp.path, 'nested.json'));
    const result = await script('scripts/benchmark.ts', ['--corpus', temp.path]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /nested\.json/);
    assert.match(result.stderr, /not a regular file/);
    assertNoStack(result.stderr, 'npm run benchmark with a directory named *.json');
    // And the report is not written on the way out, so a refusal cannot be mistaken for a result.
    assert.doesNotMatch(result.stdout, /"version": "benchmark-report-v2"/);
  } finally {
    temp.remove();
  }
});

test('benchmark:release refuses the same entry, on every subcommand that reads a corpus', async () => {
  const temp = scratchDirectory('aporia-release-cli-');
  try {
    writeFileSync(join(temp.path, 'good.json'), JSON.stringify(validCase('cli-good')), 'utf8');
    mkdirSync(join(temp.path, 'nested.json'));
    for (const subcommand of ['gates', 'verify'] as const) {
      const args =
        subcommand === 'gates'
          ? ['gates', '--corpus', temp.path]
          : ['verify', '--corpus', temp.path, '--manifest', join(temp.path, 'absent.json')];
      const result = await script('scripts/benchmark-release.ts', args);
      assert.notEqual(result.code, 0, `${subcommand} accepted hostile input`);
      assertNoStack(result.stderr, `benchmark:release ${subcommand}`);
    }
  } finally {
    temp.remove();
  }
});

test('benchmark:release reports a missing manifest as a stated refusal, not an ENOENT', async () => {
  const temp = scratchDirectory('aporia-manifest-missing-');
  try {
    writeFileSync(join(temp.path, 'good.json'), JSON.stringify(validCase('cli-good')), 'utf8');
    const result = await script('scripts/benchmark-release.ts', [
      'verify',
      '--corpus',
      temp.path,
      '--manifest',
      join(temp.path, 'never-written.json'),
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /never-written\.json/);
    assertNoStack(result.stderr, 'benchmark:release verify with a missing manifest');
  } finally {
    temp.remove();
  }
});

test('malformed JSON is still a stated refusal after the entry checks', async () => {
  const temp = scratchDirectory('aporia-corpus-badjson-');
  try {
    writeFileSync(join(temp.path, 'broken.json'), '{ not json at all', 'utf8');
    const result = await script('scripts/benchmark-case.ts', ['validate', '--corpus', temp.path]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /broken\.json is not valid JSON/);
    assertNoStack(result.stderr, 'benchmark:case validate with malformed JSON');
  } finally {
    temp.remove();
  }
});

test('a manifest is read under a ceiling as well, and a directory is refused by name', async () => {
  const temp = scratchDirectory('aporia-manifest-bound-');
  try {
    const corpus = join(temp.path, 'corpus');
    mkdirSync(corpus, { recursive: true });
    writeFileSync(join(corpus, 'a.json'), JSON.stringify(validCase('bound-case')), 'utf8');

    // A manifest path that is a directory used to reach readFileSync and be reported as "could not be read or
    // parsed", which is technically true and practically useless.
    mkdirSync(join(temp.path, 'adir.json'));
    const wrongType = await script('scripts/benchmark-release.ts', [
      'verify',
      '--corpus',
      corpus,
      '--manifest',
      join(temp.path, 'adir.json'),
    ]);
    assert.notEqual(wrongType.code, 0);
    assert.match(wrongType.stderr, /not a regular file/);
    assertNoStack(wrongType.stderr, 'benchmark:release verify with a directory manifest');

    // Past the ceiling the file is refused rather than handed to the parser.
    writeFileSync(
      join(temp.path, 'fat.json'),
      `{"padding":"${'w'.repeat(MAX_ARTIFACT_BYTES + 10)}}`,
      'utf8',
    );
    const tooBig = await script('scripts/benchmark-release.ts', [
      'verify',
      '--corpus',
      corpus,
      '--manifest',
      join(temp.path, 'fat.json'),
    ]);
    assert.notEqual(tooBig.code, 0);
    assert.match(tooBig.stderr, /fat\.json/);
    assert.match(tooBig.stderr, /is not valid JSON|limit/);
    assertNoStack(tooBig.stderr, 'benchmark:release verify with an oversized manifest');
  } finally {
    temp.remove();
  }
});

test('a symlink in the corpus is refused, where this platform allows one to be made', async (t) => {
  const temp = scratchDirectory('aporia-corpus-symlink-');
  try {
    const outside = join(temp.path, '..', 'aporia-outside-target.json');
    writeFileSync(outside, JSON.stringify(validCase('from-outside')), 'utf8');
    const link = join(temp.path, 'link.json');
    try {
      symlinkSync(outside, link, 'file');
    } catch (error) {
      // Creating a symlink needs developer mode on Windows or root elsewhere. The refusal is implemented and
      // reviewed either way; this asserts it only where it can be demonstrated, and says so in the test
      // output instead of reporting a pass that never happened.
      const code = (error as NodeJS.ErrnoException).code ?? 'unknown';
      t.skip(
        `the platform refused to create a symlink (EPERM-classic unprivileged Windows): ${code}`,
      );
      return;
    }
    const result = await script('scripts/benchmark-case.ts', ['validate', '--corpus', temp.path]);
    assert.notEqual(result.code, 0, 'a symlinked corpus file was read as though it belonged here');
    assert.match(result.stderr, /link\.json/);
    assert.match(result.stderr, /symbolic link/);
    assertNoStack(result.stderr, 'benchmark:case with a symlink in the corpus');
    rmSync(outside, { force: true });
  } finally {
    temp.remove();
  }
});

test('one oversized file is refused by every command, not only by the harness', async () => {
  // This is the behaviour change the owner approved in ADR-028: `benchmark:case` and `benchmark:release` were
  // unbounded, so a 1,093,691-byte bundle was parsed by them and reported as "600 valid case(s)" while
  // `npm run benchmark` refused it. They now refuse it with the same words. The bound was not loosened to
  // meet them in the middle; the commands with no ceiling became as strict as the command that had one.
  const temp = scratchDirectory('aporia-corpus-bundle-');
  try {
    const padding = 'z'.repeat(BENCHMARK_LIMITS.maxCaseBytes + 200);
    writeFileSync(join(temp.path, 'bundle.json'), `{ "padding": "${padding}" }`, 'utf8');
    const results = await Promise.all([
      script('scripts/benchmark.ts', ['--corpus', temp.path]),
      script('scripts/benchmark-case.ts', ['validate', '--corpus', temp.path]),
      script('scripts/benchmark-release.ts', ['gates', '--corpus', temp.path]),
    ]);
    for (const [index, result] of results.entries()) {
      assert.notEqual(result.code, 0, `command ${String(index)} read an oversized corpus`);
      assert.match(
        result.stderr,
        /per-file limit/,
        `command ${String(index)} refused in other words`,
      );
      assert.match(result.stderr, /bundle\.json/);
      assertNoStack(result.stderr, `oversized-file refusal on command ${String(index)}`);
    }
  } finally {
    temp.remove();
  }
});

test('a bundle of many valid cases inside the ceiling is still read as a bundle', async () => {
  const temp = scratchDirectory('aporia-corpus-many-');
  try {
    // Bounding a read must not quietly change what a file *means*: one document holding an array of cases has
    // always been legal, and the ceiling is about bytes, not about forcing one case per file.
    writeFileSync(
      join(temp.path, 'many.json'),
      JSON.stringify([validCase('many-a'), validCase('many-b')]),
      'utf8',
    );
    const result = await script('scripts/benchmark-case.ts', ['validate', '--corpus', temp.path]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /2 valid case\(s\)/);
  } finally {
    temp.remove();
  }
});
