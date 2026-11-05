import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';

import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';
import { scratchDirectory } from '../helpers/temp.ts';
import { canonicalise, contentHash, sha256Hex } from '../../src/benchmark/hashing.ts';
import type { BenchmarkRunRecord } from '../../src/benchmark/execution.ts';

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

test('a run record is written, agrees with the report it describes, and is honest about being unbound', async () => {
  const fixture = frozenRelease([agreedCase('rec-a')]);
  try {
    assert.equal((await freeze(fixture)).code, 0);
    const report = join(fixture.temp.path, 'report.json');
    const record = join(fixture.temp.path, 'run.json');
    const bound = await script('scripts/benchmark.ts', [
      '--corpus',
      fixture.corpus,
      '--release',
      fixture.manifest,
      '--out',
      report,
      '--run-record',
      record,
      '--source-revision',
      'e72e77aff6fa8e27d2b10a42920f53712a9cda98',
      // One case cannot cover sixteen strata; that pre-existing requirement is not the binding, and this test
      // needs the run's own exit status to mean "the release was accepted".
      '--allow-partial-strata',
    ]);
    assert.equal(bound.code, 0, bound.stderr);
    const receipt = JSON.parse(readFileSync(record, 'utf8')) as BenchmarkRunRecord;
    const manifest = JSON.parse(readFileSync(fixture.manifest, 'utf8')) as {
      releaseId: string;
      corpusHash: string;
    };
    assert.equal(receipt.version, 'benchmark-run-record-v1');
    assert.equal(receipt.releaseId, manifest.releaseId);
    assert.equal(receipt.corpusHash, manifest.corpusHash);
    assert.equal(receipt.caseCount, 1);
    assert.equal(
      receipt.sourceRevision,
      'e72e77aff6fa8e27d2b10a42920f53712a9cda98',
      'a supplied revision was dropped or altered',
    );
    assert.equal(receipt.accuracyClaimable, false);
    // The report hash must describe the report actually on disk, or the receipt is decoration.
    const reportText = readFileSync(report, 'utf8');
    assert.equal(receipt.reportTextSha256, sha256Hex(reportText));
    assert.equal(
      receipt.reportSha256,
      contentHash(JSON.parse(reportText)),
      'the canonical report hash does not describe the written report',
    );

    // The same run without a release still gets a receipt, and it says it was not bound instead of pretending.
    const unboundRecord = join(fixture.temp.path, 'unbound.json');
    const unbound = await script('scripts/benchmark.ts', [
      '--corpus',
      fixture.corpus,
      '--run-record',
      unboundRecord,
      '--allow-partial-strata',
    ]);
    assert.match(unbound.stderr, /NOT RELEASE-BOUND/);
    const quiet = JSON.parse(readFileSync(unboundRecord, 'utf8')) as BenchmarkRunRecord;
    const quietText = readFileSync(unboundRecord, 'utf8');
    assert.equal(quiet.releaseId, null, 'an unbound run invented a release id');
    assert.equal(quiet.sourceRevision, null, 'a revision appeared that nobody supplied');
    assert.equal(quiet.warnings.notReleaseBound, true);

    // A second identical run writes identical receipt bytes, so the file is left alone and that is said out
    // loud rather than passed off as a fresh publication.
    const again = await script('scripts/benchmark.ts', [
      '--corpus',
      fixture.corpus,
      '--run-record',
      unboundRecord,
      '--allow-partial-strata',
    ]);
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stderr, /already holds exactly these bytes/);
    assert.equal(readFileSync(unboundRecord, 'utf8'), quietText);

    // A *different* receipt for the same path is the destructive case: same corpus, but now bound to a
    // revision, so the bytes differ. That is refused until the operator says otherwise.
    const conflicting = await script('scripts/benchmark.ts', [
      '--corpus',
      fixture.corpus,
      '--run-record',
      unboundRecord,
      '--source-revision',
      'a-different-revision',
      '--allow-partial-strata',
    ]);
    assert.notEqual(conflicting.code, 0, 'a receipt was silently overwritten');
    assert.match(conflicting.stderr, /already exists/);
    assert.equal(
      readFileSync(unboundRecord, 'utf8'),
      quietText,
      'the refused run replaced the receipt anyway',
    );

    // And with leave to replace, the new receipt is written and the displaced digest is reported.
    const forced = await script('scripts/benchmark.ts', [
      '--corpus',
      fixture.corpus,
      '--run-record',
      unboundRecord,
      '--source-revision',
      'a-different-revision',
      '--allow-partial-strata',
      '--overwrite',
    ]);
    assert.equal(forced.code, 0, forced.stderr);
    assert.notEqual(readFileSync(unboundRecord, 'utf8'), quietText);
    assert.match(
      forced.stderr,
      /replaced the run record already at .*previous sha256 [0-9a-f]{64}/,
    );
  } finally {
    fixture.temp.remove();
  }
});

