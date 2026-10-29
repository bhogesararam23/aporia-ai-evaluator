import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createBackup } from '../src/persistence/backup.ts';

function usage(): string {
  return [
    'usage: npm run backup -- [--data-dir DIR] [--output DIR]',
    '',
    'Creates a consistent, validated local backup of the Aporia SQLite database.',
    'The default data directory is APORIA_DATA_DIR or ./data.',
    'The default output is <data-dir>/backups/backup-<timestamp>.',
    'The server should be stopped, or at least not writing, while a backup is taken.',
    '',
  ].join('\n');
}

function valueAfter(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

function stamp(): string {
  return new Date().toISOString().replaceAll(/[:.]/g, '-');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage());
    return;
  }
  let dataDir = process.env['APORIA_DATA_DIR'] ?? './data';
  let output: string | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--data-dir') {
      dataDir = valueAfter(args, index, '--data-dir');
      index += 1;
    } else if (arg === '--output') {
      output = valueAfter(args, index, '--output');
      index += 1;
    } else {
      throw new Error(`unknown argument ${String(arg)}`);
    }
  }
  const resolvedData = resolve(dataDir);
  const databasePath = join(resolvedData, 'aporia.db');
  if (!existsSync(databasePath)) {
    throw new Error(`no database exists at ${databasePath}`);
  }
  const backupDirectory =
    output === null ? join(resolvedData, 'backups', `backup-${stamp()}`) : resolve(output);
  mkdirSync(dirname(backupDirectory), { recursive: true });
  const result = await createBackup(databasePath, backupDirectory);
  process.stdout.write(
    [
      `Backup created: ${result.directory}`,
      `Database: ${result.manifest.byteLength} bytes`,
      `SHA-256: ${result.manifest.databaseSha256}`,
      `Schema: ${result.manifest.schemaVersion}`,
      `Tables: ${Object.keys(result.manifest.tableCounts).length}`,
      `Reports: ${result.manifest.reportConsistency.reports}`,
      'Keep this directory and manifest together; restore validates the digest and counts.',
      '',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`backup: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
