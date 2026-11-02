import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderReport } from '../../src/app/views/report.ts';
import { buildReportSnapshot } from '../../src/reporting/snapshot.ts';
import type { ReportBuildInput, ReportSnapshot } from '../../src/reporting/types.ts';
import { answerClaim, baseInput } from '../helpers/reporting.ts';

/**
 * A report input holding two decomposed statements.
 *
 * `conflict` stores the pairing `metrics-v3` scored and `metrics-v4` refuses; `voided` withdraws the
 * second statement; `unassessed` leaves it recorded but unjustified, which is the only shape that
 * makes the review-progress figure non-zero. All three are needed because the block's new fields only
 * appear when there is something to exclude.
 */
function inputWithClaims(
  options: {
    readonly voided?: boolean;
    readonly conflict?: boolean;
    readonly unassessed?: boolean;
  } = {},
): ReportBuildInput {
  const base = baseInput();
  const second = options.conflict
    ? answerClaim('acs_2', {
        ordinal: 2,
        relevance: 'REFUSAL',
        labels: { FIDELITY: 'ACCURATE' },
        propositionLinks: [],
        citationMappings: [],
      })
    : options.voided
      ? answerClaim('acs_2', { ordinal: 2, voidedAt: '2026-11-02T10:00:00.000Z' })
      : options.unassessed
        ? answerClaim('acs_2', { ordinal: 2, labels: {}, citationMappings: [] })
        : answerClaim('acs_2', { ordinal: 2 });
  return {
    ...base,
    runs: base.runs.map((run) => ({
      ...run,
      observations: run.observations.map((observation, index) => ({
        ...observation,
        answerClaims: index === 0 ? [answerClaim('acs_1'), second] : [],
      })),
    })),
  };
}

test('a stored metrics-v1 snapshot still renders its own values and shape', () => {
  const v2 = buildReportSnapshot(baseInput());
  const v1 = structuredClone(v2);
  (v1 as { templateVersion: string }).templateVersion = 'report-template-v1';
  (v1.report as { metricsVersion: string }).metricsVersion = 'metrics-v1';
  for (const run of v1.runs) {
    const coverage = run.metrics.coverage as unknown as Record<string, unknown>;
    delete coverage['byIntent'];
    delete coverage['plannedIntents'];
    delete coverage['testedIntents'];
    delete coverage['untestedIntents'];
    delete coverage['coveredIntents'];
    delete coverage['notMentionedIntents'];
    delete coverage['unassessedIntents'];
    delete coverage['partialAssessmentIntents'];
  }

  const html = renderReport(v1, { supersededByReportId: null }).value;

  assert.match(html, /Observed answer-level coverage/);
  assert.equal(v1.runs[0]?.metrics.observedAnswerCoverage.value, 1);
  assert.equal(v1.runs[0]?.metrics.observedAnswerCoverage.numerator, 2);
  assert.equal(v1.runs[0]?.metrics.observedAnswerCoverage.denominator, 2);
  assert.doesNotMatch(html, /Intent-group coverage/);
  assert.match(html, /100/);
});

test('a metrics-v2 snapshot renders the intent-group table', () => {
  const snapshot = buildReportSnapshot(baseInput());
  const html = renderReport(snapshot, { supersededByReportId: null }).value;

  assert.match(html, /Intent-group coverage/);
  assert.match(html, /Repeated queries for one intent count once/);
});

/**
 * Turn a freshly built v4 snapshot back into the shape a v3 report stored.
 *
 * A `metrics-v3` block has no review-progress counts under their new names, no void or conflict
 * counts, and statements that carry support labels rather than mappings with the cited record's
 * state. Rendering must cope with exactly that, because stored snapshots are historical records.
 */
