import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReportSnapshot } from '../../src/reporting/snapshot.ts';
import type { ReportFindingInput } from '../../src/reporting/types.ts';
import { REPORT_TEMPLATE_VERSION } from '../../src/reporting/types.ts';
import { baseInput } from '../helpers/reporting.ts';

function finding(overrides: Partial<ReportFindingInput> = {}): ReportFindingInput {
  return {
    referenceNumber: 1,
    title: 'The answer omits the funding body',
    observedIssue: 'Both captured answers describe the author but never the funder.',
    supportingEvidence: 'Two captured answers recorded under the same configuration omit it.',
    cause: 'MODEL_MISREAD_OR_OMISSION',
    severity: 'MEDIUM',
    severityRationale: 'A reader asking about funding gets no signal from either answer.',
    recommendedAction: 'State the funding relationship plainly on the project page.',
    ownerLabel: 'ram-local',
    status: 'RETEST_REQUIRED',
    statusRationale: null,
    reportSuggestionKey: null,
    firstObservedAt: '2026-10-20T10:00:00.000Z',
    lastObservedAt: '2026-10-28T10:00:00.000Z',
    createdBy: 'Ram',
    createdAt: '2026-10-28T12:00:00.000Z',
    updatedAt: '2026-10-28T12:30:00.000Z',
    references: [{ type: 'run', targetId: 'run_1' }],
    updates: [
      {
        sequence: 1,
        previousStatus: null,
        newStatus: 'OPEN',
        note: 'Recorded as MEDIUM and left open.',
        actor: 'Ram',
        at: '2026-10-28T12:00:00.000Z',
        comparisonIndex: null,
      },
      {
        sequence: 2,
        previousStatus: 'OPEN',
        newStatus: 'ACCEPTED',
        note: 'Confirmed against the captured answers.',
        actor: 'Ram',
        at: '2026-10-28T12:15:00.000Z',
        comparisonIndex: -1,
      },
    ],
    comparisons: [],
    ...overrides,
  };
}

test('a snapshot built without finding data carries no findings section', () => {
  const snapshot = buildReportSnapshot(baseInput());
  assert.equal('findings' in snapshot, false);
  assert.equal(snapshot.templateVersion, REPORT_TEMPLATE_VERSION);
});

test('an explicit empty list means nothing was tracked, which is not the same as no section', () => {
  const snapshot = buildReportSnapshot({ ...baseInput(), findings: [] });
  assert.deepEqual(snapshot.findings, []);
  // No findings exist, so the operator-asserted-label limitation must not appear either.
  assert.equal(
    snapshot.limitations.some((limitation) => limitation.includes('Owner and actor labels')),
    false,
  );
});

test('a tracked finding is copied whole, numbered for its project, and ordered', () => {
  const snapshot = buildReportSnapshot({
    ...baseInput(),
    findings: [finding({ referenceNumber: 3 }), finding({ referenceNumber: 1 })],
  });
  assert.deepEqual(
    snapshot.findings?.map((row) => row.reference),
    ['F-0001', 'F-0003'],
  );
  const first = snapshot.findings?.[0];
  assert.equal(first?.status, 'RETEST_REQUIRED');
  assert.equal(first?.ownerLabel, 'ram-local');
  assert.deepEqual(first?.references, [{ type: 'run', targetId: 'run_1' }]);
  assert.equal(first?.updates.length, 2, 'the route to a status is part of the record');
  // A pointer stores an identity, so nothing from the pointed-at record is copied in.
  assert.equal(JSON.stringify(first).includes('Project A'), false);
});

test('a stored comparison travels with the finding and keeps its reasons', () => {
  const snapshot = buildReportSnapshot({
    ...baseInput(),
    findings: [
      finding({
        status: 'UNCHANGED',
        comparisons: [
          {
            baseRunId: 'run_1',
            laterRunId: 'run_2',
            comparable: false,
            outcome: 'NOT_COMPARABLE',
            reasons: ['The locale differs: en then, fr now.'],
            statementNote: null,
            createdBy: 'Ram',
            at: '2026-10-29T09:00:00.000Z',
          },
        ],
      }),
    ],
  });
  const comparison = snapshot.findings?.[0]?.comparisons[0];
  assert.equal(comparison?.comparable, false);
  assert.deepEqual(comparison?.reasons, ['The locale differs: en then, fr now.']);
  // The update log refers to a comparison by position, never by an internal identifier.
  assert.equal(snapshot.findings?.[0]?.updates[1]?.comparisonIndex, -1);
  assert.equal(JSON.stringify(snapshot.findings).includes('rtc_'), false);
});

test('tracking a finding adds the limits of what a finding can claim', () => {
  const snapshot = buildReportSnapshot({ ...baseInput(), findings: [finding()] });
  const labelLimitation = snapshot.limitations.find((limitation) =>
    limitation.includes('Owner and actor labels'),
  );
  assert.ok(labelLimitation, 'a finding is never independently reviewed');
  assert.match(labelLimitation ?? '', /no accounts/);
  // No comparison is stored, so the causal-boundary line is not yet owed.
  assert.equal(
    snapshot.limitations.some((limitation) => limitation.includes('association between two')),
    false,
  );

  const measured = buildReportSnapshot({
    ...baseInput(),
    findings: [
      finding({
        comparisons: [
          {
            baseRunId: 'run_1',
            laterRunId: 'run_2',
            comparable: true,
            outcome: 'UNCHANGED',
            reasons: [],
            statementNote: null,
            createdBy: 'Ram',
            at: '2026-10-29T09:00:00.000Z',
          },
        ],
      }),
    ],
  });
  assert.ok(
    measured.limitations.some((limitation) => limitation.includes('association between two')),
    'a stored comparison must carry its causal limit with it',
  );
});
