import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { BENCHMARK_CASE_VERSION } from '../../src/benchmark/types.ts';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const CLI = join(ROOT, 'scripts/benchmark-case.ts');

function tempDir(): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'aporia-benchcase-'));
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

function validCase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: BENCHMARK_CASE_VERSION,
    id: 'case-cli-valid',
    stratum: 'SUPPORTED_PRIMARY_EVIDENCE',
    title: 'CLI fixture',
    provenance: {
      origin: 'Synthetic CLI fixture. Not a gold case.',
      authorizedForStorage: true,
      reviewedBy: ['dana', 'sam'],
      reviewedAt: '2026-11-04',
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
              sourceId: 'src-1',
              sourceType: 'PRIMARY_ARTIFACT',
              independence: 'INDEPENDENT',
              locator: 'section 1',
            },
          ],
        },
      ],
      answerText: null,
      citationCapture: 'NOT_SHOWN',
      citations: [],
      statements: [],
      providerLabel: 'Fixture',
      locale: 'en',
    },
    expected: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        rationale: 'A supporting relationship was recorded.',
        subjectId: 'prop-1',
      },
    ],
    reviewerLabels: [],
    adjudications: [],
    limitations: ['Synthetic fixture only.'],
    ...overrides,
  };
}

test('scaffold writes a template that validate then refuses', async () => {
  const temp = tempDir();
  try {
    const outFile = join(temp.path, 'template.json');
    const written = await cli(['scaffold', '--stratum', 'REFUSAL_NOT_A_DENIAL', '--out', outFile]);
    assert.equal(written.code, 0, written.stderr);
    const template = JSON.parse(readFileSync(outFile, 'utf8')) as Record<string, unknown>;
    assert.equal(template['version'], 'benchmark-case-template');
    assert.deepEqual(template['expected'], [], 'a scaffold carries no gold labels');
    // The honesty guarantee, end to end: the scaffold cannot enter a scored corpus.
    const validated = await cli(['validate', '--corpus', temp.path]);
    assert.notEqual(validated.code, 0, 'validate must refuse a directory of only templates');
    assert.match(validated.stderr, /version/);
  } finally {
    temp.remove();
  }
});

test('validate exits zero on a corpus of valid cases', async () => {
  const temp = tempDir();
  try {
    writeFileSync(join(temp.path, 'a.json'), JSON.stringify(validCase()), 'utf8');
    const result = await cli(['validate', '--corpus', temp.path]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /1 valid case/);
  } finally {
    temp.remove();
  }
});

test('normalise writes canonical JSON that is byte-stable on a second pass', async () => {
  const source = tempDir();
  const dest = tempDir();
  try {
    // Deliberately unsorted keys and a nested array to canonicalise.
    writeFileSync(
      join(source.path, 'a.json'),
      JSON.stringify({ limitations: ['x'], ...validCase(), id: 'case-normalise' }),
      'utf8',
    );
    const first = await cli(['normalise', '--corpus', source.path, '--out', dest.path]);
    assert.equal(first.code, 0, first.stderr);
    const files = readdirSync(dest.path);
    assert.deepEqual(files, ['case-normalise.json']);
    const canonical = readFileSync(join(dest.path, 'case-normalise.json'), 'utf8');
    const keys = Object.keys(JSON.parse(canonical) as Record<string, unknown>);
    assert.deepEqual([...keys].sort(), keys, 'top-level keys sorted');

    const dest2 = tempDir();
    try {
      const second = await cli(['normalise', '--corpus', dest.path, '--out', dest2.path]);
      assert.equal(second.code, 0, second.stderr);
      assert.equal(
        readFileSync(join(dest2.path, 'case-normalise.json'), 'utf8'),
        canonical,
        're-normalising is idempotent',
      );
    } finally {
      dest2.remove();
    }
  } finally {
    source.remove();
    dest.remove();
  }
});

test('provenance reports reviewer assertions without claiming verified review or accuracy', async () => {
  const temp = tempDir();
  try {
    writeFileSync(join(temp.path, 'a.json'), JSON.stringify(validCase()), 'utf8');
    const result = await cli(['provenance', '--corpus', temp.path]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /reviewers=\[dana, sam\]/);
    assert.match(result.stderr, /operator-asserted/);
  } finally {
    temp.remove();
  }
});

test('an unknown subcommand fails rather than doing nothing', async () => {
  const result = await cli(['frobnicate']);
  assert.notEqual(result.code, 0);
});
