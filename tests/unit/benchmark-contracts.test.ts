import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BENCHMARK_ADJUDICATION_VERSION,
  BENCHMARK_ADJUDICATION_VERSION_V2,
  BENCHMARK_BATCH_JOURNAL_VERSION,
  BENCHMARK_RELEASE_MANIFEST_VERSION,
  BENCHMARK_SUBMISSION_VERSION,
  BENCHMARK_SUBMISSION_VERSION_V2,
  KNOWN_BENCHMARK_REVIEW_ARTIFACT_VERSIONS,
  type AnnotationSubmission,
  type BenchmarkAdjudication,
  type BenchmarkReviewerLabel,
  type SubmissionAnnotation,
} from '../../src/benchmark/types.ts';
import * as review from '../../src/benchmark/review.ts';

/**
 * The v0.7 artifact versions and the additive case-contract fields.
 *
 * These are the compatibility anchors for the whole milestone: the new review-provenance fields must be
 * optional (so every `benchmark-case-v1`/`v2` file written before v0.7 still reads), and the new artifact
 * versions must be distinct from the case contract (so a packet or submission change never implies a
 * corpus migration). A type assertion in this file is part of the test: `npm run typecheck` fails if a
 * field is required rather than optional, which is exactly the break we must not ship.
 */

test('the v0.7 artifact versions exist and are listed as known review artifact versions', () => {
  assert.equal(BENCHMARK_SUBMISSION_VERSION, 'benchmark-submission-v1');
  assert.equal(BENCHMARK_SUBMISSION_VERSION_V2, 'benchmark-submission-v2');
  assert.equal(BENCHMARK_ADJUDICATION_VERSION, 'benchmark-adjudication-v1');
  assert.equal(BENCHMARK_ADJUDICATION_VERSION_V2, 'benchmark-adjudication-v2');
  assert.equal(BENCHMARK_RELEASE_MANIFEST_VERSION, 'benchmark-release-manifest-v1');
  assert.equal(BENCHMARK_BATCH_JOURNAL_VERSION, 'benchmark-batch-journal-v1');
  for (const version of [
    BENCHMARK_SUBMISSION_VERSION,
    BENCHMARK_SUBMISSION_VERSION_V2,
    BENCHMARK_ADJUDICATION_VERSION,
    BENCHMARK_ADJUDICATION_VERSION_V2,
  ]) {
    assert.ok(
      (KNOWN_BENCHMARK_REVIEW_ARTIFACT_VERSIONS as readonly string[]).includes(version),
      `${version} is not declared as a known review artifact version`,
    );
  }
});

test('a reviewer label with no provenance fields still compiles, so older cases read unchanged', () => {
  // This is the compatibility assertion: every new field is optional.
  const legacy: BenchmarkReviewerLabel = {
    reviewer: 'dana',
    dimension: 'EVIDENCE_SUPPORT',
    label: 'SUPPORTED_WITHIN_SCOPE',
    subjectId: 'p1',
    note: null,
  };
  const enriched: BenchmarkReviewerLabel = {
    ...legacy,
    rationale: 'The primary artifact states it directly.',
    submittedAt: '2026-11-05T09:00:00Z',
    packetHash: 'a'.repeat(64),
    submissionHash: 'b'.repeat(64),
  };
  assert.equal(legacy.rationale, undefined);
  assert.equal(enriched.rationale, 'The primary artifact states it directly.');
  assert.equal(enriched.submittedAt, '2026-11-05T09:00:00Z');
});

test('an adjudication without a binding still compiles, and a bound one records the state hash', () => {
  const unbound: BenchmarkAdjudication = {
    dimension: 'EVIDENCE_SUPPORT',
    subjectId: 'p1',
    outcome: 'RESOLVED',
    label: 'SUPPORTED_WITHIN_SCOPE',
    reason: 'One record supports, the other is silent.',
    adjudicatedBy: 'erin',
  };
  const bound: BenchmarkAdjudication = {
    ...unbound,
    disagreementHash: 'c'.repeat(64),
    adjudicatedAt: '2026-11-05T10:00:00Z',
  };
  assert.equal(unbound.disagreementHash, undefined);
  assert.equal(bound.disagreementHash, 'c'.repeat(64));
});

test('the submission contract moved to types.ts and is still re-exported from review.ts', () => {
  const annotation: SubmissionAnnotation = {
    dimension: 'EVIDENCE_SUPPORT',
    subjectId: 'p1',
    label: 'SUPPORTED_WITHIN_SCOPE',
    rationale: 'Because the recorded evidence supports it.',
  };
  const submission: AnnotationSubmission = {
    version: BENCHMARK_SUBMISSION_VERSION_V2,
    caseId: 'case-1',
    packetHash: 'd'.repeat(64),
    reviewer: 'dana',
    submittedAt: '2026-11-05T09:00:00Z',
    annotations: [annotation],
  };
  assert.equal(submission.annotations.length, 1);
  // Every importer that existed before this move keeps working.
  assert.equal(typeof review.mergeSubmission, 'function');
  assert.equal(typeof review.contentHash, 'function');
  assert.equal(review.SUBMISSION_VERSION, BENCHMARK_SUBMISSION_VERSION);
});
