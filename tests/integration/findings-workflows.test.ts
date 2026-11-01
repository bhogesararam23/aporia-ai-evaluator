import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError } from '../../src/errors.ts';
import { closeDatabase } from '../../src/persistence/db.ts';
import { appendAuditEvent } from '../../src/persistence/audit.ts';
import {
  addFindingReference,
  availableFocusMetrics,
  createFinding,
  getFinding,
  listFindings,
  previewRetestComparison,
  recordRetestComparison,
  removeFindingReference,
  transitionFinding,
  updateFindingDetails,
  type FindingInput,
} from '../../src/persistence/repositories/findings.ts';
import {
  approveQuerySet,
  createTestDatabase,
  insertAnswerClaim,
  insertClaimWithProposition,
  insertObservation,
  insertObservationAssessment,
  insertProject,
  insertQuery,
  insertQuerySet,
  insertReport,
  insertRun,
  TEST_ACTOR,
  TEST_TIME,
} from '../helpers/db.ts';

const context = { actor: TEST_ACTOR, at: TEST_TIME };

function findingInput(overrides: Partial<FindingInput> = {}): FindingInput {
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
    firstObservedAt: '2026-10-20T10:00:00.000Z',
    lastObservedAt: '2026-10-28T10:00:00.000Z',
    references: [],
    ...overrides,
  };
}

function seeded(): ReturnType<typeof createTestDatabase> {
  const db = createTestDatabase();
  insertProject(db, { id: 'prj_1' });
  insertProject(db, { id: 'prj_2' });
  insertClaimWithProposition(db, {
    projectId: 'prj_1',
    claimId: 'clm_1',
    revisionId: 'rev_1',
    propositionId: 'prp_1',
  });
  insertClaimWithProposition(db, {
    projectId: 'prj_2',
    claimId: 'clm_2',
    revisionId: 'rev_2',
    propositionId: 'prp_2',
  });
  insertQuerySet(db, { projectId: 'prj_1' });
  insertQuery(db);
  approveQuerySet(db);
  insertRun(db, { projectId: 'prj_1', id: 'run_base' });
  insertObservation(db, { runId: 'run_base', id: 'obs_base', queryId: 'qry_1' });
  return db;
}

function findingId(db: ReturnType<typeof createTestDatabase>): string {
  return createFinding(db, 'prj_1', findingInput(), context).id;
}

/**
 * Only a finalized run can be a measurement baseline, so a comparison fixture has to finalize one.
 * An open or cancelled run would let an unfinished capture become a trend.
 */
function finalize(db: ReturnType<typeof createTestDatabase>, runId: string): void {
  db.prepare('UPDATE runs SET status = ?, finalized_at = ? WHERE id = ?').run(
    'FINALIZED',
    TEST_TIME,
    runId,
  );
}

test('a finding is created open, numbered per project, and audited once', () => {
  const db = seeded();
  try {
    const first = createFinding(db, 'prj_1', findingInput(), context);
    assert.equal(first.status, 'OPEN');
    assert.equal(first.referenceNumber, 1);
    assert.equal(first.reference, 'F-0001');
    const second = createFinding(db, 'prj_1', findingInput({ title: 'A second tracked problem' }), {
      ...context,
      at: '2026-10-28T12:00:01.000Z',
    });
    assert.equal(second.reference, 'F-0002');
    // Per-project numbering, so two projects never read as the same finding.
    assert.equal(
      createFinding(db, 'prj_2', findingInput({ title: 'Other project finding' }), context)
        .reference,
      'F-0001',
    );
    assert.equal(listFindings(db, 'prj_1').length, 2);
    assert.equal(second.updates.length, 1, 'the opening entry is recorded as history');
  } finally {
    closeDatabase(db);
  }
});

