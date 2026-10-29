import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  BACKUP_FORMAT_VERSION,
  BackupError,
  createBackup,
  restoreBackup,
  verifyBackup,
} from '../../src/persistence/backup.ts';
import { closeDatabase, openDatabase } from '../../src/persistence/db.ts';
import { loadMigrations, runMigrations } from '../../src/persistence/migrate.ts';
import { insertClaimWithProposition, insertProject, insertReport } from '../helpers/db.ts';

const MIGRATIONS = join(import.meta.dirname, '../../src/persistence/migrations');
const NOW = '2026-10-30T12:00:00.000Z';

function tempDir(): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'aporia-backup-'));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function seedDatabase(path: string, projectName = 'Aporia', reportSnapshot?: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = openDatabase(path);
  try {
    runMigrations(db, loadMigrations(MIGRATIONS));
    insertProject(db, { name: projectName });
    insertClaimWithProposition(db);
    insertReport(db, reportSnapshot === undefined ? {} : { snapshotJson: reportSnapshot });
  } finally {
    closeDatabase(db);
  }
}

function readProjectName(path: string): string {
  const db = openDatabase(path);
  try {
    return String(
      db.prepare('SELECT name FROM projects ORDER BY created_at LIMIT 1').get()?.['name'],
    );
  } finally {
    closeDatabase(db);
  }
}

test('creates a consistent backup with a validated manifest', async () => {
  const temp = tempDir();
  try {
    const source = join(temp.path, 'aporia.db');
    seedDatabase(source);
    const sourceHash = fileHash(source);
    const output = join(temp.path, 'backup-1');

    const result = await createBackup(source, output, { now: () => NOW });

    assert.equal(result.directory, output);
    assert.equal(result.manifest.formatVersion, BACKUP_FORMAT_VERSION);
    assert.equal(result.manifest.createdAt, NOW);
    assert.equal(result.manifest.schemaVersion, 7);
    assert.equal(result.manifest.tableCounts.projects, 1);
    assert.equal(result.manifest.tableCounts.reports, 1);
    assert.match(result.manifest.databaseSha256, /^[a-f0-9]{64}$/);
    assert.equal(result.manifest.integrityCheck, 'ok');
    assert.equal(result.manifest.foreignKeyProblems, 0);
    assert.deepEqual(result.manifest.reportConsistency.problems, []);
    assert.ok(result.manifest.byteLength > 0);
    assert.equal(fileHash(source), sourceHash, 'the source database changed');
    assert.equal(fileHash(join(output, 'aporia.db')), result.manifest.databaseSha256);

    const verified = await verifyBackup(output);
    assert.equal(verified.manifest.backupId, basename(output));
    assert.equal(verified.counts.projects, 1);

    await assert.rejects(() => createBackup(source, output), BackupError);
  } finally {
    temp.remove();
  }
});

test('refuses to create a backup of an unreadable database or a bad report', async () => {
  const temp = tempDir();
  try {
    const corrupt = join(temp.path, 'corrupt.db');
    writeFileSync(corrupt, 'not a sqlite database');
    await assert.rejects(
      () => createBackup(corrupt, join(temp.path, 'backup-corrupt')),
      BackupError,
    );
    assert.equal(existsSync(join(temp.path, 'backup-corrupt')), false);

    const source = join(temp.path, 'aporia.db');
    seedDatabase(source, 'Aporia', '{}');
    await assert.rejects(
      () => createBackup(source, join(temp.path, 'backup-bad-report')),
      /snapshot schema version/,
    );
    assert.equal(existsSync(join(temp.path, 'backup-bad-report')), false);
  } finally {
    temp.remove();
  }
});

test('a backup restores into an empty data directory', async () => {
  const temp = tempDir();
  try {
    const source = join(temp.path, 'aporia.db');
    seedDatabase(source, 'Incoming project');
    const backupDir = join(temp.path, 'backup-1');
    await createBackup(source, backupDir, { now: () => NOW });
    const destination = join(temp.path, 'destination');

    const result = await restoreBackup({
      backupDirectory: backupDir,
      dataDir: destination,
      replace: false,
      confirmation: '',
    });

    assert.equal(result.safetyBackupDirectory, null);
    assert.equal(result.counts.projects, 1);
    assert.equal(readProjectName(join(destination, 'aporia.db')), 'Incoming project');
    const db = openDatabase(join(destination, 'aporia.db'));
    try {
      const report = db.prepare('SELECT snapshot_json FROM reports').get();
      assert.equal(typeof report?.['snapshot_json'], 'string');
      assert.equal(
        JSON.parse(String(report?.['snapshot_json']))['schemaVersion'],
        'report-snapshot-v1',
      );
    } finally {
      closeDatabase(db);
    }
  } finally {
    temp.remove();
  }
});

