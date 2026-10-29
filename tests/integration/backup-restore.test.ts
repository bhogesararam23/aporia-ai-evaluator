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
import {
  approveAchievement,
  createAchievement,
} from '../../src/persistence/repositories/achievements.ts';
import {
  insertClaimWithProposition,
  insertEvidenceWithRelation,
  insertProject,
  insertReport,
  insertSource,
} from '../helpers/db.ts';

const MIGRATIONS = join(import.meta.dirname, '../../src/persistence/migrations');
const NOW = '2026-10-30T12:00:00.000Z';

function tempDir(): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'aporia-backup-'));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function seedDatabase(
  path: string,
  projectName = 'Aporia',
  reportSnapshot?: string,
  withAchievement = false,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const db = openDatabase(path);
  try {
    runMigrations(db, loadMigrations(MIGRATIONS));
    insertProject(db, { name: projectName });
    insertClaimWithProposition(db);
    insertReport(db, reportSnapshot === undefined ? {} : { snapshotJson: reportSnapshot });
    if (withAchievement) {
      insertSource(db);
      insertEvidenceWithRelation(db);
      const context = { actor: 'Ram', at: NOW };
      const achievement = createAchievement(
        db,
        'prj_1',
        {
          title: 'A recorded achievement',
          summary: 'A record carried through backup and restore.',
          projectName: 'Aporia',
          projectDescription: undefined,
          projectUrl: undefined,
          startDate: '2026-01-01',
          endDate: '2026-02-01',
          claimIds: ['clm_1'],
          contributors: [
            {
              name: 'Ram',
              role: 'AUTHOR',
              contribution: 'Built the project.',
              supportState: 'EVIDENCE_LINKED',
              evidenceNote: 'Release archive.',
            },
          ],
          sourceIds: ['src_1'],
          evidenceIds: ['evd_1'],
        },
        context,
      );
      approveAchievement(
        db,
        'prj_1',
        achievement.id,
        { confirmation: 'A recorded achievement', note: 'Reviewed the recorded evidence.' },
        context,
      );
    }
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

test('a backup carries achievement records, revisions and approvals intact', async () => {
  const temp = tempDir();
  try {
    const source = join(temp.path, 'aporia.db');
    seedDatabase(source, 'Achievement project', undefined, true);
    const sourceDb = openDatabase(source);
    let expectedHash: string;
    let expectedRevisionId: string;
    try {
      const revision = sourceDb
        .prepare(
          'SELECT id, content_hash FROM achievement_revisions ORDER BY revision_number LIMIT 1',
        )
        .get();
      expectedHash = String(revision?.['content_hash']);
      expectedRevisionId = String(revision?.['id']);
    } finally {
      closeDatabase(sourceDb);
    }

    const backupDir = join(temp.path, 'backup-1');
    const result = await createBackup(source, backupDir, { now: () => NOW });
    assert.equal(result.manifest.tableCounts.achievements, 1);
    assert.equal(result.manifest.tableCounts.achievement_revisions, 1);
    assert.equal(result.manifest.tableCounts.achievement_approvals, 1);
    assert.equal(result.manifest.tableCounts.achievement_claims, 1);
    assert.equal(result.manifest.tableCounts.achievement_contributors, 1);
    assert.equal(
      result.manifest.tableCounts.achievement_evidence,
      2,
      'one source row and one excerpt row',
    );

    const destination = join(temp.path, 'destination');
    await restoreBackup({
      backupDirectory: backupDir,
      dataDir: destination,
      replace: false,
      confirmation: '',
    });

    const restored = openDatabase(join(destination, 'aporia.db'));
    try {
      const achievement = restored.prepare('SELECT current_revision_id FROM achievements').get();
      assert.equal(achievement?.['current_revision_id'], expectedRevisionId);
      const revision = restored
        .prepare('SELECT title, content_hash FROM achievement_revisions')
        .get();
      assert.equal(revision?.['title'], 'A recorded achievement');
      assert.equal(revision?.['content_hash'], expectedHash);
      const approval = restored
        .prepare('SELECT note, content_hash FROM achievement_approvals')
        .get();
      assert.equal(approval?.['note'], 'Reviewed the recorded evidence.');
      assert.equal(approval?.['content_hash'], expectedHash);
      const contributors = restored
        .prepare('SELECT COUNT(*) AS count FROM achievement_contributors')
        .get();
      assert.equal(contributors?.['count'], 1);
    } finally {
      closeDatabase(restored);
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

test('restore refuses a backup directory that is the destination data directory', async () => {
  const temp = tempDir();
  try {
    const destination = join(temp.path, 'destination');
    seedDatabase(join(destination, 'aporia.db'), 'Existing');
    await assert.rejects(
      () =>
        restoreBackup({
          backupDirectory: destination,
          dataDir: destination,
          replace: true,
          confirmation: basename(destination),
        }),
      /must not be the destination/,
    );
  } finally {
    temp.remove();
  }
});
