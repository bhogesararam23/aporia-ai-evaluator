import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  const path = mkdtempSync(join(tmpdir(), 'aporia-benchreview-'));
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

function validCase(id: string): Record<string, unknown> {
  return {
    version: BENCHMARK_CASE_VERSION,
    id,
    stratum: 'SUPPORTED_PRIMARY_EVIDENCE',
    title: 'CLI review fixture',
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
  };
}

interface SubmissionShape {
  version: string;
  caseId: string;
  packetHash: string;
  reviewer: string;
  submittedAt: string;
  annotations: { dimension: string; subjectId: string; label: string; rationale: string }[];
}

/**
 * Fill the CLI-issued template as a reviewer would.
 *
 * Templates are `benchmark-submission-v2` from v0.7, so `submittedAt` must be a real instant rather than a
 * bare date. A v1 submission file with a date-only timestamp is still accepted, and that path is pinned in
 * the v0.6 compatibility integration test.
 */
function fillSubmission(
  packetDir: string,
  id: string,
  reviewer: string,
  submittedAt: string,
  label: string,
): SubmissionShape {
  const template = JSON.parse(
    readFileSync(join(packetDir, `${id}.submission.json`), 'utf8'),
  ) as SubmissionShape;
  return {
    ...template,
    reviewer,
    submittedAt,
    annotations: template.annotations.map((annotation) => ({
      ...annotation,
      label,
      rationale: `Recorded by ${reviewer} from the frozen input only.`,
    })),
  };
}

