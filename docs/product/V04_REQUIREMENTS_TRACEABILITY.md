# v0.4 Requirements Traceability — Evaluator Correctness, Benchmark Integrity, Retest Provenance

- Status: Audited against this checkout on 2026-11-02
- Scope: the requirements of the local core v0.4 milestone — evaluator semantics (§2), benchmark integrity
  (§3), retest provenance (§4), persistence and performance (§5), workflow verification (§6), boundaries
- Related: [Implementation Status](../IMPLEMENTATION_STATUS.md), [v0.4 audit and traceability session](../agents/sessions/2026-11-02-local-core-v0.4-audit-and-traceability.md), [v0.3 traceability](V03_REQUIREMENTS_TRACEABILITY.md)

This document maps each requirement to the code that satisfies it and the check that would fail if it did
not. The workflow-by-workflow map (project → claims → propositions → … → deletion) is in section 4 of the
session report; this one is requirement-shaped rather than workflow-shaped, so a reader deciding whether a
specific obligation is met can find it here. "Test" means an automated check that was run; "run" means an
observed result recorded in the session report. Nothing in this table is asserted from documentation.

## 1. Evaluator semantics

| Requirement | Implementation | Check |
|---|---|---|
| A refusal must never be scored as an accurate factual statement | `src/core/claimEligibility.ts` — relevance decides whether a statement asserts anything; `PERMITTED_FIDELITY` names the labels each relevance can carry | `tests/unit/claim-eligibility.test.ts`; `tests/unit/claim-metrics.test.ts` ("a refusal carrying an accurate label cannot be scored as an accurate statement") |
| An omission must never be scored as a false assertion | `omissionEligibility` admits only target-engaging statements; `CLAIM_OMISSION_NON_ENGAGING` is the exclusion reason | `tests/unit/claim-metrics.test.ts`; `tests/integration/schema-evaluator-integrity.test.ts` |
| The authoritative field must be decided and enforced | Decided: relevance is authoritative on assertion, label on what was asserted. Enforced in the calculation, `src/core/answerClaimInputs.ts`, `requireConsistent` in the repository transaction, and four triggers in `010_evaluator_integrity.sql` | `tests/integration/repositories-answer-claims.test.ts` (three direct-write refusals); the migration-vs-TypeScript drift guard in `schema-evaluator-integrity.test.ts` |
| Inconsistent pairings must be visible, not silently dropped | `CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE` plus `labelConflictClaims`, rendered in the report | `tests/unit/report-compatibility.test.ts`; `tests/integration/report-retest-parity.test.ts` |
| Voided statements must stay readable and leave the figures with a reason | `CLAIM_VOIDED` exclusion; the workspace shows the statement, its reason and its assessments | run record steps 14 and 24; `tests/integration/citation-void-visibility.test.ts` |
| Report and retest must not disagree on one finalized run | Both paths pass every statement through the same contract | `tests/integration/report-retest-parity.test.ts` (figure by figure) |
| Historic metric versions must stay readable exactly as stored | `metrics-v1` to `v3` in the known version list; snapshots render stored values; nothing is recomputed | `tests/unit/report-compatibility.test.ts`; `tests/integration/upgrade-v03-to-v04.test.ts` |
| Decomposition must be separated from assessment effort | `statementsRecorded`, `statementsFidelityAssessed`, `statementsAttributionAssessed`, `citationMappingsRecorded`, `citationMappingsAssessed`, `partiallyAssessedObservations`; `partiallyDecomposedObservations` removed | `tests/unit/claim-metrics.test.ts`; `tests/integration/answer-claim-workflows.test.ts` ("the workspace separates what was recorded from what was reviewed") |

## 2. Citation lifecycle

| Requirement | Implementation | Check |
|---|---|---|
| A mapping to a later-voided citation must not stay silently countable | Chosen lifecycle: the mapping is retained and excluded under `CLAIM_CITATION_VOIDED`; forced supersession was rejected because it destroys history | `tests/unit/claim-metrics.test.ts`; `tests/integration/citation-void-visibility.test.ts` |
| The lifecycle must be enforced by application and trigger | `answer_claim_citations_require_active_citation` refuses a new mapping to a withdrawn citation | `tests/integration/schema-evaluator-integrity.test.ts`; `tests/integration/repositories-answer-claims.test.ts` |
| Seven scenario tests | Mapping a valid citation; voiding an unmapped citation; voiding a citation with active mappings; superseding a mapping; voiding a statement that carries mappings; historical revisions and a finalized run; report and retest after voiding | `tests/integration/repositories-runs.test.ts`, `tests/integration/repositories-answer-claims.test.ts`, `tests/integration/answer-claim-workflows.test.ts`, `tests/integration/citation-void-visibility.test.ts`, `tests/integration/report-retest-parity.test.ts`, run steps 12–16 |
| Historical relationships must not be deleted to clean a metric | Nothing deletes a mapping, a link or a revision; supersede appends, void marks | `tests/integration/repositories-answer-claims.test.ts`; the workspace renders "superseded link(s) retained" |

