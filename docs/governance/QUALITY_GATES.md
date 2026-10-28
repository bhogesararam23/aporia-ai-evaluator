# Quality Gates

- **Status:** Proposed verification standard; actual CI and repository enforcement must be checked separately.
- **Principle:** Scale verification to risk. Never imply a check passed if it was not run.

## Gate 1 — Scope and design

- Problem, expected outcome, acceptance criteria, and non-goals are explicit.
- Existing implementation, contracts, and relevant ADRs have been inspected.
- The change is scoped; architecture or evaluator-semantics changes have an ADR where required.
- Privacy, security, safety, lawful access, cost, and failure states are considered.

## Gate 2 — Correctness

- Relevant unit, integration, regression, and contract tests are added or updated where executable code changes.
- Inputs, empty results, timeouts, malformed provider responses, partial failures, and unavailable states are handled explicitly.
- Evaluator changes include representative positive, negative, ambiguous, and abstention cases.
- Reports preserve evidence provenance and distinguish observed facts from inference.

## Gate 3 — Security, privacy, and trust

- No secrets, private customer data, or unnecessary personal data are committed.
- URL ingestion and crawling have SSRF, redirect, DNS/IP, timeout, size, and content-type safeguards where applicable.
- Untrusted web content is treated as data, not instructions.
- Source independence, attribution, corrections, appeals, and limitations are represented honestly.
- Commercial entitlements do not influence evaluator verdicts.

## Gate 4 — Operational readiness

- Relevant logs/metrics, timeout and retry behavior, cost limits, and failure recovery are considered.
- Configuration and secret requirements are documented without exposing values.
- Migration, compatibility, rollout, and rollback are documented where applicable.
- Provider-specific live tests are identified separately from deterministic tests.

## Gate 5 — Review and release

- PR links the work item or explains why it is a small direct correction.
- Exact checks, results, and not-run checks are recorded.
- Known limitations, residual risks, and follow-up are visible.
- Required approval and repository protections are actually configured; Markdown alone does not enforce them.
- Release notes and public claims match the implemented and verified behavior.

## Status vocabulary

- **Drafted:** documentation/design exists.
- **Implemented:** code or configuration exists.
- **Validated:** specified checks ran and passed, with scope recorded.
- **Accepted:** accountable reviewer/owner accepted the change.
- **Released:** the change is deployed or otherwise made available as stated.

These states are not interchangeable. No universal numeric quality threshold is implied; thresholds require a baseline and explicit owner decision.
