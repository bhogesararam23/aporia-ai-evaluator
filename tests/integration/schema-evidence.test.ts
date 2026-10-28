import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeDatabase, withTransaction } from '../../src/persistence/db.ts';
import {
  createTestDatabase,
  insertClaimWithProposition,
  insertEvidenceWithRelation,
  insertProject,
  insertSource,
  TEST_TIME,
} from '../helpers/db.ts';

test('supporting and contradictory evidence coexist for one proposition', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertClaimWithProposition(db);
    insertSource(db, { id: 'src_1' });
    insertSource(db, {
      id: 'src_2',
      title: 'Independent report',
      sourceType: 'INDEPENDENT_SOURCE',
    });
    insertEvidenceWithRelation(db, {
      evidenceId: 'evd_1',
      relationshipId: 'rel_1',
      sourceId: 'src_1',
    });
    insertEvidenceWithRelation(db, {
      evidenceId: 'evd_2',
      relationshipId: 'rel_2',
      sourceId: 'src_2',
      relation: 'CONTRADICTS',
      excerpt: 'The release does not contain feature F.',
    });
    const rows = db
      .prepare('SELECT relation FROM evidence_relationships ORDER BY id')
      .all()
      .map((row) => row['relation']);
    assert.deepEqual(rows, ['SUPPORTS', 'CONTRADICTS']);
  } finally {
    closeDatabase(db);
  }
});

test('only one active relationship may exist for an evidence/proposition pair', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertClaimWithProposition(db);
    insertSource(db);
    insertEvidenceWithRelation(db);
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO evidence_relationships
              (id, project_id, evidence_id, proposition_id, relation, rationale, reviewer, created_at)
             VALUES ('rel_2', 'prj_1', 'evd_1', 'prp_1', 'QUALIFIES', 'Narrower scope.', 'Ram', ?)`,
          )
          .run(TEST_TIME),
      /UNIQUE/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('sources, evidence items, and relationship content are immutable', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertClaimWithProposition(db);
    insertSource(db);
    insertEvidenceWithRelation(db);
    assert.throws(
      () => db.prepare('UPDATE sources SET title = ? WHERE id = ?').run('Changed', 'src_1'),
      /immutable/,
    );
    assert.throws(
      () =>
        db.prepare('UPDATE evidence_items SET excerpt = ? WHERE id = ?').run('Changed', 'evd_1'),
      /immutable/,
    );
    assert.throws(
      () =>
        db
          .prepare('UPDATE evidence_relationships SET relation = ? WHERE id = ?')
          .run('CONTRADICTS', 'rel_1'),
      /append-only/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('superseding a relationship keeps history and frees the active pair', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertClaimWithProposition(db);
    insertSource(db);
    insertEvidenceWithRelation(db);

    withTransaction(db, () => {
      db.prepare(
        'UPDATE evidence_relationships SET superseded_by = ?, superseded_at = ? WHERE id = ?',
      ).run('rel_2', TEST_TIME, 'rel_1');
      db.prepare(
        `INSERT INTO evidence_relationships
          (id, project_id, evidence_id, proposition_id, relation, rationale, reviewer, created_at)
         VALUES ('rel_2', 'prj_1', 'evd_1', 'prp_1', 'QUALIFIES', 'Only release 1.0.', 'Ram', ?)`,
      ).run(TEST_TIME);
    });

    const rows = db
      .prepare('SELECT id, relation, superseded_by FROM evidence_relationships ORDER BY id')
      .all()
      .map((row) => ({
        id: row['id'],
        relation: row['relation'],
        supersededBy: row['superseded_by'],
      }));
    assert.deepEqual(rows, [
      { id: 'rel_1', relation: 'SUPPORTS', supersededBy: 'rel_2' },
      { id: 'rel_2', relation: 'QUALIFIES', supersededBy: null },
    ]);
    assert.throws(
      () =>
        db
          .prepare('UPDATE evidence_relationships SET superseded_at = ? WHERE id = ?')
          .run(TEST_TIME, 'rel_1'),
      /append-only/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('evidence cannot reference a source from another project', () => {
  const db = createTestDatabase();
  try {
    insertProject(db, { id: 'prj_1' });
    insertProject(db, { id: 'prj_2' });
    insertClaimWithProposition(db);
    insertSource(db, { id: 'src_2', projectId: 'prj_2' });
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO evidence_items
              (id, project_id, source_id, locator, excerpt, extraction_method, extracted_at,
               provenance, excerpt_digest, created_at)
             VALUES ('evd_x', 'prj_1', 'src_2', 'x', 'excerpt', 'PASTED_TEXT', ?, 'USER_SUPPLIED', ?, ?)`,
          )
          .run(TEST_TIME, 'a'.repeat(64), TEST_TIME),
      /FOREIGN KEY/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('a relationship cannot target a proposition from another project', () => {
  const db = createTestDatabase();
  try {
    insertProject(db, { id: 'prj_1' });
    insertProject(db, { id: 'prj_2' });
    insertClaimWithProposition(db);
    insertClaimWithProposition(db, {
      projectId: 'prj_2',
      claimId: 'clm_2',
      revisionId: 'rev_2',
      propositionId: 'prp_2',
    });
    insertSource(db);
    assert.throws(
      () =>
        insertEvidenceWithRelation(db, {
          evidenceId: 'evd_x',
          relationshipId: 'rel_x',
          propositionId: 'prp_2',
        }),
      /proposition must belong/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('deleting a project cascades sources, evidence, and relationships', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertClaimWithProposition(db);
    insertSource(db);
    insertEvidenceWithRelation(db);
    db.prepare('DELETE FROM projects WHERE id = ?').run('prj_1');
    for (const table of ['sources', 'evidence_items', 'evidence_relationships']) {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
      assert.equal(row?.['count'], 0, table);
    }
  } finally {
    closeDatabase(db);
  }
});
