import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adjudicationTemplate,
  applyAdjudication,
  disagreementReport,
  type PendingAdjudication,
} from '../../src/benchmark/review.ts';
import { BENCHMARK_CASE_VERSION, type BenchmarkCase } from '../../src/benchmark/types.ts';

function label(reviewer: string, value: string) {
  return { reviewer, dimension: 'EVIDENCE_SUPPORT', label: value, subjectId: 'p1', note: null };
}

function caseWith(reviewerLabels: unknown[], adjudications: unknown[] = []): BenchmarkCase {
  return {
    version: BENCHMARK_CASE_VERSION,
    id: 'case-adj',
    stratum: 'CONFLICTING_EVIDENCE',
    title: 'Case',
    provenance: {
      origin: 'Synthetic fixture.',
      authorizedForStorage: true,
      reviewedBy: ['dana', 'sam'],
      reviewedAt: '2026-11-05',
      unverified: [],
      limitation: 'Fixture only.',
    },
    input: {
      claimText: 'A fixed claim.',
      propositions: [{ id: 'p1', text: 'The proposition.', evidence: [] }],
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
        rationale: 'r',
        subjectId: 'p1',
      },
    ],
    reviewerLabels,
    adjudications,
    limitations: ['fixture'],
  } as unknown as BenchmarkCase;
}

const split = [label('dana', 'SUPPORTED_WITHIN_SCOPE'), label('sam', 'CONTRADICTED')];

/**
 * Build the decision from the case's own template, which is what carries the binding hash from v0.7.
 *
 * v0.6 let a hand-written decision settle any subject in the case; the version of this file that shipped
 * then was written before binding existed, so the hash is read from the current template rather than being
 * hard-coded, and the staleness refusal has its own test file.
 */
function resolvedFor(caseValue: BenchmarkCase): PendingAdjudication {
  const entry = adjudicationTemplate(caseValue).adjudications[0];
  assert.ok(entry, 'the fixture split yields one template entry');
  return {
    caseId: caseValue.id,
    dimension: 'EVIDENCE_SUPPORT',
    subjectId: 'p1',
    outcome: 'RESOLVED',
    label: 'CONTRADICTED',
    reason: 'The second reviewer read the primary source.',
    adjudicatedBy: 'sam',
    disagreementHash: entry.disagreementHash,
    adjudicatedAt: '2026-11-05T12:00:00Z',
  };
}

const resolved = resolvedFor(caseWith(split));

test('a resolved adjudication settles exactly the subject that actually disagreed', () => {
  const result = applyAdjudication(caseWith(split), resolved);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.case.adjudications?.length, 1);
    assert.equal(result.case.expected.length, 1, 'gold is never edited by an adjudication');
    const report = disagreementReport(result.case);
    assert.equal(report.subjects.find((s) => s.subjectId === 'p1')?.status, 'ADJUDICATED');
    assert.equal(report.unresolved, 0);
  }
});

test('an adjudication on a subject that is not a disagreement is refused', () => {
  const unanimous = caseWith([label('dana', 'CONTRADICTED'), label('sam', 'CONTRADICTED')]);
  const result = applyAdjudication(unanimous, resolved);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reasons.some((r) => /not an unresolved disagreement/i.test(r)));
});

test('a genuinely ambiguous outcome may not smuggle in a label', () => {
  const withLabel = applyAdjudication(caseWith(split), {
    ...resolved,
    outcome: 'GENUINELY_AMBIGUOUS',
    label: 'CONTRADICTED',
  });
  assert.equal(withLabel.ok, false);

  const withoutLabel = applyAdjudication(caseWith(split), {
    ...resolved,
    outcome: 'GENUINELY_AMBIGUOUS',
    label: null,
  });
  assert.equal(withoutLabel.ok, true, 'a real ambiguity with no label is a valid adjudication');
});

test('a resolved adjudication needs an in-vocabulary label, a reason and an adjudicator', () => {
  assert.equal(
    applyAdjudication(caseWith(split), { ...resolved, label: 'DEFS_NOT_A_LABEL' }).ok,
    false,
  );
  assert.equal(applyAdjudication(caseWith(split), { ...resolved, reason: '  ' }).ok, false);
  assert.equal(applyAdjudication(caseWith(split), { ...resolved, adjudicatedBy: '' }).ok, false);
});

test('an adjudication for a subject the case does not have is refused', () => {
  const result = applyAdjudication(caseWith(split), { ...resolved, subjectId: 'ghost' });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reasons.some((r) => /not a subject/i.test(r)));
});
