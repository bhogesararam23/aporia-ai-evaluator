import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evidenceRuleRegressions } from '../../src/benchmark/regression.ts';
import {
  BENCHMARK_CASE_VERSION,
  type BenchmarkCase,
  type EvidenceRuleRow,
} from '../../src/benchmark/types.ts';

/**
 * The benchmark pipeline is version-aware: every proposition is scored under both
 * `evidence-aggregation-v1` and `evidence-aggregation-v2`, recording the verdict and the
 * corroborating-source count for each. These fixtures pin that the two rules can disagree on
 * corroboration (shared canonical URI, or a RELATED record) while the product default stays v1.
 */

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

function caseOf(records: readonly Record<string, unknown>[]): BenchmarkCase {
  return {
    version: BENCHMARK_CASE_VERSION,
    id: 'case-evidence-rules',
    stratum: 'DUPLICATE_OR_SYNDICATED_SOURCES',
    title: 'Evidence-rule version fixture',
    provenance: {
      origin: 'Synthetic fixture for evidence-rule tests. Not a gold case.',
      authorizedForStorage: true,
      reviewedBy: ['reviewer-a'],
      reviewedAt: '2026-11-04',
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

function rulesFor(records: readonly Record<string, unknown>[]): {
  v1: EvidenceRuleRow;
  v2: EvidenceRuleRow;
} {
  const rows = evidenceRuleRegressions([caseOf(records)]);
  const v1 = rows.find((row) => row.ruleVersion === 'evidence-aggregation-v1');
  const v2 = rows.find((row) => row.ruleVersion === 'evidence-aggregation-v2');
  assert.ok(v1 !== undefined && v2 !== undefined, 'both rule rows are produced');
  return { v1, v2 };
}

test('each proposition is scored once per evidence rule, verdict matched against gold', () => {
  const rows = evidenceRuleRegressions([caseOf([evidence({ id: 'ev-1' })])]);
  assert.equal(rows.length, 2, 'one v1 row and one v2 row for the single proposition');
  for (const row of rows) {
    assert.equal(row.produced, 'SUPPORTED_WITHIN_SCOPE');
    assert.equal(row.expected, 'SUPPORTED_WITHIN_SCOPE');
    assert.equal(row.statusMatched, true);
  }
});

test('v2 collapses two records sharing one canonical URI; v1 counts them as two', () => {
  const rules = rulesFor([
    evidence({ id: 'ev-1', sourceId: 'src-1', canonicalUri: 'https://example.com/a' }),
    evidence({ id: 'ev-2', sourceId: 'src-2', canonicalUri: 'https://example.com/a' }),
  ]);
  assert.equal(rules.v1.supportingSourceCount, 2);
  assert.equal(rules.v2.supportingSourceCount, 1);
  assert.equal(rules.v2.apparentCorroboratingSourceCount, 2);
  // Both still reach the same verdict label; only the corroboration figure moves.
  assert.equal(rules.v2.statusMatched, true);
});

test('v2 collapses a RELATED copy; distinct sources stay distinct in both rules', () => {
  const rules = rulesFor([
    evidence({ id: 'ev-1', sourceId: 'src-1' }),
    evidence({ id: 'ev-2', sourceId: 'src-2', independence: 'RELATED' }),
  ]);
  assert.equal(rules.v1.supportingSourceCount, 2);
  assert.equal(rules.v2.supportingSourceCount, 1);
});

test('v2 with distinct canonical URIs does not collapse corroboration', () => {
  const rules = rulesFor([
    evidence({ id: 'ev-1', sourceId: 'src-1', canonicalUri: 'https://a.example/x' }),
    evidence({ id: 'ev-2', sourceId: 'src-2', canonicalUri: 'https://b.example/x' }),
  ]);
  assert.equal(rules.v1.supportingSourceCount, 2);
  assert.equal(rules.v2.supportingSourceCount, 2);
  assert.equal(rules.v2.apparentCorroboratingSourceCount, null);
});
