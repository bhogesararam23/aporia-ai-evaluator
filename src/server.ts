import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import type { AppConfig } from './config.ts';
import { createLogger } from './logger.ts';
import { createApp } from './app/http/app.ts';
import { openDatabase } from './persistence/db.ts';
import { loadMigrations, runMigrations } from './persistence/migrate.ts';

export async function main(): Promise<void> {
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (error) {
    process.stderr.write(
      `Aporia configuration error: ${error instanceof Error ? error.message : 'unknown error'}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const logger = createLogger({ level: config.logLevel });
  const db = openDatabase(config.databasePath);
  try {
    const migrations = loadMigrations(
      fileURLToPath(new URL('./persistence/migrations', import.meta.url)),
    );
    const applied = runMigrations(db, migrations);
    const app = createApp({ config, db, logger });

    const server = app.listen(config.port, config.host, () => {
      logger.info('server.started', {
        host: config.host,
        port: config.port,
        url: `http://${config.host}:${config.port}`,
        migrationsApplied: applied.length,
        localOnly: true,
      });
    });

    const shutdown = (signal: string): void => {
      logger.info('server.shutdown', { signal });
      server.close(() => {
        db.close();
      });
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    server.on('error', (error) => {
      logger.error('server.error', {
        errorName: error.name,
        code: 'code' in error && typeof error.code === 'string' ? error.code : 'unknown',
      });
      process.exitCode = 1;
    });
  } catch (error) {
    logger.error('server.start_failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    db.close();
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
