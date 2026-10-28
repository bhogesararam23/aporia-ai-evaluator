# Primary References and Research Foundations

- Last link review: 2026-10-28
- Scope: external platform behavior and general risk/evaluation references informing this specification.
- These sources do not establish that Aporia has implemented or passed any provider integration.

## 1. Search and crawler controls

### OpenAI — Overview of OpenAI Crawlers
https://developers.openai.com/api/docs/bots

Used for: distinguishing crawler purposes and understanding that search crawling and training-related crawling are separate controls. Recheck user-agent names, robots behavior, and timing guidance before implementation.

### Google Search Central — AI Features and Your Website
https://developers.google.com/search/docs/appearance/ai-features

Used for: current Google guidance for eligibility in AI Overviews/AI Mode and the relationship to ordinary Search requirements. Google notes that satisfying requirements does not guarantee crawling, indexing, or serving.

### Google Search Central — Technical Requirements
https://developers.google.com/search/docs/essentials/technical

Used for: baseline crawl/index eligibility requirements and the distinction between eligibility and guaranteed indexing.

### Google Search Central — Sitemaps
https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview

Used for: sitemap discovery and submission guidance. A sitemap does not guarantee indexing.

### Bing Webmaster Tools — AI Performance
https://www.bing.com/webmasters/help/ai-performance-9f8e7d6c

Used for: documented AI citation reporting across selected Microsoft Copilot/Bing AI surfaces. The report describes aggregated and sampled activity; it is not a complete log of every AI answer and does not establish causal attribution.

### Bing Webmaster Blog — AI Performance public preview
https://blogs.bing.com/webmaster/2026/2/Introducing-AI-Performance-in-Bing-Webmaster-Tools-Public-Preview/

Used for: the announced availability and intended scope of Bing AI citation reporting. Confirm present availability before relying on it operationally.

## 2. Search-grounded provider APIs

### Google AI for Developers — Grounding with Google Search
https://ai.google.dev/gemini-api/docs/google-search

Used for: API behavior for search grounding and source annotations. Model support, billing, tool names, and response schemas are time-sensitive and must be rechecked before building an adapter.

### Anthropic — Web Search Tool
https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool

Used for: API search behavior and citation output. Supported models, tool versions, usage/cost, and data settings must be confirmed for the exact API account and implementation date.

## 3. Structured data vocabulary

- Schema.org ProfilePage: https://schema.org/ProfilePage
- Schema.org Person: https://schema.org/Person
- Schema.org Organization: https://schema.org/Organization
- Schema.org Article: https://schema.org/Article
- Schema.org SoftwareApplication: https://schema.org/SoftwareApplication

Used for: choosing an appropriate vocabulary for visible page content. A vocabulary is not a truth guarantee and does not guarantee indexing or AI citation. Provider-specific structured-data policies must be checked separately.

## 4. Evaluation and risk management

### NIST — Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile
https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence

Used for: framing trustworthiness, risk identification, governance, and lifecycle controls for generative AI systems. It is not a metric standard for AI visibility.

### Ragas — Available Metrics
https://docs.ragas.io/en/latest/concepts/metrics/available_metrics/

Used as an implementation-research reference for concepts such as faithfulness and retrieval/context metrics. The project must independently validate which metric fits its task; no library metric should be adopted solely because it exists.

### GEO: Generative Engine Optimization (research paper)
https://arxiv.org/abs/2311.09735

Used as research background for studying source/content visibility in generative search systems. Published experimental effects must not be generalized to all platforms, queries, users, or content types.

## 5. Chinese provider documentation

No universal Chinese-provider crawler or citation behavior is assumed in this document. The current integration register treats each provider's API, web retrieval, crawler, webmaster tooling, region restrictions, and citation metadata as an individual research task. Add an official provider source only after opening and verifying the current documentation and recording date, observed claims, and limitations.

## 6. Citation and maintenance rules

- Prefer official provider/standards sources for product behavior and schema meaning.
- Prefer peer-reviewed or preprint research for research claims, with publication status stated.
- Record retrieved date for time-sensitive sources.
- Do not cite a page that was not inspected.
- If a source becomes unavailable, keep the historical reference but mark it unavailable and seek an official replacement.
- Separate a statement that the provider documents a feature from a statement that Aporia has implemented or tested that feature.
