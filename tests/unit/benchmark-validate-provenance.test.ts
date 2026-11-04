import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateBenchmarkCase } from '../../src/benchmark/validate.ts';
import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';
import type { BenchmarkAdjudication, BenchmarkCase } from '../../src/benchmark/types.ts';

/**
 * Validating the persisted review provenance (ADR-027).
 *
 * Two things must hold at once, and they pull in opposite directions:
 *
 * 1. A case written before v0.7 has none of the new fields and must produce **no new issues** — otherwise a
 *    corpus migration would be implied where the design says none is needed.
 * 2. A case that does carry provenance must be checked, because a truncated rationale or a malformed packet
 *    hash makes the provenance untrustworthy while still looking present.
 *
 * The roster comparison is canonicalised here too: `mergeSubmission` stores canonical identities, so a
 * validator that compared raw spellings would reject the very cases the tool produced.
 */

function caseWithLabel(label: unknown): BenchmarkCase {
  return {
    ...fixtureCase({ reviewedBy: ['dana'] }),
    reviewerLabels: [label],
  } as unknown as BenchmarkCase;
}

function caseWithAdjudication(adjudication: unknown): BenchmarkCase {
  return {
    ...fixtureCase({
      reviewedBy: ['dana'],
      reviewerLabels: [labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE')],
    }),
    adjudications: [adjudication],
  } as unknown as BenchmarkCase;
}

function fieldsOf(caseValue: BenchmarkCase, index = 0) {
  return validateBenchmarkCase(caseValue, index).map((issue) => issue.field);
}

test('a v0.6-shaped label with no provenance fields produces no issues at all', () => {
  assert.deepEqual(validateBenchmarkCase(fixtureCase(), 0), []);
  const legacy = caseWithLabel(
    labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
  );
  assert.deepEqual(validateBenchmarkCase(legacy, 0), []);
});

test('a full v0.7 provenance set validates', () => {
  const enriched = caseWithLabel(
    labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE', {
      rationale: 'The primary artifact states the date outright.',
      submittedAt: '2026-11-05T09:00:00.000Z',
      packetHash: 'a'.repeat(64),
      submissionHash: 'b'.repeat(64),
    }),
  );
  assert.deepEqual(validateBenchmarkCase(enriched, 0), []);
});

test('an explicit null provenance field is accepted, because absence is a recorded fact', () => {
  const nullable = caseWithLabel(
    labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE', {
      rationale: null,
      submittedAt: null,
      packetHash: null,
      submissionHash: null,
    }),
  );
  assert.deepEqual(validateBenchmarkCase(nullable, 0), []);
});

test('a non-string provenance value is reported rather than coerced', () => {
  const bad = caseWithLabel(
    labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE', {
      rationale: 42,
      submittedAt: true,
      packetHash: ['a'],
      submissionHash: { nested: true },
    }),
  );
  const fields = fieldsOf(bad);
  for (const field of ['rationale', 'submittedAt', 'packetHash', 'submissionHash']) {
    assert.ok(
      fields.some((f) => f.includes(field)),
      `expected an issue for ${field}, got: ${fields.join(', ')}`,
    );
  }
});

test('a malformed hash shape is reported, since a wrong-length digest silently defeats staleness checks', () => {
  for (const bad of ['deadbeef', 'A'.repeat(64), 'z'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) {
    const caseValue = caseWithLabel(
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE', { packetHash: bad }),
    );
    assert.ok(
      fieldsOf(caseValue).some((field) => field.includes('packetHash')),
      `"${bad}" must be reported as a malformed packetHash`,
    );
  }
});

test('an over-long rationale is refused, keeping one case loadable under the same ceiling as gold', () => {
  const caseValue = caseWithLabel(
    labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE', {
      rationale: 'x'.repeat(4001),
    }),
  );
  assert.ok(fieldsOf(caseValue).some((field) => field.includes('rationale')));
});

test('a v1 date-only submittedAt is accepted as recorded, not rejected for lacking an offset', () => {
  // The lenient v1 rule is a compatibility promise: the value is stored as the reviewer wrote it.
  const caseValue = caseWithLabel(
    labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE', {
      submittedAt: '2026-11-05',
    }),
  );
  assert.deepEqual(validateBenchmarkCase(caseValue, 0), []);
});

test('a bound adjudication validates, and a malformed binding is reported', () => {
  const good: BenchmarkAdjudication = {
    dimension: 'EVIDENCE_SUPPORT',
    subjectId: 'p1',
    outcome: 'RESOLVED',
    label: 'SUPPORTED_WITHIN_SCOPE',
    reason: 'The second record restates the first.',
    adjudicatedBy: 'Dana',
    disagreementHash: 'c'.repeat(64),
    adjudicatedAt: '2026-11-05T12:00:00.000Z',
  };
  assert.deepEqual(validateBenchmarkCase(caseWithAdjudication(good), 0), []);

  const badHash = caseWithAdjudication({ ...good, disagreementHash: 'nope' });
  assert.ok(fieldsOf(badHash).some((field) => field.includes('disagreementHash')));

  const badAt = caseWithAdjudication({ ...good, adjudicatedAt: 17 });
  assert.ok(fieldsOf(badAt).some((field) => field.includes('adjudicatedAt')));
});

test('an unbound legacy adjudication still validates, so v0.6 cases are readable', () => {
  const legacy: BenchmarkAdjudication = {
    dimension: 'EVIDENCE_SUPPORT',
    subjectId: 'p1',
    outcome: 'RESOLVED',
    label: 'SUPPORTED_WITHIN_SCOPE',
    reason: 'Recorded before bindings existed.',
    adjudicatedBy: 'dana',
  };
  assert.deepEqual(validateBenchmarkCase(caseWithAdjudication(legacy), 0), []);
});

test('roster comparison is canonical, so a merged case validates against its own declared reviewers', () => {
  // mergeSubmission stores `dana lee`; the case declares `Dana Lee`. v0.6 compared raw and rejected this.
  const caseValue = caseWithLabel({
    reviewer: 'dana lee',
    dimension: 'EVIDENCE_SUPPORT',
    label: 'SUPPORTED_WITHIN_SCOPE',
    subjectId: 'p1',
    note: null,
  }) as unknown as BenchmarkCase;
  const declared: BenchmarkCase = {
    ...(caseValue as BenchmarkCase),
    provenance: { ...(caseValue as BenchmarkCase).provenance, reviewedBy: ['Dana Lee'] },
  };
  assert.deepEqual(validateBenchmarkCase(declared, 0), []);
});

test('a reviewer outside the roster is still reported, canonically or not', () => {
  const caseValue = caseWithLabel({
    reviewer: 'SAM',
    dimension: 'EVIDENCE_SUPPORT',
    label: 'SUPPORTED_WITHIN_SCOPE',
    subjectId: 'p1',
    note: null,
  });
  const issues = validateBenchmarkCase(caseValue, 0);
  assert.ok(issues.some((issue) => /provenance\.reviewedBy/.test(issue.message)));
});

test('a roster that lists one reviewer twice under different spellings is a duplicate', () => {
  const caseValue = {
    ...fixtureCase({ reviewedBy: ['Dana', 'dana ', 'erin'] }),
  };
  const issues = validateBenchmarkCase(caseValue, 0);
  assert.ok(
    issues.some(
      (issue) => issue.field === 'provenance.reviewedBy' && /more than once/.test(issue.message),
    ),
    'alias spellings of one reviewer must not look like an authorisation record for two people',
  );
});
