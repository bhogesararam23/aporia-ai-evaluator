import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { closeDatabase, openDatabase } from '../../src/persistence/db.ts';
import { loadMigrations, runMigrations } from '../../src/persistence/migrate.ts';
import { insertProject } from '../helpers/db.ts';

const ROOT = join(import.meta.dirname, '../..');
const MIGRATIONS = join(ROOT, 'src/persistence/migrations');

function tempDir(): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'aporia-backup-cli-'));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

function seed(dataDir: string, name: string): void {
  mkdirSync(dataDir, { recursive: true });
  const db = openDatabase(join(dataDir, 'aporia.db'));
  try {
    runMigrations(db, loadMigrations(MIGRATIONS));
    insertProject(db, { name });
  } finally {
    closeDatabase(db);
  }
}

function runNode(args: readonly string[]): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
}

test('the backup and restore commands work against a real data directory', () => {
  const temp = tempDir();
  try {
    const source = join(temp.path, 'source');
    seed(source, 'CLI project');
    const backup = join(temp.path, 'backup');

    const created = runNode(['scripts/backup.ts', '--data-dir', source, '--output', backup]);
    assert.equal(created.status, 0, String(created.stderr));
    assert.match(String(created.stdout), /Backup created:/);
    assert.match(String(created.stdout), /SHA-256:/);

    const destination = join(temp.path, 'destination');
    const restored = runNode(['scripts/restore.ts', backup, '--data-dir', destination]);
    assert.equal(restored.status, 0, String(restored.stderr));
    assert.match(String(restored.stdout), /Restored projects: 1/);

    const db = openDatabase(join(destination, 'aporia.db'));
    try {
      const row = db.prepare('SELECT name FROM projects').get();
      assert.equal(row?.['name'], 'CLI project');
    } finally {
      closeDatabase(db);
    }
  } finally {
    temp.remove();
  }
});

test('the restore command refuses an unflagged overwrite with a reason', () => {
  const temp = tempDir();
  try {
    const source = join(temp.path, 'source');
    seed(source, 'Incoming');
    const backup = join(temp.path, 'backup');
    const created = runNode(['scripts/backup.ts', '--data-dir', source, '--output', backup]);
    assert.equal(created.status, 0, String(created.stderr));

    const destination = join(temp.path, 'destination');
    seed(destination, 'Existing');
    const refused = runNode(['scripts/restore.ts', backup, '--data-dir', destination]);
    assert.equal(refused.status, 1);
    assert.match(String(refused.stderr), /contains data/);
  } finally {
    temp.remove();
  }
});

test('both commands explain their usage without touching data', () => {
  const backupHelp = runNode(['scripts/backup.ts', '--help']);
  assert.equal(backupHelp.status, 0);
  assert.match(String(backupHelp.stdout), /npm run backup/);
  const restoreHelp = runNode(['scripts/restore.ts', '--help']);
  assert.equal(restoreHelp.status, 0);
  assert.match(String(restoreHelp.stdout), /stop the Aporia server/);
  assert.match(String(restoreHelp.stdout), /--replace/);
});
