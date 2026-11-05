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
import { createHash } from 'node:crypto';
import {
  BENCHMARK_DIMENSIONS,
  BENCHMARK_RELEASE_MANIFEST_VERSION,
  BENCHMARK_RUN_RECORD_VERSION,
  type BenchmarkCase,
  type BenchmarkCorpusValidation,
} from './types.ts';
import { canonicalise, contentHash, isContentHash, sha256Hex } from './hashing.ts';
import { releaseGates, verifyRelease, type ReleaseManifest } from './release.ts';
import {
  BENCHMARK_REPORT_VERSION,
  buildBenchmarkReport,
  caseDigest,
  serialiseBenchmarkReport,
  type BenchmarkReport,
  type CorpusDigest,
} from './report.ts';
import { regressionResults, unusableEvidenceRecords } from './regression.ts';
import {
  agreementRows,
  annotationSummaries,
  scoreByDimension,
  type ScoredPair,
} from './scoring.ts';
import { disagreementReport } from './review.ts';
import { compareStrings } from './provenance.ts';

/** The same algorithm name the release manifest declares, so one change cannot be silent in one artifact only. */
export const RUN_RECORD_ALGORITHM = 'sha256-canonical-v1';

/** A release id is `release-` plus twelve hex characters derived from the corpus hash. */
const RELEASE_ID_PATTERN = /^release-[0-9a-f]{12}$/;

/**
 * What a receipt does and does not say, recorded inside the artifact rather than only in prose, because a
 * receipt is the file a later reader will actually open.
 */
const RUN_RECORD_NOTE =
  'This receipt binds one scored run to one verified release: it names the manifest bytes that were trusted, ' +
  'the corpus hash they froze, the report this build produced, and the contract versions in force. It proves ' +
  'that this build scored this corpus into this report. It does not prove that the material is genuine, that ' +
  'two reviewer names are two people, or that any reviewer existed - reviewer identity in a case file is ' +
  'operator-asserted and this application has no authentication. A source revision appears only when an ' +
  'operator supplied one; this tool never reads a repository and never infers a commit. A receipt over a ' +
  'complete, fully-gated corpus describes a ready corpus, not an accurate evaluator.';

export interface RunRecordVersions {
  /** Contract versions actually present in the corpus, so a mixed corpus is visible in the receipt. */
  readonly caseContractVersions: readonly string[];
  readonly reportVersion: string;
  readonly methodologyVersion: string;
  readonly metricsVersion: string;
  /** The rule in force for this build, never a proposed one. */
  readonly evidenceRuleVersion: string;
}

export interface RunRecordWarnings {
  readonly notReleaseBound: boolean;
  /** Legacy decisions that settle a subject without naming the split - honoured, and disclosed. */
  readonly unboundAdjudications: number;
  readonly strataMissing: readonly string[];
  readonly gateNotes: readonly string[];
}

export interface BenchmarkRunRecord {
  readonly version: string;
  readonly algorithm: string;
  readonly producedBy: string;
  readonly releaseId: string | null;
  readonly manifestSha256: string | null;
  readonly manifestLabel: string | null;
  readonly corpusHash: string | null;
  /** Canonical content hash: stable across serialisation and platform, so a replay can be compared anywhere. */
  readonly reportSha256: string;
  /** SHA-256 of the exact report text this run wrote, kept beside the content hash rather than instead of it. */
  readonly reportTextSha256: string;
  readonly caseCount: number;
  readonly versions: RunRecordVersions;
  readonly warnings: RunRecordWarnings;
  /** Only what an operator explicitly supplied. `null` means none was given, never "unknown but assumed". */
  readonly sourceRevision: string | null;
  readonly accuracyClaimable: false;
  readonly note: string;
}

export interface RunRecordInput {
  readonly report: BenchmarkReport;
  readonly reportText: string;
  readonly binding: ReleaseBinding;
  readonly cases: readonly BenchmarkCase[];
  readonly sourceRevision: string | null;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareStrings);
}

