# Agent Session Report — 2026-11-04 — Local core v0.6 benchmark offline human-review workflow

This is the running record for the v0.6 milestone. It states what was actually observed in the
checkout, what was verified by running, and what stays unverified. A row is moved to `Done` only when a
test exists that would fail without the change. No claim here is backed by documentation alone.

## 1. Session metadata

- Date/time and timezone: 2026-11-04, local machine time
- Task: turn the offline benchmark tooling into a reliable, reproducible human-review workflow — frozen
  blinded packets, separate submissions, safe merge, disagreement reporting with scoped adjudication,
  corpus readiness/provenance audit, and a CLI integration — local core v0.6 (ADR-026)
- Repository: `bhogesararam23/aporia-ai-evaluator`
- Branch: `feat/aporia-v0.6-benchmark-review-workflow`
- Starting commit: `d9411718885c78fc42b7fd27892576ea16291bcd` (`origin/main`, the merged v0.5 line)
- Operating model: local-first, single operator, loopback only, offline, dependency-light; no provider,
  network, crawling, remote publishing, authentication, billing, database-backed reviewers, or fabrication

## 2. Actual starting state (verified, not assumed)

| Check | Observed |
|---|---|
| `git fetch origin --prune` | `origin/main` at `d941171` — PR #8 (v0.5) is **merged**; v0.4 `43ce438`, PR #7 evidence-corroboration fix all ancestors |
| Starting tree | clean; fresh branch created from `d941171`; upstream initially unset |
| Baseline `npm test` | **739 tests, 739 pass, 0 fail** (re-measured on this checkout, not carried forward) |
| `benchmark-case-v2` contract | present (`BENCHMARK_CASE_VERSION`), with `benchmark-case-v1` still readable via `KNOWN_BENCHMARK_CASE_VERSIONS` |
| `evidence-aggregation` default | `v1`; ADR-025 still Proposed — **not changed by this milestone** |
| Node | v24.13.1; `.nvmrc`/`engines` ask 24 |

The brief's premise is accurate: the harness and the `benchmark:case` authoring CLI existed, but there
was **no blinded review mechanics** — a reviewer would hand-edit a case file that already showed gold
labels and prior annotations, with no stale/duplicate/mismatch gate and no way to tell agreement from a
quietly-resolved split. That is the gap v0.6 closes.

## 3. Design decision — artifact versions, not a case-contract bump

Inspecting `benchmark-case-v2` first: nothing about a *case* needed to change for the workflow. Packets,
submissions, adjudication templates and audits are separate, short-lived files. The merged output is an
ordinary `benchmark-case-v1`/`v2` file with `reviewerLabels` populated. So the milestone introduces four
**workflow artifact** versions (`benchmark-packet-v1`, `benchmark-submission-v1`,
`benchmark-adjudication-v1`, `benchmark-audit-v1`) centralised in `src/benchmark/types.ts`, and leaves
the case contract and `benchmark-report` untouched — **no corpus migration and no report break**. A case
contract bump was rejected in ADR-026 as churn with no data to migrate. v1/v2 reading is proven preserved
by `tests/unit/benchmark-review-compat.test.ts`.

## 4. Objective A–G — implementation (all Done, each gated by a failing-without-it test)

- **A — frozen, hashed, blinded packets.** `contentHash` (key-order-independent SHA-256 over a
  canonicalised value) and `buildReviewerPacket` emit only the frozen input plus subjects derived from
  the input (`deriveSubjects`), never from `expected`. The packet omits gold, annotations, adjudications,
  stratum, provenance and evaluator output. `buildSubmissionTemplate` yields one blank annotation per
  subject with empty reviewer/timestamp. — `benchmark-review-packet.test.ts`
