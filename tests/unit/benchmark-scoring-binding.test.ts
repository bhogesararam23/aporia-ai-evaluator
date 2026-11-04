import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agreementRows, annotationSummaries } from '../../src/benchmark/scoring.ts';
import {
  adjudicationTemplate,
  applyAdjudication,
  auditCorpus,
  type PendingAdjudication,
} from '../../src/benchmark/review.ts';
import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';
import { BENCHMARK_REPORT_VERSION } from '../../src/benchmark/report.ts';
import type { BenchmarkAdjudication, BenchmarkCase } from '../../src/benchmark/types.ts';

/**
 * Scoring and audit through the shared binding resolver (ADR-027, safeguards 1, 5 and 6).
 *
 * The disagreement report and the scorer used to resolve adjudications independently. If staleness were
 * implemented in only one of them, a subject could read as unresolved in one view and settled in the other,
 * which is how a stale decision becomes a number. Both now consult one resolver, and the report stays
 * `benchmark-report-v2` by adding fields rather than inventing status values.
 */

function splitCase(): BenchmarkCase {
  return fixtureCase({
    id: 'case-score-binding',
    reviewedBy: ['dana', 'erin'],
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'PARTIALLY_SUPPORTED'),
    ],
  });
}

function decisionFor(caseValue: BenchmarkCase, label: string | null): PendingAdjudication {
  const entry = adjudicationTemplate(caseValue).adjudications[0];
  assert.ok(entry, 'the split yields one bound form');
  return {
    caseId: caseValue.id,
    dimension: entry.dimension,
    subjectId: entry.subjectId,
    outcome: label === null ? 'GENUINELY_AMBIGUOUS' : 'RESOLVED',
    label,
    reason: 'Weighed both readings against the frozen input.',
    adjudicatedBy: 'erin',
    disagreementHash: entry.disagreementHash,
    adjudicatedAt: '2026-11-05T12:00:00Z',
  };
}

function evidenceRow(caseValue: BenchmarkCase) {
  return agreementRows([caseValue]).find(
    (row) => row.dimension === 'EVIDENCE_SUPPORT' && row.subjectId === 'p1',
  );
}

test('the scorer and the disagreement report agree on every subject of a case', () => {
  const settled = applyAdjudication(
    splitCase(),
    decisionFor(splitCase(), 'SUPPORTED_WITHIN_SCOPE'),
  );
  assert.equal(settled.ok, true);
  if (!settled.ok) {
    return;
  }
  const cases = [splitCase(), settled.case];
  for (const caseValue of cases) {
    const report = disagreementReportForTest(caseValue);
    for (const subject of report) {
      const row = agreementRows([caseValue]).find(
        (entry) => entry.dimension === subject.dimension && entry.subjectId === subject.subjectId,
      );
      if (row === undefined) {
        continue;
      }
      // Unresolved in one view must not be settled in the other.
      const settledInReport = subject.status === 'ADJUDICATED' || subject.status === 'UNANIMOUS';
      const settledInScoring =
        row.status === 'RESOLVED_BY_ADJUDICATION' || row.status === 'UNANIMOUS';
      assert.equal(
        settledInReport,
        settledInScoring,
        `${subject.dimension}/${subject.subjectId} disagrees between the two views`,
      );
    }
  }
});

/** Local helper so the test does not depend on the report's own counters. */
function disagreementReportForTest(caseValue: BenchmarkCase) {
  return agreementRows([caseValue]).map((row) => ({
    dimension: row.dimension,
    subjectId: row.subjectId,
    status:
      row.status === 'RESOLVED_BY_ADJUDICATION'
        ? 'ADJUDICATED'
        : row.status === 'NOT_ENOUGH_REVIEWERS'
          ? 'SINGLE_REVIEWER'
          : row.status,
  }));
}

