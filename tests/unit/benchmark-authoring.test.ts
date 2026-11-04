import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  caseProvenanceSummary,
  normaliseCase,
  scaffoldTemplate,
  TEMPLATE_VERSION,
} from '../../src/benchmark/authoring.ts';
import { validateBenchmarkCase, disagreementPairs } from '../../src/benchmark/validate.ts';
import { BENCHMARK_STRATA, type BenchmarkCase } from '../../src/benchmark/types.ts';

/**
 * Objective 1: local case-authoring, normalisation and provenance workflows.
 *
 * The rule that governs all of them is the milestone's honesty boundary: the harness must never be
 * able to score a fabricated case. So a scaffold is deliberately NOT a valid case — it carries a
 * template version and no gold labels, and the validator refuses it — and provenance is reported as
 * the operator's own assertion, never as verified independence.
 */

test('the scaffold is a template, not a scoreable case, and the validator refuses it', () => {
  const template = scaffoldTemplate('REFUSAL_NOT_A_DENIAL');
  assert.equal(template.version, TEMPLATE_VERSION);
  // No fabricated content: nothing is pre-filled with a gold label or a reviewer name.
  assert.deepEqual(template.expected, []);
  assert.deepEqual(template.reviewerLabels, []);
  assert.equal(template.provenance.authorizedForStorage, false);
  // The decisive property: it cannot enter a scored corpus.
  const issues = validateBenchmarkCase(template, 0);
  assert.ok(issues.length > 0, 'a scaffold must not validate as a real case');
  assert.ok(
    issues.some((issue) => issue.field === 'version'),
    'the template version is refused',
  );
  assert.ok(
    issues.some((issue) => issue.field === 'expected'),
    'a case with no gold labels is refused',
  );
});

test('every declared stratum has a scaffold so a reviewer starts from structure, not invention', () => {
  for (const stratum of BENCHMARK_STRATA) {
    const template = scaffoldTemplate(stratum);
    assert.equal(template.stratum, stratum);
    // It is a skeleton: it still carries no gold labels, regardless of stratum.
    assert.equal(template.expected.length, 0);
  }
});

test('normaliseCase is canonical and idempotent', () => {
  const a = normaliseCase(minimalCase());
  const b = normaliseCase(JSON.parse(a) as BenchmarkCase);
  assert.equal(a, b, 're-normalising the output is stable');
  // Canonical: keys appear in sorted order at every level.
  const keys = Object.keys(JSON.parse(a) as Record<string, unknown>);
  assert.deepEqual([...keys].sort(), keys, 'top-level keys are sorted');
});

test('provenance summary reports what a human asserted and never claims verified review', () => {
  const summary = caseProvenanceSummary(minimalCase());
  assert.equal(summary.authorizedForStorage, true);
  assert.deepEqual(summary.reviewers, ['dana', 'sam']);
  assert.equal(summary.canEnterScoredCorpus, true);
  assert.match(summary.reviewerIdentityNote, /operator-asserted|not .*independent/);
});

test('provenance summary counts reviewer disagreement without resolving it', () => {
  const benchmarkCase: BenchmarkCase = {
    ...minimalCase(),
    reviewerLabels: [
      {
        reviewer: 'dana',
        dimension: 'ANSWER_FIDELITY',
        label: 'ACCURATE',
        subjectId: 's1',
        note: null,
      },
      {
        reviewer: 'sam',
        dimension: 'ANSWER_FIDELITY',
        label: 'CONTRADICTED',
        subjectId: 's1',
        note: null,
      },
    ],
  };
  const summary = caseProvenanceSummary(benchmarkCase);
  assert.equal(summary.disagreements, disagreementPairs(benchmarkCase).length);
  assert.ok(summary.disagreements >= 1, 'a two-reviewer split is a disagreement');
  // A disagreement with no adjudication must not be silently treated as settled.
  assert.equal(summary.adjudicatedDisagreements, 0);
  assert.equal(summary.unresolvedDisagreements, summary.disagreements);
});

function minimalCase(): BenchmarkCase {
  return {
    version: 'benchmark-case-v2',
    id: 'case-minimal',
    stratum: 'REFUSAL_NOT_A_DENIAL',
    title: 'A minimal valid-shaped case for normalisation and provenance tests',
    provenance: {
      origin: 'Synthetic fixture for authoring tests. Not a gold case.',
      authorizedForStorage: true,
      reviewedBy: ['dana', 'sam'],
      reviewedAt: '2026-11-04',
      unverified: ['source credibility not checked'],
      limitation: 'This fixture asserts no real fact.',
    },
    input: {
      claimText: 'A fixture claim long enough to pass.',
      propositions: [{ id: 'p1', text: 'A fixture proposition.', evidence: [] }],
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
        label: 'INSUFFICIENT_EVIDENCE',
        rationale: 'No evidence recorded.',
        subjectId: 'p1',
      },
    ],
    reviewerLabels: [],
    adjudications: [],
    limitations: ['Synthetic fixture only.'],
  };
}
