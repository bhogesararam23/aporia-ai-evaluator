# Engineering Operating Model

- **Status:** Proposed operating standard; owner approval and GitHub enforcement are separate.
- **Scope:** Product decisions, engineering execution, repository governance, and release readiness.

## Objective

Run Aporia as an evidence-led product engineering effort: explicit accountability, reproducible decisions, controlled changes, and truthful delivery status. Professionalism means reliable outcomes, not invented teams or unnecessary process.

Aporia's product objective is to help people document real accomplishments with inspectable evidence, audit website discoverability, and measure how specified AI/search systems describe and attribute supported claims under recorded test conditions.

## Product invariants

1. Evidence support, website discoverability, observed AI visibility, answer fidelity, citation support, and attribution are distinct outcomes.
2. A first-party claim is not independent corroboration. A mention is not proof, recommendation, endorsement, or factual accuracy.
3. Provider failures, inaccessible sources, untested providers, and missing citations are explicit states—not negative factual verdicts.
4. No product promise guarantees crawling, indexing, model memory, recommendation, or citation.
5. Commercial status cannot change evaluator verdicts, evidence standards, query selection, attribution, or metric formulas.
6. Privacy, safety, lawful access, source provenance, correction, and appeal are product requirements.
7. Documentation is not implementation evidence; completion claims require code, tests, or observable operational evidence.

## Accountability and decisions

Until delegated roles are explicitly established, the repository owner is accountable for product scope, architecture acceptance, public claims, risk exceptions, and releases. Do not invent teams, reviewers, customers, legal approval, or organizational processes.

| Decision | Required record |
|---|---|
| Routine, reversible change | Rationale, scoped diff, applicable checks |
| Product scope or priority change | Issue decision and roadmap update |
| Architecture, trust boundary, evaluator semantics, data model, or provider strategy | Sequential ADR, alternatives, impact analysis, validation plan |
| Metric/verdict change | Methodology/version update, benchmark regression evidence, ADR when required |
| Security/privacy/safety exception | Risk, mitigation, expiry, accountable approval; no agent self-approval |
| Release or public claim | Approval, exact revision, known limitations, release record |

Each substantial work item needs one directly responsible individual (DRI). The DRI coordinates progress and handoff but cannot bypass required review.

## Delivery lifecycle

1. **Intake:** define the user problem, affected workflow, evidence, and intended outcome.
2. **Triage:** classify urgency, risk, dependencies, and alignment with product invariants.
3. **Definition:** state acceptance criteria, non-goals, failure cases, observability, privacy/security implications, and rollback needs.
4. **Design:** inspect current implementation and ADRs; choose the smallest complete change.
5. **Implementation:** keep scope bounded, preserve contracts, and add relevant tests/docs.
6. **Verification:** record exact checks and results; distinguish automated checks, human review, and live-provider tests.
7. **Review/release:** obtain applicable approval, disclose limitations, and use reversible rollout where practical.
8. **Operate/learn:** track incidents, corrections, feedback, and evidence-backed follow-up.

## Prioritization

Default order: (1) security/privacy/safety/data integrity and severe trust failures; (2) evidence/attribution correctness and reproducibility; (3) a traceable end-to-end evaluation and understandable report; (4) reliability, cost control, and recovery; (5) deeper audit and provider coverage after core validation; (6) convenience, visual polish, and optional commercial features.

Do not invent numerical targets before a baseline exists. Every target needs a definition, rationale, owner, and review date.

## Repository discipline

- Keep changes focused; use branches and pull requests for material changes.
- Preserve accepted ADRs and session history; supersede decisions instead of rewriting history.
- Document migration, compatibility, observability, and rollback where relevant.
- Never claim a review, approval, test, deployment, or provider capability that did not occur.
- Branch protection, required checks, CODEOWNERS enforcement, and environment approvals must be configured and verified in GitHub separately.
- Commercial services remain separate from evaluator-core, consistent with ADR-007.

## Adoption

This document defines the intended operating standard. Before calling it enforced, verify branch protection, required reviews/checks, issue triage, release permissions, and approval authority in repository settings.
