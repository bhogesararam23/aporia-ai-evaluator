import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { buildReviewerPacket } from '../../src/benchmark/review.ts';
import { contentHash } from '../../src/benchmark/hashing.ts';
import { BENCHMARK_SUBMISSION_VERSION_V2 } from '../../src/benchmark/types.ts';

const run = promisify(execFile);
const ROOT = resolve(import.meta.dirname, '../..');
const CLI = join(ROOT, 'scripts/benchmark-case.ts');

type Run = { code: number; stdout: string; stderr: string };

function tempDir(): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'aporia-batch-'));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

async function cli(args: readonly string[]): Promise<Run> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { cwd: ROOT });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

/**
 * A refusal is a printed reason with a non-zero exit. A crash is the same exit code, so the only honest way
 * to tell them apart is the stack: hostile input must never produce one.
 */
function assertRefused(result: Run, expectation?: RegExp): void {
  assert.notEqual(result.code, 0, 'expected a non-zero refusal');
  assert.doesNotMatch(
    result.stderr,
    /TypeError|RangeError|undefined is not|Cannot read prop/i,
    `input was thrown on instead of refused: ${result.stderr}`,
  );
  if (expectation !== undefined) {
    assert.match(result.stderr, expectation);
  }
}

/**
 * Batch publishing through the real CLI (ADR-027, defect 5).
 *
 * The pure planner decides; this suite proves the filesystem layer honours those decisions: a dry run writes
 * nothing, an atomic batch with one refusal leaves the target untouched, output is published through a
 * staging directory plus a journal, and an interrupted run can be rolled back or completed to the exact same
 * bytes a clean run would have produced.
 */

