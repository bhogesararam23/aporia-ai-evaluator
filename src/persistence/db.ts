import { DatabaseSync } from 'node:sqlite';

const transactionDepth = new WeakMap<DatabaseSync, number>();

export function openDatabase(filename: string): DatabaseSync {
  const db = new DatabaseSync(filename, {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
  });
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  if (filename !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL');
  }
  return db;
}

export function closeDatabase(db: DatabaseSync): void {
  db.close();
}

export function withTransaction<T>(db: DatabaseSync, work: () => T): T {
  const depth = transactionDepth.get(db) ?? 0;
  const savepoint = `aporia_sp_${depth}`;
  if (depth === 0) {
    db.exec('BEGIN IMMEDIATE');
  } else {
    db.exec(`SAVEPOINT ${savepoint}`);
  }
  transactionDepth.set(db, depth + 1);
  try {
    const result = work();
    if (depth === 0) {
      db.exec('COMMIT');
    } else {
      db.exec(`RELEASE ${savepoint}`);
    }
    return result;
  } catch (error) {
    try {
      if (depth === 0) {
        db.exec('ROLLBACK');
      } else {
        db.exec(`ROLLBACK TO ${savepoint}`);
        db.exec(`RELEASE ${savepoint}`);
      }
    } catch {
      // The original failure is more useful than a secondary rollback failure.
    }
    throw error;
  } finally {
    transactionDepth.set(db, depth);
  }
}
