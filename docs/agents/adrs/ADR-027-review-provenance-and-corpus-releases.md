# ADR-027: Persist Review Provenance, Bind Adjudications to Their Disagreement, and Freeze Corpora as Deterministic Releases

- Status: Proposed — **implemented and tested, not owner-accepted**; additive local tooling only
- Date: 2026-11-05
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-026, ADR-020, ADR-022, ADR-015, ADR-025, ADR-013, ADR-017
- Baseline: `main` at `2b1ecab92d6b343398a6b4001ee3da179dbaa29b` (merged v0.6, PR #9)
- Design: [Review Provenance and Corpus Releases](../../technical/BENCHMARK_PROVENANCE_AND_CORPUS_RELEASES.md)

## Context and problem

ADR-026 shipped the offline review workflow and claimed it was honest. Five properties of the merged code
contradicted that claim. Each was reproduced against `2b1ecab`, not read off a session report.

1. **A validated rationale was thrown away.** `mergeSubmission` required `annotation.rationale` to be
   non-blank and then constructed the stored label with `note: null`. A probe submission carrying
   `"Careful human rationale number 0 explaining why."` merged successfully and the merged label contained
   no trace of it. A gold label with no reason cannot be re-reviewed, which is the reason ADR-020 made the
   rationale mandatory in the first place.
2. **Submission time and packet binding were discarded.** `submittedAt` and `packetHash` were both checked and
   neither stored; the merged label carried exactly `reviewer, dimension, label, subjectId, note`. After a
   merge it is impossible to say when a reviewer submitted or which frozen input their judgement answered.
3. **The declared roster was not enforced where it mattered.** `validateReviewerLabels` refused a label whose
   reviewer was absent from `provenance.reviewedBy`, but `mergeSubmission` never consulted it. A submission
   from `sam` on a case declaring `['dana']` merged, and the resulting case then failed
   `validateBenchmarkCase` with five issues. **`benchmark:case merge` was writing a corpus that
   `benchmark:case validate` rejects**, and did so without a single test failing — because the v0.6 review
   fixtures were themselves not valid cases (they had statements and no `citations` array), so the suite could
   not notice.
4. **An adjudication was not bound to the disagreement it settled.** `applyAdjudication` recomputed the
   *current* `disagreementReport` and only checked `status === 'UNRESOLVED'`. A decision written against one
   split therefore settles a different split, as long as both happen to be unresolved at the moment of
   application. The template it was issued from named the subject and nothing else.
5. **A batch was neither atomic nor recoverable.** `mergeSubmissions` applied what it could and the CLI wrote
   straight into `--out`. One defective file in an import produced a partially-updated corpus, with no dry run,
   no staging, and no way to tell which files had already been replaced.

Separately, the corpus had no release story: nothing could answer "is this the exact set of cases the last
report was computed from?", and readiness could be described in a way a reader might mistake for accuracy.

## Decision

1. **Persist review provenance as optional additive case fields, with no contract bump.**
   `BenchmarkReviewerLabel` gains `rationale`, `submittedAt`, `packetHash`, `submissionHash`;
   `BenchmarkAdjudication` gains `disagreementHash`, `adjudicatedAt`. All are optional, so every
   `benchmark-case-v1`/`v2` file written before this milestone reads unchanged and **no migration exists to
   run**. Absence means *not recorded*, never *recorded as empty*. A case-contract bump to `v3` was considered
   and rejected (Alternatives 1).
2. **Enforce the roster at merge, and never authorise from the tool.** `mergeSubmission` refuses a reviewer
   who is not canonicalised in `provenance.reviewedBy`, and never writes to that list. An empty roster
   authorises nobody. Authorisation is a human edit to the case, which changes the case bytes and so surfaces
   in a release verify or diff. A read-only `roster` subcommand reports declared-vs-used and cannot close the
   gap it reports.
3. **Canonicalise reviewer identity everywhere it is compared.** One function, `reviewerIdentity`, folds case
   and collapses whitespace, and is used by merge, duplicate detection, agreement counting, the audit, the
   validator and the release gates. Without it `Sam`, `sam` and `SAM ` become three reviewers and one person
   manufactures the two-reviewer consensus the rule exists to require. It collapses *spellings*; it cannot
   prove two distinct names are two distinct people, and every output says so.
4. **Bind an adjudication to the disagreement it settles.** `disagreementHash` is a canonical SHA-256 over
   `{packetHash, dimension, subjectId, entries}` — the frozen input, the subject, and every reviewer label on
   it. `benchmark-adjudication-v2` requires it; `applyAdjudication` refuses a decision whose binding does not
   match the current state, so a stale decision cannot settle a different split. Resolution is implemented
   **once**, in `src/benchmark/provenance.ts`, and consumed by both `review.disagreementReport` and
   `scoring.agreementRows`: the two previously resolved adjudications independently and would have disagreed
   about whether a subject was settled. A bound record outranks an unbound one, so a drifted decision cannot be
   masked by an older entry. Applying never deletes the record that went stale.
5. **Keep `benchmark-report-v2` by adding fields, never statuses.** `AgreementRow.status` values are unchanged
   — adding one would break any reader that switches on it — and staleness is disclosed through
   `adjudicationBinding` plus `excludedStaleAdjudication` / `excludedUnboundAdjudication`. A stale subject is
   excluded from agreement through the existing unresolved path, so a stale decision cannot inflate a rate.
6. **Make a batch atomic by default, staged, and recoverable.** `planBatchMerge` / `planBatchAdjudication`
   produce a hashable plan with per-item accept/refuse reasons and the exact bytes to be written. The CLI
   materialises them in `<out>.staging/`, journals `staged → committing → committed`, and publishes each file by
   temp-write plus rename. `--dry-run` writes nothing at all; one refusal (including a **malformed input file**)
   writes nothing to the target; `--allow-partial` is the explicit opt-in to the old behaviour and prints every
   accepted and rejected item; `--recover` rolls back a `staged` journal or completes a `committing` one, and a
   journal whose plan no longer matches the inputs is refused rather than published from. Changing the v0.6
   default is a deliberate compatibility break, recorded here, and the v0.6 CLI assertions were updated rather
   than deleted, with the old behaviour re-pinned under `--allow-partial`.
7. **Freeze a corpus as a deterministic release.** `benchmark-release-manifest-v1` carries per-case content
   hashes, a corpus digest, a content-derived release id (`release-<corpusHash12>`), and named
   provenance/completeness gates. It contains no clock value, no absolute path, no hostname and no execution
   ordering, so the same corpus always produces the same bytes. `verify` detects additions, removals, edits,
   duplicate case ids and contract drift; `diff` compares two releases. `--snapshot` is opt-in because copying
   claim and evidence text into a second directory is a privacy event, not a formatting one.
8. **Hashes are integrity checks, and readiness is not accuracy.** The manifest itself carries
   `integrityNote` (a digest detects a changed file; it authenticates no reviewer and proves no material
   genuine) and `accuracyClaimable: false` with its reason. `allAdjudicationsBound` is deliberately
   **non-blocking** and **fails** while any legacy unbound record stands, so a release cannot be described as
   provenance-verified on the strength of records that predate binding.
9. **Ordering that reaches a digest is code-unit ordering, not locale collation.** `canonicalise` and the
   roster/hash sorts previously used `localeCompare`, whose result depends on the ICU build and `LANG` of the
   machine. Because release reproducibility rests on these digests, one corpus could have frozen into two
   different manifests on two CI runners. Sorting is now by UTF-16 code unit throughout
   (`hashing.ts`, `provenance.ts`, `authoring.ts` share one canonicaliser). **Consequence: packet and case
   hashes computed by v0.6 tooling differ from v0.7 ones**, so a packet issued before this change must be
   re-issued. No real packet exists — no review has been performed — so nothing is invalidated in practice.
10. **Boundaries unchanged.** Everything new in `src/benchmark/` remains pure: `core` and `node:` builtins only
    (ADR-022), no network, no database, no provider, no clock. All filesystem work stays in `scripts/`, where
    corpus loading is now shared by both CLIs (`scripts/corpus-io.ts`) so the two cannot disagree about what a
    malformed file means.

## Alternatives considered

1. **Bump the case contract to `benchmark-case-v3` and migrate.** Rejected: the new fields are optional and
   additive, so a v3 would force a migration with no data to migrate, and would invalidate every existing case
   file for a documentation win. The brief's "introduce new versions only where necessary" binds here.
2. **Store the rationale in the existing `note` field.** Rejected: `note` is a v0.6 slot hand-written cases
   already use for free-form remarks. Overloading it makes "the rubric requires a rationale" and "the reviewer
   added a remark" the same fact, and loses the distinction on older files.
3. **Let merge append the reviewer to `provenance.reviewedBy`.** Rejected outright: that is the tool authorising
   who may review, which is the owner's decision, and it would erase the very evidence a release needs to show
   that an authorisation changed.
4. **Accept unbound v1 adjudications silently, or reject them entirely.** Rejected both: silently accepting
   keeps the defect, and rejecting them invalidates readable v0.6 cases. Honouring them while labelling them
   `UNBOUND` and failing the disclosure gate is the position that is simultaneously compatible and honest.
5. **Partial-apply as the default with `--atomic` opt-in.** Rejected: the unsafe behaviour would remain the path
   of least resistance, and the defect being closed is precisely that a defective import half-wrote a corpus.
6. **Duplicate the corpus into every release by default.** Rejected: benchmark material can contain sensitive
   claims and evidence excerpts; a freeze should not silently copy it somewhere else the operator did not
   protect. Opt-in `--snapshot` keeps the reproducibility option without the default privacy cost.
7. **Extend `AgreementRow.status` with `STALE_ADJUDICATION`.** Rejected: it is a compatibility break for report
   readers, and the additive `adjudicationBinding` field carries strictly more information.
8. **Put the corpus-release commands under `benchmark:case`.** Rejected: that script was already 565 lines and
   mixes concerns; a separate `benchmark:release` keeps each CLI focused, per the isolation guidance in
   `MODULE_BOUNDARIES.md`.

## Consequences and trade-offs

- Reviewer work is now attributable: a merged case says who, when, against which frozen input, and why.
- Authorising a reviewer is an explicit, visible, human act, and the roster gap is reportable and gated.
- A stale adjudication is detected rather than trusted; the disagreement it failed to settle stays unresolved
  until a human files a fresh decision against the current state.
- An import is all-or-nothing unless the operator says otherwise, and an interrupted one is recoverable to the
  same bytes an uninterrupted run would have produced.
- The v0.6 CLI default changed. Scripts that relied on partial writes now exit non-zero and write nothing.
- Two artifact versions were added (`benchmark-submission-v2`, `benchmark-adjudication-v2`) and two new file
  formats (`benchmark-release-manifest-v1`, `benchmark-batch-journal-v1`). Each is a compatibility surface to
  maintain, exactly as the case contract is.
- A release manifest is a new document an operator can quote. Its `integrityNote` and
  `accuracyClaimable: false` exist because the quotation risk is real.
- **None of this validates the evaluator.** No case, reviewer, timestamp or label is real; no gold set exists;
  `accuracyClaimable` is false in the audit, the report and every manifest.

## Security, privacy, safety, and evaluator-validity implications

- Loopback-only, single-operator, offline (ADR-012). No new surface: no network, no authentication, no
  database, no provider, no remote publishing.
- Submissions, adjudication forms, manifests and journals are untrusted input. Each is coerced or refused
  before the pure layer sees it, and `applyAdjudication` additionally treats every field defensively, because a
  caller that bypasses the CLI must get a refusal rather than a `TypeError`.
- Storage authorisation and reviewed-at are read from case provenance and gated; nothing asserts a reviewer's
  independence, authority or identity beyond what the operator recorded.
- `--snapshot` duplicates corpus material and the CLI says so on the record. A freeze without it copies nothing.
- Journals and manifests carry no absolute paths, so a shared release document leaks no filesystem layout.
- Evaluator validity is unchanged and still unestablished. Readiness, coverage, agreement and gate results are
  never accuracy, and the release format now states that in the artifact rather than only in prose.

## Implementation and migration plan

1. `src/benchmark/hashing.ts` (new) — `canonicalise`, `contentHash`, `isContentHash`; code-unit key ordering.
2. `src/benchmark/types.ts` — v0.7 version constants; the additive case fields; submission contracts moved in.
3. `src/benchmark/provenance.ts` (new) — identity, roster, label provenance, state hash, binding resolver.
4. `src/benchmark/review.ts` — provenance-preserving merge, roster check, submission v1/v2, bound templates,
   guarded `applyAdjudication`, binding-aware report and audit; `mergeSubmissions` removed in favour of the plan.
5. `src/benchmark/batch.ts` (new) — pure planning, staged rendering, journal state machine.
6. `src/benchmark/release.ts` (new) — hashing, manifest, verify, compare, gates.
7. `src/benchmark/validate.ts`, `scoring.ts`, `report.ts`, `authoring.ts` — new optional fields, canonical
   roster comparison, shared resolver, additive disclosure, one canonicaliser.
8. `scripts/corpus-io.ts`, `scripts/benchmark-case.ts`, `scripts/benchmark-release.ts` (new), `package.json`.
9. Tests: unit for each rule, integration for the CLI lifecycles, crash recovery and v0.6 compatibility.
10. Docs: this ADR and its index row, the design document, README, Implementation Status, Roadmap, Known
    Limitations, Testing, the annotation rubric, the validation plan, the runbook, module boundaries, session
    report.

**No corpus migration.** No release tooling has been run against real material, so there is nothing to
convert; older case files and older submission files are read as-is.

## Tests and validation required

- A merged label carries the rationale verbatim, the reviewer's timestamp (v1 as recorded, v2 normalised to
  UTC), the packet hash and the submission hash; a rejected merge leaves the case byte-identical and a merged
  case passes `validateBenchmarkCase` with zero issues.
