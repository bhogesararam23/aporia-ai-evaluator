import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildReviewerPacket,
  mergeSubmission,
  SUBMISSION_VERSION,
  type AnnotationSubmission,
} from '../../src/benchmark/review.ts';
import { BENCHMARK_CASE_VERSION, type BenchmarkCase } from '../../src/benchmark/types.ts';

function fixtureCase(): BenchmarkCase {
  return {
    version: BENCHMARK_CASE_VERSION,
    id: 'case-merge',
    stratum: 'REFUSAL_NOT_A_DENIAL',
    title: 'Case',
    provenance: {
      origin: 'Synthetic fixture.',
      authorizedForStorage: true,
      // v0.7 enforces the declared roster at merge, so the submitting reviewer must be declared here.
      // The undeclared-reviewer refusal is covered in benchmark-review-merge-provenance.test.ts.
      reviewedBy: ['dana', 'sam'],
      reviewedAt: '2026-11-05',
      unverified: [],
      limitation: 'Fixture only.',
    },
    input: {
      claimText: 'A fixed claim.',
      propositions: [
        {
          id: 'p1',
          text: 'The proposition.',
          evidence: [
            {
              id: 'e1',
              relation: 'SUPPORTS',
              sourceId: 's1',
              sourceType: 'PRIMARY_ARTIFACT',
              independence: 'INDEPENDENT',
              locator: 'sec 1',
            },
          ],
        },
      ],
      answerText: 'I cannot answer that.',
      citationCapture: 'NOT_SHOWN',
      citations: [],
      statements: [
        {
          id: 'st1',
          text: 'I cannot answer that.',
          relevance: 'REFUSAL',
          propositionIds: ['p1'],
          citationIds: [],
        },
      ],
      providerLabel: 'Fixture',
      locale: 'en',
    },
    expected: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        rationale: 'r',
        subjectId: 'p1',
      },
    ],
    reviewerLabels: [
      {
        reviewer: 'dana',
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        subjectId: 'p1',
        note: null,
      },
    ],
    adjudications: [],
    limitations: ['fixture'],
  };
}

function submissionFor(
  benchmarkCase: BenchmarkCase,
  overrides: Partial<AnnotationSubmission> = {},
): AnnotationSubmission {
  const packet = buildReviewerPacket(benchmarkCase);
  return {
    version: SUBMISSION_VERSION,
    caseId: packet.caseId,
    packetHash: packet.packetHash,
    reviewer: 'sam',
    submittedAt: '2026-11-05T09:00:00Z',
    annotations: packet.subjects.map((subject, index) => ({
      dimension: subject.dimension,
      subjectId: subject.subjectId,
      label: subject.dimension === 'EVIDENCE_SUPPORT' ? 'SUPPORTED_WITHIN_SCOPE' : 'NOT_ASSESSABLE',
      rationale: `Rationale ${String(index)}.`,
    })),
    ...overrides,
  };
}

test('a valid submission appends reviewer labels and never touches gold or existing labels', () => {
  const benchmarkCase = fixtureCase();
  const result = mergeSubmission(benchmarkCase, submissionFor(benchmarkCase));
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  // one existing (dana) + four subjects from sam.
  assert.equal(result.case.reviewerLabels.length, 5);
  const samLabels = result.case.reviewerLabels.filter((label) => label.reviewer === 'sam');
  assert.equal(samLabels.length, 4);
  // The gold array and dana's label are preserved untouched.
  assert.equal(result.case.expected, benchmarkCase.expected);
  assert.ok(result.case.reviewerLabels.some((label) => label.reviewer === 'dana'));
});

test('a submission against a changed (stale-hashed) input is rejected', () => {
  const benchmarkCase = fixtureCase();
  const good = submissionFor(benchmarkCase);
  // The case input mutates after the packet was issued, so the hash no longer matches.
  const movedCase: BenchmarkCase = {
    ...fixtureCase(),
    input: { ...fixtureCase().input, answerText: 'Now the answer is different.' },
  };
  const result = mergeSubmission(movedCase, good);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reasons.some((reason) => /stale|hash/i.test(reason)));
});

test('a submission for a different case is rejected', () => {
  const benchmarkCase = fixtureCase();
  const submission = submissionFor(benchmarkCase, { caseId: 'some-other-case' });
  const result = mergeSubmission(benchmarkCase, submission);
  assert.equal(result.ok, false);
  assert.ok(
    !result.ok &&
      result.reasons.some((reason) => /case id|does not match|unknown case/i.test(reason)),
  );
});

test('a second submission from the same reviewer is rejected as duplicate', () => {
  const benchmarkCase = fixtureCase();
  const result = mergeSubmission(benchmarkCase, submissionFor(benchmarkCase), ['sam']);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reasons.some((reason) => /duplicate/i.test(reason)));
});

test('an out-of-vocabulary label, an unknown subject, or a blank rationale rejects the whole submission', () => {
  const benchmarkCase = fixtureCase();
  const base = submissionFor(benchmarkCase);

  const badLabel = submissionFor(benchmarkCase, {
    annotations: base.annotations.map((annotation) =>
      annotation.dimension === 'EVIDENCE_SUPPORT'
        ? { ...annotation, label: 'DEFS_NOT_A_STATUS' }
        : annotation,
    ),
  });
  assert.equal(mergeSubmission(benchmarkCase, badLabel).ok, false);

  const unknownSubject = submissionFor(benchmarkCase, {
    annotations: base.annotations.map((annotation) =>
      annotation.dimension === 'ATTRIBUTION' ? { ...annotation, subjectId: 'ghost' } : annotation,
    ),
  });
  const unknownResult = mergeSubmission(benchmarkCase, unknownSubject);
  assert.equal(unknownResult.ok, false);
  assert.ok(
    !unknownResult.ok &&
      unknownResult.reasons.some((reason) => /unknown|not a subject/i.test(reason)),
  );

  const blankRationale = submissionFor(benchmarkCase, {
    annotations: base.annotations.map((annotation, index) =>
      index === 0 ? { ...annotation, rationale: '   ' } : annotation,
    ),
  });
  assert.equal(mergeSubmission(benchmarkCase, blankRationale).ok, false);
});

test('an empty reviewer or timestamp is rejected, not silently filled in', () => {
  const benchmarkCase = fixtureCase();
  assert.equal(
    mergeSubmission(benchmarkCase, submissionFor(benchmarkCase, { reviewer: '  ' })).ok,
    false,
  );
  assert.equal(
    mergeSubmission(benchmarkCase, submissionFor(benchmarkCase, { submittedAt: '' })).ok,
    false,
  );
});

test('a rejected submission leaves the case byte-identical (all-or-nothing)', () => {
  const benchmarkCase = fixtureCase();
  const before = JSON.stringify(benchmarkCase);
  const result = mergeSubmission(benchmarkCase, submissionFor(benchmarkCase, { reviewer: '' }));
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(benchmarkCase), before, 'the input case is never mutated');
});
