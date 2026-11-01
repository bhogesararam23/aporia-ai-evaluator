import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateFindingDetailsInput,
  validateFindingDraftInput,
  validateFindingReferenceInput,
  validateFindingTransitionInput,
  validateRetestFocusInput,
} from '../../src/core/findingInputs.ts';

function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'The answer omits the funding body',
    observedIssue:
      'Both captured answers describe the project and its author but never the funder.',
    supportingEvidence: 'Two captured answers recorded under the same configuration omit it.',
    cause: 'MODEL_MISREAD_OR_OMISSION',
    severity: 'MEDIUM',
    severityRationale: 'A reader asking about funding gets no signal from either answer.',
    recommendedAction: 'State the funding relationship plainly on the project page.',
    ownerLabel: 'ram-local',
    firstObservedAt: '2026-10-20T10:00:00Z',
    lastObservedAt: '2026-10-28T10:00:00Z',
    ...overrides,
  };
}

function fields(result: { issues?: readonly { field: string; message: string }[] }): string[] {
  return (result.issues ?? []).map((issue) => issue.field);
}

test('a complete draft is accepted and normalised', () => {
  const result = validateFindingDraftInput(draft());
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.title, 'The answer omits the funding body');
  // Timestamps are stored as one canonical instant, so a later comparison is not reading two
  // spellings of the same time.
  assert.equal(result.value.firstObservedAt, '2026-10-20T10:00:00.000Z');
  assert.equal(result.value.severity, 'MEDIUM');
  assert.deepEqual(result.value.references, []);
});

test('every field problem is reported at once, not one per submission', () => {
  const result = validateFindingDraftInput(
    draft({ title: '', severity: 'CRITICAL', observedIssue: 'ab', ownerLabel: '   ' }),
  );
  assert.equal(result.ok, false);
  assert.deepEqual(fields(result).sort(), ['observedIssue', 'ownerLabel', 'severity', 'title']);
});

test('an observed window that runs backwards is refused', () => {
  const result = validateFindingDraftInput(
    draft({ firstObservedAt: '2026-10-28T10:00:00Z', lastObservedAt: '2026-10-20T10:00:00Z' }),
  );
  assert.equal(result.ok, false);
  assert.deepEqual(fields(result), ['lastObservedAt']);
});

test('a malformed timestamp is refused with the format it wanted', () => {
  const result = validateFindingDraftInput(draft({ firstObservedAt: '20 October' }));
  assert.equal(result.ok, false);
  const issue = (result.issues ?? [])[0];
  assert.equal(issue?.field, 'firstObservedAt');
  assert.match(issue?.message ?? '', /ISO 8601/);
});

test('text beyond the stored bounds is refused before it reaches the schema', () => {
  const result = validateFindingDraftInput(
    draft({ title: 't'.repeat(301), supportingEvidence: 'e'.repeat(8001) }),
  );
  assert.equal(result.ok, false);
  assert.deepEqual(fields(result).sort(), ['supportingEvidence', 'title']);
});

test('a control character in a note is refused rather than stored', () => {
  // A raw escape sequence reaching a server-rendered page or a CSV export is an injection surface,
  // and the schema does not look for it.
  const result = validateFindingTransitionInput({
    status: 'ACCEPTED',
    note: `Confirmed.\u0007`,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(fields(result), ['note']);
});

test('a status change needs a valid status and a written note', () => {
  assert.equal(
    validateFindingTransitionInput({ status: 'DONE', note: 'Closed it out.' }).ok,
    false,
  );
  assert.equal(validateFindingTransitionInput({ status: 'ACCEPTED', note: 'ab' }).ok, false);
  const result = validateFindingTransitionInput({
    status: 'CLOSED_WITH_RATIONALE',
    note: 'The funder is now named on the page.',
    rationale: 'Confirmed in the latest capture.',
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  // The rationale stays optional here: the lifecycle decides when one is owed.
  assert.equal(result.value.rationale, 'Confirmed in the latest capture.');
  assert.equal(result.value.comparisonId, undefined);
});

test('a details edit must actually change something', () => {
  const empty = validateFindingDetailsInput({ note: 'Nothing moved here.' });
  assert.equal(empty.ok, false);
  assert.deepEqual(fields(empty), ['severity']);
  const moved = validateFindingDetailsInput({
    note: 'Raised after reviewing who depends on the funder fact.',
    severity: 'HIGH',
  });
  assert.equal(moved.ok, true);
});

test('a blank optional details field is read as no change, not as an empty value', () => {
  const result = validateFindingDetailsInput({
    note: 'Only the owner label moved.',
    ownerLabel: '   ',
    severity: 'HIGH',
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.ownerLabel, undefined);
});

test('a reference needs a known type and a target identifier', () => {
  assert.equal(
    validateFindingReferenceInput({ referenceType: 'screenshot', referenceId: 'x' }).ok,
    false,
  );
  assert.equal(
    validateFindingReferenceInput({ referenceType: 'run', referenceId: '  ' }).ok,
    false,
  );
  const result = validateFindingReferenceInput({ referenceType: 'run', referenceId: 'run_1' });
  assert.equal(result.ok, true);
});

test('a retest cannot be pointed at the same run twice', () => {
  const same = validateRetestFocusInput({
    baseRunId: 'run_1',
    laterRunId: 'run_1',
    focusMetric: 'mention_rate',
  });
  assert.equal(same.ok, false);
  assert.deepEqual(fields(same), ['laterRunId']);
  const pair = validateRetestFocusInput({
    baseRunId: 'run_1',
    laterRunId: 'run_2',
    focusMetric: 'citation_support_rate',
  });
  assert.equal(pair.ok, true);
});
