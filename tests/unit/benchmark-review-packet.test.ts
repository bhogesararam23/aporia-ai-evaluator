import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildReviewerPacket,
  buildSubmissionTemplate,
  contentHash,
  REVIEW_PACKET_VERSION,
  SUBMISSION_VERSION,
} from '../../src/benchmark/review.ts';
import { BENCHMARK_CASE_VERSION, type BenchmarkCase } from '../../src/benchmark/types.ts';

/**
 * A reviewer packet is what an annotator is shown: the frozen input and the list of subjects to
 * judge — and nothing that could anchor them. So it must carry no gold label, no existing reviewer
 * annotation, and no evaluator output, and it must be bound to the exact input by a stable hash.
 */

function fixtureCase(): BenchmarkCase {
  return {
    version: BENCHMARK_CASE_VERSION,
    id: 'case-packet',
    stratum: 'REFUSAL_NOT_A_DENIAL',
    title: 'A refusal that is not a denial',
    provenance: {
      origin: 'Synthetic fixture. Not a gold case.',
      authorizedForStorage: true,
      reviewedBy: ['dana'],
      reviewedAt: '2026-11-05',
      unverified: [],
      limitation: 'Fixture only.',
    },
    input: {
      claimText: 'A fixed claim about the fixture.',
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
    // Gold + existing annotations + adjudication: all must be blinded out of the packet.
    expected: [
      {
        dimension: 'ANSWER_FIDELITY',
        label: 'NOT_ADDRESSED',
        rationale: 'A refusal is not a denial.',
        subjectId: 'st1',
      },
    ],
    reviewerLabels: [
      {
        reviewer: 'dana',
        dimension: 'ANSWER_FIDELITY',
        label: 'NOT_ADDRESSED',
        subjectId: 'st1',
        note: null,
      },
    ],
    adjudications: [],
    limitations: ['fixture'],
  };
}

test('contentHash is stable and independent of key order', () => {
  const a = contentHash({ x: 1, y: { p: 2, q: 3 } });
  const b = contentHash({ y: { q: 3, p: 2 }, x: 1 });
  assert.equal(a, b, 'sorted-key canonicalisation makes the hash order-independent');
  assert.notEqual(contentHash({ x: 1 }), contentHash({ x: 2 }), 'different content differs');
});

test('a reviewer packet carries the input and subjects but not gold, annotations or adjudications', () => {
  const packet = buildReviewerPacket(fixtureCase());
  assert.equal(packet.version, REVIEW_PACKET_VERSION);
  assert.equal(packet.caseId, 'case-packet');
  const serialised = JSON.stringify(packet);
  // The gold label value and the existing annotation must not leak to the reviewer.
  assert.doesNotMatch(serialised, /NOT_ADDRESSED/, 'gold/annotation label must be blinded');
  assert.doesNotMatch(serialised, /"expected"/, 'no gold label array in the packet');
  assert.doesNotMatch(serialised, /"reviewerLabels"/, 'no existing annotations in the packet');
  assert.doesNotMatch(serialised, /A refusal is not a denial/, 'no gold rationale leak');
});

test('a packet lists exactly the subjects derived from the input, per dimension kind', () => {
  const packet = buildReviewerPacket(fixtureCase());
  const keys = packet.subjects.map((subject) => `${subject.dimension}/${subject.subjectId}`).sort();
  assert.deepEqual(keys, [
    'ANSWER_FIDELITY/st1',
    'ATTRIBUTION/st1',
    'CITATION_SUPPORT/st1',
    'EVIDENCE_SUPPORT/p1',
  ]);
});

test('the packet hash binds the frozen input and changes when the input changes', () => {
  const before = buildReviewerPacket(fixtureCase());
  const mutated = fixtureCase();
  mutated.input.answerText = 'A totally different answer.';
  const after = buildReviewerPacket(mutated);
  assert.notEqual(before.packetHash, after.packetHash, 'a changed input pack yields a new hash');
});

test('a submission template mirrors the packet subjects with nothing pre-filled', () => {
  const packet = buildReviewerPacket(fixtureCase());
  const template = buildSubmissionTemplate(packet);
  assert.equal(template.version, SUBMISSION_VERSION);
  assert.equal(template.caseId, packet.caseId);
  assert.equal(template.packetHash, packet.packetHash);
  assert.equal(
    template.reviewer,
    '',
    'the reviewer identity is supplied by the human, never invented',
  );
  assert.equal(template.submittedAt, '', 'the timestamp is the reviewer’s, not a fabrication');
  assert.equal(template.annotations.length, packet.subjects.length);
  for (const annotation of template.annotations) {
    assert.equal(annotation.label, '', 'no label is pre-filled');
    assert.equal(annotation.rationale, '', 'no rationale is pre-filled');
  }
});
