import type { LogLevel } from './config.ts';

export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SENSITIVE_KEY = /(authorization|cookie|csrf|password|secret|session|token|api[_-]?key)/i;
const MAX_STRING_LENGTH = 500;

function sanitizeFields(fields: LogFields | undefined): LogFields {
  if (fields === undefined) {
    return {};
  }
  const safe: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    if (SENSITIVE_KEY.test(key)) {
      safe[key] = '[redacted]';
      continue;
    }
    safe[key] =
      typeof value === 'string' && value.length > MAX_STRING_LENGTH
        ? `${value.slice(0, MAX_STRING_LENGTH)}…`
        : value;
  }
  return safe;
}

export interface LoggerOptions {
  level: LogLevel;
  sink?: (line: string) => void;
  now?: () => Date;
}

export function createLogger(options: LoggerOptions): Logger {
  const threshold = LEVEL_WEIGHT[options.level];
  const sink = options.sink ?? ((line: string) => process.stdout.write(line));
  const now = options.now ?? (() => new Date());

  function emit(level: LogLevel, event: string, fields?: LogFields): void {
    if (LEVEL_WEIGHT[level] < threshold) {
      return;
    }
    const entry = {
      time: now().toISOString(),
      level,
      event,
      ...sanitizeFields(fields),
    };
    sink(`${JSON.stringify(entry)}\n`);
  }

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  };
}

export function createSilentLogger(): Logger {
  const noop = (): void => {};
  return { debug: noop, info: noop, warn: noop, error: noop };
}
