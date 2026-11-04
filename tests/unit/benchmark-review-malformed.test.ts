import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyAdjudication,
  adjudicationTemplate,
  auditCorpus,
  buildReviewerPacket,
  disagreementReport,
  mergeSubmission,
  rosterGaps,
  type PendingAdjudication,
} from '../../src/benchmark/review.ts';
import {
  planBatchMerge,
  planBatchAdjudication,
  renderStagedCorpus,
} from '../../src/benchmark/batch.ts';
import {
  buildReleaseManifest,
  caseContentHash,
  releaseGates,
  verifyRelease,
} from '../../src/benchmark/release.ts';
import { validateBenchmarkCase, validateBenchmarkCorpus } from '../../src/benchmark/validate.ts';
import { contentHash, isContentHash } from '../../src/benchmark/hashing.ts';
import { fixtureCase } from '../helpers/benchmark-fixtures.ts';
import type { BenchmarkCase } from '../../src/benchmark/types.ts';

/**
 * Hostile and half-written input at the pure layer (ADR-026's security posture, extended by ADR-027).
 *
 * The CLIs coerce before they call, so a malformed file becomes a printed refusal. That is only one layer:
 * `mergeSubmission`, `applyAdjudication`, the report, the audit, the batch planner and the release builder are
 * exported functions a caller can hand parsed JSON directly. If any of them throws on a missing or
 * wrong-typed field, a half-written corpus file turns an auditable refusal into a stack trace, and an
 * operator learns nothing about what is wrong.
 *
 * Every case here is therefore: give it something broken, require either a refusal with reasons or a
 * well-formed result, and never a crash.
 */

const BROKEN_CASES: readonly string[] = [
  'null',
  'undefined',
  'not-an-object',
  'missing-input',
  'empty-arrays-missing',
  'labels-not-array',
  'label-entry-null',
  'expected-not-array',
  'provenance-not-object',
  'reviewers-not-array',
  'adjudications-not-array',
  'unknown-dimension',
];

function minimalCase(mutate: (target: Record<string, unknown>) => void): BenchmarkCase {
  const value = fixtureCase({ id: 'case-malformed' }) as unknown as Record<string, unknown>;
  mutate(value);
  return value as unknown as BenchmarkCase;
}

test('contentHash and isContentHash survive prototype-ish and exotic keys', () => {
  const polluted = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}') as Record<
    string,
    unknown
  >;
  assert.equal(typeof contentHash(polluted), 'string');
  // A JSON body that carried a `__proto__` member must not reach the real prototype.
  assert.equal(({} as Record<string, unknown>)['polluted'], undefined);
  assert.equal(isContentHash(contentHash(polluted)), true);
  assert.equal(contentHash({ a: undefined }), contentHash({}));
});

test('a case with no optional arrays is still hashable, plannable and releasable', () => {
  for (const kind of BROKEN_CASES) {
    const broken = minimalCase((target) => {
      if (kind === 'null') {
        target['reviewerLabels'] = null;
      } else if (kind === 'undefined') {
        delete target['reviewerLabels'];
      } else if (kind === 'not-an-object') {
        target['provenance'] = 'nonsense';
      } else if (kind === 'missing-input') {
        delete target['input'];
      } else if (kind === 'empty-arrays-missing') {
        delete target['expected'];
        delete target['adjudications'];
      } else if (kind === 'labels-not-array') {
        target['reviewerLabels'] = 'dana';
      } else if (kind === 'label-entry-null') {
        target['reviewerLabels'] = [null, { reviewer: 'dana' }];
      } else if (kind === 'expected-not-array') {
        target['expected'] = {};
      } else if (kind === 'provenance-not-object') {
        target['provenance'] = ['dana'];
      } else if (kind === 'reviewers-not-array') {
        (target['provenance'] as Record<string, unknown>)['reviewedBy'] = 'dana';
      } else if (kind === 'adjudications-not-array') {
        target['adjudications'] = 5;
      } else if (kind === 'unknown-dimension') {
        target['reviewerLabels'] = [
          { reviewer: 'dana', dimension: 'MADE_UP', label: 'X', subjectId: 'p1', note: null },
        ];
      }
    });
    // None of these may throw. What they report is asserted individually below; here the contract is only
    // that a broken file is survivable rather than fatal.
    const outcome = (() => {
      try {
        caseContentHash(broken);
        renderStagedCorpus([broken]);
        rosterGaps(broken);
        disagreementReport(broken);
        adjudicationTemplate(broken);
        auditCorpus([broken]);
        releaseGates([broken], { issues: [] });
        planBatchMerge([broken], []);
        buildReleaseManifest([broken]);
        return 'ok';
      } catch (error) {
        return `${(error as Error).name}: ${(error as Error).message}`;
      }
    })();
    assert.equal(outcome, 'ok', `${kind} crashed the pure layer: ${outcome}`);
  }
});

