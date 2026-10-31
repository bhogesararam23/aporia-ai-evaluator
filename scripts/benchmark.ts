/**
 * `npm run benchmark` — run the offline evaluator-validation harness (ADR-020).
 *
 * Reads a directory of `benchmark-case-v1` JSON files, validates them under explicit bounds, scores
 * the deterministic regression section and the human-label agreement section separately, and writes
 * one reproducible report.
 *
 * It never generates cases, never reaches the network, and never opens the application database. An
 * empty or incomplete corpus exits non-zero and says that no accuracy claim is supportable, because
 * a green run over nothing would be the most misleading result this tool could produce.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { agreementRows, scoreByDimension, type ScoredPair } from '../src/benchmark/scoring.ts';
import {
  BENCHMARK_DIMENSIONS,
  type BenchmarkCase,
  type BenchmarkDimension,
} from '../src/benchmark/types.ts';
import { regressionResults } from '../src/benchmark/regression.ts';
import {
  buildBenchmarkReport,
  caseDigest,
  serialiseBenchmarkReport,
  type CorpusDigest,
} from '../src/benchmark/report.ts';
import { BENCHMARK_LIMITS, validateBenchmarkCorpus } from '../src/benchmark/validate.ts';

interface Options {
  corpus: string;
  output: string | null;
  requireCompleteStrata: boolean;
}

function parseArguments(argv: readonly string[]): Options {
  const options: Options = {
    corpus: '',
    output: null,
    requireCompleteStrata: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--corpus') {
      options.corpus = String(argv[(index += 1)] ?? '');
    } else if (argument === '--out') {
      options.output = argv[(index += 1)] ?? null;
    } else if (argument === '--allow-partial-strata') {
      options.requireCompleteStrata = false;
    } else if (argument === '--help' || argument === '-h') {
      printUsage();
      process.exit(0);
    } else {
      fail(`Unknown argument: ${String(argument)}`);
    }
  }
  if (options.corpus.length === 0) {
    printUsage();
    fail('--corpus <directory> is required.');
  }
  return options;
}

function printUsage(): void {
  console.log(`Usage: npm run benchmark -- --corpus <directory> [--out <file>] [--allow-partial-strata]

  --corpus        Directory of benchmark-case-v1 JSON files. Required.
  --out           Where to write the report. Defaults to stdout.
  --allow-partial-strata
                  Report on a corpus that does not cover every required stratum. Absence is still
                  printed; this flag only stops it from failing the run.`);
}

function fail(message: string): never {
  console.error(`benchmark: ${message}`);
  process.exit(1);
}

/** Read the corpus under explicit bounds. A hostile or bloated file must fail, not consume memory. */
function readCorpus(directory: string): {
  readonly entries: readonly { index: number; value: unknown; digest: CorpusDigest }[];
} {
  let names: string[];
  try {
    names = readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return fail(`The corpus directory could not be read: ${directory}`);
  }
  if (names.length > BENCHMARK_LIMITS.maxCases) {
    return fail(
      `The corpus holds ${names.length} files; the limit is ${BENCHMARK_LIMITS.maxCases}.`,
    );
  }
  const entries: { index: number; value: unknown; digest: CorpusDigest }[] = [];
  let totalBytes = 0;
  for (const name of names) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (!stat.isFile()) {
      continue;
    }
    if (stat.size > BENCHMARK_LIMITS.maxCaseBytes) {
      return fail(
        `${name} is ${stat.size} bytes; the per-file limit is ${BENCHMARK_LIMITS.maxCaseBytes}.`,
      );
    }
    totalBytes += stat.size;
    if (totalBytes > BENCHMARK_LIMITS.maxCorpusBytes) {
      return fail(`The corpus exceeds ${BENCHMARK_LIMITS.maxCorpusBytes} bytes in total.`);
    }
    const text = readFileSync(path, 'utf8');
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return fail(`${name} is not valid JSON.`);
    }
    entries.push({
      index: entries.length,
      value,
      digest: {
        caseCount: Array.isArray(value) ? value.length : 1,
        digest: createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16),
        bytes: Buffer.byteLength(text, 'utf8'),
      },
    });
  }
  return { entries };
}