function caseFile(id: string, reviewedBy: readonly string[]): Record<string, unknown> {
  return {
    version: 'benchmark-case-v2',
    id,
    stratum: 'REFUSAL_NOT_A_DENIAL',
    title: 'A refusal that is not a denial',
    provenance: {
      origin: 'Synthetic test fixture; no real capture.',
      authorizedForStorage: true,
      reviewedBy: [...reviewedBy],
      reviewedAt: '2026-11-05',
      unverified: ['fixture only'],
      limitation: 'Synthetic fixture.',
    },
    input: {
      claimText: 'The tool announced version 2 on the stated date.',
      propositions: [
        {
          id: 'p1',
          text: 'The announcement was made on the stated date.',
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
      answerText: 'I cannot confirm that announcement.',
      citationCapture: 'NOT_SHOWN',
      citations: [
        {
          id: 'c1',
          url: 'https://example.invalid/announcement',
          supportsStatement: false,
          note: 'Fixture URL; never fetched.',
        },
      ],
      statements: [
        {
          id: 'st1',
          text: 'I cannot confirm that announcement.',
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
        rationale: 'The recorded artifact states it.',
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
        rationale: 'Nothing was cited.',
        subjectId: 'st1',
      },
      {
        dimension: 'ATTRIBUTION',
        label: 'NOT_ASSESSABLE',
        rationale: 'Nothing was attributed.',
        subjectId: 'st1',
      },
    ],
    reviewerLabels: [],
    adjudications: [],
    limitations: ['Synthetic fixture only.'],
  };
}

function submission(
  packetDir: string,
  caseId: string,
  reviewer: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const template = JSON.parse(
    readFileSync(join(packetDir, `${caseId}.submission.json`), 'utf8'),
  ) as Record<string, unknown>;
  const packet = JSON.parse(readFileSync(join(packetDir, `${caseId}.packet.json`), 'utf8')) as {
    packetHash: string;
  };
  return {
    ...template,
    version: BENCHMARK_SUBMISSION_VERSION_V2,
    packetHash: packet.packetHash,
    reviewer,
    submittedAt: '2026-11-05T09:00:00Z',
    annotations: (template['annotations'] as Record<string, unknown>[]).map(
      (annotation, index) => ({
        ...annotation,
        label:
          annotation['dimension'] === 'EVIDENCE_SUPPORT'
            ? 'SUPPORTED_WITHIN_SCOPE'
            : 'NOT_ASSESSABLE',
        rationale: `CLI batch rationale ${String(index)}.`,
      }),
    ),
    ...overrides,
  };
}

function setup(): {
  corpus: ReturnType<typeof tempDir>;
  packets: ReturnType<typeof tempDir>;
  submissions: ReturnType<typeof tempDir>;
  remove(): void;
} {
  const corpus = tempDir();
  const packets = tempDir();
  const submissions = tempDir();
  writeFileSync(
    join(corpus.path, 'a.json'),
    JSON.stringify(caseFile('case-a', ['dana', 'erin'])),
    'utf8',
  );
  writeFileSync(
    join(corpus.path, 'b.json'),
    JSON.stringify(caseFile('case-b', ['dana', 'erin'])),
    'utf8',
  );
  return {
    corpus,
    packets,
    submissions,
    remove: () => {
      corpus.remove();
      packets.remove();
      submissions.remove();
    },
  };
}

function planHashOf(stderr: string): string {
  const match = /plan ([0-9a-f]{64})/.exec(stderr);
  assert.ok(match, `no plan hash reported in: ${stderr}`);
  return match[1] as string;
}

function dirSnapshot(directory: string): Record<string, string> {
  if (!existsSync(directory)) {
    return {};
  }
  const snapshot: Record<string, string> = {};
  for (const name of readdirSync(directory).sort()) {
    snapshot[name] = readFileSync(join(directory, name), 'utf8');
  }
  return snapshot;
}

test('a clean dry run reports the plan and writes nothing at all', async () => {
  const env = setup();
  const out = tempDir();
  try {
    assert.equal(
      (await cli(['packet', '--corpus', env.corpus.path, '--out', env.packets.path])).code,
      0,
    );
    writeFileSync(
      join(env.submissions.path, 'dana.json'),
      JSON.stringify(submission(env.packets.path, 'case-a', 'dana')),
      'utf8',
    );
    const target = join(out.path, 'merged');
    const result = await cli([
      'merge',
      '--corpus',
      env.corpus.path,
      '--submissions',
      env.submissions.path,
      '--out',
      target,
      '--dry-run',
    ]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stderr, /DRY RUN|dry run/i);
    assert.ok(
      /plan [0-9a-f]{64}/.test(result.stderr),
      'the plan hash is reported so recovery can be driven',
    );
    assert.equal(existsSync(target), false, 'a dry run creates no output directory');
    assert.equal(existsSync(`${target}.staging`), false, 'a dry run creates no staging directory');
    assert.equal(existsSync(join(out.path, 'merged.staging', 'journal.json')), false);
  } finally {
    env.remove();
    out.remove();
  }
});

test('a dry run with a refusal reports it and still writes nothing', async () => {
  const env = setup();
  const out = tempDir();
  try {
    assert.equal(
      (await cli(['packet', '--corpus', env.corpus.path, '--out', env.packets.path])).code,
      0,
    );
    writeFileSync(
      join(env.submissions.path, 'ok.json'),
      JSON.stringify(submission(env.packets.path, 'case-a', 'dana')),
      'utf8',
    );
    writeFileSync(
      join(env.submissions.path, 'bad.json'),
      JSON.stringify(submission(env.packets.path, 'case-b', 'ghost')),
      'utf8',
    );
    const target = join(out.path, 'merged');
    const result = await cli([
      'merge',
      '--corpus',
      env.corpus.path,
      '--submissions',
      env.submissions.path,
      '--out',
      target,
      '--dry-run',
    ]);
    assertRefused(result, /ghost|roster/i);
    assert.equal(existsSync(target), false);
  } finally {
    env.remove();
    out.remove();
  }
});

test('an atomic batch writes every file, leaves no staging or journal behind', async () => {
  const env = setup();
  const out = tempDir();
  try {
    assert.equal(
      (await cli(['packet', '--corpus', env.corpus.path, '--out', env.packets.path])).code,
      0,
    );
    for (const [name, caseId, reviewer] of [
      ['a1.json', 'case-a', 'dana'],
      ['b1.json', 'case-b', 'dana'],
    ] as const) {
      writeFileSync(
        join(env.submissions.path, name),
        JSON.stringify(submission(env.packets.path, caseId, reviewer)),
        'utf8',
      );
    }
    const target = join(out.path, 'merged');
    const result = await cli([
      'merge',
      '--corpus',
      env.corpus.path,
      '--submissions',
      env.submissions.path,
      '--out',
      target,
    ]);
    assert.equal(result.code, 0, result.stderr);
    const files = dirSnapshot(target);
    assert.deepEqual(Object.keys(files).sort(), ['case-a.json', 'case-b.json']);
    const caseA = JSON.parse(files['case-a.json'] as string) as {
      reviewerLabels: Record<string, unknown>[];
    };
    assert.equal(caseA.reviewerLabels.length, 4, 'the submission applied');
    assert.equal(
      existsSync(`${target}.staging`),
      false,
      'a finished run cleans up its staging directory',
    );
  } finally {
    env.remove();
    out.remove();
  }
});

test('one refused submission stops the whole atomic batch from writing', async () => {
  const env = setup();
  const out = tempDir();
  try {
    assert.equal(
      (await cli(['packet', '--corpus', env.corpus.path, '--out', env.packets.path])).code,
      0,
    );
    writeFileSync(
      join(env.submissions.path, 'ok.json'),
      JSON.stringify(submission(env.packets.path, 'case-a', 'dana')),
      'utf8',
    );
    writeFileSync(
      join(env.submissions.path, 'bad.json'),
      JSON.stringify(submission(env.packets.path, 'case-b', 'erin', { submittedAt: 'not a time' })),
      'utf8',
    );
    const target = join(out.path, 'merged');
    const result = await cli([
      'merge',
      '--corpus',
      env.corpus.path,
      '--submissions',
      env.submissions.path,
      '--out',
      target,
    ]);
    assertRefused(result, /atomic|nothing written/i);
    assert.equal(existsSync(target), false, 'the accepted item is not written either');
    assert.match(result.stderr, /ISO 8601|timestamp/i);
  } finally {
    env.remove();
    out.remove();
  }
});

test('--allow-partial applies the accepted item and reports both outcomes', async () => {
  const env = setup();
  const out = tempDir();
  try {
    assert.equal(
      (await cli(['packet', '--corpus', env.corpus.path, '--out', env.packets.path])).code,
      0,
    );
    writeFileSync(
      join(env.submissions.path, 'ok.json'),
      JSON.stringify(submission(env.packets.path, 'case-a', 'dana')),
      'utf8',
    );
    writeFileSync(
      join(env.submissions.path, 'bad.json'),
      JSON.stringify(submission(env.packets.path, 'case-b', 'ghost')),
      'utf8',
    );
    const target = join(out.path, 'merged');
    const result = await cli([
      'merge',
      '--corpus',
      env.corpus.path,
      '--submissions',
      env.submissions.path,
      '--out',
      target,
      '--allow-partial',
    ]);
    assert.notEqual(result.code, 0, 'a partial import is still a refusal worth an exit code');
    assert.match(result.stderr, /ACCEPTED case-a\/dana/);
    assert.match(result.stderr, /REJECTED case-b\/ghost/);
    const files = dirSnapshot(target);
    const caseA = JSON.parse(files['case-a.json'] as string) as { reviewerLabels: unknown[] };
    const caseB = JSON.parse(files['case-b.json'] as string) as { reviewerLabels: unknown[] };
    assert.equal(caseA.reviewerLabels.length, 4);
    assert.equal(caseB.reviewerLabels.length, 0, 'the refused case is exported unchanged');
  } finally {
    env.remove();
    out.remove();
  }
});

test('an interrupted run caught at "staged" rolls back with the target untouched', async () => {
  const env = setup();
  const out = tempDir();
  try {
    assert.equal(
      (await cli(['packet', '--corpus', env.corpus.path, '--out', env.packets.path])).code,
      0,
    );
    writeFileSync(
      join(env.submissions.path, 'ok.json'),
      JSON.stringify(submission(env.packets.path, 'case-a', 'dana')),
      'utf8',
    );
    const target = join(out.path, 'merged');
    const preview = await cli([
      'merge',
      '--corpus',
      env.corpus.path,
      '--submissions',
      env.submissions.path,
      '--out',
      target,
      '--dry-run',
    ]);
    const planHash = planHashOf(preview.stderr);

    // Simulate a crash after staging was written but before any target file was published.
    const staging = `${target}.staging`;
    mkdirSync(staging, { recursive: true });
    writeFileSync(
      join(staging, 'journal.json'),
      JSON.stringify(
        {
          version: 'benchmark-batch-journal-v1',
          planHash,
          kind: 'merge',
          mode: 'atomic',
          state: 'staged',
          items: [{ name: 'case-a.json', contentsHash: 'a'.repeat(64) }],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(join(staging, 'case-a.json'), '{}\n', 'utf8');

    const recovered = await cli([
      'merge',
      '--corpus',
      env.corpus.path,
      '--submissions',
      env.submissions.path,
      '--out',
      target,
      '--recover',
    ]);
    assert.equal(recovered.code, 0, recovered.stderr);
    assert.match(recovered.stderr, /rolled back|rollback/i);
    assert.equal(existsSync(target), false, 'a staged interruption never touched the target');
    assert.equal(existsSync(staging), false, 'the abandoned staging directory is removed');
  } finally {
    env.remove();
    out.remove();
  }
});

test('an interrupted run caught mid-publish completes to the same bytes as a clean run', async () => {
  const env = setup();
  const out = tempDir();
  const clean = tempDir();
  try {
    assert.equal(
      (await cli(['packet', '--corpus', env.corpus.path, '--out', env.packets.path])).code,
      0,
    );
    for (const [name, caseId] of [
      ['a1.json', 'case-a'],
      ['b1.json', 'case-b'],
    ] as const) {
      writeFileSync(
        join(env.submissions.path, name),
        JSON.stringify(submission(env.packets.path, caseId, 'dana')),
        'utf8',
      );
    }
    const args = ['merge', '--corpus', env.corpus.path, '--submissions', env.submissions.path];
    const cleanTarget = join(clean.path, 'merged');
    assert.equal((await cli([...args, '--out', cleanTarget])).code, 0);

    const target = join(out.path, 'merged');
    const preview = await cli([...args, '--out', target, '--dry-run']);
    const planHash = planHashOf(preview.stderr);

    // Crash after the journal flipped to "committing" and the first file landed.
    const staging = `${target}.staging`;
    mkdirSync(staging, { recursive: true });
    mkdirSync(target, { recursive: true });
    const cleanFiles = dirSnapshot(cleanTarget);
    writeFileSync(join(target, 'case-a.json'), cleanFiles['case-a.json'] as string, 'utf8');
    writeFileSync(
      join(staging, 'journal.json'),
      JSON.stringify(
        {
          version: 'benchmark-batch-journal-v1',
          planHash,
          kind: 'merge',
          mode: 'atomic',
          state: 'committing',
          items: Object.keys(cleanFiles).map((name) => ({
            name,
            contentsHash: name, // replaced below with the real hashes from the staged files
          })),
        },
        null,
        2,
      ),
      'utf8',
    );
    for (const [name, contents] of Object.entries(cleanFiles)) {
      writeFileSync(join(staging, name), contents, 'utf8');
    }
    // Rewrite the journal with the true content hashes the planner would compute.
    const journalPath = join(staging, 'journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      items: { name: string; contentsHash: string }[];
    };
    for (const item of journal.items) {
      item.contentsHash = contentHash(cleanFiles[item.name] as string);
    }
    writeFileSync(journalPath, JSON.stringify(journal, null, 2), 'utf8');

    const recovered = await cli([...args, '--out', target, '--recover']);
    assert.equal(recovered.code, 0, recovered.stderr);
    assert.deepEqual(
      dirSnapshot(target),
      cleanFiles,
      'recovering a partial publish produces exactly what an uninterrupted run would have',
    );
    assert.equal(existsSync(staging), false, 'the finished journal is removed');
  } finally {
    env.remove();
    out.remove();
    clean.remove();
  }
});

test('recovery refuses when the inputs no longer match the journalled plan', async () => {
  const env = setup();
  const out = tempDir();
  try {
    assert.equal(
      (await cli(['packet', '--corpus', env.corpus.path, '--out', env.packets.path])).code,
      0,
    );
    writeFileSync(
      join(env.submissions.path, 'ok.json'),
      JSON.stringify(submission(env.packets.path, 'case-a', 'dana')),
      'utf8',
    );
    const target = join(out.path, 'merged');
    const staging = `${target}.staging`;
    mkdirSync(staging, { recursive: true });
    writeFileSync(
      join(staging, 'journal.json'),
      JSON.stringify(
        {
          version: 'benchmark-batch-journal-v1',
          planHash: 'b'.repeat(64),
          kind: 'merge',
          mode: 'atomic',
          state: 'staged',
          items: [],
        },
        null,
        2,
      ),
      'utf8',
    );
    const recovered = await cli([
      'merge',
      '--corpus',
      env.corpus.path,
      '--submissions',
      env.submissions.path,
      '--out',
      target,
      '--recover',
    ]);
    assertRefused(recovered, /does not match|different plan/i);
    assert.equal(
      existsSync(staging),
      true,
      'an unrecognisable journal is left for the operator to inspect',
    );
  } finally {
    env.remove();
    out.remove();
  }
});

test('recovery without a journal says so instead of inventing a state', async () => {
  const env = setup();
  const out = tempDir();
  try {
    const target = join(out.path, 'merged');
    const result = await cli([
      'merge',
      '--corpus',
      env.corpus.path,
      '--submissions',
      env.submissions.path,
      '--out',
      target,
      '--recover',
    ]);
    assertRefused(result, /no batch journal/i);
  } finally {
    env.remove();
    out.remove();
  }
});

test('adjudicate shares the same atomic, dry-run and staged behaviour', async () => {
  const env = setup();
  const forms = tempDir();
  const out = tempDir();
  try {
    const split = caseFile('case-a', ['dana', 'erin']);
    (split as { reviewerLabels: unknown[] }).reviewerLabels = [
      {
        reviewer: 'dana',
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        subjectId: 'p1',
        note: null,
      },
      {
        reviewer: 'erin',
        dimension: 'EVIDENCE_SUPPORT',
        label: 'PARTIALLY_SUPPORTED',
        subjectId: 'p1',
        note: null,
      },
    ];
    writeFileSync(join(env.corpus.path, 'a.json'), JSON.stringify(split), 'utf8');
    assert.equal(
      (await cli(['adjudicate', '--corpus', env.corpus.path, '--issue', '--out', forms.path])).code,
      0,
    );
    const form = JSON.parse(
      readFileSync(join(forms.path, 'case-a.adjudication.json'), 'utf8'),
    ) as Record<string, unknown>[];
    const filled = [
      {
        ...form[0],
        outcome: 'RESOLVED',
        label: 'SUPPORTED_WITHIN_SCOPE',
        reason: 'The second record restates the first.',
        adjudicatedBy: 'erin',
        adjudicatedAt: '2026-11-05T12:00:00Z',
      },
      {
        ...form[0],
        subjectId: 'ghost',
        disagreementHash: 'c'.repeat(64),
      },
    ];
    const decisions = tempDir();
    writeFileSync(join(decisions.path, 'd.json'), JSON.stringify(filled), 'utf8');
    const target = join(out.path, 'adjudicated');
    try {
      const dry = await cli([
        'adjudicate',
        '--corpus',
        env.corpus.path,
        '--adjudications',
        decisions.path,
        '--out',
        target,
        '--dry-run',
      ]);
      assertRefused(dry, /DRY RUN|dry run/i);
      assert.equal(existsSync(target), false, 'even a preview refusal writes nothing');

      const refused = await cli([
        'adjudicate',
        '--corpus',
        env.corpus.path,
        '--adjudications',
        decisions.path,
        '--out',
        target,
      ]);
      assertRefused(refused, /atomic|nothing written/i);
      assert.equal(existsSync(target), false, 'atomic by default: nothing is published');

      const partial = await cli([
        'adjudicate',
        '--corpus',
        env.corpus.path,
        '--adjudications',
        decisions.path,
        '--out',
        target,
        '--allow-partial',
      ]);
      assert.notEqual(partial.code, 0);
      const written = JSON.parse(readFileSync(join(target, 'case-a.json'), 'utf8')) as {
        adjudications: unknown[];
      };
      assert.equal(
        written.adjudications.length,
        1,
        'the valid decision applied under --allow-partial',
      );
    } finally {
      decisions.remove();
    }
  } finally {
    env.remove();
    forms.remove();
    out.remove();
  }
});

test('the packet hash the batch relies on is stable across the CLI and the library', async () => {
  const env = setup();
  try {
    assert.equal(
      (await cli(['packet', '--corpus', env.corpus.path, '--out', env.packets.path])).code,
      0,
    );
    const parsed = JSON.parse(
      readFileSync(join(env.packets.path, 'case-a.packet.json'), 'utf8'),
    ) as { packetHash: string };
    const library = buildReviewerPacket(
      JSON.parse(readFileSync(join(env.corpus.path, 'a.json'), 'utf8')) as never,
    );
    assert.equal(parsed.packetHash, library.packetHash);
  } finally {
    env.remove();
  }
});
