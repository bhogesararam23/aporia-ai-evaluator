import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveEvidenceStatus, type EvidenceRelationshipRecord } from '../../src/core/evidence.ts';
import { regressionResults, toRelationships } from '../../src/benchmark/regression.ts';
import { validateBenchmarkCase } from '../../src/benchmark/validate.ts';
import {
  BENCHMARK_CASE_VERSION,
  BENCHMARK_CASE_VERSION_V1,
  type BenchmarkCase,
} from '../../src/benchmark/types.ts';

/**
 * Source identity is the difference between corroboration and repetition.
 *
 * `DUPLICATE_OR_SYNDICATED_SOURCES` is a required benchmark stratum. Under `benchmark-case-v1` the
 * contract could not express it: the evidence relationship id doubled as the source id, so four
 * excerpts of one press release were four sources, the anti-corroboration branch in
 * `deriveEvidenceStatus` was unreachable from a benchmark case, and the stratum could only ever be
 * filled by a case that did not exercise what its name claims. These tests pin the v2 behaviour, and
 * state the one thing v1 still cannot say.
 */

const SUPPORTING_NOTE =
  /Duplicate or syndicated material does not create independent corroboration/;

function evidence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ev-1',
    relation: 'SUPPORTS',
    sourceId: 'src-1',
    sourceType: 'PRIMARY_ARTIFACT',
    independence: 'INDEPENDENT',
    locator: 'section 1',
    ...overrides,
  };
}

function caseWithEvidence(
  records: readonly Record<string, unknown>[],
  version: string = BENCHMARK_CASE_VERSION,
): BenchmarkCase {
  return {
    version,
    id: 'case-source-identity',
    stratum: 'DUPLICATE_OR_SYNDICATED_SOURCES',
    title: 'Source identity fixture',
    provenance: {
      origin: 'Synthetic fixture for source-identity tests. Not a gold case.',
      authorizedForStorage: true,
      reviewedBy: ['reviewer-a'],
      reviewedAt: '2026-11-02',
      unverified: [],
      limitation: 'This fixture asserts no real fact.',
    },
    input: {
      claimText: 'A fixture claim long enough to pass.',
      propositions: [{ id: 'prop-1', text: 'A fixture proposition.', evidence: [...records] }],
      answerText: 'A fixture answer.',
      citationCapture: 'CAPTURED',
      citations: [],
      statements: [],
      providerLabel: 'Fixture',
      locale: 'en',
    },
    expected: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        rationale: 'Supporting relationships were recorded.',
        subjectId: 'prop-1',
      },
    ],
    reviewerLabels: [],
    adjudications: [],
    limitations: ['Synthetic fixture only.'],
  } as unknown as BenchmarkCase;
}

function relationshipsOf(
  records: readonly Record<string, unknown>[],
): EvidenceRelationshipRecord[] {
  const mapped = toRelationships(caseWithEvidence(records), 'prop-1');
  const result = mapped?.relationships ?? [];
  assert.equal(mapped?.unusable.length, 0, 'every fixture record is in vocabulary');
  return result;
}

test('four excerpts from one source are one source, and the rule says so', () => {
  const status = deriveEvidenceStatus(
    relationshipsOf([
      evidence({ id: 'ev-1' }),
      evidence({ id: 'ev-2' }),
      evidence({ id: 'ev-3' }),
      evidence({ id: 'ev-4' }),
    ]),
  );
  assert.equal(status.status, 'SUPPORTED_WITHIN_SCOPE');
  assert.equal(status.supportingSourceCount, 1, 'four relationships, one underlying source');
  assert.match(status.notes.join(' '), SUPPORTING_NOTE);
});

test('four genuinely distinct sources are four sources', () => {
  const status = deriveEvidenceStatus(
    relationshipsOf([
      evidence({ id: 'ev-1', sourceId: 'src-1' }),
      evidence({ id: 'ev-2', sourceId: 'src-2' }),
      evidence({ id: 'ev-3', sourceId: 'src-3' }),
      evidence({ id: 'ev-4', sourceId: 'src-4' }),
    ]),
  );
  assert.equal(status.supportingSourceCount, 4);
  assert.doesNotMatch(
    status.notes.join(' '),
    SUPPORTING_NOTE,
    'independent corroboration is not a repetition',
  );
});

test('a mixed corpus of duplicates and one independent source still counts honestly', () => {
  const status = deriveEvidenceStatus(
    relationshipsOf([
      evidence({ id: 'ev-1', sourceId: 'src-1' }),
      evidence({ id: 'ev-2', sourceId: 'src-1' }),
      evidence({ id: 'ev-3', sourceId: 'src-2' }),
    ]),
  );
  assert.equal(status.supportingSourceCount, 2);
  // Three supporting relationships, two sources: the note is the rule's own signal that repetition
  // was recorded, not a judgement the reviewer has to remember to make.
  assert.match(status.notes.join(' '), SUPPORTING_NOTE);
});