/**
 * Gold-versus-produced pairs for the methodology section. For the human-judgement dimensions the
 * "prediction" is the reviewer consensus recorded in the case, because the software makes no such
 * judgement; those pairs measure agreement, and the report says which is which.
 */
function methodologyPairs(cases: readonly BenchmarkCase[]): ScoredPair[] {
  const pairs: ScoredPair[] = [];
  for (const benchmarkCase of cases) {
    for (const expected of benchmarkCase.expected) {
      const reviewers = benchmarkCase.reviewerLabels.filter(
        (label) => label.dimension === expected.dimension && label.subjectId === expected.subjectId,
      );
      if (reviewers.length === 0) {
        continue;
      }
      const consensus = reviewers.map((label) => label.label).sort()[0] as string;
      pairs.push({
        caseId: benchmarkCase.id,
        dimension: expected.dimension as BenchmarkDimension,
        subjectId: expected.subjectId,
        expected: expected.label,
        predicted: consensus,
        component: 'reviewer consensus',
      });
    }
  }
  return pairs;
}

function main(): void {
  const options = parseArguments(process.argv.slice(2));
  const directory = resolve(options.corpus);
  const { entries } = readCorpus(directory);

  if (entries.length === 0) {
    console.error(
      `benchmark: the corpus at ${directory} holds no JSON case files.\n` +
        'No accuracy claim is supportable from an empty corpus, and no percentage will be printed.\n' +
        'Gold cases must come from real material a human actually reviewed and is authorised to store; ' +
        'this harness never generates them.',
    );
    process.exitCode = 1;
    return;
  }

  const validation = validateBenchmarkCorpus(entries);
  const digests = entries.map((entry) => entry.digest);
  for (const benchmarkCase of validation.cases) {
    digests.push({
      caseCount: 1,
      digest: caseDigest(benchmarkCase),
      bytes: JSON.stringify(benchmarkCase).length,
    });
  }

  if (validation.issues.length > 0) {
    console.error(`benchmark: ${validation.issues.length} case problem(s) found.`);
    for (const issue of validation.issues.slice(0, 40)) {
      console.error(`  ${issue.caseId} ${issue.field}: ${issue.message}`);
    }
    if (validation.issues.length > 40) {
      console.error(`  ...and ${validation.issues.length - 40} more.`);
    }
  }

  const regression = regressionResults(validation.cases);
  const deterministicPairs: ScoredPair[] = regression.map((row) => ({
    caseId: row.caseId,
    dimension: row.dimension,
    subjectId: row.subjectId,
    expected: row.expected,
    predicted: row.produced,
    component: row.component,
  }));
  const allPairs = [...deterministicPairs, ...methodologyPairs(validation.cases)];
  const dimensions = scoreByDimension(allPairs, BENCHMARK_DIMENSIONS);
  const agreement = agreementRows(validation.cases);

  const report = buildBenchmarkReport(validation, regression, dimensions, agreement, digests);

  if (validation.strataMissing.length > 0) {
    console.error(
      `benchmark: ${validation.strataMissing.length} required stratum(s) have no case: ` +
        validation.strataMissing.join(', '),
    );
  }

  const text = serialiseBenchmarkReport(report);
  if (options.output === null) {
    process.stdout.write(text);
  } else {
    const target = resolve(options.output);
    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, text, 'utf8');
    console.error(`benchmark: report written to ${target}`);
  }

  const failed =
    validation.issues.length > 0 ||
    report.regression.mismatches.length > 0 ||
    report.regression.metricChecks.some((row) => !row.matched);

  if (validation.cases.length === 0) {
    console.error('benchmark: no valid case exists, so nothing was measured.');
    process.exitCode = 1;
    return;
  }
  if (options.requireCompleteStrata && validation.strataMissing.length > 0) {
    process.exitCode = 1;
  }
  if (failed) {
    process.exitCode = 1;
    return;
  }
  console.error(
    `benchmark: ${validation.cases.length} case(s) scored. ` +
      'This is a framework result over a stated corpus, not a validated accuracy claim.',
  );
}

main();
