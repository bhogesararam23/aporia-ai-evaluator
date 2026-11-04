# v0.7 Requirements Traceability — Review Provenance, Benchmark Governance and Reproducible Corpus Releases

- Status: Audited against this checkout on 2026-11-05
- Scope: the requirements of the local core v0.7 milestone — review provenance (§1), reviewer roster and
  identity (§2), adjudication binding (§3), batch semantics (§4), corpus releases (§5), compatibility (§6),
  honesty boundaries and verification (§7)
- Related: [Implementation Status](../IMPLEMENTATION_STATUS.md), [ADR-027](../agents/adrs/ADR-027-review-provenance-and-corpus-releases.md),
  [design document](../technical/BENCHMARK_PROVENANCE_AND_CORPUS_RELEASES.md),
  [v0.7 session report](../agents/sessions/2026-11-05-local-core-v0.7-review-provenance-corpus-releases.md),
  [v0.4 traceability](V04_REQUIREMENTS_TRACEABILITY.md)

Each row names the code that satisfies the requirement and the check that would fail if it did not. "Test"
means an automated check that ran; "run" means an observed result recorded in the session report. Nothing
here is asserted from documentation, and no row claims a review, reviewer or corpus that does not exist.

## 1. Review provenance

| Requirement | Implementation | Check |
|---|---|---|
| A reviewer's rationale survives merge | `reviewerLabelFromAnnotation` in `src/benchmark/provenance.ts`, called by `mergeSubmission`; the case contract gained an optional `rationale` | `tests/unit/benchmark-label-provenance.test.ts`; `benchmark-review-merge-provenance.test.ts` ("a merged label keeps the rationale…") |
| The reviewer's own timestamp survives merge and round-trips to disk | `submittedAt` stored on the label; `normaliseCase` writes it, the validator reads it back | `benchmark-review-merge-provenance.test.ts` ("provenance survives a write-and-reread round trip") |
| A merged label is tied to the packet it answered | `packetHash` stored per label, taken from `buildReviewerPacket` | same file; `benchmark-v06-compatibility.test.ts` for the v1 case |
| Labels are traceable to the submission record they arrived in | `submissionHash` = `contentHash` over the parsed submission (`provenance.submissionHash`) | `benchmark-label-provenance.test.ts` (key-order stability, rationale-edit and annotation-order sensitivity) |
| Nothing supplied by the reviewer is invented or filled in | blanks are refused with a reason in `mergeSubmission`; `isoDateTime` is the only normalisation and only for v2 | `benchmark-review-merge-provenance.test.ts` (blank reviewer, blank timestamp in both versions) |
| A v1 submission file keeps its lenient timestamp rule | version-conditional check in `mergeSubmission`; v1 value persisted verbatim | `benchmark-review-merge-provenance.test.ts` ("a v1 submission … is stored verbatim"); `benchmark-v06-compatibility.test.ts` |
| A v2 submission requires a real instant, normalised to UTC | `BENCHMARK_SUBMISSION_VERSION_V2` + `core/validation.isoDateTime` | same file ("must carry a real instant", "normalised to UTC, so two offsets for one instant agree") |
| Absent provenance means *not recorded*, never *empty* or *verified* | all four fields optional in `types.ts`; `validate.ts` checks each only when present | `benchmark-contracts.test.ts` (compile-time optionality); `benchmark-validate-provenance.test.ts` ("a v0.6-shaped label … produces no issues at all") |

## 2. Reviewer roster and identity

| Requirement | Implementation | Check |
|---|---|---|
| Merge refuses a reviewer the case does not declare | roster branch in `mergeSubmission` using `declaredRoster` / `isDeclaredReviewer` | `benchmark-review-merge-provenance.test.ts`; `benchmark-roster.test.ts`; lifecycle "an undeclared reviewer is refused end to end" |
| Merge never authorises anyone | no write path to `provenance.reviewedBy`; refusal tells the operator the edit is human | `benchmark-roster.test.ts` ("reading the roster never mutates the case"); merge refusal asserts `reviewedBy` unchanged |
| An empty roster authorises nobody | separate refusal branch, distinct message | `benchmark-roster.test.ts`; `benchmark-review-merge-provenance.test.ts` |
| One person cannot be two reviewers by respelling | `reviewerIdentity` used by merge, duplicate detection, `disagreementReport`, `auditCorpus`, scoring, roster and release gates | `benchmark-reviewer-identity.test.ts`; `benchmark-scoring-binding.test.ts` (alias pair is `NOT_ENOUGH_REVIEWERS`); `benchmark-release.test.ts` (alias corpus fails `twoReviewersPerCase`) |
| Identity folding is locale-independent | `toLowerCase`, never `toLocaleLowerCase`; sorts use `compareStrings` (code unit) | `benchmark-reviewer-identity.test.ts` (non-Latin names); `benchmark-roster.test.ts`; `benchmark-hashing.test.ts` |
| A reviewer-label set survives a wrong-typed entry | `rosterNamesOf`/`reviewerLabelsOf` skip malformed rows rather than crashing | `benchmark-review-malformed.test.ts` |
| The roster gap is visible without being closable by the tool | `rosterGaps` + read-only `roster` subcommand | `benchmark-roster-cli.test.ts` (asserts the corpus file is byte-identical afterwards) |

