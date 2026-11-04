# v0.7 Design: Review Provenance, Benchmark Governance and Reproducible Corpus Releases

- Status: Design approved by the owner on 2026-11-05; implementation tracked in ADR-027 (**Proposed**, not owner-accepted)
- Baseline: `main` at `2b1ecab92d6b343398a6b4001ee3da179dbaa29b` (merged v0.6, PR #9)
- Scope discipline: local, offline, file-based. No network, no database, no provider, no crawling, no
  remote publishing, no authentication, no billing. No clock inside `src/benchmark` — every timestamp in
  a review artifact is human-supplied and stays marked as such.
- Owner decisions recorded here: additive provenance on `benchmark-case-v2` (no contract bump, no
  migration); atomic-by-default batch writes with dry-run, staged output and recovery; releases are
  manifest-and-hashes only unless the operator opts into a snapshot copy; corpus releases get their own
  CLI (`npm run benchmark:release`).

## 1. The defects this closes, and how each was verified

Each item below was reproduced against the merged v0.6 tree, not read off a session report.

| # | Defect | Verified evidence | v0.7 closure |
|---|---|---|---|
| 1 | A reviewer's rationale is validated then thrown away | `mergeSubmission` requires `rationale` non-blank, then emits `note: null`. Probe: text `"Careful human rationale number 0…"` → merged label `{"reviewer":"sam",…,"note":null}` | Persist verbatim in a dedicated `rationale` field; `note` keeps its existing free-form meaning |
| 2 | Submission timestamp and packet binding are discarded | Merged label keys are exactly `reviewer,dimension,label,subjectId,note`. `submittedAt` and `packetHash` are checked and never recorded | Persist `submittedAt`, `packetHash`, `submissionHash` per label |
| 3 | The declared reviewer roster is not enforced | Merge accepted `sam`, who is not in `provenance.reviewedBy`; the merged case then failed `validateBenchmarkCase` with 5 issues, so `benchmark:case merge` writes a corpus that `benchmark:case validate` rejects | Merge refuses an undeclared reviewer and never edits `reviewedBy`; a `roster` subcommand reports declared-vs-used |
| 4 | An adjudication is not bound to the disagreement it settles | `applyAdjudication` recomputes current state and only checks `status === 'UNRESOLVED'`, so a decision written against one split silently settles a different split | Bind to a state hash; reject stale; surface stale stored adjudications instead of counting them as settled |
| 5 | Batch merge is neither safe nor recoverable | `mergeSubmissions` partial-applies; CLI writes straight into `--out` with no dry-run, staging, or journal | Pure batch planner + atomic default + staged write + journal + recovery |

## 2. Data contracts

### 2.1 Case contract: additive only

`benchmark-case-v1` and `benchmark-case-v2` stay the accepted contract versions. New fields are
optional and additive, so every existing corpus file reads unchanged and no migration exists to run:

```ts
interface BenchmarkReviewerLabel {
  reviewer; dimension; label; subjectId; note;   // unchanged
  rationale?: string | null;      // rubric justification, preserved verbatim (defect 1)
  submittedAt?: string | null;    // reviewer-supplied timestamp, as recorded (defect 2)
  packetHash?: string | null;     // the packet the judgement was bound to (defect 2)
  submissionHash?: string | null; // the submission record it arrived in (defect 2)
}

interface BenchmarkAdjudication {
  dimension; subjectId; outcome; label; reason; adjudicatedBy;   // unchanged
  disagreementHash?: string | null;   // binds the decision to the exact split (defect 4)
  adjudicatedAt?: string | null;      // human-supplied, never from a clock
}
```

Because a v2 case may carry these fields and a v1 case may not, the loader must treat absence as
"not recorded", never as "empty" or "verified". `validate.ts` validates each field only when present,
so an older file produces no new issues.

### 2.2 Artifact versions

| Version | Change |
|---|---|
| `benchmark-packet-v1` | **unchanged** — `packetHash` still covers `{version, caseId, subjects, input}`, so every v0.6 packet and its hash stay valid |
| `benchmark-submission-v1` | still accepted; lenient timestamp rule preserved (non-blank, persisted as recorded) |
| `benchmark-submission-v2` | new default for templates; timestamp must be an ISO-8601 date-time with offset, normalised to UTC via `core/validation.isoDateTime` |
| `benchmark-adjudication-v1` | still accepted; a v1 entry carries no binding, so it is reported as *unbound* and keeps v0.6 behaviour |
| `benchmark-adjudication-v2` | requires `disagreementHash` and a human-supplied `adjudicatedAt` |
| `benchmark-release-manifest-v1` | new |
| `benchmark-batch-journal-v1` | new |

A v0.6 submission file still **parses and merges under the same format rules**, and its lenient timestamp
is persisted exactly as recorded; only `benchmark-submission-v2` tightens the timestamp, which is why v2
exists rather than a silent re-reading of v1. Note the one deliberate behavioural change: a v0.6-format
submission from a reviewer who is *not* in `provenance.reviewedBy` used to merge and now gets refused
(defect 3). The format contract is preserved; the unsafe acceptance is not.

### 2.3 Report compatibility

`benchmark-report-v2` is **not** bumped and its `AgreementRow.status` enum is **not** extended — adding
a status value would break a reader that switches on it. Staleness is expressed additively:
`adjudicationBinding: 'MATCHING' | 'STALE' | 'UNBOUND' | null` on the agreement row, and
`excludedStaleAdjudication` on the annotation summary. A stale adjudication is excluded from the
agreement rate through the existing unresolved path, so a stale decision can never inflate agreement.
A byte-identical-report test over a legacy corpus guards the compat boundary.

## 3. Semantics

### 3.1 Reviewer identity and the roster

One canonicalisation, `reviewerIdentity(name)`, used by merge, duplicate detection, agreement counting,
audit and release gates: trim, collapse internal whitespace, case-fold. Without it `Sam`, `sam` and
`SAM ` become three "reviewers" and manufacture a two-reviewer consensus out of one person's aliases —
the exact failure the two-reviewer rule exists to prevent.

- Merge refuses a reviewer absent from `provenance.reviewedBy`. It never appends to that list.
- An empty roster refuses every submission with a stated reason rather than defaulting to open.
- Declared-but-absent and used-but-undeclared reviewers are reported by `roster`, which reads and never writes.
- Adding a reviewer is a deliberate human edit of case provenance. That edit changes the case's content
  hash, so a release verify or diff surfaces it — authorisation cannot happen silently.
- Limitation stated everywhere: canonicalisation stops alias duplication within one operator's data. It
  cannot prove two distinct names are two distinct humans, and there is no authentication.

### 3.2 Adjudication state binding

`disagreementHash` = `contentHash` over `{packetHash, dimension, subjectId, entries: sorted
[{reviewerIdentity, label}]}`, where `entries` is every reviewer label recorded for this exact subject. It
therefore covers the frozen input, the exact split, and who said what.

How many adjudications already exist is deliberately **not** part of the hash. It was specified as covered in
the first draft of this design, and the binding tests disproved it: including it would make a decision stale
the instant it was filed, so no bound adjudication could ever settle the split it was written for. Filing a
second decision on the same split is already prevented by the first one moving the subject out of
`UNRESOLVED`, which `applyAdjudication` requires.

Resolution rule, implemented **once** in `src/benchmark/provenance.ts` and consumed by both
`review.disagreementReport` and `scoring.agreementRows` (today they resolve independently, which would
let the disagreement report and the scored report disagree):

1. An adjudication whose `disagreementHash` equals the current state hash → `MATCHING`; it settles.
2. No hash matches and at least one adjudication carries a hash → `STALE`; the subject is **not** settled, is
   excluded from agreement, is counted as unresolved by the audit and the release gates, and is
   re-adjudicable against current state. A bound record always outranks an unbound one, so a stale bound
   adjudication cannot be masked by an older unbound entry on the same subject.
3. No adjudication for the subject carries any hash, but an unbound legacy one exists → `UNBOUND`; it settles
   as in v0.6 and is flagged as unbound.

Append-only: a stale record is never deleted or rewritten. Settling a moved split adds a new adjudication,
so the record of the decision that went stale stays auditable.

`applyAdjudication` refuses, leaving the case untouched, unless: the subject exists, its current status is
`UNRESOLVED`, the supplied `disagreementHash` matches the recomputed one, the outcome is valid, a
`RESOLVED` outcome carries an in-vocabulary label and a `GENUINELY_AMBIGUOUS` outcome carries none, and
reason/adjudicator/`adjudicatedAt` are present. Adjudicating a unanimous, single-reviewer, already-settled
or stale-bound-as-current subject stays refused: an adjudication cannot manufacture a consensus.

### 3.3 Batch merge and adjudication

Pure layer (`src/benchmark/batch.ts`), no fs:

- `planBatchMerge(cases, submissions, {mode})` → per-item `{caseId, reviewerIdentity, accepted, reasons}`,
  the resulting cases if the plan were applied, and the exact file set that would be written. Deterministic;
  a plan hash covers the decisions.
- `mode: 'atomic'` (default): any refusal means nothing applies. `mode: 'isolated'` (`--allow-partial`):
  accepted items apply, refusals are reported.
- `renderStagedCorpus(cases)` → filename → canonical text map, byte-identical across platforms.

CLI layer (`scripts/benchmark-case.ts`) publishes through a journal, never in place:

1. write every file into `<out>.staging/` plus `journal.json` with `state: 'staged'`;
2. set `state: 'committing'` with the ordered item list;
3. copy each file into `<out>` via per-file temp write + `renameSync` (atomic replace on Windows, Linux and macOS);
4. set `state: 'committed'`, then remove the staging directory.

Recovery is driven by the journal, which is the only record of an interrupted run:

- `--dry-run`: steps 1–2 are computed and printed; nothing is written at all, including no journal.
- Interrupted before `committing`: a leftover `staged` journal means the target was untouched → rollback deletes the staging directory.
- Interrupted during `committing`: `--recover` re-applies exactly the journal's remaining items (idempotent by content hash, so re-copying a finished file is a no-op) and marks it committed.
- A test asserts a corpus produced by crash-then-recover is byte-identical to one produced by a clean run.

`merge` and `adjudicate` share this machinery. Existing flags and the `packet/review/audit` subcommands keep
working; the change of default from partial to atomic is deliberate and is recorded in ADR-027 because the
v0.6 CLI test asserted partial writes.

### 3.4 Corpus releases

Pure layer (`src/benchmark/release.ts`):

- `caseContentHash(aCase)` = `contentHash` over the canonical serialisation, so key order, whitespace style
  and file ordering cannot change it.
- `buildReleaseManifest(...)` → `benchmark-release-manifest-v1`: release id (derived, `release-<corpusHash12>`,
  so the same corpus always yields the same id; an operator-supplied `--label` is recorded as an assertion),
  `manifestAlgorithm`, per-case `{caseId, file, caseVersion, stratum, contentHash, bytes, reviewerCount,
  unresolvedSubjects, bindingState}` sorted by case id, `corpusHash` over the sorted per-case hashes, counts,
  gate results, `accuracyClaimable: false` with its reason, and an `integrityNote` stating that a hash detects
  content change and authenticates no reviewer and proves no material genuine.
- No clock: nothing in a manifest comes from wall time, so freezing the same corpus twice yields identical bytes.
- `verifyRelease(manifest, cases)` → added / removed / changed / unchanged / duplicate-case-id / contract-version
  drift, with `ok` true only when the corpus matches the manifest exactly.
- `compareReleases(before, after)` → which cases changed and how, strata delta, roster delta, gate delta,
  `corpusHashChanged`, and an explicit note that a difference is not an improvement.
- `releaseGates(manifest)` → named pass/fail gates: every case validates; no duplicate case id; every case
  authorised for storage; every case has a review date; no reviewer label outside the declared roster; no
  stale adjudication; every case at two or more distinct canonical reviewers; every subject annotated; no
  unresolved disagreement left. Gates are integrity, provenance and completeness. A passing gate set means the
  corpus is *consistent and reviewed as declared*, never that the evaluator is accurate.

CLI (`scripts/benchmark-release.ts`, `npm run benchmark:release`): `freeze`, `verify`, `diff`, `gates`, `help`.
Non-zero exit on any refusal. `--snapshot` (opt-in) additionally copies canonicalised case files into the
release directory; the default writes only the manifest so freezing does not silently duplicate sensitive
claim and evidence material into a second location.

## 4. Module layout

| File | Responsibility |
|---|---|
| `src/benchmark/provenance.ts` (new) | reviewer identity, roster evaluation, label provenance construction, state hash, single adjudication-binding resolver |
| `src/benchmark/review.ts` | packets, submissions v1/v2, single-submission merge, disagreement report, adjudication template/apply, audit |
| `src/benchmark/batch.ts` (new) | pure batch planning, staged corpus rendering, journal state machine |
| `src/benchmark/release.ts` (new) | case hashing, manifest build, verify, compare, gates |
| `src/benchmark/types.ts` | case-contract additions and every version string (single source, as ADR-026 established) |
| `src/benchmark/validate.ts` | validate new optional fields when present; duplicate/roster integrity |
| `src/benchmark/scoring.ts` | consume the shared binding resolver; additive agreement fields |
| `scripts/benchmark-case.ts` | fs/CLI only: roster, dry-run, staged merge/adjudicate, recovery |
| `scripts/benchmark-release.ts` (new) | fs/CLI only: freeze, verify, diff, gates |

`benchmark` may import `core` and node builtins only; all filesystem work stays in `scripts/`. The boundary
checker and the no-network test must keep passing.

## 5. Testing strategy

- **Unit**: rationale/timestamp/packet/submission persistence; roster refusal (including empty roster and
  the exact message that authorisation is a human edit); alias-duplicate reviewers (`Sam`/`sam `/`SAM`);
  v1 submission lenient vs v2 strict timestamps; malformed submissions (wrong types, missing arrays,
  prototype-ish keys, oversized); state hash stability and sensitivity; stale/`UNBOUND`/`MATCHING` binding;
  atomic vs isolated planning; staged rendering determinism; journal transitions; manifest determinism under
  reordered input; verify add/remove/change; diff strata and roster deltas; each gate independently.
- **Integration (real temp dirs, real CLI processes)**: packet → fill → merge → review → adjudicate → audit →
  freeze → verify → tamper → verify-fails → diff; dry-run writes nothing; atomic batch leaves the target
  untouched when one item is refused; `--allow-partial` applies accepted items; crash simulation then
  `--recover` yields bytes identical to a clean run; a v0.6 submission and a v1/v2 case file still merge and
  score; `benchmark-report-v2` bytes for a legacy corpus unchanged.
- **Cross-platform**: canonical JSON written with explicit `\n`; atomic replace via `renameSync`; no POSIX-only
  syscalls; path handling through `node:path`; byte-stability assertions run in CI on Linux, macOS and Windows.

## 6. Honesty boundaries (non-negotiable)

1. `accuracyClaimable: false` stays hard-coded in the audit and every manifest. No readiness, gate, agreement
   rate or hash is ever presented as accuracy.
2. No case, reviewer, timestamp, label, permission, roster entry or release note is fabricated. Blank fields are
   refused, not filled.
3. Hashes are integrity checks over recorded content. They do not authenticate a reviewer, prove independence,
   or show that material is genuine — stated in the manifest itself and in every CLI footer.
4. ADR-025's `evidence-aggregation-v1` default is untouched; ADR-026 stays **Proposed**; ADR-027 is recorded as
   **Proposed** and is not accepted on the owner's behalf.
5. No provider, crawling, remote publishing, authentication, billing or database-backed review is introduced.

## 7. Documentation to update

`README.md`, `docs/README.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/product/IMPLEMENTATION_ROADMAP.md`,
`docs/KNOWN_LIMITATIONS.md`, `docs/TESTING.md`, `docs/agents/ADR_INDEX.md` (ADR-027),
`docs/evaluator/BENCHMARK_ANNOTATION_RUBRIC.md`, `docs/evaluator/BENCHMARKING_AND_VALIDATION.md`,
`docs/technical/MODULE_BOUNDARIES.md` (new benchmark files), `docs/operations/LOCAL_RUNBOOK.md` (release and
recovery procedure), plus a dated v0.7 session report. Test counts are re-measured by glob at documentation time,
never copied forward.

## 8. Out of scope for v0.7

Database or web review UI, authenticated identity, multi-site review, automated label assistance, inter-rater
statistics beyond raw agreement, gold-set authoring, releasing the harness as a package, tamper-evident
signatures or any cryptographic claim about authorship, and remote publication of a release.