test('a v1 case cannot express this stratum, and the harness says so instead of pretending', () => {
  // Same relationship ids the reviewer meant as one source, with no sourceId field to carry it.
  const legacy = caseWithEvidence(
    [
      {
        id: 'ev-1',
        relation: 'SUPPORTS',
        sourceType: 'PRIMARY_ARTIFACT',
        independence: 'INDEPENDENT',
        locator: 'a',
      },
      {
        id: 'ev-2',
        relation: 'SUPPORTS',
        sourceType: 'PRIMARY_ARTIFACT',
        independence: 'INDEPENDENT',
        locator: 'b',
      },
    ],
    BENCHMARK_CASE_VERSION_V1,
  );
  const mapped = toRelationships(legacy, 'prop-1');
  assert.deepEqual(
    (mapped?.relationships ?? []).map((record) => record.sourceId),
    ['ev-1', 'ev-2'],
    'the v1 fallback substitutes the relationship id',
  );
  const status = deriveEvidenceStatus(mapped?.relationships ?? []);
  assert.equal(status.supportingSourceCount, 2);
  assert.doesNotMatch(
    status.notes.join(' '),
    SUPPORTING_NOTE,
    'a v1 case cannot reach the anti-corroboration branch, which is exactly why v2 exists',
  );
});

test('a v2 case without a source identity is refused before scoring', () => {
  const fields = validateBenchmarkCase(
    caseWithEvidence([{ ...evidence(), sourceId: undefined }]),
    0,
  ).map((issue) => issue.field);
  assert.ok(
    fields.some((field) => field.includes('sourceId')),
    `missing sourceId must be named, got ${fields.join(', ')}`,
  );
});

test('syndicated material is representable: one publisher, many copies, related independence', () => {
  const status = deriveEvidenceStatus(
    relationshipsOf([
      evidence({ id: 'ev-1', sourceId: 'src-wire', independence: 'RELATED' }),
      evidence({ id: 'ev-2', sourceId: 'src-wire', independence: 'RELATED' }),
    ]),
  );
  assert.equal(status.supportingSourceCount, 1);
  assert.match(status.notes.join(' '), SUPPORTING_NOTE);
});

test('self-published repetition is labelled as repetition, not corroboration', () => {
  const status = deriveEvidenceStatus(
    relationshipsOf([
      evidence({ id: 'ev-1', sourceId: 'src-own', sourceType: 'SELF_PUBLISHED' }),
      evidence({ id: 'ev-2', sourceId: 'src-own', sourceType: 'SELF_PUBLISHED' }),
    ]),
  );
  assert.equal(status.supportingSourceCount, 1);
  const notes = status.notes.join(' ');
  assert.match(notes, SUPPORTING_NOTE);
  assert.match(notes, /self-published or affiliated/i);
});

test('the stratum is scoreable end to end, not just listable', () => {
  // A real regression check needs a deterministic verdict to compare against a gold label. If the
  // duplicate case produced the same status as the independent case, the stratum would be decoration.
  const duplicate = regressionResults([
    caseWithEvidence([evidence({ id: 'ev-1' }), evidence({ id: 'ev-2' })]),
  ]);
  const independent = regressionResults([
    caseWithEvidence([
      evidence({ id: 'ev-1', sourceId: 'src-1' }),
      evidence({ id: 'ev-2', sourceId: 'src-2' }),
    ]),
  ]);
  assert.equal(duplicate.length, 1);
  assert.equal(independent.length, 1);
  assert.equal(duplicate[0]?.produced, 'SUPPORTED_WITHIN_SCOPE');
  assert.equal(independent[0]?.produced, 'SUPPORTED_WITHIN_SCOPE');

  // The statuses agree because both are supported. What separates them is the source count, and the
  // gold label a reviewer writes for a duplicate case is the one that a contradiction test can break:
  // a single contradicting relationship from the *same* source must not outvote the repetition.
  const contradicting = deriveEvidenceStatus(
    relationshipsOf([
      evidence({ id: 'ev-1' }),
      evidence({ id: 'ev-2' }),
      evidence({ id: 'ev-3', sourceId: 'src-1', relation: 'CONTRADICTS' }),
    ]),
  );
  assert.equal(contradicting.status, 'CONFLICTING_EVIDENCE');
  assert.equal(contradicting.sourceCount, 1, 'all three relationships come from one source');
});

test('a single source cannot corroborate itself into a strong status', () => {
  // The note is the mechanism that keeps a reader from treating repetition as corroboration; the
  // status rule itself does not collapse on source count, and this records that limit explicitly
  // rather than letting the benchmark imply it was handled.
  const status = deriveEvidenceStatus(
    relationshipsOf([evidence({ id: 'ev-1' }), evidence({ id: 'ev-2' }), evidence({ id: 'ev-3' })]),
  );
  assert.equal(status.status, 'SUPPORTED_WITHIN_SCOPE');
  assert.equal(status.sourceCount, 1);
  assert.match(status.notes.join(' '), /3 supporting relationships reference 1 distinct source/);
});
