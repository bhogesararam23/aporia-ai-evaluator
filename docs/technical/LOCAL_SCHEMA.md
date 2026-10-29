# Local SQLite Schema and Integrity Rules (v0.1)

- Status: Implemented
- Date: 2026-10-29
- Related: ADR-002, ADR-009, ADR-010, ADR-011, ADR-013
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

## 4. Cross-cutting invariants

- Every persisted record has a stable identifier and timestamps.
- A material assessment references the exact proposition or observation and retains rationale and reviewer.
- Supporting and contradictory evidence relationships coexist; corrections supersede rather than delete.
- Provider/capture errors are observation statuses and eligibility exclusions, not negative claims.
- Reports reference the exact snapshot and versions used.
- No table stores plan, invoice, subscription, revenue, or entitlement data.

## 5. Data control and limitations

- Project deletion removes project-owned records and local audit events by cascade.
- Website audit snapshots and raw answers may contain sensitive content. Exports are explicit user actions.
- There is no automatic retention schedule, backup process, or encryption at rest beyond operating-system controls.
- The database is a single local file plus WAL/SHM files while running. Stop the server before copying it for a consistent backup.
- No achievement, public publication, review-event, benchmark, or provider-capability tables exist in v0.1.

See [Local operations](../operations/LOCAL_RUNBOOK.md) for backup and troubleshooting guidance.
