# ADR-001: Establish a Documentation-First Foundation

- Status: Accepted for initial baseline
- Date: 2026-10-28
- Decision owners: Project owner
- Related: ADR-002, ADR-003, ADR-007

## Context

Aporia's intended scope touches factual claim evaluation, public achievement attribution, AI/search visibility, website publishing, provider integrations, safety, and privacy. Implementing these as one undifferentiated application risks hidden assumptions, unsupported promises, and entanglement of user-facing business goals with evidence judgments. The repository had no committed implementation or existing product documents when this baseline was started.

## Decision

Establish a documentation set before introducing application code. The set must include product requirements, user journeys, technical architecture, data model, evaluator methodology and metrics, benchmark validation, trust and attribution, safety, security/privacy, operations, provider adapters, website discoverability, agent operating rules, and sequential ADRs. Documents distinguish requirements from implemented behavior. Any future code that claims conformance must be linked to tests or observable evidence.

## Alternatives considered

1. Start coding immediately and document later. Rejected because requirements and score semantics would be decided implicitly in code.
2. Use a single README as the complete specification. Rejected because evaluator methodology, safety boundaries, and operations need independent depth and ownership.
3. Separate every document into unrelated repositories. Deferred because the initial project benefits from a single versioned source of truth.

## Consequences

Positive: clearer scope, reviewable assumptions, traceability, and lower risk of undocumented product promises. Negative: initial implementation starts later and documents may drift unless maintained. To control drift, Definition of Done and agent session reports are mandatory.

## Safety, trust, and validation

The baseline prohibits guarantees of provider indexing, caching, memory, ranking, or citations. Claim evidence, visibility, answer fidelity, and attribution are separate concepts. Documentation is not a claim that software is already implemented or validated.

## Implementation and validation

- Create documentation index and link all source-of-truth docs.
- Add Definition of Done and agent protocol.
- Require ADRs for material architectural changes.
- Validate links and update session report before declaring this foundation complete.
