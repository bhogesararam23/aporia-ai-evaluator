import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseObservationImport } from '../../src/app/importObservations.ts';

/**
 * Objective 3 — file-import safety. The bulk observation import parses operator-supplied JSON and
 * writes many rows at once; the route wraps the writes in one transaction, so correctness rests
 * entirely on the parser rejecting a bad payload *before* any write. The existing suite exercised
 * only a happy-path import, so these cover the adversarial shapes that decide whether a careless or
 * hostile file can partially apply or slip an inconsistent record through.
 */

function validRow(): Record<string, unknown> {
  return {
    query_ordinal: 1,
    status: 'COMPLETED',
    captured_at: '2026-11-04T10:00:00.000Z',
    answer_text: 'A captured answer.',
    citation_capture: 'CAPTURED',
  };
}

test('a non-JSON body is rejected with a single clear issue', () => {
  const result = parseObservationImport('{ not json');
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.issues[0]?.field, 'json');
});

test('valid JSON that is not an array is rejected', () => {
  for (const body of ['{}', '"hello"', '42', 'null']) {
    const result = parseObservationImport(body);
    assert.equal(result.ok, false, body);
  }
});

test('an empty array and an over-large array are both rejected', () => {
  assert.equal(parseObservationImport('[]').ok, false);
  const tooMany = JSON.stringify(Array.from({ length: 201 }, () => validRow()));
  const result = parseObservationImport(tooMany);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.issues.map((issue) => issue.message).join(' '), /200/);
  }
});

test('a row that is not an object is reported by index, not skipped', () => {
  const result = parseObservationImport(JSON.stringify([validRow(), 'oops', 7]));
  assert.equal(result.ok, false);
  assert.ok(
    result.ok === false &&
      result.issues.some((issue) => issue.field === 'rows[1]' || issue.field.startsWith('rows[1]')),
    'the offending row index is named',
  );
});

test('citations and assessments must be arrays and stay within their per-row caps', () => {
  const badCitations = parseObservationImport(
    JSON.stringify([{ ...validRow(), citations: 'not-an-array' }]),
  );
  assert.equal(badCitations.ok, false);
  const tooManyCitations = parseObservationImport(JSON.stringify({}));
  assert.equal(tooManyCitations.ok, false, 'an object body is not an array');
  const many = Array.from({ length: 21 }, () => ({
    url: 'https://example.com',
  }));
  const capped = parseObservationImport(JSON.stringify([{ ...validRow(), citations: many }]));
  assert.equal(capped.ok, false);
  const manyAssessments = Array.from({ length: 11 }, () => ({
    dimension: 'PRESENCE',
    label: 'YES',
    rationale: 'r',
    reviewer: 'Ram',
  }));
  const assessmentCap = parseObservationImport(
    JSON.stringify([{ ...validRow(), assessments: manyAssessments }]),
  );
  assert.equal(assessmentCap.ok, false);
});

test('answer-level assessments on a non-completed observation are refused', () => {
  const result = parseObservationImport(
    JSON.stringify([
      {
        ...validRow(),
        // NO_ANSWER is still a valid non-completed observation; only COMPLETED may carry a
        // statement-level answer assessment.
        status: 'NO_ANSWER',
        assessments: [
          { dimension: 'FIDELITY', label: 'ACCURATE', rationale: 'because', reviewer: 'Ram' },
        ],
      },
    ]),
  );
  assert.equal(result.ok, false);
  assert.ok(
    result.ok === false && result.issues.some((issue) => /completed/i.test(issue.message)),
    'the reason names the completed-observation requirement',
  );
});

test('all problems across rows are reported together, never one at a time', () => {
  const body = JSON.stringify([
    { ...validRow(), query_ordinal: 0 }, // ordinal out of range
    { ...validRow(), status: 'NOT_A_STATUS' }, // bad enum
  ]);
  const result = parseObservationImport(body);
  assert.equal(result.ok, false);
  assert.ok(
    result.ok === false && result.issues.length >= 2,
    'both rows’ problems surface in one pass so a reviewer fixes them together',
  );
});

test('a valid single-row import parses into mapped draft rows', () => {
  const result = parseObservationImport(
    JSON.stringify([
      {
        ...validRow(),
        citations: [{ url: 'https://example.com/a', target_owned: true }],
        assessments: [
          {
            dimension: 'FIDELITY',
            label: 'ACCURATE',
            rationale: 'matches the source',
            reviewer: 'Ram',
          },
        ],
      },
    ]),
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.length, 1);
  const row = result.value[0];
  assert.ok(row);
  assert.equal(row.queryOrdinal, 1);
  assert.equal(row.observation.status, 'COMPLETED');
  assert.equal(row.citations.length, 1);
  assert.equal(row.assessments.length, 1);
});
