import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditCorpus, AUDIT_VERSION } from '../../src/benchmark/review.ts';
import { BENCHMARK_CASE_VERSION, type BenchmarkCase } from '../../src/benchmark/types.ts';

function caseWith(input: {
  id: string;
  stratum: string;
  reviewedBy: readonly string[];
  authorized: boolean;
  reviewerLabels: readonly (readonly [string, string])[];
  gold?: boolean;
}): BenchmarkCase {
  return {
    version: BENCHMARK_CASE_VERSION,
    id: input.id,
    stratum: input.stratum,
    title: input.id,
    provenance: {
      origin: 'Synthetic fixture.',
      authorizedForStorage: input.authorized,
      reviewedBy: [...input.reviewedBy],
      reviewedAt: '2026-11-05',
      unverified: [],
      limitation: 'Fixture only.',
    },
    input: {
      claimText: 'A fixed claim.',
      propositions: [{ id: 'p1', text: 'Prop.', evidence: [] }],
      answerText: null,
      citationCapture: 'NOT_SHOWN',
      citations: [],
      statements: [],
      providerLabel: 'Fixture',
      locale: 'en',
    },
    // The packet subject set for this input is exactly EVIDENCE_SUPPORT/p1.
    expected: input.gold
      ? [
          {
            dimension: 'EVIDENCE_SUPPORT',
            label: 'SUPPORTED_WITHIN_SCOPE',
            rationale: 'r',
            subjectId: 'p1',
          },
        ]
      : [],
    reviewerLabels: input.reviewerLabels.map(([reviewer, label]) => ({
      reviewer,
      dimension: 'EVIDENCE_SUPPORT' as const,
      label,
      subjectId: 'p1',
      note: null,
    })),
    adjudications: [],
    limitations: ['fixture'],
  } as unknown as BenchmarkCase;
}

test('the audit reports missing strata, authorisation gaps and thin reviews without claiming accuracy', () => {
  const audit = auditCorpus([
    caseWith({
      id: 'a',
      stratum: 'SUPPORTED_PRIMARY_EVIDENCE',
      reviewedBy: ['dana', 'sam'],
      authorized: true,
      reviewerLabels: [
        ['dana', 'SUPPORTED_WITHIN_SCOPE'],
        ['sam', 'SUPPORTED_WITHIN_SCOPE'],
      ],
      gold: true,
    }),
    caseWith({
      id: 'b',
      stratum: 'REFUSAL_NOT_A_DENIAL',
      reviewedBy: [],
      authorized: false,
      reviewerLabels: [],
      gold: true,
    }),
  ]);
  assert.equal(audit.version, AUDIT_VERSION);
  assert.equal(audit.caseCount, 2);
  // Most required strata are not covered by a two-case corpus.
  assert.ok(audit.missingStrata.length > 0);
  assert.ok(audit.missingStrata.includes('CONTRADICTED_BY_CREDIBLE_EVIDENCE'));
  // Case b has no reviewer and no authorisation.
  const b = audit.cases.find((entry) => entry.id === 'b');
  assert.equal(b?.authorizedForStorage, false);
  assert.equal(b?.reviewerCount, 0);
  assert.equal(b?.incompleteSubjects, 1, 'p1 is unannotated');
  const a = audit.cases.find((entry) => entry.id === 'a');
  assert.equal(a?.reviewerCount, 2);
  assert.equal(a?.incompleteSubjects, 0);
  assert.equal(a?.unanimousSubjects, 1);
  assert.equal(audit.summary.casesMissingAuthorisation, 1);
  assert.equal(audit.summary.casesBelowTwoReviewers, 1);
  assert.equal(audit.accuracyClaimable, false);
  assert.match(audit.accuracyReason, /accuracy/i);
});

test('unresolved disagreement is surfaced as a readiness problem, never auto-resolved', () => {
  const audit = auditCorpus([
    caseWith({
      id: 'c',
      stratum: 'CONFLICTING_EVIDENCE',
      reviewedBy: ['dana', 'sam'],
      authorized: true,
      reviewerLabels: [
        ['dana', 'SUPPORTED_WITHIN_SCOPE'],
        ['sam', 'CONTRADICTED'],
      ],
      gold: true,
    }),
  ]);
  const c = audit.cases.find((entry) => entry.id === 'c');
  assert.equal(c?.unresolvedSubjects, 1);
  assert.equal(audit.summary.unresolvedSubjects, 1);
  assert.equal(c?.adjudicatedSubjects, 0);
});
