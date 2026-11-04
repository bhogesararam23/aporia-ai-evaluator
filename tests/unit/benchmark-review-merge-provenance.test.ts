import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildReviewerPacket,
  mergeSubmission,
  SUBMISSION_VERSION,
  SUBMISSION_VERSION_V2,
  type AnnotationSubmission,
} from '../../src/benchmark/review.ts';
import { normaliseCase } from '../../src/benchmark/authoring.ts';
import { validateBenchmarkCase } from '../../src/benchmark/validate.ts';
import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';
import type { BenchmarkCase } from '../../src/benchmark/types.ts';

/**
 * Safe merge (ADR-027, defects 1, 2 and 3).
 *
 * v0.6 merged honestly in most respects — it refused stale hashes, unknown subjects and out-of-vocabulary
 * labels — but it then threw away the rationale and timestamp it had just demanded, never recorded which
 * packet a judgement was bound to, and accepted any reviewer name, which produced a case that its own corpus
 * validator rejected. These tests pin the merge as refuse-rather-than-repair *and* preserve-everything-the-
 * human-supplied.
 */

function caseWithRoster(
  reviewedBy: readonly string[],
  labels: BenchmarkCase['reviewerLabels'] = [],
) {
  return fixtureCase({ reviewedBy, reviewerLabels: labels });
}

function submissionFor(
  benchmarkCase: BenchmarkCase,
  overrides: Partial<AnnotationSubmission> = {},
): AnnotationSubmission {
  const packet = buildReviewerPacket(benchmarkCase);
  return {
    version: SUBMISSION_VERSION_V2,
    caseId: packet.caseId,
    packetHash: packet.packetHash,
    reviewer: 'erin',
    submittedAt: '2026-11-05T09:00:00Z',
    annotations: packet.subjects.map((subject, index) => ({
      dimension: subject.dimension,
      subjectId: subject.subjectId,
      label: subject.dimension === 'EVIDENCE_SUPPORT' ? 'SUPPORTED_WITHIN_SCOPE' : 'NOT_ASSESSABLE',
      rationale: `Reviewer rationale ${String(index)}: the recorded material states this directly.`,
    })),
    ...overrides,
  };
}

const DECLARED = ['dana', 'erin'];

test('a merged label keeps the rationale, the supplied timestamp and the packet binding', () => {
  const benchmarkCase = caseWithRoster(DECLARED);
  const submission = submissionFor(benchmarkCase);
  const result = mergeSubmission(benchmarkCase, submission);
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const merged = result.case.reviewerLabels.filter((entry) => entry.reviewer === 'erin');
  assert.equal(merged.length, 4);
  for (const entry of merged) {
    assert.match(String(entry.rationale), /^Reviewer rationale \d:/);
    // v2 timestamps are stored in the canonical UTC form `isoDateTime` produces, milliseconds included.
    assert.equal(entry.submittedAt, '2026-11-05T09:00:00.000Z');
    assert.equal(entry.packetHash, submission.packetHash);
    assert.match(String(entry.submissionHash), /^[0-9a-f]{64}$/);
  }
});

test('provenance survives a write-and-reread round trip, so it is actually persisted', () => {
  const benchmarkCase = caseWithRoster(DECLARED);
  const result = mergeSubmission(benchmarkCase, submissionFor(benchmarkCase));
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const reread = JSON.parse(normaliseCase(result.case)) as BenchmarkCase;
  const entry = reread.reviewerLabels.find((label) => label.reviewer === 'erin');
  assert.ok(entry, 'the merged reviewer is still named after the round trip');
  assert.match(String(entry?.rationale), /^Reviewer rationale/);
  assert.equal(entry?.submittedAt, '2026-11-05T09:00:00.000Z');
  assert.equal(typeof entry?.packetHash, 'string');
  assert.equal(typeof entry?.submissionHash, 'string');
});

test('a merged case passes the real corpus validator, which v0.6 could not claim', () => {
  const benchmarkCase = caseWithRoster(DECLARED);
  const result = mergeSubmission(benchmarkCase, submissionFor(benchmarkCase));
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(validateBenchmarkCase(JSON.parse(normaliseCase(result.case)), 0), []);
});

