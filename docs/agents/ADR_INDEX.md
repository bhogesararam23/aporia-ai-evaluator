# Architecture Decision Record Index

ADRs are append-only decision records. Identifiers are sequential and never reused. The current sequence begins with ADR-001. Update this index whenever an ADR is added, superseded, or rejected.

| ID | Title | Status | Date | Summary |
|---|---|---|---|---|
| [ADR-001](adrs/ADR-001-documentation-first-foundation.md) | Establish a documentation-first foundation | Accepted for initial baseline | 2026-10-28 | Define product, evaluator, trust, safety, and agent process before code. |
| [ADR-002](adrs/ADR-002-claim-evidence-provenance-model.md) | Use a claim–evidence provenance model | Accepted for initial baseline | 2026-10-28 | Keep propositions, source records, evidence relationships, provider observations, and verdicts distinct. |
| [ADR-003](adrs/ADR-003-separate-metrics-and-verdicts.md) | Separate evidence verdicts from AI visibility metrics | Accepted for initial baseline | 2026-10-28 | Avoid a single score that confuses truth, mention, citation, attribution, or availability. |
| [ADR-004](adrs/ADR-004-provider-adapter-boundary.md) | Use provider adapters with capability declarations | Accepted for initial baseline | 2026-10-28 | Isolate provider-specific API schemas and observable capabilities. |
| [ADR-005](adrs/ADR-005-no-cache-or-citation-guarantees.md) | Do not promise provider caching or citations | Accepted for initial baseline | 2026-10-28 | Report only observed, provider-supported states. |
| [ADR-006](adrs/ADR-006-claim-level-attribution.md) | Model attribution at claim and role level | Accepted for initial baseline | 2026-10-28 | Distinguish identity, contribution, authorship, and achievement evidence. |
| [ADR-007](adrs/ADR-007-separate-evaluator-core-from-commercial-concerns.md) | Separate evaluator core from commercial concerns | Accepted for initial baseline | 2026-10-28 | Commercial access and billing must not affect factual verdicts or formulas. |
| [ADR-008](adrs/ADR-008-local-first-single-package-typescript.md) | Implement local core v0.1 as a single-package TypeScript application | Proposed | 2026-10-28 | One Node 24 package with internal module boundaries, SQLite, and server-rendered HTML. |
| [ADR-009](adrs/ADR-009-deterministic-evidence-aggregation.md) | Derive evidence status deterministically from human-recorded relationships | Proposed | 2026-10-28 | Human relations plus a pure, versioned precedence rule; explicit human conclusions remain visible. |
| [ADR-010](adrs/ADR-010-manual-observation-capture.md) | Use manually captured observations as the only v0.1 answer source | Proposed | 2026-10-28 | No provider calls or fake adapters; structured manual capture, explicit unknowns, and immutable finalized runs. |
| [ADR-011](adrs/ADR-011-local-html-only-analysis.md) | Analyze only user-supplied HTML locally | Proposed | 2026-10-28 | Parse supplied HTML without network access; mark network-dependent checks unavailable. |
| [ADR-012](adrs/ADR-012-loopback-single-operator-security.md) | Adopt a loopback-only, single-operator security posture for v0.1 | Proposed | 2026-10-28 | No remote binding or accounts; CSRF, host validation, CSP, body limits, and explicit local-only limits. |

## ADR lifecycle

- **Proposed:** under discussion; implementation should not assume approval where owner approval is required.
- **Accepted:** adopted as the current architectural direction.
- **Rejected:** considered and not adopted; rationale remains available.
- **Superseded:** replaced by a later ADR, with a link to its successor.

Accepted does not mean implemented. Implementation and test status must be recorded separately. Never renumber historical ADRs to make the sequence appear continuous; unused identifiers may be reserved if a record is withdrawn, with a note in the index.
