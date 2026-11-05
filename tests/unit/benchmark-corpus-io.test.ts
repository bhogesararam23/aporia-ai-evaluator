import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { join } from 'node:path';

import { CorpusReadError, readCorpusValues, readJsonEntries } from '../../scripts/corpus-io.ts';
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