## 3. Adjudication binding

| Requirement | Implementation | Check |
|---|---|---|
| A decision names the disagreement it settles | `disagreementStateHash` over packet hash, dimension, subject and every label on it; stored as `disagreementHash` | `benchmark-adjudication-binding.test.ts`; `benchmark-review-adjudication-stale.test.ts` |
| A stale decision cannot be applied | binding comparison in `applyAdjudication`, refusal before any change | `benchmark-review-adjudication-stale.test.ts` ("refused and changes nothing"); `benchmark-batch-cli.test.ts` and the lifecycle suite for the CLI path |
| A stale stored decision does not settle its subject | resolver rule 2; `STALE` leaves status `UNRESOLVED` and contributes no label | `benchmark-review-disagreement-binding.test.ts`; `benchmark-scoring-binding.test.ts` |
| A legacy unbound record is readable and explicitly unbound | resolver rule 3 → `UNBOUND`; report row and `AgreementRow.adjudicationBinding` disclose it | `benchmark-adjudication-binding.test.ts`; `benchmark-v06-compatibility.test.ts` |
| Unbound records are never credited as verified in a release | `allAdjudicationsBound` gate, `passed: false`, `blocking: false` | `benchmark-release.test.ts` |
| The report and the scorer cannot disagree about settlement | one `resolveSettlingAdjudication`, consumed by `disagreementReport` and `agreementRows` | `benchmark-scoring-binding.test.ts` ("the scorer and the disagreement report agree on every subject") |
| Filing a decision does not stale itself | the count of existing decisions is deliberately outside the hash (spec §3.2) | `benchmark-adjudication-binding.test.ts` ("filing an adjudication does not move the state hash") |
| Append-only: a stale record is kept, not erased | `applyAdjudication` appends; no deletion path | `benchmark-adjudication-binding.test.ts` (mixed bound+unbound precedence); stale-then-fresh test |
| An adjudicator is also roster-checked | `isDeclaredReviewer` guard in `applyAdjudication` | `benchmark-review-adjudication-stale.test.ts` |

## 4. Batch semantics

| Requirement | Implementation | Check |
|---|---|---|
| Atomic across the whole batch by default | `finishPlan` returns the input cases unchanged when any item is refused | `benchmark-batch-plan.test.ts` |
| Atomic across filesystem output too | `publishBatch` refuses to write when `rejectedCount + malformed > 0` | `benchmark-batch-cli.test.ts`; `benchmark-review-cli.test.ts` (updated v0.6 expectations) |
| A malformed input file counts as a refusal | malformed list folded into the same gate | `benchmark-batch-cli.test.ts` ("merge refuses a malformed submission file…") |
| `--dry-run` writes nothing, including no journal | early return before any `mkdirSync`/write | `benchmark-batch-cli.test.ts` (target absent, no `<out>.staging`) |
| Staged output, then publish | `renderStagedCorpus` + `<out>.staging/` + per-file temp write and `renameSync` | `benchmark-batch-plan.test.ts` (pure rendering); `benchmark-batch-cli.test.ts` (no staging residue) |
| Failure recovery: rollback or resume | journal `staged → committing → committed`, `--recover` reads it; resume skips files whose content hash already matches | `benchmark-batch-cli.test.ts` (both branches; recovered bytes equal a clean run) |
| Recovery cannot mix two batches | plan-hash comparison, refusal otherwise | `benchmark-batch-cli.test.ts` ("recovery refuses when the inputs no longer match") |
| `--allow-partial` is explicit and reports every item | `mode: 'isolated'`; `reportPlan` prints `ACCEPTED`/`REJECTED` with all reasons | `benchmark-batch-plan.test.ts`; `benchmark-batch-cli.test.ts` |
| The plan does not depend on input order | items ordered by case, canonical reviewer and submission hash | `benchmark-batch-plan.test.ts` ("the plan is independent of submission order") |
| One person cannot submit twice in a batch | duplicate detection across the run, canonical identity | `benchmark-batch-plan.test.ts`; `benchmark-review-cli.test.ts` |

## 5. Corpus releases