function asV3Snapshot(
  snapshot: ReportSnapshot,
  overrides: { readonly fidelityNumerator?: number; readonly fidelityDenominator?: number } = {},
): ReportSnapshot {
  const stored = structuredClone(snapshot) as unknown as {
    templateVersion: string;
    report: { metricsVersion: string };
    runs: unknown[];
  };
  stored.templateVersion = 'report-template-v3';
  stored.report.metricsVersion = 'metrics-v3';
  for (const rawRun of stored.runs) {
    const run = rawRun as {
      metrics: { version: string; claimLevel?: Record<string, unknown> };
      observations: { answerClaims?: unknown[] }[];
    };
    run.metrics.version = 'metrics-v3';
    for (const rawClaim of run.observations.flatMap(
      (observation) => observation.answerClaims ?? [],
    )) {
      const claim = rawClaim as Record<string, unknown>;
      const mappings = claim['citationMappings'] as { support: string }[] | undefined;
      delete claim['citationMappings'];
      if (mappings !== undefined) {
        claim['citationSupports'] = mappings.map((mapping) => mapping.support);
      }
    }
    const block = run.metrics.claimLevel;
    if (block !== undefined) {
      block['partiallyDecomposedObservations'] = block['partiallyAssessedObservations'];
      for (const key of [
        'partiallyAssessedObservations',
        'statementsRecorded',
        'statementsFidelityAssessed',
        'statementsAttributionAssessed',
        'citationMappingsRecorded',
        'citationMappingsAssessed',
        'voidedClaims',
        'labelConflictClaims',
      ]) {
        delete block[key];
      }
      if (
        overrides.fidelityNumerator !== undefined &&
        overrides.fidelityDenominator !== undefined
      ) {
        // A v3 file was written by v3 code, so its figures are not derivable from the stored rows
        // under today's rules. Overwriting them is how the test says "this is what was stored".
        block['claimFidelityRate'] = {
          ...(block['claimFidelityRate'] as object),
          numerator: overrides.fidelityNumerator,
          denominator: overrides.fidelityDenominator,
          value: overrides.fidelityNumerator / overrides.fidelityDenominator,
        };
      }
    }
  }
  return stored as unknown as ReportSnapshot;
}

test('a new report is written as metrics-v4 under report-template-v4', () => {
  const snapshot = buildReportSnapshot(inputWithClaims());
  assert.equal(snapshot.templateVersion, 'report-template-v4');
  assert.equal(snapshot.report.metricsVersion, 'metrics-v4');
  const block = snapshot.runs[0]?.metrics.claimLevel;
  assert.notEqual(block, undefined);
  assert.equal(block?.statementsRecorded, 2);
  assert.equal(block?.citationMappingsRecorded, 2);
});

test('a stored metrics-v3 snapshot renders the numbers it was written with, never new ones', () => {
  // A refusal carrying an ACCURATE label is the pairing the two versions disagree about: v3 scored
  // it, v4 excludes it. A stored v3 report must keep showing what v3 recorded, because recalculating
  // it would silently rewrite what a previous report claimed.
  const input = inputWithClaims({ conflict: true });
  const stored = asV3Snapshot(buildReportSnapshot(input), {
    fidelityNumerator: 2,
    fidelityDenominator: 2,
  });
  const html = renderReport(stored, { supersededByReportId: null }).value;
  assert.match(html, /2 \/ 2/);
  assert.match(html, /100%?/);
  assert.equal(stored.report.metricsVersion, 'metrics-v3');
  assert.match(html, /Statement fidelity rate/);

  // The same statements through current code exclude the refusal.
  const currentBlock = buildReportSnapshot(input).runs[0]?.metrics.claimLevel;
  assert.equal(currentBlock?.claimFidelityRate.denominator, 1);
  assert.equal(currentBlock?.claimFidelityRate.numerator, 1);
  assert.equal(currentBlock?.labelConflictClaims, 1);
});

test('a metrics-v3 statement without mapping states still renders its citation support', () => {
  const stored = asV3Snapshot(buildReportSnapshot(inputWithClaims()));
  const html = renderReport(stored, { supersededByReportId: null }).value;
  assert.match(html, /Citation support:/);
  assert.doesNotMatch(html, /undefined/);
  assert.doesNotMatch(html, /NaN/);
});

test('a metrics-v3 snapshot describes its single review figure as unfinished review', () => {
  // One statement assessed and one not, which is what made the v3 count non-zero.
  const stored = asV3Snapshot(buildReportSnapshot(inputWithClaims({ unassessed: true })));
  const html = renderReport(stored, { supersededByReportId: null }).value;
  assert.match(html, /awaiting a fidelity assessment/);
  // The v4 wording that could not have applied to a v3 file.
  assert.doesNotMatch(html, /Review progress —/);
});

test('a metrics-v4 snapshot states review progress as its own counts', () => {
  const html = renderReport(buildReportSnapshot(inputWithClaims({ unassessed: true })), {
    supersededByReportId: null,
  }).value;
  assert.match(html, /Review progress/);
  // The rendered page wraps text, so the assertion names the figure rather than the whole sentence.
  assert.match(html, /1 of 2 live statement/);
});

test('a voided statement is named as voided in the v4 report', () => {
  const html = renderReport(buildReportSnapshot(inputWithClaims({ voided: true })), {
    supersededByReportId: null,
  }).value;
  assert.match(html, /statement\(s\) were voided by the reviewer/);
});

test('a label that overstates its relevance is named as a conflict in the v4 report', () => {
  const html = renderReport(buildReportSnapshot(inputWithClaims({ conflict: true })), {
    supersededByReportId: null,
  }).value;
  assert.match(html, /relevance does not support/);
});
