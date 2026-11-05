# v0.8 Requirements Traceability — Release-Bound Benchmark Execution and Corpus I/O Hardening

- Status: Audited against this checkout on 2026-11-05
- Scope: the requirements of the local core v0.8 milestone — unified corpus ingestion (§1), release-bound
  execution (§2), the run record (§3), reproducible verification (§4), artifact publication (§5),
  compatibility (§6) and governance (§7)
- Related: [Implementation Status](../IMPLEMENTATION_STATUS.md), [ADR-028](../agents/adrs/ADR-028-release-bound-execution-and-artifact-identities.md),
  [design document](../technical/BENCHMARK_EXECUTION_BINDING_AND_CORPUS_IO_HARDENING.md),
  [v0.8 session report](../agents/sessions/2026-11-05-local-core-v0.8-execution-binding-corpus-io-hardening.md),
  [v0.7 traceability](V07_REQUIREMENTS_TRACEABILITY.md)

Each row names the code that satisfies the requirement and the check that would fail if it did not. "Test"
means an automated check that ran; "run" means an observed result recorded in the session report. Nothing here
is asserted from documentation, and no row claims a review, reviewer, corpus or accuracy figure that does not
exist.

## 1. Unified, bounded corpus ingestion

| Requirement | Implementation | Check |
|---|---|---|
| One loading implementation across `benchmark`, `benchmark:case` and `benchmark:release` | `scripts/corpus-io.ts` (`readCorpusFiles`, `readCorpusValues`, `readJsonEntries`, `readArtifactText`, `readJsonArtifact`); the harness's private loader is deleted | `tests/integration/benchmark-corpus-io-cli.test.ts` ("one oversized file is refused by every command"; "npm run benchmark refuses a hostile entry it used to skip"); `tests/unit/benchmark-corpus-io.test.ts` |
| File-count, case-count, per-file byte, total byte and nesting limits enforced before expensive parsing | `assertFileCount`/`assertFileBytes`/`assertTotalBytes` applied to the `lstat` size in `inspectEntries`; `maxFiles` and `maxNestingDepth` added to `BENCHMARK_LIMITS`; depth checked with `nestsDeeperThan` after parse | `benchmark-corpus-limits.test.ts`; `benchmark-corpus-io.test.ts` (each ceiling, and a non-JSON oversized file reported as too big rather than malformed — the proof the bound precedes the parse) |
| Symlinks, path escapes, unexpected file types and malformed input refused | `lstatSync` classification with kinds `symlink`, `type`, `json`, `depth`, `count`, `size`, `directory`; unsafe case ids refused by `naming.ts` in the validator and the writer | `benchmark-corpus-io-cli.test.ts` (symlink test skips with its reason where the platform cannot link; directory-name and escape cases run everywhere); `benchmark-naming.test.ts`; `benchmark-validate.test.ts` |
| Duplicate case ids still refused | unchanged owner: `validateBenchmarkCorpus`, surfaced as `DUPLICATE` by the binder too | `benchmark-validate.test.ts`; `benchmark-execution-binding.test.ts` |
| Typed, actionable errors and deterministic ordering preserved | `CorpusReadError.kind` + messages naming file and limit; entry names sorted by code unit, not locale | `benchmark-corpus-io.test.ts` ("ordered by code unit", `B.json` before `a.json`); `benchmark-corpus-io-cli.test.ts` asserts no `at …ts:line` frame on any command |

## 2. Benchmark execution bound to a release

