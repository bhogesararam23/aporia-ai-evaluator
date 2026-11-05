import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { join } from 'node:path';

import {
  assertFileBytes,
  assertFileCount,
  assertTotalBytes,
  CorpusReadError,
  readCorpusValues,
  readJsonEntries,
} from '../../scripts/corpus-io.ts';
import { BENCHMARK_LIMITS } from '../../src/benchmark/validate.ts';
import { MAX_CANONICAL_DEPTH } from '../../src/benchmark/hashing.ts';
import { scratchDirectory } from '../helpers/temp.ts';

/**
 * The one bounded corpus read (v0.8, spec §3).
 *
 * Before v0.8 the harness had its own careful loader and `benchmark:case` / `benchmark:release` shared a
 * second, careless one. A directory named `nested.json` produced a raw `EISDIR` and a stack trace on two of
 * three commands, while the third skipped it. These tests describe the read that all three now use: refuse
 * loudly and specifically, or read within stated bounds — never crash, never silently skip.
 */

function kindOf(action: () => unknown): string | null {
  try {
    action();
    return null;
  } catch (error) {
    return error instanceof CorpusReadError ? error.kind : `raw:${(error as Error).name}`;
  }
}

function messageOf(action: () => unknown): string {
  try {
    action();
    return '(no refusal)';
  } catch (error) {
    assert.ok(error instanceof CorpusReadError, `expected a typed refusal, got ${String(error)}`);
    return error.message;
  }
}

test('a directory named *.json is a stated refusal, not a crash', () => {
  const temp = scratchDirectory('aporia-corpus-type-');
  try {
    mkdirSync(join(temp.path, 'nested.json'));
    writeFileSync(join(temp.path, 'good.json'), '[]', 'utf8');
    assert.equal(
      kindOf(() => readCorpusValues(temp.path)),
      'type',
    );
    assert.match(
      messageOf(() => readCorpusValues(temp.path)),
      /nested\.json/,
    );
    // The message has to be actionable: an operator should know what to do, not just that something failed.
    assert.match(
      messageOf(() => readCorpusValues(temp.path)),
      /regular file/,
    );
    assert.equal(
      kindOf(() => readJsonEntries(temp.path)),
      'type',
    );
  } finally {
    temp.remove();
  }
});

test('an unreadable directory is a typed directory refusal', () => {
  const temp = scratchDirectory('aporia-corpus-missing-');
  const missing = join(temp.path, 'never-created');
  try {
    assert.equal(
      kindOf(() => readCorpusValues(missing)),
      'directory',
    );
    assert.equal(
      kindOf(() => readJsonEntries(missing)),
      'directory',
    );
  } finally {
    temp.remove();
  }
});

test('entries are ordered by code unit, so the read does not depend on a locale', () => {
  const temp = scratchDirectory('aporia-corpus-order-');
  try {
    // `B` and `a` are the pair where ICU collation and code-unit ordering disagree: a locale-aware sort
    // puts `a.json` first, a code-unit sort puts `B.json` first. Two machines must not disagree about which
    // case is index 0, because the index is what a validation issue points at.
    writeFileSync(join(temp.path, 'a.json'), '[{"id":"second"}]', 'utf8');
    writeFileSync(join(temp.path, 'B.json'), '[{"id":"first"}]', 'utf8');
    const loaded = readCorpusValues(temp.path);
    assert.deepEqual(
      loaded.map((entry) => entry.source),
      ['B.json', 'a.json'],
    );
    assert.deepEqual(
      loaded.map((entry) => entry.index),
      [0, 1],
    );
    const entries = readJsonEntries(temp.path);
    assert.deepEqual(
      entries.map((entry) => entry.name),
      ['B.json', 'a.json'],
    );
  } finally {
    temp.remove();
  }
});

test('only .json entries are considered, and a non-json sibling is ignored rather than fatal', () => {
  const temp = scratchDirectory('aporia-corpus-ext-');
  try {
    writeFileSync(join(temp.path, 'case.json'), '[{"id":"a"}]', 'utf8');
    writeFileSync(join(temp.path, 'notes.txt'), 'not a case', 'utf8');
    mkdirSync(join(temp.path, 'subdirectory'));
    const loaded = readCorpusValues(temp.path);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]?.source, 'case.json');
  } finally {
    temp.remove();
  }
});