| Requirement | Implementation | Check |
|---|---|---|
| Deterministic, environment-independent manifest | `buildReleaseManifest` with no clock/path/env input; canonical JSON out | `benchmark-release.test.ts` (stubbed `Date.now`/`process.cwd`, hostname absent); `benchmark-release-cli.test.ts` (re-freeze byte-identical; temp root not present) |
| Reproducible case digests | `caseContentHash` over `normaliseCase`; `canonicalise` sorts by code unit | `benchmark-hashing.test.ts`; `benchmark-release.test.ts` |
| Release identity derives from content | `releaseId(corpusHash)`; `--label` stored separately | `benchmark-release.test.ts` ("a supplied label … never enters the release id") |
| Freeze refuses an invalid corpus | `freeze` exits non-zero with issues, writes no manifest | `benchmark-release-cli.test.ts` |
| Change detection at case granularity | `verifyRelease` added/removed/changed/duplicate/contract-drift | `benchmark-release.test.ts`; `benchmark-release-cli.test.ts` (tamper → drift → restore → verify) |
| Comparison of two releases | `compareReleases` incl. strata, roster and gate deltas | `benchmark-release.test.ts` (add/change/roster pairs); `benchmark-release-cli.test.ts` |
| Provenance and completeness gates, named and actionable | `releaseGates`, each with case ids in `detail` | `benchmark-release.test.ts` (each gate fails alone); `benchmark-release-cli.test.ts` |
| Authorisation changes are visible | `declaredReviewers` per entry; roster pairs diffed | `benchmark-release.test.ts` ("removing a reviewer authorisation is visible") |
| Snapshot duplication is opt-in | `--snapshot` only; default writes the manifest alone | `benchmark-release-cli.test.ts` |
| Readiness is never accuracy | `accuracyClaimable: false` literal, `accuracyReason`, `integrityNote` | `benchmark-release.test.ts`; `benchmark-release-cli.test.ts` |

## 6. Compatibility

| Requirement | Implementation | Check |
|---|---|---|
| `benchmark-case-v1` and `v2` still read | all new case fields optional; validator checks them only when present | `benchmark-v06-compatibility.test.ts`; `benchmark-review-compat.test.ts`; `benchmark-fixture-validity.test.ts` |
| `benchmark-report-v2` unchanged in version and status vocabulary | additive `adjudicationBinding`, `excludedStaleAdjudication`, `excludedUnboundAdjudication` only | `benchmark-v06-compatibility.test.ts`; `benchmark-scoring-binding.test.ts` (allowed status set asserted) |
| Packet contract untouched | `benchmark-packet-v1` and its hash coverage unchanged | `benchmark-v06-compatibility.test.ts` |
| A v0.6 unscoped v1 adjudication is still refused *as v0.6 refused it* | `validateAdjudications` v1 branch unmodified | `benchmark-v06-compatibility.test.ts` |
| The batch default change is deliberate and documented | ADR-027 §6; v0.6 CLI assertions updated, old behaviour re-pinned under `--allow-partial` | `benchmark-review-cli.test.ts`; ADR-027 |

## 7. Honesty boundaries, performance and verification

| Requirement | Implementation | Check |
|---|---|---|
| No fabricated case, reviewer, timestamp, label or permission | every blank is refused; templates ship blank; fixtures are labelled synthetic in `tests/helpers/benchmark-fixtures.ts` | the refusal assertions across §1–§3 suites; `benchmark-fixture-validity.test.ts` |
| Offline only; no clock in the pure layer | `src/benchmark/**` imports `core` + `node:` builtins; all fs in `scripts/`; no `Date`/`process.cwd` in the release path | `scripts/check-boundaries.ts` (npm run check); `benchmark-release.test.ts` |
| Boundaries hold for six new/changed modules | unchanged `benchmark` row in `check-boundaries.ts` | `npm run check:boundaries` clean |
| Hostile input is refused, not thrown on | CLI coercion + `textOf`/tolerant readers in the pure layer | `benchmark-review-malformed.test.ts`; `assertRefused` helpers in the CLI suites |
| ADR-025 default and ADR-026 status untouched | no change to `EVIDENCE_RULE_VERSION`; ADR-026 still Proposed | `tests/unit/versions.test.ts` and the evidence-aggregation suites continue to pass unchanged |
| Whole-milestone verification | `npm run check`; `npm run verify:workflow`; `npm run benchmark` | 956 tests pass (593 unit / 363 integration); workflow 25/25 passed, 0 failed; CI green on Windows, Linux and macOS for both jobs; recorded in the session report with CI evidence |
| Pathologically nested input cannot exhaust the stack | `MAX_CANONICAL_DEPTH` + `nestsDeeperThan` refuse it in the validator, and `DepthExceededError` guards the canonicaliser; the loader distinguishes a too-deep document from malformed JSON | `benchmark-hashing.test.ts` (bounded depth, array and object, validator refusal by case index) |