/**
 * Build the receipt for a run that has just been scored.
 *
 * `warnings.unboundAdjudications` is counted from the validated cases through the same shared binding resolver
 * v0.7 introduced, not read out of the manifest: an unbound run and a bound run over one corpus must report the
 * same provenance figure, or the absence of a manifest would look like the absence of a gap.
 */
export function buildRunRecord(input: RunRecordInput): BenchmarkRunRecord {
  const { report, binding, cases } = input;
  const unboundAdjudications = cases.reduce(
    (total, benchmarkCase) => total + disagreementReport(benchmarkCase).unbound,
    0,
  );
  return {
    version: BENCHMARK_RUN_RECORD_VERSION,
    algorithm: RUN_RECORD_ALGORITHM,
    producedBy: 'npm run benchmark',
    releaseId: binding.releaseId,
    manifestSha256: binding.manifestSha256,
    manifestLabel: binding.manifestLabel,
    corpusHash: binding.corpusHash,
    reportSha256: contentHash(report),
    reportTextSha256: sha256Hex(input.reportText),
    caseCount: cases.length,
    versions: {
      caseContractVersions: uniqueSorted(cases.map((benchmarkCase) => benchmarkCase.version)),
      reportVersion: report.version,
      methodologyVersion: report.methodologyVersion,
      metricsVersion: report.metricsVersion,
      evidenceRuleVersion: report.evidenceRuleVersion,
    },
    warnings: {
      notReleaseBound: binding.warnings.includes('NOT-RELEASE-BOUND'),
      unboundAdjudications,
      strataMissing: report.corpus.strataMissing.map((entry) => entry.stratum),
      gateNotes: binding.warnings.filter((warning) => warning !== 'NOT-RELEASE-BOUND'),
    },
    sourceRevision: input.sourceRevision,
    accuracyClaimable: false,
    note: RUN_RECORD_NOTE,
  };
}

/**
 * Canonical bytes of a receipt, so the same run writes the same file on any machine.
 *
 * Sorted by code unit through the shared canonicaliser, exactly like a release manifest: a receipt whose own
 * bytes drifted between platforms could not be used to verify anything, including itself.
 */
export function runRecordText(record: BenchmarkRunRecord): string {
  return `${JSON.stringify(canonicalise(record), null, 2)}\n`;
}

/**
 * Why this value is not a run receipt this build may verify, or `null` when it is one.
 */
export function runRecordProblem(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'the file is not a JSON object, so it cannot be a run receipt';
  }
  const record = parsed as Record<string, unknown>;
  if (record['version'] !== BENCHMARK_RUN_RECORD_VERSION) {
    return `version must be "${BENCHMARK_RUN_RECORD_VERSION}"; found ${JSON.stringify(record['version'])}`;
  }
  for (const field of ['reportSha256', 'reportTextSha256'] as const) {
    if (!isContentHash(record[field])) {
      return `${field} must be a 64-character lowercase SHA-256 digest; found ${JSON.stringify(record[field])}`;
    }
  }
  for (const field of [
    'releaseId',
    'manifestSha256',
    'manifestLabel',
    'corpusHash',
    'sourceRevision',
  ] as const) {
    const value = record[field];
    if (value !== null && typeof value !== 'string') {
      return `${field} must be a string or null; found ${JSON.stringify(value)}`;
    }
  }
  if (!Number.isInteger(record['caseCount']) || (record['caseCount'] as number) < 0) {
    return `caseCount must be a non-negative integer; found ${JSON.stringify(record['caseCount'])}`;
  }
  if (typeof record['versions'] !== 'object' || record['versions'] === null) {
    return 'versions is required; a receipt without the contract versions that applied proves nothing';
  }
  if (record['accuracyClaimable'] !== false) {
    return 'accuracyClaimable must be false; a receipt that claims accuracy is not a receipt this build writes';
  }
  return null;
}

/** One corpus file as read, kept whole because a report digests both the file and the cases in it. */
export interface CorpusFileInput {
  readonly name: string;
  readonly text: string;
  readonly values: readonly unknown[];
}

