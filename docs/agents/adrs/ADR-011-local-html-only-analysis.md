# ADR-011: Analyze Only User-Supplied HTML Locally

- Status: Proposed
- Date: 2026-10-28
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-005, ADR-008, ADR-012

## Context

The product specification includes a website discoverability audit that eventually checks reachable pages, HTTP status, robots.txt, sitemaps, canonical URLs, structured data, and link health. The local v0.1 milestone forbids remote website fetching, crawling, and external services. It still requires local analysis of user-supplied HTML files or pasted HTML and requires network-dependent checks to be marked unavailable rather than passed.

Fetching arbitrary URLs is the highest-risk boundary in the product (SSRF, DNS rebinding, redirects, active content, size limits). Implementing it without deployment-grade egress controls would be unsafe and outside the milestone. Parsing supplied HTML is still a hostile-input boundary: malformed markup, oversized documents, embedded scripts, and deceptive structured data must not compromise the application or produce false claims.

## Decision

1. v0.1 accepts HTML through one of two routes: paste into a textarea or upload a `.html`/`.htm` file. It reads at most a configurable, hard-capped number of bytes (default 1,000,000; maximum 5,000,000), rejects NUL bytes, and requires valid UTF-8.
2. HTML is parsed with `parse5`, a spec-compliant parser. The parser is used as a data transformation only. No scripts, styles, frames, or active content are executed. Raw HTML is never inserted into the application’s response; extracted values are escaped, and the Content Security Policy forbids inline and remote script execution.
3. The audit performs only checks observable from the supplied bytes:
   - document title, meta description, language, viewport;
   - meta robots tokens;
   - canonical link presence, count, and absolute HTTP(S) syntax;
   - `<link rel="sitemap">` presence (not retrieval);
   - heading structure and presence of a main content region;
   - visible-text length and script count, with an explicit heuristic note when content may depend on client-side rendering;
   - JSON-LD blocks: syntax validity and simple visible-content alignment for declared names/headlines/authors;
   - author and date signals;
   - link counts, unsafe link schemes, and image alternative-text coverage;
   - a SHA-256 digest and byte length of the exact input;
   - parser errors reported as observations, not crashes.
4. Checks requiring network access are always reported as `UNAVAILABLE`, with the reason “network access is disabled in local v0.1.” These include reachability, HTTP status, redirects, robots.txt retrieval, sitemap retrieval and inclusion, TLS, index status, provider crawling, caching, and live link health. They are never reported as passed, failed, or clean.
5. The audit is immutable after creation and stores the exact HTML snapshot, digest, byte length, input method, optional filename, timestamp, methodology version, findings, and unavailable checks. Pasted HTML is limited by the same byte cap. A later audit is a new record.
6. Findings use disclosed categories (`BLOCKING`, `LIKELY_DISCOVERABILITY_ISSUE`, `EVIDENCE_CLARITY`, `HOUSEKEEPING`, `INFORMATIONAL`, `UNAVAILABLE`). They describe the observation, its scope, and a proportionate recommendation. No numeric discoverability score is produced. A reachable page is not indexing; valid structured data is not truth.
7. No URL fetching, DNS resolution, crawler, headless browser, remote asset loading, or provider submission exists in v0.1. The UI and report state this limitation on every audit.
8. Adding remote fetching later requires a new ADR plus SSRF, redirect, DNS-rebinding, size/time limits, isolation, authorization, and live-network tests from the security specification.

## Alternatives considered

1. **Fetch URLs with a basic SSRF filter.** Rejected for v0.1: incomplete network isolation and redirect/rebinding defenses would create a false sense of safety, and the milestone forbids remote fetching.
2. **Regex-based extraction.** Rejected: malformed or adversarial HTML would yield unreliable findings and could produce misleading structured-data claims.
3. **Headless browser rendering.** Rejected: heavy, executes untrusted active content, and requires network access for external assets.
4. **Treating robots.txt/sitemap/indexing as unknown or passed by default.** Rejected: ADR-005 forbids inferred provider states; the only honest state is unavailable.
5. **Storing only extracted findings, not the snapshot.** Rejected because reports must be reproducible from the exact input.

## Consequences and trade-offs

- Users must supply the HTML themselves; the audit cannot verify that it is the response a crawler receives.
- Canonical, robots, and structured-data checks are limited to in-document declarations. Server headers, effective canonicalization, and live redirects remain unobserved.
- Storing HTML increases local data sensitivity; snapshot deletion is possible through project deletion, and the raw HTML is never rendered.
- The parser adds a runtime dependency but is preferable to unreliable custom parsing.

## Security, privacy, safety, and evaluator-validity implications

- Upload and paste limits protect memory and parsing time. UTF-8 validation and NUL rejection reduce binary/parser abuse.
- Extracted titles, metadata, and excerpts are untrusted data and are HTML-escaped. JSON-LD is parsed as data, never executed.
- Link URLs are validated for HTTP(S) before being rendered as links; unsafe schemes are reported and not linked. External links use `rel="noopener noreferrer nofollow"`.
- The report must not imply that in-document metadata proves indexability, caching, citation, or truth.
- No network egress means prompt-injection content in HTML cannot trigger tool calls or data exfiltration in v0.1.

## Implementation and migration plan

1. Implement size and encoding guards at the request boundary.
2. Implement `analyzeHtml` with deterministic extraction and findings.
3. Persist immutable audit records with snapshots and digests.
4. Render findings and unavailable checks in the UI and reports.
5. Add a documented future-work section for remote fetching with SSRF controls.

## Tests and validation required

- Tests for oversized, binary, invalid-UTF-8, and malformed HTML inputs.
- Tests that network-dependent checks are `UNAVAILABLE`, never passed.
- Tests for noindex detection, canonical validation, JSON-LD syntax, and visible-content mismatch.
- XSS tests proving script tags, event handlers, and `javascript:` URLs are escaped or rejected, not executed.
- Determinism tests proving identical input produces identical findings and digest.
- Report tests proving audit limitations and unavailable checks are disclosed.
