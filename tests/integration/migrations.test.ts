import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { closeDatabase, openDatabase } from '../../src/persistence/db.ts';
import {
  MigrationError,
  loadMigrations,
  runMigrations,
  type Migration,
} from '../../src/persistence/migrate.ts';

function migration(version: number, name: string, sql: string): Migration {
  return { version, name, sql, filename: `${String(version).padStart(3, '0')}_${name}.sql` };
}

test('applies migrations once and records checksums', () => {
  const db = openDatabase(':memory:');
  try {
    const migrations = [
      migration(1, 'initial', 'CREATE TABLE example (id TEXT PRIMARY KEY) STRICT;'),
    ];
    assert.deepEqual(
      runMigrations(db, migrations, () => '2026-10-28T12:00:00.000Z'),
      [1],
    );
    assert.deepEqual(runMigrations(db, migrations), []);
    const row = db
      .prepare('SELECT version, name, checksum, applied_at FROM schema_migrations')
      .get();
    assert.equal(row?.['version'], 1);
    assert.equal(row?.['applied_at'], '2026-10-28T12:00:00.000Z');
    assert.match(String(row?.['checksum']), /^[a-f0-9]{64}$/);
  } finally {
    closeDatabase(db);
  }
});

test('rejects an edited migration that was already applied', () => {
  const db = openDatabase(':memory:');
  try {
    runMigrations(db, [
      migration(1, 'initial', 'CREATE TABLE example (id TEXT PRIMARY KEY) STRICT;'),
    ]);
    assert.throws(
      () =>
        runMigrations(db, [
          migration(1, 'initial', 'CREATE TABLE example (id TEXT PRIMARY KEY, extra TEXT) STRICT;'),
        ]),
      (error: unknown) => error instanceof MigrationError && /has changed/.test(error.message),
    );
  } finally {
    closeDatabase(db);
  }
});

test('rejects a renamed migration that was already applied', () => {
  const db = openDatabase(':memory:');
  try {
    const sql = 'CREATE TABLE example (id TEXT PRIMARY KEY) STRICT;';
    runMigrations(db, [migration(1, 'initial', sql)]);
    assert.throws(
      () => runMigrations(db, [migration(1, 'renamed', sql)]),
      (error: unknown) =>
        error instanceof MigrationError && /applied as "initial"/.test(error.message),
      'a renamed applied migration was accepted because only its SQL checksum was compared',
    );
  } finally {
    closeDatabase(db);
  }
});

test('rejects a database whose applied migration is missing from the directory', () => {
  const db = openDatabase(':memory:');
  try {
    runMigrations(db, [
      migration(1, 'initial', 'CREATE TABLE example (id TEXT PRIMARY KEY) STRICT;'),
    ]);
    assert.throws(
      () =>
        runMigrations(db, [
          migration(2, 'later', 'CREATE TABLE later (id TEXT PRIMARY KEY) STRICT;'),
        ]),
      (error: unknown) => error instanceof MigrationError && /is missing/.test(error.message),
    );
  } finally {
    closeDatabase(db);
  }
});

test('rolls back a failing migration and does not record it', () => {
  const db = openDatabase(':memory:');
  try {
    assert.throws(
      () =>
        runMigrations(db, [
          migration(
            1,
            'broken',
            'CREATE TABLE partial (id TEXT PRIMARY KEY) STRICT; INSERT INTO missing_table VALUES (1);',
          ),
        ]),
      /no such table/,
    );
    const table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partial'")
      .get();
    assert.equal(table, undefined);
    const count = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get();
    assert.equal(count?.['count'], 0);
  } finally {
    closeDatabase(db);
  }
});

test('loads migration files in version order', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aporia-migrations-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, '010_second.sql'), 'SELECT 2;');
  writeFileSync(join(dir, '002_first.sql'), 'SELECT 1;');
  writeFileSync(join(dir, 'README.md'), 'ignored');
  const migrations = loadMigrations(dir);
  assert.deepEqual(
    migrations.map((m) => [m.version, m.name]),
    [
      [2, 'first'],
      [10, 'second'],
    ],
  );
});

test('rejects invalid and duplicate migration filenames', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aporia-migrations-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'bad-name.sql'), 'SELECT 1;');
  assert.throws(() => loadMigrations(dir), MigrationError);

  const duplicateDir = mkdtempSync(join(tmpdir(), 'aporia-migrations-'));
  t.after(() => rmSync(duplicateDir, { recursive: true, force: true }));
  writeFileSync(join(duplicateDir, '001_first.sql'), 'SELECT 1;');
  writeFileSync(join(duplicateDir, '001_second.sql'), 'SELECT 2;');
  assert.throws(() => loadMigrations(duplicateDir), /Duplicate/);
});
