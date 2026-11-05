import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advanceJournal,
  BATCH_JOURNAL_STATES,
  isLegalJournalTransition,
  planBatchAdjudication,
  planBatchMerge,
  renderStagedCorpus,
  UnsafeCaseNameError,
  type BatchPlan,
} from '../../src/benchmark/batch.ts';
import { adjudicationTemplate, buildReviewerPacket } from '../../src/benchmark/review.ts';
import { normaliseCase } from '../../src/benchmark/authoring.ts';
import { contentHash } from '../../src/benchmark/hashing.ts';
import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';
import {
  BENCHMARK_SUBMISSION_VERSION_V2,
  type AnnotationSubmission,
  type BenchmarkCase,
} from '../../src/benchmark/types.ts';

/**
 * The pure batch layer (ADR-027, defect 5).
 *
 * v0.6 applied whatever it could and wrote straight into the output directory, so a batch with one bad file
 * produced a partially-updated corpus with no record of what had been written and no way to resume. Planning
 * first, and keeping the plan a pure value, is what lets the filesystem layer be atomic and recoverable.
 *
 * Nothing here touches the filesystem, and no plan depends on input ordering.
 */

function caseA(
  overrides: {
    reviewerLabels?: BenchmarkCase['reviewerLabels'];
    reviewedBy?: readonly string[];
  } = {},
) {
  return fixtureCase({
    id: 'case-a',
    stratum: 'REFUSAL_NOT_A_DENIAL',
    reviewedBy: overrides.reviewedBy ?? ['dana', 'erin', 'zoe'],
    reviewerLabels: overrides.reviewerLabels ?? [],
  });
}

function caseB() {
  return fixtureCase({
    id: 'case-b',
    stratum: 'CONFLICTING_EVIDENCE',
    reviewedBy: ['dana', 'erin'],
  });
}

function submissionFor(
  benchmarkCase: BenchmarkCase,
  reviewer: string,
  overrides: Partial<AnnotationSubmission> = {},
): AnnotationSubmission {
  const packet = buildReviewerPacket(benchmarkCase);
  return {
    version: BENCHMARK_SUBMISSION_VERSION_V2,
    caseId: benchmarkCase.id,
    packetHash: packet.packetHash,
    reviewer,
    submittedAt: '2026-11-05T09:00:00Z',
    annotations: packet.subjects.map((subject, index) => ({
      dimension: subject.dimension,
      subjectId: subject.subjectId,
      label: subject.dimension === 'EVIDENCE_SUPPORT' ? 'SUPPORTED_WITHIN_SCOPE' : 'NOT_ASSESSABLE',
      rationale: `Batch rationale ${String(index)}.`,
    })),
    ...overrides,
  };
}

test('a clean batch plans as accepted, deterministic and with every case rendered', () => {
  const cases = [caseA(), caseB()];
  const plan = planBatchMerge(cases, [
    submissionFor(caseA(), 'dana'),
    submissionFor(caseB(), 'erin'),
  ]);
  assert.equal(plan.kind, 'merge');
  assert.equal(plan.mode, 'atomic');
  assert.equal(plan.acceptedCount, 2);
  assert.equal(plan.rejectedCount, 0);
  assert.equal(plan.clean, true);
  assert.deepEqual([...plan.changedCaseIds].sort(), ['case-a', 'case-b']);
  assert.equal(plan.cases.length, 2);
});

test('the plan is independent of submission order', () => {
  const cases = [caseA(), caseB()];
  const one = planBatchMerge(cases, [
    submissionFor(caseA(), 'dana'),
    submissionFor(caseB(), 'erin'),
  ]);
  const two = planBatchMerge(cases, [
    submissionFor(caseB(), 'erin'),
    submissionFor(caseA(), 'dana'),
  ]);
  assert.equal(one.planHash, two.planHash);
  assert.deepEqual(
    one.items.map((item) => item.key),
    two.items.map((item) => item.key),
  );
});

