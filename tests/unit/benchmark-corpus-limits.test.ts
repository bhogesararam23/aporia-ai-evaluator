import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BENCHMARK_LIMITS } from '../../src/benchmark/validate.ts';
import { MAX_CANONICAL_DEPTH } from '../../src/benchmark/hashing.ts';

/**
 * The bounds a corpus read is allowed to respect (v0.8).
 *
 * A limit that exists in one command and not in another is not a limit: it is a guess about which entry
 * point the operator happens to use. The merged v0.7 tree enforced its byte ceiling only inside
 * `scripts/benchmark.ts`, while `benchmark:case` and `benchmark:release` parsed any size file put in front
 * of them — a 1,093,691-byte bundle was refused by one command and reported as "600 valid case(s)" by the
 * other. These assertions name the shared ceiling set; `tests/integration/benchmark-corpus-io-cli.test.ts`
 * is where each refusal is actually exercised.
 */
test('the file-count and nesting ceilings the loader needs are named', () => {
  assert.equal(BENCHMARK_LIMITS.maxFiles, 5000);
  assert.equal(BENCHMARK_LIMITS.maxNestingDepth, MAX_CANONICAL_DEPTH);
});

test('the nesting ceiling names the canonicaliser bound rather than restating a number', () => {
  // If MAX_CANONICAL_DEPTH moves, the loader's ceiling moves with it. Two independently written numbers
  // would drift, and a corpus read past the hasher's bound is exactly the crash this prevents.
  assert.equal(BENCHMARK_LIMITS.maxNestingDepth, 64);
  assert.equal(MAX_CANONICAL_DEPTH, 64);
});

test('v0.8 loosens no bound v0.7 already documented', () => {
  // The owner decision recorded in ADR-028 was to unify on the existing limits, so the commands that had no
  // bound become as strict as the one that did — never the other way round.
  assert.equal(BENCHMARK_LIMITS.maxCases, 5000);
  assert.equal(BENCHMARK_LIMITS.maxCaseBytes, 262_144);
  assert.equal(BENCHMARK_LIMITS.maxCorpusBytes, 8_388_608);
});

test('a file count and a case count are separate limits', () => {
  // `scripts/benchmark.ts` once compared a number of *files* against `maxCases`. The values agree today, so
  // the only thing that distinguishes a rename from a real separation is that both keys exist independently.
  const keys = Object.keys(BENCHMARK_LIMITS);
  assert.ok(keys.includes('maxFiles'));
  assert.ok(keys.includes('maxCases'));
  // A file may hold an array of cases, so the file ceiling must be the one that bounds the *read* and the
  // case ceiling the one that bounds the corpus; asserting inequality of values would be wrong (both 5000),
  // so the loader tests are what prove each is applied to the right quantity.
});
