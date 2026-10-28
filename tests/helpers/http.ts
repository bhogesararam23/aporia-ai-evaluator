import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type AppConfig } from '../../src/config.ts';
import { createApp } from '../../src/app/http/app.ts';
import type { RouteDefinition } from '../../src/app/http/types.ts';
import { createSilentLogger } from '../../src/logger.ts';
import { closeDatabase, openDatabase } from '../../src/persistence/db.ts';
import { loadMigrations, runMigrations } from '../../src/persistence/migrate.ts';

const MIGRATIONS = join(import.meta.dirname, '../../src/persistence/migrations');

export interface TestServer {
  readonly url: string;
  readonly server: Server;
  readonly db: ReturnType<typeof openDatabase>;
  readonly config: AppConfig;
  readonly close: () => Promise<void>;
}

export async function startTestServer(
  extraRoutes: readonly RouteDefinition[] = [],
): Promise<TestServer> {
  const dataDir = mkdtempSync(join(tmpdir(), 'aporia-http-'));
  const config = loadConfig({
    APORIA_DATA_DIR: dataDir,
    APORIA_HOST: '127.0.0.1',
    APORIA_PORT: '4310',
    APORIA_OPERATOR: 'Ram',
    APORIA_LOG_LEVEL: 'error',
  });
  const db = openDatabase(':memory:');
  runMigrations(db, loadMigrations(MIGRATIONS));
  const app = createApp({
    config: { ...config, port: 0 },
    db,
    logger: createSilentLogger(),
    extraRoutes,
  });
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  const address = app.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Test server did not bind to a port.');
  }
  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    server: app,
    db,
    config: { ...config, port: 0 },
    close: () =>
      new Promise((resolve) => {
        app.closeAllConnections();
        app.close(() => {
          closeDatabase(db);
          rmSync(dataDir, { recursive: true, force: true });
          resolve();
        });
      }),
  };
}

export function cookieFrom(response: Response): string {
  const header = response.headers.get('set-cookie');
  assert.ok(header, 'expected a session cookie');
  return header.split(';')[0] ?? '';
}

export function csrfFrom(text: string): string {
  const match = /name="_csrf" value="([^"]+)"/.exec(text);
  assert.ok(match?.[1], 'expected a CSRF field in the page');
  return match[1];
}

export async function getPage(
  server: TestServer,
  path: string,
  cookie?: string,
): Promise<{ response: Response; text: string; cookie: string }> {
  const response = await fetch(`${server.url}${path}`, {
    headers: cookie === undefined ? {} : { cookie },
    redirect: 'manual',
  });
  const text = await response.text();
  return { response, text, cookie: cookie ?? cookieFrom(response) };
}

export async function postForm(
  server: TestServer,
  path: string,
  cookie: string,
  token: string,
  fields: Record<string, string>,
): Promise<Response> {
  return fetch(`${server.url}${path}`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/x-www-form-urlencoded',
      origin: server.url,
    },
    body: new URLSearchParams({ _csrf: token, ...fields }),
    redirect: 'manual',
  });
}

export function pathOf(location: string): string {
  return location.split('?')[0] ?? location;
}

export function locationOf(response: Response): string {
  const location = response.headers.get('location');
  assert.ok(location, 'expected a redirect location');
  return location.startsWith('http') ? location : location;
}
