/**
 * `npm run benchmark:verify` — replay a recorded run and report where reality disagrees (v0.8, spec §6).
 *
 * Given a `benchmark-run-record-v1`, this re-reads the corpus and manifest the run was made from, re-scores them
 * through the same pipeline the harness used, and compares the result field by field against the receipt. It is
 * the only place in the toolchain that can say "the report you stored is not the report this corpus produces".
 *
 * What it checks, and what it cannot:
 *   - manifest bytes, release id, corpus hash: the binding still holds;
 *   - report content hash, and report text hash separately: a reformat is a note, a changed result is a failure;
 *   - case count, and every applicable contract version: the same rule ran, or it did not;
 *   - a supplied source revision: compared against what was recorded, never looked up.
 * A verification over a corpus that was never bound can check the report only, and says which of the two it did.
 * It cannot tell whether the material is genuine or a reviewer real: hashes are integrity checks, and
 * `accuracyClaimable` is false in every artifact this repository writes.
 *
 * Offline and local: reads files under the same ceilings as every other benchmark read, writes nothing.
 */
import { resolve } from 'node:path';
import {
  bindRunToRelease,
  composeRunReport,
  runRecordProblem,
  verifyRunRecord,
  type BenchmarkRunRecord,
} from '../src/benchmark/execution.ts';
import { validateBenchmarkCorpus } from '../src/benchmark/validate.ts';
import {
  CorpusReadError,
  readArtifactText,
  readCorpusFiles,
  readJsonArtifact,
} from './corpus-io.ts';
import { contentHash, sha256Hex } from '../src/benchmark/hashing.ts';
import type { BenchmarkCase } from '../src/benchmark/types.ts';
import { serialiseBenchmarkReport } from '../src/benchmark/report.ts';

function fail(message: string): never {
  console.error(`benchmark:verify: ${message}`);
  process.exit(1);
}

interface Options {
  record: string | null;
  corpus: string | null;
  manifest: string | null;
  report: string | null;
  sourceRevision: string | null;
}

function parseArguments(argv: readonly string[]): Options {
  const options: Options = {
    record: null,
    corpus: null,
    manifest: null,
    report: null,
    sourceRevision: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--record') {
      options.record = argv[(index += 1)] ?? null;
    } else if (argument === '--corpus') {
      options.corpus = argv[(index += 1)] ?? null;
    } else if (argument === '--manifest') {
      options.manifest = argv[(index += 1)] ?? null;
    } else if (argument === '--report') {
      options.report = argv[(index += 1)] ?? null;
    } else if (argument === '--source-revision') {
      options.sourceRevision = argv[(index += 1)] ?? null;
    } else if (argument === '--help' || argument === '-h') {
      printUsage();
      process.exit(0);
    } else {
      fail(`Unknown argument: ${String(argument)}`);
    }
  }
  return options;
}

function printUsage(): void {
  console.log(`Usage: npm run benchmark:verify -- --record <file> [options]

  --record        The benchmark-run-record-v1 to check. Required.
  --corpus        The case directory the run scored. With --manifest, the binding is replayed as well.
  --manifest      The benchmark-release-manifest-v1 the receipt names.
  --report        The stored report to compare against the receipt's hashes.
  --source-revision <text>
                  Compared with the revision the receipt recorded. Nothing is looked up, and nothing guessed.

Verification writes nothing. It refuses when anything disagrees, and names the field that moved. A replay needs
the corpus and the manifest: without them only the stored report can be checked, and the run says which it did.
Offline only. A verification proves bytes and construction, not that the material is genuine or the reviewers
real, and accuracyClaimable stays false.`);
}

/** Read a receipt, refusing anything that is not one this build can compare against. */
function readRecord(path: string): BenchmarkRunRecord {
  let parsed: unknown;
  try {
    parsed = readJsonArtifact(resolve(path), { label: 'The run record' });
  } catch (error) {
    if (error instanceof CorpusReadError) {
      return fail(`${error.message} There is nothing to verify without the receipt.`);
    }
    throw error;
  }
  const problem = runRecordProblem(parsed);
  if (problem !== null) {
    return fail(`${path} is not a verifiable run receipt: ${problem}`);
  }
  return parsed as unknown as BenchmarkRunRecord;
}

function readManifestText(path: string): string {
  try {
    return readArtifactText(resolve(path), { label: 'The release manifest' });
  } catch (error) {
    if (error instanceof CorpusReadError) {
      return fail(
        `${error.message} The receipt names a release; it cannot be verified without its manifest.`,
      );
    }
    throw error;
  }
}

