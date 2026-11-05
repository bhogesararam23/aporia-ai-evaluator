/**
 * `npm run benchmark` — run the offline evaluator-validation harness (ADR-020, as amended by ADR-023).
 *
 * Reads a directory of benchmark case JSON files, validates them under explicit bounds, scores the
 * deterministic regression section and the human annotation section separately, and writes one
 * reproducible report.
 *
 * It never generates cases, never reaches the network, and never opens the application database. An
 * empty or incomplete corpus exits non-zero and says that no accuracy claim is supportable, because a
 * green run over nothing would be the most misleading result this tool could produce.
 *
 * Two questions are kept apart and never merged into one number:
 *   - **deterministic regression** — did the current code produce the label the reviewer recorded; and
 *   - **annotation agreement** — do the recorded human labels agree, over the subjects that have a
 *     defensible settled value.
 * A software regression is a code finding. Reviewer disagreement is a methodology finding. Neither is
 * evidence that the evaluator is accurate, and nothing here turns a disagreement into a consensus.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  agreementRows,
  annotationSummaries,
  scoreByDimension,
  type ScoredPair,
} from '../src/benchmark/scoring.ts';
import { BENCHMARK_DIMENSIONS } from '../src/benchmark/types.ts';
import { regressionResults, unusableEvidenceRecords } from '../src/benchmark/regression.ts';
import {
  buildBenchmarkReport,
  caseDigest,
  serialiseBenchmarkReport,
  type CorpusDigest,
} from '../src/benchmark/report.ts';
import { validateBenchmarkCorpus } from '../src/benchmark/validate.ts';
import { CorpusReadError, readCorpusFiles } from './corpus-io.ts';

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

  --corpus        Directory of benchmark case JSON files. Required.
  --out           Where to write the report. Defaults to stdout.
  --allow-partial-strata
                  Report on a corpus that does not cover every required stratum. Absence is still
                  printed; this flag only stops it from failing the run.`);
}

function fail(message: string): never {
  console.error(`benchmark: ${message}`);
  process.exit(1);
}

/** One parsed case, tagged with the file it came from. */
interface CaseSource {
  readonly index: number;
  readonly name: string;
  readonly value: unknown;
}

interface CorpusReading {
  readonly sources: readonly CaseSource[];
  readonly files: readonly { readonly name: string; readonly values: readonly unknown[] }[];
  readonly fileDigests: readonly CorpusDigest[];
}

/**
 * Read the corpus through the one bounded loader, keeping the file identity the report needs.
 *
 * Until v0.8 this command carried its own loader: it stat'd entries, applied the byte ceilings and skipped
 * anything that was not a file, while `benchmark:case` and `benchmark:release` shared a second loader that did
 * none of that. The same hostile directory therefore produced a clean skip here and a stack trace there, and
 * one oversized file was refused by this command only. Every read now goes through `scripts/corpus-io.ts`, so
 * one ceiling means one thing across all three commands.
 *
 * The per-file digest and the empty-array refusal stay here, because they belong to what a *report* says about
 * a file rather than to whether the file could be read.
 */
function readCorpus(directory: string): CorpusReading {
  let files: { name: string; text: string; parsed: unknown; values: unknown[] }[];
  try {
    files = readCorpusFiles(directory);
  } catch (error) {
    if (error instanceof CorpusReadError) {
      return fail(error.message);
    }
    throw error;
  }
  const sources: CaseSource[] = [];
  const kept: { name: string; values: unknown[] }[] = [];
  const fileDigests: CorpusDigest[] = [];
  for (const file of files) {
    if (file.values.length === 0) {
      return fail(`${file.name} holds an empty array; a file must carry at least one case.`);
    }
    sources.push({ index: sources.length, name: file.name, value: file.parsed });
    kept.push({ name: file.name, values: file.values });
    fileDigests.push({
      kind: 'file',
      source: file.name,
      caseCount: file.values.length,
      digest: createHash('sha256').update(file.text, 'utf8').digest('hex').slice(0, 16),
      bytes: Buffer.byteLength(file.text, 'utf8'),
      // Settled once validation has run, so a file whose cases were all refused is visible.
      accepted: true,
    });
  }
  return { sources, files: kept, fileDigests };
}

/** The disclaimer a reader must see on every route, including a run that is about to fail. */
function honestyLine(caseCount: number): string {
  return (
    `benchmark: ${String(caseCount)} valid case(s) scored. ` +
    'This is a framework result over the corpus supplied — not a validated accuracy claim, not proof ' +
    'of independent review, and not a statement about any provider today. ' +
    'Reviewer identity in a case file is operator-asserted.'
  );
}

