import { accessSync, constants, mkdirSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';

export const LOOPBACK_HOSTS = ['127.0.0.1', '::1'] as const;
export type LoopbackHost = (typeof LOOPBACK_HOSTS)[number];

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppConfig {
  readonly host: LoopbackHost;
  readonly port: number;
  readonly dataDir: string;
  readonly databasePath: string;
  readonly operator: string;
  readonly maxBodyBytes: number;
  readonly maxHtmlBytes: number;
  readonly logLevel: LogLevel;
  readonly sessionSecret: Buffer;
}

export class ConfigError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = 'ConfigError';
    this.field = field;
  }
}

const DEFAULT_PORT = 4310;
const DEFAULT_OPERATOR = 'local-operator';
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_HTML_BYTES = 1024 * 1024;
const MIN_BODY_BYTES = 16 * 1024;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MIN_HTML_BYTES = 8 * 1024;
const MAX_HTML_BYTES = 5 * 1024 * 1024;

export function isLoopbackHost(value: string): value is LoopbackHost {
  return (LOOPBACK_HOSTS as readonly string[]).includes(value);
}

function readEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function parseInteger(
  field: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined) {
    return fallback;
  }
  if (!/^[0-9]+$/.test(raw)) {
    throw new ConfigError(field, `${field} must be a whole number between ${min} and ${max}.`);
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigError(field, `${field} must be a whole number between ${min} and ${max}.`);
  }
  return value;
}

function parseHost(env: NodeJS.ProcessEnv): LoopbackHost {
  const raw = readEnv(env, 'APORIA_HOST') ?? '127.0.0.1';
  if (!isLoopbackHost(raw)) {
    throw new ConfigError(
      'APORIA_HOST',
      `APORIA_HOST must be a loopback address (${LOOPBACK_HOSTS.join(' or ')}). ` +
        'Remote binding is not supported in local v0.1.',
    );
  }
  return raw;
}

function parseLogLevel(env: NodeJS.ProcessEnv): LogLevel {
  const raw = readEnv(env, 'APORIA_LOG_LEVEL') ?? 'info';
  if (!(LOG_LEVELS as readonly string[]).includes(raw)) {
    throw new ConfigError(
      'APORIA_LOG_LEVEL',
      `APORIA_LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}.`,
    );
  }
  return raw as LogLevel;
}

function parseOperator(env: NodeJS.ProcessEnv): string {
  const raw = readEnv(env, 'APORIA_OPERATOR') ?? DEFAULT_OPERATOR;
  if (raw.length > 80) {
    throw new ConfigError('APORIA_OPERATOR', 'APORIA_OPERATOR must be 80 characters or fewer.');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    throw new ConfigError(
      'APORIA_OPERATOR',
      'APORIA_OPERATOR must not contain control characters.',
    );
  }
  return raw;
}

function prepareDataDir(env: NodeJS.ProcessEnv): string {
  const raw = readEnv(env, 'APORIA_DATA_DIR') ?? './data';
  const dataDir = resolve(raw);
  try {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  } catch (error) {
    throw new ConfigError(
      'APORIA_DATA_DIR',
      `Cannot create the data directory at ${dataDir}: ${(error as Error).message}`,
    );
  }
  const stat = statSync(dataDir);
  if (!stat.isDirectory()) {
    throw new ConfigError(
      'APORIA_DATA_DIR',
      `APORIA_DATA_DIR must point to a directory: ${dataDir}`,
    );
  }
  try {
    accessSync(dataDir, constants.W_OK);
  } catch {
    throw new ConfigError('APORIA_DATA_DIR', `The data directory is not writable: ${dataDir}`);
  }
  return dataDir;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const host = parseHost(env);
  const port = parseInteger('APORIA_PORT', readEnv(env, 'APORIA_PORT'), DEFAULT_PORT, 1, 65535);
  const maxBodyBytes = parseInteger(
    'APORIA_MAX_BODY_BYTES',
    readEnv(env, 'APORIA_MAX_BODY_BYTES'),
    DEFAULT_MAX_BODY_BYTES,
    MIN_BODY_BYTES,
    MAX_BODY_BYTES,
  );
  const maxHtmlBytes = parseInteger(
    'APORIA_MAX_HTML_BYTES',
    readEnv(env, 'APORIA_MAX_HTML_BYTES'),
    DEFAULT_MAX_HTML_BYTES,
    MIN_HTML_BYTES,
    MAX_HTML_BYTES,
  );
  if (maxHtmlBytes > maxBodyBytes) {
    throw new ConfigError(
      'APORIA_MAX_HTML_BYTES',
      'APORIA_MAX_HTML_BYTES must not exceed APORIA_MAX_BODY_BYTES.',
    );
  }
  const dataDir = prepareDataDir(env);
  return {
    host,
    port,
    dataDir,
    databasePath: join(dataDir, 'aporia.db'),
    operator: parseOperator(env),
    maxBodyBytes,
    maxHtmlBytes,
    logLevel: parseLogLevel(env),
    sessionSecret: randomBytes(32),
  };
}

export function describeConfig(config: AppConfig): Record<string, string | number> {
  return {
    host: config.host,
    port: config.port,
    dataDir: config.dataDir,
    databasePath: config.databasePath,
    operator: config.operator,
    maxBodyBytes: config.maxBodyBytes,
    maxHtmlBytes: config.maxHtmlBytes,
    logLevel: config.logLevel,
  };
}