test('a finding cannot be created already improved, closed, or triaged', () => {
  const db = seeded();
  try {
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO remediation_findings
              (id, project_id, reference_number, title, observed_issue, supporting_evidence,
               cause, severity, severity_rationale, recommended_action, owner_label, status,
               first_observed_at, last_observed_at, created_by, created_at, updated_at)
             VALUES ('x', 'prj_1', 9, 'aaaa', 'bbbb', 'cccc', 'OTHER', 'LOW', 'dddd', 'eeee',
               'ram', 'IMPROVED', ?, ?, 'Ram', ?, ?)`,
          )
          .run(TEST_TIME, TEST_TIME, TEST_TIME, TEST_TIME),
      /must start OPEN/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('the lifecycle is walked, not jumped, and no status is reachable by hand', () => {
  const db = seeded();
  try {
    const id = findingId(db);
    assert.throws(
      () =>
        transitionFinding(
          db,
          'prj_1',
          id,
          { status: 'IMPROVED', note: 'looks better now' },
          context,
        ),
      (error: unknown) => error instanceof AppError && error.code === 'CONFLICT',
    );
    assert.throws(
      () =>
        transitionFinding(
          db,
          'prj_1',
          id,
          { status: 'RETEST_REQUIRED', note: 'too early' },
          context,
        ),
      /cannot move directly/,
    );
    transitionFinding(
      db,
      'prj_1',
      id,
      { status: 'ACCEPTED', note: 'Confirmed the omission.' },
      context,
    );
    transitionFinding(
      db,
      'prj_1',
      id,
      { status: 'IN_PROGRESS', note: 'Drafting the page change.' },
      context,
    );
    transitionFinding(
      db,
      'prj_1',
      id,
      { status: 'RETEST_REQUIRED', note: 'Page updated; a later capture is needed.' },
      context,
    );
    // A measured status is refused even from the correct prior state, without a comparison.
    assert.throws(
      () =>
        transitionFinding(db, 'prj_1', id, { status: 'IMPROVED', note: 'Surely better.' }, context),
      /requires a stored retest comparison/,
    );
    const finding = getFinding(db, 'prj_1', id);
    assert.equal(finding?.status, 'RETEST_REQUIRED');
    assert.deepEqual(
      finding?.updates.map((update) => update.newStatus),
      ['OPEN', 'ACCEPTED', 'IN_PROGRESS', 'RETEST_REQUIRED'],
    );
  } finally {
    closeDatabase(db);
  }
});

test('closure and wont-fix require a written rationale', () => {
  const db = seeded();
  try {
    const id = findingId(db);
    assert.throws(
      () =>
        transitionFinding(
          db,
          'prj_1',
          id,
          { status: 'CLOSED_WITH_RATIONALE', note: 'done' },
          context,
        ),
      (error: unknown) => error instanceof AppError && error.code === 'INVALID_INPUT',
    );
    transitionFinding(
      db,
      'prj_1',
      id,
      {
        status: 'WONT_FIX',
        note: 'Out of scope for us.',
        rationale: 'The funder is contractually silent.',
      },
      context,
    );
    assert.equal(
      getFinding(db, 'prj_1', id)?.statusRationale,
      'The funder is contractually silent.',
    );
    // A terminal state absorbs nothing further.
    assert.throws(
      () => transitionFinding(db, 'prj_1', id, { status: 'OPEN', note: 'reopened' }, context),
      /cannot move directly/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('a retest comparison decides the status, and only within its own outcome', () => {
  const db = seeded();
  try {
    const id = findingId(db);
    transitionFinding(db, 'prj_1', id, { status: 'ACCEPTED', note: 'Accepted.' }, context);
    transitionFinding(
      db,
      'prj_1',
      id,
      { status: 'RETEST_REQUIRED', note: 'Change made upstream.' },
      context,
    );
    // A genuinely later capture under the same configuration, both sides finalized.
    insertRun(db, { projectId: 'prj_1', id: 'run_later' });
    insertObservation(db, { runId: 'run_later', id: 'obs_later', queryId: 'qry_1' });
    // A mention rate needs a presence verdict on both sides, or the honest comparison is "no
    // measurement exists" rather than "unchanged". Assessments go in before the run is finalized.
    insertObservationAssessment(db, { id: 'oasm_base', observationId: 'obs_base' });
    insertObservationAssessment(db, { id: 'oasm_later', observationId: 'obs_later' });
    finalize(db, 'run_base');
    finalize(db, 'run_later');
    const focus = 'mention_rate';
    const preview = previewRetestComparison(db, 'prj_1', 'run_base', 'run_later', focus);
    assert.equal(preview.comparable, true);
    assert.match(preview.causalBoundary, /association, not a cause/);
    // Identical captures produce the same value, so the honest outcome is unchanged.
    assert.equal(preview.outcome, 'UNCHANGED');
    recordRetestComparison(db, 'prj_1', id, preview, focus, context);
    // IMPROVED is still refused, because no stored comparison said it improved.
    assert.throws(
      () => transitionFinding(db, 'prj_1', id, { status: 'IMPROVED', note: 'wishful' }, context),
      /requires a stored retest comparison/,
    );
    transitionFinding(db, 'prj_1', id, { status: 'UNCHANGED', note: 'Same as before.' }, context);
    assert.equal(getFinding(db, 'prj_1', id)?.status, 'UNCHANGED');
  } finally {
    closeDatabase(db);
  }
});

test('a non-comparable retest can only ever record unable to verify', () => {
  const db = seeded();
  try {
    const id = findingId(db);
    transitionFinding(db, 'prj_1', id, { status: 'ACCEPTED', note: 'Accepted.' }, context);
    transitionFinding(db, 'prj_1', id, { status: 'RETEST_REQUIRED', note: 'Retest.' }, context);
    // A later run recorded under a different provider label is not comparable. Run configuration is
    // immutable, so the difference has to be present when the run is created.
    insertRun(db, {
      projectId: 'prj_1',
      id: 'run_other',
      providerLabel: 'Different assistant',
    });
    insertObservation(db, { runId: 'run_other', id: 'obs_other', queryId: 'qry_1' });
    finalize(db, 'run_base');
    finalize(db, 'run_other');
    const preview = previewRetestComparison(db, 'prj_1', 'run_base', 'run_other', 'mention_rate');
    assert.equal(preview.comparable, false);
    assert.ok(preview.reasons.some((reason) => /provider label differs/.test(reason)));
    assert.equal(preview.outcome, 'NOT_COMPARABLE');
    recordRetestComparison(db, 'prj_1', id, preview, 'mention_rate', context);
    assert.throws(
      () =>
        transitionFinding(
          db,
          'prj_1',
          id,
          { status: 'IMPROVED', note: 'counts as fixed' },
          context,
        ),
      /requires a stored retest comparison/,
    );
    transitionFinding(
      db,
      'prj_1',
      id,
      { status: 'UNABLE_TO_VERIFY', note: 'The later run used a different provider.' },
      context,
    );
    assert.equal(getFinding(db, 'prj_1', id)?.status, 'UNABLE_TO_VERIFY');
  } finally {
    closeDatabase(db);
  }
});

test('an open run is never a baseline, so an abandoned capture cannot become a trend', () => {
  const db = seeded();
  try {
    // A self-comparison is refused before anything is read.
    assert.throws(
      () => previewRetestComparison(db, 'prj_1', 'run_base', 'run_base', 'mention_rate'),
      /cannot be compared with itself/,
    );
    insertRun(db, { projectId: 'prj_1', id: 'run_later' });
    insertObservation(db, { runId: 'run_later', id: 'obs_later', queryId: 'qry_1' });
    finalize(db, 'run_later');
    // run_base is still OPEN: an unfinished capture must not become a baseline.
    assert.throws(
      () => previewRetestComparison(db, 'prj_1', 'run_base', 'run_later', 'mention_rate'),
      /Only a finalized run can be compared; run run_base is open\./,
    );
    // A focus metric outside the declared set is refused rather than silently producing no delta.
    assert.throws(
      () => previewRetestComparison(db, 'prj_1', 'run_later', 'run_base', 'overall_score'),
      /Choose a metric the retest is about/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('typed references refuse another project records', () => {
  const db = seeded();
  try {
    const id = findingId(db);
    addFindingReference(db, 'prj_1', id, { type: 'claim', id: 'clm_1' }, context);
    assert.throws(
      () => addFindingReference(db, 'prj_1', id, { type: 'claim', id: 'clm_2' }, context),
      /same project/,
    );
    assert.throws(
      () => addFindingReference(db, 'prj_1', id, { type: 'proposition', id: 'prp_2' }, context),
      /same project/,
    );
    // A target that does not exist at all is refused by the same scope rule rather than by the
    // foreign key: the BEFORE INSERT check runs first, and "no such record in this project" is the
    // honest description of both failures from the point of view of the operator recording it.
    assert.throws(
      () => addFindingReference(db, 'prj_1', id, { type: 'run', id: 'run_missing' }, context),
      /must point at a record in the same project/,
    );
    const finding = getFinding(db, 'prj_1', id);
    assert.deepEqual(
      finding?.references.map((reference) => reference.type),
      ['claim'],
    );
  } finally {
    closeDatabase(db);
  }
});

test('a reference row must point at exactly one target', () => {
  const db = seeded();
  try {
    const id = findingId(db);
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO finding_references (id, project_id, finding_id, created_at)
             VALUES ('r1', 'prj_1', ?, ?)`,
          )
          .run(id, TEST_TIME),
      /CHECK constraint failed/,
    );
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO finding_references (id, project_id, finding_id, claim_id, run_id, created_at)
             VALUES ('r2', 'prj_1', ?, 'clm_1', 'run_base', ?)`,
          )
          .run(id, TEST_TIME),
      /CHECK constraint failed/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('references are pointers: removable and audited, never editable', () => {
  const db = seeded();
  try {
    const id = findingId(db);
    const withRef = addFindingReference(
      db,
      'prj_1',
      id,
      { type: 'observation', id: 'obs_base' },
      context,
    );
    const reference = withRef.references[0];
    assert.ok(reference);
    assert.throws(
      () =>
        db
          .prepare('UPDATE finding_references SET claim_id = ? WHERE id = ?')
          .run('clm_1', reference.id),
      /cannot be edited/,
    );
    const removed = removeFindingReference(db, 'prj_1', id, reference.id, {
      ...context,
      at: '2026-10-28T12:00:05.000Z',
    });
    assert.equal(removed.references.length, 0);
    const actions = db
      .prepare('SELECT action FROM audit_events WHERE entity_id = ? ORDER BY created_at')
      .all(id)
      .map((row) => String((row as Record<string, unknown>)['action']));
    assert.deepEqual(actions, [
      'finding.created',
      'finding.referenced',
      'finding.reference-removed',
    ]);
  } finally {
    closeDatabase(db);
  }
});

test('severity and cause changes are history-backed and append-only', () => {
  const db = seeded();
  try {
    const id = findingId(db);
    const updated = updateFindingDetails(
      db,
      'prj_1',
      id,
      { severity: 'HIGH', note: 'Raised after reviewing who depends on the funder fact.' },
      context,
    );
    assert.equal(updated.severity, 'HIGH');
    assert.equal(updated.updates.length, 2);
    assert.throws(
      () =>
        db.prepare('UPDATE finding_updates SET note = ? WHERE finding_id = ?').run('rewritten', id),
      /append-only/,
    );
    assert.throws(
      () =>
        db
          .prepare('UPDATE remediation_findings SET created_by = ? WHERE id = ?')
          .run('someone', id),
      /immutable/,
    );
    // The history guard has to be load-bearing on its own, not satisfied by an unrelated note that
    // happens to share a timestamp. A severity change written at a fresh instant with no entry is
    // refused.
    assert.throws(
      () =>
        db
          .prepare('UPDATE remediation_findings SET severity = ?, updated_at = ? WHERE id = ?')
          .run('LOW', '2026-11-01T09:00:00.000Z', id),
      /must be recorded as an update first/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('finding updates cannot be backdated into the sequence', () => {
  const db = seeded();
  try {
    const id = findingId(db);
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO finding_updates
              (id, project_id, finding_id, sequence, previous_status, new_status, note, actor, created_at)
             VALUES ('u9', 'prj_1', ?, 7, 'OPEN', 'ACCEPTED', 'out of order', 'Ram', ?)`,
          )
          .run(id, TEST_TIME),
      /appended in sequence/,
    );
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO finding_updates
              (id, project_id, finding_id, sequence, previous_status, new_status, note, actor, created_at)
             VALUES ('u8', 'prj_1', ?, 2, NULL, 'ACCEPTED', 'missing prior', 'Ram', ?)`,
          )
          .run(id, TEST_TIME),
      /only the first update/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('comparisons are append-only and scoped to one project', () => {
  const db = seeded();
  try {
    insertRun(db, { projectId: 'prj_1', id: 'run_later' });
    insertObservation(db, { runId: 'run_later', id: 'obs_later', queryId: 'qry_1' });
    finalize(db, 'run_base');
    finalize(db, 'run_later');
    const id = findingId(db);
    transitionFinding(db, 'prj_1', id, { status: 'ACCEPTED', note: 'Accepted.' }, context);
    transitionFinding(db, 'prj_1', id, { status: 'RETEST_REQUIRED', note: 'Retest.' }, context);
    const preview = previewRetestComparison(db, 'prj_1', 'run_base', 'run_later', 'mention_rate');
    recordRetestComparison(db, 'prj_1', id, preview, 'mention_rate', context);
    const comparisonId = (getFinding(db, 'prj_1', id)?.comparisons[0] as { id: string }).id;
    assert.throws(
      () =>
        db
          .prepare('UPDATE retest_comparisons SET outcome = ? WHERE id = ?')
          .run('IMPROVED', comparisonId),
      /append-only/,
    );
    assert.throws(
      () =>
        db.prepare('UPDATE retest_comparisons SET comparable = 1 WHERE id = ?').run(comparisonId),
      /append-only/,
    );
    // Each scope rule is exercised on its own. Two BEFORE INSERT triggers can both reject the same
    // row, and SQLite orders them by name, so a single cross-project field would make the asserted
    // message depend on trigger naming rather than on the rule being tested.
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO retest_comparisons
              (id, project_id, finding_id, base_run_id, later_run_id, comparable, outcome,
               reasons_json, deltas_json, created_by, created_at)
             VALUES ('c2', 'prj_2', NULL, 'run_base', 'run_later', 1, 'UNCHANGED', '[]', '[]', 'Ram', ?)`,
          )
          .run(TEST_TIME),
      /both runs in a comparison must belong to the project/,
    );
    // The finding side of the same boundary is checked separately: a prj_2 finding cannot be
    // attached to a comparison filed under prj_1.
    const foreign = createFinding(
      db,
      'prj_2',
      findingInput({ title: 'A finding in the other project' }),
      context,
    ).id;
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO retest_comparisons
              (id, project_id, finding_id, base_run_id, later_run_id, comparable, outcome,
               reasons_json, deltas_json, created_by, created_at)
             VALUES ('c4', 'prj_1', ?, 'run_base', 'run_later', 1, 'UNCHANGED', '[]', '[]', 'Ram', ?)`,
          )
          .run(foreign, TEST_TIME),
      /a comparison must reference a finding in the same project/,
    );
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO retest_comparisons
              (id, project_id, finding_id, base_run_id, later_run_id, comparable, outcome,
               reasons_json, deltas_json, created_by, created_at)
             VALUES ('c3', 'prj_1', NULL, 'run_base', 'run_base', 1, 'IMPROVED', '[]', '[]', 'Ram', ?)`,
          )
          .run(TEST_TIME),
      /CHECK constraint failed/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('a comparison on an open run leaves no trace and writes no audit row', () => {
  const db = seeded();
  try {
    const id = findingId(db);
    const before = db.prepare('SELECT COUNT(*) AS n FROM audit_events').get() as Record<
      string,
      unknown
    >;
    assert.throws(
      () => previewRetestComparison(db, 'prj_1', 'run_base', 'run_base', 'mention_rate'),
      AppError,
    );
    const after = db.prepare('SELECT COUNT(*) AS n FROM audit_events').get() as Record<
      string,
      unknown
    >;
    assert.equal(Number(after['n']), Number(before['n']));
    assert.equal(getFinding(db, 'prj_1', id)?.comparisons.length, 0);
  } finally {
    closeDatabase(db);
  }
});

