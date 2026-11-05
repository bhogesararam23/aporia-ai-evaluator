# ADR-028: Bind Benchmark Execution to a Frozen Release, Record a Deterministic Run Receipt, and Harden Corpus and Artifact I/O

- Status: Proposed — **implemented and tested, not owner-accepted**; additive local tooling only
- Date: 2026-11-05
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-027, ADR-026, ADR-020, ADR-022, ADR-025, ADR-017, ADR-013
- Baseline: `main` at `e72e77aff6fa8e27d2b10a42920f53712a9cda98` (merged v0.7, PR #10)
- Design: [Release-Bound Benchmark Execution and Corpus I/O Hardening](../../technical/BENCHMARK_EXECUTION_BINDING_AND_CORPUS_IO_HARDENING.md)

## Context and problem

v0.7 gave the corpus a release manifest and then did not use it. A report could be frozen, verified and diffed,
yet the command that scored the corpus never opened a manifest, so no report could say which frozen input it came
from. Seven properties of the merged code were reproduced against `e72e77a` with a throwaway probe before any fix
was written.

1. **A case id escaped its output directory.** `id` was checked only for non-empty and length, and every writer
   built a file name as `` `${id}.json` ``. A case with id `../../../../pwned` validated with **zero** issues,
   `benchmark:case normalise` exited **zero**, left its `--out` directory **empty**, and wrote a canonical case
   file several directories above the `--out` the operator named. `renderStagedCorpus` had documented "names are
   bare" since v0.7 without ever checking it. The same shape existed in `packet`, `--snapshot` and batch
   publication.
2. **Hostile input crashed instead of refusing.** `scripts/corpus-io.ts` never stat'd its entries. A subdirectory
   named `nested.json` produced a raw `EISDIR` and a stack trace on `benchmark:case` and `benchmark:release`,
   while `npm run benchmark` — which had its own loader — silently skipped the same entry. Two loaders, opposite
   behaviour, one corpus.
3. **Reads were bounded on one command of three.** A 1,093,691-byte file holding 600 bundled cases: the harness
   refused it, `benchmark:release gates` parsed the whole thing and reported "600 valid case(s)". The harness also
   applied `maxCases` (a case ceiling) to a *file* count.
4. **Existing artifacts were destroyed without a word.** A pre-existing report and a pre-existing release
   manifest were both silently overwritten by plain `writeFileSync`, which truncates before writing. The manifest
   is the file every later verification trusts.
5. **Report bytes depended on collation.** `serialiseBenchmarkReport` sorts keys with `localeCompare`; the same
   report differs from code-unit-ordered output at `statement.structuralReadiness` (`subjectsWithout` before
   `subjectsWithTwoDistinctReviewers`). Anything that replays a report and compares bytes inherits that
   dependence.
6. **Nothing bound a run to a release.** `--release` and `--run-record` were unknown arguments and
   `BenchmarkReport` has no release or manifest field at all.
7. **Symlink following could not be demonstrated here.** `statSync` follows links, so a link named `x.json` reads
   a file outside the corpus. `symlinkSync` fails `EPERM` on this host (no developer mode), so the requirement is
   implemented and tested, with the test skipping explicitly and saying why on Windows; it executes on the Linux
   and macOS jobs.

## Decision

**1 — One bounded corpus read.** `scripts/corpus-io.ts` is the only corpus and artifact reader for all three
benchmark commands. Order of operations, all before parsing: list, keep `*.json`, sort by code unit, `lstatSync`
each entry (symlink → typed refusal; not a regular file → typed refusal), bound the file count (`maxFiles`, new,
5000 — the value the harness already applied), bound per-file bytes (`maxCaseBytes`) and the running total
(`maxCorpusBytes`) against the stat size, then read, parse, and refuse anything nested past `maxNestingDepth`
(`MAX_CANONICAL_DEPTH`, named rather than left implicit). `CorpusReadError.kind` is now
`directory | symlink | type | count | size | json | depth`. The harness's private 57-line loader is deleted.
Scripts own all filesystem IO; `src/benchmark/**` stays pure.

**2 — An identifier must be usable as a file name.** `src/benchmark/naming.ts` holds the rule once — no separator
or traversal shape, no character a supported OS cannot store, no control character, no leading or trailing
whitespace, no trailing dot, not all dots, within the length ceiling — and **both** layers enforce it:
`validateBenchmarkCase` reports an issue, and every writer refuses through `safeArtifactName` (the batch throws
`UnsafeCaseNameError`). A refusal never sanitises: renaming `a/b` to something safe would publish a case under a
name no manifest lists, so a later verification would compare digests of files nobody asked for. The rule states
only what a supported OS cannot store, so ordinary ids with dots, underscores, hyphens and non-ASCII letters stay
valid.

**3 — Execution is verified against the release before it is scored.** `src/benchmark/execution.ts` (pure) checks
manifest shape and contract version first, so a stale or foreign manifest is refused *as a manifest*, then binds
the corpus to it: any `CHANGED`, `ADDED`, `REMOVED`, `DUPLICATE`, `CONTRACT`, `INVALID` or blocking-`GATE` finding
refuses the run before scoring and writes no report. `benchmark-report-v2` is **not** extended — see decision 5.
Without `--release` the harness behaves exactly as v0.7 did, and the binding is still computed so a receipt can
state `notReleaseBound: true`.

**4 — Non-blocking gates are disclosed, never promoted.** `allAdjudicationsBound` and `strataCovered` failures
become warnings printed and recorded. They neither stop a run nor pass silently.

**5 — `benchmark-run-record-v1`, and the report stays byte-frozen.** The receipt binds release id, manifest byte
digest, corpus hash, report hash, case count and the applicable case/report/methodology/metrics/evidence-rule
versions, plus `sourceRevision` — `null` unless an operator explicitly supplied one; the harness never runs git,
never reads `.git`, and never infers a commit. It carries no clock, path, hostname or environment value, and a
test refuses the schema any field named for time, place or host.

The owner's decision was to keep `benchmark-report-v2` bytes untouched and put the binding in the receipt, because
adding fields to the report would change the bytes of every stored report. So `serialiseBenchmarkReport` still
sorts with `localeCompare`, and the receipt records **two** report identities: `reportSha256` over the canonical
(code-unit) form, which is environment-independent and therefore checkable across platforms, and
`reportTextSha256` over the exact bytes written, which catches a rewritten file. Verification treats a
content disagreement as a failure, a stored-text disagreement as a failure, and a *replayed*-text difference with
unchanged content as a stated note — a reformat, not a forgery.

**6 — Publication cannot destroy or half-write.** `scripts/artifact-io.ts` is the only artifact writer.
`publishFile` writes a sibling temp file and `renameSync`s over the target, and refuses an existing target unless
`--overwrite`, naming the sha256 of the bytes there; an explicit overwrite reports the displaced digest.
`publishDirectory` checks every name, re-verifies every planned digest, refuses any collision before staging,
stages the whole set, publishes by atomic rename, and on failure rolls the directory back — deleting what the
batch created and restoring what it replaced — while a target that is not a regular file is left alone rather than
removed. An existing target holding **identical** bytes is neither rewritten nor refused, and says so: a re-run
over the same input is normal, and treating it as an error trains operators to pass `--overwrite` reflexively,
which is the flag that does destroy something. `normalise`, `packet`, `adjudicate --issue`, `--snapshot`,
`scaffold`, the report, the manifest and the receipt all go through it; the batch journal is written the same way,
because a half-written journal is indistinguishable from no journal.

**7 — Scoring is one pipeline.** `composeRunReport` owns the corpus digests and report construction that the
harness used to build inline, so a replay cannot drift from the run it verifies.

Rejected: verifying the release *after* scoring (produces a report about a corpus nobody released); making
`--release` mandatory (breaks CI step 17 and every documented invocation, and an unbound run honestly labelled is
better than a forced fake binding); adding release fields to `benchmark-report-v2` (rewrites stored reports);
using the existing 16-hex `CorpusDigest`/`caseDigest` fields for the new identities (they mean something else and
are still checked to be unchanged); a larger per-file byte ceiling (would loosen the bound the harness already
documented — instead the commands with no ceiling became as strict as the one that had one); writer-only id refusal
(leaves an un-publishable id "valid" until something tries to write it); always-overwrite with a post-hoc digest
(makes destruction the default); reading a revision from git (an invented commit is the most misleading field a
receipt can hold); comparing report text bytes alone (collation-dependent, so cross-platform verification would be
accidental); silently renaming unsafe ids.

## Consequences and trade-offs

A report can now be answered: which corpus, which manifest bytes, which build. A tampered receipt, report,
manifest or corpus is refused with the field named. Hostile input is refused in words on every command. The
failure mode this trades away is convenience: an operator who re-runs `freeze` or `--snapshot` over files that have
since been edited must pass `--overwrite`, and a bundled corpus file over 256 KiB is now refused by
`benchmark:case` and `benchmark:release` as well as the harness. Two behaviours changed on purpose — the shared
per-file ceiling, and refuse-an-existing-target — and both are recorded here, in the limitations and in the
runbook, because a silent CLI change is the thing that breaks an audit.

The byte-frozen report has a cost that is now visible rather than hidden: its key order is still locale collation,
which is why the receipt carries a canonical content hash as well. The report's bytes remain comparable with what
v0.7 stored; the *verification* does not depend on them.

## Security, privacy, safety, and evaluator-validity implications

Still local, offline, single-operator and loopback-only: no provider call, no URL fetch, no crawling, no remote
publishing, no authentication, no billing, no multi-tenancy, no database-backed review. Reading is bounded before
parsing, so a hostile corpus cannot exhaust memory; symlinks and non-regular entries are refused; an id cannot
escape its directory; an artifact is never half-written and never silently replaced. `--snapshot` still warns that
it duplicates potentially sensitive corpus material.

Nothing is fabricated. `accuracyClaimable` is the literal `false` in the report, the manifest and the receipt, and
the receipt's own note says that a bound run over a fully-gated corpus is a ready corpus, not an accurate
evaluator. Reviewer names remain operator-asserted: a manifest and a receipt authenticate nobody. Case, label,
reviewer, timestamp and permission material remain the operator's, and every ceiling added here rejects malformed
input without ever repairing it into something valid. `evidence-aggregation-v1` remains the default, and ADR-025,
ADR-026 and ADR-027 remain unaccepted — this milestone changed none of those statuses.

## Implementation and migration plan

No migration and no contract bump. `benchmark-case-v1`/`v2`, `benchmark-report-v2` and its `status` enum are
unchanged; `benchmark-release-manifest-v1` gains a reader contract, not a new version; one artifact contract is
added, `benchmark-run-record-v1`; `BENCHMARK_LIMITS` gains `maxFiles` and `maxNestingDepth`; two npm surfaces are
added (`--release`/`--run-record`/`--source-revision`/`--overwrite` on `benchmark`, and `benchmark:verify`).
Operators who want the new guarantees pass `--release` and `--run-record`; everyone else keeps the v0.7 behaviour
except where hostile input or an existing target is now refused instead of silently handled.

## Tests and validation required

Typed refusal for each ceiling and each entry kind; code-unit ordering of the read; unsafe-id refusal at both
layers; a batch that refuses rather than emitting an escaping name; the whole binding matrix; receipt determinism
and the absence of clock/path/host fields; `verifyRunRecord` mismatch classification including the text-only
reformat; atomic publish, refuse-versus-overwrite, rollback of a directory batch, resume of an interrupted one;
the full `packet → merge → adjudicate → freeze → bound run → verify` lifecycle; eleven-field receipt tampering;
historical artifacts still readable; and the merged v0.7 report serialisation pinned by digest.

## Validation actually performed

Measured on this branch at the final head, recorded in full in the v0.8 session report
(`docs/agents/sessions/2026-11-05-local-core-v0.8-execution-binding-corpus-io-hardening.md`):
`npm run check` exit 0; `npm run verify:workflow` exit 0 with 25 steps passed and none failed;
`npm run benchmark` and `npm run benchmark:verify` against an isolated fixture corpus; the Node 24
Ubuntu/Windows/macOS CI matrix on the final head. The symlink test reports itself **skipped with its reason** on
this Windows host and executes on the Linux and macOS jobs. None of it is evidence that the evaluator is accurate.

## Open questions for the owner

1. Is refusing an existing target by default the right trade, or should an identical-bytes rerun also be refused so
   that *any* replace is explicit? The current rule refuses only what would lose data.
2. Should `--release` become mandatory for a run whose report is stored as evidence, even though that would break
   the fixture run in CI step 17 and require a first real release?
3. Is a canonical content hash plus an exact-text hash sufficient for the report identity, or should
   `benchmark-report-v3` eventually freeze a code-unit key order and make one byte layout possible?