test('atomic mode applies nothing when one submission in the batch is refused', () => {
  const cases = [caseA(), caseB()];
  const plan = planBatchMerge(cases, [
    submissionFor(caseA(), 'dana'),
    submissionFor(caseB(), 'erin', { packetHash: 'e'.repeat(64) }),
  ]);
  assert.equal(plan.clean, false);
  assert.equal(plan.acceptedCount, 1);
  assert.equal(plan.rejectedCount, 1);
  assert.deepEqual(plan.changedCaseIds, [], 'nothing would be written');
  assert.equal(
    JSON.stringify(plan.cases),
    JSON.stringify(cases),
    'the cases are returned untouched',
  );
});

test('atomic mode also refuses to let one reviewer submit twice in one batch', () => {
  const cases = [caseA()];
  const plan = planBatchMerge(cases, [
    submissionFor(caseA(), 'dana'),
    submissionFor(caseA(), 'DANA'),
  ]);
  assert.equal(plan.clean, false);
  assert.ok(
    plan.items.some((item) => item.reasons.some((reason) => /duplicate/i.test(reason))),
    'the second spelling is the duplicate, and the plan says so',
  );
});

test('isolated mode applies the accepted items and still reports every refusal', () => {
  const cases = [caseA(), caseB()];
  const plan = planBatchMerge(
    cases,
    [submissionFor(caseA(), 'dana'), submissionFor(caseB(), 'erin', { reviewer: 'ghost' })],
    'isolated',
  );
  assert.equal(plan.mode, 'isolated');
  assert.equal(plan.acceptedCount, 1);
  assert.equal(plan.rejectedCount, 1);
  assert.deepEqual(plan.changedCaseIds, ['case-a']);
  const written = plan.cases.find((entry) => entry.id === 'case-b');
  assert.equal(written?.reviewerLabels.length, 0, 'the refused case is unchanged');
  assert.ok(
    plan.items.every((item) => item.accepted || item.reasons.length > 0),
    'a rejected item always carries its reasons',
  );
});

test('a submission aimed at a case that is not in the batch is reported, not thrown on', () => {
  const plan = planBatchMerge([caseA()], [submissionFor(caseB(), 'dana')]);
  assert.equal(plan.rejectedCount, 1);
  assert.ok(plan.items[0]?.reasons.some((reason) => /no case|does not match/i.test(reason)));
});

test('an empty batch is clean and changes nothing', () => {
  const cases = [caseA()];
  const plan = planBatchMerge(cases, []);
  assert.equal(plan.clean, true);
  assert.equal(plan.acceptedCount, 0);
  assert.deepEqual(plan.changedCaseIds, []);
  assert.equal(JSON.stringify(plan.cases), JSON.stringify(cases));
});

test('the plan hash moves when a decision changes, so a stale journal cannot be mistaken for a new run', () => {
  const cases = [caseA(), caseB()];
  const clean = planBatchMerge(cases, [submissionFor(caseA(), 'dana')]);
  const withRejection = planBatchMerge(cases, [
    submissionFor(caseA(), 'dana'),
    submissionFor(caseB(), 'erin', { reviewer: 'ghost' }),
  ]);
  assert.notEqual(clean.planHash, withRejection.planHash);
});

test('planBatchAdjudication binds each decision and honours the same modes', () => {
  const split = fixtureCase({
    id: 'case-adj',
    stratum: 'CONFLICTING_EVIDENCE',
    reviewedBy: ['dana', 'erin'],
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'PARTIALLY_SUPPORTED'),
    ],
  });
  const entry = adjudicationTemplate(split).adjudications[0];
  assert.ok(entry);
  const decision = {
    caseId: 'case-adj',
    dimension: entry.dimension,
    subjectId: entry.subjectId,
    outcome: 'RESOLVED',
    label: 'SUPPORTED_WITHIN_SCOPE',
    reason: 'The second record restates the first.',
    adjudicatedBy: 'erin',
    disagreementHash: entry.disagreementHash,
    adjudicatedAt: '2026-11-05T12:00:00Z',
  };
  const good = planBatchAdjudication([split], [decision]);
  assert.equal(good.kind, 'adjudication');
  assert.equal(good.clean, true);
  assert.deepEqual(good.changedCaseIds, ['case-adj']);

  // A stale decision in the same batch stops the whole atomic run.
  const stale = { ...decision, disagreementHash: '9'.repeat(64) };
  const mixed = planBatchAdjudication([split], [decision, stale]);
  assert.equal(mixed.clean, false);
  assert.deepEqual(mixed.changedCaseIds, []);

  const isolated = planBatchAdjudication([split], [decision, stale], 'isolated');
  assert.equal(isolated.acceptedCount, 1);
  assert.equal(isolated.cases[0]?.adjudications?.length, 1);
});

