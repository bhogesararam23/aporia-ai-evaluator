import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLogger, createSilentLogger } from '../../src/logger.ts';

function capture(): { lines: string[]; sink: (line: string) => void } {
  const lines: string[] = [];
  return { lines, sink: (line) => lines.push(line) };
}

test('emits structured JSON and filters by level', () => {
  const { lines, sink } = capture();
  const logger = createLogger({
    level: 'info',
    sink,
    now: () => new Date('2026-10-28T12:00:00.000Z'),
  });
  logger.debug('ignored');
  logger.info('server.started', { port: 4310 });
  logger.warn('slow.request', { durationMs: 1200 });
  logger.error('request.failed', { code: 'INTERNAL_ERROR' });

  assert.equal(lines.length, 3);
  const first = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
  assert.deepEqual(first, {
    time: '2026-10-28T12:00:00.000Z',
    level: 'info',
    event: 'server.started',
    port: 4310,
  });
});

test('redacts sensitive fields and drops undefined values', () => {
  const { lines, sink } = capture();
  const logger = createLogger({ level: 'debug', sink });
  logger.info('test', {
    authorization: 'Bearer secret',
    cookie: 'session=abc',
    csrfToken: 'abc',
    answer: 'visible but not logged by convention',
    missing: undefined,
  });
  const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
  assert.equal(entry['authorization'], '[redacted]');
  assert.equal(entry['cookie'], '[redacted]');
  assert.equal(entry['csrfToken'], '[redacted]');
  assert.equal(entry['answer'], 'visible but not logged by convention');
  assert.equal('missing' in entry, false);
});

test('truncates long string fields', () => {
  const { lines, sink } = capture();
  const logger = createLogger({ level: 'debug', sink });
  logger.info('test', { note: 'x'.repeat(600) });
  const entry = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
  assert.equal(typeof entry['note'], 'string');
  assert.equal((entry['note'] as string).length, 501);
});

test('silent logger writes nothing', () => {
  const logger = createSilentLogger();
  logger.error('ignored');
});
