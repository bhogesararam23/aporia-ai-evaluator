# Local SQLite Schema and Integrity Rules (v0.4)

- Status: Implemented
- Date: 2026-11-02
- Related: ADR-002, ADR-009, ADR-010, ADR-011, ADR-013, ADR-018, ADR-021, ADR-023, ADR-024
- Migration directory: `src/persistence/migrations/`

## 1. Migration policy

Migrations are forward-only files named `NNN_name.sql` and applied in numeric order by `runMigrations`. Each applied migration is recorded in `schema_migrations` with its name, SHA-256 checksum, and application timestamp. The runner:

- applies all pending migrations inside a transaction;
- aborts startup if an applied migration file has changed or disappeared;
- rolls back a failing migration and does not record it;
- refuses duplicate versions and invalid filenames.

There are no down migrations. Correction means a new forward migration. Tests cover fresh application, idempotent startup, checksum mismatch, missing applied migrations, and rollback of a failing migration.

A project deletion is a deliberate data-removal operation. Foreign keys cascade through project-owned records. SQLite triggers that prevent ordinary updates do not prevent cascading deletion.

## 2. SQLite settings

`openDatabase` enables foreign keys, sets `busy_timeout=5000`, sets `synchronous=NORMAL`, and uses WAL journaling for file databases. The connection is opened with double-quoted string literals disabled. Tables use `STRICT` mode. JSON text columns use `json_valid` checks.

## 3. Tables

### `projects` and `entities` (`001_projects_entities.sql`)

`projects` stores:

- `id`, `name`, `description`, `primary_domain`;
- `target_entity_id` (nullable, references `entities` with `ON DELETE SET NULL`);
- `visibility` (`LOCAL_ONLY` only in v0.1);
- `lifecycle` (`ACTIVE` or `ARCHIVED`);
- `owner_label`, `created_at`, `updated_at`.

Triggers reject a target entity that does not belong to the same project on insert and update.

`entities` stores project-scoped `PERSON`, `ORGANIZATION`, `PRODUCT`, `REPOSITORY`, `PUBLICATION`, `PROJECT_ARTIFACT`, or `OTHER` records. It keeps alternate names and public URLs as validated JSON arrays, identity status (`UNVERIFIED` or `SELF_DECLARED`), method, scope, and notes. There is no independent identity verification.

### `audit_events` (`001_projects_entities.sql`)

Append-only project-scoped events with actor, action, entity type/id, JSON details, and timestamp. A trigger rejects updates. Project deletion cascades these events; deletion therefore removes the local audit trail, as disclosed in the UI and ADR-012.

### `claims`, `claim_revisions`, `propositions` (`002_claims.sql`)

- `claims` stores the lifecycle status and current revision reference.
- `claim_revisions` stores immutable original wording, source URL, intended meaning, time scope, locale, decomposition version, author, and timestamp.
- `propositions` stores atomic decomposed statements with subject, predicate, object, conditions, time interval, units, evidence requirements, expected-answer criterion, ambiguity notes, ordinal, and decomposition version.

Triggers:

- reject revision and proposition updates;
- reject proposition insertion after review starts;
- require a current revision to belong to its claim;
- enforce the allowed claim status transition graph, with the special case that a new current revision can reset status to `SUBMITTED`.

### `sources`, `evidence_items`, `evidence_relationships` (`003_sources_evidence.sql`)

- `sources` stores title, optional canonical URL, publisher, author, source type, access route, retrieval time, publication date, language, independence assessment, notes, access status (`NOT_CHECKED` by default), and timestamp. Source type and independence are reviewer-recorded labels, not properties Aporia verified.
- `evidence_items` stores locator, excerpt, extraction method, extraction time, fixed `USER_SUPPLIED` provenance, SHA-256 excerpt digest, and timestamp.
- `evidence_relationships` stores relation, rationale, reviewer, creation time, and one-way supersession fields.

Triggers and constraints:

- source and evidence rows are immutable;
- relationship content cannot be edited; only supersession fields can be set once;
- only one active (non-superseded) relationship may exist per evidence/proposition pair;
- a relationship's proposition must belong to the same project;
- composite foreign key prevents evidence from referencing another project's source;
- supersession uses a deferred self-reference so a replacement can be linked transactionally.

### `query_sets`, `queries`, `runs`, `observations`, `citations` (`004_query_sets_runs.sql`)

