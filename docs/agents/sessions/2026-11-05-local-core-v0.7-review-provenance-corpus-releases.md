# Agent Session Report — 2026-11-05 — Local Core v0.7: Review Provenance, Benchmark Governance and Reproducible Corpus Releases

## 1. Session metadata

- Date/time and timezone: 2026-11-05, local workstation time (UTC+05:30)
- Task or request: build v0.7 from the actual latest `main` — close the real v0.6 gaps (discarded reviewer
  rationales; unpersisted submission timestamps and packet provenance; unenforced reviewer roster;
  unbound/stale adjudications; unsafe batch merges) and add a versioned, offline, reproducible corpus-release
  system, preserving `benchmark-case-v1`/`v2` and `benchmark-report-v2` compatibility, with meaningful
  commits, a new feature branch and an open (unmerged) PR
- Repository: `bhogesararam23/aporia-ai-evaluator` (local: `D:\aporia-ai-evaluator\aporia-ai-evaluator`)
- Branch: `feat/aporia-v0.7-review-provenance-corpus-releases`
- Starting commit: `2b1ecab92d6b343398a6b4001ee3da179dbaa29b` (`main`, merged v0.6 / PR #9) — verified by
  `git fetch` + `git rev-parse`; local `main` was stale at `f5aa23f` and was fast-forwarded
- Operator/context: owner-delegated implementation under `AGENTS.md`; commits authored by the owner's own
  authenticated `gh` identity (`bhogesararam23`), as in every previous milestone
- Session status: completed for implementation and local verification; PR open, **not merged, not owner-accepted**

## 2. Objective and scope

In scope: `src/benchmark/**` (provenance, roster, binding, batch, release), the two benchmark CLIs and a new
release CLI, their tests, and the governance/documentation set. Out of scope, as instructed: providers,
crawling, remote publishing, authentication, billing, database-backed review, changing ADR-025's default, or
accepting ADR-026/027 on the owner's behalf.

## 3. Initial state

Inspected before editing, not inferred from the session reports:

- `git log`, branch list and working tree; `origin/main` at `2b1ecab` with a clean tree.
- `src/benchmark/review.ts`, `types.ts`, `validate.ts`, `scoring.ts`, `report.ts`, `authoring.ts`,
  `regression.ts`; `scripts/benchmark-case.ts`, `scripts/benchmark.ts`, `scripts/check-boundaries.ts`;
  `docs/agents/ADR_INDEX.md`, ADR-025, ADR-026, and the v0.6 session report.
- Baseline `npm run check`: **exit 0, 772 tests passing** (re-measured, not carried forward).

### The five v0.6 defects, reproduced rather than assumed

A throwaway probe against the merged code (deleted after the run; not committed) showed:

1. A submitted rationale `"Careful human rationale number 0…"` merged to `{"…","note":null}` — discarded.
2. The merged label's keys were exactly `reviewer,dimension,label,subjectId,note` — no timestamp, no packet hash.
3. A submission by `sam` on a case declaring `reviewedBy: ['dana']` **merged**, and the merged case then failed
   `validateBenchmarkCase` with five issues — `merge` was writing a corpus `validate` rejects.
4. `applyAdjudication` re-read only the current state, so a decision written against one split could settle
   another (confirmed by reading `review.ts:462-534`; closed by the binding tests added here).
5. `mergeSubmissions` partial-applied, and the CLI wrote straight into `--out` with no plan, staging or journal.

A sixth finding mattered for test quality: the v0.6 review unit fixtures were themselves invalid v2 cases
(statements with no `citations`), which is why item 3 could not fail any existing test. `tests/helpers/
benchmark-fixtures.ts` now provides a validating fixture and `benchmark-fixture-validity.test.ts` proves it.

## 4. Changes made

| Path | Action | Purpose | Validation |
|---|---|---|---|
| `src/benchmark/hashing.ts` | added | one canonicaliser + `contentHash` + `isContentHash`, sorted by **code unit** instead of `localeCompare` so a digest cannot vary with the machine's ICU/`LANG` | `benchmark-hashing.test.ts` |
| `src/benchmark/provenance.ts` | added | reviewer identity, roster views and gaps, label provenance, disagreement state hash, and the **single** MATCHING/STALE/UNBOUND resolver; tolerant readers so a half-written case yields an empty list, not a crash | `benchmark-reviewer-identity`, `benchmark-roster`, `benchmark-label-provenance`, `benchmark-adjudication-binding`, `benchmark-review-malformed` |
| `src/benchmark/batch.ts` | added | pure batch planning (`atomic`/`isolated`), staged corpus rendering, journal state machine | `benchmark-batch-plan` |
| `src/benchmark/release.ts` | added | case/corpus digests, release id, manifest, verify, compare, named gates | `benchmark-release` |
| `src/benchmark/types.ts` | changed | v0.7 version strings; optional additive label/adjudication fields; submission contracts moved in; `AdjudicationBinding`; additive report fields | `benchmark-contracts`, `npm run typecheck` |
| `src/benchmark/review.ts` | changed | provenance-preserving merge, roster enforcement, submission v1/v2, bound template + guarded `applyAdjudication`, binding-aware report and audit, `rosterGaps`; `mergeSubmissions` removed (no caller; superseded by the planner) | the merge/adjudication/audit suites |
| `src/benchmark/validate.ts` | changed | validate the new optional fields only when present; canonical roster comparison (a merged case must validate against its own roster) | `benchmark-validate-provenance` |
| `src/benchmark/scoring.ts` | changed | `agreementRows` through the shared resolver; canonical reviewers; additive binding counts | `benchmark-scoring-binding` |
| `src/benchmark/report.ts`, `authoring.ts` | changed | additive summary fields, version stays `benchmark-report-v2`; canonical serialisation shares the one canonicaliser | `benchmark-v06-compatibility`, `benchmark-report-compat` |
| `scripts/corpus-io.ts` | added | one loader for both CLIs; typed `CorpusReadError` so a bad file becomes a refusal | exercised by both CLI suites |
| `scripts/benchmark-case.ts` | changed | `roster`, `adjudicate --issue`, `--dry-run`, `--allow-partial`, `--recover`, staging publish with journal | `benchmark-batch-cli`, `benchmark-roster-cli`, `benchmark-review-cli` |
| `scripts/benchmark-release.ts`, `package.json` | added | `benchmark:release` freeze / verify / diff / gates | `benchmark-release-cli` |
| 19 new test files | added | unit + integration coverage listed in §6 | all passing |
| ADR-027, ADR index, README, docs index, Implementation Status, Roadmap, Known Limitations, Testing, rubric, validation plan, runbook, module boundaries, v0.7 design + plan + traceability | added/changed | governance record of the milestone | `docs-links.test.ts` |

## 5. Decisions and ADRs

- **ADR-027 created — Proposed, implemented and tested, NOT owner-accepted.** ADR-025 stays Proposed with its
  default unchanged; ADR-026 stays Proposed; ADR-027 is not accepted on the owner's behalf. ADR-027 §Open
  questions lists three owner decisions this session deliberately did **not** make. The ADR index row landed in
  the same commit as the ADR, as `docs-links` requires.
- Additive optional fields on `benchmark-case-v2` rather than a `v3` bump: no corpus migration, older files read.
- Report stays `benchmark-report-v2`; `AgreementRow.status` enum not extended; binding is disclosed additively.
- Atomic-by-default batch writes accepted as a deliberate CLI default change (owner approved), with
  `--allow-partial` preserving the old behaviour explicitly.
- Releases are manifest-and-hashes by default; `--snapshot` is opt-in because copying possibly-sensitive
  corpus material is a privacy event.
- Adjudication binding resolved in one module, because `review.ts` and `scoring.ts` previously resolved
  adjudications independently and would otherwise disagree about whether a subject is settled.
- Design decisions were put to the owner before coding (compat strategy, batch default, release scope, CLI
  surface) and approved; the design document was committed as the first checkpoint.
- **Corrected mid-flight, in code and in the spec:** the first design put `settlingCount` inside the
  disagreement hash. The binding tests disproved it — a decision would go stale the instant it was filed —
  so the count is excluded, and double-settling is prevented by the subject leaving `UNRESOLVED`. Spec §3.2
  and the plan record the reversal and why.
- Two further self-caught defects fixed during the session: an unbound-`rosterNames` filter too strict for the
  roster view (reported "nobody labelled" for exactly the broken file it exists to catch), and `scoreable`
  keyed by case id rather than by source file in `roster`.

## 6. Validation

- `npm run check` — **exit 0**: typecheck, eslint, prettier, boundary check, and **956 tests, 956 passing, 0
  failing** (593 under `tests/unit`, 363 under `tests/integration`, measured by running each glob separately).
- `npm run verify:workflow` — **exit 0**: 25 `[PASSED]` step entries, 0 `[FAILED]`, run twice (after the
  binding/batch work and again after the hostile-input hardening), against a real server on a fresh temporary
  data directory.
- `npm run benchmark` on the isolated workflow-fixture corpus — pass; the workflow's step 17 covers it.
- New suites: `benchmark-hashing`, `benchmark-contracts`, `benchmark-fixture-validity`,
  `benchmark-reviewer-identity`, `benchmark-roster`, `benchmark-label-provenance`,
  `benchmark-adjudication-binding`, `benchmark-review-merge-provenance`, `benchmark-validate-provenance`,
  `benchmark-review-disagreement-binding`, `benchmark-review-adjudication-stale`, `benchmark-scoring-binding`,
  `benchmark-batch-plan`, `benchmark-release`, `benchmark-batch-cli`, `benchmark-release-cli`,
  `benchmark-roster-cli`, `benchmark-review-lifecycle`, `benchmark-v06-compatibility`,
  `benchmark-review-malformed`.
- Security/hostile input: malformed submissions, adjudications, cases and manifests are asserted to be
  **refused with a reason and never thrown on** (`assertRefused` also asserts no `TypeError` in CLI stderr);
  prototype-polluting JSON keys are covered; the roster and release paths are exercised against a
  hand-edited corpus.
- Compatibility: v1/v2 case files, a v0.6 `benchmark-submission-v1` with a date-only timestamp, an unbound
  legacy adjudication, an unchanged `benchmark-packet-v1` hash and `benchmark-report-v2`'s version and status
  vocabulary are all pinned.
- Cross-platform: canonical JSON is LF-explicit; publishing uses temp-write + `renameSync`; every digest-feeding
  ordering is by code unit. Determinism is asserted locally with a stubbed clock and working directory, and on
  Windows/Linux/macOS in CI.
- **Not run:** no provider, network, live-service or browser-based test exists or was attempted (out of
  scope by design). No real review, corpus or release was produced; the release tooling has only ever been run
  against synthetic fixtures. macOS/Linux results come from CI only, reported per job.

## 7. Evidence and external sources

No external sources were consulted. Every claim in the ADR and design document comes from reading this
repository's code, running its checks, or the probe results in §3. No provider capability, benchmark figure or
external validation is asserted anywhere in this milestone.

## 8. Risks and limitations

- **Reviewer identity remains operator-asserted.** Canonicalisation stops one person being counted twice by
  respelling; it cannot show two names are two people. `accuracyClaimable: false` everywhere.
- **A hash is integrity, not authenticity.** A manifest over fabricated labels is a faithful digest of
  fabricated labels. Stated in the manifest itself (`integrityNote`) and in every CLI footer.
- **Readiness is not accuracy.** Gates that all pass still say nothing about correctness.
- **Legacy unbound adjudications are honoured**, not verified; `allAdjudicationsBound` fails (non-blocking)
  while any exist, so a corpus with legacy decisions cannot be described as provenance-verified.
- **The default change breaks reliance on partial writes**: a script that expected v0.6 partial application now
  exits non-zero and writes nothing unless it passes `--allow-partial`.
- **Digests changed.** Code-unit ordering means v0.6-computed packet/case hashes differ from v0.7's, so an old
  packet must be re-issued. No real packet exists, so nothing was invalidated in practice.
- Batch output is still re-exported whole, so a large corpus rewrites every file per batch; recovery
  content-hash comparison skips already-published files, but the operation is O(corpus), not O(change).
- Concurrency is unmanaged: two operators editing the same corpus can still clobber each other. No lock file
  was added, and none is claimed.
- Journal recovery trusts the journal's own hashes; a tampered staging directory is out of model (the operator
  can inspect it, and a plan-hash mismatch stops resume).