test('gold labels and other reviewers are never edited, and the input case is not mutated', () => {
  const benchmarkCase = caseWithRoster(DECLARED, [
    labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'PARTIALLY_SUPPORTED'),
  ]);
  const before = JSON.stringify(benchmarkCase);
  const result = mergeSubmission(benchmarkCase, submissionFor(benchmarkCase));
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(JSON.stringify(benchmarkCase), before, 'the caller’s case object is untouched');
  assert.equal(result.case.expected, benchmarkCase.expected);
  const dana = result.case.reviewerLabels.find((entry) => entry.reviewer === 'dana');
  assert.equal(dana?.label, 'PARTIALLY_SUPPORTED');
  assert.equal(result.case.reviewerLabels.length, 5);
});

test('a v1 submission keeps its lenient timestamp rule and is stored verbatim', () => {
  const benchmarkCase = caseWithRoster(DECLARED);
  const result = mergeSubmission(
    benchmarkCase,
    submissionFor(benchmarkCase, { version: SUBMISSION_VERSION, submittedAt: '2026-11-05' }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  const entry = result.case.reviewerLabels.find((label) => label.reviewer === 'erin');
  assert.equal(entry?.submittedAt, '2026-11-05', 'recorded as supplied, not rewritten');
});

test('a v2 submission must carry a real instant, and a date alone is refused', () => {
  const benchmarkCase = caseWithRoster(DECLARED);
  const result = mergeSubmission(
    benchmarkCase,
    submissionFor(benchmarkCase, { submittedAt: '2026-11-05' }),
  );
  assert.equal(result.ok, false);
  assert.ok(
    !result.ok && result.reasons.some((reason) => /ISO 8601|timezone/i.test(reason)),
    `expected a timestamp reason, got: ${String(!result.ok && result.reasons)}`,
  );
});

test('a v2 timestamp is normalised to UTC, so two offsets for one instant agree', () => {
  const benchmarkCase = caseWithRoster(DECLARED);
  const utc = mergeSubmission(
    benchmarkCase,
    submissionFor(benchmarkCase, { submittedAt: '2026-11-05T09:00:00Z' }),
  );
  const offset = mergeSubmission(
    caseWithRoster(DECLARED),
    submissionFor(caseWithRoster(DECLARED), { submittedAt: '2026-11-05T14:30:00+05:30' }),
  );
  assert.equal(utc.ok, true);
  assert.equal(offset.ok, true);
  if (!utc.ok || !offset.ok) {
    return;
  }
  const first = utc.case.reviewerLabels.find((label) => label.reviewer === 'erin');
  const second = offset.case.reviewerLabels.find((label) => label.reviewer === 'erin');
  assert.equal(first?.submittedAt, '2026-11-05T09:00:00.000Z');
  assert.equal(second?.submittedAt, first?.submittedAt);
});

test('a blank or absent timestamp is refused in both versions rather than filled from a clock', () => {
  const benchmarkCase = caseWithRoster(DECLARED);
  for (const version of [SUBMISSION_VERSION, SUBMISSION_VERSION_V2]) {
    assert.equal(
      mergeSubmission(benchmarkCase, submissionFor(benchmarkCase, { version, submittedAt: '   ' }))
        .ok,
      false,
      `${version} must refuse a blank timestamp`,
    );
  }
});

test('an unsupported submission version is refused', () => {
  const benchmarkCase = caseWithRoster(DECLARED);
  const result = mergeSubmission(
    benchmarkCase,
    submissionFor(benchmarkCase, { version: 'benchmark-submission-v3' }),
  );
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reasons.some((reason) => /version/i.test(reason)));
});

test('a reviewer outside the declared roster is refused and the case is left untouched', () => {
  const benchmarkCase = caseWithRoster(['dana']);
  const before = JSON.stringify(benchmarkCase);
  const result = mergeSubmission(benchmarkCase, submissionFor(benchmarkCase));
  assert.equal(result.ok, false);
  assert.ok(
    !result.ok && result.reasons.some((reason) => /provenance\.reviewedBy/.test(reason)),
    'the refusal must name the roster the operator has to edit',
  );
  assert.ok(
    !result.ok && result.reasons.some((reason) => /authoris/i.test(reason)),
    'the refusal must say authorisation is a human decision',
  );
  assert.equal(JSON.stringify(benchmarkCase), before);
  assert.deepEqual(benchmarkCase.provenance.reviewedBy, ['dana'], 'the roster is not widened');
});

test('an empty roster authorises nobody, so the first reviewer is never chosen by the tool', () => {
  const benchmarkCase = caseWithRoster([]);
  const result = mergeSubmission(benchmarkCase, submissionFor(benchmarkCase));
  assert.equal(result.ok, false);
  assert.ok(
    !result.ok && result.reasons.some((reason) => /no reviewer is declared/i.test(reason)),
    `expected an empty-roster reason, got: ${String(!result.ok && result.reasons)}`,
  );
});

test('a declared reviewer is accepted whatever the recorded spelling is', () => {
  const benchmarkCase = caseWithRoster(['Dana Lee', 'erin']);
  const result = mergeSubmission(
    benchmarkCase,
    submissionFor(benchmarkCase, { reviewer: '  DANA  LEE ' }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  // Stored canonically, so a later duplicate check recognises the same person.
  assert.ok(result.case.reviewerLabels.every((label) => label.reviewer === 'dana lee'));
});

test('one person cannot submit twice by changing capitalisation', () => {
  const benchmarkCase = caseWithRoster(DECLARED, [
    labelFor('Dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
  ]);
  const result = mergeSubmission(
    benchmarkCase,
    submissionFor(benchmarkCase, { reviewer: '  DANA  ' }),
  );
  assert.equal(result.ok, false);
  assert.ok(
    !result.ok && result.reasons.some((reason) => /duplicate/i.test(reason)),
    `expected a duplicate reason, got: ${String(!result.ok && result.reasons)}`,
  );
});

test('a reviewer already applied earlier in the same batch is a duplicate by identity', () => {
  const benchmarkCase = caseWithRoster(DECLARED);
  const result = mergeSubmission(benchmarkCase, submissionFor(benchmarkCase), [' ERIN ']);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reasons.some((reason) => /duplicate/i.test(reason)));
});

test('a rejected submission reports every reason at once and changes nothing', () => {
  const benchmarkCase = caseWithRoster(['dana']);
  const submission = submissionFor(benchmarkCase, {
    caseId: 'another-case',
    reviewer: 'sam',
    submittedAt: '',
  });
  const result = mergeSubmission(benchmarkCase, submission);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.reasons.length >= 3,
      'a compound problem is reported in full, not one at a time',
    );
  }
});

test('the stale-hash, unknown-subject and out-of-vocabulary refusals from v0.6 still hold', () => {
  const benchmarkCase = caseWithRoster(DECLARED);
  const stalePacket = submissionFor(benchmarkCase, { packetHash: 'f'.repeat(64) });
  assert.equal(mergeSubmission(benchmarkCase, stalePacket).ok, false);

  const movedInput = fixtureCase({
    reviewedBy: DECLARED,
    answerText: 'A different answer after the packet was issued.',
  });
  assert.equal(mergeSubmission(movedInput, submissionFor(benchmarkCase)).ok, false);

  const base = submissionFor(benchmarkCase);
  const badLabel = submissionFor(benchmarkCase, {
    annotations: base.annotations.map((annotation) =>
      annotation.dimension === 'EVIDENCE_SUPPORT'
        ? { ...annotation, label: 'DEFINITELY_TRUE' }
        : annotation,
    ),
  });
  assert.equal(mergeSubmission(benchmarkCase, badLabel).ok, false);

  const ghostSubject = submissionFor(benchmarkCase, {
    annotations: base.annotations.map((annotation) =>
      annotation.dimension === 'ATTRIBUTION' ? { ...annotation, subjectId: 'nope' } : annotation,
    ),
  });
  assert.equal(mergeSubmission(benchmarkCase, ghostSubject).ok, false);

  const noRationale = submissionFor(benchmarkCase, {
    annotations: base.annotations.map((annotation, index) =>
      index === 0 ? { ...annotation, rationale: '   ' } : annotation,
    ),
  });
  assert.equal(mergeSubmission(benchmarkCase, noRationale).ok, false);

  const missingSubject = submissionFor(benchmarkCase, {
    annotations: base.annotations.slice(0, 2),
  });
  assert.equal(mergeSubmission(benchmarkCase, missingSubject).ok, false);
});
