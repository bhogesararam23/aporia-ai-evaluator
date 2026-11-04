/**
 * `npm run benchmark:release` — versioned, offline corpus releases (ADR-027).
 *
 * A release answers one question: *is this the exact corpus I reviewed, unchanged?* It freezes a set of case
 * digests into a manifest, verifies a directory against it, diffs two manifests, and reports the provenance
 * and completeness gates a corpus must clear. Everything is local files; nothing reaches a network, a
 * database, a registry or a clock.
 *
 * Subcommands:
 *   freeze   --corpus <dir> --out <file> [--label <text>] [--snapshot <dir>]
 *   verify   --corpus <dir> --manifest <file>
 *   diff     --before <file> --after <file>
 *   gates    --corpus <dir>
 *
 * Two claims are refused here by construction, and both are printed at the end of every run:
 *
 * 1. A hash is an integrity check over recorded content. It does not authenticate a reviewer or prove that
 *    any material is genuine, because reviewer names are operator-asserted and this application has no
 *    authentication.
 * 2. Readiness is not accuracy. `accuracyClaimable` is the literal `false`, and no gate, coverage figure or
 *    agreement rate turns it otherwise.
 *
 * `--snapshot` additionally copies canonical case bytes into the release directory. It is opt-in because
 * benchmark material may carry sensitive claims and evidence excerpts, and freezing a corpus should not
 * silently duplicate that material into a second location nobody thought to protect.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildReleaseManifest,
  compareReleases,
  releaseGates,
  verifyRelease,
  type ReleaseManifest,
} from '../src/benchmark/release.ts';
import { normaliseCase } from '../src/benchmark/authoring.ts';
import { validateBenchmarkCorpus } from '../src/benchmark/validate.ts';
import { CorpusReadError, readCorpusValues } from './corpus-io.ts';
import { canonicalise } from '../src/benchmark/hashing.ts';
import type { BenchmarkCase } from '../src/benchmark/types.ts';

function fail(message: string): never {
  console.error(`benchmark:release: ${message}`);
  process.exit(1);
}

interface Options {
  command: string;
  corpus: string | null;
  out: string | null;
  manifest: string | null;
  before: string | null;
  after: string | null;
  label: string | null;
  snapshot: string | null;
}

function parseArguments(argv: readonly string[]): Options {
  const options: Options = {
    command: argv[0] ?? '',
    corpus: null,
    out: null,
    manifest: null,
    before: null,
    after: null,
    label: null,
    snapshot: null,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--corpus') {
      options.corpus = argv[(index += 1)] ?? null;
    } else if (argument === '--out') {
      options.out = argv[(index += 1)] ?? null;
    } else if (argument === '--manifest') {
      options.manifest = argv[(index += 1)] ?? null;
    } else if (argument === '--before') {
      options.before = argv[(index += 1)] ?? null;
    } else if (argument === '--after') {
      options.after = argv[(index += 1)] ?? null;
    } else if (argument === '--label') {
      options.label = argv[(index += 1)] ?? null;
    } else if (argument === '--snapshot') {
      options.snapshot = argv[(index += 1)] ?? null;
    } else {
      fail(`Unknown argument: ${String(argument)}`);
    }
  }
  return options;
}

function requireCorpus(options: Options): string {
  if (options.corpus === null) {
    fail('--corpus <directory> is required for this subcommand.');
  }
  return resolve(options.corpus);
}

/** Read and validate a corpus directory, refusing to pretend an unreadable one is empty. */
function loadCorpus(directory: string): {
  cases: readonly BenchmarkCase[];
  files: Map<string, string>;
  issues: readonly { caseId: string; field: string; message: string }[];
} {
  let sources: { index: number; value: unknown; source: string }[];
  try {
    sources = readCorpusValues(directory);
  } catch (error) {
    if (error instanceof CorpusReadError) {
      return fail(`${error.message} A release cannot be built from a corpus that cannot be read.`);
    }
    throw error;
  }
  const validation = validateBenchmarkCorpus(sources);
  const files = new Map<string, string>();
  for (const source of sources) {
    const record =
      typeof source.value === 'object' && source.value !== null
        ? (source.value as Record<string, unknown>)
        : {};
    if (typeof record['id'] === 'string' && !files.has(record['id'])) {
      files.set(record['id'] as string, source.source);
    }
  }
  return {
    cases: validation.cases as unknown as readonly BenchmarkCase[],
    files,
    issues: validation.issues,
  };
}

