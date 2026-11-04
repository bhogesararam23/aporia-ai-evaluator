import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adjudicationsFor,
  disagreementStateHash,
  resolveSettlingAdjudication,
  subjectLabelEntries,
} from '../../src/benchmark/provenance.ts';
import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';
import type { BenchmarkAdjudication, BenchmarkCase } from '../../src/benchmark/types.ts';

/**
 * Adjudication state binding (ADR-027, defect 4).
 *
 * v0.6 re-read the *current* disagreement when an adjudication was applied and only checked that the subject
 * was unresolved, so a decision written against one split could silently settle a different one. The state
 * hash names the exact split, and the resolver decides whether a stored decision still binds.
 *
 * The resolver is shared with the scorer, so a subject cannot be "unresolved" in the disagreement report and
 * "settled" in the benchmark numbers at the same time.
 */

const PACKET = 'a'.repeat(64);

function splitCase(labels: ReturnType<typeof labelFor>[]): BenchmarkCase {
  return fixtureCase({ reviewedBy: ['dana', 'erin'], reviewerLabels: labels });
}

/** Two reviewers who genuinely disagree on `p1`. */
function disagreeingCase(): BenchmarkCase {
  return splitCase([
    labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
    labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'PARTIALLY_SUPPORTED'),
  ]);
}

function currentState(benchmarkCase: BenchmarkCase): string {
  return disagreementStateHash({
    packetHash: PACKET,
    dimension: 'EVIDENCE_SUPPORT',
    subjectId: 'p1',
    entries: subjectLabelEntries(benchmarkCase, 'EVIDENCE_SUPPORT', 'p1'),
  });
}

function bound(benchmarkCase: BenchmarkCase): BenchmarkAdjudication {
  return {
    dimension: 'EVIDENCE_SUPPORT',
    subjectId: 'p1',
    outcome: 'RESOLVED',
    label: 'SUPPORTED_WITHIN_SCOPE',
    reason: 'The second record restates the first, so it adds no independent support.',
    adjudicatedBy: 'erin',
    disagreementHash: currentState(benchmarkCase),
    adjudicatedAt: '2026-11-05T12:00:00Z',
  };
}

test('the state hash covers only the subject it binds, and is deterministic', () => {
  const benchmarkCase = disagreeingCase();
  const first = currentState(benchmarkCase);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, currentState(benchmarkCase));
  // Reviewer label order in the file is not content: the entries are sorted before hashing.
  const reordered = splitCase([
    labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'PARTIALLY_SUPPORTED'),
    labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
  ]);
  assert.equal(currentState(reordered), first);
});

test('the state hash moves when the disagreement moves', () => {
  const benchmarkCase = disagreeingCase();
  const before = currentState(benchmarkCase);
  // Erin changes their mind: there is no longer a split at all.
  const agreed = splitCase([
    labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
    labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
  ]);
  assert.notEqual(currentState(agreed), before);
  // A third reviewer joining the split also moves it.
  const joined = splitCase([
    labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
    labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'PARTIALLY_SUPPORTED'),
    labelFor('zoe', 'EVIDENCE_SUPPORT', 'p1', 'CONTRADICTED'),
  ]);
  assert.notEqual(currentState(joined), before);
});

test('the state hash moves when the frozen input moves, via the packet hash', () => {
  const benchmarkCase = disagreeingCase();
  const stateFor = (packet: string) =>
    disagreementStateHash({
      packetHash: packet,
      dimension: 'EVIDENCE_SUPPORT',
      subjectId: 'p1',
      entries: subjectLabelEntries(benchmarkCase, 'EVIDENCE_SUPPORT', 'p1'),
    });
  assert.notEqual(stateFor(PACKET), stateFor('b'.repeat(64)));
});

