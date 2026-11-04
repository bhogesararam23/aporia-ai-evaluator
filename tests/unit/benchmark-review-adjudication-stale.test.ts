import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ADJUDICATION_TEMPLATE_VERSION_V2,
  adjudicationTemplate,
  applyAdjudication,
  disagreementReport,
  type PendingAdjudication,
} from '../../src/benchmark/review.ts';
import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';
import type { BenchmarkCase } from '../../src/benchmark/types.ts';

/**
 * Adjudication templates and guarded application (ADR-027, defect 4).
 *
 * v0.6 handed out a blank form that named only the subject, and `applyAdjudication` then checked the
 * *current* state. A decision written against Monday's split could therefore settle Tuesday's different
 * split, with nothing recording that the two were not the same disagreement. The template now carries the
 * state hash and the application refuses anything that does not match it.
 *
 * Nothing here chooses a side: the outcome, label, reason and adjudicator stay blank until a human fills
 * them, and an application never edits the gold `expected` array.
 */

function splitCase(overrides: Partial<BenchmarkCase> = {}): BenchmarkCase {
  return {
    ...fixtureCase({
      id: 'case-apply',
      reviewedBy: ['dana', 'erin'],
      reviewerLabels: [
        labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
        labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'PARTIALLY_SUPPORTED'),
      ],
    }),
    ...overrides,
  };
}

function pendingFor(
  caseValue: BenchmarkCase,
  overrides: Partial<PendingAdjudication> = {},
): PendingAdjudication {
  const entry = adjudicationTemplate(caseValue).adjudications[0];
  assert.ok(entry, 'a split case yields exactly one template entry');
  return {
    caseId: caseValue.id,
    dimension: entry.dimension,
    subjectId: entry.subjectId,
    outcome: 'RESOLVED',
    label: 'SUPPORTED_WITHIN_SCOPE',
    reason: 'The second record restates the first, so it adds no independent support.',
    adjudicatedBy: 'erin',
    disagreementHash: entry.disagreementHash,
    adjudicatedAt: '2026-11-05T12:00:00Z',
    ...overrides,
  };
}

test('the template is v2 and lists one bound entry per unresolved subject, with nothing pre-filled', () => {
  const template = adjudicationTemplate(splitCase());
  assert.equal(template.version, ADJUDICATION_TEMPLATE_VERSION_V2);
  assert.equal(template.caseId, 'case-apply');
  assert.equal(template.adjudications.length, 1);
  const entry = template.adjudications[0];
  assert.equal(entry?.dimension, 'EVIDENCE_SUPPORT');
  assert.equal(entry?.subjectId, 'p1');
  assert.match(entry?.disagreementHash, /^[0-9a-f]{64}$/);
  for (const blank of [
    entry?.outcome,
    entry?.label,
    entry?.reason,
    entry?.adjudicatedBy,
    entry?.adjudicatedAt,
  ]) {
    assert.equal(blank, '', 'resolving a disagreement is a human act; nothing is suggested');
  }
});

test('the template hash is stable for one state and moves when the disagreement moves', () => {
  const first = adjudicationTemplate(splitCase());
  const second = adjudicationTemplate(splitCase());
  assert.equal(first.templateHash, second.templateHash);
  assert.equal(first.adjudications[0]?.disagreementHash, second.adjudications[0]?.disagreementHash);

  const moved = splitCase({
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'CONTRADICTED'),
    ],
  });
  assert.notEqual(
    adjudicationTemplate(moved).adjudications[0]?.disagreementHash,
    first.adjudications[0]?.disagreementHash,
  );
  assert.notEqual(adjudicationTemplate(moved).templateHash, first.templateHash);
});

test('a bound adjudication applied against the current state settles exactly one subject', () => {
  const caseValue = splitCase();
  const result = applyAdjudication(caseValue, pendingFor(caseValue));
  assert.equal(result.ok, true, JSON.stringify(!result.ok && result.reasons));
  if (!result.ok) {
    return;
  }
  assert.equal(result.case.adjudications?.length, 1);
  const stored = result.case.adjudications[0];
  assert.equal(stored?.disagreementHash, pendingFor(caseValue).disagreementHash);
  assert.equal(stored?.adjudicatedAt, '2026-11-05T12:00:00.000Z');
  assert.equal(disagreementReport(result.case).unresolved, 0);
  assert.equal(result.case.expected, caseValue.expected, 'gold labels are never edited');
});

