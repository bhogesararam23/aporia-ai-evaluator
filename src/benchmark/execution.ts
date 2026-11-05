/**
 * Release-bound benchmark execution and the run receipt (v0.8, ADR-028).
 *
 * A benchmark report used to say what it scored and nothing about *which* corpus it scored: `--release` was an
 * unknown argument, and no field in `benchmark-report-v2` named a manifest. That made a report unanswerable a
 * month later — six edited sentences produce the same shape of document. This module supplies the missing link:
 * verify the frozen release first, score it, and write a receipt that names the exact bytes involved.
 *
 * What a receipt proves is narrow and worth stating precisely: that this build, under these contract versions,
 * scored a corpus whose digests matched the manifest's, and produced a report whose content hashes to the
 * recorded value. It does not prove that the material is genuine, that two reviewer names are two people, or
 * that any reviewer existed; hashes are integrity checks, and reviewer identity in a case file is
 * operator-asserted. Readiness to audit is not accuracy, and `accuracyClaimable` is the literal `false`.
 *
 * Pure and offline: no filesystem, no clock, no path, no hostname, no environment. The same inputs always
 * produce the same bytes, on any machine, which is what makes a stored receipt checkable later.
 */
import {
  BENCHMARK_RELEASE_MANIFEST_VERSION,
  type BenchmarkCase,
  type BenchmarkCorpusValidation,
} from './types.ts';
import { isContentHash, sha256Hex } from './hashing.ts';
import { releaseGates, verifyRelease, type ReleaseManifest } from './release.ts';

/** The same algorithm name the release manifest declares, so one change cannot be silent in one artifact only. */
export const RUN_RECORD_ALGORITHM = 'sha256-canonical-v1';

/** A release id is `release-` plus twelve hex characters derived from the corpus hash. */
const RELEASE_ID_PATTERN = /^release-[0-9a-f]{12}$/;

/**
 * Why this value is not a release manifest this build may trust, or `null` when it is one.
 *
 * Shape before semantics: a manifest from another contract, or a hand-edited one missing its digests, has to be
 * refused *as a manifest* rather than produce a confusing stream of case-drift refusals. This is also what makes
 * a stale manifest detectable — the version string is checked, not assumed.
 */
export function releaseManifestProblem(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'the file is not a JSON object, so it cannot be a release manifest';
  }
  const record = parsed as Record<string, unknown>;
  if (record['version'] !== BENCHMARK_RELEASE_MANIFEST_VERSION) {
    return `version must be "${BENCHMARK_RELEASE_MANIFEST_VERSION}"; found ${JSON.stringify(record['version'])}. A manifest written by another contract cannot be verified against this build, because the digests would not be comparable.`;
  }
  if (typeof record['releaseId'] !== 'string' || !RELEASE_ID_PATTERN.test(record['releaseId'])) {
    return `releaseId must look like "release-" plus 12 hex characters; found ${JSON.stringify(record['releaseId'])}`;
  }
  if (!isContentHash(record['corpusHash'])) {
    return `corpusHash must be a 64-character lowercase SHA-256 digest; found ${JSON.stringify(record['corpusHash'])}`;
  }
  if (!Array.isArray(record['cases'])) {
    return `cases must be a list; found ${JSON.stringify(record['cases'])}`;
  }
  if (!Number.isInteger(record['caseCount']) || record['caseCount'] !== record['cases'].length) {
    return `caseCount must be the number of case entries; got ${JSON.stringify(record['caseCount'])} for ${String(record['cases'].length)} entries`;
  }
  for (const [index, entry] of record['cases'].entries()) {
    if (typeof entry !== 'object' || entry === null) {
      return `case entry ${String(index)} is not an object`;
    }
    const caseEntry = entry as Record<string, unknown>;
    if (typeof caseEntry['caseId'] !== 'string' || caseEntry['caseId'].length === 0) {
      return `case entry ${String(index)} has no caseId`;
    }
    if (!isContentHash(caseEntry['contentHash'])) {
      return `case "${String(caseEntry['caseId'])}" has no usable contentHash, so its bytes cannot be compared`;
    }
  }
  if (!Array.isArray(record['gates'])) {
    return 'gates must be a list; without them a manifest cannot say what it checked';
  }
  return null;
}

