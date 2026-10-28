import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeDatabase } from '../../src/persistence/db.ts';
import {
  createTestDatabase,
  insertProject,
  insertReport,
  insertWebsiteAudit,
  TEST_TIME,
} from '../helpers/db.ts';

test('website audit snapshots are immutable', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertWebsiteAudit(db);
    assert.throws(
      () => db.prepare('UPDATE website_audits SET label = ? WHERE id = ?').run('Changed', 'wsa_1'),
      /immutable/,
    );
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO website_audits
              (id, project_id, label, input_method, content_hash, byte_length, html_snapshot,
               audited_at, methodology_version, findings_json, unavailable_checks_json,
               metadata_json, created_at)
             VALUES ('wsa_bad', 'prj_1', 'Bad', 'PASTED', ?, 10, '<html></html>', ?, 'v1',
               'not-json', '[]', '{}', ?)`,
          )
          .run('a'.repeat(64), TEST_TIME, TEST_TIME),
      /json_valid|CHECK/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('report snapshots are immutable and numbered per project', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertReport(db, { reportNumber: 1 });
    assert.throws(() => insertReport(db, { id: 'rep_dup', reportNumber: 1 }), /UNIQUE/);
    assert.throws(
      () =>
        db
          .prepare('UPDATE reports SET snapshot_json = ? WHERE id = ?')
          .run('{"changed":true}', 'rep_1'),
      /immutable/,
    );
    insertReport(db, { id: 'rep_2', reportNumber: 2 });
    db.prepare('UPDATE reports SET superseded_by_report_id = ? WHERE id = ?').run('rep_2', 'rep_1');
    assert.throws(
      () =>
        db
          .prepare('UPDATE reports SET superseded_by_report_id = ? WHERE id = ?')
          .run('rep_2', 'rep_1'),
      /immutable/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('a report cannot be superseded by a report from another project', () => {
  const db = createTestDatabase();
  try {
    insertProject(db, { id: 'prj_1' });
    insertProject(db, { id: 'prj_2' });
    insertReport(db, { id: 'rep_1', projectId: 'prj_1' });
    insertReport(db, { id: 'rep_2', projectId: 'prj_2' });
    assert.throws(
      () =>
        db
          .prepare('UPDATE reports SET superseded_by_report_id = ? WHERE id = ?')
          .run('rep_2', 'rep_1'),
      /must belong to the project/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('deleting a project cascades audits and reports', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertWebsiteAudit(db);
    insertReport(db);
    db.prepare('DELETE FROM projects WHERE id = ?').run('prj_1');
    for (const table of ['website_audits', 'reports']) {
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
      assert.equal(row?.['count'], 0, table);
    }
  } finally {
    closeDatabase(db);
  }
});