/** Canonical JSON so the same corpus always freezes to the same bytes on any machine. */
function canonicalText(value: unknown): string {
  return `${JSON.stringify(canonicalise(value), null, 2)}\n`;
}

function readManifest(path: string): ReleaseManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch {
    return fail(`The manifest could not be read or parsed: ${path}`);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return fail(`The manifest is not an object: ${path}`);
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record['version'] !== 'string' || !Array.isArray(record['cases'])) {
    return fail(`The manifest has no version or case list: ${path}`);
  }
  return parsed as unknown as ReleaseManifest;
}

const CLOSING_NOTE =
  'Digests are integrity checks over recorded content: they detect a changed file, not a forged reviewer. ' +
  'accuracyClaimable=false; a passing release means the corpus is consistent and reviewed as declared, which ' +
  'is not evidence that the evaluator is accurate.';

function freeze(options: Options): void {
  if (options.out === null) {
    fail('freeze needs --out <file> to write the release manifest into.');
  }
  const directory = requireCorpus(options);
  const { cases, files, issues } = loadCorpus(directory);
  if (cases.length === 0) {
    fail(
      'no valid case in the corpus; there is nothing to freeze. A release describes cases, not hopes.',
    );
  }
  if (issues.length > 0) {
    console.error(
      `benchmark:release: ${String(issues.length)} problem(s) across the corpus. Refusing to freeze: a release manifest over an invalid corpus would certify an inconsistency rather than detect one.`,
    );
    for (const issue of issues.slice(0, 40)) {
      console.error(`  ${issue.caseId} ${issue.field}: ${issue.message}`);
    }
    if (issues.length > 40) {
      console.error(`  ...and ${String(issues.length - 40)} more.`);
    }
    process.exitCode = 1;
    return;
  }
  const manifest = buildReleaseManifest(cases, files, options.label, { issues });
  const target = resolve(options.out);
  writeFileSync(target, canonicalText(manifest), 'utf8');
  console.error(
    `benchmark:release: froze ${String(manifest.caseCount)} case(s) as ${manifest.releaseId} ` +
      `(corpus ${manifest.corpusHash.slice(0, 12)}…) to ${target}.`,
  );
  if (options.snapshot !== null) {
    const snapshotDirectory = resolve(options.snapshot);
    mkdirSync(snapshotDirectory, { recursive: true });
    for (const benchmarkCase of cases) {
      writeFileSync(
        join(snapshotDirectory, `${benchmarkCase.id}.json`),
        normaliseCase(benchmarkCase),
        'utf8',
      );
    }
    console.error(
      `benchmark:release: --snapshot wrote canonical copies of ${String(cases.length)} case(s) to ` +
        `${snapshotDirectory}. This duplicated corpus material into a second location; protect it like the ` +
        `first one. Without this flag a freeze stores digests only.`,
    );
  }
  printGates(manifest.gates);
  console.error(`benchmark:release: ${CLOSING_NOTE}`);
  if (manifest.gates.some((gate) => gate.blocking && !gate.passed)) {
    process.exitCode = 1;
  }
}

function printGates(
  gates: readonly { name: string; passed: boolean; detail: string; blocking: boolean }[],
): void {
  for (const gate of gates) {
    const mark = gate.passed ? 'PASS' : gate.blocking ? 'FAIL' : 'NOTE';
    console.error(`  ${mark}  ${gate.name}: ${gate.detail}`);
  }
}

