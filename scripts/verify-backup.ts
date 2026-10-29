import { resolve } from 'node:path';
import { verifyBackup } from '../src/persistence/backup.ts';

function usage(): string {
  return [
    'usage: npm run backup:verify -- <backup-dir>',
    '',
    'Validates a backup manifest, database digest, schema identity, integrity, foreign keys,',
    'table counts and report consistency without restoring it.',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage());
    return;
  }
  if (args.length !== 1) {
    throw new Error('expected exactly one backup directory');
  }
  const directory = resolve(args[0] ?? '');
  const verified = await verifyBackup(directory);
  process.stdout.write(
    [
      `Backup verified: ${directory}`,
      `Created: ${verified.manifest.createdAt}`,
      `App version: ${verified.manifest.appVersion}`,
      `Schema: ${verified.manifest.schemaVersion}`,
      `SHA-256: ${verified.manifest.databaseSha256}`,
      `Projects: ${verified.counts.projects}`,
      `Reports: ${verified.counts.reports}`,
      `Achievements: ${verified.counts.achievements}`,
      'The manifest and every checked count agree with the database copy.',
      '',
    ].join('\n'),
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `backup:verify: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
