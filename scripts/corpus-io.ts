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
import { lstatSync, readFileSync, readdirSync, type Stats } from 'node:fs';
import { join } from 'node:path';

/**
 * What went wrong with a read. Each kind maps to one thing an operator can do about it.
 *
 * `directory` — the path is not readable. `symlink` — an entry points outside the corpus. `type` — an entry
 * is a directory or device named `*.json`. `count`/`size` — a stated ceiling was passed. `json` — the bytes
 * are not JSON. `depth` — they are JSON nested past what this build can hash.
 */
export type CorpusReadKind = 'directory' | 'symlink' | 'type' | 'count' | 'size' | 'json' | 'depth';

export class CorpusReadError extends Error {
  readonly kind: CorpusReadKind;

  constructor(kind: CorpusReadKind, message: string) {
    super(message);
    this.name = 'CorpusReadError';
    this.kind = kind;
  }
}

/**
 * Every `*.json` entry name in a directory, sorted by code unit, each confirmed to be a plain file.
 *
 * Ordering by code unit rather than a locale collation is deliberate: the position a value gets here is the
 * index a validation issue quotes, so two machines must not disagree about which case is `case#0`.
 *
 * Each entry is inspected with `lstatSync`, which does not follow a link. A symlink named `x.json` pointing
 * somewhere else is refused rather than read, because a corpus that silently pulls in material from outside
 * its own directory is not the corpus a release manifest describes. A directory named `x.json` used to reach
 * `readFileSync` and throw a raw `EISDIR`; refusing it with its name is the difference between an operator
 * fixing a layout mistake and an operator reading a stack trace.
 *
 * An entry that disappears between listing and inspection is reported as unreadable rather than skipped:
 * skipping would let a corpus quietly hold fewer cases than its operator believes it froze.
 */
function jsonFileNames(directory: string): string[] {
  let names: string[];
  try {
    names = readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .sort((left, right) => (left === right ? 0 : left < right ? -1 : 1));
  } catch {
    throw new CorpusReadError('directory', `The directory could not be read: ${directory}`);
  }
  for (const name of names) {
    let stat: Stats;
    try {
      stat = lstatSync(join(directory, name));
    } catch {
      throw new CorpusReadError('directory', `The corpus entry could not be inspected: ${name}`);
    }
    if (stat.isSymbolicLink()) {
      throw new CorpusReadError(
        'symlink',
        `${name} is a symbolic link. A corpus reads only the files inside its own directory: a link ` +
          'could point at material that is not part of the release being verified. Replace it with the file.',
      );
    }
    if (!stat.isFile()) {
      throw new CorpusReadError(
        'type',
        `${name} is not a regular file. Only a plain file may hold a case — a directory or device named ` +
          '*.json is a layout mistake, and skipping it would understate the corpus.',
      );
    }
  }
  return names;
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