function main(): void {
  const options = parseArguments(process.argv.slice(2));
  const directory = resolve(options.corpus);
  const reading = readCorpus(directory);

  if (reading.sources.length === 0) {
    console.error(
      `benchmark: the corpus at ${directory} holds no JSON case files.\n` +
        'No accuracy claim is supportable from an empty corpus, and no percentage will be printed.\n' +
        'Gold cases must come from real material a human actually reviewed and is authorised to store; ' +
        'this harness never generates them.',
    );
    process.exitCode = 1;
    return;
  }

  const validation = validateBenchmarkCorpus(
    reading.sources.map((source) => ({ index: source.index, value: source.value })),
  );

  const acceptedValues = new Set<unknown>(validation.cases as readonly unknown[]);
  const digests: CorpusDigest[] = reading.fileDigests.map((digest, index) => ({
    ...digest,
    accepted: (reading.files[index]?.values ?? []).every((value) => acceptedValues.has(value)),
  }));
  for (const benchmarkCase of validation.cases) {
    digests.push({
      kind: 'case',
      source: benchmarkCase.id,
      caseCount: 1,
      digest: caseDigest(benchmarkCase),
      bytes: Buffer.byteLength(JSON.stringify(benchmarkCase), 'utf8'),
      accepted: true,
    });
  }

  if (validation.issues.length > 0) {
    console.error(`benchmark: ${String(validation.issues.length)} case problem(s) found.`);
    for (const issue of validation.issues.slice(0, 40)) {
      console.error(`  ${issue.caseId} ${issue.field}: ${issue.message}`);
    }
    if (validation.issues.length > 40) {
      console.error(`  ...and ${String(validation.issues.length - 40)} more.`);
    }
  }

  const regression = regressionResults(validation.cases);
  // Only what the software itself produces is scored as produced-versus-gold. Human-judgement
  // dimensions are reported as annotation agreement in their own block, from their own rule: unanimous
  // reviewers, or an adjudication naming the subject and the settled label. Nothing selects a reviewer
  // label to manufacture a consensus, and no annotation figure is merged into a regression count.
  const deterministicPairs: ScoredPair[] = regression.map((row) => ({
    caseId: row.caseId,
    dimension: row.dimension,
    subjectId: row.subjectId,
    expected: row.expected,
    predicted: row.produced,
    component: row.component,
  }));
  const dimensions = scoreByDimension(deterministicPairs, BENCHMARK_DIMENSIONS);
  const agreement = agreementRows(validation.cases);
  const annotation = annotationSummaries(agreement, BENCHMARK_DIMENSIONS);
  const unusable = unusableEvidenceRecords(validation.cases).map((row) => ({
    caseId: row.caseId,
    propositionId: row.propositionId,
    evidenceId: row.evidence.id,
  }));

  const report = buildBenchmarkReport(
    validation,
    regression,
    dimensions,
    agreement,
    annotation,
    unusable,
    digests,
  );

  const text = serialiseBenchmarkReport(report);
  if (options.output === null) {
    process.stdout.write(text);
  } else {
    const target = resolve(options.output);
    mkdirSync(resolve(target, '..'), { recursive: true });
    writeFileSync(target, text, 'utf8');
  }

  if (validation.strataMissing.length > 0) {
    console.error(
      `benchmark: ${String(validation.strataMissing.length)} required stratum(s) have no case: ` +
        validation.strataMissing.join(', '),
    );
  }
  if (unusable.length > 0) {
    console.error(
      `benchmark: ${String(unusable.length)} evidence record(s) carried a value the deterministic rule cannot read and were excluded from scoring.`,
    );
  }
  if (options.output !== null) {
    console.error(`benchmark: report written to ${resolve(options.output)}`);
  }

  if (validation.cases.length === 0) {
    console.error(
      'benchmark: no valid case exists, so nothing was measured. No accuracy claim is supportable.',
    );
    process.exitCode = 1;
    return;
  }

  const failed =
    validation.issues.length > 0 ||
    report.regression.mismatches.length > 0 ||
    report.regression.metricChecks.some((row) => !row.matched);

  console.error(honestyLine(validation.cases.length));

  if (failed || (options.requireCompleteStrata && validation.strataMissing.length > 0)) {
    process.exitCode = 1;
  }
}

main();