## 3. Benchmark integrity

| Requirement | Implementation | Check |
|---|---|---|
| Nested corpus validation to the field level | `src/benchmark/validate.ts` reports issues per element address, imports the core vocabularies, checks cross-references in both directions, and refuses an unknown case version | `tests/unit/benchmark-validate.test.ts` |
| Consensus must not be manufactured | No alphabetical pick; unanimity is agreement; disagreement without a settling adjudication stays unresolved; ambiguous subjects are never scored as ordinary gold; one reviewer is not consensus | `tests/unit/benchmark-scoring.test.ts` |
| Evidence and underlying source are different things | `benchmark-case-v2` adds `sourceId`; scoring counts independence by underlying source; unusable records are reported | `tests/unit/benchmark-source-identity.test.ts` |
| Claims must stay honest | The harness prints its refusal to claim accuracy on every route, including failures; `accuracyClaimable: false`; `CorpusDigest` distinguishes file from case counts | `tests/integration/benchmark-cli.test.ts`; run step 17 |
| No fake gold cases or fictional annotators | No dataset ships; the only case material is synthetic fixtures inside tests, each labelled as such; the driver's temporary corpus file is written outside the application and deleted in the step | `tests/unit/benchmark-validate.test.ts` fixture header; run step 17 |

## 4. Retest provenance

| Requirement | Implementation | Check |
|---|---|---|
| A status transition must bind to the exact comparison | Four triggers in `011_retest_provenance.sql` require the cited comparison to be in this project, on this finding, and carrying that outcome; measured statuses require a citation at all | `tests/integration/findings-workflows.test.ts`; run steps 18–19 |
| The focus metric must be persisted, not only audited | `focus_metric`, `focus_label`, `rule_version`, `base_metrics_version`, `later_metrics_version` on the comparison row | `tests/integration/upgrade-v03-to-v04.test.ts`; `tests/integration/project-export-findings.test.ts` |
| A client must not be able to submit a fabricated outcome | `recordRetestComparison` recomputes from the stored runs inside its transaction; the route forwards two run ids and one metric | run step 19 posts a fabricated `IMPROVED` and shows the stored outcome unmoved |
| Comparability must inspect the conditions | `comparison-rule-v2` compares recorded `conditions`; `COMPARABILITY_EXCLUSIONS` names what cannot be seen and why | `tests/unit/findings-lifecycle.test.ts`, `tests/unit/reporting-claim-level.test.ts` |

## 5. Persistence, performance and lifecycle

| Requirement | Implementation | Check |
|---|---|---|
| No avoidable N+1, measured rather than intuited | One assembled pass over claim rows bucketed by observation; per-record loaders deleted | `tests/integration/query-counts.test.ts` — 49 prepared statements for twelve statements before, 5 after, flat in record count |
| Multi-record writes and their audit must be atomic | `withTransaction` around every multi-write path | `tests/integration/write-atomicity.test.ts` (fifteen paths with injected failure), `tests/integration/audit-atomicity.test.ts` |
| Migration, backup, verify, restore, rollback, and upgrade with data | `010` and `011` additive; manifest counts every table; restore validates first, refuses over live data without `--replace --confirm`, takes a safety backup, rolls back | `tests/integration/migrations.test.ts`, `upgrade-v03-to-v04.test.ts`, `backup-restore.test.ts`, `backup-cli.test.ts`; run steps 22–24 |
| Applied migrations must never be edited | Checksummed against `migrationChecksum()`; `009_remediation.sql` proved byte-identical after a stat-only flag | `tests/integration/migrations.test.ts`; the session report's starting-state section |

## 6. Boundaries

Not implemented, by requirement rather than by omission: any provider, LLM or search API; remote fetching or
crawling; unauthorised benchmark data; fake gold cases or reviewer identities; authentication or
multi-tenancy; accounts, plans, billing or analytics; cloud services or remote storage; public achievement
pages or remote publication; scheduled jobs or monitoring; fabricated accomplishments, sources,
observations or citations. The architecture stays loopback-only, single-operator, with no network call in
the dependency graph. `tests/unit/no-network.test.ts` and `tests/unit/boundaries.test.ts` enforce the
structural half of that; `npm run verify:workflow` demonstrates the application needs nothing outside the
machine to complete the whole sequence.

## 7. What this table does not claim

- It does not claim the evaluator is accurate. No reviewed corpus exists, so no accuracy figure is stated
  anywhere in this repository.
- It does not claim accessibility beyond structure. No screen reader, mobile layout or second browser has
  traversed these pages.
- It does not claim owner acceptance. ADR-018 to ADR-025 remain **Proposed**, and ADR-025 is additionally
  **not implemented**.
- It does not claim production readiness. `node:sqlite` is experimental in the tested Node release, and
  crash recovery is untested.