export interface ComposedRunReport {
  readonly report: BenchmarkReport;
  readonly reportText: string;
}

/**
 * Score a validated corpus into the report, exactly as the harness does.
 *
 * This is shared by `benchmark` and `benchmark:verify` for one reason: a replay that recomputes the report by a
 * second implementation will drift from the original in some field nobody thought to compare — the corpus
 * digests are the likeliest place. One pipeline means a verification compares the same construction it claims to
 * reproduce, and the receipt's report hashes are checkable rather than approximately right.
 *
 * Only what the software itself produces is scored as produced-versus-gold. Human-judgement dimensions are
 * reported as annotation agreement in their own block, from their own rule, and nothing selects a reviewer label
 * to manufacture a consensus or merges an agreement figure into a regression count.
 */
export function composeRunReport(
  files: readonly CorpusFileInput[],
  validation: BenchmarkCorpusValidation,
): ComposedRunReport {
  const regression = regressionResults(validation.cases);
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

  const acceptedValues = new Set<unknown>(validation.cases as readonly unknown[]);
  const digests: CorpusDigest[] = files.map((file) => ({
    kind: 'file',
    source: file.name,
    caseCount: file.values.length,
    digest: createHash('sha256').update(file.text, 'utf8').digest('hex').slice(0, 16),
    bytes: Buffer.byteLength(file.text, 'utf8'),
    // Settled once validation has run, so a file whose cases were all refused is visible.
    accepted: file.values.every((value) => acceptedValues.has(value)),
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

  const report = buildBenchmarkReport(
    validation,
    regression,
    dimensions,
    agreement,
    annotation,
    unusable,
    digests,
  );
  return { report, reportText: serialiseBenchmarkReport(report) };
}

/** The report contract version this build writes, re-exported so a reader can compare a stored document. */
export const CURRENT_REPORT_VERSION = BENCHMARK_REPORT_VERSION;

export interface RunRecordReplay {
  readonly report: BenchmarkReport;
  readonly reportText: string;
  readonly binding: ReleaseBinding;
  /** The cases the replay scored, so a contract-version mix can be compared against the receipt. */
  readonly cases: readonly BenchmarkCase[];
  /** The source revision supplied to *this* verification, if any. Never inferred and never reused from the receipt. */
  readonly sourceRevision: string | null;
  /** The manifest bytes now on disk, or `null` when the caller could not read any. */
  readonly manifestText: string | null;
}

export interface RunRecordVerification {
  readonly ok: boolean;
  /** Each line begins with the kind of disagreement and names the field that moved. */
  readonly mismatches: readonly string[];
  /** Real differences that are not failures, said plainly rather than quietly passed. */
  readonly notes: readonly string[];
  readonly checked: readonly string[];
}

/**
 * Replay a run against what is on disk now, and report where they disagree.
 *
 * The two report digests are compared separately on purpose. `reportSha256` is over canonical content, so it
 * survives a reformat and an ICU-versus-code-unit ordering difference — which is the only way a receipt written
 * on one operating system can be checked on another. `reportTextSha256` is over exact bytes, so a rewritten file
 * is visible even when its content still parses. Content disagreement fails the verification; a text difference
 * alone is reported as what it is: a reformatted file, not a forged one.
 *
 * A binding that no longer holds is reported field by field, because "the corpus changed" is not actionable and
 * "CHANGED case-42 is not the case that was frozen" is.
 */
export function verifyRunRecord(
  record: BenchmarkRunRecord,
  replay: RunRecordReplay,
): RunRecordVerification {
  const mismatches: string[] = [];
  const notes: string[] = [];
  const checked: string[] = [];

  if (record.manifestSha256 !== null) {
    if (replay.manifestText === null) {
      mismatches.push(
        `INCOMPLETE-ARTIFACT the receipt names manifest bytes (sha256 ${record.manifestSha256.slice(0, 12)}\u2026) that were not supplied, so the binding cannot be checked.`,
      );
    } else {
      checked.push('manifestSha256');
      const actual = sha256Hex(replay.manifestText);
      if (actual !== record.manifestSha256) {
        mismatches.push(
          `MANIFEST-TAMPERED manifestSha256 is ${actual} now and ${record.manifestSha256} when the run was recorded.`,
        );
      }
    }
  } else if (replay.manifestText !== null) {
    // The reverse case: a manifest was offered to a receipt that never had one. Agreeing here would let a later
    // file retroactively certify an unverified run.
    mismatches.push(
      'RECORD-BOUND-STATE sourceRevision and releaseId were recorded without a release, so a manifest supplied now cannot be the one that was verified.',
    );
  }

  checked.push('releaseId');
  if (record.releaseId !== replay.binding.releaseId) {
    mismatches.push(
      `RELEASE-ID releaseId is ${String(replay.binding.releaseId)} now and ${String(record.releaseId)} in the receipt.`,
    );
  }
  checked.push('corpusHash');
  if (record.corpusHash !== replay.binding.corpusHash) {
    mismatches.push(
      `CORPUS-HASH corpusHash is ${String(replay.binding.corpusHash)} now and ${String(record.corpusHash)} in the receipt.`,
    );
  }

  if (!replay.binding.ok) {
    for (const refusal of replay.binding.refused) {
      if (refusal.startsWith('GATE')) {
        mismatches.push(`RECORD-GATES ${refusal}`);
      } else {
        mismatches.push(`CORPUS-DRIFTED ${refusal}`);
      }
    }
  }

  checked.push('reportSha256');
  const content = contentHash(replay.report);
  if (content !== record.reportSha256) {
    mismatches.push(
      `REPORT-CONTENT reportSha256 is ${content} on replay and ${record.reportSha256} in the receipt.`,
    );
  }
  checked.push('reportTextSha256');
  const text = sha256Hex(replay.reportText);
  if (text !== record.reportTextSha256) {
    if (content === record.reportSha256) {
      notes.push(
        `serialisation-order difference only: the report text hashes to ${text} rather than ${record.reportTextSha256}, while its canonical content is unchanged. Same result, different bytes.`,
      );
    } else {
      mismatches.push(
        `REPORT-CONTENT reportTextSha256 is ${text} on replay and ${record.reportTextSha256} in the receipt, and the content differs too.`,
      );
    }
  }

  checked.push('caseCount');
  if (record.caseCount !== replay.binding.caseCount) {
    mismatches.push(
      `CASE-COUNT caseCount is ${String(replay.binding.caseCount)} on replay and ${String(record.caseCount)} in the receipt.`,
    );
  }

  const versions: [string, string, string][] = [
    ['reportVersion', record.versions.reportVersion, replay.report.version],
    ['methodologyVersion', record.versions.methodologyVersion, replay.report.methodologyVersion],
    ['metricsVersion', record.versions.metricsVersion, replay.report.metricsVersion],
    ['evidenceRuleVersion', record.versions.evidenceRuleVersion, replay.report.evidenceRuleVersion],
  ];
  for (const [field, recorded, actual] of versions) {
    checked.push(field);
    if (recorded !== actual) {
      mismatches.push(
        `VERSION-DRIFT ${field} applied to this run is ${actual} now and ${recorded} when it was recorded — a different rule, so this is not the same measurement.`,
      );
    }
  }
  checked.push('caseContractVersions');
  const present = uniqueSorted(replay.cases.map((benchmarkCase) => benchmarkCase.version));
  if (record.versions.caseContractVersions.join(',') !== present.join(',')) {
    mismatches.push(
      `VERSION-DRIFT caseContractVersions are ${present.join('+') || 'none'} on replay and ${record.versions.caseContractVersions.join('+') || 'none'} in the receipt.`,
    );
  }

  checked.push('sourceRevision');
  if ((record.sourceRevision ?? null) !== (replay.sourceRevision ?? null)) {
    mismatches.push(
      `sourceRevision is ${JSON.stringify(replay.sourceRevision ?? null)} now and ${JSON.stringify(record.sourceRevision)} in the receipt.`,
    );
  }

  return { ok: mismatches.length === 0, mismatches, notes, checked };
}

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
