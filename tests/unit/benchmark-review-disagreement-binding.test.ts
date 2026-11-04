import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjudicationTemplate, disagreementReport } from '../../src/benchmark/review.ts';
import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';
import type { BenchmarkAdjudication, BenchmarkCase } from '../../src/benchmark/types.ts';

/**
 * The disagreement report under adjudication binding (ADR-027).
 *
 * The report is what an operator reads to decide whether a corpus is settled. It must therefore distinguish
 * four states that v0.6 blurred: a split no one has decided (`UNRESOLVED`), a split a *current* binding
 * settles, a split whose recorded decision has drifted out of date (`STALE`, which is not settled), and a
 * legacy decision that never named a split (`UNBOUND`, which settles but is not verified provenance).
 */

function splitCase(): BenchmarkCase {
  return fixtureCase({
    id: 'case-binding',
    reviewedBy: ['dana', 'erin'],
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'PARTIALLY_SUPPORTED'),
    ],
  });
}

function subjectOf(caseValue: BenchmarkCase) {
  return disagreementReport(caseValue).subjects.find(
    (subject) => subject.dimension === 'EVIDENCE_SUPPORT' && subject.subjectId === 'p1',
  );
}

function boundAdjudication(caseValue: BenchmarkCase): BenchmarkAdjudication {
  const entry = adjudicationTemplate(caseValue).adjudications[0];
  assert.ok(entry, 'a split case yields one template entry');
  return {
    dimension: 'EVIDENCE_SUPPORT',
    subjectId: 'p1',
    outcome: 'RESOLVED',
    label: 'SUPPORTED_WITHIN_SCOPE',
    reason: 'The second record restates the first, so it adds no independent support.',
    adjudicatedBy: 'erin',
    disagreementHash: entry.disagreementHash,
    adjudicatedAt: '2026-11-05T12:00:00.000Z',
  };
}

test('a split with no adjudication is unresolved and carries no binding', () => {
  const subject = subjectOf(splitCase());
  assert.equal(subject?.status, 'UNRESOLVED');
  assert.equal(subject?.binding, null);
  assert.equal(subject?.adjudicatedLabel, null);
  assert.equal(disagreementReport(splitCase()).unresolved, 1);
  assert.equal(disagreementReport(splitCase()).stale, 0);
});

test('a matching binding settles the subject and echoes the adjudicated label', () => {
  const base = splitCase();
  const settled: BenchmarkCase = { ...base, adjudications: [boundAdjudication(base)] };
  const subject = subjectOf(settled);
  assert.equal(subject?.status, 'ADJUDICATED');
  assert.equal(subject?.binding, 'MATCHING');
  assert.equal(subject?.adjudicatedLabel, 'SUPPORTED_WITHIN_SCOPE');
});

test('a stale binding leaves the subject unresolved rather than pretending it settled', () => {
  const base = splitCase();
  const adjudication = boundAdjudication(base);
  // The reviewers then move: Erin now agrees with Dana, so the filed decision binds a split that no longer exists.
  const moved: BenchmarkCase = {
    ...fixtureCase({
      id: 'case-binding',
      reviewedBy: ['dana', 'erin'],
      reviewerLabels: [
        labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
        labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      ],
    }),
    adjudications: [adjudication],
  };
  // Unanimous reviewers settle it themselves, so the stale decision is not what resolves this subject.
  assert.equal(subjectOf(moved)?.status, 'UNANIMOUS');

  // A different kind of drift: the split is still real, but the labels inside it changed.
  const stillSplit: BenchmarkCase = {
    ...fixtureCase({
      id: 'case-binding',
      reviewedBy: ['dana', 'erin'],
      reviewerLabels: [
        labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'PARTIALLY_SUPPORTED'),
        labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'CONTRADICTED'),
      ],
    }),
    adjudications: [adjudication],
  };
  const subject = subjectOf(stillSplit);
  assert.equal(subject?.status, 'UNRESOLVED');
  assert.equal(subject?.binding, 'STALE');
  assert.equal(
    subject?.adjudicatedLabel,
    null,
    'a stale decision is not allowed to supply a label',
  );
  assert.equal(disagreementReport(stillSplit).stale, 1);
  assert.equal(disagreementReport(stillSplit).unresolved, 1);
});

test('a legacy unbound adjudication settles but is marked as not verified', () => {
  const base = splitCase();
  const unbound: BenchmarkCase = {
    ...base,
    adjudications: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        subjectId: 'p1',
        outcome: 'RESOLVED',
        label: 'PARTIALLY_SUPPORTED',
        reason: 'Recorded before bindings existed.',
        adjudicatedBy: 'erin',
      },
    ],
  };
  const subject = subjectOf(unbound);
  assert.equal(subject?.status, 'ADJUDICATED');
  assert.equal(subject?.binding, 'UNBOUND');
  assert.equal(subject?.adjudicatedLabel, 'PARTIALLY_SUPPORTED');
});

test('a lone reviewer is a single opinion whatever the binding says', () => {
  const lone = fixtureCase({
    id: 'case-binding',
    reviewedBy: ['dana', 'erin'],
    reviewerLabels: [labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE')],
  });
  assert.equal(subjectOf(lone)?.status, 'SINGLE_REVIEWER');
  assert.equal(subjectOf(lone)?.binding ?? null, null);
});

test('alias spellings of one reviewer never turn a lone opinion into agreement', () => {
  const aliases = fixtureCase({
    id: 'case-binding',
    reviewedBy: ['dana', 'Dana', 'DANA '],
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('DANA', 'EVIDENCE_SUPPORT', 'p1', 'PARTIALLY_SUPPORTED'),
    ],
  });
  const subject = subjectOf(aliases);
  assert.equal(subject?.status, 'SINGLE_REVIEWER');
  assert.deepEqual(subject?.reviewers, ['dana']);
});

test('an unannotated subject stays unannotated and is counted as incomplete', () => {
  const bare = fixtureCase({ id: 'case-binding', reviewedBy: ['dana'] });
  const report = disagreementReport(bare);
  assert.equal(report.subjects.filter((subject) => subject.status === 'UNANNOTATED').length, 4);
});

test('the report counts every binding state without losing the unresolved ones', () => {
  const base = splitCase();
  const settled: BenchmarkCase = { ...base, adjudications: [boundAdjudication(base)] };
  const report = disagreementReport(settled);
  assert.equal(report.adjudicated, 1);
  assert.equal(report.unresolved, 0);
  assert.equal(report.stale, 0);
  assert.equal(report.caseId, 'case-binding');
});
