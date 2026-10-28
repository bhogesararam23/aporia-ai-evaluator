import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ConfigError, describeConfig, isLoopbackHost, loadConfig } from '../../src/config.ts';

function tempDir(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'aporia-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('loads safe defaults and creates the data directory', (t) => {
  const dataDir = join(tempDir(t), 'nested-data');
  const config = loadConfig({ APORIA_DATA_DIR: dataDir });
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 4310);
  assert.equal(config.operator, 'local-operator');
  assert.equal(config.maxBodyBytes, 2 * 1024 * 1024);
  assert.equal(config.maxHtmlBytes, 1024 * 1024);
  assert.equal(config.logLevel, 'info');
  assert.equal(config.databasePath, join(dataDir, 'aporia.db'));
  assert.equal(config.sessionSecret.length, 32);
  assert.equal('sessionSecret' in describeConfig(config), false);
});

test('accepts IPv6 loopback and a custom operator', (t) => {
  const config = loadConfig({
    APORIA_DATA_DIR: tempDir(t),
    APORIA_HOST: '::1',
    APORIA_PORT: '4555',
    APORIA_OPERATOR: '  Ram  ',
    APORIA_LOG_LEVEL: 'debug',
  });
  assert.equal(config.host, '::1');
  assert.equal(config.port, 4555);
  assert.equal(config.operator, 'Ram');
  assert.equal(config.logLevel, 'debug');
});

test('rejects remote and hostname bindings', (t) => {
  const dataDir = tempDir(t);
  for (const host of ['0.0.0.0', 'localhost', 'example.com', '192.168.1.10', '::']) {
    assert.throws(
      () => loadConfig({ APORIA_DATA_DIR: dataDir, APORIA_HOST: host }),
      (error: unknown) => error instanceof ConfigError && error.field === 'APORIA_HOST',
    );
  }
});

test('rejects invalid ports and byte limits', (t) => {
  const dataDir = tempDir(t);
  const cases: Array<[string, string]> = [
    ['APORIA_PORT', '0'],
    ['APORIA_PORT', '65536'],
    ['APORIA_PORT', '12.5'],
    ['APORIA_MAX_BODY_BYTES', '100'],
    ['APORIA_MAX_HTML_BYTES', '99999999'],
    ['APORIA_LOG_LEVEL', 'verbose'],
  ];
  for (const [field, value] of cases) {
    assert.throws(
      () => loadConfig({ APORIA_DATA_DIR: dataDir, [field]: value }),
      (error: unknown) => error instanceof ConfigError && error.field === field,
    );
  }
});

test('rejects an HTML limit larger than the body limit', (t) => {
  const dataDir = tempDir(t);
  assert.throws(
    () =>
      loadConfig({
        APORIA_DATA_DIR: dataDir,
        APORIA_MAX_BODY_BYTES: '32768',
        APORIA_MAX_HTML_BYTES: '65536',
      }),
    (error: unknown) => error instanceof ConfigError && error.field === 'APORIA_MAX_HTML_BYTES',
  );
});

test('rejects unsafe operator labels', (t) => {
  const dataDir = tempDir(t);
  assert.throws(
    () => loadConfig({ APORIA_DATA_DIR: dataDir, APORIA_OPERATOR: 'bad\u0000name' }),
    (error: unknown) => error instanceof ConfigError && error.field === 'APORIA_OPERATOR',
  );
  assert.throws(
    () => loadConfig({ APORIA_DATA_DIR: dataDir, APORIA_OPERATOR: 'x'.repeat(81) }),
    (error: unknown) => error instanceof ConfigError && error.field === 'APORIA_OPERATOR',
  );
});

test('rejects a data path that is a file', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'not-a-dir');
  writeFileSync(file, 'x');
  assert.throws(
    () => loadConfig({ APORIA_DATA_DIR: file }),
    (error: unknown) => error instanceof ConfigError && error.field === 'APORIA_DATA_DIR',
  );
});

test('rejects a data directory that cannot be created', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'file');
  writeFileSync(file, 'x');
  assert.throws(
    () => loadConfig({ APORIA_DATA_DIR: join(file, 'child') }),
    (error: unknown) => error instanceof ConfigError && error.field === 'APORIA_DATA_DIR',
  );
});

test('loopback predicate only accepts literal loopback addresses', () => {
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('::1'), true);
  assert.equal(isLoopbackHost('localhost'), false);
  assert.equal(isLoopbackHost('127.0.0.2'), false);
});

test('creates a nested data directory with an existing parent', (t) => {
  const dir = tempDir(t);
  const dataDir = join(dir, 'one', 'two');
  mkdirSync(join(dir, 'one'));
  const config = loadConfig({ APORIA_DATA_DIR: dataDir });
  assert.equal(config.dataDir, dataDir);
});
