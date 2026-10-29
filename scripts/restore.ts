import { resolve } from 'node:path';
import { restoreBackup } from '../src/persistence/backup.ts';

function usage(): string {
  return [
    'usage: npm run restore -- <backup-dir> [--data-dir DIR] [--replace --confirm NAME]',
    '',
    'Stops are required: stop the Aporia server before restoring.',
    'The backup digest, schema, foreign keys, table counts and report consistency are validated',
    'before the destination is touched. A pre-restore safety backup is created whenever data',
    'already exists. Replacing a non-empty data directory requires --replace and --confirm with',
    'the exact backup directory name.',
    '',
    'The default data directory is APORIA_DATA_DIR or ./data.',
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

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage());
    return;
  }
  let backupDirectory: string | null = null;
  let dataDir = process.env['APORIA_DATA_DIR'] ?? './data';
  let replace = false;
  let confirmation = '';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--data-dir') {
      dataDir = valueAfter(args, index, '--data-dir');
      index += 1;
    } else if (arg === '--replace') {
      replace = true;
    } else if (arg === '--confirm') {
      confirmation = valueAfter(args, index, '--confirm');
      index += 1;
    } else if (arg?.startsWith('--')) {
      throw new Error(`unknown argument ${String(arg)}`);
    } else if (backupDirectory === null) {
      backupDirectory = arg ?? null;
    } else {
      throw new Error('expected exactly one backup directory');
    }
  }
  if (backupDirectory === null) {
    throw new Error('a backup directory is required');
  }
  if (replace && confirmation.length === 0) {
    throw new Error('--replace requires --confirm with the backup directory name');
  }
  const result = await restoreBackup({
    backupDirectory: resolve(backupDirectory),
    dataDir: resolve(dataDir),
    replace,
    confirmation,
  });
  process.stdout.write(
    [
      result.safetyBackupDirectory === null
        ? 'No existing database needed a safety backup.'
        : `Safety backup: ${result.safetyBackupDirectory}`,
      `Restored schema: ${result.manifest.schemaVersion}`,
      `Restored tables: ${Object.keys(result.counts).length}`,
      `Restored projects: ${result.counts.projects}`,
      `Restored reports: ${result.counts.reports}`,
      'Start the server and inspect the restored records before relying on them.',
      '',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`restore: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