test('statement-level metrics are available as retest focus only where they exist', () => {
  const db = seeded();
  try {
    // Statements need an open run, so record one before the run is finalized for comparison.
    insertAnswerClaim(db, { observationId: 'obs_base' });
    finalize(db, 'run_base');
    assert.equal(availableFocusMetrics(db, 'prj_1', 'run_base').includes('mention_rate'), true);
    assert.equal(
      availableFocusMetrics(db, 'prj_1', 'run_base').includes('answer_statement_fidelity_rate'),
      true,
      'a recorded statement makes the statement-level focus measurable',
    );
    // A run with no statements has no statement-level denominator to trend.
    insertRun(db, { projectId: 'prj_1', id: 'run_empty' });
    insertObservation(db, { runId: 'run_empty', id: 'obs_empty', queryId: 'qry_1' });
    finalize(db, 'run_empty');
    assert.equal(
      availableFocusMetrics(db, 'prj_1', 'run_empty').includes('answer_statement_fidelity_rate'),
      false,
    );
    assert.equal(availableFocusMetrics(db, 'prj_1', 'run_empty').includes('mention_rate'), true);
  } finally {
    closeDatabase(db);
  }
});

test('project deletion removes findings, references, updates and comparisons', () => {
  const db = seeded();
  try {
    const id = findingId(db);
    appendAuditEvent(db, {
      projectId: 'prj_1',
      actor: TEST_ACTOR,
      action: 'report.generated',
      entityType: 'report',
      entityId: insertReport(db),
      at: TEST_TIME,
    });
    transitionFinding(db, 'prj_1', id, { status: 'ACCEPTED', note: 'Accepted.' }, context);
    transitionFinding(db, 'prj_1', id, { status: 'RETEST_REQUIRED', note: 'Retest.' }, context);
    insertRun(db, { projectId: 'prj_1', id: 'run_later' });
    insertObservation(db, { runId: 'run_later', id: 'obs_later', queryId: 'qry_1' });
    finalize(db, 'run_base');
    finalize(db, 'run_later');
    recordRetestComparison(
      db,
      'prj_1',
      id,
      previewRetestComparison(db, 'prj_1', 'run_base', 'run_later', 'mention_rate'),
      'mention_rate',
      context,
    );
    db.prepare('DELETE FROM projects WHERE id = ?').run('prj_1');
    for (const table of [
      'remediation_findings',
      'finding_references',
      'finding_updates',
      'retest_comparisons',
    ]) {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as Record<string, unknown>;
      assert.equal(Number(row['n']), 0, table);
    }
    assert.equal(getFinding(db, 'prj_1', id), null);
  } finally {
    closeDatabase(db);
  }
});
