/**
 * `npm run benchmark:case` — local benchmark case-authoring and curation workflows (ADR-020).
 *
 * The scoring harness (`npm run benchmark`) reads a corpus; this tool helps a reviewer *prepare* one
 * locally: start from a scaffold, validate files, canonicalise a corpus for a reproducible import /
 * export, and inspect reviewer-annotation provenance. It never invents gold labels, never fabricates a
 * reviewer, and never reaches the network or the application database. A scaffold is deliberately not a
 * valid case, so it cannot slip into a scored corpus — `validate` is the gate.
 *
 * Subcommands:
 *   scaffold   --stratum <S> [--out <file>]        print a non-scoreable skeleton for one stratum
 *   validate   --corpus <dir>                      report structural + semantic problems, exit non-zero on any
 *   normalise  --corpus <dir> --out <dir>          write canonical JSON for every valid case; list refusals
 *   provenance --corpus <dir>                      per-case reviewer/adjudication/disagreement summary
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  caseProvenanceSummary,
  normaliseCase,
  scaffoldTemplate,
} from '../src/benchmark/authoring.ts';
import { validateBenchmarkCorpus } from '../src/benchmark/validate.ts';
import { BENCHMARK_STRATA, type BenchmarkCase } from '../src/benchmark/types.ts';

function fail(message: string): never {
  console.error(`benchmark:case: ${message}`);
  process.exit(1);
}

interface Options {
  command: string;
  corpus: string | null;
  out: string | null;
  stratum: string | null;
}

function parseArguments(argv: readonly string[]): Options {
  const command = argv[0] ?? '';
  const options: Options = { command, corpus: null, out: null, stratum: null };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--corpus') {
      options.corpus = argv[(index += 1)] ?? null;
    } else if (argument === '--out') {
      options.out = argv[(index += 1)] ?? null;
    } else if (argument === '--stratum') {
      options.stratum = argv[(index += 1)] ?? null;
    } else {
      fail(`Unknown argument: ${String(argument)}`);
    }
  }
  return options;
}

function readCorpus(directory: string): { index: number; value: unknown }[] {
  let names: string[];
  try {
    names = readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return fail(`The corpus directory could not be read: ${directory}`);
  }
  const sources: { index: number; value: unknown }[] = [];
  for (const name of names) {
    const text = readFileSync(join(directory, name), 'utf8');
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return fail(`${name} is not valid JSON.`);
    }
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      sources.push({ index: sources.length, value: entry });
    }
  }
  return sources;
}

function requireCorpus(options: Options): string {
  if (options.corpus === null) {
    fail('--corpus <directory> is required for this subcommand.');
  }
  return resolve(options.corpus);
}

function scaffold(options: Options): void {
  const stratum = options.stratum;
  if (stratum === null || !(BENCHMARK_STRATA as readonly string[]).includes(stratum)) {
    fail(`--stratum is required and must be one of: ${BENCHMARK_STRATA.join(', ')}.`);
  }
  const template = scaffoldTemplate(stratum as (typeof BENCHMARK_STRATA)[number]);
  const text = normaliseCase(template);
  if (options.out === null) {
    process.stdout.write(text);
    console.error(
      'This is a TEMPLATE, not a scoreable case: it has no gold labels and is refused by `validate`. ' +
        'A reviewer fills it from material they actually reviewed and authorised.',
    );
    return;
  }
  const target = resolve(options.out);
  writeFileSync(target, text, 'utf8');
  console.error(`benchmark:case: template written to ${target}`);
}

function validate(options: Options): void {
  const result = validateBenchmarkCorpus(readCorpus(requireCorpus(options)));
  if (result.issues.length === 0) {
    console.error(
      `benchmark:case: ${String(result.cases.length)} valid case(s); ` +
        `${String(result.strataMissing.length)} required stratum(s) not covered.`,
    );
    return;
  }
  console.error(`benchmark:case: ${String(result.issues.length)} problem(s) across the corpus.`);
  for (const issue of result.issues.slice(0, 60)) {
    console.error(`  ${issue.caseId} ${issue.field}: ${issue.message}`);
  }
  if (result.issues.length > 60) {
    console.error(`  ...and ${String(result.issues.length - 60)} more.`);
  }
  process.exitCode = 1;
}

function normalise(options: Options): void {
  if (options.out === null) {
    fail('normalise needs --out <directory> to write canonicalised cases into.');
  }
  const result = validateBenchmarkCorpus(readCorpus(requireCorpus(options)));
  const target = resolve(options.out);
  mkdirSync(target, { recursive: true });
  for (const benchmarkCase of result.cases) {
    writeFileSync(join(target, `${benchmarkCase.id}.json`), normaliseCase(benchmarkCase), 'utf8');
  }
  console.error(
    `benchmark:case: wrote ${String(result.cases.length)} canonical case(s) to ${target}; ` +
      `refused ${String(result.issues.length)} invalid entries (imported files that do not validate are never exported).`,
  );
  if (result.issues.length > 0) {
    process.exitCode = 1;
  }
}

function provenance(options: Options): void {
  const result = validateBenchmarkCorpus(readCorpus(requireCorpus(options)));
  if (result.cases.length === 0) {
    console.error(
      'benchmark:case: no valid case to describe; nothing is asserted about provenance.',
    );
    process.exitCode = 1;
    return;
  }
  for (const benchmarkCase of result.cases) {
    const summary = caseProvenanceSummary(benchmarkCase as unknown as BenchmarkCase);
    console.error(
      `  ${summary.id}: reviewers=[${summary.reviewers.join(', ')}] ` +
        `labels=${String(summary.reviewerLabelCount)} disagreements=${String(summary.disagreements)} ` +
        `adjudicated=${String(summary.adjudicatedDisagreements)} unresolved=${String(summary.unresolvedDisagreements)} ` +
        `authorised=${String(summary.authorizedForStorage)} reviewedAt="${summary.reviewedAt}"`,
    );
  }
  console.error(
    'benchmark:case: reviewer names are operator-asserted and prove no independent review; ' +
      'this summary describes the cases supplied, not evaluator accuracy.',
  );
}

function main(): void {
  const options = parseArguments(process.argv.slice(2));
  switch (options.command) {
    case 'scaffold':
      scaffold(options);
      break;
    case 'validate':
      validate(options);
      break;
    case 'normalise':
      normalise(options);
      break;
    case 'provenance':
      provenance(options);
      break;
    default:
      console.log(
        'Usage: npm run benchmark:case -- <scaffold|validate|normalise|provenance> [options]\n' +
          '  scaffold   --stratum <S> [--out <file>]\n' +
          '  validate   --corpus <dir>\n' +
          '  normalise  --corpus <dir> --out <dir>\n' +
          '  provenance --corpus <dir>',
      );
      if (options.command !== '' && options.command !== '--help' && options.command !== '-h') {
        fail(`Unknown subcommand "${options.command}".`);
      }
  }
}

main();
