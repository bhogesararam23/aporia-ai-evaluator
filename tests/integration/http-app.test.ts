import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig, type AppConfig } from '../../src/config.ts';
import { createApp } from '../../src/app/http/app.ts';
import { htmlResponse } from '../../src/app/http/responses.ts';
import type { RouteDefinition } from '../../src/app/http/types.ts';
import { closeDatabase, openDatabase } from '../../src/persistence/db.ts';
import { loadMigrations, runMigrations } from '../../src/persistence/migrate.ts';
import { createSilentLogger } from '../../src/logger.ts';
import { html } from '../../src/app/views/html.ts';
import { csrfField } from '../../src/app/views/components.ts';

interface TestServer {
  readonly url: string;
  readonly server: Server;
  readonly db: ReturnType<typeof openDatabase>;
  readonly config: AppConfig;
  readonly close: () => Promise<void>;
}

async function start(extraRoutes: RouteDefinition[] = []): Promise<TestServer> {
  const dataDir = mkdtempSync(join(tmpdir(), 'aporia-http-'));
  const config = loadConfig({
    APORIA_DATA_DIR: dataDir,
    APORIA_HOST: '127.0.0.1',
    APORIA_PORT: '4310',
    APORIA_OPERATOR: 'Ram',
    APORIA_LOG_LEVEL: 'error',
  });
  const db = openDatabase(':memory:');
  runMigrations(db, loadMigrations(join(import.meta.dirname, '../../src/persistence/migrations')));
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

function testRoutes(): RouteDefinition[] {
  return [
    {
      method: 'GET',
      path: '/test-form',
      handler: (context) =>
        htmlResponse(
          html`<form method="post" action="/test-form">
            ${csrfField(context.csrfToken)}<button type="submit">Send</button>
          </form>`,
        ),
    },
    {
      method: 'POST',
      path: '/test-form',
      handler: (context) => htmlResponse(`received:${context.fields.get('value') ?? ''}`),
    },
    {
      method: 'GET',
      path: '/boom',
      handler: () => {
        throw new Error('secret internal detail');
      },
    },
  ];
}

function cookieFrom(response: Response): string {
  const header = response.headers.get('set-cookie');
  assert.ok(header);
  return header.split(';')[0] ?? '';
}

function csrfFrom(htmlText: string): string {
  const match = /name="_csrf" value="([^"]+)"/.exec(htmlText);
  assert.ok(match?.[1]);
  return match[1];
}

test('serves the empty state with security headers and no seeded data', async () => {
  const server = await start();
  try {
    const response = await fetch(`${server.url}/`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /No projects yet/);
    assert.match(body, /Create your first project/);
    assert.equal(body.includes('Demo project'), false);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.ok(response.headers.get('set-cookie')?.includes('HttpOnly'));
  } finally {
    await server.close();
  }
});

test('serves health and a cached local stylesheet without inline styles', async () => {
  const server = await start();
  try {
    const health = await fetch(`${server.url}/health`);
    assert.equal(health.status, 200);
    const healthBody = (await health.json()) as Record<string, unknown>;
    assert.equal(healthBody['status'], 'ok');
    assert.equal(healthBody['mode'], 'local-only');

    const css = await fetch(`${server.url}/assets/app.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type') ?? '', /text\/css/);
    assert.match(css.headers.get('cache-control') ?? '', /max-age/);
    const cssText = await css.text();
    assert.match(cssText, /:root/);
  } finally {
    await server.close();
  }
});

test('requires a valid CSRF token and same-origin POST', async () => {
  const server = await start(testRoutes());
  try {
    const formPage = await fetch(`${server.url}/test-form`);
    const cookie = cookieFrom(formPage);
    const token = csrfFrom(await formPage.text());

    const missing = await fetch(`${server.url}/test-form`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ value: 'x' }),
      redirect: 'manual',
    });
    assert.equal(missing.status, 403);

    const invalid = await fetch(`${server.url}/test-form`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ _csrf: 'wrong', value: 'x' }),
      redirect: 'manual',
    });
    assert.equal(invalid.status, 403);

    const valid = await fetch(`${server.url}/test-form`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
        origin: server.url,
      },
      body: new URLSearchParams({ _csrf: token, value: 'ok' }),
      redirect: 'manual',
    });
    assert.equal(valid.status, 200);
    assert.equal(await valid.text(), 'received:ok');

    const crossOrigin = await fetch(`${server.url}/test-form`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'http://evil.example',
      },
      body: new URLSearchParams({ _csrf: token, value: 'bad' }),
      redirect: 'manual',
    });
    assert.equal(crossOrigin.status, 403);
  } finally {
    await server.close();
  }
});

test('rejects foreign Host headers', async () => {
  const server = await start();
  try {
    const port = new URL(server.url).port;
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: Number(port),
          path: '/',
          method: 'GET',
          headers: { Host: `evil.example:${port}` },
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            body += chunk;
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(response.status, 403);
    assert.match(response.body, /Host header/);
  } finally {
    await server.close();
  }
});

test('returns safe 404, 405, and 500 pages without stack traces', async () => {
  const server = await start(testRoutes());
  try {
    const notFound = await fetch(`${server.url}/missing`);
    assert.equal(notFound.status, 404);
    const notFoundBody = await notFound.text();
    assert.match(notFoundBody, /Page not found/);
    assert.equal(notFoundBody.includes('secret internal detail'), false);

    const method = await fetch(`${server.url}/test-form`, { method: 'DELETE' });
    assert.equal(method.status, 405);
    assert.equal(method.headers.get('allow'), 'GET, POST');

    const boom = await fetch(`${server.url}/boom`);
    assert.equal(boom.status, 500);
    const boomBody = await boom.text();
    assert.match(boomBody, /Something went wrong/);
    assert.equal(boomBody.includes('secret internal detail'), false);
    assert.equal(boomBody.includes('Error:'), false);
  } finally {
    await server.close();
  }
});

test('rejects oversized request bodies before route handling', async () => {
  const server = await start(testRoutes());
  try {
    const formPage = await fetch(`${server.url}/test-form`);
    const cookie = cookieFrom(formPage);
    const token = csrfFrom(await formPage.text());
    const response = await fetch(`${server.url}/test-form`, {
      method: 'POST',
      headers: {
        cookie,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: `_csrf=${token}&value=${'x'.repeat(3_000_000)}`,
      redirect: 'manual',
    });
    assert.equal(response.status, 413);
  } finally {
    await server.close();
  }
});
