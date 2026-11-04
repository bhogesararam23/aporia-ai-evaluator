import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewerLabelFromAnnotation, submissionHash } from '../../src/benchmark/provenance.ts';
import {
  BENCHMARK_SUBMISSION_VERSION_V2,
  type AnnotationSubmission,
} from '../../src/benchmark/types.ts';

/**
 * The provenance a merged label must carry (ADR-027, defects 1 and 2).
 *
 * v0.6 required a rationale, a reviewer and a timestamp and then wrote `note: null`, so the human work was
 * validated and thrown away, and a merged case could not say when a reviewer submitted or which frozen input
 * their judgement was bound to. These tests pin that nothing supplied by the reviewer is lost.
 */

const PACKET = 'a'.repeat(64);

function submission(overrides: Partial<AnnotationSubmission> = {}): AnnotationSubmission {
  return {
    version: BENCHMARK_SUBMISSION_VERSION_V2,
    caseId: 'case-fixture',
    packetHash: PACKET,
    reviewer: 'dana',
    submittedAt: '2026-11-05T09:00:00Z',
    annotations: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        subjectId: 'p1',
        label: 'SUPPORTED_WITHIN_SCOPE',
        rationale: 'The primary artifact states the date directly, in its own words.',
      },
    ],
    ...overrides,
  };
}

test('submissionHash is stable for the same record regardless of key order', () => {
  const record = submission();
  const reshaped = JSON.parse(
    JSON.stringify({
      annotations: record.annotations,
      submittedAt: record.submittedAt,
      reviewer: record.reviewer,
      packetHash: record.packetHash,
      caseId: record.caseId,
      version: record.version,
    }),
  ) as AnnotationSubmission;
  assert.equal(submissionHash(record), submissionHash(reshaped));
});

test('submissionHash changes when the reviewer edits a rationale', () => {
  const before = submission();
  const after = submission({
    annotations: [{ ...before.annotations[0]!, rationale: 'Changed my mind after rereading it.' }],
  });
  assert.notEqual(submissionHash(before), submissionHash(after));
});

test('submissionHash changes when annotation order changes, because order is content', () => {
  const one = submission({
    annotations: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        subjectId: 'p1',
        label: 'SUPPORTED_WITHIN_SCOPE',
        rationale: 'first',
      },
      {
        dimension: 'ANSWER_FIDELITY',
        subjectId: 'st1',
        label: 'NOT_ASSESSABLE',
        rationale: 'second',
      },
    ],
  });
  const two = submission({ annotations: [...one.annotations].reverse() });
  assert.notEqual(submissionHash(one), submissionHash(two));
});

test('a constructed label keeps rationale, timestamp, packet hash and submission hash', () => {
  const record = submission();
  const label = reviewerLabelFromAnnotation(record.annotations[0]!, {
    reviewerKey: 'dana',
    submittedAt: record.submittedAt,
    packetHash: record.packetHash,
    submissionHash: submissionHash(record),
  });
  assert.equal(label.rationale, 'The primary artifact states the date directly, in its own words.');
  assert.equal(label.submittedAt, '2026-11-05T09:00:00Z');
  assert.equal(label.packetHash, PACKET);
  assert.equal(label.submissionHash, submissionHash(record));
  assert.equal(label.reviewer, 'dana');
  // `note` keeps its v0.6 meaning as the free-form slot and is not overloaded with the rationale.
  assert.equal(label.note, null);
});

test('the rationale survives with its punctuation, unicode and length intact', () => {
  const tricky = 'Says “two copies” — one source: see érik’s note ✓ and a very long tail '.repeat(
    4,
  );
  const label = reviewerLabelFromAnnotation(
    {
      dimension: 'CITATION_SUPPORT',
      subjectId: 'st1',
      label: 'NOT_ASSESSABLE',
      rationale: tricky,
    },
    { reviewerKey: 'dana', submittedAt: 'x', packetHash: PACKET, submissionHash: 'y' },
  );
  assert.equal(label.rationale, tricky);
});

test('a reviewer identity, not the raw spelling, is what the label records', () => {
  const label = reviewerLabelFromAnnotation(
    {
      dimension: 'ATTRIBUTION',
      subjectId: 'st1',
      label: 'NOT_ASSESSABLE',
      rationale: 'Nothing is attributed.',
    },
    {
      reviewerKey: '  Dana Lee  '.toLowerCase(),
      submittedAt: '2026-11-05T09:00:00Z',
      packetHash: PACKET,
      submissionHash: 'b'.repeat(64),
    },
  );
  assert.equal(label.reviewer, 'dana lee');
  // The rationale comes from the annotation, the one place it exists.
  assert.equal(label.rationale, 'Nothing is attributed.');
});
