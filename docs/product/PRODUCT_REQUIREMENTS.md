# Product Requirements — Aporia AI Evaluator

- Status: Initial requirements baseline
- Version: 0.1
- Updated: 2026-10-28
- Owner: Project owner
- Requirement keywords: MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY have their ordinary normative meanings. A MUST requirement is release-blocking unless an ADR explicitly approves a scoped exception.

## 1. Purpose

Aporia is an evidence-first evaluator for public claims, documented achievements, AI discoverability, answer fidelity, and creator attribution. It helps people who have built, researched, published, or demonstrated something make that work easier to verify and discover. It can investigate cases where AI systems omit an achievement or state that something has not been done when evidence suggests otherwise.

Aporia is not a guarantee of truth, a universal search index, an AI-provider cache controller, or a service that can force citations. It evaluates bounded claims using disclosed evidence and measures observed provider behavior under specified test conditions.

## 2. Primary users and jobs

1. **Independent developers and open-source maintainers:** document a project or capability and test whether AI answers recognize and attribute it.
2. **Researchers and technical teams:** connect papers, repositories, tests, demonstrations, and releases to claims with clear limitations.
3. **Founders and product teams:** assess whether relevant AI answers mention a product accurately and cite useful sources.
4. **Agencies and organizations:** compare trends across multiple authorized domains or projects.
5. **Evaluators and auditors:** inspect provenance, prompts, model configuration, verdict rationale, uncertainty, and run history.

Initial priority SHOULD be technical builders and maintainers because claims may be supported by inspectable artifacts such as source code, release history, test logs, and papers.

## 3. Core jobs-to-be-done

- Establish what is claimed, by whom, and within what scope.
- Identify evidence that supports, limits, contradicts, or fails to establish each proposition.
- Publish a durable, human-readable and machine-readable record on a website the owner controls.
- Make legitimate crawler and indexing blockers visible without claiming to control provider indexing.
- Run controlled tests of representative questions through supported AI/search integrations.
- Record mentions, claim fidelity, source citations, and creator attribution independently.
- Diagnose plausible failure classes such as retrieval gaps, ambiguity, stale public information, source conflict, omission, or unsupported model assertion.
- Produce prioritized, verifiable changes and retest their outcomes.

## 4. Core workflows

### 4.1 Achievement record
A user supplies a project URL, claim, creator details, repository, publication, demonstration, benchmark, or files. Aporia decomposes the claim, retrieves source candidates, records provenance and limitations, and prepares a draft achievement page. The page owner reviews and approves publication. Aporia MUST distinguish user assertion from independently corroborated evidence.

### 4.2 Website discoverability audit
Aporia checks reachable content, status codes, indexability signals, robots directives, canonical metadata, sitemap presence, internal links, structured-data consistency, and evidence-link health. Findings identify checks actually performed and when.

### 4.3 AI answer evaluation
The user specifies entity, claims, intended outcomes, query scope, locale, provider integrations, and budget. Aporia creates or accepts a versioned query set, executes supported integrations, and preserves exact conditions and outputs to the extent permitted by provider terms and privacy policy. It evaluates presence, answer correctness, source use, and attribution independently.

### 4.4 AI disagreement / reality check
The user provides an allegedly incorrect response and evidence. Aporia extracts the disputed proposition, seeks supporting and opposing material, distinguishes factual denial from uncertainty, outdated information, retrieval omission, ambiguity, and safety refusal, and reports what the evidence establishes. Absence of search results MUST NOT be treated as proof of impossibility.

### 4.5 Retest and monitoring
The same versioned query set can be rerun after changes. Reports record changes to model, API, locale, query set, grounding tools, and date. Results under materially different conditions MUST NOT be presented as directly comparable without caveats.

## 5. Functional requirements

### Intake and identity
- FR-001: Accept a URL, one or more claims, the intended outcome, and optional evidence files.
- FR-002: Support URL-only, claim-only, and combined intake. Missing fields must not be fabricated.
- FR-003: Represent claims as atomic propositions with scope, time, units, assumptions, and evidence needs.
- FR-004: Distinguish identity, account control, project ownership, authorship, contribution, and independent verification.
- FR-005: Support permitted public URLs and documented file types with size limits.