- `query_sets` stores name, per-name version, draft/approved state, locale, approval metadata, and optional supersession reference. Name+version is unique per project.
- `queries` stores query text, intent, locale, region, branded flag, expected elements, inclusion rationale, and ordinal.
- `runs` stores a frozen query-set name/version, provider/model/interface labels, grounding mode, locale/region, capture window, conditions, notes, open/finalized/cancelled state, and audit fields.
- `observations` stores query snapshot text/intent, capture status, raw answer, error note, citation-capture state, context, one-way void fields, and timestamp.
- `citations` stores URL, optional title/snippet, target-owned flag, one-way void fields, and position.

Triggers:

- approved query sets cannot be updated; their queries cannot be inserted or updated;
- query sets require approval metadata and at least one query before approval;
- runs require an approved query set from the same project;
- run configuration is immutable; status can move only `OPEN → FINALIZED` or `OPEN → CANCELLED`; cancellation requires a reason; terminal runs are immutable;
- a run cannot be finalized without at least one non-voided observation;
- observations require an open run and a query from the run's query set;
- observations cannot be edited except for one void with a reason while open;
- citations require an open run, cannot be edited except for one void with a reason, and cannot be voided after finalization.

### `proposition_assessments`, `observation_assessments` (`005_assessments.sql`)

- Proposition assessments are append-only versions with controlled status, rationale, fixed `HUMAN` method, reviewer, active-relationship ID snapshot, and timestamp.
- Observation assessments are append-only versions by observation and dimension, with the dimension-specific label, rationale, reviewer, optional attribution role, JSON details, and timestamp.

Triggers enforce:

- project matching;
- claim status `UNDER_REVIEW`, `ASSESSED`, or `DISPUTED` for proposition assessments;
- open runs for observation assessments;
- labels matching their dimension;
- attribution roles only on attribution assessments;
- append-only updates.

### `website_audits` (`006_website_audits_reports.sql`)

Stores label, input method (`PASTED`/`UPLOADED`), optional filename, SHA-256 content hash, byte length, raw HTML snapshot, audit time, methodology version, findings JSON, unavailable-check JSON, metadata JSON, and creation time. Audits are immutable. The raw snapshot is stored for reproducibility but never rendered in the application.

### `reports` (`006_website_audits_reports.sql`)

Stores a monotonically numbered per-project report, title, generation time, snapshot/template/methodology/metric/evidence versions, JSON snapshot, one-way supersession reference, and creation time. The snapshot and metadata are immutable. A trigger permits only the supersession reference to be set, and only once. Report numbers are unique per project.

### `achievements` … (`007_achievements.sql`)

- `achievements` links a project to an append-only sequence of revisions and one current revision.
- `achievement_revisions` stores an immutable title, summary, snapshotted project details, optional dates, unresolved-contradiction JSON, content hash, creator, and timestamp. The project and dates are snapshotted so a later project edit cannot silently change a historical record.
- `achievement_claims` snapshots each linked claim's text and revision id, the summarized recorded evidence status, a self-declared/evidence-recorded/contradiction/unresolved support state, the latest human assessment status, and the active relationship count.
- `achievement_contributors` stores name, controlled role, contribution, a self-declared/evidence-linked/disputed support state, and an optional evidence note. It does not establish identity, ownership, or sole credit.
- `achievement_evidence` links project sources and optional evidence items, with a note.
- `achievement_approvals` is append-only, unique per revision, and binds the operator, timestamp, note, and the revision content hash. A trigger permits only the current revision, and only the exact stored hash.

Triggers make revisions and their child rows immutable; reject a claim, source, or evidence item from another project; require a claim revision to belong to its claim; prevent project/creation identity changes; and prevent an approval of a stale revision or a mismatched hash. Project deletion cascades achievement records, revisions, child rows, and approvals.

### `answer_claims`, `answer_claim_revisions`, `answer_claim_propositions`, `answer_claim_citations`, `answer_claim_assessments` (`008_answer_claims.sql`)

One captured answer decomposed into the statements it actually makes, without editing the answer (ADR-018).

