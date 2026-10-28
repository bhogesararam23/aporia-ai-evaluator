import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '../..');
const SRC = join(ROOT, 'src');

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (entry.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

test('the application source contains no external network or provider client', () => {
  const forbidden = [
    /\bfetch\s*\(/,
    /from\s+['"]node:https['"]/,
    /from\s+['"]node:net['"]/,
    /from\s+['"]node:dns['"]/,
    /from\s+['"]undici['"]/,
    /from\s+['"]axios['"]/,
    /from\s+['"]node-fetch['"]/,
    /from\s+['"]got['"]/,
    /from\s+['"]openai['"]/,
    /from\s+['"]@anthropic-ai\//,
    /from\s+['"]@google\/generative-ai['"]/,
    /from\s+['"]cohere-ai['"]/,
    /XMLHttpRequest/,
    /\bhttps\.request\s*\(/,
  ];
  const violations: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      if (pattern.test(text)) {
        violations.push(`${relative(ROOT, file)} matches ${pattern.source}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});
