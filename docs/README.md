# Documentation map

This set defines the intended product, evaluation methodology, trust model, safety boundaries, architecture, and project operating practices. It is organized so product/business policy cannot silently alter technical evaluator judgments.

## Start and operate
- [Root agent instructions](../AGENTS.md) — mandatory entry point for future agents.
- [Product Requirements](product/PRODUCT_REQUIREMENTS.md) — users, problems, requirements, acceptance criteria, non-functional requirements, and exclusions.
- [Implementation Status](IMPLEMENTATION_STATUS.md) — implemented capabilities, requirement mapping, verified gaps, and maturity state.
- [Testing and Verification](TESTING.md) — commands, suites, exact local results, and checks not run.
- [Known Limitations](KNOWN_LIMITATIONS.md) — product, evaluator-validity, platform, and accessibility boundaries.
- [User Journeys](product/USER_JOURNEYS.md) — achievement records, AI disagreement, website readiness, and monitoring.
- [Implementation Roadmap](product/IMPLEMENTATION_ROADMAP.md) — dependency-ordered delivery phases and exit criteria.
- [v0.3 Requirements Traceability](product/V03_REQUIREMENTS_TRACEABILITY.md) — audited requirement-to-code-to-test matrix for the claim-level milestone.
- [v0.4 Requirements Traceability](product/V04_REQUIREMENTS_TRACEABILITY.md) — each v0.4 obligation in evaluator semantics, citation lifecycle, benchmark integrity, retest provenance, persistence and boundaries, mapped to the code that satisfies it and the check that would fail without it.
- [v0.7 Requirements Traceability](product/V07_REQUIREMENTS_TRACEABILITY.md) — every v0.7 obligation in review provenance, reviewer roster and identity, adjudication binding, batch semantics, corpus releases and compatibility, mapped to its implementation and the test that pins it.
- [Product Governance and Boundaries](business/PRODUCT_GOVERNANCE_AND_BOUNDARIES.md) — product promises and separation from evaluator verdicts.

## Technical design
- [System Architecture](technical/SYSTEM_ARCHITECTURE.md) — components, data flows, trust boundaries, and deployment separation.
- [Local Core Architecture](technical/LOCAL_CORE_ARCHITECTURE.md) — implemented module layout, request flow, boundaries, security posture, and absences.
- [Local Schema](technical/LOCAL_SCHEMA.md) — SQLite tables, migrations, triggers, immutability, and deletion behavior.
- [Local HTTP Route Map](technical/HTTP_ROUTE_MAP.md) — implemented pages, actions, scoping, and error behavior.
- [Module Boundaries](technical/MODULE_BOUNDARIES.md) — enforceable dependency directions, package rules, and future CI requirements.
- [Benchmark Review Provenance and Corpus Releases](technical/BENCHMARK_PROVENANCE_AND_CORPUS_RELEASES.md) — the v0.7 design: what the merged v0.6 workflow discarded or mis-accepted, how provenance, roster enforcement, disagreement binding, atomic batch publishing and deterministic release manifests replace it, and what a hash and a readiness gate each do not prove.
- [Data Model](technical/DATA_MODEL.md) — entities, relationships, lifecycle, provenance, retention, and versioning.
- [API and Job Contracts](technical/API_AND_JOB_CONTRACTS.md) — normalized request/response, job state, idempotency, and error semantics.
- [Provider Adapters](technical/PROVIDER_ADAPTERS.md) — provider interface, capabilities, failures, and integration criteria.
- [Website Discoverability and Integration](technical/WEBSITE_DISCOVERABILITY.md) — audit, structured data, sitemaps, crawler semantics, and integration options.
- [Provider Capability Register](research/PROVIDER_CAPABILITY_REGISTER.md) — per-provider research/implementation status and last-verified requirement.

## Evaluator science
- [Evaluator Methodology](evaluator/EVALUATOR_METHODOLOGY.md) — claim decomposition, evidence assessment, answer evaluation, reproducibility, and adjudication.
- [Implemented Metrics v1](evaluator/IMPLEMENTED_METRICS_V1.md) — exact numerators, denominators, exclusions, unknowns, and evidence rule precedence. Historical `metrics-v1` snapshots.
- [Implemented Metrics v2](evaluator/IMPLEMENTED_METRICS_V2.md) — intent-group coverage and the v1-to-v2 change record. Historical: `metrics-v3` and `v4` added the claim-level block and then corrected its denominators.
- [Implemented Metrics v3](evaluator/IMPLEMENTED_METRICS_V3.md) — claim-level statement fidelity, citation support, attribution, omission, and decomposition coverage, with the v2 compatibility boundary. Historical: superseded by v4 for new reports.
- [Implemented Metrics v4](evaluator/IMPLEMENTED_METRICS_V4.md) — the claim eligibility contract: relevance decides whether a statement asserts anything, voided statements and voided citations are excluded with named reasons, review progress is counted apart from every rate, and the v1–v3 compatibility boundary.
- [Benchmark Annotation Rubric](evaluator/BENCHMARK_ANNOTATION_RUBRIC.md) — how a human reviewer labels a benchmark case, and what each label does not mean.
- [Metrics and Scoring](evaluator/METRICS_AND_SCORING.md) — formulas, denominators, interpretation, aggregation, and anti-gaming controls.
- [Benchmarking and Validation](evaluator/BENCHMARKING_AND_VALIDATION.md) — gold sets, human review, validity, reliability, calibration, and release gates.