- `answer_claims` belongs to one observation, carries a per-observation `ordinal`, and points at one current revision. `UNIQUE(observation_id, ordinal)` is enforced by a table constraint, not only by repository code: an earlier draft relied on the code alone and would have accepted two statements claiming the same position.
- `answer_claim_revisions` is immutable and stores `quote_text` with `offset_basis`, `start_offset`, `end_offset`, `statement_kind`, and `relevance`. Offsets are counted in Unicode **code points**, not UTF-16 code units, because SQLite's `substr` and `length` count code points — a `QUOTED` revision is re-verified by a trigger that re-derives the quoted text from the stored answer and compares it, which is only possible while both sides count the same thing.
- `statement_kind` splits `'QUOTED'` (an exact or normalised match with a located range) from `'REVIEWER_DESCRIPTION'` (`offset_basis = 'NOT_ESTABLISHED'`), and `OMISSION` must be a reviewer description: an omitted statement has no text in the answer to locate. CHECK constraints and the core validator both enforce this, because a storable "located omission" would be a fabricated quote.
- `answer_claim_propositions` maps a statement to a target proposition with a relation (`SUPPORTS`, `PARTIALLY_SUPPORTS`, `CONTRADICTS`, `REFINES`, `DOES_NOT_ADDRESS`, `UNCERTAIN`, `OMITS_TARGET`, `INSUFFICIENT_FOR_TARGET`) and a rationale. A partial unique index allows one active link per statement-and-proposition pair while keeping superseded links as history.
- `answer_claim_citations` maps a statement to a citation **from the same answer** with a support label; citation support lives on the mapping row, not in an assessment dimension, so the number of citations never masquerades as an accuracy measure.
- `answer_claim_assessments` is append-only and versioned, and a trigger requires each label to belong to the dimension it is filed under. A statement may be marked `NOT_ASSESSED` and stay useful for decomposition coverage.

Triggers require an open run for inserts, refuse writes that touch a voided statement or a voided observation, keep a supersession chain honest (`supersedes` must point at the previous revision of the same claim), re-derive quote text and range, bound offsets to the answer length, restrict `attribution_detail` to attribution assessments, and re-check `observations.voided_at` against its statements, so an answer cannot be voided while a statement still reads as live.

### `remediation_findings`, `finding_references`, `finding_updates`, `retest_comparisons` (`009_remediation.sql`)

Tracked evaluation problems and the guards that make the honest reading unavoidable (ADR-021).

- `remediation_findings` carries `UNIQUE(project_id, reference_number)`, rendered as `F-0001`. A trigger refuses any status other than `OPEN` at insert, so a finding cannot be created already improved.
- A status that claims a measurement (`IMPROVED`, `UNCHANGED`, `REGRESSED`, `UNABLE_TO_VERIFY`) is refused unless a stored `retest_comparisons` row for that finding carries the matching outcome (`NOT_COMPARABLE` also unlocks `UNABLE_TO_VERIFY`). Severity and cause cannot move without a `finding_updates` row written at the same instant. Closure and `WONT_FIX` require a rationale. Identity, project, reference number, creator, creation time, lifecycle version, first-observed time and suggestion key are immutable.
- `finding_updates` is append-only, `UNIQUE(finding_id, sequence)`, and a trigger refuses a gap in the sequence and any entry except the first that omits a previous status.
- `finding_references` holds exactly one typed target among eight nullable foreign keys, with a CHECK on the count and a trigger requiring the target to live in the finding's own project. A multi-column `UNIQUE` was deliberately not used: SQLite treats NULLs as distinct, so it would appear to forbid duplicate pointers while permitting every one of them.
- `retest_comparisons` refuses `base_run_id = later_run_id` and refuses a direction (`CHECK (comparable = 1 OR outcome IN ('NOT_COMPARABLE','UNABLE_TO_VERIFY'))`). It is append-only and project-scoped by trigger, because a run and a finding from different projects would otherwise read as a trend.

Two schema behaviours are worth knowing before adding a guard here. SQLite fires multiple triggers for the same event **ordered by trigger name**, not by creation order, so two overlapping `BEFORE INSERT` guards will report whichever name sorts first — write each test case so only one rule can reject it, or the assertion is about naming. And a `BEFORE INSERT` trigger runs **before** table CHECK constraints, so a scope guard placed first will bury a malformed row under a boundary message; the guard here is written to speak only once the row has exactly one target.

## 3.1 v0.4 additions

### Evaluator integrity (`010_evaluator_integrity.sql`)

`metrics-v4` decides that a statement's recorded relevance governs whether it asserts anything, and that a label can only describe what was asserted about it. v0.3 stated that rule in comments and enforced none of it, so a refusal carrying an `ACCURATE` assessment was scored as an accurate factual statement. Five `BEFORE INSERT` triggers are the outermost gate, because application code can be bypassed by a restored database, a hand-edited file, or a future caller, and a stored row that contradicts its own relevance would then reappear as a number a reader cannot argue with:

- `answer_claim_assessments_fidelity_matches_relevance` and `answer_claim_assessments_attribution_matches_relevance` — each fidelity or attribution label is permitted only against a relevance that makes it meaningful, and `OMISSION` never accepts a factual verdict at all.
- `answer_claim_propositions_relation_matches_relevance` — `OMITS_TARGET` is reachable only from a statement that partially addresses the target or records an omission, so an unrelated remark cannot manufacture a relevant-omission result.
- `answer_claim_citations_support_matches_relevance` — a citation-support judgement on a statement that asserts nothing is refused.
- `answer_claim_citations_require_active_citation` — a mapping may not point at a withdrawn citation. Support for a citation that no longer stands would otherwise keep counting.

