import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { rosterGaps } from '../../src/benchmark/review.ts';
import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';

/**
 * The read-only roster report (ADR-027).
 *
 * Enforcing the roster at merge is half the rule; the other half is letting an operator *see* the gap without
 * the tool closing it. A command that could add a reviewer would be the harness authorising people, and there
 * is no human in the loop to object.
 */

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const CLI = join(ROOT, 'scripts/benchmark-case.ts');

function tempDir(): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'aporia-roster-'));
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

test('rosterGaps reports undeclared labellers and declared reviewers with no label', () => {
  const benchmarkCase = fixtureCase({
    reviewedBy: ['dana', 'erin'],
    reviewerLabels: [
      labelFor('Dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('ghost', 'ANSWER_FIDELITY', 'st1', 'NOT_ASSESSABLE'),
      labelFor('ghost', 'ATTRIBUTION', 'st1', 'NOT_ASSESSABLE'),
    ],
  });
  const gaps = rosterGaps(benchmarkCase);
  assert.deepEqual(gaps, [
    { reviewer: 'erin', kind: 'DECLARED_UNUSED', labelCount: 0 },
    { reviewer: 'ghost', kind: 'UNDECLARED', labelCount: 2 },
  ]);
});

test('rosterGaps is empty when the declared roster and the labellers agree', () => {
  const benchmarkCase = fixtureCase({
    reviewedBy: ['dana', 'erin'],
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
    ],
  });
  assert.deepEqual(rosterGaps(benchmarkCase), []);
});

test('rosterGaps counts alias spellings as one reviewer', () => {
  const benchmarkCase = fixtureCase({
    reviewedBy: ['Dana Lee'],
    reviewerLabels: [
      labelFor('dana lee', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor(' DANA  LEE ', 'ANSWER_FIDELITY', 'st1', 'NOT_ASSESSABLE'),
    ],
  });
  assert.deepEqual(rosterGaps(benchmarkCase), []);
});

test('rosterGaps treats an empty roster as authorising nobody', () => {
  const benchmarkCase = fixtureCase({
    reviewedBy: [],
    reviewerLabels: [labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE')],
  });
  assert.deepEqual(rosterGaps(benchmarkCase), [
    { reviewer: 'dana', kind: 'UNDECLARED', labelCount: 1 },
  ]);
});

test('the roster subcommand reports gaps, writes nothing and exits non-zero on an undeclared reviewer', async () => {
  const corpus = tempDir();
  const before = tempDir();
  try {
    writeFileSync(
      join(corpus.path, 'a.json'),
      JSON.stringify(
        fixtureCase({
          id: 'case-roster',
          reviewedBy: ['dana'],
          reviewerLabels: [
            labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
            labelFor('sam', 'EVIDENCE_SUPPORT', 'p1', 'PARTIALLY_SUPPORTED'),
          ],
        }),
      ),
      'utf8',
    );
    const snapshot = readFileSync(join(corpus.path, 'a.json'), 'utf8');
    const result = await cli(['roster', '--corpus', corpus.path]);
    assert.notEqual(result.code, 0, 'an undeclared reviewer is a reportable problem');
    assert.match(result.stderr, /UNDECLARED "sam"/);
    assert.doesNotMatch(
      result.stderr,
      /TypeError|Cannot read prop/i,
      'a report is printed, never thrown',
    );
    assert.match(result.stderr, /operator-asserted/);
    assert.equal(
      readFileSync(join(corpus.path, 'a.json'), 'utf8'),
      snapshot,
      'roster never edits the corpus it inspects',
    );
    assert.equal(existsSync(join(before.path, 'anything')), false);
  } finally {
    corpus.remove();
    before.remove();
  }
});

test('the roster subcommand succeeds quietly when the roster and the labellers agree', async () => {
  const corpus = tempDir();
  try {
    writeFileSync(
      join(corpus.path, 'a.json'),
      JSON.stringify(
        fixtureCase({
          id: 'case-roster-clean',
          reviewedBy: ['dana', 'erin'],
          reviewerLabels: [
            labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
            labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
          ],
        }),
      ),
      'utf8',
    );
    const result = await cli(['roster', '--corpus', corpus.path]);
    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /UNDECLARED/);
    assert.match(result.stderr, /0 case\(s\) carry undeclared reviewers/);
  } finally {
    corpus.remove();
  }
});

test('roster is listed in the usage text the CLI actually implements', async () => {
  const result = await cli(['--help']);
  assert.equal(result.code, 0, result.stderr);
  for (const command of ['packet', 'merge', 'review', 'audit', 'roster', 'adjudicate']) {
    assert.ok(
      result.stdout.includes(command),
      `the help text should list the implemented ${command} subcommand`,
    );
  }
  for (const flag of ['--dry-run', '--allow-partial', '--recover']) {
    assert.ok(result.stdout.includes(flag), `the help text should list ${flag}`);
  }
});
