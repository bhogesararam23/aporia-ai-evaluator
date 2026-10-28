# ADR-004: Isolate Provider Integrations Behind Adapters

- Status: Accepted for initial baseline
- Date: 2026-10-28
- Related: ADR-003, ADR-005, ADR-007

## Context

AI/search services vary in API access, web grounding, citation metadata, model/version identifiers, locale support, crawler policy, terms, rate limits, and response formats. Direct provider-specific logic inside evaluation rules would create coupling and make comparisons misleading.

## Decision

Define a shared provider contract and implement each provider as an isolated adapter. Each adapter declares capabilities, limitations, versions, citations, observable search activity, cost/rate constraints, and last validation date. The adapter normalizes returned fields without inventing metadata and retains raw response references where permitted. The evaluator core consumes normalized observations only.

## Alternatives considered

- One generic prompt runner with no adapter contracts: rejected because provider failures and metadata differences would be mishandled.
- One code path per provider inside evaluator domain: rejected because provider API changes would alter core semantics.
- Scraping consumer interfaces as default: rejected because access may violate terms, be unstable, or fail to expose provenance.

## Consequences

More adapter code and contract tests are required. In return, provider additions/deprecations are isolated, capability gaps stay explicit, and output comparison can be versioned.

## Validation

Adapter tests cover success, partial output, malformed output, timeout, rate limit, policy refusal, unavailable provider, citation parsing, and budget exhaustion. An unavailable provider must never become a negative claim verdict.