| Requirement | Implementation | Check |
|---|---|---|
| The workflow accepts and verifies a `benchmark-release-manifest-v1` before scoring | `--release` in `scripts/benchmark.ts`; `releaseManifestProblem` + `bindRunToRelease` in `src/benchmark/execution.ts`, called before `composeRunReport` | `benchmark-execution-binding.test.ts`; `benchmark-execution-lifecycle.test.ts` ("a corpus that matches its frozen release runs"; "one edited sentence is refused … and no report is written") |
| Changed, missing, added, duplicated, invalid and contract-drifted cases refused | `CHANGED`/`REMOVED`/`ADDED`/`DUPLICATE`/`CONTRACT`/`INVALID` refusals built from `verifyRelease` plus the validation issue count | `benchmark-execution-binding.test.ts` (each cause separately); `benchmark-execution-lifecycle.test.ts` at CLI level |
| Blocking release-gate failures refuse the run | every `blocking && !passed` gate becomes a `GATE` refusal | `benchmark-execution-binding.test.ts` (stale-adjudication corpus validates and matches its manifest yet is still refused) |
| Non-blocking provenance warnings disclosed clearly | failing non-blocking gates carried in `warnings`, printed by the harness, recorded in the receipt | `benchmark-execution-binding.test.ts` ("disclosed but never blocks"); `benchmark-execution-lifecycle.test.ts` (legacy unbound case) |

## 3. `benchmark-run-record-v1`

| Requirement | Implementation | Check |
|---|---|---|
| Deterministic receipt binding release id, manifest SHA-256, corpus hash, report hash, case count | `buildRunRecord` + `runRecordText` (canonical, code-unit sorted) in `execution.ts`; `--run-record` publishes it atomically | `benchmark-run-record.test.ts` (determinism, two-identity semantics); `benchmark-execution-lifecycle.test.ts` (receipt agrees with the report actually on disk) |
| Applicable case, report, methodology, metrics and evidence-rule versions | `versions` taken from the corpus and `report.ts`/`core/versions.ts`; evidence rule recorded as the version in force, never the proposal | `benchmark-run-record.test.ts` asserts `evidence-aggregation-v1` explicitly and a mixed v1/v2 corpus lists both |
| Optional explicitly supplied source revision, never fabricated | `--source-revision` stored verbatim; `null` otherwise; no git call, no `.git` read, no clock | `benchmark-run-record.test.ts` (`sourceRevision === null` unless supplied); `benchmark-execution-lifecycle.test.ts` (unbound run records null; round-trip of a supplied value) |
| No clock, path, hostname or environment value | pure layer; a schema-level test forbids fields named for time, place or host | `benchmark-run-record.test.ts` ("contains no clock, path, hostname or environment value") |

## 4. Reproducible verification

| Requirement | Implementation | Check |
|---|---|---|
| A command verifies a receipt and replays its report against the same verified release | `scripts/benchmark-verify.ts` (`npm run benchmark:verify`) re-reads through the bounded loader, re-binds, re-scores via the shared `composeRunReport`, and calls `verifyRunRecord` | `benchmark-verify-record.test.ts`; `benchmark-execution-lifecycle.test.ts` ("a verified run replays clean") |
| Tampering detected | `verifyRunRecord` compares manifest bytes, release id, corpus hash, both report hashes, case count, each version and the revision | `benchmark-execution-lifecycle.test.ts` eleven-field tamper matrix; corpus and report tampering |
| Stale manifest detected | `releaseManifestProblem` refuses a wrong version or malformed digests before comparison | `benchmark-execution-lifecycle.test.ts` ("a manifest from another contract version is refused") |
| Mismatched output detected | content disagreement is a failure; a text-only difference on replay is a note; a text difference in a **stored** artifact is a failure | `benchmark-verify-record.test.ts` ("a reformat alone is only noted" on replay); the tamper matrix proves a receipt-only `reportTextSha256` edit cannot pass against the stored file |
| Incomplete artifacts detected | `INCOMPLETE-ARTIFACT` when a receipt names a manifest or report that was not supplied or cannot be read | `benchmark-execution-lifecycle.test.ts` ("bound receipt checked without its corpus"); `benchmark-verify-record.test.ts` |

## 5. Artifact publication hardening