test('filing an adjudication does not move the state hash, so a decision keeps binding its split', () => {
  // If the count of existing decisions were part of the hash, applying one would make it stale on arrival
  // and no bound adjudication could ever settle anything. Filing a *second* decision is stopped by the
  // subject leaving `UNRESOLVED`, which `applyAdjudication` checks.
  const benchmarkCase = disagreeingCase();
  const before = currentState(benchmarkCase);
  const filed: BenchmarkCase = { ...benchmarkCase, adjudications: [bound(benchmarkCase)] };
  assert.equal(currentState(filed), before);
});

test('adjudicationsFor returns only the records naming that dimension and subject', () => {
  const benchmarkCase = disagreeingCase();
  const unrelated: BenchmarkAdjudication = {
    dimension: 'ATTRIBUTION',
    subjectId: 'st1',
    outcome: 'GENUINELY_AMBIGUOUS',
    label: null,
    reason: 'A different subject.',
    adjudicatedBy: 'erin',
  };
  const mixed: BenchmarkCase = {
    ...benchmarkCase,
    adjudications: [bound(benchmarkCase), unrelated],
  };
  assert.equal(adjudicationsFor(mixed, 'EVIDENCE_SUPPORT', 'p1').length, 1);
  assert.equal(adjudicationsFor(mixed, 'ATTRIBUTION', 'st1').length, 1);
  assert.equal(adjudicationsFor(benchmarkCase, 'EVIDENCE_SUPPORT', 'p1').length, 0);
});

test('subjectLabelEntries collapses reviewer spelling variants and drops other subjects', () => {
  const benchmarkCase = splitCase([
    labelFor('Dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
    labelFor(' dana ', 'ANSWER_FIDELITY', 'st1', 'NOT_ASSESSABLE'),
  ]);
  assert.deepEqual(subjectLabelEntries(benchmarkCase, 'EVIDENCE_SUPPORT', 'p1'), [
    { reviewerKey: 'dana', label: 'SUPPORTED_WITHIN_SCOPE' },
  ]);
});

test('a bound adjudication matching current state settles the subject', () => {
  const benchmarkCase = disagreeingCase();
  const withAdjudication: BenchmarkCase = {
    ...benchmarkCase,
    adjudications: [bound(benchmarkCase)],
  };
  const resolved = resolveSettlingAdjudication(
    withAdjudication,
    PACKET,
    'EVIDENCE_SUPPORT',
    'p1',
    1,
  );
  assert.equal(resolved.binding, 'MATCHING');
  assert.equal(resolved.adjudication?.label, 'SUPPORTED_WITHIN_SCOPE');
});

test('a bound adjudication whose disagreement has moved is STALE and does not settle', () => {
  const benchmarkCase = disagreeingCase();
  const stale = bound(benchmarkCase);
  // The reviewers then resolve the split themselves, so the state the decision bound to no longer exists.
  const moved = splitCase([
    labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
    labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
  ]);
  const withAdjudication: BenchmarkCase = { ...moved, adjudications: [stale] };
  const resolved = resolveSettlingAdjudication(
    withAdjudication,
    PACKET,
    'EVIDENCE_SUPPORT',
    'p1',
    0,
  );
  assert.equal(resolved.binding, 'STALE');
});

test('a legacy unbound adjudication is UNBOUND — honoured, but never presented as verified', () => {
  const benchmarkCase = disagreeingCase();
  const legacy: BenchmarkAdjudication = {
    dimension: 'EVIDENCE_SUPPORT',
    subjectId: 'p1',
    outcome: 'RESOLVED',
    label: 'PARTIALLY_SUPPORTED',
    reason: 'Recorded before bindings existed.',
    adjudicatedBy: 'erin',
  };
  const withAdjudication: BenchmarkCase = { ...benchmarkCase, adjudications: [legacy] };
  const resolved = resolveSettlingAdjudication(
    withAdjudication,
    PACKET,
    'EVIDENCE_SUPPORT',
    'p1',
    1,
  );
  assert.equal(resolved.binding, 'UNBOUND');
  assert.equal(resolved.adjudication?.label, 'PARTIALLY_SUPPORTED');
  assert.equal(resolved.adjudication?.disagreementHash, undefined);
});

test('a drifted bound record outranks a legacy unbound record on the same subject', () => {
  const benchmarkCase = disagreeingCase();
  const stale = bound(benchmarkCase);
  const legacy: BenchmarkAdjudication = {
    dimension: 'EVIDENCE_SUPPORT',
    subjectId: 'p1',
    outcome: 'RESOLVED',
    label: 'SUPPORTED_WITHIN_SCOPE',
    reason: 'Older unbound decision.',
    adjudicatedBy: 'erin',
  };
  // The reviewers moved, so the bound record is stale; the unbound record must not mask that.
  const moved = splitCase([
    labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'PARTIALLY_SUPPORTED'),
    labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'CONTRADICTED'),
  ]);
  const withBoth: BenchmarkCase = { ...moved, adjudications: [legacy, stale] };
  assert.equal(
    resolveSettlingAdjudication(withBoth, PACKET, 'EVIDENCE_SUPPORT', 'p1', 1).binding,
    'STALE',
  );
});

