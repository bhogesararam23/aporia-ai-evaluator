import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  disagreementReport,
  adjudicationTemplate,
  ADJUDICATION_TEMPLATE_VERSION,
} from '../../src/benchmark/review.ts';
import { BENCHMARK_CASE_VERSION, type BenchmarkCase } from '../../src/benchmark/types.ts';

function labels(
  reviewer: string,
  pairs: readonly (readonly [string, string, string])[],
): {
  reviewer: string;
  dimension: 'EVIDENCE_SUPPORT';
  label: string;
  subjectId: string;
  note: null;
}[] {
  return pairs.map(([, subjectId, label]) => ({
    reviewer,
    dimension: 'EVIDENCE_SUPPORT' as const,
    label,
    subjectId,
    note: null,
  }));
}

function caseWith(reviewerLabels: unknown[], adjudications: unknown[] = []): BenchmarkCase {
  return {
    version: BENCHMARK_CASE_VERSION,
    id: 'case-disagree',
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

test('unanimous reviewers are reported as agreement', () => {
  const report = disagreementReport(
    caseWith([
      ...labels('dana', [['EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE']]),
      ...labels('sam', [['EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE']]),
    ]),
  );
  const subject = report.subjects.find((entry) => entry.subjectId === 'p1');
  assert.equal(subject?.status, 'UNANIMOUS');
  assert.equal(report.unresolved, 0);
});

test('a single reviewer is never counted as agreement', () => {
  const report = disagreementReport(
    caseWith([...labels('dana', [['EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE']])]),
  );
  assert.equal(
    report.subjects.find((entry) => entry.subjectId === 'p1')?.status,
    'SINGLE_REVIEWER',
  );
});

test('a disagreement stays unresolved and no label is chosen for it', () => {
  const report = disagreementReport(
    caseWith([
      ...labels('dana', [['EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE']]),
      ...labels('sam', [['EVIDENCE_SUPPORT', 'p1', 'CONTRADICTED']]),
    ]),
  );
  const subject = report.subjects.find((entry) => entry.subjectId === 'p1');
  assert.equal(subject?.status, 'UNRESOLVED');
  assert.equal(report.unresolved, 1);
  assert.equal(
    subject?.adjudicatedLabel ?? null,
    null,
    'the report must not manufacture a consensus label',
  );
});

test('a scoped adjudication resolves exactly the subject it names', () => {
  const report = disagreementReport(
    caseWith(
      [
        ...labels('dana', [['EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE']]),
        ...labels('sam', [['EVIDENCE_SUPPORT', 'p1', 'CONTRADICTED']]),
      ],
      [
        {
          dimension: 'EVIDENCE_SUPPORT',
          subjectId: 'p1',
          outcome: 'RESOLVED',
          label: 'CONTRADICTED',
          reason: 'The second reviewer read the primary source.',
          adjudicatedBy: 'sam',
        },
      ],
    ),
  );
  const subject = report.subjects.find((entry) => entry.subjectId === 'p1');
  assert.equal(subject?.status, 'ADJUDICATED');
  assert.equal(subject?.adjudicatedLabel, 'CONTRADICTED');
  assert.equal(report.unresolved, 0);
  assert.equal(report.adjudicated, 1);
});

test('an adjudication template lists only unresolved subjects, with nothing pre-filled', () => {
  const template = adjudicationTemplate(
    caseWith([
      ...labels('dana', [['EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE']]),
      ...labels('sam', [['EVIDENCE_SUPPORT', 'p1', 'CONTRADICTED']]),
    ]),
  );
  assert.equal(template.version, ADJUDICATION_TEMPLATE_VERSION);
  assert.equal(template.adjudications.length, 1);
  const entry = template.adjudications[0];
  assert.ok(entry);
  assert.equal(entry.subjectId, 'p1');
  assert.equal(entry.outcome, '', 'the adjudicator decides; the tool does not');
  assert.equal(entry.label, '', 'no consensus label is manufactured');
});
