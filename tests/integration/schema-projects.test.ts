import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  appendAuditEvent,
  countAuditEvents,
  listAuditEvents,
} from '../../src/persistence/audit.ts';
import { closeDatabase, openDatabase } from '../../src/persistence/db.ts';
import { loadMigrations, runMigrations } from '../../src/persistence/migrate.ts';
import { numberValue } from '../../src/persistence/rows.ts';

const MIGRATIONS = join(import.meta.dirname, '../../src/persistence/migrations');

function migrate() {
  const db = openDatabase(':memory:');
  runMigrations(db, loadMigrations(MIGRATIONS));
  return db;
}

function createProject(db: ReturnType<typeof openDatabase>, id = 'prj_1', name = 'Aporia'): void {
  db.prepare(
    `INSERT INTO projects
      (id, name, description, primary_domain, target_entity_id, visibility, lifecycle,
       owner_label, created_at, updated_at)
     VALUES (?, ?, NULL, NULL, NULL, 'LOCAL_ONLY', 'ACTIVE', ?, ?, ?)`,
  ).run(id, name, 'Ram', '2026-10-28T12:00:00.000Z', '2026-10-28T12:00:00.000Z');
}

test('applies the initial project and entity schema', () => {
  const db = migrate();
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row['name']);
    assert.ok(tables.includes('projects'));
    assert.ok(tables.includes('entities'));
    assert.ok(tables.includes('audit_events'));
    assert.ok(tables.includes('schema_migrations'));
  } finally {
    closeDatabase(db);
  }
});

test('projects and entities enforce cross-project target integrity', () => {
  const db = migrate();
  try {
    createProject(db, 'prj_1');
    createProject(db, 'prj_2');
    db.prepare(
      `INSERT INTO entities
        (id, project_id, type, canonical_name, alternate_names_json, public_urls_json,
         identity_status, identity_method, identity_scope, notes, created_at, updated_at)
       VALUES (?, ?, 'PERSON', ?, '[]', '[]', 'SELF_DECLARED', NULL, NULL, NULL, ?, ?)`,
    ).run('ent_1', 'prj_1', 'Ram', '2026-10-28T12:00:00.000Z', '2026-10-28T12:00:00.000Z');
    db.prepare('UPDATE projects SET target_entity_id = ? WHERE id = ?').run('ent_1', 'prj_1');
    assert.throws(
      () =>
        db.prepare('UPDATE projects SET target_entity_id = ? WHERE id = ?').run('ent_1', 'prj_2'),
      /target entity must belong/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('entity JSON fields and enum values are validated by SQLite', () => {
  const db = migrate();
  try {
    createProject(db);
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO entities
              (id, project_id, type, canonical_name, alternate_names_json, public_urls_json,
               identity_status, created_at, updated_at)
             VALUES ('ent_bad', 'prj_1', 'PERSON', 'Ram', 'not-json', '[]', 'UNVERIFIED', 'x', 'x')`,
          )
          .run(),
      /json_valid|CHECK/,
    );
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO entities
              (id, project_id, type, canonical_name, alternate_names_json, public_urls_json,
               identity_status, created_at, updated_at)
             VALUES ('ent_bad2', 'prj_1', 'ROBOT', 'Ram', '[]', '[]', 'UNVERIFIED', 'x', 'x')`,
          )
          .run(),
      /CHECK/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('audit events are project-scoped, ordered, and append-only', () => {
  const db = migrate();
  try {
    createProject(db, 'prj_1');
    createProject(db, 'prj_2');
    appendAuditEvent(db, {
      projectId: 'prj_1',
      actor: 'Ram',
      action: 'project.created',
      entityType: 'project',
      entityId: 'prj_1',
      at: '2026-10-28T12:00:00.000Z',
    });
    appendAuditEvent(db, {
      projectId: 'prj_1',
      actor: 'Ram',
      action: 'entity.created',
      entityType: 'entity',
      entityId: 'ent_1',
      details: { identityStatus: 'SELF_DECLARED' },
      at: '2026-10-28T12:01:00.000Z',
    });
    appendAuditEvent(db, {
      projectId: 'prj_2',
      actor: 'Ram',
      action: 'project.created',
      entityType: 'project',
      entityId: 'prj_2',
      at: '2026-10-28T12:02:00.000Z',
    });

    const events = listAuditEvents(db, 'prj_1');
    assert.deepEqual(
      events.map((event) => event.action),
      ['entity.created', 'project.created'],
    );
    assert.deepEqual(events[0]?.details, { identityStatus: 'SELF_DECLARED' });
    assert.equal(countAuditEvents(db, 'prj_1'), 2);
    assert.equal(countAuditEvents(db, 'prj_2'), 1);

    const firstId = events[1]?.id ?? '';
    assert.throws(
      () => db.prepare('UPDATE audit_events SET action = ? WHERE id = ?').run('tampered', firstId),
      /append-only/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('deleting a project cascades entities and audit events', () => {
  const db = migrate();
  try {
    createProject(db, 'prj_1');
    db.prepare(
      `INSERT INTO entities
        (id, project_id, type, canonical_name, alternate_names_json, public_urls_json,
         identity_status, created_at, updated_at)
       VALUES ('ent_1', 'prj_1', 'PERSON', 'Ram', '[]', '[]', 'UNVERIFIED', 'x', 'x')`,
    ).run();
    appendAuditEvent(db, {
      projectId: 'prj_1',
      actor: 'Ram',
      action: 'project.created',
      entityType: 'project',
      entityId: 'prj_1',
      at: '2026-10-28T12:00:00.000Z',
    });
    db.prepare('DELETE FROM projects WHERE id = ?').run('prj_1');
    assert.equal(countAuditEvents(db, 'prj_1'), 0);
    assert.equal(
      numberValue(db.prepare('SELECT COUNT(*) AS count FROM entities').get() ?? {}, 'count'),
      0,
    );
  } finally {
    closeDatabase(db);
  }
});
