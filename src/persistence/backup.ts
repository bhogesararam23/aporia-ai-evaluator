import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  fsyncSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { APP_VERSION } from '../version.ts';
import { loadMigrations, type Migration } from './migrate.ts';

export const BACKUP_FORMAT_VERSION = 1;

export const BACKUP_TABLES = [
  'projects',
  'entities',
  'claims',
  'claim_revisions',
  'propositions',
  'sources',
  'evidence_items',
  'evidence_relationships',
  'query_sets',
  'queries',
  'runs',
  'observations',
  'citations',
  'proposition_assessments',
  'observation_assessments',
  'website_audits',
  'reports',
  'achievements',
  'achievement_revisions',
  'achievement_claims',
  'achievement_contributors',
  'achievement_evidence',
  'achievement_approvals',
  'audit_events',
  'schema_migrations',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

export interface MigrationIdentity {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

export interface ReportConsistency {
  readonly reports: number;
  readonly problems: readonly string[];
}

export interface BackupManifest {
  readonly formatVersion: number;
  readonly appVersion: string;
  readonly backupId: string;
  readonly createdAt: string;
  readonly sourceDatabase: string;
  readonly schemaVersion: number;
  readonly migrations: readonly MigrationIdentity[];
  readonly databaseSha256: string;
  readonly byteLength: number;
  readonly tableCounts: Readonly<Record<BackupTable, number>>;
  readonly reportConsistency: ReportConsistency;
  readonly integrityCheck: string;
  readonly foreignKeyProblems: number;
}

export interface BackupResult {
  readonly directory: string;
  readonly manifest: BackupManifest;
}

export interface BackupVerification {
  readonly manifest: BackupManifest;
  readonly counts: Readonly<Record<BackupTable, number>>;
}

export interface RestoreOptions {
  readonly backupDirectory: string;
  readonly dataDir: string;
  readonly replace: boolean;
  readonly confirmation: string;
  /** Test seam: throw here to exercise the post-safety rollback path. Not used by the CLI. */
  readonly beforeReplace?: () => void;
}

export interface RestoreResult {
  readonly safetyBackupDirectory: string | null;
  readonly manifest: BackupManifest;
  readonly counts: Readonly<Record<BackupTable, number>>;
}

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

function migrationsDirectory(): string {
  return join(import.meta.dirname, 'migrations');
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function readOnlyDatabase(path: string): DatabaseSync {
  return new DatabaseSync(path, {
    readOnly: true,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
  });
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

function migrationIdentities(migrations: readonly Migration[]): MigrationIdentity[] {
  return migrations.map((migration) => ({
    version: migration.version,
    name: migration.name,
    checksum: checksumOf(migration.sql),
  }));
}

function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

function assertTables(db: DatabaseSync): void {
  for (const table of BACKUP_TABLES) {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    if (row === undefined) {
      throw new BackupError(`The database is missing the ${table} table.`);
    }
  }
}

function tableCounts(db: DatabaseSync): Record<BackupTable, number> {
  assertTables(db);
  const counts = {} as Record<BackupTable, number>;
  for (const table of BACKUP_TABLES) {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
    counts[table] = row === undefined ? 0 : Number(row['count']);
  }
  return counts;
}

function appliedMigrations(db: DatabaseSync): MigrationIdentity[] {
  return db
    .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version ASC')
    .all()
    .map((row) => ({
      version: Number(row['version']),
      name: String(row['name']),
      checksum: String(row['checksum']),
    }));
}

function compareMigrations(
  actual: readonly MigrationIdentity[],
  expected: readonly MigrationIdentity[],
): string[] {
  const problems: string[] = [];
  if (actual.length !== expected.length) {
    problems.push(
      `The database records ${actual.length} migrations; ${expected.length} were expected.`,
    );
    return problems;
  }
  for (let index = 0; index < expected.length; index += 1) {
    const found = actual[index];
    const wanted = expected[index];
    if (found === undefined || wanted === undefined) {
      problems.push(`Migration ${index + 1} is missing.`);
      continue;
    }
    if (
      found.version !== wanted.version ||
      found.name !== wanted.name ||
      found.checksum !== wanted.checksum
    ) {
      problems.push(
        `Migration ${wanted.version} (${wanted.name}) does not match the database's applied migration identity.`,
      );
    }
  }
  return problems;
}

function reportConsistency(db: DatabaseSync): ReportConsistency {
  const rows = db
    .prepare(
      'SELECT project_id, report_number, snapshot_json FROM reports ORDER BY project_id, report_number',
    )
    .all();
  const problems: string[] = [];
  const numbersByProject = new Map<string, number[]>();
  for (const row of rows) {
    const projectId = String(row['project_id']);
    const number = Number(row['report_number']);
    const list = numbersByProject.get(projectId) ?? [];
    list.push(number);
    numbersByProject.set(projectId, list);
    try {
      const snapshot = JSON.parse(String(row['snapshot_json'])) as unknown;
      if (
        typeof snapshot !== 'object' ||
        snapshot === null ||
        typeof (snapshot as Record<string, unknown>)['schemaVersion'] !== 'string'
      ) {
        problems.push(`Report ${projectId}#${number} has no readable snapshot schema version.`);
      }
    } catch {
      problems.push(`Report ${projectId}#${number} has unreadable snapshot JSON.`);
    }
  }
  for (const [projectId, numbers] of numbersByProject) {
    for (const [index, number] of numbers.entries()) {
      if (number !== index + 1) {
        problems.push(
          `Report numbers for project ${projectId} are not sequential at position ${index + 1}.`,
        );
        break;
      }
    }
  }
  const mismatchedApprovals = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM achievement_approvals ap
       JOIN achievement_revisions ar ON ar.id = ap.revision_id
       WHERE ap.content_hash <> ar.content_hash`,
    )
    .get();
  const approvalCount =
    mismatchedApprovals === undefined ? 0 : Number(mismatchedApprovals['count']);
  if (approvalCount > 0) {
    problems.push(`${approvalCount} achievement approval(s) do not match their revision hash.`);
  }
  return { reports: rows.length, problems };
}

function validateDatabase(
  db: DatabaseSync,
  expectedMigrations: readonly MigrationIdentity[],
): {
  counts: Record<BackupTable, number>;
  reportConsistency: ReportConsistency;
  integrityCheck: string;
  foreignKeyProblems: number;
  migrationProblems: string[];
} {
  const integrityRow = db.prepare('PRAGMA integrity_check').get();
  const integrityCheck =
    integrityRow === undefined ? 'missing' : String(Object.values(integrityRow)[0]);
  const foreignKeys = db.prepare('PRAGMA foreign_key_check').all();
  const migrationProblems = compareMigrations(appliedMigrations(db), expectedMigrations);
  return {
    counts: tableCounts(db),
    reportConsistency: reportConsistency(db),
    integrityCheck,
    foreignKeyProblems: foreignKeys.length,
    migrationProblems,
  };
}

function assertValidation(
  validation: ReturnType<typeof validateDatabase>,
  manifestCounts?: Readonly<Record<BackupTable, number>>,
): void {
  const problems: string[] = [];
  if (validation.integrityCheck !== 'ok') {
    problems.push(`SQLite integrity_check returned ${validation.integrityCheck}.`);
  }
  if (validation.foreignKeyProblems > 0) {
    problems.push(`${validation.foreignKeyProblems} foreign-key violation(s) were found.`);
  }
  problems.push(...validation.migrationProblems);
  problems.push(...validation.reportConsistency.problems);
  if (manifestCounts !== undefined) {
    for (const table of BACKUP_TABLES) {
      if (validation.counts[table] !== manifestCounts[table]) {
        problems.push(
          `Table ${table} has ${validation.counts[table]} rows; the manifest records ${manifestCounts[table]}.`,
        );
      }
    }
  }
  if (problems.length > 0) {
    throw new BackupError(problems.join(' '));
  }
}

function readManifest(directory: string): BackupManifest {
  const path = join(directory, 'manifest.json');
  if (!existsSync(path)) {
    throw new BackupError(`The backup has no manifest.json at ${path}.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    throw new BackupError(`The backup manifest is not readable JSON: ${(error as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new BackupError('The backup manifest must be a JSON object.');
  }
  const manifest = parsed as Record<string, unknown>;
  if (manifest['formatVersion'] !== BACKUP_FORMAT_VERSION) {
    throw new BackupError(
      `Unsupported backup format version ${String(manifest['formatVersion'])}; expected ${BACKUP_FORMAT_VERSION}.`,
    );
  }
  if (
    typeof manifest['databaseSha256'] !== 'string' ||
    typeof manifest['byteLength'] !== 'number'
  ) {
    throw new BackupError('The backup manifest is missing its database digest or length.');
  }
  if (!Array.isArray(manifest['migrations']) || typeof manifest['tableCounts'] !== 'object') {
    throw new BackupError('The backup manifest is missing migration identity or table counts.');
  }
  return manifest as unknown as BackupManifest;
}

function assertManifestMigrations(manifest: BackupManifest): readonly MigrationIdentity[] {
  const current = migrationIdentities(loadMigrations(migrationsDirectory()));
  const manifestMigrations = manifest.migrations;
  const problems = compareMigrations(manifestMigrations, current);
  if (problems.length > 0) {
    throw new BackupError(
      `The backup schema does not match this application build: ${problems.join(' ')}`,
    );
  }
  return current;
}

async function verifyBackupFile(
  directory: string,
  manifest: BackupManifest,
): Promise<{ counts: Record<BackupTable, number>; migrations: readonly MigrationIdentity[] }> {
  const databasePath = join(directory, 'aporia.db');
  if (!existsSync(databasePath)) {
    throw new BackupError(`The backup has no aporia.db at ${databasePath}.`);
  }
  const bytes = statSync(databasePath).size;
  if (bytes !== manifest.byteLength) {
    throw new BackupError(
      `The backup database is ${bytes} bytes; the manifest records ${manifest.byteLength}.`,
    );
  }
  const digest = await hashFile(databasePath);
  if (digest !== manifest.databaseSha256) {
    throw new BackupError('The backup database digest does not match the manifest.');
  }
  const expectedMigrations = assertManifestMigrations(manifest);
  let db: DatabaseSync;
  try {
    db = readOnlyDatabase(databasePath);
  } catch (error) {
    throw new BackupError(`The backup database could not be opened: ${(error as Error).message}`);
  }
  try {
    const validation = validateDatabase(db, expectedMigrations);
    assertValidation(validation, manifest.tableCounts);
    return { counts: validation.counts, migrations: expectedMigrations };
  } catch (error) {
    if (error instanceof BackupError) {
      throw error;
    }
    throw new BackupError(
      `The backup database could not be validated: ${(error as Error).message}`,
    );
  } finally {
    db.close();
  }
}

export async function createBackup(
  databasePath: string,
  outputDirectory: string,
  options: { readonly now?: () => string } = {},
): Promise<BackupResult> {
  const source = resolve(databasePath);
  const output = resolve(outputDirectory);
  if (!existsSync(source)) {
    throw new BackupError(`The database does not exist at ${source}.`);
  }
  if (existsSync(output)) {
    throw new BackupError(`The backup directory already exists: ${output}`);
  }
  mkdirSync(output, { recursive: false });
  const backupPath = join(output, 'aporia.db');
  let sourceDb: DatabaseSync | null = null;
  try {
    sourceDb = readOnlyDatabase(source);
    sourceDb.exec(`VACUUM INTO ${sqlString(backupPath)}`);
    sourceDb.close();
    sourceDb = null;

    const migrations = migrationIdentities(loadMigrations(migrationsDirectory()));
    const db = readOnlyDatabase(backupPath);
    let validation: ReturnType<typeof validateDatabase>;
    try {
      validation = validateDatabase(db, migrations);
      assertValidation(validation);
    } finally {
      db.close();
    }

    const createdAt = (options.now ?? (() => new Date().toISOString()))();
    const byteLength = statSync(backupPath).size;
    const databaseSha256 = await hashFile(backupPath);
    const manifest: BackupManifest = {
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: APP_VERSION,
      backupId: basename(output),
      createdAt,
      sourceDatabase: source,
      schemaVersion: migrations.at(-1)?.version ?? 0,
      migrations,
      databaseSha256,
      byteLength,
      tableCounts: validation.counts,
      reportConsistency: validation.reportConsistency,
      integrityCheck: validation.integrityCheck,
      foreignKeyProblems: validation.foreignKeyProblems,
    };
    writeFileSync(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: 'wx',
    });
    writeFileSync(
      join(output, 'README.txt'),
      [
        `Aporia local backup ${manifest.backupId}`,
        '',
        `Created: ${createdAt}`,
        `Source database: ${source}`,
        `Schema version: ${manifest.schemaVersion}`,
        `Tables: ${BACKUP_TABLES.length}`,
        '',
        'This is an unencrypted local SQLite database plus its validated manifest.',
        'It may contain claims, evidence, answers and personal data. Protect it like the original.',
        'Restore requires the matching application schema; use `npm run restore -- --help`.',
        '',
      ].join('\n'),
      { flag: 'wx' },
    );
    return { directory: output, manifest };
  } catch (error) {
    if (sourceDb !== null) {
      sourceDb.close();
    }
    rmSync(output, { recursive: true, force: true });
    if (error instanceof BackupError) {
      throw error;
    }
    throw new BackupError(`The backup could not be created: ${(error as Error).message}`);
  }
}

export async function verifyBackup(directory: string): Promise<BackupVerification> {
  const backupDirectory = resolve(directory);
  const manifest = readManifest(backupDirectory);
  const verified = await verifyBackupFile(backupDirectory, manifest);
  return { manifest, counts: verified.counts };
}

function uniqueSafetyDirectory(dataDir: string, now: () => string): string {
  const stamp = now().replaceAll(/[:.]/g, '-');
  const base = join(dataDir, 'backups', `pre-restore-${stamp}`);
  let candidate = base;
  let suffix = 1;
  while (existsSync(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  mkdirSync(dirname(candidate), { recursive: true });
  return candidate;
}

function destinationProjectCount(databasePath: string): number | null {
  if (!existsSync(databasePath)) {
    return 0;
  }
  try {
    const db = readOnlyDatabase(databasePath);
    try {
      const row = db.prepare('SELECT COUNT(*) AS count FROM projects').get();
      return row === undefined ? 0 : Number(row['count']);
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

function removeSidecars(databasePath: string): void {
  rmSync(`${databasePath}-wal`, { force: true });
  rmSync(`${databasePath}-shm`, { force: true });
}

function copyAndRename(source: string, destination: string, expectedHash: string): Promise<void> {
  const temporary = `${destination}.restore-tmp`;
  rmSync(temporary, { force: true });
  copyFileSync(source, temporary);
  const fd = openSync(temporary, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return hashFile(temporary).then((digest) => {
    if (digest !== expectedHash) {
      rmSync(temporary, { force: true });
      throw new BackupError('The copied database digest does not match the backup manifest.');
    }
    rmSync(destination, { force: true });
    renameSync(temporary, destination);
  });
}

function rawSafetyCopy(databasePath: string, directory: string): void {
  mkdirSync(directory, { recursive: true });
  copyFileSync(databasePath, join(directory, 'aporia.db'));
  writeFileSync(
    join(directory, 'README.txt'),
    [
      'Raw pre-restore copy of an unreadable database.',
      'It could not be validated with integrity_check; preserve it for investigation.',
      '',
    ].join('\n'),
    { flag: 'wx' },
  );
}

export async function restoreBackup(
  options: RestoreOptions,
  now: () => string = () => new Date().toISOString(),
): Promise<RestoreResult> {
  const backupDirectory = resolve(options.backupDirectory);
  const dataDir = resolve(options.dataDir);
  if (backupDirectory === dataDir) {
    throw new BackupError('The backup directory must not be the destination data directory.');
  }
  const manifest = readManifest(backupDirectory);
  const verified = await verifyBackupFile(backupDirectory, manifest);
  const destination = join(dataDir, 'aporia.db');

  const projectCount = destinationProjectCount(destination);
  if (projectCount === null || projectCount > 0) {
    if (!options.replace) {
      throw new BackupError(
        'The destination contains data. Pass --replace and confirm the backup directory name to restore over it.',
      );
    }
    if (options.confirmation !== basename(backupDirectory)) {
      throw new BackupError(
        `The confirmation must exactly match the backup directory name "${basename(backupDirectory)}".`,
      );
    }
  }
  mkdirSync(dataDir, { recursive: true });

  let safetyBackupDirectory: string | null = null;
  if (existsSync(destination)) {
    safetyBackupDirectory = uniqueSafetyDirectory(dataDir, now);
    if (projectCount === null) {
      rawSafetyCopy(destination, safetyBackupDirectory);
    } else {
      await createBackup(destination, safetyBackupDirectory, { now });
    }
    removeSidecars(destination);
  }

  try {
    options.beforeReplace?.();
    await copyAndRename(join(backupDirectory, 'aporia.db'), destination, manifest.databaseSha256);
    removeSidecars(destination);
    const db = readOnlyDatabase(destination);
    let validation: ReturnType<typeof validateDatabase>;
    try {
      validation = validateDatabase(db, verified.migrations);
      assertValidation(validation, manifest.tableCounts);
    } finally {
      db.close();
    }
    return {
      safetyBackupDirectory,
      manifest,
      counts: validation.counts,
    };
  } catch (error) {
    if (safetyBackupDirectory !== null) {
      try {
        const safetyDb = join(safetyBackupDirectory, 'aporia.db');
        await copyAndRename(safetyDb, destination, await hashFile(safetyDb));
        removeSidecars(destination);
      } catch (rollbackError) {
        throw new BackupError(
          `Restore failed (${(error as Error).message}) and the safety copy could not be restored: ${(rollbackError as Error).message}. The safety copy remains at ${safetyBackupDirectory}.`,
        );
      }
    }
    throw error;
  }
}