test('the harness help lists every flag it accepts and no flag it does not', async () => {
  const help = await script('scripts/benchmark.ts', ['--help']);
  assert.equal(help.code, 0, help.stderr);
  for (const flag of [
    '--corpus',
    '--out',
    '--release',
    '--run-record',
    '--source-revision',
    '--overwrite',
    '--allow-partial-strata',
  ]) {
    assert.ok(help.stdout.includes(flag), `${flag} is accepted but not documented`);
  }
  // A typo is a refusal, never a silently ignored argument: guessing at intent is how a run ends up unbound.
  const typo = await script('scripts/benchmark.ts', ['--corpus', '.', '--releas', 'x']);
  assert.notEqual(typo.code, 0);
  assert.match(typo.stderr, /Unknown argument/);
});

test('a verified run replays clean, and every tampered artifact is caught by name', async () => {
  const fixture = frozenRelease([agreedCase('vr-a'), agreedCase('vr-b')]);
  try {
    assert.equal((await freeze(fixture)).code, 0);
    const report = join(fixture.temp.path, 'report.json');
    const record = join(fixture.temp.path, 'run.json');
    const run = await script('scripts/benchmark.ts', [
      '--corpus',
      fixture.corpus,
      '--release',
      fixture.manifest,
      '--out',
      report,
      '--run-record',
      record,
      '--allow-partial-strata',
    ]);
    assert.equal(run.code, 0, run.stderr);

    const clean = await script('scripts/benchmark-verify.ts', [
      '--record',
      record,
      '--corpus',
      fixture.corpus,
      '--manifest',
      fixture.manifest,
      '--report',
      report,
    ]);
    assert.equal(clean.code, 0, clean.stderr);
    assert.match(clean.stderr, /VERIFIED/);

    // A tampered corpus: the receipt says two cases were frozen, and one of them has since been edited.
    writeFileSync(
      join(fixture.corpus, 'case-0.json'),
      JSON.stringify({ ...agreedCase('vr-a'), title: 'edited after the run' }),
      'utf8',
    );
    const drifted = await script('scripts/benchmark-verify.ts', [
      '--record',
      record,
      '--corpus',
      fixture.corpus,
      '--manifest',
      fixture.manifest,
      '--report',
      report,
    ]);
    assert.notEqual(drifted.code, 0, 'a tampered corpus verified clean against an honest receipt');
    assert.match(drifted.stderr, /DISAGREES/);
    assert.match(drifted.stderr, /CORPUS-DRIFTED|CHANGED vr-a/);

    // Restore the corpus and tamper with the *report* instead: the binding holds, the stored document does not.
    writeFileSync(join(fixture.corpus, 'case-0.json'), JSON.stringify(agreedCase('vr-a')), 'utf8');
    const forgedReport = JSON.parse(readFileSync(report, 'utf8')) as Record<string, unknown>;
    forgedReport['methodologyVersion'] = 'methodology-from-a-different-build';
    writeFileSync(report, `${JSON.stringify(forgedReport, null, 2)}\n`, 'utf8');
    const reportTampered = await script('scripts/benchmark-verify.ts', [
      '--record',
      record,
      '--corpus',
      fixture.corpus,
      '--manifest',
      fixture.manifest,
      '--report',
      report,
    ]);
    assert.notEqual(reportTampered.code, 0, 'a rewritten report was accepted');
    assert.match(reportTampered.stderr, /REPORT-CONTENT|VERSION-DRIFT methodologyVersion/);
  } finally {
    fixture.temp.remove();
  }
});