test('packet writes a blinded packet and a blank submission template', async () => {
  const corpus = tempDir();
  const out = tempDir();
  try {
    writeFileSync(join(corpus.path, 'a.json'), JSON.stringify(validCase('case-p')), 'utf8');
    const result = await cli(['packet', '--corpus', corpus.path, '--out', out.path]);
    assert.equal(result.code, 0, result.stderr);
    const packet = JSON.parse(readFileSync(join(out.path, 'case-p.packet.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    // Blinding: none of the withheld material appears in the packet.
    for (const forbidden of [
      'expected',
      'reviewerLabels',
      'adjudications',
      'stratum',
      'provenance',
    ]) {
      assert.ok(!(forbidden in packet), `the packet must not leak ${forbidden}`);
    }
    assert.equal(packet['version'], 'benchmark-packet-v1');
    const submission = JSON.parse(
      readFileSync(join(out.path, 'case-p.submission.json'), 'utf8'),
    ) as SubmissionShape;
    assert.equal(submission.reviewer, '', 'the template carries no reviewer');
    assert.equal(submission.submittedAt, '', 'the template carries no timestamp');
    assert.ok(submission.annotations.every((annotation) => annotation.label === ''));
    assert.ok(submission.packetHash.length > 0, 'the template is bound to the packet hash');
  } finally {
    corpus.remove();
    out.remove();
  }
});

test('merge applies a valid submission and refuses a stale one, leaving gold untouched', async () => {
  const corpus = tempDir();
  const packets = tempDir();
  const submissions = tempDir();
  const out = tempDir();
  try {
    writeFileSync(join(corpus.path, 'a.json'), JSON.stringify(validCase('case-m')), 'utf8');
    assert.equal((await cli(['packet', '--corpus', corpus.path, '--out', packets.path])).code, 0);

    writeFileSync(
      join(submissions.path, 'dana.json'),
      JSON.stringify(
        fillSubmission(
          packets.path,
          'case-m',
          'dana',
          '2026-11-05T09:00:00Z',
          'SUPPORTED_WITHIN_SCOPE',
        ),
      ),
      'utf8',
    );
    const merged = await cli([
      'merge',
      '--corpus',
      corpus.path,
      '--submissions',
      submissions.path,
      '--out',
      out.path,
    ]);
    assert.equal(merged.code, 0, merged.stderr);
    const resultCase = JSON.parse(readFileSync(join(out.path, 'case-m.json'), 'utf8')) as {
      reviewerLabels: { reviewer: string; label: string }[];
      expected: unknown[];
    };
    assert.deepEqual(
      resultCase.reviewerLabels.map((label) => label.reviewer),
      ['dana'],
    );
    assert.equal(resultCase.expected.length, 1, 'the gold label is preserved, never edited');

    // A stale packet hash is refused and leaves the case unchanged.
    const stale = fillSubmission(
      packets.path,
      'case-m',
      'sam',
      '2026-11-05T09:00:00Z',
      'SUPPORTED_WITHIN_SCOPE',
    );
    stale.packetHash = 'deadbeef';
    const staleDir = tempDir();
    try {
      writeFileSync(join(staleDir.path, 'sam.json'), JSON.stringify(stale), 'utf8');
      const out2 = tempDir();
      try {
        const rejected = await cli([
          'merge',
          '--corpus',
          corpus.path,
          '--submissions',
          staleDir.path,
          '--out',
          out2.path,
        ]);
        assert.notEqual(rejected.code, 0, 'a stale submission must fail the run');
        assert.match(rejected.stderr, /[Ss]tale/);
        // v0.7 default: one refusal writes nothing at all, so the target is not even created.
        assert.equal(
          existsSync(join(out2.path, 'case-m.json')),
          false,
          'an atomic batch publishes nothing when any item is refused',
        );

        // The v0.6 behaviour is still available, explicitly, and still leaves the refused case unchanged.
        const out3 = tempDir();
        try {
          const partial = await cli([
            'merge',
            '--corpus',
            corpus.path,
            '--submissions',
            staleDir.path,
            '--out',
            out3.path,
            '--allow-partial',
          ]);
          assert.notEqual(
            partial.code,
            0,
            'a partial import is still a refusal worth an exit code',
          );
          const unchanged = JSON.parse(readFileSync(join(out3.path, 'case-m.json'), 'utf8')) as {
            reviewerLabels: unknown[];
          };
          assert.equal(
            unchanged.reviewerLabels.length,
            0,
            'the rejected submission left no label applied',
          );
        } finally {
          out3.remove();
        }
      } finally {
        out2.remove();
      }
    } finally {
      staleDir.remove();
    }
  } finally {
    corpus.remove();
    packets.remove();
    submissions.remove();
    out.remove();
  }
});

test('merge refuses a duplicate reviewer within a single import run', async () => {
  const corpus = tempDir();
  const packets = tempDir();
  const submissions = tempDir();
  const out = tempDir();
  try {
    writeFileSync(join(corpus.path, 'a.json'), JSON.stringify(validCase('case-d')), 'utf8');
    await cli(['packet', '--corpus', corpus.path, '--out', packets.path]);
    const dana = fillSubmission(
      packets.path,
      'case-d',
      'dana',
      '2026-11-05T09:00:00Z',
      'SUPPORTED_WITHIN_SCOPE',
    );
    writeFileSync(join(submissions.path, 'dana-1.json'), JSON.stringify(dana), 'utf8');
    writeFileSync(join(submissions.path, 'dana-2.json'), JSON.stringify(dana), 'utf8');
    const result = await cli([
      'merge',
      '--corpus',
      corpus.path,
      '--submissions',
      submissions.path,
      '--out',
      out.path,
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /[Dd]uplicate/);
    // Atomic by default: a duplicate inside one import stops the whole run from writing.
    assert.equal(existsSync(join(out.path, 'case-d.json')), false);

    // The duplicate rule is the same under the explicit partial mode, where the first submission applies.
    const partialOut = tempDir();
    try {
      const partial = await cli([
        'merge',
        '--corpus',
        corpus.path,
        '--submissions',
        submissions.path,
        '--out',
        partialOut.path,
        '--allow-partial',
      ]);
      assert.notEqual(partial.code, 0);
      const mergedCase = JSON.parse(readFileSync(join(partialOut.path, 'case-d.json'), 'utf8')) as {
        reviewerLabels: { reviewer: string }[];
      };
      assert.equal(
        mergedCase.reviewerLabels.filter((label) => label.reviewer === 'dana').length,
        1,
        'only the first of two same-reviewer submissions applies',
      );
    } finally {
      partialOut.remove();
    }
  } finally {
    corpus.remove();
    packets.remove();
    submissions.remove();
    out.remove();
  }
});

test('review reports an unresolved split without choosing a label', async () => {
  const corpus = tempDir();
  try {
    const splitCase = validCase('case-r');
    splitCase['reviewerLabels'] = [
      {
        reviewer: 'dana',
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        subjectId: 'prop-1',
        note: null,
      },
      {
        reviewer: 'sam',
        dimension: 'EVIDENCE_SUPPORT',
        label: 'PARTIALLY_SUPPORTED',
        subjectId: 'prop-1',
        note: null,
      },
    ];
    writeFileSync(join(corpus.path, 'a.json'), JSON.stringify(splitCase), 'utf8');
    const result = await cli(['review', '--corpus', corpus.path]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /EVIDENCE_SUPPORT\/prop-1: UNRESOLVED/);
    assert.match(result.stderr, /never resolved/i);
  } finally {
    corpus.remove();
  }
});

test('audit reports coverage and provenance without claiming accuracy', async () => {
  const corpus = tempDir();
  try {
    writeFileSync(join(corpus.path, 'a.json'), JSON.stringify(validCase('case-a')), 'utf8');
    const result = await cli(['audit', '--corpus', corpus.path]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /missing strata:/);
    assert.match(result.stderr, /accuracyClaimable=false/);
  } finally {
    corpus.remove();
  }
});

test('adjudicate issues a bound form and applies only a decision that still matches the disagreement', async () => {
  const corpus = tempDir();
  const forms = tempDir();
  const filled = tempDir();
  const out = tempDir();
  try {
    const splitCase = validCase('case-adjcli');
    splitCase['reviewerLabels'] = [
      {
        reviewer: 'dana',
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        subjectId: 'prop-1',
        note: null,
      },
      {
        reviewer: 'sam',
        dimension: 'EVIDENCE_SUPPORT',
        label: 'CONTRADICTED',
        subjectId: 'prop-1',
        note: null,
      },
    ];
    writeFileSync(join(corpus.path, 'a.json'), JSON.stringify(splitCase), 'utf8');

    // 1. The operator issues the form and gets the binding hash, with nothing pre-selected.
    const issuedRun = await cli([
      'adjudicate',
      '--corpus',
      corpus.path,
      '--issue',
      '--out',
      forms.path,
    ]);
    assert.equal(issuedRun.code, 0, issuedRun.stderr);
    const issued = JSON.parse(
      readFileSync(join(forms.path, 'case-adjcli.adjudication.json'), 'utf8'),
    ) as Record<string, unknown>[];
    assert.equal(issued.length, 1, 'one unresolved subject yields one form');
    assert.match(String(issued[0]?.['disagreementHash']), /^[0-9a-f]{64}$/);
    assert.equal(issued[0]?.['outcome'], '', 'the adjudicator decides; the tool does not');
    assert.equal(issued[0]?.['adjudicatedBy'], '');

    // 2. A human fills it in and the decision applies, carrying its binding.
    const signed = [
      {
        ...issued[0],
        outcome: 'RESOLVED',
        label: 'CONTRADICTED',
        reason: 'The second reviewer read the primary source directly.',
        adjudicatedBy: 'sam',
        adjudicatedAt: '2026-11-05T12:00:00Z',
      },
    ];
    writeFileSync(join(filled.path, 'adj.json'), JSON.stringify(signed), 'utf8');
    const result = await cli([
      'adjudicate',
      '--corpus',
      corpus.path,
      '--adjudications',
      filled.path,
      '--out',
      out.path,
    ]);
    assert.equal(result.code, 0, result.stderr);
    const mergedCase = JSON.parse(readFileSync(join(out.path, 'case-adjcli.json'), 'utf8')) as {
      adjudications: Record<string, unknown>[];
      expected: unknown[];
    };
    assert.equal(mergedCase.adjudications.length, 1, 'the adjudication is applied to its subject');
    assert.equal(mergedCase.expected.length, 1, 'gold labels are never edited by adjudication');
    assert.match(
      String(mergedCase.adjudications[0]?.['disagreementHash']),
      /^[0-9a-f]{64}$/,
      'the stored record keeps the disagreement it settled',
    );
    assert.equal(mergedCase.adjudications[0]?.['adjudicatedBy'], 'sam');

    // 3. A v0.6-shaped decision with no binding is refused, not thrown on.
    const badDir = tempDir();
    const badOut = tempDir();
    try {
      writeFileSync(
        join(badDir.path, 'bad.json'),
        JSON.stringify({
          caseId: 'case-adjcli',
          dimension: 'EVIDENCE_SUPPORT',
          subjectId: 'prop-1',
          outcome: 'RESOLVED',
          label: 'CONTRADICTED',
          reason: 'An unbound decision.',
          adjudicatedBy: 'sam',
        }),
        'utf8',
      );
      const rejected = await cli([
        'adjudicate',
        '--corpus',
        corpus.path,
        '--adjudications',
        badDir.path,
        '--out',
        badOut.path,
      ]);
      assert.notEqual(rejected.code, 0, 'an unbound decision must not apply');
      assert.match(rejected.stderr, /malformed|binding/i);
    } finally {
      badDir.remove();
      badOut.remove();
    }

    // 4. An out-of-vocabulary label is refused with its reasons printed.
    const wrongDir = tempDir();
    const wrongOut = tempDir();
    try {
      writeFileSync(
        join(wrongDir.path, 'wrong.json'),
        JSON.stringify([
          {
            ...signed[0],
            label: 'NOT_A_REAL_LABEL',
            reason: 'Trying an invalid label.',
          },
        ]),
        'utf8',
      );
      const wrong = await cli([
        'adjudicate',
        '--corpus',
        corpus.path,
        '--adjudications',
        wrongDir.path,
        '--out',
        wrongOut.path,
      ]);
      assert.notEqual(wrong.code, 0);
      assert.match(wrong.stderr, /not valid|not an unresolved disagreement/i);
    } finally {
      wrongDir.remove();
      wrongOut.remove();
    }
  } finally {
    corpus.remove();
    forms.remove();
    filled.remove();
    out.remove();
  }
});

test('merge refuses a malformed submission file rather than throwing', async () => {
  const corpus = tempDir();
  const submissions = tempDir();
  const out = tempDir();
  try {
    writeFileSync(join(corpus.path, 'a.json'), JSON.stringify(validCase('case-bad')), 'utf8');
    writeFileSync(
      join(submissions.path, 'broken.json'),
      JSON.stringify({ version: 3, junk: true }),
      'utf8',
    );
    const result = await cli([
      'merge',
      '--corpus',
      corpus.path,
      '--submissions',
      submissions.path,
      '--out',
      out.path,
    ]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /malformed submission/i);
    assert.doesNotMatch(
      result.stderr,
      /TypeError|Cannot read prop/i,
      'a hostile submission file is refused with a reason, never thrown on',
    );
    // v0.7: a malformed file belongs to the batch, so under the atomic default it stops the write too.
    assert.equal(existsSync(join(out.path, 'case-bad.json')), false);

    const partialOut = tempDir();
    try {
      const partial = await cli([
        'merge',
        '--corpus',
        corpus.path,
        '--submissions',
        submissions.path,
        '--out',
        partialOut.path,
        '--allow-partial',
      ]);
      assert.notEqual(partial.code, 0);
      assert.ok(
        existsSync(join(partialOut.path, 'case-bad.json')),
        'under the explicit partial mode the untouched case is still exported',
      );
    } finally {
      partialOut.remove();
    }
  } finally {
    corpus.remove();
    submissions.remove();
    out.remove();
  }
});

test('the subcommand list in usage mentions the review workflow', async () => {
  const result = await cli([]);
  for (const name of ['packet', 'merge', 'review', 'audit', 'adjudicate']) {
    assert.match(result.stdout, new RegExp(name));
  }
});
