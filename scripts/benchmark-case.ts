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
 *   merge      --corpus <dir> --submissions <dir> --out <dir>  safely import submissions; refuse stale/duplicate/mismatched/undeclared
 *   review     --corpus <dir>                      per-subject agreement / disagreement report (never resolves)
 *   audit      --corpus <dir>                      corpus readiness + provenance (never claims accuracy)
 *   adjudicate --corpus <dir> --issue --out <dir>  write blank adjudication forms bound to each disagreement
 *   adjudicate --corpus <dir> --adjudications <dir> --out <dir>  apply a human adjudication, only where its binding still matches
 *
 * The review subcommands are the offline counterpart to `src/benchmark/review.ts`: they read parsed
 * JSON files and write plain JSON files. They never invent a label, reviewer, timestamp or permission,
 * never reach the network or the application database, and never edit a case's gold `expected` array.
 */
import { mkdirSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import {
  CorpusReadError,
  readCorpusValues,
  readJsonEntries,
  readArtifactText,
  readJsonArtifact,
} from './corpus-io.ts';
import { BENCHMARK_LIMITS } from '../src/benchmark/validate.ts';
import { join, resolve } from 'node:path';
import {
  caseProvenanceSummary,
  normaliseCase,
  scaffoldTemplate,
} from '../src/benchmark/authoring.ts';
import { validateBenchmarkCase, validateBenchmarkCorpus } from '../src/benchmark/validate.ts';
import {
  auditCorpus,
  adjudicationTemplate,
  buildReviewerPacket,
  buildSubmissionTemplate,
  disagreementReport,
  rosterGaps,
  type AnnotationSubmission,
  type PendingAdjudication,
} from '../src/benchmark/review.ts';
import { labelledIdentitiesOf } from '../src/benchmark/provenance.ts';
import {
  advanceJournal,
  createJournal,
  planBatchAdjudication,
  planBatchMerge,
  renderStagedCorpus,
  type BatchJournal,
  type BatchMode,
  type BatchPlan,
  type StagedFile,
} from '../src/benchmark/batch.ts';
import { contentHash } from '../src/benchmark/hashing.ts';
import { BENCHMARK_BATCH_JOURNAL_VERSION } from '../src/benchmark/types.ts';
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
  adjudications: string | null;
  issue: boolean;
  dryRun: boolean;
  allowPartial: boolean;
  recover: boolean;
}

function parseArguments(argv: readonly string[]): Options {
  const command = argv[0] ?? '';
  const options: Options = {
    command,
    corpus: null,
    out: null,
    stratum: null,
    submissions: null,
    adjudications: null,
    issue: false,
    dryRun: false,
    allowPartial: false,
    recover: false,
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
    } else if (argument === '--adjudications') {
      options.adjudications = argv[(index += 1)] ?? null;
    } else if (argument === '--issue') {
      options.issue = true;
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument === '--allow-partial') {
      options.allowPartial = true;
    } else if (argument === '--recover') {
      options.recover = true;
    } else {
      fail(`Unknown argument: ${String(argument)}`);
    }
  }
  return options;
}

