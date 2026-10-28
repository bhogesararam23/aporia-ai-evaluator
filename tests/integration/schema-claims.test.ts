import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeDatabase } from '../../src/persistence/db.ts';
import {
  createTestDatabase,
  insertClaimWithProposition,
  insertProject,
  TEST_TIME,
} from '../helpers/db.ts';

test('claim revisions and propositions are immutable', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertClaimWithProposition(db);
    assert.throws(
      () =>
        db
          .prepare('UPDATE claim_revisions SET text = ? WHERE id = ?')
          .run('Changed text here.', 'rev_1'),
      /immutable/,
    );
    assert.throws(
      () => db.prepare('UPDATE propositions SET text = ? WHERE id = ?').run('Changed.', 'prp_1'),
      /immutable/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('propositions cannot be added after review starts', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertClaimWithProposition(db, { status: 'UNDER_REVIEW' });
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO propositions
              (id, claim_revision_id, ordinal, text, evidence_requirements,
               decomposition_version, created_at)
             VALUES ('prp_2', 'rev_1', 2, 'Another proposition.', 'Evidence.', 'v1', ?)`,
          )
          .run(TEST_TIME),
      /locked after review/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('claim status transitions are validated in the database', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertClaimWithProposition(db);
    assert.throws(
      () => db.prepare('UPDATE claims SET status = ? WHERE id = ?').run('SUBMITTED', 'clm_1'),
      /invalid claim status transition/,
    );
    db.prepare('UPDATE claims SET status = ? WHERE id = ?').run('ASSESSED', 'clm_1');
    assert.throws(
      () => db.prepare('UPDATE claims SET status = ? WHERE id = ?').run('DECOMPOSED', 'clm_1'),
      /invalid claim status transition/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('a new revision may reset the claim status to submitted', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertClaimWithProposition(db, { status: 'ASSESSED' });
    db.prepare(
      `INSERT INTO claim_revisions
        (id, claim_id, revision_number, text, locale, decomposition_version, created_by, created_at)
       VALUES ('rev_2', 'clm_1', 2, 'A corrected claim revision.', 'en', 'v1', 'Ram', ?)`,
    ).run(TEST_TIME);
    db.prepare('UPDATE claims SET current_revision_id = ?, status = ? WHERE id = ?').run(
      'rev_2',
      'SUBMITTED',
      'clm_1',
    );
    const row = db
      .prepare('SELECT status, current_revision_id FROM claims WHERE id = ?')
      .get('clm_1');
    assert.equal(row?.['status'], 'SUBMITTED');
    assert.equal(row?.['current_revision_id'], 'rev_2');
  } finally {
    closeDatabase(db);
  }
});

test('the current revision must belong to the claim', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertClaimWithProposition(db);
    db.prepare(
      `INSERT INTO claims (id, project_id, status, current_revision_id, created_at, updated_at)
       VALUES ('clm_2', 'prj_1', 'SUBMITTED', NULL, ?, ?)`,
    ).run(TEST_TIME, TEST_TIME);
    assert.throws(
      () =>
        db.prepare('UPDATE claims SET current_revision_id = ? WHERE id = ?').run('rev_1', 'clm_2'),
      /current revision must belong/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('deleting a project cascades claims, revisions, and propositions', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertClaimWithProposition(db);
    db.prepare('DELETE FROM projects WHERE id = ?').run('prj_1');
    for (const table of ['claims', 'claim_revisions', 'propositions']) {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
      assert.equal(row?.['count'], 0, table);
    }
  } finally {
    closeDatabase(db);
  }
});