- An undeclared reviewer is refused naming `provenance.reviewedBy`; an empty roster refuses; alias spellings of
  a declared reviewer merge as one identity; a duplicate alias is refused; `reviewedBy` is never widened.
- The state hash is stable under reordering and moves on a label change, a reviewer change or an input change;
  `MATCHING`/`STALE`/`UNBOUND` resolve as specified and `review.ts` agrees with `scoring.ts` on every subject;
  a stale subject supplies no label, stays unresolved and is re-adjudicable; filing does not stale a decision.
- A plan is order-independent; atomic-with-a-refusal applies nothing; isolated applies the accepted items and
  reports every reason; staged rendering is byte-stable and LF-only; journal transitions are one-way.
- CLI: `--dry-run` creates no target and no journal; an atomic refusal writes nothing; `--allow-partial`
  applies accepted items; a `staged` journal rolls back; a `committing` journal completes to bytes identical to
  an uninterrupted run; `--recover` with a mismatched plan refuses; `--recover` with no journal says so.
- Releases: manifest bytes identical across runs and independent of a stubbed clock and working directory; no
  path, hostname or timestamp appears; only basenames are recorded; verify isolates add/remove/change and
  duplicate ids; diff reports case, stratum and authorisation deltas; every gate can fail alone and names the
  cases; `allAdjudicationsBound` fails-but-does-not-block on a legacy record; `accuracyClaimable` is `false`.
