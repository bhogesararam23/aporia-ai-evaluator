import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { withTransaction } from './db.ts';
import { numberValue, stringValue } from './rows.ts';

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
  readonly filename: string;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

const FILENAME_PATTERN = /^(\d{3,})_([a-z0-9_]+)\.sql$/;

export function loadMigrations(directory: string): Migration[] {
  const files = readdirSync(directory).filter((file) => file.endsWith('.sql'));
  const migrations: Migration[] = [];
  for (const filename of files) {
    const match = FILENAME_PATTERN.exec(filename);
    if (match === null) {
      throw new MigrationError(`Migration filename does not match NNN_name.sql: ${filename}`);
    }
    const versionText = match[1];
    const name = match[2];
    if (versionText === undefined || name === undefined) {
      throw new MigrationError(`Invalid migration filename: ${filename}`);
    }
    const version = Number.parseInt(versionText, 10);
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw new MigrationError(`Invalid migration version in ${filename}`);
    }
    migrations.push({
      version,
      name,
      sql: readFileSync(join(directory, filename), 'utf8'),
      filename,
    });
  }
  migrations.sort((left, right) => left.version - right.version);
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new MigrationError(`Duplicate migration version ${migration.version}`);
    }
    seen.add(migration.version);
  }
  return migrations;
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

interface AppliedRow {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

export function runMigrations(
  db: DatabaseSync,
  migrations: readonly Migration[],
  now: () => string = () => new Date().toISOString(),
): number[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const appliedRows: AppliedRow[] = db
    .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => ({
      version: numberValue(row, 'version'),
      name: stringValue(row, 'name'),
      checksum: stringValue(row, 'checksum'),
    }));
  const applied = new Map<number, AppliedRow>();
  for (const row of appliedRows) {
    applied.set(row.version, row);
  }

  for (const migration of migrations) {
    const existing = applied.get(migration.version);
    if (existing === undefined) {
      continue;
    }
    const expected = checksum(migration.sql);
    if (existing.checksum !== expected) {
      throw new MigrationError(
        `Migration ${migration.version} (${migration.name}) has changed since it was applied; ` +
          'create a new migration instead of editing an applied one.',
      );
    }
  }

  for (const [version, row] of applied) {
    if (!migrations.some((migration) => migration.version === version)) {
      throw new MigrationError(
        `Applied migration ${version} (${row.name}) is missing from the migration directory.`,
      );
    }
  }

  const appliedNow: number[] = [];
  for (const migration of migrations) {
    if (applied.has(migration.version)) {
      continue;
    }
    const migrationChecksum = checksum(migration.sql);
    withTransaction(db, () => {
      db.exec(migration.sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      ).run(migration.version, migration.name, migrationChecksum, now());
    });
    appliedNow.push(migration.version);
  }
  return appliedNow;
}