- **B — safe merge.** `mergeSubmission`/`mergeSubmissions` are all-or-nothing: refuse a stale packet
  hash, a wrong case id, a duplicate reviewer (against existing labels and within the batch), an unknown
  or repeated subject, an out-of-vocabulary label, a blank rationale, or a blank reviewer/timestamp —
  leaving the case untouched. On success append `BenchmarkReviewerLabel`s only; never edit `expected`,
  never remove another reviewer's label, never mutate the input. Vocabulary checked against the single
  `benchmarkDimensionLabels` export from the validator. — `benchmark-review-merge.test.ts`
- **C — disagreement reporting + scoped adjudication template.** `disagreementReport` classifies each
  subject UNANNOTATED / SINGLE_REVIEWER (< 2 distinct reviewers, never consensus) / UNANIMOUS /
  ADJUDICATED (only when a scoped adjudication names that exact dimension+subject) / UNRESOLVED, and
  never picks a side. `adjudicationTemplate` lists only unresolved subjects, blank. —
  `benchmark-review-disagreement.test.ts`
- **D — corpus readiness/provenance audit.** `auditCorpus` reports missing strata (against
  `BENCHMARK_STRATA`), cases without storage authorisation or a review date, subjects with thin review,
  and unresolved disagreements, with `accuracyClaimable: false` and a stated reason. —
  `benchmark-review-audit.test.ts`
- **E — CLI integration.** `npm run benchmark:case` gains `packet`, `merge`, `review`, `audit` (and,
  from the extra hardening below, `adjudicate`). Pure local file tooling; a rejected import exits
  non-zero and still re-exports untouched cases; submission files are coerced to well-formed objects so a
  malformed file is refused, not thrown on. — `benchmark-review-cli.test.ts` (integration).
- **F — artifact versions + ADR-026.** Versions declared in `types.ts`; `review.ts` aliases them. The
  decision, alternatives and consequences are recorded in [ADR-026](../adrs/ADR-026-benchmark-review-workflow.md).
- **G — documentation.** The rubric status (was "current for `benchmark-case-v1`") now covers v2 and the
  workflow; `BENCHMARKING_AND_VALIDATION.md` §3.4 documents the workflow and the §0 status table is
  updated; `TESTING.md` records the command, the new suites and the re-measured counts;
  `IMPLEMENTATION_STATUS.md` replaces its stale v0.4 header with a v0.5-merged / v0.6-in-progress framing
  plus v0.5 and v0.6 capability tables and an ADR-026 row; the roadmap gets a v0.6 note;
  `KNOWN_LIMITATIONS.md` and `LOCAL_RUNBOOK.md` describe the workflow and its limits.

## 5. Extra hardening found worth doing — guarded adjudication application

Reviewing objective 5 ("scoped adjudication without manufacturing consensus") showed the workflow could
*emit* an adjudication template and *read* a case's adjudications, but had no write-time gate — a filled
adjudication could be hand-added against any subject. `applyAdjudication` + the `adjudicate` CLI close
this: a `RESOLVED` outcome is accepted **only** for a subject currently in `UNRESOLVED` disagreement (so
it cannot settle a unanimous or lone-reviewer subject, overwrite an existing adjudication, or decide where
nobody split), must carry an in-vocabulary label, and a `GENUINELY_AMBIGUOUS` outcome must carry **no**
label. It never edits `expected`. — `benchmark-review-adjudication.test.ts` (unit),
`benchmark-review-cli.test.ts` (integration).

## 6. Gates run on this branch (verified, not assumed)

| Gate | Result |
|---|---|
| `npm run typecheck` | pass (0 errors) |
| `npm run lint` | pass |
| `npm run format:check` | pass |
| `npm run check:boundaries` | `Module boundaries are clean.` |
| `npm test` | **772 tests, 772 pass, 0 fail** — 439 `tests/unit`, 333 `tests/integration` (each glob re-run separately) |
| `npm run check` | exit 0, 772/772 |
| `npm run verify:workflow` | exit 0, 25 step entries passed, 0 failed, 0 left not-run (the application is unchanged; v0.6 is benchmark-only additive) |
| Benchmark regression + compat | 103 tests across `benchmark-*` unit + integration suites pass |
| `npm run benchmark` (no corpus) | exits non-zero, requires `--corpus` — refuses to print a percentage over nothing |
| docs-links test | pass (every ADR-026 / rubric / runbook relative link resolves) |

