# Provider Capability and Validation Register

- Snapshot date: 2026-10-28
- Status: Research register, not an implementation claim
- Rule: Every provider row must include source URL, capability checked, last-verified date, live test status, restrictions, and known unknowns.

## 1. Current documented starting points

| Ecosystem | Official reference | What the reference establishes | Current project status |
|---|---|---|---|
| OpenAI / ChatGPT search | [OpenAI Crawler Overview](https://developers.openai.com/api/docs/bots) | OpenAI documents distinct crawler purposes, including search crawling and training-related crawling. | Research reference recorded; no Aporia integration implemented by these docs. |
| Google Search / AI features | [AI features and your website](https://developers.google.com/search/docs/appearance/ai-features) | Google describes existing Search eligibility/SEO fundamentals for AI Search features and does not guarantee inclusion. | Research reference recorded; no Search Console integration implemented. |
| Google Search crawling | [Technical requirements](https://developers.google.com/search/docs/essentials/technical) | Crawl access, successful responses, and indexable content are baseline technical requirements; meeting them does not guarantee indexing. | Research reference recorded. |
| Bing / Copilot surfaces | [Bing AI Performance](https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c) | Official report documents cited pages, citation activity, and grounding-query reporting for supported surfaces, with sampling limitations. | Research reference recorded; no authenticated webmaster integration implemented. |
| Gemini API | [Grounding with Google Search](https://ai.google.dev/gemini-api/docs/google-search) | API documentation describes search grounding and returned citation annotations/search metadata. | Research reference recorded; no adapter implemented. |
| Anthropic API | [Web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool) | API documentation describes web search and cited source output for supported configurations. | Research reference recorded; no adapter implemented. |
| Schema.org | [ProfilePage](https://schema.org/ProfilePage), [Person](https://schema.org/Person), [Organization](https://schema.org/Organization) | Shared vocabularies for describing types of entities/pages. This is not provider-specific indexing authority. | Vocabulary candidates; no generator implemented. |
| NIST | [Generative AI Risk Management Profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) | Risk-management resource for generative AI. It is not an AI visibility score standard. | Reference for risk governance. |

All external references can change. Recheck before implementation and note the exact documentation version/date where an official page provides one.

## 2. Chinese AI/search ecosystems: required research workstream

The project intends to evaluate Chinese AI and search systems, including candidates such as Baidu, DeepSeek, Alibaba Qwen, Moonshot Kimi, ByteDance Doubao, Zhipu GLM, MiniMax, and other relevant services. These are candidates, not a claim that integrations exist.

For each candidate, research and record:
- official API product and model identifiers;
- authorized method for search-enabled response evaluation;
- official crawler/user-agent information, if publicly documented;
- site-owner or webmaster tools and indexing/crawl diagnostics, if any;
- sitemap and robots behavior;
- whether citation/source metadata is returned;
- language and region support;
- account, identity, legal entity, and payment requirements;
- terms, data processing, retention, and content-use restrictions;
- rate limits, cost schedule, geographic access constraints;
- tested example requests/responses and fixtures;
- last-verified date and maintainer/reviewer.

If authoritative documentation is missing, blocked, ambiguous, or not independently inspected, mark the field UNKNOWN / NEEDS RESEARCH. Do not infer behavior from a provider's name, marketing page, or another provider's crawler policy.

## 3. Capability statuses

- **UNASSESSED:** No meaningful research done.
- **DOCUMENTED:** Official documentation read and summarized.
- **PROTOTYPED:** Local implementation exists but not fully tested.
- **CONTRACT-TESTED:** Request/response fixtures pass.
- **LIVE-TESTED:** A real permitted API request succeeds under documented credentials/conditions.
- **PRODUCTION-READY:** Security, terms, rate limits, cost, retries, observability, privacy, tests, and rollback are reviewed.
- **DEPRECATED/BLOCKED:** Integration cannot be safely or lawfully maintained.

Statuses require evidence and dates; do not advance a status based only on written documentation.

## 4. Change tracking

When a provider changes crawler, model, API, citation, or data-use rules, record the change, assess impact on historical comparability, update adapter capability metadata, and create an ADR if core assumptions change. Provider support in Aporia means a tested and maintained path, not simply the ability to mention that company in the UI.