test('a stale binding leaves the subject unresolved in the scorer', () => {
  const base = splitCase();
  const adjudication: BenchmarkAdjudication = {
    dimension: 'EVIDENCE_SUPPORT',
    subjectId: 'p1',
    outcome: 'RESOLVED',
    label: 'SUPPORTED_WITHIN_SCOPE',
    reason: 'Written against the original split.',
    adjudicatedBy: 'erin',
    disagreementHash: adjudicationTemplate(base).adjudications[0]?.disagreementHash ?? '',
    adjudicatedAt: '2026-11-05T12:00:00.000Z',
  };
  const moved: BenchmarkCase = {
    ...fixtureCase({
      id: 'case-score-binding',
      reviewedBy: ['dana', 'erin'],
      reviewerLabels: [
        labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'PARTIALLY_SUPPORTED'),
        labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'CONTRADICTED'),
      ],
    }),
    adjudications: [adjudication],
  };
  const row = evidenceRow(moved);
  assert.equal(row?.status, 'UNRESOLVED');
  assert.equal(row?.adjudicationBinding, 'STALE');
  assert.equal(row?.adjudicatedLabel, null, 'a stale decision supplies no label');
});

test('a matching binding resolves the subject and records the binding', () => {
  const base = splitCase();
  const applied = applyAdjudication(base, decisionFor(base, 'PARTIALLY_SUPPORTED'));
  assert.equal(applied.ok, true);
  if (!applied.ok) {
    return;
  }
  const row = evidenceRow(applied.case);
  assert.equal(row?.status, 'RESOLVED_BY_ADJUDICATION');
  assert.equal(row?.adjudicationBinding, 'MATCHING');
  assert.equal(row?.adjudicatedLabel, 'PARTIALLY_SUPPORTED');
});

test('a legacy unbound decision keeps its v0.6 outcome while being labelled unbound', () => {
  const unbound: BenchmarkCase = {
    ...splitCase(),
    adjudications: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        subjectId: 'p1',
        outcome: 'RESOLVED',
        label: 'PARTIALLY_SUPPORTED',
        reason: 'Filed before bindings existed.',
        adjudicatedBy: 'erin',
      },
    ],
  };
  const row = evidenceRow(unbound);
  assert.equal(
    row?.status,
    'RESOLVED_BY_ADJUDICATION',
    'compatibility: v0.6 behaviour is unchanged',
  );
  assert.equal(row?.adjudicationBinding, 'UNBOUND');
});

test('alias spellings of one reviewer cannot produce a unanimous agreement row', () => {
  const aliases: BenchmarkCase = {
    ...fixtureCase({
      id: 'case-score-alias',
      reviewedBy: ['dana'],
      reviewerLabels: [
        labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
        labelFor('DANA', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      ],
    }),
  };
  const row = evidenceRow(aliases);
  assert.equal(row?.status, 'NOT_ENOUGH_REVIEWERS');
  assert.deepEqual(row?.reviewers, ['dana']);
});

test('annotation summaries count stale and unbound exclusions in the open', () => {
  const base = splitCase();
  const staleAdjudication: BenchmarkAdjudication = {
    dimension: 'EVIDENCE_SUPPORT',
    subjectId: 'p1',
    outcome: 'RESOLVED',
    label: 'SUPPORTED_WITHIN_SCOPE',
    reason: 'Written against a split that moved.',
    adjudicatedBy: 'erin',
    disagreementHash: adjudicationTemplate(base).adjudications[0]?.disagreementHash ?? '',
    adjudicatedAt: '2026-11-05T12:00:00.000Z',
  };
  const staleCase: BenchmarkCase = {
    ...fixtureCase({
      id: 'case-summary',
      reviewedBy: ['dana', 'erin'],
      reviewerLabels: [
        labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'PARTIALLY_SUPPORTED'),
        labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'CONTRADICTED'),
      ],
    }),
    adjudications: [staleAdjudication],
  };
  const summaries = annotationSummaries(agreementRows([staleCase]), [
    'EVIDENCE_SUPPORT',
    'ANSWER_FIDELITY',
  ]);
  const evidence = summaries.find((summary) => summary.dimension === 'EVIDENCE_SUPPORT');
  assert.equal(evidence?.excludedStaleAdjudication, 1);
  assert.equal(evidence?.excludedUnboundAdjudication, 0);
  // The stale decision does not make the subject scorable: excluding it is honest only if it is counted.
  assert.equal(evidence?.scorable, 0);
  assert.equal(evidence?.agreementRate, null);
});

