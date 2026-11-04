import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateBenchmarkCase } from '../../src/benchmark/validate.ts';
import { fixtureCase } from '../helpers/benchmark-fixtures.ts';
import { BENCHMARK_CASE_VERSION, BENCHMARK_CASE_VERSION_V1 } from '../../src/benchmark/types.ts';

/**
 * The shared fixture must be a real, scoreable case.
 *
 * This exists because the v0.6 review unit-test fixtures were not: they had statements but no `citations`
 * array, so `validateBenchmarkCase` refused them. A test suite built on a case the validator rejects cannot
 * notice that the code under test emits a corpus the validator also rejects — which is precisely how v0.6
 * `merge` shipped an invalid case without any test failing.
 */

test('the v2 fixture passes the real corpus validator with no issues', () => {
  const benchmarkCase = fixtureCase();
  assert.deepEqual(validateBenchmarkCase(benchmarkCase, 0), []);
});

test('the fixture with two reviewers declared and both having labelled still validates', () => {
  const benchmarkCase = fixtureCase({
    reviewedBy: ['dana', 'erin'],
    reviewerLabels: [
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
        label: 'SUPPORTED_WITHIN_SCOPE',
        subjectId: 'p1',
        note: null,
      },
    ],
  });
  assert.deepEqual(validateBenchmarkCase(benchmarkCase, 0), []);
});

test('the v1 fixture shape validates too, so compatibility tests start from a real case', () => {
  // A v1 case omits `sourceId`; the evidence id stands in, and the validator accepts that contract.
  const benchmarkCase = fixtureCase({ version: BENCHMARK_CASE_VERSION_V1 });
  assert.deepEqual(validateBenchmarkCase(benchmarkCase, 0), []);
});

test('a fixture with an undeclared reviewer is refused, which is the rule merge now enforces earlier', () => {
  const benchmarkCase = fixtureCase({
    reviewedBy: ['dana'],
    reviewerLabels: [
      {
        reviewer: 'sam',
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        subjectId: 'p1',
        note: null,
      },
    ],
  });
  const issues = validateBenchmarkCase(benchmarkCase, 0);
  assert.ok(
    issues.some((issue) => /reviewedBy/.test(issue.message)),
    'the validator is the reason merge must refuse an undeclared reviewer',
  );
});

test('the version constants used by the fixture are the accepted case contract versions', () => {
  assert.equal(BENCHMARK_CASE_VERSION, 'benchmark-case-v2');
  assert.equal(BENCHMARK_CASE_VERSION_V1, 'benchmark-case-v1');
});