test('the ceilings are checked against the numbers the loader will read', () => {
  // Exercised as exported predicates rather than by materialising 5001 files: the arithmetic that decides a
  // refusal is the thing worth pinning, and a test that took eight seconds to build a directory would be a
  // test nobody runs when it fails.
  assert.equal(
    kindOf(() =>
      assertFileCount(
        Array.from({ length: BENCHMARK_LIMITS.maxFiles }, (_, i) => `c${String(i)}.json`),
      ),
    ),
    null,
  );
  assert.equal(
    kindOf(() =>
      assertFileCount(
        Array.from({ length: BENCHMARK_LIMITS.maxFiles + 1 }, (_, i) => `c${String(i)}.json`),
      ),
    ),
    'count',
  );
  assert.equal(
    kindOf(() => assertFileBytes('a.json', BENCHMARK_LIMITS.maxCaseBytes)),
    null,
  );
  assert.equal(
    kindOf(() => assertFileBytes('a.json', BENCHMARK_LIMITS.maxCaseBytes + 1)),
    'size',
  );
  assert.equal(
    kindOf(() => assertTotalBytes(BENCHMARK_LIMITS.maxCorpusBytes)),
    null,
  );
  assert.equal(
    kindOf(() => assertTotalBytes(BENCHMARK_LIMITS.maxCorpusBytes + 1)),
    'size',
  );
});

test('the count and byte refusals quote the limit and the observed value', () => {
  assert.match(
    messageOf(() => assertFileCount(Array.from({ length: 5001 }, (_, i) => `c${String(i)}.json`))),
    /5001/,
  );
  assert.match(
    messageOf(() => assertFileCount(Array.from({ length: 5001 }, (_, i) => `c${String(i)}.json`))),
    new RegExp(String(BENCHMARK_LIMITS.maxFiles)),
  );
  const bytes = messageOf(() => assertFileBytes('fat.json', 300_000));
  assert.match(bytes, /fat\.json/);
  assert.match(bytes, /300000/);
  // The wording the harness has always used for this case, so one refusal reads the same on three commands.
  assert.match(bytes, /per-file limit/);
  assert.match(
    messageOf(() => assertTotalBytes(9_000_000)),
    /8388608/,
  );
});

test('an oversized file is refused before its bytes are parsed', () => {
  const temp = scratchDirectory('aporia-corpus-oversize-');
  try {
    // Not valid JSON on purpose: if the size check happened after parsing, this file would be reported as
    // malformed instead of as too big, and the operator would hunt for a missing comma that is not there.
    const padding = 'x'.repeat(BENCHMARK_LIMITS.maxCaseBytes + 100);
    writeFileSync(join(temp.path, 'huge.json'), `{ "padding": "${padding}" }`, 'utf8');
    assert.equal(
      kindOf(() => readCorpusValues(temp.path)),
      'size',
    );
    assert.match(
      messageOf(() => readCorpusValues(temp.path)),
      /huge\.json/,
    );
    assert.equal(
      kindOf(() => readJsonEntries(temp.path)),
      'size',
    );
  } finally {
    temp.remove();
  }
});

test('a corpus whose files are individually legal but cumulatively too big is refused', () => {
  const temp = scratchDirectory('aporia-corpus-total-');
  try {
    const perFile = 200_000;
    const count = Math.ceil(BENCHMARK_LIMITS.maxCorpusBytes / perFile) + 1;
    const padding = 'y'.repeat(perFile);
    for (let index = 0; index < count; index += 1) {
      writeFileSync(join(temp.path, `bulk-${String(index)}.json`), `["${padding}"]`, 'utf8');
    }
    assert.equal(
      kindOf(() => readCorpusValues(temp.path)),
      'size',
    );
    assert.match(
      messageOf(() => readCorpusValues(temp.path)),
      /total/,
    );
  } finally {
    temp.remove();
  }
});

test('a document nested past the hashing bound is refused by name and ceiling', () => {
  const temp = scratchDirectory('aporia-corpus-depth-');
  try {
    // 200 levels parses fine and is a few hundred bytes, so the only bound that catches it is the nesting
    // depth this build can canonicalise. Relying on the parser's own stack limit would make the refusal
    // depend on how much stack Node happened to have left, and on which machine it ran.
    let deep: unknown = 'leaf';
    for (let index = 0; index < 200; index += 1) {
      deep = [deep];
    }
    writeFileSync(join(temp.path, 'deep.json'), JSON.stringify({ buried: deep }), 'utf8');
    assert.equal(
      kindOf(() => readCorpusValues(temp.path)),
      'depth',
    );
    const message = messageOf(() => readCorpusValues(temp.path));
    assert.match(message, /deep\.json/);
    assert.match(message, new RegExp(String(MAX_CANONICAL_DEPTH)));
    assert.equal(
      kindOf(() => readJsonEntries(temp.path)),
      'depth',
    );
  } finally {
    temp.remove();
  }
});

test('an ordinary multi-level case, well inside the bound, still reads', () => {
  const temp = scratchDirectory('aporia-corpus-normal-');
  try {
    writeFileSync(
      join(temp.path, 'fine.json'),
      JSON.stringify({
        input: { propositions: [{ id: 'p1', evidence: [{ id: 'e1' }] }] },
        expected: [{ dimension: 'EVIDENCE_SUPPORT', subjectId: 'p1' }],
      }),
      'utf8',
    );
    const loaded = readCorpusValues(temp.path);
    assert.equal(loaded.length, 1);
    assert.equal(
      readJsonEntries(temp.path).length,
      1,
      'a nested but legal document must not be caught by the depth bound',
    );
  } finally {
    temp.remove();
  }
});
