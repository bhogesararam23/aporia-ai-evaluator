import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { closeDatabase, openDatabase, withTransaction } from '../../src/persistence/db.ts';

test('opens an in-memory database with safe pragmas', () => {
  const db = openDatabase(':memory:');
  try {
    const foreignKeys = db.prepare('PRAGMA foreign_keys').get() as Record<string, unknown>;
    const busyTimeout = db.prepare('PRAGMA busy_timeout').get() as Record<string, unknown>;
    const synchronous = db.prepare('PRAGMA synchronous').get() as Record<string, unknown>;
    assert.equal(foreignKeys['foreign_keys'], 1);
    assert.equal(busyTimeout['timeout'], 5000);
    assert.equal(synchronous['synchronous'], 1);
  } finally {
    closeDatabase(db);
  }
});

test('uses WAL journaling for file databases', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'aporia-db-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = openDatabase(join(dir, 'aporia.db'));
  try {
    const journal = db.prepare('PRAGMA journal_mode').get() as Record<string, unknown>;
    assert.equal(journal['journal_mode'], 'wal');
  } finally {
    closeDatabase(db);
  }
});

test('commits successful transactions and rolls back failures', () => {
  const db = openDatabase(':memory:');
  try {
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    withTransaction(db, () => {
      db.prepare('INSERT INTO items (name) VALUES (?)').run('kept');
    });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM items').get()?.['count'], 1);

    assert.throws(() => {
      withTransaction(db, () => {
        db.prepare('INSERT INTO items (name) VALUES (?)').run('rolled back');
        throw new Error('fail');
      });
    }, /fail/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM items').get()?.['count'], 1);
  } finally {
    closeDatabase(db);
  }
});

test('nested transactions use savepoints and preserve the outer transaction', () => {
  const db = openDatabase(':memory:');
  try {
    db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    withTransaction(db, () => {
      db.prepare('INSERT INTO items (name) VALUES (?)').run('outer-one');
      assert.throws(() => {
        withTransaction(db, () => {
          db.prepare('INSERT INTO items (name) VALUES (?)').run('inner');
          throw new Error('inner fail');
        });
      }, /inner fail/);
      db.prepare('INSERT INTO items (name) VALUES (?)').run('outer-two');
    });
    const rows = db.prepare('SELECT name FROM items ORDER BY id').all();
    assert.deepEqual(
      rows.map((row) => row['name']),
      ['outer-one', 'outer-two'],
    );
  } finally {
    closeDatabase(db);
  }
});

test('foreign keys are enforced', () => {
  const db = openDatabase(':memory:');
  try {
    db.exec('CREATE TABLE parent (id TEXT PRIMARY KEY) STRICT');
    db.exec(
      'CREATE TABLE child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES parent(id)) STRICT',
    );
    assert.throws(() => {
      db.prepare('INSERT INTO child (id, parent_id) VALUES (?, ?)').run('c1', 'missing');
    }, /FOREIGN KEY/);
  } finally {
    closeDatabase(db);
  }
});
