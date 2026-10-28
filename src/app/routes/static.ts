import { readFileSync } from 'node:fs';
import { APP_VERSION } from '../../version.ts';
import { emptyResponse, jsonResponse } from '../http/responses.ts';
import type { RouteDefinition } from '../http/types.ts';

const CSS = readFileSync(new URL('../assets/app.css', import.meta.url), 'utf8');

export const staticRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/assets/app.css',
    handler: () => ({
      status: 200,
      headers: {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
      body: CSS,
    }),
  },
  {
    method: 'GET',
    path: '/health',
    handler: (context) => {
      const row = context.deps.db.prepare('SELECT 1 AS ok').get();
      return jsonResponse({
        status: row?.['ok'] === 1 ? 'ok' : 'degraded',
        version: APP_VERSION,
        mode: 'local-only',
        database: 'ok',
      });
    },
  },
  {
    method: 'GET',
    path: '/favicon.ico',
    handler: () => emptyResponse(204),
  },
];
