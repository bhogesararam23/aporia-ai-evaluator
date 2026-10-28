# ADR-007: Separate Evaluator Core from Commercial Concerns

- Status: Accepted for initial baseline
- Date: 2026-10-28
- Related: ADR-001, ADR-003, ADR-004

## Context

Aporia may eventually add accounts, paid plans, usage limits, billing, agency workspaces, and commercial reporting. These concerns are orthogonal to whether a proposition is supported by evidence and how AI output metrics are calculated. Intermixing them would increase coupling and create incentives to manipulate results for paying users.

## Decision

Keep evaluator domain logic isolated from billing, subscription status, sales, invoices, pricing, and entitlements. Commercial/application code may authorize a job and apply disclosed resource limits before it runs, but the evaluator receives a validated, plan-neutral job specification. Commercial state must not alter evidence verdicts, metric formulae, source weighting, attribution correctness, or report caveats.

## Alternatives considered

- Put entitlement checks inside metric/scoring functions: rejected because it contaminates evaluation semantics.
- Duplicate evaluator logic for plan tiers: rejected because tier-specific outputs would no longer be comparable.
- Add a separate microservice immediately: deferred; a package boundary is sufficient until scale/security needs justify deployment separation.

## Consequences

The repository and future module layout require a distinct commercial package or service. API-level access control still needs integration, but evaluator code must not depend on it. Tests should prove identical evaluator inputs produce identical outputs regardless of account plan.

## Validation

A deterministic evaluator test must run the same job input under different simulated commercial plans and assert identical verdicts and metrics. Access/quota behavior is tested separately at application boundary. Any exception requires a new ADR and independent review.
