# Contributing

## 1. Scope and standards

Contributions include documentation, evaluator logic, provider adapters, web integration, security, and operational improvements. Every change should solve a defined problem, respect package boundaries, and preserve traceability. This project currently has a documentation baseline; implementation choices remain subject to review and ADRs.

## 2. Before work

Read README, relevant documentation, the ADR Index, recent session reports, and related issues. Confirm the target branch and current state. Check for an existing implementation before writing a replacement. Define acceptance criteria and avoid scope creep.

## 3. Change types

- Documentation: update the relevant source-of-truth document and links.
- Architecture: add an ADR before or with the code change.
- Evaluator semantics: update methodology, metrics, benchmark labels, test cases, and versioning together.
- Provider integration: add adapter capability declarations, official references, fixtures, error/limit handling, and a last-verified date.
- Security-sensitive change: document threat assumptions and add negative tests.
- Public publishing feature: require preview, explicit owner approval, rollback, and correction handling.

## 4. Change quality

Make small, coherent changes; keep examples truthful; use absolute dates where time matters; do not invent provider behavior; do not cite sources that were not inspected; and do not label requirements implemented without code/test evidence. Keep secrets and private artifacts out of commits.

## 5. Review and ADRs

Create a sequential ADR when the design changes architecture, core schema, trust boundaries, data retention, scoring semantics, provider approach, or attribution model. Update the ADR Index. Large or risky code changes should use a branch and pull request. Direct changes to the default branch require explicit owner authorization and must not bypass required branch protections.

## 6. Tests and documentation

Run relevant unit, integration, type, lint, security, and evaluator regression tests. Record exact commands/results. If tests cannot run, say so and explain why. Documentation-only changes should validate relative links, internal consistency, and examples.

## 7. Commit and authorship integrity

Use the authenticated repository account under the authorization granted for the task. Commit messages should describe the project change. Do not spoof identities, forge author metadata, claim an unperformed review, or invent tests. Each substantive agent session must create a report in docs/agents/sessions/ with changed paths, validation, commit result, risks, and handoff.

## 8. Definition of Done

Use [Definition of Done](DEFINITION_OF_DONE.md). Merge/release acceptance requires applicable criteria, not merely a completed commit.
