import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config.ts';
import type { DatabaseSync } from 'node:sqlite';
import type { Logger } from '../../logger.ts';
import { AppError, toPublicError } from '../../errors.ts';
import { errorPage } from '../views/errors.ts';
import { parseRequestBody } from './body.ts';
import { htmlResponse, type AppResponse } from './responses.ts';
import { Router } from './router.ts';
import {
  createSession,
  securityHeaders,
  validCsrfToken,
  validHostHeader,
  validOrigin,
  type SessionState,
} from './security.ts';
import type { AppDependencies, RouteDefinition, UploadedFile } from './types.ts';
import { routes as defaultRoutes } from '../routes/index.ts';

export interface CreateAppOptions {
  readonly config: AppConfig;
  readonly db: DatabaseSync;
  readonly logger: Logger;
  readonly extraRoutes?: readonly RouteDefinition[];
}

function mergeHeaders(
  base: Readonly<Record<string, string>>,
  extra: Readonly<Record<string, string>>,
  session: SessionState | null,
): Record<string, string> {
  return {
    ...securityHeaders(),
    ...base,
    ...extra,
    ...(session?.setCookie === null || session === null ? {} : { 'Set-Cookie': session.setCookie }),
    'Cache-Control': extra['Cache-Control'] ?? base['Cache-Control'] ?? 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  };
}

function send(
  res: ServerResponse,
  response: AppResponse,
  session: SessionState | null,
  method: string,
): void {
  const body =
    typeof response.body === 'string'
      ? Buffer.from(response.body, 'utf8')
      : Buffer.from(response.body);
  const headers = mergeHeaders(response.headers, {}, session);
  headers['Content-Length'] = String(body.length);
  res.writeHead(response.status, headers);
  if (method === 'HEAD' || response.status === 204 || response.status === 304) {
    res.end();
  } else {
    res.end(body);
  }
}

function publicErrorResponse(error: unknown, requestId: string): AppResponse {
  const publicError = toPublicError(error);
  const title =
    publicError.status === 404
      ? 'Page not found'
      : publicError.status === 405
        ? 'Method not allowed'
        : publicError.status === 413
          ? 'Request too large'
          : publicError.status === 403
            ? 'Request not allowed'
            : publicError.code === 'INTERNAL_ERROR'
              ? 'Something went wrong'
              : 'Request could not be completed';
  const message =
    publicError.code === 'INTERNAL_ERROR'
      ? 'An unexpected internal error occurred. No stack trace or private data is shown here.'
      : publicError.message;
  return htmlResponse(
    errorPage({ status: publicError.status, title, message, requestId }),
    publicError.status,
  );
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: CreateAppOptions,
  router: Router,
): Promise<void> {
  const startedAt = performance.now();
  const requestId = randomUUID();
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  let session: SessionState | null = null;
  let status = 500;

  const finish = (response: AppResponse, allow?: readonly string[]): void => {
    status = response.status;
    const headers = {
      ...response.headers,
      ...(allow === undefined ? {} : { Allow: allow.join(', ') }),
    };
    send(res, { ...response, headers }, session, method);
    options.logger.info('request.completed', {
      requestId,
      method,
      path: url.pathname,
      status,
      durationMs: Math.round(performance.now() - startedAt),
    });
  };

  try {
    if (!validHostHeader(req.headers.host, options.config)) {
      finish(
        publicErrorResponse(
          new AppError(
            'FORBIDDEN',
            'The Host header does not match the configured loopback address.',
          ),
          requestId,
        ),
      );
      return;
    }
    session = createSession(options.config.sessionSecret, req.headers.cookie);
    const match = router.match(method, url.pathname);
    if (match === null) {
      finish(
        publicErrorResponse(
          new AppError('NOT_FOUND', 'The requested page does not exist.'),
          requestId,
        ),
      );
      return;
    }
    if (match.type === 'method-not-allowed') {
      finish(
        publicErrorResponse(
          new AppError('METHOD_NOT_ALLOWED', 'That method is not allowed for this page.'),
          requestId,
        ),
        match.allow,
      );
      return;
    }

    let fields: ReadonlyMap<string, string> = new Map();
    let file: UploadedFile | null = null;
    if (method === 'POST') {
      if (!validOrigin(req.headers.origin, options.config)) {
        throw new AppError('FORBIDDEN', 'The form origin does not match this local application.');
      }
      const parsed = await parseRequestBody(req, {
        maxBodyBytes: options.config.maxBodyBytes,
        maxFileBytes: options.config.maxHtmlBytes,
      });
      fields = parsed.fields;
      file = parsed.file;
      if (!validCsrfToken(options.config.sessionSecret, session.sessionId, fields.get('_csrf'))) {
        throw new AppError(
          'FORBIDDEN',
          'The form token is missing or expired. Reload the page and submit again.',
        );
      }
    }

    const deps: AppDependencies = {
      db: options.db,
      config: options.config,
      logger: options.logger,
    };
    const response = await match.handler({
      req,
      url,
      params: match.params,
      fields,
      file,
      sessionId: session.sessionId,
      csrfToken: session.csrfToken,
      requestId,
      now: new Date().toISOString(),
      deps,
    });
    finish(response);
  } catch (error) {
    status = error instanceof AppError ? error.status : 500;
    if (error instanceof AppError) {
      if (status >= 500) {
        options.logger.error('request.failed', { requestId, code: error.code, path: url.pathname });
      }
    } else {
      options.logger.error('request.unhandled', {
        requestId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        path: url.pathname,
      });
    }
    if (!res.headersSent) {
      finish(publicErrorResponse(error, requestId));
    }
  }
}

export function createApp(options: CreateAppOptions): Server {
  const router = new Router();
  for (const route of [...defaultRoutes, ...(options.extraRoutes ?? [])]) {
    router.add(route);
  }
  return createServer((req, res) => {
    void handleRequest(req, res, options, router);
  });
}
