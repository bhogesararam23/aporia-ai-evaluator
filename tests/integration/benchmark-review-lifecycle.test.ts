import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';
import type { BenchmarkCase } from '../../src/benchmark/types.ts';

/**
 * The whole offline review lifecycle, through the real command-line tools.
 *
 * The unit suites prove each rule. This proves the rules hold *across* the hops an operator actually performs,
 * which is where provenance historically leaked: v0.6 validated a rationale, then dropped it at merge, so a
 * corpus could look reviewed while carrying none of the reasons. Every stage here reads and writes real files.
 *
 * Stages: packet -> two reviewers fill and submit -> merge -> review -> issue a bound adjudication -> apply
 * -> audit -> freeze -> verify -> tamper -> detect -> restore -> diff two releases.
 */

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const CASE_CLI = join(ROOT, 'scripts/benchmark-case.ts');
const RELEASE_CLI = join(ROOT, 'scripts/benchmark-release.ts');

type Run = { code: number; stdout: string; stderr: string };

async function caseCli(args: readonly string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CASE_CLI, ...args], { cwd: ROOT });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

async function releaseCli(args: readonly string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await run(process.execPath, [RELEASE_CLI, ...args], { cwd: ROOT });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

function tempDir(): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'aporia-lifecycle-'));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/** Two declared reviewers, one genuine disagreement on the evidence subject. */
function splitCase(): BenchmarkCase {
  return fixtureCase({
    id: 'case-lifecycle',
    stratum: 'CONFLICTING_EVIDENCE',
    reviewedBy: ['dana', 'erin'],
    reviewerLabels: [],
  });
}

function fillSubmission(
  packetDir: string,
  caseId: string,
  reviewer: string,
  evidenceLabel: string,
): Record<string, unknown> {
  const template = json(join(packetDir, `${caseId}.submission.json`));
  return {
    ...template,
    reviewer,
    submittedAt: '2026-11-05T09:00:00Z',
    annotations: (template['annotations'] as Record<string, unknown>[]).map(
      (annotation, index) => ({
        ...annotation,
        label: annotation['dimension'] === 'EVIDENCE_SUPPORT' ? evidenceLabel : 'NOT_ASSESSABLE',
        rationale: `${reviewer} rationale ${String(index)}: weighed only the frozen input, per the rubric.`,
      }),
    ),
  };
}

