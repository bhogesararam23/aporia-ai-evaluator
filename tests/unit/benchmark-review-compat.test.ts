import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildReviewerPacket,
  buildSubmissionTemplate,
  mergeSubmission,
  SUBMISSION_VERSION,
} from '../../src/benchmark/review.ts';
import { validateBenchmarkCorpus } from '../../src/benchmark/validate.ts';
import {
  BENCHMARK_CASE_VERSION,
  BENCHMARK_CASE_VERSION_V1,
  type BenchmarkCase,
} from '../../src/benchmark/types.ts';

/**
 * A valid case for a given contract version. v2 requires an underlying `sourceId`; v1 omits it (the
 * evidence id stands in). Everything else is identical, so the pair isolates the version difference.
 */
function caseForVersion(version: string): BenchmarkCase {
  const evidence: Record<string, unknown> = {
    id: 'ev-1',
    relation: 'SUPPORTS',
    sourceType: 'PRIMARY_ARTIFACT',
    independence: 'INDEPENDENT',
    locator: 'section 1',
  };
  if (version === BENCHMARK_CASE_VERSION) {
    evidence['sourceId'] = 'src-1';
  }
  return {
    version,
    id: `case-${version}`,
    stratum: 'SUPPORTED_PRIMARY_EVIDENCE',
    title: 'Compatibility fixture',
    provenance: {
      origin: 'Synthetic compatibility fixture. Not a gold case.',
      authorizedForStorage: true,
      reviewedBy: ['dana', 'sam'],
      reviewedAt: '2026-11-04',
      unverified: [],
      limitation: 'Fixture only.',
    },
    input: {
      claimText: 'A fixture claim that is long enough.',
      propositions: [{ id: 'prop-1', text: 'A fixture proposition.', evidence: [evidence] }],
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
  } as unknown as BenchmarkCase;
}

function submissionFor(
  benchmarkCase: BenchmarkCase,
  reviewer: string,
): ReturnType<typeof buildSubmissionTemplate> {
  const template = buildSubmissionTemplate(buildReviewerPacket(benchmarkCase));
  return {
    ...template,
    // Pinned to v1 deliberately: this test's whole point is that a submission file written under v0.6 —
    // including its date-only timestamp — still merges. Inheriting the current template default would
    // silently stop covering the older artifact.
    version: SUBMISSION_VERSION,
    reviewer,
    submittedAt: '2026-11-05',
    annotations: template.annotations.map((annotation) => ({
      ...annotation,
      label: 'SUPPORTED_WITHIN_SCOPE',
      rationale: `Recorded by ${reviewer} from the frozen input only.`,
    })),
  };
}

test('both benchmark-case-v1 and v2 still validate, and the review workflow reads both', () => {
  const v1 = caseForVersion(BENCHMARK_CASE_VERSION_V1);
  const v2 = caseForVersion(BENCHMARK_CASE_VERSION);
  const corpus = validateBenchmarkCorpus([
    { index: 0, value: v1 },
    { index: 1, value: v2 },
  ]);
  assert.equal(corpus.issues.length, 0, `expected clean validation, got: ${corpus.issues}`);
  assert.equal(corpus.cases.length, 2, 'both accepted case-contract versions are readable');

  for (const benchmarkCase of [v1, v2]) {
    const packet = buildReviewerPacket(benchmarkCase);
    // Blinding holds for both: no gold/annotation/output field is present in the packet.
    const packetRecord = packet as unknown as Record<string, unknown>;
    for (const forbidden of [
      'expected',
      'reviewerLabels',
      'adjudications',
      'provenance',
      'stratum',
    ]) {
      assert.ok(
        !(forbidden in packetRecord),
        `a ${benchmarkCase.version} packet must not leak ${forbidden}`,
      );
    }
    const submission = submissionFor(benchmarkCase, 'dana');
    assert.equal(
      submission.version,
      SUBMISSION_VERSION,
      'a v0.6 submission artifact is what is being read here',
    );
    const merged = mergeSubmission(benchmarkCase, submission);
    assert.equal(merged.ok, true, `merge must accept a valid ${benchmarkCase.version} submission`);
    if (merged.ok) {
      // The merged case keeps its own contract version (no silent upgrade) and still validates.
      assert.equal(merged.case.version, benchmarkCase.version);
      assert.equal(merged.case.expected.length, 1, 'gold labels are preserved, not edited');
      assert.equal(merged.case.reviewerLabels.length, 1);
      const revalidated = validateBenchmarkCorpus([{ index: 0, value: merged.case }]);
      assert.equal(
        revalidated.issues.length,
        0,
        `merged ${benchmarkCase.version} case must still validate`,
      );
    }
  }
});
