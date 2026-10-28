# ADR-005: Do Not Promise Provider Caching, Indexing, or Citations

- Status: Accepted for initial baseline
- Date: 2026-10-28
- Related: ADR-004, ADR-006

## Context

The product vision includes helping users make an achievement visible to AI systems. External providers control crawling, indexing, internal retrieval, model training, memory, ranking, caching, and answer construction. Aporia cannot guarantee those actions across products, models, regions, or user prompts.

## Decision

Aporia must report only observable or provider-reported states with source and timestamp. The system distinguishes page reachability, named-crawler access, sitemap submission, observed indexing signal, returned citation, and correct attribution. A “not observed” state must include scope and must not be interpreted as proof that the provider has never crawled or cached content. Public wording must not promise universal inclusion or citation.

## Alternatives considered

- Offer “cache all AI tools” as a product guarantee: rejected as technically unobservable and outside Aporia's control.
- Infer indexing from successful HTTP fetch: rejected because access is not indexing.
- Infer training/memory from web citations: rejected because search retrieval and model training are distinct operations.

## Consequences

The value proposition focuses on public evidence, technical accessibility, measurable observations, and continuous evaluation. Reports may contain “unknown” states when providers expose no diagnostic. The platform must implement clear status language and educate users on the distinction.

## Validation

Website audit tests ensure that a reachable page is never labeled indexed without a suitable source of evidence. Provider adapters separately represent crawler control and answer citations where such data is available. Marketing and product copy are reviewed against this decision.
