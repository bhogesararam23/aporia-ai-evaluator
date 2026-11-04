# Agent Session Report — 2026-11-04 — Local core v0.5 evidence integrity and evaluation reliability

This is the running record for the v0.5 milestone. It states what was actually observed in the
checkout, what was verified by running, and what stays unverified. A row is moved to `Done` only when
a test exists that would fail without the change. No claim here is backed by documentation alone.

## 1. Session metadata

- Date/time and timezone: 2026-11-04, local machine time
- Task: finish evidence identity (ADR-025), add cross-platform CI, benchmark curation workflows,
  reliability and accessibility hardening, and documentation — local core v0.5
- Repository: `bhogesararam23/aporia-ai-evaluator`
- Branch: `feat/aporia-local-core-v0.5-evaluation-reliability`
- Starting commit: `6fcfff3ca1a24e02ad3e7494a7ab995c8fbf4b36` (`origin/main`)
- Operating model: local-first, single operator, loopback only, no provider/network/auth/fabrication

## 2. Actual starting state (verified, not assumed)

| Check | Observed |
|---|---|
| `git fetch origin --prune` | `origin/main` moved `638f0a3 → 6fcfff3` — PR #7 (evidence-aggregation-v2) is **merged** (merge commit; the two PR #7 commits are ancestors, so not squashed) |
| Starting tree | clean; `HEAD` on `fix/aporia-evidence-corroboration-by-source` @ `4322010`, 1 behind `origin/main`, 0 ahead |
| `evidence-aggregation-v2` present on `main` | yes (`EVIDENCE_RULE_VERSION_V2` in `src/core/versions.ts`); default `EVIDENCE_RULE_VERSION` is still `v1` |
| `npm test` at baseline | **701 tests, 701 pass, 0 fail** (re-measured on this checkout, not carried forward) |
| Node | v24.13.1; `.nvmrc`/`engines` ask 24 |

The brief's premise (finish ADR-025) is accurate: PR #7 delivered the RELATED/source-id collapse but
**not** ADR-025 §1 rule 1 (two records of one underlying document recognised by a shared canonical URI),
and the canonical URI was never carried to the rule. That is the objective-1 gap.

## 3. Objective 1 — finish evidence identity (Done)

- `underlyingSourceIdentity` (`src/core/evidence.ts`): a conservative, dependency-free identity for the
  source behind a record. A full `canonicalUri` is normalised (scheme/host lower-cased, default port and
  leading `www.` dropped, fragment removed, known tracking query parameters dropped, remaining
  parameters sorted, trailing path slash stripped, path case preserved); a missing or unparseable URI
  falls back to the record's own `sourceId`, so nothing merges on a guess.
- `evidence-aggregation-v2` groups supporting records by that identity **in addition to** excluding
  `RELATED` rows, so two source records reaching the same document corroborate once. The status
  precedence is unchanged; `v1` output is byte-identical; `apparentCorroboratingSourceCount` still names
  the `v1` figure so the disagreement is visible.
- The canonical URI is threaded through the whole path: `activeRelationshipsForProposition`, the
  achievements evidence query, and the report `snapshot` mapper now populate
  `EvidenceRelationshipRecord.canonicalUri`. No schema change (`sources.canonical_uri` already existed).
- **Default stays `v1`; ADR-025 stays Proposed.** Flipping `EVIDENCE_RULE_VERSION` is the owner's
  decision and remains a single, atomic change.

Tests (all fail against the relevant prior behaviour): `tests/unit/source-identity.test.ts` (7),
`tests/unit/evidence-aggregation-v2.test.ts` (+4 shared-canonical cases), and the DB-to-core path case in
`tests/integration/repositories-evidence.test.ts`.

## 4. Objective 3 — cross-platform CI (Done and verified by CI)

`.github/workflows/ci.yml` now runs Node 24 `npm run check` and `npm run verify:workflow` as a
Windows / Linux / macOS matrix with `fail-fast: false`. This is the live-workflow cross-platform
evidence v0.4 recorded as not run. Confirmed on the pushed checkpoint (run
`41807701771`, conclusion `success`): `check` passed on all three OSes, and the 25-step
`npm run verify:workflow` passed end to end on Windows, Linux and macOS runners. A platform that
cannot bind a loopback port would fail the job rather than pass vacuously; none did.

## 5. Objective 4 — reliability and accessibility (audit started)

Two new structural accessibility guards were added to the shared page-walking checks and pass on every
visited page: every `<a href>` has an accessible name, and no element uses a positive `tabindex`.

The audit surfaced one **real, unfixed defect**: duplicate `id` attributes where the same form is
rendered once per record (run detail, statement workspace) — the shared field helpers emit a static
`field-<name>` id for every instance, so a page can repeat `field-reviewer` etc. up to 11 times and every
`<label for>` / `aria-describedby` but the first resolves to the wrong control. Form submission is
unaffected (fields post by `name`), so the functional suite never caught it. Fixing it needs a per-form
id scope threaded through the repeated-form renderers; it is recorded in
`docs/KNOWN_LIMITATIONS.md §7` and scheduled as a focused follow-up rather than asserted by the shared
check (which would fail today).

Durability, concurrency, failure injection, migration and backup/restore already have measured tests from
v0.4 (`write-atomicity`, `audit-atomicity`, `migrations`, `backup-restore`); no additional gap was
asserted without a failing test to back it.

## 6. Objective 2 — benchmark curation workflows (not started)

Not begun. Must not fabricate reviewers, gold cases or accuracy; the harness still refuses an accuracy
claim over an empty/synthetic corpus.

## 7. Commit ledger

Every pushed checkpoint was preceded by a green `npm run check`. Local count re-measured by glob: **713
tests — 393 unit, 320 integration** (baseline at session start was 701).

| # | Commit | Area | Summary |
|---|---|---|---|
| 1 | `824fbef` | feat(core) | underlying-source identity; v2 counts corroboration by it; v1 unchanged |
| 2 | `643ff1e` | feat(evidence) | canonical URI threaded DB→core→report; integration test |
| 3 | `16223a6` | docs(adr-025) | record §1 rule 1 implemented; still Proposed, still not default |
| 4 | `fcdd9da` | ci | Node 24 check + live workflow across Windows/Linux/macOS |
| 5 | `040d0ee` | docs(session) | open the v0.5 audit, traceability and commit ledger |
| 6 | `f071a6e` | docs(session) | record checkpoint-1 CI verified across three OSes |
| 7 | `737eeff` | docs(testing) | re-measure 713 (393/320); record three-OS CI |
| 8 | `098971e` | test(a11y) | link accessible-name + no-positive-tabindex guards (pass) |
| 9 | `fe1a92a` | docs(limitations) | record the duplicate field-id accessibility defect from the audit |

Checkpoints pushed: #1 = commits 1–4 (`fcdd9da`), #2 = commits 5–7 (`737eeff`), #3 = commits 8–9.
Pull request **#8** opened (unmerged), scoped honestly: Objectives 1, 3, 5 and partial 4 done; Objectives 2
and the remainder of 4 in progress.

## 8. What is NOT claimed


- Evaluator accuracy is not established and no gold corpus is asserted; the benchmark harness still
  refuses accuracy over an empty corpus.
- `evidence-aggregation-v2` is not the default and no stored verdict is recomputed.
- Cross-platform CI (checks and the live workflow) is verified on the checkpoint-1 run; later
  checkpoints are only reported as passing when their own runners are green.
- Aporia is not production-ready, provider-validated, or independently reviewed.
