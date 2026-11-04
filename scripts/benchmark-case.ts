/**
 * `npm run benchmark:case` — local benchmark case-authoring and curation workflows (ADR-020).
 *
 * The scoring harness (`npm run benchmark`) reads a corpus; this tool helps a reviewer *prepare* one
 * locally: start from a scaffold, validate files, canonicalise a corpus for a reproducible import /
 * export, and inspect reviewer-annotation provenance. It never invents gold labels, never fabricates a
 * reviewer, and never reaches the network or the application database. A scaffold is deliberately not a
 * valid case, so it cannot slip into a scored corpus — `validate` is the gate.
 *
 * Subcommands (authoring / curation):
 *   scaffold   --stratum <S> [--out <file>]        print a non-scoreable skeleton for one stratum
 *   validate   --corpus <dir>                      report structural + semantic problems, exit non-zero on any
 *   normalise  --corpus <dir> --out <dir>          write canonical JSON for every valid case; list refusals
 *   provenance --corpus <dir>                      per-case reviewer/adjudication/disagreement summary
 *
 * Subcommands (human-review workflow, ADR-026):
 *   packet     --corpus <dir> --out <dir>          blinded reviewer packets + empty submission templates per case
 *   merge      --corpus <dir> --submissions <dir> --out <dir>  safely import submissions; refuse stale/duplicate/mismatched
 *   review     --corpus <dir>                      per-subject agreement / disagreement report (never resolves)
 *   audit      --corpus <dir>                      corpus readiness + provenance (never claims accuracy)
 *
 * The review subcommands are the offline counterpart to `src/benchmark/review.ts`: they read parsed
 * JSON files and write plain JSON files. They never invent a label, reviewer, timestamp or permission,
 * never reach the network or the application database, and never edit a case's gold `expected` array.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  caseProvenanceSummary,
  normaliseCase,
  scaffoldTemplate,
} from '../src/benchmark/authoring.ts';
import { validateBenchmarkCorpus } from '../src/benchmark/validate.ts';
import {
  auditCorpus,
  buildReviewerPacket,
  buildSubmissionTemplate,
  disagreementReport,
  mergeSubmissions,
  type AnnotationSubmission,
} from '../src/benchmark/review.ts';
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
  submissions: string | null;
}

function parseArguments(argv: readonly string[]): Options {
  const command = argv[0] ?? '';
  const options: Options = {
    command,
    corpus: null,
    out: null,
    stratum: null,
    submissions: null,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--corpus') {
      options.corpus = argv[(index += 1)] ?? null;
    } else if (argument === '--out') {
      options.out = argv[(index += 1)] ?? null;
    } else if (argument === '--stratum') {
      options.stratum = argv[(index += 1)] ?? null;
    } else if (argument === '--submissions') {
      options.submissions = argv[(index += 1)] ?? null;
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

/** Read every JSON file in a directory, flattening top-level arrays, for the review subcommands. */
function readJsonDir(directory: string, label: string): { name: string; value: unknown }[] {
  let names: string[];
  try {
    names = readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    return fail(`The ${label} directory could not be read: ${directory}`);
  }
  const entries: { name: string; value: unknown }[] = [];
  for (const name of names) {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(join(directory, name), 'utf8'));
    } catch {
      return fail(`${name} is not valid JSON.`);
    }
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

/**
 * Accept only a well-formed submission object; anything else is treated as malformed and refused
 * before merging, so a partial or hand-corrupted file can never make the merge throw or half-apply.
 */
function coerceSubmission(value: unknown): AnnotationSubmission | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record['version'] !== 'string' ||
    typeof record['caseId'] !== 'string' ||
    typeof record['packetHash'] !== 'string' ||
    typeof record['reviewer'] !== 'string' ||
    typeof record['submittedAt'] !== 'string' ||
    !Array.isArray(record['annotations'])
  ) {
    return null;
  }
  for (const raw of record['annotations']) {
    if (typeof raw !== 'object' || raw === null) {
      return null;
    }
    const annotation = raw as Record<string, unknown>;
    if (
      typeof annotation['dimension'] !== 'string' ||
      typeof annotation['subjectId'] !== 'string' ||
      typeof annotation['label'] !== 'string' ||
      typeof annotation['rationale'] !== 'string'
    ) {
      return null;
    }
  }
  return value as unknown as AnnotationSubmission;
}