function verify(options: Options): void {
  if (options.manifest === null) {
    fail('verify needs --manifest <file> naming the release to check against.');
  }
  const manifest = readManifest(options.manifest);
  const { cases, issues } = loadCorpus(requireCorpus(options));
  const result = verifyRelease(manifest, cases);
  console.error(
    `benchmark:release: ${result.ok ? 'VERIFIED' : 'DRIFTED'} against ${manifest.releaseId} — ` +
      `${String(result.unchanged.length)} unchanged, ${String(result.changed.length)} changed, ` +
      `${String(result.added.length)} added, ${String(result.removed.length)} removed` +
      `${issues.length > 0 ? `, ${String(issues.length)} invalid entr(y/ies)` : ''}.`,
  );
  for (const id of result.changed) console.error(`  CHANGED  ${id}`);
  for (const id of result.added) console.error(`  ADDED    ${id}`);
  for (const id of result.removed) console.error(`  REMOVED  ${id}`);
  for (const id of result.duplicateCaseIds) console.error(`  DUPLICATE ${id}`);
  for (const entry of result.contractDrift) console.error(`  CONTRACT ${entry}`);
  if (result.corpusHash !== manifest.corpusHash) {
    console.error(
      `  corpus hash now ${result.corpusHash.slice(0, 12)}…, frozen as ${manifest.corpusHash.slice(0, 12)}…`,
    );
  }
  for (const name of result.gateFailures) {
    console.error(`  GATE FAIL ${name} in the current corpus`);
  }
  console.error(`benchmark:release: ${result.note}`);
  console.error(`benchmark:release: ${CLOSING_NOTE}`);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

function diff(options: Options): void {
  if (options.before === null || options.after === null) {
    fail('diff needs --before <file> and --after <file>, both release manifests.');
  }
  const before = readManifest(options.before);
  const after = readManifest(options.after);
  const comparison = compareReleases(before, after);
  console.error(
    `benchmark:release: ${comparison.beforeReleaseId} → ${comparison.afterReleaseId} ` +
      `(corpus ${comparison.corpusHashChanged ? 'changed' : 'identical'}).`,
  );
  for (const id of comparison.added) console.error(`  ADDED    ${id}`);
  for (const id of comparison.removed) console.error(`  REMOVED  ${id}`);
  for (const id of comparison.changed) console.error(`  CHANGED  ${id}`);
  for (const stratum of comparison.strataAdded) console.error(`  STRATUM+ ${stratum}`);
  for (const stratum of comparison.strataRemoved) console.error(`  STRATUM- ${stratum}`);
  for (const pair of comparison.rosterAdded) console.error(`  ROSTER+  ${pair}`);
  for (const pair of comparison.rosterRemoved) console.error(`  ROSTER-  ${pair}`);
  for (const name of comparison.gatesNewlyFailing) console.error(`  GATE FAIL ${name}`);
  for (const name of comparison.gatesNewlyPassing) console.error(`  GATE PASS ${name}`);
  if (
    comparison.added.length +
      comparison.removed.length +
      comparison.changed.length +
      comparison.rosterAdded.length +
      comparison.rosterRemoved.length ===
    0
  ) {
    console.error('  no case, stratum or authorisation difference recorded');
  }
  console.error(`benchmark:release: ${comparison.note}`);
}

function gates(options: Options): void {
  const { cases, issues } = loadCorpus(requireCorpus(options));
  if (cases.length === 0 && issues.length === 0) {
    fail('no case file to describe; nothing is asserted about this corpus.');
  }
  const results = releaseGates(cases, { issues });
  console.error(
    `benchmark:release: ${String(cases.length)} valid case(s), ${String(issues.length)} invalid entr(y/ies).`,
  );
  // The strata disclosure is carried by the `strataCovered` gate detail below, so it is not repeated here.
  printGates(results);
  console.error(`benchmark:release: ${CLOSING_NOTE}`);
  if (results.some((gate) => gate.blocking && !gate.passed)) {
    process.exitCode = 1;
  }
}

function main(): void {
  const options = parseArguments(process.argv.slice(2));
  switch (options.command) {
    case 'freeze':
      freeze(options);
      break;
    case 'verify':
      verify(options);
      break;
    case 'diff':
      diff(options);
      break;
    case 'gates':
      gates(options);
      break;
    default:
      console.log(
        'Usage: npm run benchmark:release -- <subcommand> [options]\n' +
          '  freeze   --corpus <dir> --out <file> [--label <text>] [--snapshot <dir>]\n' +
          '  verify   --corpus <dir> --manifest <file>\n' +
          '  diff     --before <file> --after <file>\n' +
          '  gates    --corpus <dir>\n' +
          'Offline only. A manifest is an integrity record of case bytes, not a proof of reviewer identity,\n' +
          'material genuineness, or evaluator accuracy; accuracyClaimable is false in every release.',
      );
      if (options.command !== '' && options.command !== '--help' && options.command !== '-h') {
        fail(`Unknown subcommand "${options.command}".`);
      }
  }
}

main();