function main(): void {
  const options = parseArguments(process.argv.slice(2));
  if (options.record === null) {
    printUsage();
    fail('--record <file> is required: there is nothing to verify without a receipt.');
  }
  const record = readRecord(options.record);

  // The stored report is checked against both recorded hashes whenever it is supplied: this is the check that
  // catches a tampered report even when nobody kept the corpus any more.
  const notes: string[] = [];
  const mismatches: string[] = [];
  const checked: string[] = [];
  if (options.report !== null) {
    const reportPath = resolve(options.report);
    let reportText: string;
    try {
      reportText = readArtifactText(reportPath, { label: 'The stored report' });
    } catch (error) {
      if (error instanceof CorpusReadError) {
        fail(
          `${error.message} The receipt names a report; it cannot be verified without the file.`,
        );
      }
      throw error;
    }
    checked.push('stored reportSha256', 'stored reportTextSha256');
    const textHash = sha256Hex(reportText);
    if (textHash !== record.reportTextSha256) {
      let contentChanged: boolean;
      try {
        contentChanged = contentHash(JSON.parse(reportText)) !== record.reportSha256;
      } catch {
        contentChanged = true;
      }
      // A stored file is the artifact the receipt names, not a re-derivation of it, so a byte difference here is
      // a discrepancy and not a note. Treating it as "same content, different formatting" would let anyone edit
      // `reportTextSha256` in a receipt and have the file still pass - which was found by tampering every field
      // in turn. The replay path may still report a reformat as a note, because there the bytes are recomputed by
      // whichever build is doing the checking.
      mismatches.push(
        contentChanged
          ? `REPORT-CONTENT reportTextSha256: the report at ${reportPath} is not the report the receipt recorded (text sha256 ${textHash}, recorded ${record.reportTextSha256}), and its content differs too.`
          : `REPORT-TEXT reportTextSha256: the report at ${reportPath} hashes to ${textHash} and the receipt recorded ${record.reportTextSha256}. Its canonical content is unchanged, so the document was rewritten rather than re-decided - but a receipt and its artifact must still agree byte for byte.`,
      );
    } else {
      let storedContentMatches: boolean;
      try {
        storedContentMatches = contentHash(JSON.parse(reportText)) === record.reportSha256;
      } catch {
        storedContentMatches = false;
      }
      if (!storedContentMatches) {
        mismatches.push(
          'REPORT-CONTENT reportSha256: the report at the supplied path has the recorded bytes but not the recorded content.',
        );
      }
    }
  }

  if (options.corpus !== null && options.manifest !== null) {
    const directory = resolve(options.corpus);
    let files: { name: string; text: string; parsed: unknown; values: unknown[] }[];
    try {
      files = readCorpusFiles(directory);
    } catch (error) {
      if (error instanceof CorpusReadError) {
        fail(`${error.message} A replay needs the corpus the run scored.`);
      }
      throw error;
    }
    const validation = validateBenchmarkCorpus(
      files.map((file, index) => ({ index, value: file.parsed })),
    );
    const manifestText = readManifestText(options.manifest);
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      return fail('The release manifest is not valid JSON, so the binding cannot be replayed.');
    }
    const binding = bindRunToRelease({
      manifest,
      cases: validation.cases as unknown as readonly BenchmarkCase[],
      validation,
      manifestText,
    });
    const composed = composeRunReport(
      files.map((file) => ({ name: file.name, text: file.text, values: file.values })),
      validation,
    );
    const verification = verifyRunRecord(record, {
      report: composed.report,
      // The comparison is against what this build's serialiser produces, so a stored-text difference can be
      // reported as a reformat rather than a forged result.
      reportText: serialiseBenchmarkReport(composed.report),
      binding,
      cases: validation.cases as unknown as readonly BenchmarkCase[],
      sourceRevision: options.sourceRevision,
      manifestText,
    });
    mismatches.push(...verification.mismatches);
    notes.push(...verification.notes);
    checked.push(...verification.checked);
  } else if (record.releaseId !== null) {
    mismatches.push(
      `INCOMPLETE-ARTIFACT the receipt is bound to release ${record.releaseId}, but no --corpus and --manifest were supplied, so the binding was not replayed.`,
    );
  } else {
    notes.push(
      'not replayed: the receipt records a run that was never bound to a release, so there is no binding to check.',
    );
  }

  if (record.sourceRevision === null && options.sourceRevision === null) {
    notes.push(
      'no source revision was recorded, because none was supplied when the run was made; this tool does not look one up.',
    );
  }

  for (const warning of record.warnings.gateNotes) {
    console.error(`benchmark:verify: provenance note — ${warning}`);
  }
  if (record.warnings.notReleaseBound) {
    console.error(
      'benchmark:verify: this run was NOT bound to a release; nothing about the corpus is verified.',
    );
  }
  for (const note of notes) {
    console.error(`benchmark:verify: note — ${note}`);
  }

  if (mismatches.length > 0) {
    console.error(
      `benchmark:verify: DISAGREES with ${record.version} ${record.releaseId ?? '(unbound)'} — ${String(mismatches.length)} problem(s).`,
    );
    for (const mismatch of mismatches) {
      console.error(`  ${mismatch}`);
    }
  } else {
    console.error(
      `benchmark:verify: VERIFIED ${record.version} ${record.releaseId ?? '(unbound)'} — ${String(checked.length)} field(s) checked: ${checked.join(', ')}.`,
    );
  }
  console.error(
    'benchmark:verify: a verification compares recorded bytes and recomputed results. It cannot show that the ' +
      'material is genuine or that a reviewer was real, and accuracyClaimable is false in the receipt it checked.',
  );
  if (mismatches.length > 0) {
    process.exitCode = 1;
  }
}

main();
