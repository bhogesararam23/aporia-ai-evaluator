# Agent Session Report — 2026-11-02 — Local core v0.4 audit and traceability

This document is the audit record opened at the start of the v0.4 milestone. It is written before
the implementation lands, so every row states what was actually observed in the checkout and names
the file and line that proves it. Later sections of this file are updated as each defect is fixed;
a row is only moved to `Fixed` once a test exists that would fail against the old behaviour.

## 1. Session metadata

- Date/time and timezone: 2026-11-02, local machine time
- Task or request: full repository audit, evaluator-correctness fixes, benchmark integrity, retest
  provenance, persistence performance, live workflow verification, version and documentation repair
- Repository: `bhogesararam23/aporia-ai-evaluator`
- Branch: `feat/aporia-local-core-v0.4-evaluator-integrity`
- Starting commit: `43ce438c05d7059838eca7c4be5d9f9db5158097`
- Operator/context: single local operator, no provider credentials, loopback-only
- Session status: in progress

## 2. Actual starting state (verified, not assumed)

| Check | Observed result |
|---|---|
| `git fetch origin --prune` | `origin/main` moved `3fb38f4 → 43ce438` during the fetch |
| `origin/main` | `43ce438` = "Merge pull request #5 … v0.3 claim-level evaluation" |
| Brief's stated baseline `43ce438` | Confirmed accurate at the time of the fetch |
| Previously checked-out branch | `feat/aporia-local-core-v0.3-claim-level-evaluation` at `183b7f7` |
| Is `183b7f7` an ancestor of `origin/main`? | Yes — `git merge-base --is-ancestor` succeeded |
| Commits on that branch not in `main` | 0 — nothing unmerged |
| Stashes | none (`git stash list` empty) |
| Local-only branches | none; every local branch has an upstream |
| Working-tree modification | `src/persistence/migrations/009_remediation.sql` reported ` M` |
| That modification, inspected | HEAD blob, index blob and worktree hash were all `971457d4fb34363fc4089357e8ee02f198ce80ee`; `git diff` and `git diff HEAD` were both empty, and the file contains zero CR bytes. It was a stale stat entry, not an edit. The applied migration was not modified. |
| Node in use | v24.13.1 (`.nvmrc` asks for 24, `engines` asks `>=24`) |

## 3. Baseline verification gate, re-run on this checkout

Run in order after `npm ci`, all against the starting commit:

