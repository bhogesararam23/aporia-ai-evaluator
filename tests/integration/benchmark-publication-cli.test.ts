import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { fixtureCase } from '../helpers/benchmark-fixtures.ts';
import { scratchDirectory } from '../helpers/temp.ts';

/**
 * Every benchmark output path, held to the same publication rules (v0.8, spec §7).
 *
 * A probe against merged v0.7 wrote a report over a file that already held human notes and froze a manifest
 * over a file that already held a manifest: both destroyed, both without a word, both by a `writeFileSync` that
 * truncates before it writes. These tests are the regression pair for that — the pre-existing bytes must still
 * be there after a refusal, and must be reported (not hidden) after an explicit `--overwrite`.
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

/** A corpus with two reviewers, so `packet`, `freeze` and the harness all have something real to work on. */
function writeCorpus(directory: string): void {
  mkdirSync(directory, { recursive: true });
  const first = fixtureCase({ id: 'pub-case-a', reviewedBy: ['dana', 'sam'] });
  const second = fixtureCase({ id: 'pub-case-b', reviewedBy: ['dana', 'sam'] });
  writeFileSync(join(directory, 'a.json'), JSON.stringify(first), 'utf8');
  writeFileSync(join(directory, 'b.json'), JSON.stringify(second), 'utf8');
}

const NOTES = 'PRE-EXISTING HUMAN NOTES — MUST SURVIVE A REFUSAL\n';

test('a report is not written over an existing file, and the refusal names its digest', async () => {
  const temp = scratchDirectory('aporia-pub-report-');
  try {
    const corpus = join(temp.path, 'corpus');
    writeCorpus(corpus);
    const report = join(temp.path, 'report.json');
    writeFileSync(report, NOTES, 'utf8');

    const refused = await script('scripts/benchmark.ts', ['--corpus', corpus, '--out', report]);
    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, /already exists/);
    assert.equal(
      readFileSync(report, 'utf8'),
      NOTES,
      'a benchmark run destroyed a report it was not given leave to replace',
    );

    const forced = await script('scripts/benchmark.ts', [
      '--corpus',
      corpus,
      '--out',
      report,
      '--overwrite',
    ]);
    // The run may still exit non-zero for its own reasons (an under-covered corpus); what matters is that the
    // artifact was published and the displaced bytes were reported rather than hidden.
    const written = readFileSync(report, 'utf8');
    assert.notEqual(written, NOTES, '--overwrite did not replace the report');
    assert.match(written, /benchmark-report-v2/);
    assert.match(forced.stderr, /replaced|overwrite/i);
  } finally {
    temp.remove();
  }
});

test('a release manifest is never frozen over an existing one by surprise', async () => {
  const temp = scratchDirectory('aporia-pub-manifest-');
  try {
    const corpus = join(temp.path, 'corpus');
    writeCorpus(corpus);
    const manifest = join(temp.path, 'release.json');
    writeFileSync(manifest, NOTES, 'utf8');

    const refused = await script('scripts/benchmark-release.ts', [
      'freeze',
      '--corpus',
      corpus,
      '--out',
      manifest,
    ]);
    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, /already exists/);
    assert.equal(
      readFileSync(manifest, 'utf8'),
      NOTES,
      'a freeze destroyed the manifest a verification depends on',
    );

    const forced = await script('scripts/benchmark-release.ts', [
      'freeze',
      '--corpus',
      corpus,
      '--out',
      manifest,
      '--overwrite',
    ]);
    assert.match(readFileSync(manifest, 'utf8'), /benchmark-release-manifest-v1/);
    assert.match(forced.stderr, /replaced|overwrite/i);
    // And the manifest it wrote is one `verify` accepts, so atomicity did not cost correctness.
    const verified = await script('scripts/benchmark-release.ts', [
      'verify',
      '--corpus',
      corpus,
      '--manifest',
      manifest,
    ]);
    assert.match(verified.stderr, /VERIFIED/);
  } finally {
    temp.remove();
  }
});

test('a snapshot refuses an existing case file and leaves the rest of the directory untouched', async () => {
  const temp = scratchDirectory('aporia-pub-snapshot-');
  try {
    const corpus = join(temp.path, 'corpus');
    writeCorpus(corpus);
    const manifest = join(temp.path, 'release.json');
    // A two-case corpus with no annotations fails its own blocking gates, so `freeze` exits non-zero and still
    // writes the manifest: the gate report and the publish are separate statements. Asserting the file exists,
    // rather than the exit code, is the precondition this test actually needs.
    await script('scripts/benchmark-release.ts', ['freeze', '--corpus', corpus, '--out', manifest]);
    assert.ok(existsSync(manifest), 'the freeze produced no manifest to snapshot from');
    const snapshot = join(temp.path, 'snapshot');
    mkdirSync(snapshot, { recursive: true });
    writeFileSync(join(snapshot, 'pub-case-b.json'), NOTES, 'utf8');

    const refused = await script('scripts/benchmark-release.ts', [
      'freeze',
      '--corpus',
      corpus,
      '--out',
      join(temp.path, 'release2.json'),
      '--snapshot',
      snapshot,
    ]);
    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, /pub-case-b\.json/);
    // No partial artifact: the other case was not written either, because the batch refused before staging.
    assert.equal(existsSync(join(snapshot, 'pub-case-a.json')), false);
    assert.equal(readFileSync(join(snapshot, 'pub-case-b.json'), 'utf8'), NOTES);
    assert.equal(
      existsSync(`${snapshot}.staging`),
      false,
      'a refused snapshot left staging behind',
    );
  } finally {
    temp.remove();
  }
});