| Requirement | Implementation | Check |
|---|---|---|
| Report writing, release snapshots and every CLI output path hardened | `scripts/artifact-io.ts` is the only writer; report, manifest, snapshot, scaffold, normalise, packet, `adjudicate --issue`, receipt and the batch journal all route through it | `benchmark-artifact-io.test.ts`; `benchmark-publication-cli.test.ts` |
| No partial artifact | `publishFile` = temp write + `renameSync`; `publishDirectory` = name checks, digest re-verification, collision refusal, staging, then per-file publish with rollback that deletes created files and restores replaced ones, leaving non-files alone | `benchmark-artifact-io.test.ts` ("refuses before touching anything", two rollback tests, "does not delete a target that is not a regular file") |
| No silent overwrite | existing target refused naming its sha256 unless `--overwrite`; a replaced digest is always reported; an identical target is left alone and said | `benchmark-artifact-io.test.ts`; `benchmark-publication-cli.test.ts`; `benchmark-execution-lifecycle.test.ts` |
| Interruption and failure paths tested | failure injected by placing a directory where a target file must go — deterministic on Windows and POSIX | `benchmark-artifact-io.test.ts`; v0.7's batch `--recover` suite still passes unedited |

## 6. Compatibility preserved

| Requirement | Implementation | Check |
|---|---|---|
| `benchmark-case-v1`/`v2`, `benchmark-report-v2`, status enums, legacy submissions and historical outputs readable | no contract change; report gains no field and reorders no key; manifest reader added without a new version | `benchmark-report-compatibility.test.ts` (digest pinned from merged v0.7 output), `benchmark-v06-compatibility.test.ts` |
| Existing digest fields not repurposed; new SHA-256 identities introduced where needed | `caseDigest` and `CorpusDigest.digest` unchanged; `sha256Hex` and `contentHash` feed only the receipt | `benchmark-report-compatibility.test.ts` asserts every stored digest is still 16 hex; `benchmark-run-record.test.ts` |
| Versioned artifacts where a new identity was needed | `benchmark-run-record-v1` in `types.ts`, distinct from every other artifact version | `benchmark-contracts.test.ts` |
| The two deliberate behaviour changes recorded | unified per-file ceiling; refuse-existing-target default | ADR-028; §12 of [Known Limitations](../KNOWN_LIMITATIONS.md); `benchmark-corpus-io-cli.test.ts` |

## 7. Governance and honesty

| Requirement | Implementation | Check |
|---|---|---|
| Stale README, status, roadmap and architecture statements corrected | README, `IMPLEMENTATION_STATUS.md`, `IMPLEMENTATION_ROADMAP.md`, `MODULE_BOUNDARIES.md`, `LOCAL_CORE_ARCHITECTURE.md`, `KNOWN_LIMITATIONS.md`, `TESTING.md`, `ADR_INDEX.md` | `docs-links.test.ts`; each figure re-measured in this checkout rather than copied |
| v0.7 session report gets a post-merge addendum, not a rewrite | append-only section at the end of the v0.7 report | reviewed by inspection; the rest of the file is byte-identical |
| ADR-028 created for the genuine contract decisions | `ADR-028-release-bound-execution-and-artifact-identities.md`, **Proposed**, not owner-accepted | `docs-links.test.ts` requires the index row that lists it |
| Offline, local-only, nothing invented, `accuracyClaimable` false | no network or provider code; receipt and manifest carry the false literal and the reason; symlinks/ceilings reject, never repair | `no-network.test.ts`; `benchmark-run-record.test.ts`; `benchmark-release.test.ts` |

## 8. Not claimed by this milestone

No accuracy figure, no reviewed corpus, no real reviewer, no published registry entry, no signature, and no
owner acceptance. A receipt proves that a build scored a corpus into a report; it is not evidence that the
evaluator is right, and the symlink refusal could not be demonstrated on the Windows development host — that
single test reports itself skipped there and runs on the Linux and macOS CI jobs.