function readCorpus(directory: string): { index: number; value: unknown }[] {
  try {
    return readCorpusValues(directory);
  } catch (error) {
    if (error instanceof CorpusReadError) {
      return fail(error.message);
    }
    throw error;
  }
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

/**
 * Read every JSON file in a directory, flattening top-level arrays, for the review subcommands. The loading
 * rules live in `corpus-io.ts` so `benchmark:case` and `benchmark:release` cannot drift apart on what an
 * unreadable or malformed file means.
 */
function readJsonDir(directory: string, label: string): { name: string; value: unknown }[] {
  try {
    return readJsonEntries(directory);
  } catch (error) {
    if (error instanceof CorpusReadError) {
      return fail(
        error.kind === 'directory'
          ? `The ${label} directory could not be read: ${directory}`
          : error.message,
      );
    }
    throw error;
  }
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

/**
 * A submission object extended with the case it targets, so a batch can route each entry. From v0.7
 * `PendingAdjudication` carries `caseId` itself, so no separate file shape is needed.
 */

/**
 * Accept only a well-formed adjudication entry; anything else is refused as malformed before the pure layer
 * sees it. v0.7 adds two required fields, `disagreementHash` and `adjudicatedAt`: without checking them here,
 * a hand-edited or truncated file would reach `applyAdjudication` as `undefined` and throw, which is exactly
 * the hostile-input failure the offline review workflow is supposed to turn into a printed refusal.
 */
function coerceAdjudication(value: unknown): PendingAdjudication | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const labelField = record['label'];
  if (
    typeof record['caseId'] !== 'string' ||
    typeof record['dimension'] !== 'string' ||
    typeof record['subjectId'] !== 'string' ||
    typeof record['outcome'] !== 'string' ||
    typeof record['reason'] !== 'string' ||
    typeof record['adjudicatedBy'] !== 'string' ||
    typeof record['disagreementHash'] !== 'string' ||
    typeof record['adjudicatedAt'] !== 'string' ||
    !(labelField === null || typeof labelField === 'string')
  ) {
    return null;
  }
  return {
    caseId: record['caseId'],
    dimension: record['dimension'] as PendingAdjudication['dimension'],
    subjectId: record['subjectId'],
    outcome: record['outcome'],
    label: (labelField as string | null) ?? null,
    reason: record['reason'],
    adjudicatedBy: record['adjudicatedBy'],
    disagreementHash: record['disagreementHash'],
    adjudicatedAt: record['adjudicatedAt'],
  };
}

/**
 * Publish one file so a reader never sees a half-written case: write a sibling temp file, then rename it over
 * the target. `renameSync` replaces atomically on Windows, Linux and macOS, which is why the batch can be
 * resumed file by file after an interruption instead of started again.
 */
function publishFile(target: string, file: StagedFile): void {
  const temporary = join(target, `${file.name}.tmp`);
  writeFileSync(temporary, file.contents, 'utf8');
  renameSync(temporary, join(target, file.name));
}

/**
 * The digest of a file already on disk, for the resume comparison.
 *
 * Bounded, because a recovery pass reads a file an operator may have edited in between: reading an arbitrary
 * size of it into memory to compare a hash is not a recovery, it is a second failure waiting to happen. A
 * file that cannot be read or is too big simply does not match, which the caller already reports.
 */
function fileHash(path: string): string | null {
  try {
    return contentHash(
      readArtifactText(path, { maxBytes: BENCHMARK_LIMITS.maxCaseBytes, label: 'A corpus file' }),
    );
  } catch {
    return null;
  }
}

function readJournal(path: string): BatchJournal | null {
  let parsed: unknown;
  try {
    parsed = readJsonArtifact(path, { label: 'The batch journal' });
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (
    record['version'] !== BENCHMARK_BATCH_JOURNAL_VERSION ||
    typeof record['planHash'] !== 'string' ||
    (record['state'] !== 'staged' &&
      record['state'] !== 'committing' &&
      record['state'] !== 'committed') ||
    !Array.isArray(record['items'])
  ) {
    return null;
  }
  const items = record['items'].filter(
    (item): item is { name: string; contentsHash: string } =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>)['name'] === 'string' &&
      typeof (item as Record<string, unknown>)['contentsHash'] === 'string',
  );
  return {
    version: BENCHMARK_BATCH_JOURNAL_VERSION,
    planHash: record['planHash'],
    kind: record['kind'] === 'adjudication' ? 'adjudication' : 'merge',
    mode: record['mode'] === 'isolated' ? 'isolated' : 'atomic',
    state: record['state'],
    items,
  };
}

function reportPlan(kind: string, plan: BatchPlan, malformed: readonly string[]): void {
  const label = kind === 'adjudication' ? 'adjudication' : 'submission';
  console.error(
    `benchmark:case: plan ${plan.planHash} — ${String(plan.acceptedCount)} ${label}(s) accepted, ` +
      `${String(plan.rejectedCount + malformed.length)} refused (${String(malformed.length)} malformed) (mode: ${plan.mode}).`,
  );
  for (const item of plan.items) {
    const marker = item.accepted ? 'ACCEPTED' : 'REJECTED';
    console.error(`  ${marker} ${item.caseId}/${item.subject}`);
    for (const reason of item.reasons) {
      console.error(`    - ${reason}`);
    }
  }
  for (const name of malformed) {
    console.error(
      `  REJECTED malformed ${label} file ${name} (not a well-formed ${label} object; it was never handed to the planner).`,
    );
  }
}

function cleanStaging(staging: string): void {
  rmSync(staging, { recursive: true, force: true });
}

/**
 * Write a planned batch to disk through a staging directory and a journal.
 *
 * The order is the whole point: every file is materialised in staging and journalled as `staged` before the
 * target is touched at all, so an interruption before that point rolls back to an untouched corpus. Once the
 * journal says `committing`, the remaining files are identified by comparing each target file's hash with the
 * journal's, so a resumed run finishes the job without rewriting what already landed and cannot mistake a
 * different plan for the same one.
 */
function publishBatch(
  kind: 'merge' | 'adjudication',
  plan: BatchPlan,
  target: string,
  malformed: readonly string[],
  options: Options,
): void {
  const staging = `${target}.staging`;
  const journalPath = join(staging, 'journal.json');

  if (options.recover) {
    const journal = existsSync(journalPath) ? readJournal(journalPath) : null;
    if (journal === null) {
      console.error(
        `benchmark:case: no batch journal to recover at ${journalPath}. Nothing was rolled back or completed.`,
      );
      process.exitCode = 1;
      return;
    }
    if (journal.planHash !== plan.planHash) {
      console.error(
        `benchmark:case: the journalled plan ${journal.planHash} does not match the plan these inputs produce now, ${plan.planHash}. The corpus or submissions changed since the interruption, so recovery stops here rather than publishing a mixture of two batches. Inspect or remove ${staging} and run again.`,
      );
      process.exitCode = 1;
      return;
    }
    if (journal.state === 'staged') {
      cleanStaging(staging);
      console.error(
        `benchmark:case: interrupted batch rolled back. The target was never touched, and the staging directory has been removed.`,
      );
      return;
    }
    const staged = new Map(renderStagedCorpus(plan.cases).map((file) => [file.name, file]));
    let published = 0;
    for (const item of journal.items) {
      const file = staged.get(item.name);
      if (file === undefined) {
        console.error(
          `benchmark:case: the journal lists ${item.name}, which these inputs no longer produce. Recovery stopped with the journal in place.`,
        );
        process.exitCode = 1;
        return;
      }
      if (fileHash(join(target, item.name)) === item.contentsHash) {
        continue;
      }
      publishFile(target, file);
      published += 1;
    }
    writeFileSync(
      journalPath,
      `${JSON.stringify(advanceJournal(journal, 'committed').ok ? { ...journal, state: 'committed' } : journal, null, 2)}\n`,
      'utf8',
    );
    cleanStaging(staging);
    console.error(
      `benchmark:case: interrupted batch completed — ${String(published)} file(s) finished publishing out of ${String(journal.items.length)}; the staging directory and journal are removed.`,
    );
    return;
  }

  reportPlan(kind, plan, malformed);

  // A malformed file is part of the batch too. Under the atomic default it stops the run like any other
  // refusal, so "the whole batch" means every input file, not only the ones that parsed cleanly.
  const refused = plan.rejectedCount + malformed.length;

  if (options.dryRun) {
    console.error(
      `benchmark:case: DRY RUN — nothing was written to ${target}, and no journal or staging directory was created.`,
    );
    if (refused > 0) {
      process.exitCode = 1;
    }
    return;
  }

  if (refused > 0 && plan.mode === 'atomic') {
    console.error(
      `benchmark:case: batch refused; nothing written to ${target}. Under the atomic default a single refused ${
        kind === 'adjudication' ? 'decision' : 'submission'
      } stops the whole run, so a corpus is never half-updated. Fix every refusal above, or pass --allow-partial to write the accepted items.`,
    );
    process.exitCode = 1;
    return;
  }

  const staged = renderStagedCorpus(plan.cases);
  mkdirSync(staging, { recursive: true });
  const journal = createJournal(plan, staged);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
  for (const file of staged) {
    writeFileSync(join(staging, file.name), file.contents, 'utf8');
  }
  const committing = advanceJournal(journal, 'committing');
  if (!committing.ok) {
    cleanStaging(staging);
    return fail(`internal: ${committing.reason}`);
  }
  writeFileSync(journalPath, `${JSON.stringify(committing.journal, null, 2)}\n`, 'utf8');

  mkdirSync(target, { recursive: true });
  for (const file of staged) {
    if (fileHash(join(target, file.name)) === file.contentsHash) {
      continue;
    }
    publishFile(target, file);
  }
  writeFileSync(
    journalPath,
    `${JSON.stringify({ ...committing.journal, state: 'committed' }, null, 2)}\n`,
    'utf8',
  );
  cleanStaging(staging);
  console.error(
    `benchmark:case: published ${String(staged.length)} case(s) to ${target}; ` +
      `${String(plan.changedCaseIds.length)} changed by this batch. A rejected item leaves its case unchanged, ` +
      'and gold labels are never edited by a merge or an adjudication.',
  );
  if (malformed.length > 0) {
    console.error(
      `  ${String(malformed.length)} file(s) were malformed and never reached the planner; fix and re-run them.`,
    );
  }
  if (!plan.clean || malformed.length > 0) {
    process.exitCode = 1;
  }
}

/**
 * `roster` reads and never writes. Authorising a reviewer is a deliberate human edit to
 * `provenance.reviewedBy`; a command that could add one would be the tool deciding who may review, which is
 * the owner's call, not the harness's.
 *
 * It works from the parsed files rather than only the validated corpus, because a case carrying a label from
 * an undeclared reviewer is refused by the validator — so a validator-only report would be blind to the exact
 * problem this command exists to surface. Each row states whether the case is scoreable, so nothing is
 * implied about a case that did not validate.
 */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function reviewerNamesFrom(value: unknown): { reviewer: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const names: { reviewer: string }[] = [];
  for (const entry of value) {
    if (typeof entry === 'object' && entry !== null) {
      const reviewer = (entry as Record<string, unknown>)['reviewer'];
      if (typeof reviewer === 'string') {
        names.push({ reviewer });
      }
    }
  }
  return names;
}

function roster(options: Options): void {
  const sources = readCorpus(requireCorpus(options));
  const result = validateBenchmarkCorpus(sources);
  if (sources.length === 0) {
    console.error('benchmark:case: no case file to read; nothing is asserted about the roster.');
    process.exitCode = 1;
    return;
  }
  let casesWithUndeclared = 0;
  for (const source of sources) {
    const record =
      typeof source.value === 'object' && source.value !== null
        ? (source.value as Record<string, unknown>)
        : {};
    const id =
      typeof record['id'] === 'string' && record['id'].length > 0
        ? record['id']
        : `case#${String(source.index)}`;
    const provenance =
      typeof record['provenance'] === 'object' && record['provenance'] !== null
        ? (record['provenance'] as Record<string, unknown>)
        : {};
    const view = {
      provenance: { reviewedBy: stringList(provenance['reviewedBy']) },
      reviewerLabels: reviewerNamesFrom(record['reviewerLabels']),
    };
    const gaps = rosterGaps(view);
    const unauthorised = gaps.filter((gap) => gap.kind === 'UNDECLARED');
    if (unauthorised.length > 0) {
      casesWithUndeclared += 1;
    }
    // Scoreability is decided per source value, not per id: two files carrying one id would otherwise make
    // an unreviewable file look scoreable because a valid namesake exists.
    const scoreable = validateBenchmarkCase(source.value, source.index).length === 0;
    console.error(
      `  ${id}: scoreable=${String(scoreable)} ` +
        `declared=[${view.provenance.reviewedBy.join(', ')}] ` +
        `labellers=${String(labelledIdentitiesOf(view).length)}`,
    );
    for (const gap of unauthorised) {
      console.error(
        `    UNDECLARED "${gap.reviewer}" carries ${String(gap.labelCount)} label(s) but is not in provenance.reviewedBy`,
      );
    }
    for (const gap of gaps.filter((entry) => entry.kind === 'DECLARED_UNUSED')) {
      console.error(
        `    DECLARED_UNUSED "${gap.reviewer}" is authorised for this case and has recorded no label`,
      );
    }
  }
  console.error(
    `benchmark:case: reviewer names are canonical identities and are operator-asserted; they prove no ` +
      `independence and no authentication. Adding a reviewer means editing provenance.reviewedBy by hand — ` +
      `this command never does it, and a release verify shows the edit as a content change. ` +
      `${String(casesWithUndeclared)} case(s) carry undeclared reviewers.`,
  );
  if (casesWithUndeclared > 0 || result.issues.length > 0) {
    process.exitCode = 1;
  }
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
  const mode: BatchMode = options.allowPartial ? 'isolated' : 'atomic';
  const plan = planBatchMerge(cases, submissions, mode);
  if (result.issues.length > 0 && !options.recover) {
    console.error(
      `benchmark:case: ${String(result.issues.length)} corpus entr(y/ies) did not validate and ${
        options.dryRun ? 'would be' : 'are'
      } excluded from this batch:`,
    );
    for (const issue of result.issues.slice(0, 40)) {
      console.error(`  ${issue.caseId} ${issue.field}: ${issue.message}`);
    }
  }
  publishBatch('merge', plan, resolve(options.out), malformed, options);
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

function adjudicate(options: Options): void {
  if (options.out === null) {
    fail('adjudicate needs --out <directory> to write cases with adjudications applied into.');
  }
  const result = validateBenchmarkCorpus(readCorpus(requireCorpus(options)));

  // `--issue` writes the blank bound forms a human fills in. Without it there is no offline way to obtain a
  // `disagreementHash`, and an unbound decision is exactly what v0.7 refuses to apply. Each file is a flat
  // array of entries, the shape `adjudicate --adjudications` reads back, so a form can be filled in and
  // applied without a conversion step.
  if (options.issue) {
    const target = resolve(options.out);
    mkdirSync(target, { recursive: true });
    let issued = 0;
    for (const entry of result.cases) {
      const benchmarkCase = entry as unknown as BenchmarkCase;
      const template = adjudicationTemplate(benchmarkCase);
      if (template.adjudications.length === 0) {
        continue;
      }
      const forms = template.adjudications.map((adjudication) => ({
        caseId: benchmarkCase.id,
        dimension: adjudication.dimension,
        subjectId: adjudication.subjectId,
        outcome: '',
        label: '',
        reason: '',
        adjudicatedBy: '',
        disagreementHash: adjudication.disagreementHash,
        adjudicatedAt: '',
      }));
      issued += forms.length;
      writeFileSync(
        join(target, `${benchmarkCase.id}.adjudication.json`),
        `${JSON.stringify(forms, null, 2)}\n`,
        'utf8',
      );
    }
    console.error(
      `benchmark:case: issued ${String(issued)} bound adjudication entr(y/ies) to ${target}. ` +
        'Each entry carries the disagreement hash it settles; outcome, label, reason, adjudicator and the ' +
        'moment of filing are left blank because resolving a disagreement is a human act. Refused ' +
        `${String(result.issues.length)} invalid entr(y/ies).`,
    );
    if (result.issues.length > 0) {
      process.exitCode = 1;
    }
    return;
  }

  if (options.adjudications === null) {
    fail(
      'adjudicate needs --adjudications <directory> holding scoped adjudication entry files, or --issue to write the blank bound forms instead.',
    );
  }
  const byId = new Map(
    (result.cases as unknown as readonly BenchmarkCase[]).map((benchmarkCase) => [
      benchmarkCase.id,
      benchmarkCase,
    ]),
  );
  const decisions: PendingAdjudication[] = [];
  const malformed: string[] = [];
  for (const entry of readJsonDir(resolve(options.adjudications), 'adjudications')) {
    const coerced = coerceAdjudication(entry.value);
    if (coerced === null) {
      malformed.push(entry.name);
    } else {
      decisions.push(coerced);
    }
  }
  const mode: BatchMode = options.allowPartial ? 'isolated' : 'atomic';
  const plan = planBatchAdjudication([...byId.values()], decisions, mode);
  if (result.issues.length > 0 && !options.recover) {
    console.error(
      `benchmark:case: ${String(result.issues.length)} corpus entr(y/ies) did not validate and are excluded from this batch.`,
    );
  }
  publishBatch('adjudication', plan, resolve(options.out), malformed, options);
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
    case 'roster':
      roster(options);
      break;
    case 'adjudicate':
      adjudicate(options);
      break;
    default:
      console.log(
        'Usage: npm run benchmark:case -- <subcommand> [options]\n' +
          '  scaffold   --stratum <S> [--out <file>]\n' +
          '  validate   --corpus <dir>\n' +
          '  normalise  --corpus <dir> --out <dir>\n' +
          '  provenance --corpus <dir>\n' +
          '  packet     --corpus <dir> --out <dir>\n' +
          '  review     --corpus <dir>\n' +
          '  audit      --corpus <dir>\n' +
          '  roster     --corpus <dir>                        declared-vs-used reviewers, read only\n' +
          '  adjudicate --corpus <dir> --issue --out <dir>        write the blank bound forms for a human\n' +
          '  adjudicate --corpus <dir> --adjudications <dir> --out <dir>  apply decisions that still bind\n' +
          '  merge      --corpus <dir> --submissions <dir> --out <dir>\n' +
          'Batch runs (merge, adjudicate) take --dry-run to report the plan without writing anything,\n' +
          '--allow-partial to write accepted items when another is refused, and --recover to finish or\n' +
          'discard an interrupted run from its journal. The default is atomic: one refusal writes nothing.',
      );
      if (options.command !== '' && options.command !== '--help' && options.command !== '-h') {
        fail(`Unknown subcommand "${options.command}".`);
      }
  }
}

main();
