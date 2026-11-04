# v0.8 — Release-Bound Benchmark Execution and Corpus I/O Hardening

**Status:** accepted design, implemented on this branch. The owner-approved decisions are recorded in
ADR-028 (`docs/agents/adrs/ADR-028-release-bound-execution-and-artifact-identities.md`, added later in this
same milestone), which remains **Proposed and not owner-accepted**.

**Baseline:** local core v0.7, merged to `main` at `e72e77a` (PR #10). Verified before editing: local
`main` was stale at `2b1ecab`, `origin/main` was `e72e77a`, and the merged tree was green at 956 tests.

## 0. What this document decides

| Area | Decision |
|---|---|
| Corpus ingestion | One bounded loader in `scripts/corpus-io.ts`, used by all three benchmark CLIs |
| Execution binding | `npm run benchmark -- --release <manifest>` verifies the release **before** scoring |
| Run receipt | New artifact `benchmark-run-record-v1`, deterministic, clock-free, content-hashed |
| Reproducibility | New command `npm run benchmark:verify` re-verifies the release and replays the report |
| Publication | Atomic temp+rename everywhere, refuse-an-existing-target default, staged directories |
| Report contract | `benchmark-report-v2` stays **byte-frozen**; the receipt is what binds a run to a release |

Everything stays local and offline: no network, no provider, no database, no clock, no machine identity.
`accuracyClaimable` remains `false` in every artifact this milestone writes.

## 1. Defects reproduced before fixing

Each of these was reproduced against the merged v0.7 tree with a throwaway probe (deleted after use), not
inferred from reading code.

1. **A case id escapes the output directory.** `id` was only checked for non-empty and length, and every
   writer built a file name as `` `${id}.json` ``. A case with id `../../../../pwned` validated cleanly
   (zero issues), `normalise` exited `0`, left its `--out` directory **empty**, and wrote a canonical case
   file outside the corpus, outside `--out`, and outside the probe's temporary root. The same shape exists
   in `packet`, `freeze --snapshot`, and the batch `publishFile` path — and `batch.ts` documented "names are
   bare" without enforcing it.
2. **A hostile directory entry crashes instead of refusing.** The shared loader never stat'd its entries. A
   subdirectory named `nested.json` produced a raw `EISDIR` and `benchmark:case validate` printed a stack
   trace to the operator, while `npm run benchmark` — with its own private loader — silently skipped the
   same entry. Two loaders, opposite behaviour, one corpus.
3. **Reads are unbounded on two of three paths.** A 1,093,691-byte file holding 600 bundled cases: the
   harness refused it (`per-file limit`), `benchmark:release gates` parsed all of it and reported "600 valid
   case(s)". The harness also used `maxCases` (5000) as its *file-count* ceiling, a limit that does not
   describe files.
4. **Existing artifacts are destroyed without a word.** A pre-existing report file and a pre-existing
   release manifest were both silently overwritten by plain `writeFileSync`, with no warning and no
   rollback. The manifest is the file every later verification trusts.
5. **Report bytes depend on collation.** `serialiseBenchmarkReport` sorts keys with `localeCompare`. The
   same report object serialises differently under code-unit ordering — first divergence at
   `statement.structuralReadiness`, `subjectsWithout` versus `subjectsWithTwoDistinctReviewers`. A replay
   that compares bytes is therefore only as stable as the ICU build it ran on.
6. **Execution is not bound to any release.** `--release` and `--run-record` were unknown arguments, and
   `BenchmarkReport` carries no release or manifest field: a report could not say which frozen corpus it
   measured.
7. **Symlink following is real in code, unproven here.** `statSync` follows symlinks, so a link named
   `x.json` would read a file outside the corpus. `symlinkSync` fails with `EPERM` on this machine (no
   developer mode), so this is stated as a design requirement plus a test that skips explicitly when the
   platform will not create a link — it is verified on the Linux/macOS CI jobs, not on Windows.

## 2. Boundaries

In scope: corpus loading, release-bound scoring, the run receipt, receipt verification and replay, artifact
publication, the compatibility ledger, and the governance corrections in §7.

Out of scope, deliberately: any network or provider call, database-backed review, authentication,
accepting ADR-025/026/027 on the owner's behalf, flipping the `evidence-aggregation-v1` default, generating
cases, labels, reviewers, timestamps or accuracy figures, and any change to the scored report's schema.

## 3. Unified, bounded corpus ingestion

`scripts/corpus-io.ts` owns one read path and `scripts/benchmark.ts`'s private 57-line loader is deleted.
Every benchmark CLI — `benchmark`, `benchmark:case`, `benchmark:release` — and every directory argument
(`--corpus`, `--submissions`, `--adjudications`) goes through it, so "unreadable" means one thing.

Order of operations, all before any content is parsed:

1. `readdirSync` the directory; unreadable → typed `directory` refusal.
2. Keep `*.json` names, sorted by code unit so the order never depends on locale.
3. `lstatSync` each entry: a **symlink** → `symlink` refusal; anything that is not a regular file → `type`
   refusal (the `nested.json`-directory crash is over).
4. `maxFiles` bound on the entry count; `maxCaseBytes` per file; `maxCorpusBytes` cumulative. Each is
   checked against `stat` size, so an oversized file is never read.
5. Read, then parse; a parser depth failure → `depth` refusal naming the file.
6. Flatten top-level arrays in file order, assigning a global `index`, so one file may hold one case or many.

`CorpusReadError.kind` becomes `'directory' | 'json' | 'symlink' | 'type' | 'count' | 'size' | 'depth'`,
and the message always names the file and the limit. Callers convert a typed error into a printed refusal;
no path may print a stack trace.

**Limits are the ones already documented.** Per Q2, no bound is loosened: `maxFileBytes` is not invented,
`maxCaseBytes: 262144` remains both the per-case ceiling and the per-file read ceiling, and `maxFiles: 5000`
replaces the misapplied `maxCases` in the file-count check with a limit that actually describes files, set to
the same 5000 so the harness's existing behaviour is preserved exactly. `maxNestingDepth: 64` names the
canonicaliser's existing bound instead of leaving it implicit. `benchmark:case` and `benchmark:release`
therefore become **stricter** where they were unbounded; a corpus that only the harness used to refuse is now
refused identically everywhere, with the same words.

Case-count (`maxCases`) and duplicate-id refusal stay in `validateBenchmarkCorpus`, because those are
statements about content, not about reading.

The directory named by `--corpus` is the operator's own choice and is not second-guessed; what is refused is
an *entry inside it* that points elsewhere. Rejecting the entry, rather than silently skipping it, is the
point: a skipped entry would let a corpus quietly contain fewer cases than its operator believes.

## 4. Release-bound execution

`src/benchmark/execution.ts` is pure: `node:crypto` and sibling benchmark/core modules only, no filesystem.

**`releaseManifestProblem(parsed)`** (pure, in `execution.ts`, so `benchmark` and `benchmark:verify` cannot
disagree about what a readable manifest is) refuses a file that is not an object, has no
`benchmark-release-manifest-v1` version, has a non-array `cases`, or carries a `corpusHash`/`releaseId` that
is not the shape this build writes. That is the stale-manifest case: a manifest from another contract is
never scored against. The CLI keeps only the typed read of the bytes and hands the parsed value to this
function.

**`bindRunToRelease(manifest, cases, validation, manifestText)`** returns `{ ok, refused, warnings, releaseId,
corpusHash, manifestSha256 }`. `refused` is non-empty — and the run exits non-zero **before scoring** — for:

- a manifest version this build does not recognise;
- any `verifyRelease` finding: `added`, `removed`, `changed`, `duplicateCaseIds`, `contractDrift`;
- any corpus validation issue (an invalid case, including one that fails the new id rule);
- any **blocking** release gate failure.

`warnings` carries the **non-blocking** gates verbatim (`allAdjudicationsBound`, `strataCovered`) plus
`notReleaseBound` when `--release` was omitted. A warning is printed, recorded in the receipt, and never
converted into a pass or a refusal.

`manifestSha256` is `sha256Hex` of the manifest **bytes as read** — a new full SHA-256 identity. It is not
the 16-hex truncated file digest in `CorpusDigest`, and not the 16-hex FNV `caseDigest`; both keep their
existing meaning untouched (Q: "do not silently repurpose existing digest fields").

Without `--release`, the harness behaves exactly as it does today. That is required for compatibility: CI
step 17 and every documented invocation run an unbound corpus. The receipt then says
`releaseId: null, manifestSha256: null` and carries `notReleaseBound: true` — an absence stated, not
invented.

## 5. `benchmark-run-record-v1`

```ts
{
  version: 'benchmark-run-record-v1',
  algorithm: 'sha256-canonical-v1',
  producedBy: 'npm run benchmark',
  releaseId: string | null,
  manifestSha256: string | null,
  manifestLabel: string | null,
  corpusHash: string | null,
  reportSha256: string,        // canonical content hash — environment-independent
  reportTextSha256: string,    // exact bytes this build wrote
  caseCount: number,
  versions: {
    caseContractVersions: readonly string[],   // as present in the corpus
    reportVersion: string,                     // benchmark-report-v2
    methodologyVersion: string,                // from core/versions.ts
    metricsVersion: string,
    evidenceRuleVersion: string,               // the rule in force, not a proposal
  },
  warnings: { notReleaseBound: boolean, unboundAdjudications: number,
              strataMissing: readonly string[], gateNotes: readonly string[] },
  sourceRevision: string | null,
  accuracyClaimable: false,
  note: string
}
```

`warnings.unboundAdjudications` is counted from the validated cases through the existing
`review.disagreementReport`, the same shared binding resolver v0.7 introduced — not read out of the manifest.
That keeps the number identical whether or not the run was release-bound, so an unbound run cannot report a
different provenance figure for the same corpus than a bound one.

Determinism rules: no clock, no path, no hostname, no environment variable. The record is serialised through
the shared canonicaliser, so the same run over the same corpus produces the same bytes on any machine.

`sourceRevision` is **only** what the operator explicitly passes as `--source-revision <text>`; absent it is
`null`. The tool does not shell out to git, does not read `.git`, and does not infer a revision — a recorded
commit that the tool invented would be the most misleading field in the artifact. The note says so.

`reportSha256` is the canonical content hash, per Q1. Chosen because §1.5 proved the serialised text order
depends on collation: comparing content identity makes replay verification stable while leaving
`benchmark-report-v2` **byte-frozen** — no new fields in the report at all. The binding lives in the receipt,
whose `reportSha256` names the exact report it describes. `reportTextSha256` is recorded beside it so a
reader can tell "different bytes, same content" from "different content".

## 6. Reproducible verification

`scripts/benchmark-verify.ts`, npm script `benchmark:verify`:

```
npm run benchmark:verify -- --record <file> [--manifest <file>] [--report <file>]
                            [--corpus <dir>] [--overwrite] [--out <file>]
```

It reads the receipt (bounded, typed), re-reads the manifest and corpus through the same loader, re-runs the
binding, replays scoring, rebuilds and serialises the report, and compares:

| Check | Refusal |
|---|---|
| Manifest bytes hash vs `manifestSha256` | `MANIFEST TAMPERED` |
| Corpus hash vs `corpusHash` | `CORPUS DRIFTED` |
| Release binding | the §4 refusal list, verbatim |
| Report canonical hash vs `reportSha256` | `REPORT CONTENT MISMATCH` |
| Report text hash vs `reportTextSha256`, when content agrees | `serialisation-order difference only` — reported, not a failure |
| Case count / every applicable version | `VERSION DRIFT` naming the field |
| A required input file missing or unreadable | `INCOMPLETE ARTIFACT` naming the path |

Tampering with any single field of a receipt is therefore detected, and the message says which field moved to
what value. Exit is non-zero on any refusal; warnings are printed with the same integrity and accuracy
language as the release commands.

## 7. Artifact publication hardening

`scripts/artifact-io.ts` is the only place a benchmark artifact reaches the disk.

- **`safeArtifactName(id)`** — per Q3, refused in **both** layers: `validateBenchmarkCase` reports an issue
  for an id containing `/` or `\`, a control character, `.`/`..`, or a trailing dot or space (a case id
  becomes a file name in every publication path, so an id that cannot be one is not a valid identifier); and
  every writer runs the name through `safeArtifactName` and refuses rather than letting `join` resolve a
  `..`. Writers cover `normalise`, `packet` (`.packet.json` + `.submission.json`), `freeze --snapshot`, and
  the batch `publishFile`.
- **`publishFile(target, text, { overwrite })`** — write `<target>.tmp`, `renameSync` over the target
  (atomic replace on Windows, Linux and macOS). Per Q4, an **existing target is refused by default** with a
  message naming the path and the digest it holds; `--overwrite` opts in explicitly and reports the replaced
  digest. Applied to `benchmark --out`, `freeze --out`, `scaffold --out`, and run-record writing.
- **`publishDirectory(target, files, { overwrite, label })`** — stage into `<target>.staging/`, write a
  journal recording each file's content hash, then publish file by file. Any failure rolls back to the
  journal; a later run with `--recover` completes or discards the interrupted batch. Same journal semantics
  already proven for batch merges in v0.7, now shared instead of duplicated.
- No publication path may leave a partial artifact behind on refusal, and none may silently replace one.

## 8. Compatibility ledger

| Artifact | Effect |
|---|---|
| `benchmark-case-v1`, `benchmark-case-v2` | Unchanged. Read as before; no migration, no new required field. |
| `benchmark-report-v2` | **Byte-frozen.** No field added or reordered; a pin test asserts v0.7 key order and the `status` enum are intact. |
| Existing digest fields | `caseDigest` (FNV 16-hex) and `CorpusDigest.digest` (truncated SHA-256) keep their exact meaning. New identities use full SHA-256 and live only in the receipt. |
| Legacy submissions / adjudications | Still readable; unbound records still disclose as `UNBOUND` and fail the non-blocking gate, never credited as provenance. |
| `benchmark-release-manifest-v1` | Unchanged shape. §4 adds a *reader* contract: a manifest whose version is not this one is refused. |
| `npm run benchmark` | Additive flags (`--release`, `--run-record`, `--source-revision`, `--overwrite`). Without them, behaviour is what v0.7 shipped, except that hostile input now refuses with typed words instead of a stack trace or silence. |
| `benchmark:case`, `benchmark:release` | Gain the missing read bounds (§3) and refuse unsafe ids/existing targets. Stricter, never looser. |
| Two deliberate behaviour changes | (a) a >256 KiB file is refused by *all three* CLIs, not one; (b) an existing output target is refused unless `--overwrite`. Both recorded in ADR-028 and `KNOWN_LIMITATIONS.md`. |

## 9. Honesty constraints

A manifest digest and a receipt hash are integrity checks over recorded content. A receipt proves that *this
build scored this corpus and produced this report*; it does not prove that the material is genuine, that two
reviewer names are two people, or that any reviewer existed. Binding execution to a release makes a result
auditable; it does not validate the evaluator. `accuracyClaimable` is the literal `false` in the report, the
manifest, and the receipt, and nothing in §3–§7 changes it. Nothing here generates a case, label, reviewer,
timestamp, source revision or permission.

## 10. Testing

- **Unit:** each loader refusal (count, size, total, type, symlink, depth) with a typed `kind` and a message
  naming the file; deterministic ordering; unsafe-id refusal; manifest shape refusal; the full binding matrix
  (each `verifyRelease` finding, invalid case, each blocking gate, each non-blocking warning); receipt
  determinism across two builds of the same input; `verifyRunRecord` mismatch classification incl. the
  text-only case. Report bytes are pinned against a golden serialisation captured from the **merged v0.7 code
  path over the synthetic fixture corpus** before any v0.8 edit, recorded in the test as exactly that — there
  is no real reviewed report to pin against, and pretending otherwise would be a fabricated baseline.
- **Integration:** the complete lifecycle `benchmark:case` → `packet` → `merge` → `adjudicate` →
  `benchmark:release freeze` → `benchmark --release --run-record` → `benchmark:verify`; tampering with each
  receipt field; corpus drift after a freeze; unbound-vs-bound manifest refusal; existing-target refusal and
  `--overwrite`; interrupted directory writes with rollback and byte-identical resume; symlink refusal
  (skipping explicitly, and saying so, where the platform refuses to create a link); historical artifacts
  still readable.
- **Suite-wide:** `npm run check`, `npm run verify:workflow`, `npm run benchmark`, and the Node 24
  Ubuntu/Windows/macOS CI matrix on the final head.

## 11. Governance corrections in this milestone

- `README.md`: "v0.7 … on a feature branch with an open pull request" → merged at `e72e77a`; add the v0.8
  status and the new commands.
- `docs/product/IMPLEMENTATION_ROADMAP.md`: the v0.7 note says "in progress — PR open, not merged" → merged.
- `docs/IMPLEMENTATION_STATUS.md`: 13 rows reading "Implemented / Validated (not merged)" → merged, plus the
  v0.8 section.
- `docs/agents/ADR_INDEX.md`: ADR-027 credited with 945 tests; the merged build runs 956 → corrected, plus
  the ADR-028 row.
- v0.7 session report: a **post-merge addendum** appended at the end, never a rewrite of what it recorded.
- `docs/technical/MODULE_BOUNDARIES.md`, `LOCAL_CORE_ARCHITECTURE.md`, `SYSTEM_ARCHITECTURE.md`,
  `docs/evaluator/BENCHMARKING_AND_VALIDATION.md`, `docs/operations/LOCAL_RUNBOOK.md`, `docs/TESTING.md`,
  `docs/KNOWN_LIMITATIONS.md` and a `V08_REQUIREMENTS_TRACEABILITY.md` bring the rest of the record in line.
