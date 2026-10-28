# ADR-013: Store Immutable Report Snapshots and Render Exports From Them

- Status: Proposed
- Date: 2026-10-28
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-002, ADR-003, ADR-005, ADR-009, ADR-010, ADR-011

## Context

Reports must be reproducible and must allow a reader to understand the scope, method, coverage, evidence, findings, metrics, limitations, and unavailable checks. The underlying project data changes over time: claims receive revisions, evidence relationships are superseded, observations are added to new runs, and audits accumulate. Rendering a report from live tables would silently change historical conclusions and would make “reproducible” false.

The data model requires a report snapshot with immutable rendering inputs, template version, generation time, run IDs, warnings, metrics, methodology versions, and export format.

## Decision

1. A report is generated as an immutable JSON snapshot built from persisted records inside a read-consistent database transaction. The snapshot includes:
   - schema, template, evidence-rule, metrics, and methodology versions;
   - project scope and declared exclusions;
   - the target entity and its asserted identity status;
   - every current claim revision and proposition with active evidence relationships, the derived rule status, and the latest explicit human assessment;
   - the query-set versions used by included runs;
   - finalized evaluation runs with conditions, observations, raw answers, active citations, assessment histories, coverage, and metrics;
   - website audits with input digest, findings, unavailable checks, and limitations;
   - remediation suggestions derived only from recorded gaps and findings;
   - comparability notes and deltas for prior runs that share the same query set version and provider/model/interface/grounding/locale/region configuration;
   - fixed and data-derived limitations, including untested and unavailable checks.
2. The snapshot is stored with a monotonic per-project report number. The HTML report, JSON download, and CSV exports are rendered from the stored snapshot only; they never re-query live tables or recalculate under a newer formula.
3. Generating a new report marks the prior report as superseded by reference. The prior snapshot and number remain unchanged and viewable with a superseded banner. No report row is deleted or rewritten.
4. Reports include only finalized runs. Open or cancelled runs may appear in a coverage note but cannot contribute metrics.
5. Metrics in a report are per run and per declared configuration. There is no project-wide pooled mention rate and no composite score. Each metric carries its definition, numerator, denominator, exclusions with reasons, and an explicit `null` value when no eligible unit exists.
6. CSV exports are flattened from the snapshot. Cells are quoted per RFC 4180, and values beginning with `=`, `+`, `-`, `@`, tab, or carriage return are prefixed with an apostrophe to prevent spreadsheet formula injection. JSON exports preserve the snapshot structure and are served as downloads.
7. Report content is accessible server-rendered HTML with headings, tables with captions, and print styles. Core content does not depend on JavaScript.
8. Corrections after publication create a new report; they do not mutate the prior report. The audit trail records generation and supersession.

## Alternatives considered

1. **Render reports live from the database.** Rejected: historical reports would change silently and old metrics would be recomputed under new rules.
2. **Store only HTML.** Rejected: exports and machine-readable verification would lose structure, and template changes could not be distinguished from data changes.
3. **Store only metrics, not evidence.** Rejected: findings would not be traceable to evidence and limitations.
4. **A project-wide pooled metric across providers and models.** Rejected: it would invite misleading comparisons and violate metric separation.
5. **Compute deltas automatically across any prior run.** Rejected: only runs with identical query-set version and declared configuration are labeled comparable; others receive an explicit non-comparability reason.

## Consequences and trade-offs

- Snapshots duplicate data and can grow with project size. This is acceptable for local v0.1 and necessary for reproducibility.
- Late corrections require a new report, which is intentional.
- Report generation is bounded by the project’s data size; no pagination of snapshot contents exists in v0.1.
- The template version is stored even though v0.1 has one template, enabling future interpretation.

## Security, privacy, safety, and evaluator-validity implications

- Reports may contain raw AI answers, excerpts, and personal data. Exports are explicit user actions and remain local; sharing is the operator’s responsibility.
- HTML rendering escapes all snapshot content and validates links. Raw HTML from website audits is never inserted.
- Report limitations must disclose manual capture, local-only audits, unassessed dimensions, and the absence of provider integrations.
- Deltas are associations, not causal claims. The report must state that changed answers may reflect provider or environmental changes that Aporia did not control or observe.
- Superseding a report never hides the earlier conclusion; the correction path is visible.

## Implementation and migration plan

1. Add report and audit tables with append-only triggers.
2. Implement snapshot construction and deterministic serialization.
3. Implement comparability detection and per-metric deltas.
4. Implement HTML, JSON, and CSV renderers from the snapshot.
5. Add supersession and report listing.
6. Version the snapshot schema and template.

## Tests and validation required

- A report remains byte-identical after project, evidence, and run data change.
- New reports supersede without mutating prior snapshots.
- Metric definitions, denominators, exclusions, and `null` unknowns are present in every export.
- CSV quoting and formula-injection escaping are tested.
- Report HTML escapes user content and contains all required sections.
- Comparability is granted only for identical query-set and configuration conditions; mismatches record a reason.
- Report tests prove unavailable website checks and unassessed observations are disclosed.
