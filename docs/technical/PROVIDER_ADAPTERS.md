# Provider Adapter Contract and Integration Policy

## 1. Purpose

Aporia evaluates responses and evidence across heterogeneous AI/search systems. Each system exposes a different API, model identity, citation schema, crawl policy, locale support, and retention/terms boundary. Adapters normalize observable behavior without pretending that providers are equivalent.

## 2. Adapter responsibilities

Every adapter must:
- declare supported operations and explicit unsupported operations;
- identify API/interface version and model identifier when returned;
- state whether it supports web/search grounding and what citation metadata is exposed;
- validate and serialize requests using a provider-specific schema;
- normalize the response while preserving raw metadata where permitted;
- classify rate limits, authentication errors, policy refusals, timeouts, malformed responses, partial responses, and provider outages distinctly;
- enforce timeout, retry, concurrency, and cost limits;
- record the relevant request ID if allowed;
- declare data handling, retention, regional, and terms constraints known to the project;
- provide fixture-driven unit tests and integration tests when credentials are available.

An adapter must not invent citations, model identity, search steps, or source provenance. A normalized schema must be able to express “citation data unavailable.”

## 3. Shared request contract

Each call should carry:
- evaluation run and test IDs;
- exact prompt and locale/region;
- model/product selection or documented default;
- search/grounding configuration;
- max output tokens or other relevant caps;
- deadline and cancellation signal;
- budget/usage envelope;
- privacy classification and permitted data fields.

Provider keys are injected securely by runtime configuration. They must not be carried in stored job payloads or exposed to the browser.

## 4. Shared response contract

Return:
- status: success, partial, unavailable, rejected, timeout, rate-limited, or error;
- provider name and model/API identifier where available;
- raw response reference or minimized raw response;
- normalized answer text;
- citations with exact returned URL/title/snippet/annotation when exposed;
- search/tool activity only if the provider explicitly returns it;
- token/search usage and cost estimate/actual cost when known;
- start/end time and provider request ID where permitted;
- warnings and normalization notes.

Do not infer hidden chain-of-thought or private internal retrieval details. Store only observable output and disclosed metadata.

## 5. Grounded and ungrounded modes

Treat a search-grounded API call as an experiment in that API configuration, not as a perfect proxy for the consumer application. Grounded and ungrounded runs must have separate configuration labels. A citation returned by an API does not prove that every consumer product uses the same ranking or retrieval path.

## 6. Integration capability matrix

Maintain a versioned matrix per provider:
- supported API or official integration;
- supported model identifiers and dates checked;
- search/grounding capability;
- citation/annotation format;
- locale support;
- crawler access guidance, if official;
- public indexing diagnostics available;
- tool/capability limitations;
- authentication/region requirements;
- known cost/rate limits and retrieval constraints;
- tests last run and failures.

Do not advertise “all Chinese AI tools” as supported. Add Baidu, DeepSeek, Qwen, Kimi, Doubao, or other systems individually only after an official access route or authorized test method and usable observation schema have been validated. A model's consumer web interface does not automatically permit programmatic testing.

## 7. Query execution and budgets

Query plans should be bounded by maximum queries, provider calls, retries, duration, and currency budget. Do not start new model/search calls after cancellation or budget exhaustion. Support idempotency keys where the provider/API permits. If a provider fails after partial response, preserve the partial state and do not count it as a clean negative result.

## 8. Citation normalization

Keep provider-provided URL and citation metadata verbatim in the raw observation when lawful. Normalize canonical URLs only in a separate field. Preserve redirects/aliases where meaningful. Resolve citations to source records as a separate step. Citation matching should not accidentally treat a third-party source as target-owned because its text mentions the target.

## 9. Provider changes and deprecation

When an API version, model default, tool name, output schema, or terms change:
1. update the capability record;
2. add/change fixtures;
3. run adapter contract tests;
4. assess cost and metric comparability;
5. record an ADR when architecture or assumptions materially change;
6. version the adapter;
7. communicate any effect on old reports.

## 10. Ethical and contractual boundary

Use supported APIs, authorized data, or a method explicitly approved by project governance. Do not bypass anti-bot challenges, log into consumer accounts without authorization, evade limits, or misrepresent evaluation access. Obey provider terms for stored outputs and data retention.
