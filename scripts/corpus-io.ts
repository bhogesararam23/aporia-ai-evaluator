/**
 * Shared corpus and artifact loading for the benchmark command-line tools.
 *
 * Both `benchmark:case` and `benchmark:release` read a directory of case files and a directory of workflow
 * artifacts. That reading is where a hostile or half-written file is first met, so it lives in one place: a
 * duplicate loader is a duplicate set of assumptions about what "unreadable" means, and only one of them
 * would get fixed.
 *
 * These helpers throw a typed error instead of exiting, so each command decides how to report it. A CLI that
 * dies with a stack trace on a bad JSON file is the failure ADR-026 says must become a printed refusal.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export class CorpusReadError extends Error {
  readonly kind: 'directory' | 'json';

  constructor(kind: 'directory' | 'json', message: string) {
    super(message);
    this.name = 'CorpusReadError';
    this.kind = kind;
  }
}

function jsonFileNames(directory: string): string[] {
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    throw new CorpusReadError('directory', `The directory could not be read: ${directory}`);
  }
}

function parseJson(name: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    // A pathological document can fail the parser's own depth limit rather than its syntax check. Saying so
    // keeps the operator's next action obvious — this file is not merely missing a comma.
    if (error instanceof RangeError) {
      throw new CorpusReadError(
        'json',
        `${name} is structured too deeply for the parser to read. Split or flatten it and try again.`,
      );
    }
    throw new CorpusReadError('json', `${name} is not valid JSON.`);
  }
}

/**
 * Every case value in a directory, flattened so a file may hold one case or an array of them.
 *
 * `index` is a global position across the whole load, because a ceiling counted in files would let one
 * document carry an unbounded number of cases and a per-file digest could not say which case it described.
 */
export function readCorpusValues(
  directory: string,
): { index: number; value: unknown; source: string }[] {
  const sources: { index: number; value: unknown; source: string }[] = [];
  for (const name of jsonFileNames(directory)) {
    const value = parseJson(name, readFileSync(join(directory, name), 'utf8'));
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      sources.push({ index: sources.length, value: entry, source: name });
    }
  }
  return sources;
}

/** Every JSON value in a directory, flattening top-level arrays, keyed by the file it came from. */
export function readJsonEntries(directory: string): { name: string; value: unknown }[] {
  const entries: { name: string; value: unknown }[] = [];
  for (const name of jsonFileNames(directory)) {
    const value = parseJson(name, readFileSync(join(directory, name), 'utf8'));
    if (Array.isArray(value)) {
      for (const item of value) {
        entries.push({ name, value: item });
      }
    } else {
      entries.push({ name, value });
    }
  }
  return entries;
}