### Evidence and assessment
- FR-006: Record URI, retrieval time, source type, publisher/author when known, excerpt locator, access status, and provenance.
- FR-007: Associate evidence with propositions it supports, contradicts, qualifies, or does not address.
- FR-008: Preserve contradictory evidence and unresolved questions.
- FR-009: Explain verdicts with source-linked rationale.
- FR-010: Permit human correction and adjudication with an audit trail.

### Website integration
- FR-011: Generate a suggested human-readable achievement page and machine-readable metadata.
- FR-012: Provide copy/paste, CMS, or API integration as each is implemented.
- FR-013: Validate that structured data matches visible page content.
- FR-014: Check crawler access and indexing only through appropriate, documented methods.
- FR-015: Never describe a page as cached, indexed, or accepted by a provider without evidence for that exact status.

### AI evaluation
- FR-016: Use provider adapters with explicit capabilities and limitations.
- FR-017: Store provider/model identifiers where available, API version, tools/grounding mode, locale, timestamp, and relevant configuration.
- FR-018: Preserve raw answers and returned citation metadata, subject to retention and provider terms.
- FR-019: Score mention, citation, claim fidelity, and attribution separately.
- FR-020: Show denominators, sample sizes, coverage, and uncertainty.
- FR-021: Support repeated runs and distinguish errored, blocked, unavailable, and non-comparable tests.
- FR-022: Do not use scraping or circumvention that violates provider terms; use supported APIs, authorized data, or approved testing methods.

### Reporting
- FR-023: Include scope, tests performed, evidence reviewed, claim verdicts, provider outputs, metrics, limitations, and actions.
- FR-024: Trace each material finding to evidence or clearly state that the evidence set was insufficient.
- FR-025: Distinguish confirmed observations, inferred causes, and recommendations.
- FR-026: State that Aporia cannot guarantee future model answers or provider caching.
- FR-027: Include version/date information for interpretability.

## 6. Non-functional requirements

- **Reproducibility:** preserve immutable run inputs and versioned criteria.
- **Security:** treat URLs, page content, and uploads as hostile input; protect secrets and internal networks.
- **Privacy:** minimize personal data and define retention/deletion before production.
- **Reliability:** provider failure must not become a negative factual verdict.
- **Explainability:** consequential verdicts include rationale and evidence.
- **Accessibility:** core report content must be readable without depending on interaction-only JavaScript.
- **Portability:** provider-specific schemas must not leak into the core domain model.
- **Extensibility:** integrations must not silently change established metric meanings.
- **Cost controls:** expensive tests use visible estimates or bounded budgets.
- **Localization:** language and region are explicit dimensions.

## 7. Acceptance criteria for an initial usable release

A test user can submit a claim and URL, inspect decomposed propositions, see sources and relevance, view a website audit, run at least one supported search-grounded provider test, inspect the response and citations, see separate mention/citation/fidelity/attribution outcomes, view a report, and rerun a versioned evaluation. Tests prove provider unavailability is labeled unavailable rather than scored as a negative mention.

## 8. Non-goals

- Guaranteeing inclusion in any index or AI answer.
- Controlling proprietary model training, internal memory, caching, or ranking.
- Manufacturing citations, endorsements, reviews, backlinks, or corroboration.
- Treating structured data as proof.
- Treating public availability as proof of truth.
- Treating no search result as proof an accomplishment did not occur.
- Circumventing robots directives, paywalls, authentication, rate limits, or safeguards.
- Publishing unreviewed identity or achievement claims by default.
- Producing a universal score that implies objective truth or a universal visibility probability.

## 9. Principal risks

False attribution, overclaiming evidence, misleading aggregation, query-set bias, generalizing provider-specific behavior, exposure of private evidence, SSRF through URL ingestion, and uncontrolled API costs. The Trust, Safety, Security, Evaluator, and Operations documents define controls.
