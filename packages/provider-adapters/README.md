# Provider Adapters

**Status: Planned package — no provider adapter is implemented by this documentation baseline.**

Each adapter isolates one external AI/search provider. It owns provider-specific authentication, request schema, model/tool selection, response parsing, citation extraction, rate-limit interpretation, retries, and capability declarations.

Requirements:
- implement the shared contract defined in docs/technical/PROVIDER_ADAPTERS.md;
- preserve raw observations where permitted and never fabricate citations;
- distinguish success, partial result, unsupported action, policy rejection, timeout, rate limit, and provider outage;
- never translate provider failure into an incorrect/negative factual verdict;
- declare known costs, limits, regional restrictions, data handling constraints, and last-tested date;
- include fixtures and tests for malformed/empty/partial responses;
- do not import commercial tier or billing logic;
- do not scrape/circumvent consumer interfaces unless a specifically reviewed, authorized method is permitted.

The project must not advertise a provider as supported solely because its name appears in configuration.