test('a decision written against a disagreement that has moved is refused and changes nothing', () => {
  const caseValue = splitCase();
  const stale = pendingFor(caseValue);
  // The split changes after the form was issued: three reviewers now disagree on three different values.
  const moved = splitCase({
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'INSUFFICIENT_EVIDENCE'),
      labelFor('zoe', 'EVIDENCE_SUPPORT', 'p1', 'CONTRADICTED'),
    ],
  });
  const before = JSON.stringify(moved);
  const result = applyAdjudication(moved, { ...stale, caseId: moved.id });
  assert.equal(result.ok, false);
  assert.ok(
    !result.ok && result.reasons.some((reason) => /no longer the disagreement/i.test(reason)),
    `expected a staleness reason, got: ${String(!result.ok && result.reasons)}`,
  );
  assert.equal(
    JSON.stringify(moved),
    before,
    'a refused adjudication leaves the case byte-identical',
  );
});

test('a decision with no binding, or a malformed binding, is refused rather than trusted', () => {
  const caseValue = splitCase();
  const unbound = { ...pendingFor(caseValue), disagreementHash: '' };
  assert.equal(applyAdjudication(caseValue, unbound).ok, false);
  assert.equal(applyAdjudication(caseValue, { ...unbound, disagreementHash: 'nope' }).ok, false);
});

test('a settled subject offers no further form, and replaying the same decision is refused', () => {
  const caseValue = splitCase();
  const decision = pendingFor(caseValue);
  const first = applyAdjudication(caseValue, decision);
  assert.equal(first.ok, true);
  if (!first.ok) {
    return;
  }
  // Once the subject is settled there is nothing to adjudicate, so the tool issues no form at all. This is
  // the structural reason a second decision cannot be filed against a settled split.
  assert.equal(adjudicationTemplate(first.case).adjudications.length, 0);

  // Replaying the identical decision must still be refused, even though its binding still matches, because
  // the subject is no longer an unresolved disagreement.
  const again = applyAdjudication(first.case, decision);
  assert.equal(again.ok, false);
  assert.ok(
    !again.ok && again.reasons.some((reason) => /not an unresolved disagreement/i.test(reason)),
    `expected a nothing-to-settle reason, got: ${String(!again.ok && again.reasons)}`,
  );
  assert.equal(
    again.ok ? 1 : first.case.adjudications?.length,
    1,
    'no duplicate record is appended',
  );
});

test('the v0.6 refusals still hold: unanimous, lone-reviewer and unknown subjects', () => {
  const unanimous = splitCase({
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
    ],
  });
  // No unresolved subject exists, so the template is empty and any hand-built entry must still be refused.
  assert.equal(adjudicationTemplate(unanimous).adjudications.length, 0);
  assert.equal(applyAdjudication(unanimous, pendingFor(splitCase())).ok, false);

  const lone = splitCase({
    reviewerLabels: [labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE')],
  });
  assert.equal(applyAdjudication(lone, pendingFor(splitCase())).ok, false);

  const ghost = { ...pendingFor(splitCase()), subjectId: 'nope' };
  assert.equal(applyAdjudication(splitCase(), ghost).ok, false);
});

test('a resolved decision needs an in-vocabulary label and an ambiguous one needs no label', () => {
  const caseValue = splitCase();
  assert.equal(
    applyAdjudication(caseValue, pendingFor(caseValue, { label: 'DEFS_NOT_A_LABEL' })).ok,
    false,
  );
  assert.equal(applyAdjudication(caseValue, pendingFor(caseValue, { label: '' })).ok, false);
  const ambiguous = applyAdjudication(
    caseValue,
    pendingFor(caseValue, { outcome: 'GENUINELY_AMBIGUOUS', label: null }),
  );
  assert.equal(ambiguous.ok, true, 'a real ambiguity with no label is a valid decision');
  assert.equal(
    applyAdjudication(caseValue, { ...pendingFor(caseValue), outcome: 'GENUINELY_AMBIGUOUS' }).ok,
    false,
    'an ambiguity that still carries a label would score an unresolved subject as gold',
  );
});

test('the reason, adjudicator and human-supplied moment are all required', () => {
  const caseValue = splitCase();
  assert.equal(applyAdjudication(caseValue, pendingFor(caseValue, { reason: '  ' })).ok, false);
  assert.equal(
    applyAdjudication(caseValue, pendingFor(caseValue, { adjudicatedBy: '' })).ok,
    false,
  );
  assert.equal(
    applyAdjudication(caseValue, pendingFor(caseValue, { adjudicatedAt: '' })).ok,
    false,
    'a decision with no recorded moment is unfalsifiable later',
  );
  assert.equal(
    applyAdjudication(caseValue, pendingFor(caseValue, { adjudicatedAt: 'last tuesday' })).ok,
    false,
    'the tool has no clock, so a value that is not an instant cannot anchor one',
  );
});

test('a decision naming a different case is refused', () => {
  const caseValue = splitCase();
  assert.equal(applyAdjudication(caseValue, pendingFor(caseValue, { caseId: 'other' })).ok, false);
});