- The release manifest has never been produced from a reviewed corpus, because none exists.

## 9. Commit and publication

Ledger from the verified baseline: `git rev-list --count 2b1ecab..HEAD`.

| SHA | Subject |
|---|---|
| `3828431` | docs(design): specify v0.7 review provenance, adjudication binding and reproducible corpus releases |
| `5253db9` | docs(plan): sequence v0.7 into 32 test-first tasks with commit boundaries |
| `290c053` | feat(benchmark): add a locale-independent canonical content hash |
| `cb11cc3` | feat(benchmark): version the v0.7 review and release artifacts and widen the case contract additively |
| `11bba47` | test(benchmark): add a validating case fixture the review tests can actually trust |
| `e9b9b63` | feat(benchmark): add review provenance primitives and one shared adjudication-binding resolver |
| `bb4b433` | fix(benchmark): preserve reviewer provenance and enforce the declared roster on merge |
| `8ba29ed` | feat(benchmark): validate persisted review provenance and canonicalise roster checks |
| `c93956f` | fix(benchmark): bind every adjudication to the disagreement it settles and refuse stale decisions |
| `d04bfdf` | refactor(benchmark): score and audit through the shared resolver, additively within report-v2 |
| `8cb86f6` | feat(benchmark): plan benchmark batches atomically and render staged output as pure data |
| `0d9810f` | feat(benchmark): publish batches atomically through a journal and report the roster read-only |
| `b6bb64d` | feat(benchmark): hash, manifest, verify and gate a corpus release deterministically |
| `a49776e` | refactor(benchmark): share one corpus loader between the two benchmark CLIs |
| `312d426` | feat(benchmark): add the offline benchmark:release CLI for freeze, verify, diff and gates |
| `ef25c89` | test(benchmark): prove review provenance survives the full packet-to-release lifecycle |
| `6cca59a` | test(benchmark): pin v0.6 packets, submissions, case contracts and report output as still readable |
| `64f95a8` | docs(adr-027): record review provenance, adjudication binding, batch semantics and corpus releases |
| `42ee2c4` | docs(readme): state the merged v0.6 baseline and what v0.7 changed in review provenance and releases |
| `4afc2b4` | docs(testing): record the v0.7 suites and re-measured results |
| `c46b7a5` | docs(limitations): state what hashes, readiness, roster enforcement and binding do not prove |
| `acb0c65` | docs(status): record the v0.7 capabilities and correct the merged v0.6 rows |
| `3aa0552` | docs(roadmap): add the v0.7 milestone note and mark v0.6 merged at 2b1ecab |
| `6fea1fd` | docs(boundaries): document the benchmark module's internal layering and its no-cycle rule |
| `0a90bf3` | docs(rubric): tell reviewers what v0.7 keeps, refuses and freezes |
| `68931fa` | docs(validation): separate corpus release gates from validation gates and record v0.7 |
| `330e930` | docs(runbook): add the release procedure and interrupted-batch recovery steps |
| `b543f5d` | fix(benchmark): refuse half-written and hostile input in the pure layer instead of crashing |
| `060989d` | docs(v0.7): add the session report, requirement traceability and index entries |
| `9227801` | fix(benchmark): bound canonicalisation depth so a pathological document is refused, not a stack overflow |