Net test delta over the branch baseline: **+33** (739 → 772).

## 7. Commit ledger (regenerated from `git rev-list --count d941171..HEAD`)

| # | Commit | Area | Summary |
|---|---|---|---|
| 1 | `188c157` | feat(benchmark) | blinded reviewer packets + submission templates with a stable content hash |
| 2 | `e677860` | feat(benchmark) | all-or-nothing safe merge (stale-hash/duplicate/mismatch/vocabulary) |
| 3 | `ad1db6e` | feat(benchmark) | per-subject disagreement report + scoped adjudication template |
| 4 | `f167f4b` | feat(benchmark) | corpus readiness and provenance audit |
| 5 | `e968b23` | feat(benchmark) | `benchmark:case` packet/merge/review/audit subcommands + integration tests |
| 6 | `9635cf2` | docs(adr-026) | record the review-workflow decision; centralize artifact versions in `types.ts` |
| 7 | `f672eb9` | docs(benchmark) | document the workflow in the rubric, validation plan and testing guide |
| 8 | `b883c93` | docs(status,roadmap) | replace stale v0.4 framing with merged v0.5 + in-progress v0.6 |
| 9 | `825794b` | test(benchmark) | v1/v2 case-reading compatibility preserved through the workflow |
| 10 | `55aaa00` | feat(benchmark) | guarded `applyAdjudication` + the `adjudicate` CLI subcommand |
| 11 | `6e641da` | docs(benchmark) | document the adjudicate step; re-measure counts (772: 439/333) |
| 12 | `9ea14b4` | docs(operations) | review-workflow runbook + v0.6 validity limits |
| 13 | (this) | docs(session) | open the v0.6 session report and commit ledger |

Checkpoint pushed: #1 = commits 1–12 pushed after a green `npm run check` + `verify:workflow`
(`feat/aporia-v0.6-benchmark-review-workflow`, new branch). Pull request **#9** opened against `main`
(unmerged) at head `a7d3a9e`; state OPEN, `mergeable`.

CI (`.github/workflows/ci.yml`, three-OS Node 24 matrix), observed ~2026-11-04 on runs `41861430964`
(pull_request) and `41861333179` (push): the `check` job **passed on `windows-latest` and
`ubuntu-latest`** on both runs, and **GitGuardian Security Checks passed**. The `macos-latest` job was
still **queued** at the time of this report (free-tier macOS runner latency). macOS is therefore **not
claimed green** — it is pending, not failed; the branch is benchmark-only additive and the application
code is unchanged, so a macOS-specific failure is not expected, but no result is stated before it is
observed.

## 8. What is NOT claimed

- Evaluator accuracy is not established and no gold corpus is asserted or shipped; the audit and the
  harness both keep `accuracyClaimable: false`.
- The review workflow has **not been used to review real material** — no packet issued to a live
  reviewer. It provides the mechanics; performing the review is still the owner's and reviewers' work.
- Reviewer identity and timestamps remain operator-asserted and unverified; the content hash proves a
  submission matches the frozen input, not that an independent human produced it. No independence or
  authentication is claimed.
- `evidence-aggregation-v1` is still the default; ADR-025 is unchanged and still awaits the owner's
  acceptance decision. No stored report or snapshot is recomputed.
- The `benchmark-case-v1`/`v2` contract and `benchmark-report` are unchanged; no corpus migration was
  performed or implied.
- CI (three-OS matrix) for this branch is reported only after its runs are observed green.
- Aporia is not production-ready, provider-validated, or independently reviewed.
