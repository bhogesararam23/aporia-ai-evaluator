import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { test } from 'node:test';

const ROOT = resolve(import.meta.dirname, '../..');

function markdownFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (
      entry === 'node_modules' ||
      entry === '.git' ||
      entry === 'data' ||
      entry === '.playwright-mcp'
    ) {
      continue;
    }
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...markdownFiles(path));
    } else if (entry.endsWith('.md')) {
      files.push(path);
    }
  }
  return files;
}

function relativeLinks(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const links: string[] = [];
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const raw = match[1]?.trim();
    if (raw === undefined) {
      continue;
    }
    const withoutTitle = raw.split(/\s+"/)[0] ?? raw;
    if (
      withoutTitle.startsWith('http://') ||
      withoutTitle.startsWith('https://') ||
      withoutTitle.startsWith('mailto:') ||
      withoutTitle.startsWith('#')
    ) {
      continue;
    }
    const withoutAnchor = withoutTitle.split('#')[0] ?? '';
    if (withoutAnchor.length === 0) {
      continue;
    }
    links.push(decodeURIComponent(withoutAnchor));
  }
  return links;
}

test('all relative Markdown links resolve within the repository', () => {
  const files = markdownFiles(ROOT);
  const broken: string[] = [];
  for (const file of files) {
    for (const link of relativeLinks(file)) {
      const target = resolve(dirname(file), link);
      if (!existsSync(target)) {
        broken.push(`${relative(ROOT, file).split(sep).join('/')} -> ${link}`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

test('the ADR index lists every ADR file', () => {
  const adrDirectory = join(ROOT, 'docs/agents/adrs');
  const adrFiles = readdirSync(adrDirectory).filter((file) => file.endsWith('.md'));
  const index = readFileSync(join(ROOT, 'docs/agents/ADR_INDEX.md'), 'utf8');
  for (const file of adrFiles) {
    assert.ok(index.includes(file), `ADR index is missing ${file}`);
  }
});