## Trust and risk
- [Claim and Attribution Trust Model](trust/CLAIM_AND_ATTRIBUTION_TRUST.md) — evidence status, source quality, identity, authorship, roles, disputes, and corrections.
- [Safety Policy](safety/SAFETY_POLICY.md) — abuse cases, allowed/disallowed uses, refusal distinctions, review, and mitigations.
- [Security and Privacy](security/SECURITY_PRIVACY.md) — threat model, tenant isolation, SSRF, uploads, credentials, retention, and deletion.
- [Local Security Test Matrix](security/LOCAL_SECURITY_TEST_MATRIX.md) — implemented local controls, evidence, and residual limits.
- [Observability, Cost, and Incidents](operations/OBSERVABILITY_COST_INCIDENTS.md) — run logging, reliability, budget guardrails, alerts, and response.

## Project governance and agents
- [Agent Operating Protocol](agents/AGENT_OPERATING_PROTOCOL.md) — session rules, file ownership, verification, ADR requirements, and transparency.
- [Local Operations Runbook](operations/LOCAL_RUNBOOK.md) — start/stop, configuration, backup, deletion, failures, and upgrades.
- [Session Report Template](agents/SESSION_REPORT_TEMPLATE.md) — mandatory end-of-session report.
- [ADR Index](agents/ADR_INDEX.md) — sequential architecture decisions and lifecycle.
- [Contributing](governance/CONTRIBUTING.md) — change workflow.
- [Definition of Done](governance/DEFINITION_OF_DONE.md) — completion criteria for documents, code, evaluator changes, and releases.
- [Release Policy](governance/RELEASE_POLICY.md) — release gates, versioning, rollback, and stop conditions.
- [Glossary](governance/GLOSSARY.md) — shared vocabulary.
- [Primary References](research/REFERENCES.md) — external documentation and evaluation foundations.
- [Documentation Foundation Session](agents/sessions/2026-10-28-documentation-foundation.md) — scope, decisions, outputs, validation, and follow-up.
- [Local Core v0.1 Session](agents/sessions/2026-10-29-local-core-v0.1.md) — implementation, ADRs, tests, browser verification, CI, risks, and handoff.
- [Local Core v0.2 Session](agents/sessions/2026-10-30-local-core-v0.2.md) — metrics v2, achievement records and exports, backup/restore, validation, limits, and handoff.
- [Local Core v0.3 Session](agents/sessions/2026-11-01-local-core-v0.3-claim-level-evaluation.md) — answer-statement decomposition, findings and retests, the offline benchmark harness, and the six workflow steps it left unverified.
- [Local Core v0.4 Audit and Traceability Session](agents/sessions/2026-11-02-local-core-v0.4-audit-and-traceability.md) — the route-by-route traceability map, the defect register with the fix and failing test for each, claim eligibility and metrics-v4, retest provenance, benchmark contract v2, the measured query-count and atomicity results, and the 24-step live workflow run.
- [Local Core v0.5 Session](agents/sessions/2026-11-04-local-core-v0.5-evaluation-reliability.md) — evidence corroboration by underlying source (`evidence-aggregation-v2`, still not the default), the version-aware benchmark pipeline and the local case-authoring CLI, the duplicate-field-id accessibility fix, and the three-OS CI matrix.
- [Local Core v0.6 Session](agents/sessions/2026-11-04-local-core-v0.6-benchmark-review-workflow.md) — the offline benchmark human-review workflow (blinded hashed packets, separate submissions, all-or-nothing safe merge, disagreement report with guarded scoped adjudication, corpus readiness/provenance audit) as new *artifact* versions with the case contract and report unchanged (ADR-026).
- [Local Core v0.7 Session](agents/sessions/2026-11-05-local-core-v0.7-review-provenance-corpus-releases.md) — the five v0.6 defects reproduced against merged `main`, and their closure: persisted reviewer provenance, an enforced roster with canonical identity, adjudications bound to the disagreement they settle, one shared binding resolver, atomic staged recoverable batch writes, and deterministic offline corpus releases (ADR-027).

## How to use the documents

Product Requirements states what outcomes are required. System Architecture and Module Boundaries state how components should be separated. Evaluator Methodology and Metrics state how claims and AI responses are assessed. Trust, Safety, Security, and Operations state what must not be compromised. ADRs record consequential decisions and rationale.

A requirement is not implemented merely because it is documented. Link each implemented requirement to code, tests, or observable operational evidence before declaring it complete.

## Engineering governance

- [Engineering Operating Model](governance/ENGINEERING_OPERATING_MODEL.md) — decision rights, product invariants, prioritization, and lifecycle.
- [Work Intake and Delivery](governance/WORK_INTAKE_AND_DELIVERY.md) — issue framing, triage, acceptance criteria, and handoff.
- [Quality Gates](governance/QUALITY_GATES.md) — risk-based verification and release readiness.
- [Query Design and Answerability](evaluator/QUERY_DESIGN_AND_ANSWERABILITY.md) — intent coverage and explicit unknown states.
- [Reporting Specification](evaluator/REPORTING_SPECIFICATION.md) — evidence-linked, reproducible reports.
- [Remediation and Retesting](evaluator/REMEDIATION_AND_LONGITUDINAL_RETESTING.md) — corrective actions and repeat measurement.
- [External Reputation Research](trust/EXTERNAL_REPUTATION_RESEARCH.md) — source independence and reputation evidence.
- [Website-Only Evaluation Scope](product/WEBSITE_ONLY_EVALUATION_SCOPE.md) — boundaries and unresolved decisions for website-only audits.