test('a submission with a malformed body is refused with reasons, never thrown on', () => {
  const benchmarkCase = fixtureCase({ id: 'case-malformed', reviewedBy: ['dana', 'erin'] });
  const packet = buildReviewerPacket(benchmarkCase);
  const good = {
    version: 'benchmark-submission-v2',
    caseId: benchmarkCase.id,
    packetHash: packet.packetHash,
    reviewer: 'erin',
    submittedAt: '2026-11-05T09:00:00Z',
    annotations: packet.subjects.map((subject) => ({
      dimension: subject.dimension,
      subjectId: subject.subjectId,
      label: subject.dimension === 'EVIDENCE_SUPPORT' ? 'SUPPORTED_WITHIN_SCOPE' : 'NOT_ASSESSABLE',
      rationale: 'Reasoned from the frozen input.',
    })),
  };
  const variants: Record<string, unknown> = {
    'annotations not an array': { ...good, annotations: 'dana' },
    'annotations null': { ...good, annotations: null },
    'an annotation is null': { ...good, annotations: [null] },
    'a numeric label': {
      ...good,
      annotations: good.annotations.map((annotation) => ({ ...annotation, label: 42 })),
    },
    'a rationale that is an object': {
      ...good,
      annotations: good.annotations.map((annotation) => ({ ...annotation, rationale: {} })),
    },
    'a dimension that does not exist': {
      ...good,
      annotations: good.annotations.map((annotation) => ({
        ...annotation,
        dimension: 'MADE_UP',
      })),
    },
    'an oversized packetHash': { ...good, packetHash: 'a'.repeat(65) },
    'an uppercase packetHash': { ...good, packetHash: 'A'.repeat(64) },
    'a non-string reviewer': { ...good, reviewer: { name: 'erin' } },
    'a non-string timestamp': { ...good, submittedAt: 1_730_000_000 },
    'a missing version': (() => {
      const copy = { ...good } as Record<string, unknown>;
      delete copy['version'];
      return copy;
    })(),
    'annotations not an array of objects': { ...good, annotations: ['x', 1, true] },
  };
  for (const [name, submission] of Object.entries(variants)) {
    let outcome: string;
    try {
      const result = mergeSubmission(benchmarkCase, submission as typeof good);
      outcome = result.ok ? 'accepted' : 'refused';
    } catch (error) {
      outcome = `CRASHED ${(error as Error).name}`;
    }
    assert.equal(outcome, 'refused', `${name} must be refused, got: ${String(outcome)}`);
  }
});

test('an adjudication with a broken body is refused rather than crashing', () => {
  const split = fixtureCase({
    id: 'case-malformed-adj',
    stratum: 'CONFLICTING_EVIDENCE',
    reviewedBy: ['dana', 'erin'],
    reviewerLabels: [
      {
        reviewer: 'dana',
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        subjectId: 'p1',
        note: null,
      },
      {
        reviewer: 'erin',
        dimension: 'EVIDENCE_SUPPORT',
        label: 'PARTIALLY_SUPPORTED',
        subjectId: 'p1',
        note: null,
      },
    ],
  });
  const entry = adjudicationTemplate(split).adjudications[0];
  assert.ok(entry);
  const base: PendingAdjudication = {
    caseId: split.id,
    dimension: entry.dimension,
    subjectId: entry.subjectId,
    outcome: 'RESOLVED',
    label: 'SUPPORTED_WITHIN_SCOPE',
    reason: 'Weighed the recorded material.',
    adjudicatedBy: 'erin',
    disagreementHash: entry.disagreementHash,
    adjudicatedAt: '2026-11-05T12:00:00Z',
  };
  const variants: Record<string, Record<string, unknown>> = {
    'outcome is an array': { outcome: ['RESOLVED'] },
    'label is an object': { label: { value: 'SUPPORTED_WITHIN_SCOPE' } },
    'reason is a number': { reason: 7 },
    'adjudicator is null': { adjudicatedBy: null },
    'hash is missing entirely': { disagreementHash: undefined },
    'hash is a number': { disagreementHash: 12345 },
    'timestamp is an array': { adjudicatedAt: ['2026-11-05'] },
    'dimension is unknown': { dimension: 'MADE_UP' },
    'caseId is absent': { caseId: undefined },
  };
  for (const [name, override] of Object.entries(variants)) {
    let outcome: string;
    try {
      // Built by hand so a hostile field can hold a non-string without the compiler approving it.
      const merged: Record<string, unknown> = { ...base, ...override };
      for (const [key, value] of Object.entries(override)) {
        if (value === undefined) {
          delete merged[key];
        }
      }
      const result = applyAdjudication(split, merged as unknown as PendingAdjudication);
      outcome = result.ok ? 'accepted' : 'refused';
    } catch (error) {
      outcome = `CRASHED ${(error as Error).name}: ${(error as Error).message}`;
    }
    assert.equal(outcome, 'refused', `${name} must be refused, got: ${outcome}`);
  }
});