test('staged rendering is deterministic, sorted, and ends each file with exactly one newline', () => {
  const cases = [caseB(), caseA()];
  const first = renderStagedCorpus(cases);
  const second = renderStagedCorpus(cases);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((item) => item.name),
    ['case-a.json', 'case-b.json'],
    'names are sorted so a publish order is reproducible',
  );
  for (const item of first) {
    assert.doesNotMatch(item.name, /[\\/]/, 'a staged name is a bare file name');
    assert.match(item.contents, /\n$/);
    assert.doesNotMatch(
      item.contents,
      /\r\n/,
      'canonical JSON is written with LF on every platform',
    );
    assert.equal(
      item.contents,
      normaliseCase(cases.find((entry) => `${entry.id}.json` === item.name)!),
    );
    assert.equal(item.contentsHash, contentHash(item.contents));
  }
});

test('journal states move only forward through the documented sequence', () => {
  const cases = [caseA()];
  const plan: BatchPlan = planBatchMerge(cases, [submissionFor(caseA(), 'dana')]);
  const staged = {
    version: 'benchmark-batch-journal-v1',
    planHash: plan.planHash,
    kind: plan.kind,
    mode: plan.mode,
    state: 'staged' as const,
    items: renderStagedCorpus(plan.cases).map((item) => ({
      name: item.name,
      contentsHash: item.contentsHash,
    })),
  };
  assert.deepEqual(BATCH_JOURNAL_STATES, ['staged', 'committing', 'committed']);
  assert.equal(isLegalJournalTransition('staged', 'committing'), true);
  assert.equal(isLegalJournalTransition('committing', 'committed'), true);
  assert.equal(isLegalJournalTransition('committed', 'staged'), false);
  assert.equal(
    isLegalJournalTransition('staged', 'committed'),
    false,
    'the middle state is not skippable',
  );
  assert.equal(isLegalJournalTransition('committed', 'committing'), false);

  const committing = advanceJournal(staged, 'committing');
  assert.equal(committing.ok, true);
  const done = advanceJournal(committing.ok ? committing.journal : staged, 'committed');
  assert.equal(done.ok, true);
  const illegal = advanceJournal(done.ok ? done.journal : staged, 'staged');
  assert.equal(illegal.ok, false);
  assert.ok(!illegal.ok && /illegal|cannot/i.test(illegal.reason));
});

test('a journal that lost items mid-publish can be resumed from what remains', () => {
  const cases = [caseA(), caseB()];
  const items = renderStagedCorpus(cases);
  const journal = {
    version: 'benchmark-batch-journal-v1',
    planHash: 'a'.repeat(64),
    kind: 'merge' as const,
    mode: 'atomic' as const,
    state: 'committing' as const,
    items,
  };
  // First file already landed; the rest still have to be written.
  const written = new Set([items[0]!.name]);
  const remaining = journal.items
    .filter((item) => !written.has(item.name))
    .map((item) => item.name);
  assert.deepEqual(remaining, ['case-b.json']);
});

test('the staged renderer refuses an id that would escape the output directory', () => {
  // Its own doc comment has always claimed names are bare. The validator now rejects such an id, so this is
  // the second of the two enforcement points the owner asked for: a caller that builds cases directly gets a
  // named refusal instead of a plan whose file name contains `..`.
  const escaping = fixtureCase({ id: '../escaped' });
  assert.throws(
    () => renderStagedCorpus([escaping]),
    (error: unknown) => {
      assert.ok(error instanceof UnsafeCaseNameError);
      assert.match(error.message, /escaped/);
      return true;
    },
  );
  // And it fails before any file is planned, so a batch cannot half-render a corpus with one bad id.
  const mixed = [fixtureCase({ id: 'case-a' }), fixtureCase({ id: 'a/b' })];
  assert.throws(() => renderStagedCorpus(mixed), UnsafeCaseNameError);
});
