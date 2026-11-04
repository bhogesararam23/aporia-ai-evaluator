import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canonicalise,
  contentHash,
  DepthExceededError,
  isContentHash,
  MAX_CANONICAL_DEPTH,
  nestsDeeperThan,
} from '../../src/benchmark/hashing.ts';
import { validateBenchmarkCase } from '../../src/benchmark/validate.ts';

/**
 * Canonical hashing (ADR-026, hardened in ADR-027).
 *
 * The benchmark release manifest is only reproducible if the same corpus bytes hash the same way on every
 * machine. This module therefore pins three properties: key order does not matter, the ordering rule is
 * defined by the string rather than by a locale, and the digest shape is checked before anything compares
 * it. A hash here is an integrity check over recorded content — it authenticates no reviewer.
 */

test('object key order does not change the hash', () => {
  const left = contentHash({ a: 1, b: { c: 2, d: 3 } });
  const right = contentHash({ b: { d: 3, c: 2 }, a: 1 });
  assert.equal(left, right);
});

test('undefined-valued keys are dropped so an absent field hashes like a missing one', () => {
  assert.equal(contentHash({ a: 1, b: undefined }), contentHash({ a: 1 }));
});

test('array order is content, so reordering annotations changes the hash', () => {
  const first = contentHash([{ x: 1 }, { x: 2 }]);
  const second = contentHash([{ x: 2 }, { x: 1 }]);
  assert.notEqual(first, second);
});

test('nested keys are sorted at every depth, not only at the top level', () => {
  const canonical = canonicalise({ z: 1, a: { y: 2, b: { z: 3, a: 4 } } }) as Record<
    string,
    unknown
  >;
  assert.deepEqual(Object.keys(canonical), ['a', 'z']);
  const inner = canonical['a'] as Record<string, unknown>;
  assert.deepEqual(Object.keys(inner), ['b', 'y']);
  const deepest = inner['b'] as Record<string, unknown>;
  assert.deepEqual(Object.keys(deepest), ['a', 'z']);
});

test('key ordering is by code unit, so it cannot vary with the execution locale', () => {
  // `localeCompare` would order these by locale collation; code-unit ordering is fixed by the strings.
  // Uppercase Latin letters sort before lowercase ones, which a locale-aware collator typically reverses.
  const ordered = Object.keys(canonicalise({ b: 1, B: 2, _: 3, A: 4 }) as Record<string, unknown>);
  assert.deepEqual(ordered, ['A', 'B', '_', 'b']);
  // Two objects differing only in key order still agree, whatever the order rule is.
  assert.equal(contentHash({ b: 1, B: 2 }), contentHash({ B: 2, b: 1 }));
});

test('the digest is a lowercase sha-256 hex string of stable length', () => {
  const value = contentHash({ caseId: 'c1', text: 'Ünïcødé ✓ content' });
  assert.match(value, /^[0-9a-f]{64}$/);
  assert.ok(isContentHash(value));
  assert.equal(value, contentHash({ text: 'Ünïcødé ✓ content', caseId: 'c1' }));
});

test('isContentHash rejects the shapes that would silently disable a staleness check', () => {
  for (const bad of [
    undefined,
    null,
    '',
    '   ',
    'z'.repeat(64),
    'A'.repeat(64),
    'a'.repeat(63),
    'a'.repeat(65),
    64,
    {},
  ]) {
    assert.equal(isContentHash(bad), false, `${String(bad)} should not be a content hash`);
  }
  assert.equal(isContentHash('a'.repeat(64)), true);
});

test('the canonicaliser is bounded, and refuses rather than exhausting the stack', () => {
  // Pathological depth would otherwise surface as a RangeError in the middle of a merge, audit or freeze.
  const shallow = { a: { b: { c: { d: [1, 2] } } } };
  assert.equal(nestsDeeperThan(shallow, MAX_CANONICAL_DEPTH), false);
  assert.equal(canonicalise(shallow) !== undefined, true);

  let deep: unknown = 'leaf';
  for (let index = 0; index < MAX_CANONICAL_DEPTH + 8; index += 1) {
    deep = { nested: deep };
  }
  assert.equal(nestsDeeperThan(deep, MAX_CANONICAL_DEPTH), true);
  assert.throws(() => canonicalise(deep), DepthExceededError);
  assert.throws(() => contentHash(deep), DepthExceededError);
});

test('an array nested past the bound is refused too, not just an object', () => {
  let deep: unknown = 'leaf';
  for (let index = 0; index < MAX_CANONICAL_DEPTH + 2; index += 1) {
    deep = [deep];
  }
  assert.equal(nestsDeeperThan(deep, MAX_CANONICAL_DEPTH), true);
});

test('the validator refuses an over-deep case with a reason instead of letting the hasher throw', () => {
  let deep: unknown = 'leaf';
  for (let index = 0; index < MAX_CANONICAL_DEPTH + 4; index += 1) {
    deep = { nested: deep };
  }
  const issues = validateBenchmarkCase(deep, 7);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.field, 'case');
  assert.match(issues[0]?.message ?? '', /nested deeper than 64 levels/);
  // The refusal is reported for the case index, so the operator can find the file.
  assert.equal(issues[0]?.caseId, 'case#7');
});
