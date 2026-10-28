import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AppConfig } from '../../src/config.ts';
import {
  createSession,
  csrfTokenFor,
  expectedHost,
  securityHeaders,
  validCsrfToken,
  validHostHeader,
  validOrigin,
} from '../../src/app/http/security.ts';

function config(port = 4310, host: '127.0.0.1' | '::1' = '127.0.0.1'): AppConfig {
  return {
    host,
    port,
    dataDir: '/tmp/aporia',
    databasePath: '/tmp/aporia/aporia.db',
    operator: 'Ram',
    maxBodyBytes: 2_000_000,
    maxHtmlBytes: 1_000_000,
    logLevel: 'error',
    sessionSecret: Buffer.alloc(32, 7),
  };
}

test('creates a session and CSRF token, reusing a valid cookie', () => {
  const cfg = config();
  const first = createSession(cfg.sessionSecret, undefined);
  assert.match(first.sessionId, /^[A-Za-z0-9_-]{43}$/);
  assert.match(first.csrfToken, /^[A-Za-z0-9_-]+$/);
  assert.ok(first.setCookie?.includes('HttpOnly'));
  assert.ok(first.setCookie?.includes('SameSite=Strict'));
  const token = csrfTokenFor(cfg.sessionSecret, first.sessionId);
  assert.equal(first.csrfToken, token);
  assert.equal(validCsrfToken(cfg.sessionSecret, first.sessionId, token), true);
  assert.equal(validCsrfToken(cfg.sessionSecret, first.sessionId, 'wrong'), false);
  assert.equal(validCsrfToken(cfg.sessionSecret, first.sessionId, null), false);

  const reused = createSession(cfg.sessionSecret, `other=1; aporia_sid=${first.sessionId}`);
  assert.equal(reused.sessionId, first.sessionId);
  assert.equal(reused.csrfToken, first.csrfToken);
  assert.equal(reused.setCookie, null);
});

test('rejects invalid and missing session cookies', () => {
  const cfg = config();
  const bad = createSession(cfg.sessionSecret, 'aporia_sid=short');
  assert.notEqual(bad.sessionId, 'short');
  assert.ok(bad.setCookie !== null);
  const missing = createSession(cfg.sessionSecret, 'other=1');
  assert.ok(missing.setCookie !== null);
});

test('host validation accepts only the configured loopback host and port', () => {
  const cfg = config();
  assert.equal(validHostHeader('127.0.0.1:4310', cfg), true);
  assert.equal(validHostHeader('127.0.0.1:4311', cfg), false);
  assert.equal(validHostHeader('localhost:4310', cfg), false);
  assert.equal(validHostHeader('evil.example:4310', cfg), false);
  assert.equal(validHostHeader('127.0.0.1', cfg), false);
  assert.equal(validHostHeader(undefined, cfg), false);
  assert.equal(expectedHost(cfg), '127.0.0.1:4310');

  const ipv6 = config(4310, '::1');
  assert.equal(validHostHeader('[::1]:4310', ipv6), true);
  assert.equal(validHostHeader('[::1]:4311', ipv6), false);

  const testPort = config(0);
  assert.equal(validHostHeader('127.0.0.1:4567', testPort), true);
  assert.equal(validHostHeader('evil.example:4567', testPort), false);
});

test('origin validation accepts same-origin forms and rejects cross-origin forms', () => {
  const cfg = config();
  assert.equal(validOrigin(undefined, cfg), true);
  assert.equal(validOrigin('', cfg), true);
  assert.equal(validOrigin('http://127.0.0.1:4310', cfg), true);
  assert.equal(validOrigin('http://127.0.0.1:4311', cfg), false);
  assert.equal(validOrigin('https://127.0.0.1:4310', cfg), false);
  assert.equal(validOrigin('http://evil.example', cfg), false);
  assert.equal(validOrigin('not a url', cfg), false);
});

test('security headers enforce a restrictive local policy', () => {
  const headers = securityHeaders();
  assert.match(headers['Content-Security-Policy'] ?? '', /default-src 'none'/);
  assert.match(headers['Content-Security-Policy'] ?? '', /frame-ancestors 'none'/);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
});
