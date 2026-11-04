import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  compareStrings,
  declaredRoster,
  isDeclaredReviewer,
  isSameReviewer,
  labelledReviewerIdentities,
} from '../../src/benchmark/provenance.ts';
import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';

/**
 * The declared reviewer roster (ADR-027, defect 3).
 *
 * `provenance.reviewedBy` is the only authorisation record the offline workflow has. v0.6 read it during
 * validation but not during merge, so a submission from an undeclared name merged successfully and produced a
 * case the validator then rejected. These tests pin the roster as the thing merge must consult, and pin that
 * reading it never changes it.
 */

test('the roster is canonicalised, de-duplicated and sorted', () => {
  const benchmarkCase = fixtureCase({ reviewedBy: ['ZOE', 'dana', 'Dana', ' erin '] });
  assert.deepEqual(declaredRoster(benchmarkCase), ['dana', 'erin', 'zoe']);
});

test('a blank roster entry is dropped rather than becoming an authorisation', () => {
  const benchmarkCase = fixtureCase({ reviewedBy: ['', '   ', 'dana'] });
  assert.deepEqual(declaredRoster(benchmarkCase), ['dana']);
});

test('an empty roster authorises nobody', () => {
  const benchmarkCase = fixtureCase({ reviewedBy: [] });
  assert.deepEqual(declaredRoster(benchmarkCase), []);
  assert.equal(isDeclaredReviewer(benchmarkCase, 'dana'), false);
  // The empty identity must not match an empty roster either.
  assert.equal(isDeclaredReviewer(benchmarkCase, ''), false);
});

test('membership is checked by canonical identity, so spelling variants are declared reviewers', () => {
  const benchmarkCase = fixtureCase({ reviewedBy: ['Dana Lee'] });
  assert.equal(isDeclaredReviewer(benchmarkCase, 'dana lee'), true);
  assert.equal(isDeclaredReviewer(benchmarkCase, 'dana'), false);
  assert.equal(isDeclaredReviewer(benchmarkCase, ''), false);
});

test('reading the roster never mutates the case, so it cannot authorise anyone by accident', () => {
  const benchmarkCase = fixtureCase({ reviewedBy: ['dana'] });
  const before = JSON.stringify(benchmarkCase);
  declaredRoster(benchmarkCase);
  isDeclaredReviewer(benchmarkCase, 'sam');
  labelledReviewerIdentities(benchmarkCase);
  assert.equal(JSON.stringify(benchmarkCase), before);
});

test('labelled identities collapse alias spellings of one reviewer', () => {
  const benchmarkCase = fixtureCase({
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('DANA', 'ANSWER_FIDELITY', 'st1', 'NOT_ASSESSABLE'),
      labelFor(' erin ', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
    ],
  });
  assert.deepEqual(labelledReviewerIdentities(benchmarkCase), ['dana', 'erin']);
});

test('a reviewer who labelled but was never declared is visible as an identity', () => {
  const benchmarkCase = fixtureCase({
    reviewedBy: ['dana'],
    reviewerLabels: [labelFor('sam', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE')],
  });
  assert.deepEqual(labelledReviewerIdentities(benchmarkCase), ['sam']);
  assert.equal(isDeclaredReviewer(benchmarkCase, 'sam'), false);
});

test('isSameReviewer compares identities and refuses to match blanks', () => {
  assert.equal(isSameReviewer('Sam', ' SAM '), true);
  assert.equal(isSameReviewer('sam', 'sam lee'), false);
  assert.equal(isSameReviewer('', ''), false);
  assert.equal(isSameReviewer('', 'sam'), false);
});

test('compareStrings orders by code unit, not by locale collation', () => {
  // A locale-aware collator typically folds case and orders `_` differently; code units are fixed.
  assert.deepEqual(['b', 'B', '_', 'a'].sort(compareStrings), ['B', '_', 'a', 'b']);
  assert.equal(compareStrings('same', 'same'), 0);
});
