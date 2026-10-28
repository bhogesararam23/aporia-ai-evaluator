import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeDatabase } from '../../src/persistence/db.ts';
import {
  approveQuerySet,
  createTestDatabase,
  insertClaimWithProposition,
  insertObservation,
  insertObservationAssessment,
  insertProject,
  insertPropositionAssessment,
  insertQuery,
  insertQuerySet,
  insertRun,
  TEST_TIME,
} from '../helpers/db.ts';

function setupObservation(projectId = 'prj_1'): ReturnType<typeof createTestDatabase> {
  const db = createTestDatabase();
  insertProject(db, { id: projectId });
  insertQuerySet(db, { projectId });
  insertQuery(db);
  approveQuerySet(db);
  insertRun(db, { projectId });
  insertObservation(db);
  return db;
}

test('proposition assessments are append-only and require review state', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertClaimWithProposition(db, { status: 'UNDER_REVIEW' });
    insertPropositionAssessment(db);
    assert.throws(() => insertPropositionAssessment(db, { id: 'pasm_2', version: 1 }), /UNIQUE/);
    assert.throws(
      () =>
        db
          .prepare('UPDATE proposition_assessments SET label = ? WHERE id = ?')
          .run('CONTRADICTED', 'pasm_1'),
      /append-only/,
    );
    insertPropositionAssessment(db, {
      id: 'pasm_2',
      version: 2,
      label: 'PARTIALLY_SUPPORTED',
      rationale: 'Only release 1.0 is supported.',
    });
    const rows = db
      .prepare('SELECT version, label FROM proposition_assessments ORDER BY version')
      .all()
      .map((row) => ({ version: row['version'], label: row['label'] }));
    assert.deepEqual(rows, [
      { version: 1, label: 'SUPPORTED_WITHIN_SCOPE' },
      { version: 2, label: 'PARTIALLY_SUPPORTED' },
    ]);
  } finally {
    closeDatabase(db);
  }
});

test('proposition assessments reject early claim states and cross-project targets', () => {
  const db = createTestDatabase();
  try {
    insertProject(db, { id: 'prj_1' });
    insertProject(db, { id: 'prj_2' });
    insertClaimWithProposition(db, { status: 'DECOMPOSED' });
    assert.throws(() => insertPropositionAssessment(db), /under review/);

    insertClaimWithProposition(db, {
      projectId: 'prj_2',
      claimId: 'clm_2',
      revisionId: 'rev_2',
      propositionId: 'prp_2',
    });
    assert.throws(
      () => insertPropositionAssessment(db, { propositionId: 'prp_2' }),
      /must belong to the project/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('proposition assessment evidence snapshots must be valid JSON', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertClaimWithProposition(db);
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO proposition_assessments
              (id, project_id, proposition_id, version, label, rationale, method, reviewer,
               evidence_snapshot_json, created_at)
             VALUES ('pasm_bad', 'prj_1', 'prp_1', 1, 'NOT_ASSESSED', 'x', 'HUMAN', 'Ram',
               'not-json', ?)`,
          )
          .run(TEST_TIME),
      /json_valid|CHECK/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('observation assessments enforce dimension labels and run state', () => {
  const db = setupObservation();
  try {
    insertObservationAssessment(db);
    insertObservationAssessment(db, {
      id: 'oasm_2',
      dimension: 'ATTRIBUTION',
      label: 'CORRECT',
      attributionRole: 'AUTHOR',
      rationale: 'Names the author and role.',
    });
    assert.throws(
      () => insertObservationAssessment(db, { id: 'oasm_3', label: 'ACCURATE' }),
      /does not match/,
    );
    assert.throws(
      () =>
        insertObservationAssessment(db, {
          id: 'oasm_4',
          dimension: 'FIDELITY',
          label: 'ACCURATE',
          attributionRole: 'AUTHOR',
        }),
      /only valid for attribution/,
    );
    assert.throws(() => insertObservationAssessment(db, { id: 'oasm_5', version: 1 }), /UNIQUE/);
    assert.throws(
      () =>
        db
          .prepare('UPDATE observation_assessments SET label = ? WHERE id = ?')
          .run('NOT_MENTIONED', 'oasm_1'),
      /append-only/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('observation assessments reject early or cross-project observations', () => {
  const db = setupObservation();
  try {
    insertProject(db, { id: 'prj_2' });
    assert.throws(
      () => insertObservationAssessment(db, { projectId: 'prj_2' }),
      /must belong to the project/,
    );
    db.prepare('UPDATE runs SET status = ?, finalized_at = ? WHERE id = ?').run(
      'FINALIZED',
      TEST_TIME,
      'run_1',
    );
    assert.throws(
      () => insertObservationAssessment(db, { id: 'oasm_late', version: 2 }),
      /open run/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('deleting a project cascades both assessment tables', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertClaimWithProposition(db);
    insertPropositionAssessment(db);
    insertQuerySet(db);
    insertQuery(db);
    approveQuerySet(db);
    insertRun(db);
    insertObservation(db);
    insertObservationAssessment(db);
    db.prepare('DELETE FROM projects WHERE id = ?').run('prj_1');
    for (const table of ['proposition_assessments', 'observation_assessments']) {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
      assert.equal(row?.['count'], 0, table);
    }
  } finally {
    closeDatabase(db);
  }
});
