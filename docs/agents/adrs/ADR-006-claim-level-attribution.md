# ADR-006: Model Attribution at Claim and Role Level

- Status: Accepted for initial baseline
- Date: 2026-10-28
- Related: ADR-002, ADR-003, ADR-005

## Context

Aporia aims to help people receive accurate credit for accomplishments. Evidence may establish that a project exists without proving who created it, and may establish an individual's contribution without proving sole authorship. Projects may have teams, maintainers, funders, organizations, and contributors.

## Decision

Represent attribution as a separate assessment tied to a specific accomplishment and role. Support identity, account/domain control, project ownership, listed authorship, contribution evidence, and independent corroboration as distinct facts. Store supporting evidence and ambiguity. Never infer sole credit from repository ownership or profile linkage alone. Pages and outputs should use precise roles and support multiple people when evidence indicates collaboration.

## Alternatives considered

- One global “verified person” badge: rejected because it is underspecified and can imply broad credibility.
- Treating the first name in search results as creator: rejected as unreliable.
- Automatically assigning repository ownership as sole authorship: rejected because repository control is not sole contribution.

## Consequences

The data model and UI need role-aware records and correction workflows. Attribution outputs may be “uncertain” even if the technical accomplishment is supported. This is intentional and protects users from false credit.

## Validation

Tests must include multiple contributors, namesakes, changed maintainer roles, false sole-credit claims, and sources that establish identity but not accomplishment.