test('tampering each recorded field of a receipt produces a named refusal', async () => {
  const fixture = frozenRelease([agreedCase('tamper-a')]);
  try {
    assert.equal((await freeze(fixture)).code, 0);
    const report = join(fixture.temp.path, 'report.json');
    const pristine = join(fixture.temp.path, 'run.json');
    assert.equal(
      (
        await script('scripts/benchmark.ts', [
          '--corpus',
          fixture.corpus,
          '--release',
          fixture.manifest,
          '--out',
          report,
          '--run-record',
          pristine,
          '--allow-partial-strata',
        ])
      ).code,
      0,
    );
    const original = JSON.parse(readFileSync(pristine, 'utf8')) as BenchmarkRunRecord;
    const hex = (seed: string): string => seed.repeat(64).slice(0, 64);

    const corruptions: [string, BenchmarkRunRecord][] = [
      ['manifestSha256', { ...original, manifestSha256: hex('a') }],
      ['corpusHash', { ...original, corpusHash: hex('b') }],
      ['releaseId', { ...original, releaseId: 'release-aaaaaaaaaa' }],
      ['reportSha256', { ...original, reportSha256: hex('c') }],
      ['reportTextSha256', { ...original, reportTextSha256: hex('d') }],
      ['caseCount', { ...original, caseCount: 99 }],
      [
        'methodologyVersion',
        { ...original, versions: { ...original.versions, methodologyVersion: 'x' } },
      ],
      [
        'metricsVersion',
        { ...original, versions: { ...original.versions, metricsVersion: 'metrics-v9' } },
      ],
      [
        'evidenceRuleVersion',
        {
          ...original,
          versions: { ...original.versions, evidenceRuleVersion: 'evidence-aggregation-v2' },
        },
      ],
      [
        'caseContractVersions',
        {
          ...original,
          versions: { ...original.versions, caseContractVersions: ['benchmark-case-v9'] },
        },
      ],
      ['sourceRevision', { ...original, sourceRevision: 'invented-by-tampering' }],
    ];

    for (const [field, tampered] of corruptions) {
      const path = join(fixture.temp.path, `run-${field}.json`);
      writeFileSync(path, `${JSON.stringify(canonicalise(tampered), null, 2)}\n`, 'utf8');
      const result = await script('scripts/benchmark-verify.ts', [
        '--record',
        path,
        '--corpus',
        fixture.corpus,
        '--manifest',
        fixture.manifest,
        '--report',
        report,
      ]);
      assert.notEqual(result.code, 0, `${field} was tampered and verification still passed`);
      assert.ok(
        result.stderr.includes(field),
        `${field} was refused without naming itself:\n${result.stderr.slice(0, 500)}`,
      );
      assert.ok(
        !/at .*\.ts:\d+:\d+/.test(result.stderr),
        `${field} crashed instead of refusing:\n${result.stderr.slice(0, 300)}`,
      );
    }

    // A receipt that is not a receipt at all is refused by the reader, not by a later comparison.
    const junk = join(fixture.temp.path, 'run-junk.json');
    writeFileSync(junk, '{"version":"benchmark-run-record-v0"}\n', 'utf8');
    const junkResult = await script('scripts/benchmark-verify.ts', ['--record', junk]);
    assert.notEqual(junkResult.code, 0);
    assert.match(junkResult.stderr, /benchmark-run-record-v1/);

    // A bound receipt checked without its corpus cannot pass: the binding is the claim being verified.
    const partial = await script('scripts/benchmark-verify.ts', [
      '--record',
      pristine,
      '--report',
      report,
    ]);
    assert.notEqual(
      partial.code,
      0,
      'a bound receipt was called verified with half its inputs missing',
    );
    assert.match(partial.stderr, /INCOMPLETE-ARTIFACT/);

    // No --record at all is a stated usage refusal.
    const missing = await script('scripts/benchmark-verify.ts', []);
    assert.notEqual(missing.code, 0);
    assert.match(missing.stderr, /--record/);

    const help = await script('scripts/benchmark-verify.ts', ['--help']);
    assert.equal(help.code, 0, help.stderr);
    for (const flag of ['--record', '--corpus', '--manifest', '--report', '--source-revision']) {
      assert.ok(help.stdout.includes(flag), `${flag} is accepted but not documented`);
    }
  } finally {
    fixture.temp.remove();
  }
});

test('an unbound receipt can still be checked against its stored report', async () => {
  const fixture = frozenRelease([agreedCase('quiet-run')]);
  try {
    const report = join(fixture.temp.path, 'report.json');
    const record = join(fixture.temp.path, 'run.json');
    assert.equal(
      (
        await script('scripts/benchmark.ts', [
          '--corpus',
          fixture.corpus,
          '--out',
          report,
          '--run-record',
          record,
          '--allow-partial-strata',
        ])
      ).code,
      0,
    );
    const result = await script('scripts/benchmark-verify.ts', [
      '--record',
      record,
      '--report',
      report,
    ]);
    // There was no binding to replay, so this checks the report and says so rather than claiming more.
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /VERIFIED/);
    assert.match(result.stderr, /NOT bound to a release|never bound/i);
    assert.match(result.stderr, /accuracyClaimable is false/);
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
