import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { BENCHMARK_CASE_VERSION } from '../../src/benchmark/types.ts';
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

function validCaseJson(id: string): string {
  return JSON.stringify({
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
  });
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
    writeFileSync(join(temp.path, 'good.json'), validCaseJson('cli-good'), 'utf8');
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

test('benchmark:release refuses the same entry, on every subcommand that reads a corpus', async () => {
  const temp = scratchDirectory('aporia-release-cli-');
  try {
    writeFileSync(join(temp.path, 'good.json'), validCaseJson('cli-good'), 'utf8');
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
    writeFileSync(join(temp.path, 'good.json'), validCaseJson('cli-good'), 'utf8');
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