test('the most recently filed matching record settles an append-only history', () => {
  const benchmarkCase = disagreeingCase();
  const first = bound(benchmarkCase);
  const afterFirst: BenchmarkCase = { ...benchmarkCase, adjudications: [first] };
  // A fresh decision bound to the state that the first adjudication created.
  const reBound: BenchmarkAdjudication = {
    ...first,
    label: 'PARTIALLY_SUPPORTED',
    reason: 'Reconsidered after the first decision was filed.',
    disagreementHash: currentState(afterFirst),
  };
  const withBoth: BenchmarkCase = { ...afterFirst, adjudications: [first, reBound] };
  const resolved = resolveSettlingAdjudication(withBoth, PACKET, 'EVIDENCE_SUPPORT', 'p1', 1);
  assert.equal(resolved.binding, 'MATCHING');
  assert.equal(resolved.adjudication?.reason, 'Reconsidered after the first decision was filed.');
});

test('a subject with no adjudication resolves to nothing, without inventing one', () => {
  const benchmarkCase = disagreeingCase();
  const resolved = resolveSettlingAdjudication(benchmarkCase, PACKET, 'EVIDENCE_SUPPORT', 'p1', 1);
  assert.equal(resolved.binding, null);
  assert.equal(resolved.adjudication, undefined);
});

test('a v1 unscoped adjudication settles exactly one disagreement and is unbound', () => {
  const benchmarkCase: BenchmarkCase = {
    ...disagreeingCase(),
    version: 'benchmark-case-v1',
    adjudication: {
      outcome: 'RESOLVED',
      reason: 'One unscoped decision for the whole case.',
      adjudicatedBy: 'erin',
    },
  };
  assert.equal(
    resolveSettlingAdjudication(benchmarkCase, PACKET, 'EVIDENCE_SUPPORT', 'p1', 1).binding,
    'UNBOUND',
  );
  // Two disagreements in the case and the unscoped record names neither, so it settles nothing.
  assert.equal(
    resolveSettlingAdjudication(benchmarkCase, PACKET, 'EVIDENCE_SUPPORT', 'p1', 2).adjudication,
    undefined,
  );
});

test('a v1 unscoped RESOLVED record carries no label, so it cannot become gold', () => {
  const benchmarkCase: BenchmarkCase = {
    ...disagreeingCase(),
    version: 'benchmark-case-v1',
    adjudication: { outcome: 'RESOLVED', reason: 'Unscoped.', adjudicatedBy: 'erin' },
  };
  const resolved = resolveSettlingAdjudication(benchmarkCase, PACKET, 'EVIDENCE_SUPPORT', 'p1', 1);
  assert.equal(resolved.adjudication?.label, null);
  assert.equal(resolved.adjudication?.outcome, 'RESOLVED');
});