Each trigger speaks only when the value it is given already belongs to that axis's own vocabulary. Vocabulary membership belongs to the v0.3 column checks and triggers, which produce the clearer message for a label filed on the wrong dimension; a `BEFORE INSERT` trigger that fired first would pre-empt it and hide which rule was broken — see the trigger-ordering note above, which is why these arms are scoped rather than blanket. Every list in the SQL mirrors `src/core/claimEligibility.ts`, and `tests/integration/schema-evaluator-integrity.test.ts` reads this file and compares each arm against the TypeScript table, because a duplicated rule that nobody checks is worse than no rule at all: it looks enforced.

### Retest provenance (`011_retest_provenance.sql`)

A measured finding status is a claim that a specific retest showed a specific movement. Under v0.3 the lifecycle checked that *some* acceptable comparison existed for the finding while writing whatever `comparisonId` the caller supplied into the history row, so a valid comparison elsewhere could justify an update citing an unrelated one, and the chosen focus metric survived only inside an audit-event detail that nothing read back. Everything here is additive — applied migrations are never edited — and every constraint lands on new writes only:

- Five columns on `retest_comparisons`: `focus_metric`, `focus_label`, `rule_version`, `base_metrics_version`, `later_metrics_version`. `retest_comparisons_v04_requires_provenance` refuses a new comparison that omits them, and `retest_comparisons_focus_metric_in_deltas` requires the metric that decided the outcome to be one of the metrics actually compared (it stays silent when `focus_metric` is `NULL`, so the provenance trigger's clearer message wins the alphabetical race).
- Four triggers on `finding_updates`: `finding_updates_comparison_same_project`, `..._same_finding`, and `..._outcome_matches` bind the cited comparison to this project, this finding, and the outcome it recorded; `finding_updates_measured_requires_cited_comparison` and `finding_updates_unable_requires_cited_comparison` require a citation for any measured status at all.
- The comparison itself is recomputed from the two persisted runs inside the repository's transaction, so a client cannot submit a fabricated `IMPROVED`; the stored row is the output of the comparison code, not an echo of the request.

`rule_version` records which comparability rule produced the verdict (`comparison-rule-v1` for rows written before v0.4, `comparison-rule-v2` for those after), because v0.4 added recorded `conditions` to the comparison and a historical row must keep meaning what it meant when it was written.

## 4. Cross-cutting invariants

- Every persisted record has a stable identifier and timestamps.
- A material assessment references the exact proposition or observation and retains rationale and reviewer.
- Supporting and contradictory evidence relationships coexist; corrections supersede rather than delete.
- Provider/capture errors are observation statuses and eligibility exclusions, not negative claims.
- Reports reference the exact snapshot and versions used.
- Migrations are identified by a SHA-256 of their SQL with CRLF normalised to LF, so a checkout that converts line endings cannot make an applied migration look tampered with. `migrationChecksum()` in `src/persistence/migrate.ts` is the only implementation and the backup manifest reads it from there.
- `BACKUP_TABLES` must name every table the migrations create. A test enumerates `sqlite_master` and compares it with the manifest in both directions, because a table left out verifies as consistent while silently dropping everything the new migration stored.
- No table stores plan, invoice, subscription, revenue, or entitlement data.

## 5. Data control and limitations

- Project deletion removes project-owned records and local audit events by cascade.
- Website audit snapshots and raw answers may contain sensitive content. Exports are explicit user actions.
- There is no automatic retention schedule, backup process, or encryption at rest beyond operating-system controls.
- The database is a single local file plus WAL/SHM files while running. Stop the server before copying it for a consistent backup.
- No achievement, public publication, review-event, benchmark, or provider-capability tables exist in v0.1.
- Achievement records, revisions, contributor roles, evidence links, and approval rows were added in v0.2 (`007_achievements.sql`); publication is still not implemented.
- Answer-statement decomposition (`008_answer_claims.sql`) and tracked remediation findings (`009_remediation.sql`) were added in v0.3. Local core v0.4 adds only guards and columns to those same tables (`010`, `011`); no v0.3 table was redefined and no stored row was rewritten. A benchmark case set is a versioned file format validated by `src/benchmark/`, not a table: there is no stored benchmark dataset, and none is fabricated.

See [Local operations](../operations/LOCAL_RUNBOOK.md) for backup and troubleshooting guidance.