function packet(options: Options): void {
  if (options.out === null) {
    fail('packet needs --out <directory> to write blinded packets and submission templates into.');
  }
  const result = validateBenchmarkCorpus(readCorpus(requireCorpus(options)));
  if (result.cases.length === 0) {
    fail('no valid case in the corpus; there is nothing to build a blinded packet from.');
  }
  const target = resolve(options.out);
  mkdirSync(target, { recursive: true });
  for (const entry of result.cases) {
    const benchmarkCase = entry as unknown as BenchmarkCase;
    const reviewerPacket = buildReviewerPacket(benchmarkCase);
    const template = buildSubmissionTemplate(reviewerPacket);
    writeFileSync(
      join(target, `${benchmarkCase.id}.packet.json`),
      `${JSON.stringify(reviewerPacket, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      join(target, `${benchmarkCase.id}.submission.json`),
      `${JSON.stringify(template, null, 2)}\n`,
      'utf8',
    );
  }
  console.error(
    `benchmark:case: wrote a blinded packet + empty submission template for ` +
      `${String(result.cases.length)} case(s) to ${target}. The packet omits gold labels, existing ` +
      `annotations and evaluator output; the template is blank — the reviewer supplies label, rationale, ` +
      `their own name and their own timestamp. Refused ${String(result.issues.length)} invalid entr(ies).`,
  );
  if (result.issues.length > 0) {
    process.exitCode = 1;
  }
}

function merge(options: Options): void {
  if (options.out === null) {
    fail('merge needs --out <directory> to write merged cases into.');
  }
  if (options.submissions === null) {
    fail('merge needs --submissions <directory> holding reviewer submission files.');
  }
  const result = validateBenchmarkCorpus(readCorpus(requireCorpus(options)));
  const cases = result.cases as unknown as readonly BenchmarkCase[];
  const submissions: AnnotationSubmission[] = [];
  const malformed: string[] = [];
  for (const entry of readJsonDir(resolve(options.submissions), 'submissions')) {
    const coerced = coerceSubmission(entry.value);
    if (coerced === null) {
      malformed.push(entry.name);
    } else {
      submissions.push(coerced);
    }
  }
  const outcome = mergeSubmissions(cases, submissions);
  const target = resolve(options.out);
  mkdirSync(target, { recursive: true });
  for (const mergedCase of outcome.mergedCases) {
    writeFileSync(join(target, `${mergedCase.id}.json`), normaliseCase(mergedCase), 'utf8');
  }
  console.error(
    `benchmark:case: merged ${String(outcome.applied.length)} submission(s); ` +
      `rejected ${String(outcome.rejected.length)}; wrote ${String(outcome.mergedCases.length)} ` +
      `case(s) to ${target}. A rejected submission leaves its case unchanged; gold labels are never edited.`,
  );
  for (const rejection of outcome.rejected) {
    console.error(`  REJECTED ${rejection.caseId} / "${rejection.reviewer || '(no reviewer)'}":`);
    for (const reason of rejection.reasons) {
      console.error(`    - ${reason}`);
    }
  }
  for (const name of malformed) {
    console.error(
      `  REJECTED malformed submission file ${name} (not a well-formed annotation object).`,
    );
  }
  if (outcome.rejected.length > 0 || malformed.length > 0 || result.issues.length > 0) {
    process.exitCode = 1;
  }
}

function review(options: Options): void {
  const result = validateBenchmarkCorpus(readCorpus(requireCorpus(options)));
  if (result.cases.length === 0) {
    console.error('benchmark:case: no valid case to review; nothing is asserted.');
    process.exitCode = 1;
    return;
  }
  for (const entry of result.cases) {
    const report = disagreementReport(entry as unknown as BenchmarkCase);
    console.error(
      `  ${report.caseId}: unanimous=${String(report.unanimous)} ` +
        `adjudicated=${String(report.adjudicated)} unresolved=${String(report.unresolved)}`,
    );
    for (const subject of report.subjects) {
      console.error(
        `    ${subject.dimension}/${subject.subjectId}: ${subject.status}` +
          (subject.reviewers.length > 0 ? ` [${subject.reviewers.join(', ')}]` : ''),
      );
    }
  }
  console.error(
    'benchmark:case: this reports agreement exactly as reviewers stated it. A split stays UNRESOLVED ' +
      'and is never resolved to a label here; reviewer names are operator-asserted and prove no independence.',
  );
}

function audit(options: Options): void {
  const result = validateBenchmarkCorpus(readCorpus(requireCorpus(options)));
  const corpusAudit = auditCorpus(result.cases as unknown as readonly BenchmarkCase[]);
  console.error(
    `benchmark:case: corpus audit — ${String(corpusAudit.caseCount)} valid case(s); ` +
      `${String(corpusAudit.missingStrata.length)} required stratum(s) not covered.`,
  );
  if (corpusAudit.missingStrata.length > 0) {
    console.error(`  missing strata: ${corpusAudit.missingStrata.join(', ')}`);
  }
  for (const entry of corpusAudit.cases) {
    console.error(
      `  ${entry.id} [${entry.stratum}]: authorised=${String(entry.authorizedForStorage)} ` +
        `reviewedAt="${entry.reviewedAt}" reviewers=${String(entry.reviewerCount)} ` +
        `unannotated=${String(entry.incompleteSubjects)} singleReviewer=${String(entry.singleReviewerSubjects)} ` +
        `unanimous=${String(entry.unanimousSubjects)} adjudicated=${String(entry.adjudicatedSubjects)} ` +
        `unresolved=${String(entry.unresolvedSubjects)}`,
    );
  }
  console.error(
    `  summary: missingAuthorisation=${String(corpusAudit.summary.casesMissingAuthorisation)} ` +
      `belowTwoReviewers=${String(corpusAudit.summary.casesBelowTwoReviewers)} ` +
      `incompleteSubjects=${String(corpusAudit.summary.incompleteSubjects)} ` +
      `unresolvedSubjects=${String(corpusAudit.summary.unresolvedSubjects)}`,
  );
  if (result.issues.length > 0) {
    console.error(
      `  (excluded ${String(result.issues.length)} entr(y/ies) that did not validate from this audit)`,
    );
  }
  console.error(
    `  accuracyClaimable=${String(corpusAudit.accuracyClaimable)}: ${corpusAudit.accuracyReason}`,
  );
  if (corpusAudit.caseCount === 0) {
    process.exitCode = 1;
  }
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
    case 'packet':
      packet(options);
      break;
    case 'merge':
      merge(options);
      break;
    case 'review':
      review(options);
      break;
    case 'audit':
      audit(options);
      break;
    default:
      console.log(
        'Usage: npm run benchmark:case -- <subcommand> [options]\n' +
          '  scaffold   --stratum <S> [--out <file>]\n' +
          '  validate   --corpus <dir>\n' +
          '  normalise  --corpus <dir> --out <dir>\n' +
          '  provenance --corpus <dir>\n' +
          '  packet     --corpus <dir> --out <dir>\n' +
          '  merge      --corpus <dir> --submissions <dir> --out <dir>\n' +
          '  review     --corpus <dir>\n' +
          '  audit      --corpus <dir>',
      );
      if (options.command !== '' && options.command !== '--help' && options.command !== '-h') {
        fail(`Unknown subcommand "${options.command}".`);
      }
  }
}

main();
