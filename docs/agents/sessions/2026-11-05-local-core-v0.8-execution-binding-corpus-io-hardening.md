# Agent Session Report — 2026-11-05 — Local Core v0.8: Release-Bound Benchmark Execution and Corpus I/O Hardening

## 1. Session metadata

- Date: 2026-11-05
- Milestone: local core v0.8
- Branch: `feat/aporia-v0.8-execution-binding-corpus-io-hardening`
- Baseline: `main` at `e72e77aff6fa8e27d2b10a42920f53712a9cda98` (merged v0.7, PR #10)
- Environment: Windows 11 (25H2) x64, Node v24.13.1, npm 11.8.0, PowerShell 5.x
- Design: [Release-Bound Benchmark Execution and Corpus I/O Hardening](../../technical/BENCHMARK_EXECUTION_BINDING_AND_CORPUS_IO_HARDENING.md)
- Decision record: [ADR-028](../adrs/ADR-028-release-bound-execution-and-artifact-identities.md) — **Proposed, not owner-accepted**
- Plan: [2026-11-05 v0.8 implementation plan](../../superpowers/plans/2026-11-05-v0.8-execution-binding-and-corpus-io-hardening.md)
- Traceability: [v0.8 requirements traceability](../../product/V08_REQUIREMENTS_TRACEABILITY.md)

## 2. Objective and scope

Make the corpus release v0.7 created actually govern a benchmark run, and harden the file handling a review
workflow depends on. Seven requirements from the owner: unify corpus ingestion under one bounded loader; bind
execution to a `benchmark-release-manifest-v1` and verify before scoring; introduce
`benchmark-run-record-v1`; add reproducible verification and replay; harden artifact publication; preserve
v1/v2 case and report-v2 compatibility without repurposing digest fields; and correct repository governance.

Out of scope, and untouched: providers, network, crawling, remote publishing, authentication, billing,
multi-tenancy, database-backed review, accepting ADR-025/026/027, flipping the `evidence-aggregation-v1`
default, and inventing any case, review, reviewer, timestamp, source revision or accuracy figure.

## 3. Initial state

Verified before editing rather than trusted: local `main` was stale at `2b1ecab`, `origin/main` had moved to
`e72e77a`, and PR #10 was confirmed merged. Local `main` was fast-forwarded and the branch created from the real
`e72e77a`. Baseline `npm run check`: **exit 0, 956 tests, 956 passing, 0 failing**; `npm run verify:workflow`
exit 0 with 25 passed / 0 failed / 0 not-run.

A throwaway probe against that tree (run, reported, then deleted) reproduced every defect below. One probe
artifact escaped its own sandbox and was found and removed; nothing outside the repository was left modified.

| # | Reproduced defect | Evidence |
|---|---|---|
| 1 | Case id escapes the output directory | id `../../../../pwned` → 0 validation issues, `normalise` exit 0, `--out` left **empty**, a 2478-byte canonical case written to `C:\Users\Ram\AppData\` — outside corpus, `--out` and the probe's temp root |
| 2 | Hostile entry crashes | subdirectory `nested.json` → raw `EISDIR`; `benchmark:case validate` printed a stack trace; `npm run benchmark` silently skipped the same entry |
| 3 | Unbounded reads | 1,093,691-byte / 600-case bundle: harness refused, `benchmark:release gates` parsed it and reported "600 valid case(s)"; harness also used `maxCases` as its *file* ceiling |
| 4 | Silent destruction | pre-existing report **and** pre-existing manifest both destroyed by `writeFileSync`, no warning, content gone |
| 5 | Collation-dependent report bytes | same report serialises differently under code-unit ordering, first divergence `subjectsWithout` vs `subjectsWithTwoDistinctReviewers` |
| 6 | No release binding | `--release` / `--run-record` unknown arguments; `BenchmarkReport` has no release or manifest field |
| 7 | Symlink following | real in code (`statSync` follows links); **not reproducible here** — `symlinkSync` fails `EPERM` on this host, so it is implemented, tested, and skipped out loud on Windows |

## 4. Changes made

**Ingestion.** `scripts/corpus-io.ts` is now the only reader for corpus directories and artifact files:
`lstatSync` classification (symlink and non-regular entries refused by name), code-unit ordering, `maxFiles` /
`maxCaseBytes` / `maxCorpusBytes` applied to the stat size before reading, a `maxNestingDepth` refusal naming the
ceiling, a typed `CorpusReadError.kind`, and a byte-order-mark tolerant parse. The harness's private 57-line
loader was deleted; `benchmark:case`, `benchmark:release` and the new `benchmark:verify` all go through it.

**Identifiers.** `src/benchmark/naming.ts` holds one rule for an id that becomes a file name, enforced by the
validator (`validateBenchmarkCase`) and by every writer (`safeArtifactName`; `renderStagedCorpus` throws
`UnsafeCaseNameError`, which the batch CLI prints as a refusal on both the fresh and the recovery path). A refusal
never renames.

**Publication.** `scripts/artifact-io.ts` is the only writer: `publishFile` (temp + `renameSync`, refuse an
existing target naming its sha256 unless `--overwrite`) and `publishDirectory` (names checked, planned digests
re-verified, collisions refused before staging, staged publish, rollback that deletes created files and restores
replaced ones while leaving non-files alone). Wired into the report, the run record, the manifest, `--snapshot`,
`scaffold`, `normalise`, `packet`, `adjudicate --issue`, and — as `atomicReplaceFile` — the batch's own publishes
and journal writes.

**Execution and receipt.** `src/benchmark/execution.ts` (pure) provides `releaseManifestProblem`,
`bindRunToRelease`, `buildRunRecord`, `runRecordText`, `runRecordProblem`, `verifyRunRecord` and
`composeRunReport`. `npm run benchmark` gained `--release`, `--run-record`, `--source-revision` and
`--overwrite`; `npm run benchmark:verify` is new. `benchmark-report-v2` was deliberately **not** changed: no
field added, no key reordered, digest pinned.

**Governance.** README, `IMPLEMENTATION_STATUS.md` (header, 13 stale rows, v0.8 matrix), roadmap, ADR index
(ADR-028 row + the 945→956 correction), `MODULE_BOUNDARIES.md`, `LOCAL_CORE_ARCHITECTURE.md`, `KNOWN_LIMITATIONS.md`
(§12), `TESTING.md`, `docs/README.md`, the v0.7 report's append-only addendum, and this report. ADR-028 recorded
as **Proposed**.

## 5. Decisions and ADRs

Four owner decisions, all recommended options, taken before implementation and recorded in ADR-028:

1. **Report identity.** `benchmark-report-v2` bytes stay frozen; the receipt records the canonical content hash
   *and* the exact-text hash. Chosen so stored reports remain comparable and cross-OS verification still works.
   Rejected: switching `sortKeys` to code-unit order, which would change the bytes of already-stored v2 reports.
2. **Corpus limits.** Reuse the existing ceilings; `maxFiles` set to the 5000 the harness already applied. The
   commands with no bound became as strict as the one that had one. Rejected: a larger `maxFileBytes`, which would
   loosen a documented harness bound.
3. **Unsafe ids.** Refused in the validator **and** at write time. Rejected: writer-only refusal.
4. **Existing targets.** Refused unless `--overwrite`. Rejected: always-overwrite with a post-hoc digest.

Two deviations from the plan, both made on evidence and recorded here: the plan's task order for `naming.ts` and
the validator rule was inverted (the shared predicate has to exist before both callers), and the plan's Task 18
assumption that the batch path should also refuse existing targets was **wrong** — a merge commits a corpus of
record and replaces cases deliberately, so the batch shares only the atomic primitive. The plan also listed
`--out`/`--overwrite` on the verify command; that command writes nothing, and the spec was corrected to match
rather than inventing an artifact the design never justified.

Defects found *while implementing*, each fixed with a test that had failed first:

- `renderStagedCorpus` documented "names are bare" since v0.7 and never checked it.
- A `normalise` refusal printed a count of refused entries and no reasons, so an operator had to bisect the
  corpus to learn which case was disliked.
- `publishDirectory` initially treated "exists but is not a regular file" as "absent", which would have let a
  rollback **delete the operator's directory**. Fixed with an explicit prior-state union; the guard is tested.
- The receipt path, unlike the report and manifest paths, did not report the digest it displaced on
  `--overwrite`.
- **A receipt with a tampered `reportTextSha256` verified clean**, because a text mismatch was downgraded to a
  note whenever content agreed. Found by the eleven-field tamper matrix. Stored artifacts must agree byte for
  byte with the receipt naming them; only a *replay* may treat a reformat as a note.
- One commit was made without running `format:check` and left the gate red; repaired in an explicit following
  commit rather than folded silently into another change.

## 6. Validation

Measured in this checkout, not copied from a document. Full numbers, exact:

| Check | Result |
|---|---|
| `npm run check` | exit 0 |
| `npm test` | 1073 tests, 1072 passing, 0 failing, 1 skipped |
| `tests/unit` glob | 681 tests, 681 passing |
| `tests/integration` glob | 392 tests, 391 passing, 1 skipped |
| `npm run typecheck` / `lint` / `format:check` / `check:boundaries` | pass; "Module boundaries are clean." |
| `npm run verify:workflow` | exit 0, 25 steps passed, 0 failed, 0 not-run |
| `npm run benchmark` | pass on the isolated fixture corpus (workflow step 17) |
| Release-bound CLI lifecycle | `packet → merge → adjudicate → freeze → benchmark --release --run-record → benchmark:verify`, then tampering the corpus, the report and eleven receipt fields — every refusal named its kind, no stack trace anywhere |

The one skip is `a symlink in the corpus is refused…`: this host cannot create a symlink (`EPERM` without
developer mode), so the test prints that reason and skips. The refusal itself is code and the test executes on the
Linux and macOS CI jobs. It is recorded as skipped, not as passing.

New suites: `benchmark-report-compatibility`, `benchmark-corpus-limits`, `benchmark-corpus-io`,
`benchmark-corpus-io-cli`, `benchmark-naming`, `benchmark-artifact-io`, `benchmark-execution-binding`,
`benchmark-run-record`, `benchmark-verify-record`, `benchmark-publication-cli`, `benchmark-execution-lifecycle`.
The v0.6 and v0.7 suites were kept; the single pre-existing expectation that changed was a manifest-error
message, updated because the refusal became specific while its guarantee (refused, never thrown) stayed.

## 7. Evidence and external sources

No external source was used and no network call was made; `no-network.test.ts` still passes. Every defect in §3
is a reproduced observation, not an inference from reading code or from the previous session report. No figure in
this report is estimated: test counts came from running the globs, workflow counts from its own summary line, and
the report byte-pin from the merged v0.7 code path over a synthetic fixture — recorded as exactly that, because
no real reviewed report exists to pin against.

## 8. Risks and limitations

Full list in [Known Limitations §12](../../KNOWN_LIMITATIONS.md). The ones that matter for a reader of this
milestone:

- A receipt proves that a build scored a corpus into a report. It authenticates nobody and validates nothing
  about genuineness; `accuracyClaimable` is the literal `false` in the report, the manifest and the receipt.
- `--release` is opt-in, so an unbound run remains possible; it is labelled `NOT RELEASE-BOUND`, not hidden.
- `benchmark-report-v2` still serialises with locale collation. That is a deliberate compatibility cost, and the
  reason verification uses the canonical content hash.
- Symlink refusal is unverified on the Windows development host and must be read as "not demonstrated locally".
- Two behaviours changed: one per-file ceiling across all three commands, and refuse-an-existing-target.
  Automation that assumed either now exits non-zero.
- Directory rollback is best-effort against I/O failure; a process killed at the wrong instant can leave a staged
  directory, which the next run reports rather than silently reuses.
- Every corpus here is synthetic. No release, binding, receipt or verification has ever been exercised on genuine
  reviewed material, because none exists.

## 9. Commit and publication

Commits on this branch, from `main` at `e72e77a`: **39** at the time of writing this section, each an
independently reviewable unit; the authoritative count is `git rev-list --count e72e77a..HEAD`, quoted in the
pull request and updated below when CI finishes.

The ledger is the branch log; representative boundaries: `5e0fd83` design, `ed4d70a` plan, `f6014c0` the v0.7
byte-pin taken **before** any code edit, `ae4baad`…`780a5e8` the bounded loader, `795969b`…`6ae2aeb` identifiers,
`3b3e767`…`2cc21eb` publication, `b195beb`…`0ead024` binding, receipt and verification, `d47193b` the
compatibility ledger, then documentation. No empty, cosmetic or artificially split commit was made, and the one
`style:` commit exists because it repaired a gate this session broke.

Pushed as green checkpoints; no force-push, nothing pushed to `main`. Pull request:
**https://github.com/bhogesararam23/aporia-ai-evaluator/pull/11** — confirmed via `gh pr view 11` as state
**OPEN**, `mergedAt: null`, 39 commits, base `main`. It is deliberately **not merged**.

### CI evidence, observed through `gh run view`

At head `712e0fb` (the session report and index commit), both workflows completed with **all six jobs green**.
Job durations are quoted only for the run where `gh run view` printed them; the push run is recorded with the
completion timestamps it actually reported, without inventing elapsed times:

| Run | Event | Result |
|---|---|---|
| `41958164087` | pull_request (PR #11) | 6/6 success — `check` ubuntu 1m8s, windows 1m54s, macos 1m55s; `live workflow` ubuntu 33s, windows 1m14s, macos 49s |
| `41958079170` | push | 6/6 success — `check` ubuntu completed 02:55:06Z, windows 02:55:42Z, macos 02:54:57Z; `live workflow` ubuntu 02:56:38Z, windows 02:56:54Z, macos 02:56:48Z |

Earlier push runs on the same branch were also green, including `41953455732` at `0ead024` (3m37s), which is the
head where the last production code landed; everything after it is documentation. The only CI annotations are
platform notices — `actions/checkout@v4` / `actions/setup-node@v4` still targeting deprecated Node 20, and the
upcoming `ubuntu-latest` image migration — neither a test failure. That tooling deprecation is queued as a
separate, non-functional PR (see §10) rather than folded into this milestone.

A final documentation commit lands after these rows, so the appendix below records the run for the actual branch
head; no job is reported as finished before it finished.

## 10. Handoff

Owner decisions this milestone needs:

1. ADR-028's three open questions: whether an identical-bytes re-run should also require `--overwrite`; whether
   `--release` should become mandatory for any report kept as evidence (which would require a first real release
   and a change to CI step 17); and whether the report should eventually freeze a code-unit key order as
   `benchmark-report-v3` instead of carrying two identities.
2. ADR-025, ADR-026 and ADR-027 remain unaccepted; ADR-028 joins them. Nothing here was accepted on the owner's
   behalf.
3. The blocking work is still the same: produce a real reviewed corpus through `benchmark:case`, freeze it, run it
   bound, and keep the receipt. Until then no accuracy figure exists, and none should be quoted from this
   milestone.
4. Queued engineering follow-ups, not started: publish-time locking so two operators cannot write the same output
   concurrently; an incremental release export; and a tooling-only PR for the Node-20-deprecated
   `actions/checkout@v4` / `actions/setup-node@v4`.

## 11. Integrity statement

Every claim in this report is backed by a check that ran in this checkout or by a command quoted in §9. Nothing
was invented: no case, reviewer, label, timestamp, source revision, corpus or accuracy figure. Where something
could not be verified on this machine — the symlink refusal — it is recorded as unverified here rather than as
passing. Where this session broke a gate, §5 says so. Where the plan was wrong, §5 says that too. No ADR was
accepted, no default flipped, nothing merged, and `accuracyClaimable` is `false` in every artifact this milestone
writes.

## Appendix — final head and its CI run

Every run below was read back from `gh run watch` / `gh run view` after it completed; nothing is recorded as
finished before it finished.

| Item | Value |
|---|---|
| Base (`main`) | `e72e77aff6fa8e27d2b10a42920f53712a9cda98` |
| Branch head | `b5f5a52c3ef18f193caa6c3892e29441298392d2` |
| Commits from base | 41 (`git rev-list --count e72e77a..HEAD`) |
| Pull request | [#11](https://github.com/bhogesararam23/aporia-ai-evaluator/pull/11) — **OPEN**, `mergedAt: null`, not merged |
| CI at head `b5f5a52` | pull-request run `41959314593` **6/6 success**; push run `41959307039` **6/6 success** |
| CI at head `d2aeebd` | pull-request run `41958664701` 6/6 success (`check` ubuntu 1m11s, windows 1m34s, macos 1m16s; `live workflow` ubuntu 48s, windows 51s, macos 46s); push run `41958658896` 6/6 success |
| CI at head `712e0fb` | pull-request run `41958164087` 6/6 success (`check` ubuntu 1m8s, windows 1m54s, macos 1m55s; `live workflow` ubuntu 33s, windows 1m14s, macos 49s); push run `41958079170` 6/6 success |
| Last head with executable code | `d47193b` (compatibility ledger); CI green there too, incl. `41953455732` at `0ead024` |

Local verification re-run at the final head: `npm run check` exit 0 (1073 tests, 1072 passing, 0 failing, 1
skipped) and `npm run verify:workflow` exit 0 (25 passed, 0 failed, 0 not-run).

The last commits on this branch are documentation about the milestone, so the head keeps advancing by one while
the code it describes stays the same; every such head above was still run through the full three-OS matrix and was
green. The commit that carries this appendix is the only one whose own CI run cannot be listed here, and it changes
no code and no test — recorded as a fact rather than glossed over.