- Compatibility: v0.6 `benchmark-submission-v1` with a date-only timestamp still merges; a
  `benchmark-case-v1` file still validates and an unscoped `adjudication` is refused with the same v0.6 reason;
  `benchmark-report-v2` is unchanged in version and status vocabulary; v0.6 packet hashing is unchanged in
  contract; the report over a legacy corpus keeps every pre-existing key.
- Malformed and hostile input: non-array `annotations`, a `null` annotation, a numeric `label`, a wrong-length
  hash, a non-string adjudication field — each refused with a printed reason and no stack trace.
- Boundaries: no `benchmark` import of `persistence`, `reporting`, `app` or `website`; no non-`node:` dependency.

## Validation actually performed

- `npm run check` — **pass**, 945 tests (582 unit / 363 integration), 0 fail; typecheck, eslint, prettier and
  `check-boundaries` all clean.
- `npm run verify:workflow` — **pass**, 25 steps `[PASSED]`, 0 `[FAILED]`.
- `npm run benchmark` on the isolated fixture corpus — **pass**.
- Windows local run only. The Linux and macOS results are CI evidence, reported per job, and any job that did
  not finish is reported as not finished.

## Open questions for the owner

1. Is changing the batch-merge default from partial-apply to atomic acceptable, given it breaks v0.6 scripts
   that relied on partial writes?
2. Should `allAdjudicationsBound` stay non-blocking, or should a corpus carrying legacy unbound decisions be
   un-releasable until they are re-adjudicated?
3. Is a content-derived release id sufficient provenance, or does the owner want a signed external record —
   which this design explicitly does not provide and cannot without a trust root it does not have?