test('restore protects existing data unless replacement is explicit and confirmed', async () => {
  const temp = tempDir();
  try {
    const incoming = join(temp.path, 'incoming.db');
    seedDatabase(incoming, 'Incoming project');
    const backupDir = join(temp.path, 'backup-1');
    await createBackup(incoming, backupDir, { now: () => NOW });

    const destination = join(temp.path, 'destination');
    seedDatabase(join(destination, 'aporia.db'), 'Existing project');
    const before = fileHash(join(destination, 'aporia.db'));

    await assert.rejects(
      () =>
        restoreBackup({
          backupDirectory: backupDir,
          dataDir: destination,
          replace: false,
          confirmation: '',
        }),
      /contains data/,
    );
    assert.equal(fileHash(join(destination, 'aporia.db')), before);

    await assert.rejects(
      () =>
        restoreBackup({
          backupDirectory: backupDir,
          dataDir: destination,
          replace: true,
          confirmation: 'wrong-name',
        }),
      /confirmation/,
    );
    assert.equal(fileHash(join(destination, 'aporia.db')), before);

    const result = await restoreBackup({
      backupDirectory: backupDir,
      dataDir: destination,
      replace: true,
      confirmation: basename(backupDir),
    });
    assert.ok(result.safetyBackupDirectory);
    assert.equal(readProjectName(join(destination, 'aporia.db')), 'Incoming project');
    const safety = await verifyBackup(result.safetyBackupDirectory);
    assert.equal(safety.counts.projects, 1);
    assert.equal(
      readProjectName(join(result.safetyBackupDirectory, 'aporia.db')),
      'Existing project',
    );
  } finally {
    temp.remove();
  }
});

test('a failure after the safety copy rolls the destination back', async () => {
  const temp = tempDir();
  try {
    const incoming = join(temp.path, 'incoming.db');
    seedDatabase(incoming, 'Incoming project');
    const backupDir = join(temp.path, 'backup-1');
    await createBackup(incoming, backupDir, { now: () => NOW });

    const destination = join(temp.path, 'destination');
    seedDatabase(join(destination, 'aporia.db'), 'Existing project');

    await assert.rejects(
      () =>
        restoreBackup({
          backupDirectory: backupDir,
          dataDir: destination,
          replace: true,
          confirmation: basename(backupDir),
          beforeReplace: () => {
            throw new Error('injected replace failure');
          },
        }),
      /injected replace failure/,
    );

    assert.equal(readProjectName(join(destination, 'aporia.db')), 'Existing project');
    const safetyName = readdirSync(join(destination, 'backups')).find((name) =>
      name.startsWith('pre-restore-'),
    );
    assert.ok(safetyName);
    const safety = await verifyBackup(join(destination, 'backups', safetyName));
    assert.equal(safety.counts.projects, 1);
  } finally {
    temp.remove();
  }
});

test('digest, count and schema mismatches abort before touching the destination', async () => {
  const temp = tempDir();
  try {
    const incoming = join(temp.path, 'incoming.db');
    seedDatabase(incoming, 'Incoming project');
    const backupDir = join(temp.path, 'backup-1');
    await createBackup(incoming, backupDir, { now: () => NOW });
    const manifestPath = join(backupDir, 'manifest.json');
    const original = readFileSync(manifestPath, 'utf8');
    const destination = join(temp.path, 'destination');
    seedDatabase(join(destination, 'aporia.db'), 'Existing project');
    const before = fileHash(join(destination, 'aporia.db'));

    const badDigest = JSON.parse(original) as Record<string, unknown>;
    badDigest['databaseSha256'] = '0'.repeat(64);
    writeFileSync(manifestPath, `${JSON.stringify(badDigest, null, 2)}\n`);
    await assert.rejects(() => verifyBackup(backupDir), /digest does not match/);
    await assert.rejects(
      () =>
        restoreBackup({
          backupDirectory: backupDir,
          dataDir: destination,
          replace: true,
          confirmation: basename(backupDir),
        }),
      /digest does not match/,
    );
    assert.equal(fileHash(join(destination, 'aporia.db')), before);

    const badCount = JSON.parse(original) as Record<string, unknown>;
    const counts = badCount['tableCounts'] as Record<string, number>;
    counts['projects'] = 99;
    writeFileSync(manifestPath, `${JSON.stringify(badCount, null, 2)}\n`);
    await assert.rejects(
      () =>
        restoreBackup({
          backupDirectory: backupDir,
          dataDir: destination,
          replace: true,
          confirmation: basename(backupDir),
        }),
      /rows; the manifest records 99/,
    );
    assert.equal(fileHash(join(destination, 'aporia.db')), before);

    const badSchema = JSON.parse(original) as Record<string, unknown>;
    const migrations = badSchema['migrations'] as Array<Record<string, unknown>>;
    if (migrations[0] !== undefined) {
      migrations[0]['name'] = 'renamed';
    }
    writeFileSync(manifestPath, `${JSON.stringify(badSchema, null, 2)}\n`);
    await assert.rejects(
      () =>
        restoreBackup({
          backupDirectory: backupDir,
          dataDir: destination,
          replace: true,
          confirmation: basename(backupDir),
        }),
      /schema does not match/,
    );
    assert.equal(fileHash(join(destination, 'aporia.db')), before);

    writeFileSync(manifestPath, original);
    appendFileSync(join(backupDir, 'aporia.db'), 'tamper');
    await assert.rejects(() => verifyBackup(backupDir), /bytes|digest/i);
    assert.equal(fileHash(join(destination, 'aporia.db')), before);
  } finally {
    temp.remove();
  }
});