test('provenance survives every stage of the review-to-release lifecycle', async () => {
  const corpus = tempDir();
  const packets = tempDir();
  const submissions = tempDir();
  const mergedDir = tempDir();
  const forms = tempDir();
  const decisions = tempDir();
  const adjudicated = tempDir();
  const releases = tempDir();
  try {
    writeFileSync(join(corpus.path, 'a.json'), JSON.stringify(splitCase()), 'utf8');

    // 1. Blinded packets and blank templates.
    assert.equal(
      (await caseCli(['packet', '--corpus', corpus.path, '--out', packets.path])).code,
      0,
    );
    const packet = json(join(packets.path, 'case-lifecycle.packet.json'));
    for (const leaked of ['expected', 'reviewerLabels', 'adjudications', 'provenance', 'stratum']) {
      assert.ok(!(leaked in packet), `the blinded packet must not leak ${leaked}`);
    }

    // 2. Two reviewers, disagreeing on purpose.
    writeFileSync(
      join(submissions.path, 'dana.json'),
      JSON.stringify(
        fillSubmission(packets.path, 'case-lifecycle', 'dana', 'SUPPORTED_WITHIN_SCOPE'),
      ),
      'utf8',
    );
    writeFileSync(
      join(submissions.path, 'erin.json'),
      JSON.stringify(fillSubmission(packets.path, 'case-lifecycle', 'erin', 'PARTIALLY_SUPPORTED')),
      'utf8',
    );
    assert.equal(
      (
        await caseCli([
          'merge',
          '--corpus',
          corpus.path,
          '--submissions',
          submissions.path,
          '--out',
          mergedDir.path,
        ])
      ).code,
      0,
      'two declared reviewers merge cleanly',
    );
    const afterMerge = json(join(mergedDir.path, 'case-lifecycle.json'));
    const labels = afterMerge['reviewerLabels'] as Record<string, unknown>[];
    assert.equal(labels.length, 8);
    // Safeguard 4, at the file level: nothing the reviewers supplied was lost.
    for (const label of labels) {
      assert.match(String(label['rationale']), /rationale \d+: weighed only the frozen input/);
      assert.equal(label['submittedAt'], '2026-11-05T09:00:00.000Z');
      assert.equal(label['packetHash'], packet['packetHash']);
      assert.match(String(label['submissionHash']), /^[0-9a-f]{64}$/);
    }
    // The merged corpus validates, which v0.6 could not claim.
    assert.equal((await caseCli(['validate', '--corpus', mergedDir.path])).code, 0);

    // 3. The disagreement is visible and unresolved.
    const review = await caseCli(['review', '--corpus', mergedDir.path]);
    assert.equal(review.code, 0, review.stderr);
    assert.match(review.stderr, /UNRESOLVED/);

    // 4. A bound form is issued, filled by a human, and applied.
    assert.equal(
      (await caseCli(['adjudicate', '--corpus', mergedDir.path, '--issue', '--out', forms.path]))
        .code,
      0,
    );
    const formsFile = json(join(forms.path, 'case-lifecycle.adjudication.json'));
    const entries = formsFile as unknown as Record<string, unknown>[];
    assert.equal(entries.length, 1);
    writeFileSync(
      join(decisions.path, 'decision.json'),
      JSON.stringify([
        {
          ...entries[0],
          outcome: 'RESOLVED',
          label: 'PARTIALLY_SUPPORTED',
          reason:
            'Both records describe one press release; the second adds no independent support.',
          adjudicatedBy: 'erin',
          adjudicatedAt: '2026-11-05T12:00:00Z',
        },
      ]),
      'utf8',
    );
    assert.equal(
      (
        await caseCli([
          'adjudicate',
          '--corpus',
          mergedDir.path,
          '--adjudications',
          decisions.path,
          '--out',
          adjudicated.path,
        ])
      ).code,
      0,
    );
    const settled = json(join(adjudicated.path, 'case-lifecycle.json'));
    const adjudications = settled['adjudications'] as Record<string, unknown>[];
    const [firstAdjudication] = adjudications;
    const [firstLabel] = settled['reviewerLabels'] as Record<string, unknown>[];
    assert.equal(adjudications.length, 1);
    assert.ok(firstAdjudication !== undefined);
    assert.ok(firstLabel !== undefined);
    assert.equal(firstAdjudication['adjudicatedBy'], 'erin');
    assert.match(String(firstAdjudication['disagreementHash']), /^[0-9a-f]{64}$/);
    // Reviewer provenance still intact after a second write cycle.
    assert.match(String(firstLabel['rationale']), /rationale/);

    // 5. The settled corpus now reviews clean, and the audit still claims no accuracy.
    const afterReview = await caseCli(['review', '--corpus', adjudicated.path]);
    assert.match(afterReview.stderr, /ADJUDICATED/);
    const audit = await caseCli(['audit', '--corpus', adjudicated.path]);
    assert.equal(audit.code, 0, audit.stderr);
    assert.match(audit.stderr, /accuracyClaimable=false/);

    // 6. Freeze, verify, tamper, detect, restore, and diff the two releases.
    const first = join(releases.path, 'release-one.json');
    assert.equal(
      (
        await releaseCli([
          'freeze',
          '--corpus',
          adjudicated.path,
          '--out',
          first,
          '--label',
          'lifecycle one',
        ])
      ).code,
      0,
    );
    assert.equal(
      (await releaseCli(['verify', '--corpus', adjudicated.path, '--manifest', first])).code,
      0,
    );

    const original = readFileSync(join(adjudicated.path, 'case-lifecycle.json'), 'utf8');
    writeFileSync(
      join(adjudicated.path, 'case-lifecycle.json'),
      original.replace(
        'Both records describe one press release',
        'Both records describe TWO press releases',
      ),
      'utf8',
    );
    const drifted = await releaseCli(['verify', '--corpus', adjudicated.path, '--manifest', first]);
    assert.notEqual(drifted.code, 0, 'an edited adjudication reason must be detected');
    assert.match(drifted.stderr, /CHANGED\s+case-lifecycle/);

    writeFileSync(join(adjudicated.path, 'case-lifecycle.json'), original, 'utf8');
    assert.equal(
      (await releaseCli(['verify', '--corpus', adjudicated.path, '--manifest', first])).code,
      0,
      'restoring the bytes restores the verification',
    );

    // A second release with one further reviewed case diffs honestly.
    const grown = tempDir();
    try {
      for (const name of readdirSync(adjudicated.path)) {
        writeFileSync(
          join(grown.path, name),
          readFileSync(join(adjudicated.path, name), 'utf8'),
          'utf8',
        );
      }
      writeFileSync(
        join(grown.path, 'b.json'),
        JSON.stringify(
          // Fully reviewed, because a release that skipped a subject *should* fail a blocking gate; the
          // second case is here to be added, not to be a gate failure.
          fixtureCase({
            id: 'case-second',
            stratum: 'REFUSAL_NOT_A_DENIAL',
            reviewedBy: ['dana', 'erin'],
            reviewerLabels: (['dana', 'erin'] as const).flatMap((reviewer) => [
              labelFor(reviewer, 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
              labelFor(reviewer, 'ANSWER_FIDELITY', 'st1', 'NOT_ASSESSABLE'),
              labelFor(reviewer, 'CITATION_SUPPORT', 'st1', 'NOT_ASSESSABLE'),
              labelFor(reviewer, 'ATTRIBUTION', 'st1', 'NOT_ASSESSABLE'),
            ]),
          }),
        ),
        'utf8',
      );
      const second = join(releases.path, 'release-two.json');
      assert.equal((await releaseCli(['freeze', '--corpus', grown.path, '--out', second])).code, 0);
      const comparison = await releaseCli(['diff', '--before', first, '--after', second]);
      assert.equal(comparison.code, 0, comparison.stderr);
      assert.match(comparison.stderr, /ADDED\s+case-second/);
      assert.match(comparison.stderr, /not a claim that the later release is better/);
    } finally {
      grown.remove();
    }

    // 7. No intermediate run ever left a staging directory or journal behind.
    for (const directory of [mergedDir.path, adjudicated.path, releases.path]) {
      for (const name of readdirSync(directory)) {
        assert.ok(!name.includes('.staging'), `no staging residue in ${directory}: ${name}`);
        assert.notEqual(name, 'journal.json', 'no journal survives a completed batch');
      }
    }
    assert.equal(existsSync(`${mergedDir.path}.staging`), false);
  } finally {
    corpus.remove();
    packets.remove();
    submissions.remove();
    mergedDir.remove();
    forms.remove();
    decisions.remove();
    adjudicated.remove();
    releases.remove();
  }
});

test('a stale adjudication cannot be applied through the CLI after the reviewers move', async () => {
  const corpus = tempDir();
  const merged = tempDir();
  const forms = tempDir();
  const decisions = tempDir();
  const out = tempDir();
  try {
    writeFileSync(join(corpus.path, 'a.json'), JSON.stringify(splitCase()), 'utf8');
    await caseCli(['packet', '--corpus', corpus.path, '--out', forms.path]);
    for (const [name, reviewer, value] of [
      ['dana.json', 'dana', 'SUPPORTED_WITHIN_SCOPE'],
      ['erin.json', 'erin', 'PARTIALLY_SUPPORTED'],
    ] as const) {
      writeFileSync(
        join(decisions.path, name),
        JSON.stringify(fillSubmission(forms.path, 'case-lifecycle', reviewer, value)),
        'utf8',
      );
    }
    const submissionsDir = decisions.path;
    const packetDir = forms.path;
    assert.equal(
      (
        await caseCli([
          'merge',
          '--corpus',
          corpus.path,
          '--submissions',
          submissionsDir,
          '--out',
          merged.path,
        ])
      ).code,
      0,
    );

    // Issue a form, then let the reviewers converge before it is filed.
    const formDir = tempDir();
    try {
      assert.equal(
        (await caseCli(['adjudicate', '--corpus', merged.path, '--issue', '--out', formDir.path]))
          .code,
        0,
      );
      const entry = (
        json(join(formDir.path, 'case-lifecycle.adjudication.json')) as unknown as Record<
          string,
          unknown
        >[]
      )[0];
      const decided = tempDir();
      try {
        writeFileSync(
          join(decided.path, 'd.json'),
          JSON.stringify([
            {
              ...entry,
              outcome: 'RESOLVED',
              label: 'SUPPORTED_WITHIN_SCOPE',
              reason: 'Written against the split as it stood.',
              adjudicatedBy: 'erin',
              adjudicatedAt: '2026-11-05T12:00:00Z',
            },
          ]),
          'utf8',
        );
        // Erin changes her mind, so the split this decision bound to no longer exists.
        writeFileSync(
          join(decisions.path, 'erin.json'),
          JSON.stringify(
            fillSubmission(packetDir, 'case-lifecycle', 'erin', 'SUPPORTED_WITHIN_SCOPE'),
          ),
          'utf8',
        );
        const remarged = tempDir();
        try {
          assert.equal(
            (
              await caseCli([
                'merge',
                '--corpus',
                corpus.path,
                '--submissions',
                submissionsDir,
                '--out',
                remarged.path,
              ])
            ).code,
            0,
          );
          const stale = await caseCli([
            'adjudicate',
            '--corpus',
            remarged.path,
            '--adjudications',
            decided.path,
            '--out',
            out.path,
          ]);
          assert.notEqual(stale.code, 0, 'a decision bound to a moved split must be refused');
          assert.match(stale.stderr, /stale|no longer the disagreement/i);
          assert.equal(
            existsSync(join(out.path, 'case-lifecycle.json')),
            false,
            'and nothing is written',
          );
        } finally {
          remarged.remove();
        }
      } finally {
        decided.remove();
      }
    } finally {
      formDir.remove();
    }
  } finally {
    corpus.remove();
    merged.remove();
    forms.remove();
    decisions.remove();
    out.remove();
  }
});

test('an undeclared reviewer is refused end to end, and the corpus stays valid', async () => {
  const corpus = tempDir();
  const packets = tempDir();
  const submissions = tempDir();
  const out = tempDir();
  try {
    writeFileSync(join(corpus.path, 'a.json'), JSON.stringify(splitCase()), 'utf8');
    assert.equal(
      (await caseCli(['packet', '--corpus', corpus.path, '--out', packets.path])).code,
      0,
    );
    writeFileSync(
      join(submissions.path, 'ghost.json'),
      JSON.stringify(fillSubmission(packets.path, 'case-lifecycle', 'ghost', 'CONTRADICTED')),
      'utf8',
    );
    const refused = await caseCli([
      'merge',
      '--corpus',
      corpus.path,
      '--submissions',
      submissions.path,
      '--out',
      out.path,
    ]);
    assert.notEqual(refused.code, 0);
    assert.match(refused.stderr, /not in the declared roster/);
    // The output directory exists because the test made it; the refusal is that nothing was published into it.
    assert.deepEqual(readdirSync(out.path), [], 'the roster refusal wrote no case file');

    // The roster command reports the same gap without editing the corpus.
    const handEdited = json(join(corpus.path, 'a.json'));
    handEdited['reviewerLabels'] = [labelFor('ghost', 'EVIDENCE_SUPPORT', 'p1', 'CONTRADICTED')];
    writeFileSync(join(corpus.path, 'c.json'), JSON.stringify(handEdited), 'utf8');
    const roster = await caseCli(['roster', '--corpus', corpus.path]);
    assert.notEqual(roster.code, 0);
    assert.match(roster.stderr, /UNDECLARED "ghost"/);
    assert.match(roster.stderr, /scoreable=false/);
  } finally {
    corpus.remove();
    packets.remove();
    submissions.remove();
    out.remove();
  }
});