test('normalise and packet publish through the staged path, not a loop of overwrites', async () => {
  const temp = scratchDirectory('aporia-pub-normalise-');
  try {
    const corpus = join(temp.path, 'corpus');
    writeCorpus(corpus);
    const out = join(temp.path, 'out');

    const first = await script('scripts/benchmark-case.ts', [
      'normalise',
      '--corpus',
      corpus,
      '--out',
      out,
    ]);
    assert.equal(first.code, 0, first.stderr);
    assert.deepEqual(
      readdirSync(out).sort(),
      ['pub-case-a.json', 'pub-case-b.json'],
      'normalise published the wrong set of files',
    );
    assert.equal(existsSync(`${out}.staging`), false);

    // Re-running normalise over the same corpus writes the same bytes. That is not a destruction, so it is not
    // an error either — but it is said out loud, because an operator who pointed at the wrong directory needs
    // to see that nothing here changed.
    const again = await script('scripts/benchmark-case.ts', [
      'normalise',
      '--corpus',
      corpus,
      '--out',
      out,
    ]);
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stderr, /already held these exact bytes/);

    // A *different* file in the way is the case that must stop the batch.
    const siblingBefore = readFileSync(join(out, 'pub-case-b.json'), 'utf8');
    writeFileSync(join(out, 'pub-case-a.json'), 'HUMAN EDIT\n', 'utf8');
    const blocked = await script('scripts/benchmark-case.ts', [
      'normalise',
      '--corpus',
      corpus,
      '--out',
      out,
    ]);
    assert.notEqual(blocked.code, 0, 'normalise overwrote a file an operator had edited');
    assert.match(blocked.stderr, /already exists/);
    assert.equal(readFileSync(join(out, 'pub-case-a.json'), 'utf8'), 'HUMAN EDIT\n');
    assert.equal(
      readFileSync(join(out, 'pub-case-b.json'), 'utf8'),
      siblingBefore,
      'a refused batch touched a file it had no reason to touch',
    );

    const packets = join(temp.path, 'packets');
    const firstPacket = await script('scripts/benchmark-case.ts', [
      'packet',
      '--corpus',
      corpus,
      '--out',
      packets,
    ]);
    assert.equal(firstPacket.code, 0, firstPacket.stderr);
    assert.deepEqual(
      readdirSync(packets).sort(),
      [
        'pub-case-a.packet.json',
        'pub-case-a.submission.json',
        'pub-case-b.packet.json',
        'pub-case-b.submission.json',
      ],
      'packet published the wrong set of files',
    );
    // Re-running it over the same corpus produces the same bytes, so nothing is destroyed and the run says so.
    // A reviewer who had started filling a form in would have changed its bytes, and that is the case the
    // refusal covers (asserted below by editing one file).
    const secondPacket = await script('scripts/benchmark-case.ts', [
      'packet',
      '--corpus',
      corpus,
      '--out',
      packets,
    ]);
    assert.equal(secondPacket.code, 0, secondPacket.stderr);
    assert.match(secondPacket.stderr, /already held these exact bytes/);

    writeFileSync(
      join(packets, 'pub-case-a.submission.json'),
      'REVIEWER HAS STARTED TYPING\n',
      'utf8',
    );
    const blockedPacket = await script('scripts/benchmark-case.ts', [
      'packet',
      '--corpus',
      corpus,
      '--out',
      packets,
    ]);
    assert.notEqual(blockedPacket.code, 0, 'packet overwrote a submission a reviewer had begun');
    assert.match(blockedPacket.stderr, /already exists/);
    assert.equal(
      readFileSync(join(packets, 'pub-case-a.submission.json'), 'utf8'),
      'REVIEWER HAS STARTED TYPING\n',
    );
  } finally {
    temp.remove();
  }
});

test('scaffold refuses to overwrite a file it was not given leave to replace', async () => {
  const temp = scratchDirectory('aporia-pub-scaffold-');
  try {
    const target = join(temp.path, 'template.json');
    writeFileSync(target, NOTES, 'utf8');
    const refused = await script('scripts/benchmark-case.ts', [
      'scaffold',
      '--stratum',
      'REFUSAL_NOT_A_DENIAL',
      '--out',
      target,
    ]);
    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, /already exists/);
    assert.equal(readFileSync(target, 'utf8'), NOTES);

    const forced = await script('scripts/benchmark-case.ts', [
      'scaffold',
      '--stratum',
      'REFUSAL_NOT_A_DENIAL',
      '--out',
      target,
      '--overwrite',
    ]);
    assert.equal(forced.code, 0, forced.stderr);
    assert.notEqual(readFileSync(target, 'utf8'), NOTES);
  } finally {
    temp.remove();
  }
});

test('--overwrite is only accepted where a command can publish, and is listed in help', async () => {
  const temp = scratchDirectory('aporia-pub-help-');
  try {
    const harness = await script('scripts/benchmark.ts', ['--help']);
    assert.match(harness.stdout, /--overwrite/);
    const release = await script('scripts/benchmark-release.ts', []);
    assert.match(release.stdout, /--overwrite/);
    const caseCli = await script('scripts/benchmark-case.ts', []);
    assert.match(caseCli.stdout, /--overwrite/);
    // An unknown flag is still a refusal, so a typo cannot silently become a default.
    const typo = await script('scripts/benchmark.ts', ['--corpus', temp.path, '--overwrote']);
    assert.notEqual(typo.code, 0);
    assert.match(typo.stderr, /Unknown argument/);
  } finally {
    temp.remove();
  }
});