export interface ReleaseBinding {
  readonly ok: boolean;
  /** Prefixed refusals: `MANIFEST`, `ADDED`, `REMOVED`, `CHANGED`, `DUPLICATE`, `CONTRACT`, `INVALID`, `GATE`. */
  readonly refused: readonly string[];
  /** Non-blocking findings, disclosed and never promoted into a pass or a refusal. */
  readonly warnings: readonly string[];
  readonly releaseId: string | null;
  readonly corpusHash: string | null;
  /** SHA-256 of the manifest bytes as read. A new full-length identity; it does not reuse any stored digest field. */
  readonly manifestSha256: string | null;
  readonly manifestLabel: string | null;
  readonly caseCount: number;
}

export interface ReleaseBindingInput {
  readonly manifest: unknown;
  readonly cases: readonly BenchmarkCase[];
  readonly validation: Pick<BenchmarkCorpusValidation, 'issues'>;
  /** The manifest file's exact text, or `null` when the run was not given a release to bind to. */
  readonly manifestText: string | null;
}

/**
 * Decide whether this corpus may be scored as the release the manifest describes.
 *
 * The refusal list is the product: an operator needs to know *which* case moved, not merely that the corpus
 * "does not match". Blocking gate failures stop the run, because a blocking gate is a statement that the corpus
 * cannot be trusted to mean what it says — a stale adjudication, for instance, settles nothing yet would be
 * scored as if it did.
 *
 * An unbound run (`manifestText: null`) is allowed and says so, because CI and existing workflows score
 * unreviewed fixture corpora. The receipt then carries `releaseId: null` rather than inventing one.
 */
export function bindRunToRelease(input: ReleaseBindingInput): ReleaseBinding {
  const { cases, validation, manifestText } = input;
  const gates = releaseGates(cases, validation);
  const warnings: string[] = gates
    .filter((gate) => !gate.blocking && !gate.passed)
    .map((gate) => `${gate.name} (non-blocking): ${gate.detail}`);
  const base: ReleaseBinding = {
    ok: false,
    refused: [],
    warnings: [...warnings],
    releaseId: null,
    corpusHash: null,
    manifestSha256: null,
    manifestLabel: null,
    caseCount: cases.length,
  };

  if (manifestText === null) {
    // Nothing to bind to. Stated, not implied: the warning is what a reader of the receipt needs to see, and a
    // silent unbound run would look identical to a verified one.
    return { ...base, ok: true, warnings: ['NOT-RELEASE-BOUND', ...base.warnings] };
  }

  const problem = releaseManifestProblem(input.manifest);
  if (problem !== null) {
    return { ...base, refused: [`MANIFEST ${problem}`] };
  }

  const manifest = input.manifest as ReleaseManifest;
  const verification = verifyRelease(manifest, cases);
  const refused: string[] = [];
  for (const caseId of verification.changed) {
    refused.push(`CHANGED ${caseId} is not the case that was frozen in this release.`);
  }
  for (const caseId of verification.added) {
    refused.push(`ADDED ${caseId} is not in the frozen release.`);
  }
  for (const caseId of verification.removed) {
    refused.push(`REMOVED ${caseId} was frozen and is no longer in the corpus.`);
  }
  for (const caseId of verification.duplicateCaseIds) {
    refused.push(
      `DUPLICATE ${caseId} appears in more than one file, so no digest can say which one was reviewed.`,
    );
  }
  for (const drift of verification.contractDrift) {
    refused.push(`CONTRACT ${drift} — the case changed contract version after the freeze.`);
  }
  if (validation.issues.length > 0) {
    refused.push(
      `INVALID ${String(validation.issues.length)} corpus problem(s); a release is a statement about valid cases only.`,
    );
  }
  for (const gate of gates) {
    if (gate.blocking && !gate.passed) {
      refused.push(`GATE ${gate.name}: ${gate.detail}`);
    }
  }
  return {
    ...base,
    ok: refused.length === 0,
    refused,
    releaseId: manifest.releaseId,
    // The frozen identity, not a recomputed one: if the corpus moved, `CHANGED`/`ADDED` above already say so,
    // and a receipt that recorded the drifted hash would describe a corpus nobody released.
    corpusHash: manifest.corpusHash,
    manifestSha256: sha256Hex(manifestText),
    manifestLabel:
      typeof manifest.label === 'string' && manifest.label.length > 0 ? manifest.label : null,
  };
}
