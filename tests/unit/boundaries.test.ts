import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { checkBoundaries } from '../../scripts/check-boundaries.ts';

test('source modules respect the documented dependency direction', () => {
  assert.deepEqual(checkBoundaries(), []);
});

/**
 * A boundary rule that no test exercises is a rule that will silently stop holding. Each case writes
 * a tiny fake source tree and asserts the checker names the violation.
 *
 * Fixture paths are written with forward slashes and joined per platform. Embedding a literal
 * backslash instead builds one oddly named file on any non-Windows runner, and the checker then
 * reports a clean run over a tree that was never assembled - a passing test that proves nothing.
 */
function tree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'aporia-boundaries-'));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, ...path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, 'utf8');
    // Confirming the file landed where the declaration says means a tree that failed to assemble
    // fails here, instead of leaving the checker a clean empty directory and a green test that
    // proved nothing.
    if (!existsSync(target)) {
      throw new Error(`Fixture did not create ${path}`);
    }
  }
  return root;
}

test('the benchmark layer may not reach persistence, reporting or the app', (t) => {
  const root = tree({
    'src/benchmark/one.ts': "import { x } from '../persistence/db.ts';\nexport const y = x;\n",
    'src/persistence/db.ts': 'export const x = 1;\n',
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const violations = checkBoundaries(root);
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.file, 'src/benchmark/one.ts');
  assert.equal(violations[0]?.specifier, '../persistence/db.ts');
  assert.match(violations[0]?.reason ?? '', /benchmark/);
});

test('the benchmark layer may not import a third-party package', (t) => {
  const root = tree({
    'src/benchmark/two.ts': "import parse5 from 'parse5';\nexport const y = parse5;\n",
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const violations = checkBoundaries(root);
  assert.equal(violations.length, 1);
  assert.match(violations[0]?.reason ?? '', /node builtins and core modules/);
});

test('the benchmark layer may import core, and core may not import back', (t) => {
  const allowed = tree({
    'src/benchmark/three.ts': "import { a } from '../core/thing.ts';\nexport const b = a;\n",
    'src/core/thing.ts': 'export const a = 1;\n',
  });
  const reversed = tree({
    'src/core/thing.ts': "import { b } from '../benchmark/four.ts';\nexport const a = b;\n",
    'src/benchmark/four.ts': 'export const b = 1;\n',
  });
  t.after(() => {
    rmSync(allowed, { recursive: true, force: true });
    rmSync(reversed, { recursive: true, force: true });
  });
  assert.deepEqual(checkBoundaries(allowed), []);
  const reversedViolations = checkBoundaries(reversed);
  assert.equal(reversedViolations.length, 1, JSON.stringify(reversedViolations));
  assert.match(
    reversedViolations[0]?.reason ?? '',
    /core may only import core modules|must not import benchmark/,
  );
});

test('a benchmark file reaching a sibling non-core directory is refused', (t) => {
  const root = tree({
    'src/benchmark/five.ts':
      "import { helper } from '../shared/six.ts';\nexport const x = helper;\n",
    'src/shared/six.ts': 'export const helper = 1;\n',
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const violations = checkBoundaries(root);
  assert.equal(violations.length, 1, JSON.stringify(violations));
  assert.equal(violations[0]?.file, 'src/benchmark/five.ts');
  assert.equal(violations[0]?.specifier, '../shared/six.ts');
});

test('a benchmark file importing another benchmark file stays clean', (t) => {
  const root = tree({
    'src/benchmark/five.ts': "import { helper } from './six.ts';\nexport const x = helper;\n",
    'src/benchmark/six.ts': 'export const helper = 1;\n',
  });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(checkBoundaries(root), []);
});