test('a stale subject is never counted as scorable agreement', () => {
  const base = splitCase();
  const rows = agreementRows([
    {
      ...base,
      adjudications: [
        {
          dimension: 'EVIDENCE_SUPPORT',
          subjectId: 'p1',
          outcome: 'RESOLVED',
          label: 'SUPPORTED_WITHIN_SCOPE',
          reason: 'Stale.',
          adjudicatedBy: 'erin',
          disagreementHash: '0'.repeat(64),
        },
      ],
    },
  ]);
  const summary = annotationSummaries(rows, ['EVIDENCE_SUPPORT'])[0];
  assert.equal(summary?.scorable, 0);
  assert.equal(summary?.agreeingWithGold, 0);
});

test('the audit reports roster gaps, binding state and canonical reviewer counts', () => {
  const base = splitCase();
  const applied = applyAdjudication(base, decisionFor(base, null));
  assert.equal(applied.ok, true);
  if (!applied.ok) {
    return;
  }
  const audit = auditCorpus([applied.case]);
  const entry = audit.cases.find((item) => item.id === 'case-score-binding');
  assert.equal(entry?.reviewerCount, 2);
  assert.equal(entry?.adjudicatedSubjects >= 1, true);
  assert.equal(audit.summary.staleAdjudications, 0);
  assert.equal(audit.summary.unboundAdjudications, 0);
  assert.equal(audit.summary.casesWithUndeclaredReviewers, 0);
});

test('the audit names undeclared reviewers instead of letting them pass as coverage', () => {
  const undeclared: BenchmarkCase = {
    ...fixtureCase({
      id: 'case-audit-undeclared',
      reviewedBy: ['dana'],
      reviewerLabels: [
        labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
        labelFor('ghost', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      ],
    }),
  };
  const audit = auditCorpus([undeclared]);
  assert.equal(audit.summary.casesWithUndeclaredReviewers, 1);
  assert.deepEqual(audit.cases[0]?.undeclaredReviewers, ['ghost']);
  // One canonical person labelled twice is not two reviewers.
  assert.equal(audit.cases[0]?.reviewerCount, 2);
});

test('the audit separates stale from unbound adjudications and keeps accuracy unclaimable', () => {
  const base = splitCase();
  const staleOnly: BenchmarkCase = {
    ...base,
    adjudications: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        subjectId: 'p1',
        outcome: 'RESOLVED',
        label: 'SUPPORTED_WITHIN_SCOPE',
        reason: 'Bound to a moved split.',
        adjudicatedBy: 'erin',
        disagreementHash: '1'.repeat(64),
      },
    ],
  };
  const unboundOnly: BenchmarkCase = {
    ...base,
    adjudications: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        subjectId: 'p1',
        outcome: 'RESOLVED',
        label: 'SUPPORTED_WITHIN_SCOPE',
        reason: 'Legacy record.',
        adjudicatedBy: 'erin',
      },
    ],
  };
  assert.equal(auditCorpus([staleOnly]).summary.staleAdjudications, 1);
  assert.equal(auditCorpus([staleOnly]).summary.unboundAdjudications, 0);
  assert.equal(auditCorpus([unboundOnly]).summary.unboundAdjudications, 1);
  assert.equal(auditCorpus([unboundOnly]).summary.staleAdjudications, 0);

  for (const audit of [auditCorpus([staleOnly]), auditCorpus([unboundOnly])]) {
    assert.equal(audit.accuracyClaimable, false);
    assert.match(audit.accuracyReason, /readiness is not accuracy/i);
  }
});

test('benchmark-report-v2 is still the report version and its status enum is unchanged', () => {
  assert.equal(BENCHMARK_REPORT_VERSION, 'benchmark-report-v2');
  const statuses = agreementRows([splitCase()]).map((row) => row.status);
  const allowed = new Set([
    'NOT_ENOUGH_REVIEWERS',
    'UNANIMOUS',
    'RESOLVED_BY_ADJUDICATION',
    'GENUINELY_AMBIGUOUS',
    'UNRESOLVED',
  ]);
  for (const status of statuses) {
    assert.ok(allowed.has(status), `unexpected status ${status}`);
  }
});