| Command | Result |
|---|---|
| `npm ci` | installed; `npm audit` reports advisories, which are recorded and not acted on in this milestone |
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm run format:check` | pass ("All matched files use Prettier code style!") |
| `npm run check:boundaries` | pass ("Module boundaries are clean.") |
| `npm test` | **571 tests, 571 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo**, 4.35s |
| `npm run check` | pass (the five commands above chained) |

The 571 figure is measured here, not copied. The count of 335 in `docs/TESTING.md` is stale and is
corrected as part of this milestone.

## 4. Requirements → implementation → test traceability

One row per major workflow. "Enforcement" names the layer that actually stops an invalid record —
application validation, repository check, or SQLite trigger. A workflow with only application
validation is enforceable through the UI but not against a hand-edited or restored database.

| # | Workflow | UI route | Domain logic | Persistence | Schema enforcement | Report path | Tests | Verified status |
|---|---|---|---|---|---|---|---|---|
| 1 | Project and entity creation | `src/app/routes/projects.ts` | `src/core/inputs.ts` | `repositories/projects.ts` | `001` triggers | project overview | `tests/integration/project-workflows.test.ts` | Implemented |
| 2 | Claims and immutable revisions | `routes/claims.ts` | `core/inputs.ts` | `repositories/claims.ts` | `002` immutability + revision triggers | run/report claim text | claim workflow tests | Implemented |
| 3 | Proposition decomposition | `routes/claims.ts` | `core/inputs.ts` | `repositories/claims.ts` | `002` | decomposition note | unit + integration | Implemented |
| 4 | Evidence recording and supersession | `routes/sources.ts` | `core/evidence.ts` | `repositories/evidence.ts` | `003` | evidence status block | evidence tests | Implemented |
| 5 | Human proposition assessment | `routes/claims.ts` | `core/vocabulary.ts` | `repositories/claims.ts` | `005` label-dimension trigger | assessed counts | assessment tests | Implemented |
| 6 | Query-set creation, approval, cloning | `routes/querySets.ts` | `core/lifecycle.ts` | `repositories/querySets.ts` | `004` | run configuration | query-set tests | Implemented |
| 7 | Run creation and manual capture | `routes/runs.ts` | `core/inputs.ts` | `repositories/runs.ts` | `004` open-run + immutability triggers | run detail, coverage | run tests, v0.3 manual workflow (partial) | Implemented, workflow partly unverified |
| 8 | Citation recording and voiding | `routes/runs.ts:1245` → `repositories/runs.ts:539` | `core/metrics.ts` | `repositories/runs.ts` | `004` void-reason triggers | citation block | run tests | **Defect D-3: voiding does not consider `answer_claim_citations`** |
| 9 | Observation-level assessment | `routes/runs.ts` | `core/metrics.ts` | `repositories/runs.ts` | `005` | observation metrics | metrics tests | Implemented |
| 10 | Answer-statement decomposition | `routes/answerClaims.ts` | `core/answerClaimInputs.ts` | `repositories/answerClaims.ts` | `008` quote/offset triggers | statement list | claim tests | Implemented |
| 11 | Answer-statement revisions | `routes/answerClaims.ts` | same | `repositories/answerClaims.ts:556` | `008` supersedes triggers | revision number shown | claim revision tests | Implemented |
| 12 | Statement→proposition mappings | `routes/answerClaims.ts` | `core/answerClaimInputs.ts:306` | `repositories/answerClaims.ts:645` | `008` project + supersede pair triggers | `propositionLinks` | link tests | **Defect D-5: relation is never checked against statement relevance** |
| 13 | Statement→citation mappings | `routes/answerClaims.ts` | `core/answerClaimInputs.ts:336` | `repositories/answerClaims.ts:772` | `008` same-observation trigger | `citationSupports` | link tests | Implemented at link time; see D-3 |
| 14 | Fidelity and attribution assessments | `routes/answerClaims.ts` | `core/answerClaimInputs.ts:372` | `repositories/answerClaims.ts:914` | `008` `answer_claim_assessments_label_matches_dimension` | `labels` | v0.3 `fix(metrics)` commit 6913871 | **Defect D-1: label axis checked, label-vs-relevance not** |
| 15 | Metric computation | — | `core/metrics.ts`, `core/claimMetrics.ts` | — | — | snapshot + views | 571-test baseline | **Defects D-1, D-2, D-4, D-5** |
| 16 | Report generation and export | `routes/reports.ts` | `reporting/snapshot.ts` | `repositories/reports.ts` | `006` version columns | `views/report.ts` | reporting tests | Implemented; see D-2 parity |
| 17 | Achievement creation, approval, export | `routes/achievements.ts` | `core/achievements.ts` | `repositories/achievements.ts` | `007` | achievement export | achievement tests | Implemented (local only) |
| 18 | Benchmark corpus validation and scoring | `scripts/benchmark.ts` | `benchmark/*.ts` | — | — | `benchmark/report.ts` | 4 benchmark test files | **Defects D-7, D-8, D-9, D-10** |
| 19 | Finding creation, update, references | `routes/findings.ts` | `core/findings.ts`, `core/findingInputs.ts` | `repositories/findings.ts` | `009` triggers 1–10, 14–17 | `mapTrackedFindings` | findings tests | **Defect D-11: transition citation unchecked** |
| 20 | Retest comparison, measurement, status | `routes/findings.ts` | `core/runComparison.ts` | `repositories/findings.ts:920`,`964` | `009` triggers 11–13 | comparison panel | findings tests | **Defects D-11, D-12, D-13, D-14** |
| 21 | Backup, verify, restore, rollback | scripts | — | `persistence/backup.ts` | `001`–`009` manifest counts | — | `backup-restore.test.ts` | Implemented; new tables need re-check after `010` |
| 22 | Project export and deletion | `routes/projects.ts` | — | `repositories/projects.ts:455` | cascade FKs | export file | project tests | Implemented |

Rows marked **Implemented** were confirmed by reading the code named in them, not by trusting a
document. Rows that say "only in isolation" would be a pure-function test with no write path; the
closest examples are the `findings-lifecycle` and `runComparison` unit tests, which exercise
hand-built arrays and never a stored row (see D-11).

## 5. Defect register

Ordered by the risk each defect poses to a reader who trusts the numbers.

### Evaluator semantics

**D-1 — the fidelity denominator is not gated by the relevance that decides it.**
`src/core/claimMetrics.ts:197` computes `const asserting = isAssertingRelevance(claim.relevance)` and
line 201 only increments a counter used for a footnote at lines 284-288. The label branch at
lines 211-234 never consults `asserting`. A statement recorded `relevance = REFUSAL` with a stored
fidelity label of `ACCURATE` therefore enters the fidelity denominator and is counted as an accurate
factual statement. The same ungated path feeds `claimContradictionRate` and `claimUnsupportedRate`,
which share `fidelityDenominator` (lines 333, 346). The comment at lines 193-196 states the intended
rule ("the reviewer's relevance label is the authority on that"), so the code contradicts its own
documented contract. Attribution (lines 236-254) and citation support (lines 256-275) have the same
gap: neither looks at relevance.

**D-2 — voided statements are skipped in silence, in two places, with no exclusion record.**
`src/reporting/snapshot.ts:193-195` and `src/persistence/repositories/findings.ts:783-785` each
`continue` past a claim whose `voidedAt !== null`. The two paths agree on *which* rows are dropped,
so the immediate parity risk is contained, but neither produces an exclusion reason. A report cannot
state that statements were voided and excluded; a reader sees a narrower denominator with no
explanation, which is the same class of problem the v0.3 notes call out for other exclusions. The
duplication itself is the hazard: two independent filters over the same records can drift.

**D-3 — a mapping to a voided citation stays countable as valid support.**
`linkAnswerClaimCitation` (`src/persistence/repositories/answerClaims.ts:795-800`) correctly refuses
a *new* mapping to an already-voided citation. But nothing prevents voiding a citation that already
has active mappings: `voidCitation` is at `src/persistence/repositories/runs.ts:539` and no trigger in
`008_answer_claims.sql` or `004_query_sets_runs.sql` guards `answer_claim_citations` against it. Both
metric assembly sites read the support label with no reference to the citation's state —
`snapshot.ts` passes `claim.citationSupports` (line 203) built at `reportingService.ts:278-280` by
filtering only `supersededBy === null`, and `findings.ts:794-796` does the identical thing. A voided
citation therefore keeps contributing `SUPPORTS` to `claimCitationSupportRate`.

**D-4 — a recorded relation can manufacture an omission.**
`claimMetrics.ts:204-209` adds every `propositionRelations` entry to `propositionsRelated`, and any
`OMITS_TARGET` entry to `propositionsOmitted`, with no reference to the statement's relevance. An
`UNRELATED` statement linked `OMITS_TARGET` inflates the relevant-omission numerator, and an
inconsistent link also inflates its denominator. Nothing in `validateClaimPropositionLinkInput`
(`answerClaimInputs.ts:306-327`) or in the `008` triggers relates the two axes, so the UI accepts it.

**D-5 — `partiallyDecomposedObservations` does not measure decomposition.**
`countPartiallyDecomposed` (`claimMetrics.ts:400-418`) groups claims by observation and counts an
observation where some statements have a fidelity label and some do not. That is review progress over
already-recorded statements. Real decomposition coverage is `decompositionCoverage`, already reported
separately. `src/app/views/report.ts:191-193` renders the count as "answer(s) were only partially
decomposed", which converts reviewer effort into an apparent statement about the answer.

### Benchmark integrity

**D-7 — the validator checks structure and skips semantics.**
`src/benchmark/validate.ts` validates propositions, statements, citations, gold labels, reviewer
labels and adjudication shape, but for the nested fields it stops at type or length:
`propositions[].evidence` is checked only as a list (`:208-215`); `limitations` only as a list
(`:404-406`); `locator` and `provenance.unverified` are never referenced; `relation`, `sourceType`,
`independence`, gold-label `label`, reviewer `label` and `subjectId` are not checked against any
vocabulary or against the case's own ids; `citations[].url` (`:306`) is a non-blank length test
although the repository already exports `httpUrl` (`src/core/validation.ts:111`); non-record entries
in `statements` and `citations` are skipped with no issue (`:255-258`, `:302-305`). Byte limits live
only in `scripts/benchmark.ts:104-112`, so they do not apply to any caller of
`validateBenchmarkCorpus`.

**D-8 — "consensus" is the alphabetically first label.**
`methodologyPairs` at `scripts/benchmark.ts:148` is
`reviewers.map((label) => label.label).sort()[0]`. It is not a majority: one dissenting `ACCURATE`
beats two `UNSUPPORTED`. A single reviewer is enough (line 145 only skips zero). It never reads
`benchmarkCase.adjudication`, so an adjudicated-genuinely-ambiguous subject still yields a determinate
"prediction", and those pairs are merged with deterministic software output into one
`scoreByDimension` accuracy at `:207`.

**D-9 — evidence identity and source identity are the same field.**
`toRelationships` sets `sourceId: evidence.id` (`src/benchmark/regression.ts:67`) because
`BenchmarkEvidenceRecord` has no source identifier (`types.ts:82-89`). `deriveEvidenceStatus` counts
distinct `sourceId` (`src/core/evidence.ts:51-57`), so every excerpt becomes its own source and the
duplicate/syndication branch at `evidence.ts:114-121` is unreachable from benchmark.
`DUPLICATE_OR_SYNDICATED_SOURCES` is a required stratum enforced by `validate.ts:442`, so the corpus
can only be satisfied by cases that cannot exercise what the stratum names.

**D-10 — scorer drops what validator never checked.**
`regression.ts:55-63` `continue`s past an unknown relation/sourceType/independence with the comment
"The validator catches it earlier". It does not. The dropped relationships leave
`deriveEvidenceStatus([])` = `NOT_ASSESSED` (`evidence.ts:69-70`), so a garbage-vocabulary case can
match a `NOT_ASSESSED` gold label and be reported as a passing regression.

### Retest and remediation provenance

**D-11 — a status transition can cite an unrelated comparison.**
`transitionFinding` (`src/persistence/repositories/findings.ts:427-437`) requires *some* comparison
attached to the finding whose outcome fits the status, then writes `input.comparisonId` into
`finding_updates.comparison_id` with no validation (line 448) and copies it into the audit details
(line 465). `validateFindingTransitionInput` bounds it to 40 characters
(`src/core/findingInputs.ts:132`) and nothing more. No trigger in `009_remediation.sql` touches
`comparison_id`: the only schema protection is a bare foreign key (line 119), so a comparison from
another project, another finding, or with the wrong outcome is accepted.
`reportingService.ts:344-353` maps the id to a position index over the finding's own comparisons, so a
foreign id silently becomes `-1`, and `comparisonIndex` is never rendered anywhere in `src`.

**D-12 — the focus metric is not stored with the comparison.**
`CREATE TABLE retest_comparisons` (`009_remediation.sql:78-98`) has no metric column, and
`reasons_json` / `deltas_json` do not mark which row decided the outcome. The only write is the audit
event detail (`repositories/findings.ts:1000-1008`), whose `entity_id` is the finding, and no code
path reads it back. ADR-021's "one selected metric determines the outcome" is therefore not durable.

**D-13 — the repository trusts the caller's derived comparison.**
The route recomputes correctly (`routes/findings.ts:1596-1625`, accepting only `baseRunId`,
`laterRunId`, `focusMetric`), but `recordRetestComparison` (`repositories/findings.ts:986-999`)
inserts `preview.comparable`, `preview.outcome`, `preview.reasons` and `preview.deltas` as given,
with no in-transaction re-derivation. The internal contract is unenforced, and no test calls it with
a hand-built preview.

**D-14 — comparability omits the field that says it matters.**
`comparabilityReasons` (`src/core/runComparison.ts:32-66`) compares exactly seven fields.
`runs.conditions` (`004_query_sets_runs.sql:101`) is a required, immutable, operator-authored field
whose own help text at `routes/runs.ts:176-185` describes it as "Logged-in state, tools, account plan,
interface language, and anything else that could affect results" — and it participates in no check.
Capture window, sample size, eligible-observation counts and the metrics version behind each value are
likewise outside the rule. There is no comparability-rule version, unlike `reports`, which stores
`metrics_version` (`006:33-36`).

### Performance

**D-15 — `assembleClaim` is one N+1 with a comment denying it.**
`listAnswerClaimsForObservation` (`repositories/answerClaims.ts:281-289`) documents "a single pass per
table rather than one pass per claim", then calls `assembleClaim` per row, and `assembleClaim`
(lines 251-272) issues four separate queries: `revisionsFor`, `propositionLinksFor`, `citationLinksFor`
and `assessmentsFor`. An observation with twelve statements issues 49 queries. Both metric paths call
it once per observation, so a 40-observation run is in the hundreds.

### Version and documentation

**D-16 — the shipped build still calls itself v0.2.**
`package.json` is `"version": "0.2.0"`, `src/version.ts` is
`APP_VERSION = '0.2.0'` / `LOCAL_MODE_LABEL = 'Local core v0.2 — no provider integrations'`, while
`main` contains the merged v0.3 release (`43ce438`, PR #5) and `metrics-v3` code.

**D-17 — documents describe the wrong milestone.**
`docs/TESTING.md` still states 335 tests against the 2026-10-30 baseline (this checkout measures
571). The root `README.md` describes v0.2 and metrics v2. `docs/KNOWN_LIMITATIONS.md` identifies
itself as v0.2.

## 6. Things the audit could not verify

- No live end-to-end run had been performed at the time this section was written; §7 of this file is
  where the workflow result will be recorded. The v0.3 report left 13 of 19 manual steps successful
  and six unresolved, and those six stay unproven until re-run.
- Screen-reader, mobile and cross-browser verification were not performed on this machine and are
  recorded as not run wherever they appear.
- No provider or network validation exists by design; nothing in this milestone changes that.
- A real reviewed benchmark corpus does not exist. `docs/KNOWN_LIMITATIONS.md:98` states this
  correctly and this audit found no corpus JSON anywhere in the repository: the only case material is
  three synthetic fixtures inside test files. Any accuracy figure stays unclaimed.

## 7. Changes made by this milestone

Recorded here as they land, so the row that says `Fixed` in section 4 points at a commit and a test.

| Defect | Fix | Commit | Test that fails without the fix |
|---|---|---|---|
| D-1 fidelity not gated by relevance | `src/core/claimEligibility.ts` states the contract; `claimMetrics.ts` gates fidelity, attribution and citation support on it; conflicts are reported as `CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE` and counted in `labelConflictClaims` | `bb31186`, `0a8e00e` | `tests/unit/claim-metrics.test.ts` — "a refusal carrying an accurate label cannot be scored as an accurate statement"; `tests/unit/claim-eligibility.test.ts` (25 tests over the vocabulary) |
| D-2 voided statements skipped in silence by two callers | Voided statements are passed to the calculation and excluded under `CLAIM_VOIDED`; an observation whose statements are all voided counts as not decomposed | `0a8e00e` | `tests/unit/claim-metrics.test.ts` — "a voided statement is excluded with a reason instead of vanishing from the report"; `tests/integration/report-retest-parity.test.ts` |
| D-3 mapping to a voided citation stayed countable | `AnswerClaimInput.citationMappings` carries the cited record's state; a withdrawn citation excludes its mapping under `CLAIM_CITATION_VOIDED` while the mapping survives as history; a new mapping to a voided citation is refused by the schema | `0a8e00e`, `14f26cb` | `tests/unit/claim-metrics.test.ts` — "a citation voided after the mapping was recorded stops supporting the statement"; `tests/integration/schema-evaluator-integrity.test.ts` |
| D-4 inconsistent proposition link manufactured an omission | Relations are checked as a pair with relevance; `OMITS_TARGET` is reachable only from `PARTIALLY_ADDRESSES` and `OMISSION`; non-engaging links are excluded under `CLAIM_OMISSION_NON_ENGAGING` | `0a8e00e`, `14f26cb` | `tests/unit/claim-metrics.test.ts` — "an unrelated statement cannot manufacture a relevant omission"; `tests/integration/schema-evaluator-integrity.test.ts` |
| D-5 `partiallyDecomposedObservations` measured review, not decomposition | Renamed `partiallyAssessedObservations`; the block carries `statementsRecorded`, `statementsFidelityAssessed`, `statementsAttributionAssessed`, `citationMappingsRecorded`, `citationMappingsAssessed`; the report renders them as review progress | `9f202a1` | `tests/unit/claim-metrics.test.ts` — "unfinished review is reported as reviewer progress, never as an answer result" |
| D-1…D-5 enforcement outside the calculation | The same contract is applied in the form validator, again inside the repository transaction, and again by SQLite triggers in `010_evaluator_integrity.sql` | `14f26cb` | `tests/integration/repositories-answer-claims.test.ts` (three direct-write refusals); `tests/integration/schema-evaluator-integrity.test.ts` (parses the migration and compares every arm against the TypeScript table) |
| Version integrity for the changed semantics | `metrics-v4` under `report-template-v4`; v1–v3 snapshots render as stored; ADR-023 records the decision | `5418c2d`, `238e9d0` | `tests/unit/report-compatibility.test.ts` — a stored v3 file whose fidelity figures are impossible under v4 still prints what it recorded |
| Report/retest divergence risk | Both paths pass every statement through the same contract; a parity test compares the two figure by figure on one finalized run | `f9ac365` | `tests/integration/report-retest-parity.test.ts` — "the report and the retest comparison agree on every claim-level figure" |
| D-7 validator skipped nested semantics | `src/benchmark/validate.ts` rewritten: every nested object and array checked against the core vocabularies, issues addressed to the element that carries them, cross-references checked in both directions, byte and case ceilings moved into the validator | `0671ae7` | `tests/unit/benchmark-validate.test.ts` — evidence vocabulary, gold-label vocabulary, subject kind, URL shape, undeclared reviewer, non-object entries, multi-case file counting |
| D-8 alphabetical "consensus" | `methodologyPairs()` removed. Unanimity is agreement; disagreement without a settling adjudication stays unresolved; genuinely ambiguous subjects are never scored as ordinary gold labels; annotation agreement reported in its own block with exclusions counted | `0671ae7` | `tests/unit/benchmark-scoring.test.ts` — "no consensus is inferred from a sorted label list", "a scoped resolved adjudication supplies the settled label, and only for its own subject" |
| D-9 evidence id doubled as source id | `benchmark-case-v2` adds `sourceId`, a citation `voided` state and scoped `adjudications`; v1 files still read and are reported as legacy contract | `0671ae7` | `tests/unit/benchmark-source-identity.test.ts` (9 tests: duplicate excerpts, distinct sources, syndication, self-published, v1 inability to express it, end-to-end scoring) |
| D-10 scorer dropped unreadable evidence silently | `toRelationships` returns `unusable` records, which the report and the CLI surface instead of discarding | `0671ae7` | `tests/unit/benchmark-validate.test.ts` plus the CLI report field `regression.unusableEvidence` |

### Found while fixing D-9, and deliberately not changed

`deriveEvidenceStatus` (`evidence-aggregation-v1`) counts distinct `sourceId` for corroboration, but it
does not collapse relationships marked `independence: 'RELATED'` that carry *different* source ids. So
syndicated material from separate publishers is representable in a benchmark case and is testable
(`tests/unit/benchmark-source-identity.test.ts` proves both), yet the deterministic rule still counts
those publishers as distinct sources; only the self-published check consults independence.

Changing that is a metric-rule change to `evidence-aggregation-v1`, which needs its own version and
ADR, not a side effect of a benchmark fix. It is recorded as an open limitation instead, and the test
that documents it says so in its own name ("a single source cannot corroborate itself into a strong
status").

## 8. Live workflow verification (§6)

`npm run verify:workflow` (`scripts/local-workflow.ts`) boots the real server with
`APORIA_DATA_DIR` pointing at a fresh temporary directory, on a port the script asks the operating
system for (port 3000 is Grafana on this machine, so a fixed port would collide with something), and
walks the §6 sequence. Every submission is assembled from the form the application just served: its
action, its method, its field names, its select choices, and each field's own default value, so a
hidden statement id, a datetime default and the CSRF token are sent the way a browser sends them. A
value the page never offered, a required field the workflow cannot fill, or a name the form does not
have stops that step rather than quietly submitting less. Failures print the page's own error summary.

Result on 2026-11-02, Windows x64, Node v24.13.1: **25 entries, 25 passed, 0 failed, 0 left not-run,
exit code 0.** `/health` reported `0.4.0`.

| §6 step | What the run proved |
|---|---|
| 1 project and target entity | Project `prj_…` created; entity entered through its own form with identity status, method and scope; the entities page shows a current target |
| 2 manually supplied claim | Claim stored at revision 1 and readable on its page |
| 3 proposition decomposition | Two propositions recorded, each with its evidence requirement |
| 4 source and evidence relationship | A `PRIMARY_ARTIFACT` source becomes selectable in the evidence form; the stored excerpt reads back |
| 5 human proposition assessment | The reviewed-conclusion form only exists once review has started — the run starts review through the claim's own form first, then records the conclusion beside the rule output |
| 6 query set approved | One verbatim attribution query; approval freezes the text and the page reports the approved state |
| 7 run created | Open run against the approved set, with conditions, capture window and both labels |
| 8 captured answer | The raw answer renders in full on the run page; its character positions are computed from it |
| 8b observation assessments | Presence and fidelity recorded against the observation, each with its rationale, through the dimension-specific form |
| 9 multiple statements | Two statements; the workspace lists exactly two and the verbatim quote carries the character range |
| 10 quote locations and states | Verbatim range, normalised range and reviewer description all accepted; two bad submissions refused (below); workspace still holds exactly three statements afterwards |
| 11 statement → proposition links | Two links recorded, each readable and each with its own correction form |
| 12 citation mapping | One citation mapped to two statements: one `SUPPORTS`, one explicitly `NOT_ASSESSABLE` |
| 13 fidelity and attribution | `CONTRADICTED` and `WRONG_ROLE` recorded; the inconsistent pairing refused (below) |
| 14 correction and voiding | Three void forms existed; a link was superseded with the original retained; a statement was voided and its reason stayed readable; the citation was withdrawn and its mappings stayed on the page |
| 15 finalize | The run finalizes and the page reports it frozen |
| 16 report and claim-level metrics | The report carries all four statement rates, decomposition coverage, `metrics-v4`, the review-progress block and the voided-statement sentence |
| 17 offline benchmark | Ran against a temporary synthetic corpus **outside** the application, exited non-zero on incomplete strata, named the missing ones, and refused to present an accuracy claim |
| 18 remediation finding | Created, amended without changing status, walked to retest-required; the page withholds `IMPROVED` while no comparison exists, and a hand-built `IMPROVED` transition was refused |
| 19 later run and retest comparison | Preview reached with the page's own get form; the record form carries only the two run ids and the metric; `UNCHANGED` recorded citing `rtc_…`; a fabricated `IMPROVED` citing that same comparison was refused and the stored outcome did not move |
| 20 second report | New snapshot is current, the older one says "has been superseded by report …" and still renders its own frozen figures |
| 21 exports | Project JSON contains its sections including findings; each report offers JSON plus metrics, findings and observations CSVs, with the claim-level rows present |
| 22 backup, verify, restore | Schema 11, 34 tables counted, `answer_claims` 3 and `retest_comparisons` 1 in the manifest; verification passed; a restore over live data **without** `--replace --confirm` was refused; restore into a separate fresh directory succeeded |
| 23 restart on restored data | The server boots against the restored directory and answers `/health` |
| 24 read back | The restored project, claim, propositions, voided statement with its reason, both reports, and the finding with its recorded comparison all serve through the running application |

The refusals the run depends on, in the application's own words:

- a reviewer description claiming a verbatim position — *"A reviewer description cannot claim a
  position inside the answer. Remove the position basis, or record the statement as a quote only if the
  answer really contained these words."*
- a quote absent from the captured answer — *"The quote is not present verbatim in the captured answer.
  Choose an exact-match quote from the original text, or record the basis as 'not established'."*
- a `REFUSED` fidelity label on an `ADDRESSES` statement — *"A statement recorded as 'ADDRESSES' makes
  no assertion the REFUSED verdict could describe. ACCURATE, PARTIALLY_ACCURATE, CONTRADICTED,
  UNSUPPORTED, NOT_ASSESSABLE are the assessments this relevance supports. If the statement does assert
  something, correct its relevance instead."*
- a measured status with no comparison, and a measured status citing a comparison that measured a
  different outcome — both returned non-redirect and left the stored status unchanged.

Boundary conditions honoured: no provider, no search API, no remote fetch, no network call, no
authentication, no publication and no seeded application data. The only synthetic content is text an
operator would type, entered through the forms, plus one temporary benchmark file that is written
outside the data directory and deleted in the same step. The run creates no fake gold case and no fake
reviewer: `workflow-operator` is the configured local operator label, and it is recorded as such.

## 9. Fix record for the remaining defects, and what only running the application could show

The table in section 7 stopped at D-10. These are the rest.

| Defect | Fix | Commit | Test that fails without the fix |
|---|---|---|---|
| D-11 a status transition could cite an unrelated comparison | The cited comparison must belong to this project, this finding, and carry the outcome being recorded; enforced in `transitionFinding` and by four triggers in `011_retest_provenance.sql` | `ba7a231` | `tests/integration/findings-workflows.test.ts` (cross-finding and wrong-outcome citations); `scripts/local-workflow.ts` step 19 |
| D-12 the focus metric survived only in an audit detail | `focus_metric`, `focus_label`, `rule_version`, `base_metrics_version` and `later_metrics_version` added to `retest_comparisons` and written with the row; a trigger requires the focus metric to be one of the metrics actually compared | `ba7a231`, `8f8f422` | `tests/integration/upgrade-v03-to-v04.test.ts`; `tests/integration/project-export-findings.test.ts` reads the stored metric back out of the portable record |
| D-13 the repository trusted a caller-supplied comparison | `recordRetestComparison` recomputes the whole comparison from the persisted runs inside its own transaction; the route passes only the two run ids and the chosen metric | `ba7a231` | `tests/integration/findings-workflows.test.ts` — a fabricated outcome cannot reach the table; step 19 posts one anyway to prove it is refused |
| D-14 comparability ignored the field that says what varied | `comparison-rule-v2` compares recorded `conditions`, and `COMPARABILITY_EXCLUSIONS` names what a local comparison cannot see at all; v1 rows keep their original meaning | `ba7a231` | `tests/unit/findings-lifecycle.test.ts`, `tests/unit/reporting-claim-level.test.ts` |
| D-15 the statement reader was one N+1 with a comment denying it | One assembled pass over the claim rows bucketed by observation; the per-record loaders and `assembleClaim` were deleted rather than left as dead alternates | `6a5f360` | `tests/integration/query-counts.test.ts` — measured, not asserted: 49 prepared statements for twelve statements before, **5** after, identical for one statement or twelve, and identical for a whole run read one way or the other |
| D-16 multi-record writes were unproven under partial failure | Fifteen write paths tested by making the second statement or the audit append fail | `b7694f5`, `696676a` | `tests/integration/write-atomicity.test.ts`, `tests/integration/audit-atomicity.test.ts` |
| D-17 the build and the documents named the wrong milestone | Version 0.4.0 in `package.json`, `package-lock.json` and `src/version.ts`; README, testing, limitations, status, runbook, route map, schema, architecture, data model, security matrix and the evaluator specifications brought to what v0.4 does; ADR-021 amended rather than rewritten | `a922081` … `b35677f` (13 commits) | `npm run verify:workflow` prints the version `/health` reports; `tests/unit/route-map.test.ts` and `tests/unit/docs-links.test.ts` keep the route and link claims honest |

### D-18 to D-22 — found by driving the running application, not by reading it

These four defects were each described as working in the documentation, and each had green tests. None
of them was reachable by an operator.

| Defect | What it looked like | Fix | Test that fails without the fix |
|---|---|---|---|
| D-18 five workspace forms posted to a duplicated path | `claimPath()` already ends with the statement id, and the templates appended it again, so linking a statement, mapping a citation, recording an assessment, voiding a statement and saving a revision all returned **404**. The suite stayed green because `answer-claim-workflows.test.ts` composed the correct URL from repository ids instead of reading the page | `b0cba40` | `tests/integration/form-actions.test.ts` submits each through the rendered action; step 11–14 of the workflow run |
| D-19 both correction forms posted to a path that does not exist | The routes are `/claims/propositions/:linkId/supersede` and `/claims/citations/:linkId/supersede`; the views inserted the statement id as well, so a recorded link or mapping could never be amended — precisely the amend-with-history behaviour §2.3 requires | `960af01` | `tests/integration/form-actions.test.ts` (the third test supersedes both through the rendered actions) |
| D-20 a withdrawn citation's reason was stored and never shown | The run page rendered `Void reason` only while `voidedAt === null`, so a withdrawal was indistinguishable from a deletion, which is the thing §2.3 forbids | `0f8c939` | `tests/integration/citation-void-visibility.test.ts` |
| D-21 the project export carried no findings at all | `project-export-v1` predated the remediation workflow, so exporting and wiping lost the backlog and every measurement behind a status — while `LOCAL_RUNBOOK.md` listed the sections and, by omission, described the gap accurately | `242d766` | `tests/integration/project-export-findings.test.ts`; step 21 requires a comparison inside the export |
| D-22 the workspace could not show how much of an answer had been reviewed | §2.5 required decomposition to be separated from assessment. The metrics and the report did; the page where the reviewing happens still said only "Statements recorded: 3", so a partially reviewed answer looked finished | `fa8e60b` | `tests/integration/answer-claim-workflows.test.ts` — "the workspace separates what was recorded from what was reviewed" |

One correction to this report's own earlier draft: the traceability row for metric computation cited a
defect "D-6" that has no entry in section 5. It was never a separate finding — the second silent void
filter it was meant to name is described inside D-2 (`snapshot.ts` and `findings.ts`), and the
terminology problem belongs to D-5. The row now reads D-1, D-2, D-4, D-5.
