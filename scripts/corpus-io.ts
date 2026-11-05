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
import { BENCHMARK_LIMITS } from '../src/benchmark/validate.ts';

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
 * The file-count ceiling, stated as a predicate so the arithmetic is testable without materialising five
 * thousand files.
 */
export function assertFileCount(names: readonly string[]): void {
  if (names.length > BENCHMARK_LIMITS.maxFiles) {
    throw new CorpusReadError(
      'count',
      `The directory holds ${String(names.length)} JSON files; the limit is ${String(
        BENCHMARK_LIMITS.maxFiles,
      )}. A corpus of that size is not a reviewed corpus — split it, or point at the directory you meant.`,
    );
  }
}

/** The per-file ceiling. Refusing to read past it is the point: the bytes are never parsed. */
export function assertFileBytes(name: string, bytes: number): void {
  if (bytes > BENCHMARK_LIMITS.maxCaseBytes) {
    throw new CorpusReadError(
      'size',
      `${name} is ${String(bytes)} bytes; the per-file limit is ${String(
        BENCHMARK_LIMITS.maxCaseBytes,
      )}. Split it into smaller files.`,
    );
  }
}

/** The cumulative ceiling, so many legal-sized files cannot become an unbounded read. */
export function assertTotalBytes(bytes: number): void {
  if (bytes > BENCHMARK_LIMITS.maxCorpusBytes) {
    throw new CorpusReadError(
      'size',
      `The corpus exceeds the total limit of ${String(BENCHMARK_LIMITS.maxCorpusBytes)} bytes in total.`,
    );
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
function inspectEntries(directory: string): { name: string; bytes: number }[] {
  let names: string[];
  try {
    names = readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .sort((left, right) => (left === right ? 0 : left < right ? -1 : 1));
  } catch {
    throw new CorpusReadError('directory', `The directory could not be read: ${directory}`);
  }
  assertFileCount(names);
  const entries: { name: string; bytes: number }[] = [];
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
    // Measured from the same stat that classified the entry, so no second lookup races the check.
    assertFileBytes(name, stat.size);
    entries.push({ name, bytes: stat.size });
  }
  return entries;
}

/**
 * The whole directory read, bounded: nothing is opened until its size has been accepted.
 *
 * The harness applied these ceilings in v0.7 while `benchmark:case` and `benchmark:release` parsed any file
 * put in front of them — a 1,093,691-byte bundle was refused by one command and reported as "600 valid
 * case(s)" by the other. One read path, one set of ceilings, and the total is accumulated as files are
 * accepted rather than computed afterwards, so an oversized corpus stops at the file that crossed it.
 */
function readBoundedFiles(directory: string): { name: string; text: string }[] {
  const entries = inspectEntries(directory);
  const files: { name: string; text: string }[] = [];
  let total = 0;
  for (const entry of entries) {
    total += entry.bytes;
    assertTotalBytes(total);
    files.push({ name: entry.name, text: readFileSync(join(directory, entry.name), 'utf8') });
  }
  return files;
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
  for (const file of readBoundedFiles(directory)) {
    const value = parseJson(file.name, file.text);
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      sources.push({ index: sources.length, value: entry, source: file.name });
    }
  }
  return sources;
}

/** Every JSON value in a directory, flattening top-level arrays, keyed by the file it came from. */
export function readJsonEntries(directory: string): { name: string; value: unknown }[] {
  const entries: { name: string; value: unknown }[] = [];
  for (const file of readBoundedFiles(directory)) {
    const value = parseJson(file.name, file.text);
    if (Array.isArray(value)) {
      for (const item of value) {
        entries.push({ name: file.name, value: item });
      }
    } else {
      entries.push({ name: file.name, value });
    }
  }
  return entries;
}
