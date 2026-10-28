# Provider Adapters

**Status: Not implemented. This is intentional for local core v0.1.**

No AI/search provider is called, configured, mocked, scraped, or advertised as supported. Provider/model/interface fields in a manual run are operator-supplied labels. There are no API keys, provider SDKs, capability records, or live tests in this milestone.

Before an adapter is added, the project must establish:

- an officially supported access route and current terms review;
- a versioned capability declaration (models, grounding, citation metadata, locales, limits, costs, retention);
- provider-specific fixtures and deterministic contract tests;
- a separate live-test process with budgets and credentials;
- an ADR and security review for the outbound network boundary;
- explicit preservation of the rule that provider unavailability is not a negative factual verdict.

See [Provider adapter contract](../../docs/technical/PROVIDER_ADAPTERS.md), ADR-004, ADR-005, and ADR-010.
