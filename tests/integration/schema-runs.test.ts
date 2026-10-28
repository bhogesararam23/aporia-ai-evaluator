import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeDatabase } from '../../src/persistence/db.ts';
import {
  approveQuerySet,
  createTestDatabase,
  insertCitation,
  insertObservation,
  insertProject,
  insertQuery,
  insertQuerySet,
  insertRun,
  TEST_TIME,
} from '../helpers/db.ts';

function setupApprovedSet(): ReturnType<typeof createTestDatabase> {
  const db = createTestDatabase();
  insertProject(db);
  insertQuerySet(db);
  insertQuery(db);
  approveQuerySet(db);
  return db;
}

test('query sets cannot be approved while empty and freeze after approval', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertQuerySet(db);
    assert.throws(() => approveQuerySet(db), /empty query set/);
    insertQuery(db);
    approveQuerySet(db);
    const set = db.prepare('SELECT status, approved_by FROM query_sets WHERE id = ?').get('qst_1');
    assert.equal(set?.['status'], 'APPROVED');
    assert.equal(set?.['approved_by'], 'Ram');

    assert.throws(
      () =>
        db.prepare('UPDATE queries SET text = ? WHERE id = ?').run('Changed question?', 'qry_1'),
      /immutable/,
    );
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO queries
              (id, query_set_id, ordinal, text, intent, branded, expected_elements,
               inclusion_rationale, created_at)
             VALUES ('qry_2', 'qst_1', 2, 'Second question?', 'DISCOVERY', 0, 'x', 'y', ?)`,
          )
          .run(TEST_TIME),
      /immutable/,
    );
    assert.throws(
      () =>
        db.prepare('UPDATE query_sets SET description = ? WHERE id = ?').run('Changed', 'qst_1'),
      /immutable/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('query set versions are unique per name and can supersede a prior version', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertQuerySet(db, { id: 'qst_1', version: 1, status: 'APPROVED' });
    insertQuerySet(db, { id: 'qst_2', version: 2, supersedesId: 'qst_1' });
    assert.throws(() => insertQuerySet(db, { id: 'qst_3', version: 2 }), /UNIQUE/);
  } finally {
    closeDatabase(db);
  }
});

test('runs require an approved query set from the same project', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertQuerySet(db);
    insertQuery(db);
    assert.throws(() => insertRun(db), /approved query set/);
    approveQuerySet(db);
    insertRun(db);
    const run = db
      .prepare('SELECT query_set_name, query_set_version, status FROM runs WHERE id = ?')
      .get('run_1');
    assert.equal(run?.['query_set_name'], 'Core discovery');
    assert.equal(run?.['query_set_version'], 1);
    assert.equal(run?.['status'], 'OPEN');
  } finally {
    closeDatabase(db);
  }
});

test('run configuration is immutable and status transitions are constrained', () => {
  const db = setupApprovedSet();
  try {
    insertRun(db);
    assert.throws(
      () => db.prepare('UPDATE runs SET provider_label = ? WHERE id = ?').run('Changed', 'run_1'),
      /immutable/,
    );
    assert.throws(
      () => db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('ASSESSED', 'run_1'),
      /invalid run status transition/,
    );
    assert.throws(
      () => db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('FINALIZED', 'run_1'),
      /without an observation/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('observations must use a query from the run query set', () => {
  const db = setupApprovedSet();
  try {
    insertQuerySet(db, { id: 'qst_2', name: 'Other set' });
    insertQuery(db, { id: 'qry_2', querySetId: 'qst_2' });
    approveQuerySet(db, { querySetId: 'qst_2' });
    insertRun(db);
    assert.throws(
      () => insertObservation(db, { queryId: 'qry_2' }),
      /must belong to the run query set/,
    );
    insertObservation(db);
  } finally {
    closeDatabase(db);
  }
});

test('observation content is immutable, but it can be voided once while open', () => {
  const db = setupApprovedSet();
  try {
    insertRun(db);
    insertObservation(db);
    assert.throws(
      () =>
        db.prepare('UPDATE observations SET answer_text = ? WHERE id = ?').run('Changed', 'obs_1'),
      /immutable/,
    );
    assert.throws(
      () =>
        db
          .prepare('UPDATE observations SET voided_at = ?, void_reason = ? WHERE id = ?')
          .run(TEST_TIME, 'no', 'obs_1'),
      /requires a reason/,
    );
    db.prepare('UPDATE observations SET voided_at = ?, void_reason = ? WHERE id = ?').run(
      TEST_TIME,
      'Duplicate capture.',
      'obs_1',
    );
    assert.throws(
      () =>
        db
          .prepare('UPDATE observations SET voided_at = ?, void_reason = ? WHERE id = ?')
          .run(TEST_TIME, 'Second void.', 'obs_1'),
      /immutable/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('citations can be added and voided only while the run is open', () => {
  const db = setupApprovedSet();
  try {
    insertRun(db);
    insertObservation(db);
    insertCitation(db, { targetOwned: true });
    assert.throws(
      () =>
        db
          .prepare('UPDATE citations SET url = ? WHERE id = ?')
          .run('https://changed.test', 'cit_1'),
      /immutable/,
    );
    db.prepare('UPDATE citations SET voided_at = ?, void_reason = ? WHERE id = ?').run(
      TEST_TIME,
      'Wrong URL.',
      'cit_1',
    );
    assert.throws(
      () =>
        db
          .prepare('UPDATE citations SET voided_at = ?, void_reason = ? WHERE id = ?')
          .run(TEST_TIME, 'Second void.', 'cit_1'),
      /immutable/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('finalized runs are immutable and reject new observations and citations', () => {
  const db = setupApprovedSet();
  try {
    insertRun(db);
    insertObservation(db);
    insertCitation(db);
    db.prepare('UPDATE runs SET status = ?, finalized_at = ? WHERE id = ?').run(
      'FINALIZED',
      TEST_TIME,
      'run_1',
    );
    assert.throws(() => insertObservation(db, { id: 'obs_2' }), /open run/);
    assert.throws(() => insertCitation(db, { id: 'cit_2', position: 2 }), /open run/);
    assert.throws(
      () =>
        db
          .prepare('UPDATE observations SET voided_at = ?, void_reason = ? WHERE id = ?')
          .run(TEST_TIME, 'Too late.', 'obs_1'),
      /while the run is open|immutable/,
    );
    assert.throws(
      () => db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('OPEN', 'run_1'),
      /immutable/,
    );
    assert.throws(
      () => db.prepare('UPDATE runs SET notes = ? WHERE id = ?').run('Changed', 'run_1'),
      /immutable/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('cancellation requires a reason and is terminal', () => {
  const db = setupApprovedSet();
  try {
    insertRun(db);
    assert.throws(
      () => db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('CANCELLED', 'run_1'),
      /requires a reason/,
    );
    db.prepare('UPDATE runs SET status = ?, cancelled_at = ?, cancel_reason = ? WHERE id = ?').run(
      'CANCELLED',
      TEST_TIME,
      'Captured against the wrong query set.',
      'run_1',
    );
    assert.throws(
      () => db.prepare('UPDATE runs SET cancel_reason = ? WHERE id = ?').run('Changed', 'run_1'),
      /immutable/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('deleting a project cascades query sets, runs, observations, and citations', () => {
  const db = setupApprovedSet();
  try {
    insertRun(db);
    insertObservation(db);
    insertCitation(db);
    db.prepare('DELETE FROM projects WHERE id = ?').run('prj_1');
    for (const table of ['query_sets', 'queries', 'runs', 'observations', 'citations']) {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
      assert.equal(row?.['count'], 0, table);
    }
  } finally {
    closeDatabase(db);
  }
});
