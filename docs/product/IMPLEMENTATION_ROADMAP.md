# Implementation Roadmap

- Status: Proposed sequencing, not a delivery commitment
- Date: 2026-10-28

## Implementation note — 2026-10-29

Local core v0.1 implements the Phase 1 slice in a deliberately narrower form: claim intake and decomposition, local evidence provenance, human evidence relationships and assessments, approved query sets, manual observation capture/import, separate metrics, local HTML analysis, and immutable reports. Safe URL fetching and a search-grounded provider adapter remain intentionally unimplemented because this milestone prohibits remote access and provider integrations. Phases 2–6 and website publication remain future work. See [Implementation Status](../IMPLEMENTATION_STATUS.md) and [Known Limitations](../KNOWN_LIMITATIONS.md).

## Guiding strategy

Prove that Aporia can generate a useful, evidence-linked report before building broad provider coverage or a complex business dashboard. Prioritize the correctness of evidence and attribution. The order below is a dependency sequence, not a promise of dates.

## Phase 0 — Specification and risk foundation

Deliverables:
- Product, architecture, data, evaluator, trust, safety, privacy/security, operations, and agent documents.
- Accepted foundational ADRs.
- Explicit non-goals around caching and universal citation guarantees.
- Threat model and evidence-status vocabulary.
- Provider research register with last-verified dates.

Exit criteria:
- Owners can explain the difference between claim support, discovery, answer fidelity, and attribution.
- Core interfaces and package boundaries are documented.
- Open questions and release gates are visible.

## Phase 1 — One end-to-end vertical slice

Build:
- Claim intake and proposition review.
- Safe URL fetching with SSRF protections.
- Source record and evidence locator.
- A minimal evidence assessment and human correction route.
- One supported search-grounded provider adapter.
- Raw response/citation storage under defined retention.
- Mention/citation/fidelity/attribution result schema.
- Evidence-linked HTML report and one rerun flow.

Exit criteria:
- A reviewer can trace each verdict to evidence.
- Provider errors remain distinct from negative outcomes.
- No provider or caching guarantee is made.
- Security tests cover URL and tenant boundaries.

## Phase 2 — Achievement Registry and website integration

Build:
- Human-readable achievement record pages.
- Role-aware attribution fields and correction/dispute states.
- JSON-LD generation with visible-content consistency checks.
- Sitemap/canonical guidance and crawl audit.
- Copy/paste or Git-based integration with preview and explicit approval.
- Page reachability and structured-data validation.

Exit criteria:
- User can export or publish an accurate record with evidence links.
- The system accurately distinguishes public page reachability from indexing or AI recognition.
- Publication and rollback actions are auditable.

## Phase 3 — Benchmark and trust validation

Build:
- Human-reviewed gold set and adjudication guidance.
- Fixture/regression tests for every verdict label.
- Citation-support and attribution tests.
- Error, partial, unsupported provider, and prompt injection cases.
- Evaluation-version reporting and reliability dashboards.

Exit criteria:
- Public performance statements are based on disclosed, measured benchmarks.
- Critical false-support and false-attribution failures are tracked.
- Methodology can be reproduced from versioned inputs.

## Phase 4 — Additional provider integrations

Add providers individually after:
- a supported, authorized access method is confirmed;
- provider terms/data retention are reviewed;
- request/response schemas are captured;
- search/grounding and citation signals are understood;
- fixture and live integration tests exist;
- costs and regional availability are documented.

Chinese systems are separate research/integration tasks; do not claim broad support simply because a provider API or consumer website exists.

## Phase 5 — Monitoring and multi-project support

Build scheduled runs, provider/citation history, source freshness checks, user alerts, cross-project views, and first-party webmaster integrations where authorized. Use comparable query-set versions and annotate provider updates.

## Phase 6 — Optional commercial operations

Only after evidence quality and customer value are validated, consider billing, paid tiers, agency workspaces, quotas, and APIs. These must remain outside evaluator-core logic under ADR-007. Plan access may control whether a job can start; it cannot change a verdict.

## Cross-cutting release blockers

- Critical SSRF or cross-tenant access bug.
- Secret exposure.
- False claim-support verdicts above the reviewed tolerance on core benchmark cases.
- Untraceable material verdict.
- Provider outage treated as negative answer.
- Unsupported claim of universal caching/indexing/citation.
- Attribution that falsely assigns sole credit.
- Public publication without explicit approval.