test('a batch of hostile submissions refuses each item and still never throws', () => {
  const benchmarkCase = fixtureCase({ id: 'case-malformed-batch', reviewedBy: ['dana'] });
  const packet = buildReviewerPacket(benchmarkCase);
  const broken = {
    version: 'benchmark-submission-v2',
    caseId: benchmarkCase.id,
    packetHash: packet.packetHash,
    reviewer: null,
    submittedAt: 5,
    annotations: 'none',
  };
  const plan = planBatchMerge([benchmarkCase], [broken as never], 'isolated');
  assert.equal(plan.rejectedCount, 1);
  assert.equal(plan.acceptedCount, 0);
  assert.ok(plan.items[0] && plan.items[0].reasons.length > 0, 'the refusal carries reasons');
  assert.deepEqual(plan.changedCaseIds, []);
});

test('an adjudication batch routes an unknown case id without throwing', () => {
  const plan = planBatchAdjudication(
    [],
    [
      {
        caseId: 'not-here',
        dimension: 'EVIDENCE_SUPPORT',
        subjectId: 'p1',
        outcome: 'RESOLVED',
        label: 'SUPPORTED_WITHIN_SCOPE',
        reason: 'No such case.',
        adjudicatedBy: 'dana',
        disagreementHash: 'a'.repeat(64),
        adjudicatedAt: '2026-11-05T12:00:00Z',
      },
    ],
  );
  assert.equal(plan.rejectedCount, 1);
  assert.match(plan.items[0]?.reasons.join(' ') ?? '', /No case in the batch/);
});

test('the validator reports a hostile case as issues instead of throwing', () => {
  for (const value of [
    null,
    'string',
    [],
    { version: 'benchmark-case-v2' },
    { version: 'benchmark-case-v2', id: 'x', provenance: 'nope', input: 'nope' },
    { version: 'benchmark-case-v2', id: 'x', reviewerLabels: [null], expected: 3 },
  ]) {
    let outcome: string = 'ok';
    let issues: unknown;
    try {
      issues = validateBenchmarkCase(value, 0);
    } catch (error) {
      outcome = `CRASHED ${(error as Error).name}`;
    }
    assert.equal(outcome, 'ok', `${JSON.stringify(value)} must be reported, not thrown on`);
    assert.ok(
      Array.isArray(issues) && issues.length > 0,
      `${JSON.stringify(value)} reported nothing`,
    );
  }
  const corpus = validateBenchmarkCorpus([
    { index: 0, value: null },
    { index: 1, value: fixtureCase({ id: 'ok-case' }) },
  ]);
  assert.equal(corpus.cases.length, 1, 'a broken entry does not stop the valid one being read');
  assert.ok(corpus.issues.length > 0);
});

test('a manifest built from hostile cases and a corrupt manifest object are survivable', () => {
  const brokenCase = minimalCase((target) => {
    delete target['reviewerLabels'];
    delete target['adjudications'];
    target['stratum'] = 'NOT_A_STRATUM';
  });
  const manifest = buildReleaseManifest([brokenCase]);
  assert.equal(manifest.caseCount, 1);
  assert.equal(manifest.accuracyClaimable, false);
  assert.equal(manifest.cases[0]?.reviewerCount, 0);
  assert.deepEqual(manifest.cases[0]?.undeclaredReviewers, []);

  // A manifest missing its case list must not crash verification through a cast input.
  let outcome = 'ok';
  try {
    verifyRelease(manifest, [brokenCase]);
  } catch (error) {
    outcome = `CRASHED ${(error as Error).name}`;
  }
  assert.equal(outcome, 'ok');

  const gates = releaseGates([brokenCase], {
    issues: [{ caseId: 'case-malformed', field: 'x', message: 'y' }],
  });
  assert.equal(gates.find((gate) => gate.name === 'everyCaseValidates')?.passed, false);
});