30 commits precede this report's finalising commit, which carries the counts and CI evidence appended below;
the authoritative total is `git rev-list --count 2b1ecab..HEAD` recorded in the pull request.

- Push/branch result: pushed to `origin/feat/aporia-v0.7-review-provenance-corpus-releases` at seven
  checkpoints, each after `npm run check` was green. **No force-push, no push to `main`, no merge.**
- Pull request: **https://github.com/bhogesararam23/aporia-ai-evaluator/pull/10** — opened against `main`,
  **left open and unmerged** for owner review.
- CI, PR run `41931317464` at head `9227801` (the current PR head) — **all six jobs completed successfully**:
  `check` on windows-latest (2m1s), macos-latest (50s) and ubuntu-latest (1m4s); `live workflow` on
  windows-latest (1m12s), ubuntu-latest (36s) and macos-latest (1m8s). An earlier PR run, `41930889699` at
  head `060989d`, also finished with all six jobs green. Results observed through `gh run view` on 2026-11-05.
- Only observed GitHub annotation: a platform notice that `actions/checkout@v4` and `actions/setup-node@v4`
  target deprecated Node 20 while being forced onto Node 24. It concerns the workflow's action versions, not
  this change, and is left as a separate tooling follow-up.
- Failed or partial writes: none. Every checkpoint was pushed only after `npm run check` was green;
  intermediate commits were verified at file granularity (typecheck plus the affected suites) rather than by
  running the full gate on each of the 30.

