import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../../config.ts';
import { isLoopbackHost } from '../../config.ts';

export const SESSION_COOKIE = 'aporia_sid';
const SESSION_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface SessionState {
  readonly sessionId: string;
  readonly csrfToken: string;
  readonly setCookie: string | null;
}

export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (cookieHeader === undefined) {
    return null;
  }
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return rest.join('=') || null;
    }
  }
  return null;
}

export function createSession(secret: Buffer, cookieHeader: string | undefined): SessionState {
  const existing = readCookie(cookieHeader, SESSION_COOKIE);
  if (existing !== null && SESSION_PATTERN.test(existing)) {
    return {
      sessionId: existing,
      csrfToken: csrfTokenFor(secret, existing),
      setCookie: null,
    };
  }
  const sessionId = randomBytes(32).toString('base64url');
  return {
    sessionId,
    csrfToken: csrfTokenFor(secret, sessionId),
    setCookie: `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Strict`,
  };
}

export function csrfTokenFor(secret: Buffer, sessionId: string): string {
  return createHmac('sha256', secret).update(sessionId, 'utf8').digest('base64url');
}

export function validCsrfToken(
  secret: Buffer,
  sessionId: string,
  submitted: string | null | undefined,
): boolean {
  if (submitted === null || submitted === undefined) {
    return false;
  }
  const expected = Buffer.from(csrfTokenFor(secret, sessionId), 'utf8');
  const actual = Buffer.from(submitted, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function bracketHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

export function expectedHost(config: AppConfig): string {
  return `${bracketHost(config.host)}:${String(config.port)}`;
}

function parseHostHeader(hostHeader: string): { hostname: string; port: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(`http://${hostHeader.trim()}`);
  } catch {
    return null;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return null;
  }
  if (parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    return null;
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const port = parsed.port === '' ? '80' : parsed.port;
  return { hostname, port };
}

export function validHostHeader(hostHeader: string | undefined, config: AppConfig): boolean {
  if (hostHeader === undefined || hostHeader.length === 0) {
    return false;
  }
  const parsed = parseHostHeader(hostHeader);
  if (parsed === null) {
    return false;
  }
  if (parsed.hostname !== config.host) {
    return false;
  }
  if (config.port === 0) {
    return true;
  }
  return Number.parseInt(parsed.port, 10) === config.port;
}

export function validOrigin(origin: string | undefined, config: AppConfig): boolean {
  if (origin === undefined || origin.length === 0) {
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' || parsed.username !== '' || parsed.password !== '') {
    return false;
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!isLoopbackHost(hostname)) {
    return false;
  }
  if (config.port === 0) {
    return hostname === config.host;
  }
  return parsed.host === expectedHost(config);
}

export function securityHeaders(): Record<string, string> {
  return {
    'Content-Security-Policy':
      "default-src 'none'; style-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}
