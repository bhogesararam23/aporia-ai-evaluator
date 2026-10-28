# Documentation map

This set defines the intended product, evaluation methodology, trust model, safety boundaries, architecture, and project operating practices. It is organized so product/business policy cannot silently alter technical evaluator judgments.

## Start and operate
- [Root agent instructions](../AGENTS.md) — mandatory entry point for future agents.
- [Product Requirements](product/PRODUCT_REQUIREMENTS.md) — users, problems, requirements, acceptance criteria, non-functional requirements, and exclusions.
- [User Journeys](product/USER_JOURNEYS.md) — achievement records, AI disagreement, website readiness, and monitoring.
- [Implementation Roadmap](product/IMPLEMENTATION_ROADMAP.md) — dependency-ordered delivery phases and exit criteria.
- [Product Governance and Boundaries](business/PRODUCT_GOVERNANCE_AND_BOUNDARIES.md) — product promises and separation from evaluator verdicts.

## Technical design
- [System Architecture](technical/SYSTEM_ARCHITECTURE.md) — components, data flows, trust boundaries, and deployment separation.
- [Module Boundaries](technical/MODULE_BOUNDARIES.md) — enforceable dependency directions, package rules, and future CI requirements.
- [Data Model](technical/DATA_MODEL.md) — entities, relationships, lifecycle, provenance, retention, and versioning.
- [API and Job Contracts](technical/API_AND_JOB_CONTRACTS.md) — normalized request/response, job state, idempotency, and error semantics.
- [Provider Adapters](technical/PROVIDER_ADAPTERS.md) — provider interface, capabilities, failures, and integration criteria.
- [Website Discoverability and Integration](technical/WEBSITE_DISCOVERABILITY.md) — audit, structured data, sitemaps, crawler semantics, and integration options.
- [Provider Capability Register](research/PROVIDER_CAPABILITY_REGISTER.md) — per-provider research/implementation status and last-verified requirement.

## Evaluator science
- [Evaluator Methodology](evaluator/EVALUATOR_METHODOLOGY.md) — claim decomposition, evidence assessment, answer evaluation, reproducibility, and adjudication.
- [Metrics and Scoring](evaluator/METRICS_AND_SCORING.md) — formulas, denominators, interpretation, aggregation, and anti-gaming controls.
- [Benchmarking and Validation](evaluator/BENCHMARKING_AND_VALIDATION.md) — gold sets, human review, validity, reliability, calibration, and release gates.

## Trust and risk
- [Claim and Attribution Trust Model](trust/CLAIM_AND_ATTRIBUTION_TRUST.md) — evidence status, source quality, identity, authorship, roles, disputes, and corrections.
- [Safety Policy](safety/SAFETY_POLICY.md) — abuse cases, allowed/disallowed uses, refusal distinctions, review, and mitigations.
- [Security and Privacy](security/SECURITY_PRIVACY.md) — threat model, tenant isolation, SSRF, uploads, credentials, retention, and deletion.
- [Observability, Cost, and Incidents](operations/OBSERVABILITY_COST_INCIDENTS.md) — run logging, reliability, budget guardrails, alerts, and response.

## Project governance and agents
- [Agent Operating Protocol](agents/AGENT_OPERATING_PROTOCOL.md) — session rules, file ownership, verification, ADR requirements, and transparency.
- [Session Report Template](agents/SESSION_REPORT_TEMPLATE.md) — mandatory end-of-session report.
- [ADR Index](agents/ADR_INDEX.md) — sequential architecture decisions and lifecycle.
- [Contributing](governance/CONTRIBUTING.md) — change workflow.
- [Definition of Done](governance/DEFINITION_OF_DONE.md) — completion criteria for documents, code, evaluator changes, and releases.
- [Release Policy](governance/RELEASE_POLICY.md) — release gates, versioning, rollback, and stop conditions.
- [Glossary](governance/GLOSSARY.md) — shared vocabulary.
- [Primary References](research/REFERENCES.md) — external documentation and evaluation foundations.
- [Documentation Foundation Session](agents/sessions/2026-10-28-documentation-foundation.md) — scope, decisions, outputs, validation, and follow-up.

## How to use the documents

Product Requirements states what outcomes are required. System Architecture and Module Boundaries state how components should be separated. Evaluator Methodology and Metrics state how claims and AI responses are assessed. Trust, Safety, Security, and Operations state what must not be compromised. ADRs record consequential decisions and rationale.

A requirement is not implemented merely because it is documented. Link each implemented requirement to code, tests, or observable operational evidence before declaring it complete.