## 10. Handoff

1. Owner: review ADR-027's three open questions (atomic default, whether `allAdjudicationsBound` should block,
   whether a content-derived release id is sufficient provenance) and accept or reject ADR-025, -026, -027.
   None is accepted by this session.
2. Owner: produce a real corpus — a human reviewer authorised to hold the material, working through
   `packet → submit → merge`, then `freeze`. Until then every accuracy statement remains unavailable.
3. Next engineering candidates, in priority order:
   - ~~a bounded-depth guard in `canonicalise`~~ **done in this milestone** (`9227801`): `MAX_CANONICAL_DEPTH`
     with `nestsDeeperThan` refusing an over-deep case in the validator and `DepthExceededError` guarding the
     canonicaliser, so a pathological document is refused with a reason instead of reaching a stack limit;
   - per-file incremental release export, so a one-case change does not rewrite the whole corpus;
   - a simple lock file around batch publishing if concurrent operators become real;
   - a tooling PR to move `actions/checkout` and `actions/setup-node` off the Node-20-deprecated versions;
   - the v0.8 candidate already implied by ADR-025: owner acceptance and the one-line default flip, with a
     stored-snapshot re-reading plan.
4. Resume point: `docs/technical/BENCHMARK_PROVENANCE_AND_CORPUS_RELEASES.md` for semantics, ADR-027 for
   decisions and rejected alternatives, `V07_REQUIREMENTS_TRACEABILITY.md` for the requirement-to-check map.

## 11. Integrity statement

This report records only actions observed in this session. The five v0.6 defects were reproduced against
`2b1ecab` before any code was written; every "pass" above is the result of a command that was run, and counts
were re-measured by glob rather than carried forward. No test, review, approval, provider check or deployment
is claimed that did not occur. No case, reviewer, timestamp, label, permission or corpus was fabricated, and no
accuracy claim is made anywhere in this milestone.

---

### Appendix: CI and pull-request outcome (appended after §9 was written)

Recorded here as a dated appendage, per the operating protocol's rule against overwriting session history.
See §9 for the commit ledger, the PR URL and the per-job CI results, all observed through `gh` on
2026-11-05.
