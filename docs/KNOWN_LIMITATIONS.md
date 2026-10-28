# Known Limitations and Out-of-Scope Behavior

- Status: Current as of local core v0.1
- Date: 2026-10-29

This document prevents the implementation from being mistaken for the complete product or a production-ready system. It should be updated whenever a milestone closes one of these gaps.

## 1. No provider, LLM, search, or remote integrations

- Aporia does not call any AI provider, search API, model, embedding service, or cloud function.
- There is no scraping, browser automation, headless rendering, crawling, or remote website fetching.
- No provider capability is advertised as supported. Provider/model/interface labels in a run are operator-supplied strings, not verified integrations.
- Manual observations are the only answer source. Results are limited to what an operator actually captured and recorded.
- No automatic query generation, answer extraction, semantic matching, or model-assisted judgment exists. Human assessments are explicit; the evidence summary is a transparent rule over human-recorded relationships.

## 2. No publication or discovery control

- No achievement page is generated, published, or updated.
- No JSON-LD publication, sitemap submission, canonical redirect, CMS, or Git patch integration exists.
- Local HTML analysis inspects only supplied bytes. HTTP status, effective headers, redirects, robots.txt, sitemaps, TLS, live link health, rendering, indexing, caching, model memory, and provider citations are unavailable, not passed.
- Aporia cannot force any system to crawl, index, retain, recommend, or cite content, and does not suggest otherwise.

## 3. Evaluator validity is not established

- No human-reviewed gold set, benchmark, inter-rater study, calibration, or independent validation has been completed.
- The evidence rule is transparent but unvalidated; the quality of its output depends on human classification quality.
- Human reviewer labels are asserted local labels, not authenticated identities.
- No confidence intervals are computed. Samples are purposively selected and repeated responses to one query can be correlated.
- No composite score exists. A future composite would require an ADR, calibration, missing-data policy, and misuse review.
- Metrics cannot be generalized to all AI systems, regions, languages, or future provider behavior. Provider output is an observation under one recorded configuration.

## 4. Identity, attribution, and trust limits

- Identity statuses are `UNVERIFIED` or `SELF_DECLARED`; no account control, domain control, or independent identity verification exists.
- Attribution assessment covers the answer’s named entity, role, and source only as recorded by a reviewer. It does not establish legal authorship, ownership, or sole credit.
- Supporting and contradictory evidence can coexist. A `SUPPORTED_WITHIN_SCOPE` rule result is not universal proof.
- No dedicated achievement registry, correction/appeal workflow, independent reviewer assignment, or public dispute handling exists. Audit events and append-only assessments provide a local review history.

## 5. Platform and operations limits

- Single local operator, single process, one loopback host; no authentication, authorization, role separation, or multi-tenancy.
- No remote access, TLS, reverse proxy, rate limiting, or production hardening.
- SQLite via `node:sqlite` is experimental in the tested Node release. Schema and driver compatibility should be rechecked on Node upgrades.
- No automatic backup, retention schedule, encryption at rest, secret manager, or disaster recovery. Stopping the server and copying the SQLite file/WAL/SHM is the only documented backup procedure.
- Project deletion removes local records and audit events. Exported files are outside Aporia’s control.
- The application may display sensitive claims, answers, evidence excerpts, and HTML snapshots. Reports and project exports require user judgment before sharing.

## 6. Input and parsing limits

- Only HTML files (`.html`/`.htm`) can be uploaded for local analysis. PDFs, office documents, images, archives, and arbitrary files are not supported.
- HTML is parsed with `parse5`; scripts are never executed. Client-side-rendered content is not observed. The visible-text heuristic is disclosed and not a rendering test.
- JSON-LD alignment checks simple declared names/headlines against visible text. It cannot establish semantic truth or schema validity for every vocabulary.
- Observation JSON import accepts a bounded array of documented objects. It does not parse arbitrary provider exports.
- No OCR, language detection, translation, or multilingual UI beyond explicit locale fields.

## 7. User experience and accessibility limits

- The UI is English-only and server-rendered; there is no JavaScript interactivity.
- Automated structural accessibility checks pass for the tested pages, but no screen-reader, keyboard-only user study, mobile device, or cross-browser audit has been completed.
- Some long forms are necessarily dense (especially proposition decomposition and observation entry). They prioritize completeness over a guided wizard.
- Error summaries are textual and server-rendered; there is no client-side field focus management beyond native HTML and links.
- The interface was visually checked in a desktop dark color scheme. Light mode uses the same semantic structure but was not visually reviewed in this session.

## 8. Reporting and governance limits

- Reports are project snapshots; there is no scheduled monitoring, alerting, retest notification, or longitudinal dashboard.
- Comparisons are limited to identical query-set versions and declared provider configuration. Deltas are descriptive, not causal.
- Remediation suggestions are derived from recorded gaps/findings and are not tracked work items with owners, due dates, or status transitions.
- Report exports include all recorded material; there is no redaction workflow or share-scope control.
- No license is declared. No legal, privacy, consumer-protection, or regulatory review has been completed.
- The repository is not production-ready, independently audited, or backed by verified CI/release controls merely because checks pass locally.

## 9. Missing domain entities and workflows

The following data-model concepts are documented in the baseline but are not implemented in local v0.1:

- Achievement records and publication statuses;
- public report sharing and unguessable links;
- dedicated review/appeal events (local audit and assessment history are used instead);
- provider capability records;
- citation-to-source resolution;
- remediation work-item tracking;
- benchmark and gold-set management;
- scheduled provider tests and monitoring;
- accounts, organizations, plans, billing, and quotas.

## 10. Appropriate use of this milestone

Use local v0.1 to:

- document a real claim and inspectable evidence;
- record a real manually captured answer and classify it transparently;
- inspect supplied HTML for in-document discoverability signals;
- generate a reproducible local report that states what was and was not tested.

Do not use it to:

- claim provider coverage, indexing, caching, or citation guarantees;
- claim universal truth or AI-quality scores;
- publish accusations or sensitive personal data without review and authorization;
- substitute for legal, scientific, identity, or security verification.

See [Implementation Status](IMPLEMENTATION_STATUS.md) for the requirement matrix and [Testing](TESTING.md) for what was actually run.
