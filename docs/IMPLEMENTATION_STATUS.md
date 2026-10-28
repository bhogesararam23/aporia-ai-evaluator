# Implementation Status — Local Core v0.1

- Status: Implemented and locally validated; owner acceptance and release remain pending
- Date: 2026-10-29
- Branch: `feat/aporia-local-core-v0.1`
- Scope: local-first evidence evaluation without provider, cloud, crawler, or publishing integrations

This matrix records what is actually implemented and verified in this repository. “Validated” means the named local check ran successfully; it does not mean an external review, production deployment, or provider validation occurred. The existing documents remain the requirements source of truth.

## 1. Capability status

| Capability | Status | Implementation | Verification |
|---|---|---|---|
| Local project workspace | Implemented / Validated | Project creation and profile editing, target entities, lifecycle and audit; `src/persistence/repositories/projects.ts`, `src/app/routes/projects.ts` | `tests/integration/repositories-projects.test.ts`, `tests/integration/project-workflows.test.ts` |
| Entity records and roles | Implemented / Validated | Entity types, aliases, URLs, declared identity status/method/scope; no independent verification | Repository and HTTP tests; identity copy is asserted |
| Claims and immutable revisions | Implemented / Validated | Append-only revisions, current revision, lifecycle; `src/core/lifecycle.ts`, `src/persistence/repositories/claims.ts` | Schema, repository, and claim workflow tests |
| Atomic propositions | Implemented / Validated | Immutable propositions, conditions, time interval, units, evidence requirements, expected criterion, ambiguity notes | Schema and claim workflow tests |
| Sources and provenance | Implemented / Validated | Source descriptor, access route, retrieval time, type, independence, notes; no remote retrieval | Schema, repository, and evidence tests |
| Evidence items and locators | Implemented / Validated | User-supplied excerpt, locator, extraction method/time, SHA-256 digest, fixed provenance | Schema and repository tests |
| Supporting/contradictory evidence | Implemented / Validated | Active relationships coexist; one active pair; supersession retains history | Core, schema, repository, claim workflow tests |
| Deterministic evidence rule | Implemented / Validated | `evidence-aggregation-v1` with explicit precedence/caveats | Core evidence tests and report tests |
| Human proposition assessment | Implemented / Validated | Append-only versions, rationale, reviewer, evidence snapshot; disagreement with rule is visible | Schema, repository, report tests |
| Versioned query sets | Implemented / Validated | Draft/approved, per-name versions, frozen approved text, clone for retest | Repository, query set HTTP workflow tests |
| Manual evaluation runs | Implemented / Validated | Frozen query-set/config snapshots, open/finalized/cancelled, immutable terminal state | Schema, repository, run workflow tests |
| Manual observation capture | Implemented / Validated | Exact prompt snapshot, raw answer, status, context, citation capture state; no provider call | Repository, claim/run HTTP tests |
| Observation JSON import | Implemented / Validated | Strict, all-or-nothing import with citations and assessments; ordinal mapping | `tests/integration/evaluation-workflows.test.ts` |
| Citations and target ownership | Implemented / Validated | Recorded URLs, titles/snippets, target-owned flag, one-way void | Schema, repository, run workflow tests |
| Answer assessments | Implemented / Validated | Presence, fidelity, citation support, attribution; versioned per dimension; role field | Core metrics and run workflow tests |
| Separate metrics v1 | Implemented / Validated | Mention, target/any citation, citation support, fidelity, attribution, observed coverage; explicit denominators/exclusions | `docs/evaluator/IMPLEMENTED_METRICS_V1.md`, core metrics tests |
| Coverage and unknowns | Implemented / Validated | Errors/refusals/timeouts excluded with reasons; null rates when no eligible units | Core and schema tests; report tests |
| Local HTML audit | Implemented / Validated | User-supplied paste/upload, parse5, in-document findings, network checks unavailable | Website unit tests, audit repository and upload tests |
| HTML snapshot storage | Implemented / Validated | SHA-256, byte length, raw local snapshot, findings/unavailable/metadata; immutable | Audit schema and repository tests |
| Immutable report snapshots | Implemented / Validated | Versioned snapshot, rendered only from stored JSON; earlier reports retained and superseded | Reporting unit, service, repository, HTTP immutability tests |
| JSON/CSV exports | Implemented / Validated | Report JSON, metrics/findings/observations CSV, local audit JSON, project JSON; formula-injection protection; download audit events | CSV unit tests, workflow and audit tests |
| Run comparisons | Implemented / Validated | Only identical query set/config are comparable; deltas labelled descriptive, not causal | Reporting unit tests |
| Audit trail | Implemented / Validated | Append-only local events; project deletion removes them (disclosed); export actions audited | Audit/schema, project, claim, run tests |
| Deletion and export control | Implemented / Validated | Explicit JSON export and typed-name project deletion with cascade disclosure | Project workflow tests |
| Server-rendered UI | Implemented / Validated | Complete claim/evidence/query/run/audit/report workflows, empty/error states, forms | HTTP, workflow, and accessibility tests |
| Local security controls | Implemented / Validated | Loopback binding, Host/Origin/CSRF, CSP, body/upload limits, escaping, safe URLs, parameterized SQL | Config, security, body, HTTP, view, audit tests |
| Documentation and runbook | Implemented / Validated | Architecture, schema, metrics, testing, limitations, operations, README | Link check and manual review |

## 2. Product requirement mapping

| Requirement | Status | Notes |
|---|---|---|
| FR-001: accept URL, claims, intended outcome, optional evidence | Partial | Project URL, claim, time scope, intended meaning, and evidence excerpts are accepted. Evidence file upload is limited to HTML audits; arbitrary artifact upload is not implemented. |
| FR-002: URL-only, claim-only, combined intake; no fabrication | Implemented | Empty/claim-only/URL-only data is allowed; empty states are explicit. |
| FR-003: atomic propositions with scope/time/units/evidence needs | Implemented | Manual decomposition; no model-generated decomposition. |
| FR-004: identity/account/project/authorship/contribution distinctions | Partial | Entity identity status, method, scope, and attribution roles exist. Account-control verification and contributor-role records separate from observations are not implemented. |
| FR-005: supported URLs/files/size limits | Partial | HTTP(S) URLs validated; HTML only for uploads; no general file ingestion. |
| FR-006: source descriptor and provenance | Implemented | Canonical URL optional, retrieval time, type, publisher/author, language, access route, independence, digest. |
| FR-007: evidence relations | Implemented | Supports, contradicts, qualifies, contextualizes, does not address, unavailable. |
| FR-008: preserve contradictions and unknowns | Implemented | Coexisting active relations; rule and report preserve both; unknown states explicit. |
| FR-009: source-linked verdict rationale | Implemented | Every relationship has a reviewer rationale; reports link evidence rows and assessment rationale. |
| FR-010: human correction/adjudication with audit | Partial | Supersession, append-only assessments, audit events, and disputes exist. A dedicated review-event object and reviewer identity authentication do not. |
| FR-011: generate achievement page/metadata | Not implemented | Deliberately outside local core v0.1. |
| FR-012: copy/paste, CMS, API integration | Not implemented | No publication path. |
| FR-013: structured data/visible content consistency | Partial | Local HTML check for simple name/headline alignment; no publishing generator. |
| FR-014: crawler access checks | Partial | In-document robots meta only; no live crawler/robots.txt check. |
| FR-015: never claim caching/indexing without evidence | Implemented | All network/index/cache states are unavailable and disclosed. |
| FR-016: provider adapters | Not implemented | Intentionally prohibited in this milestone; no fake adapters. |
| FR-017: store model/API/tools/locale/timestamp | Partial | Run/observation records model/interface labels, grounding mode, locale, region, capture time, and conditions. API version and verified model identity are not available. |
| FR-018: preserve raw answers and citation metadata | Implemented | Raw answer and citations preserved; citation availability has explicit states. |
| FR-019: separate mention/citation/fidelity/attribution | Implemented | Four observation dimensions plus coverage; no composite. |
| FR-020: denominators, sample sizes, coverage, uncertainty | Implemented | Explicit numerators/denominators/exclusions; no confidence intervals by design. |
| FR-021: repeated runs and non-comparability | Implemented | Query-set cloning; comparisons only when query set and config match; open/cancelled excluded from metrics. |
| FR-022: no scraping/circumvention | Implemented | No network client exists. |
| FR-023: report sections | Implemented | Scope, method, coverage, findings, metrics, remediation, comparisons, limitations. |
| FR-024: trace findings to evidence or state insufficiency | Implemented | Evidence rows, observation assessments, and explicit unknown/insufficient states. |
| FR-025: distinguish observation, inference, recommendation | Implemented | Recorded facts, rule/human conclusions, and suggestions are labelled separately. |
| FR-026: no guarantee of future answers/caching | Implemented | Report limitations and UI copy state this. |
| FR-027: version/date information | Implemented | Methodology, evidence rule, metrics, snapshot, template, audit, query-set, and run versions/dates. |

## 3. Non-functional requirements

| Requirement | Status | Notes |
|---|---|---|
| Reproducibility | Implemented | Immutable claim revisions, run configs, query sets, raw observations, report snapshots, version IDs. |
| Security | Implemented for local scope | SSRF is absent because there is no outbound client; local controls are tested. Not a multi-user/network security review. |
| Privacy | Implemented for local scope | Data-local by default, export/delete, no telemetry or provider transfer. Retention policy and encryption at rest are not implemented. |
| Reliability | Implemented / Validated | Transactions, foreign keys, triggers, checksummed migrations, explicit errors. No crash-recovery or backup automation. |
| Explainability | Implemented | Rule counts/notes, human rationale, metric definitions/exclusions, limitations. |
| Accessibility | Partial / locally checked | Semantic HTML, labels, skip link, text badges, keyboard-native controls, automated structural checks. No screen-reader audit. |
| Portability | Implemented | Provider-independent core; SQLite local data. |
| Extensibility | Partial | Provider contracts are documented only; adding an adapter requires a new ADR and tests. |
| Cost controls | Not applicable | No paid or external calls. |
| Localization | Partial | Locale/region are explicit fields; UI is English only. |

## 4. Acceptance criteria for the initial usable release

The local milestone's end-to-end path is validated: create a project, record claims and evidence, record genuine manual observations, perform transparent assessments, compute defined metrics, generate a reproducible report, and export it. Provider testing is intentionally absent.

The broader Product Requirements acceptance criterion that includes “run at least one supported search-grounded provider test” is **not met and is out of scope for this milestone**. No provider is advertised as supported. This repository must not be described as satisfying that criterion.

## 5. ADR implementation status

| ADR | Implementation | Validation |
|---|---|---|
| ADR-008 single-package TypeScript | Implemented | Boundary test, typecheck, build-free server boot |
| ADR-009 deterministic evidence aggregation | Implemented | Evidence unit tests, report tests |
| ADR-010 manual observations only | Implemented | Run/repository/HTTP tests; no provider code |
| ADR-011 local HTML-only analysis | Implemented | Website and audit upload tests |
| ADR-012 loopback single-operator security | Implemented | Config, host, CSRF, body, CSP, upload tests |
| ADR-013 immutable report snapshots | Implemented | Reporting, repository, HTTP immutability tests |

The ADRs remain **Proposed** in the index pending owner review; implementation does not equal owner acceptance.

## 6. Explicitly not implemented

- LLM/provider/search integrations, credentials, cost accounting, or live tests.
- Remote URL fetching, crawling, robots.txt/sitemap retrieval, link health checks, or rendered-page analysis.
- Public achievement pages, JSON-LD publishing, sitemap generation, CMS/API publication, or rollback.
- User accounts, authentication, tenant isolation, roles, OAuth, billing, quotas, analytics, or scheduled jobs.
- Benchmark/gold-set validation, calibration, confidence intervals, or composite scoring.
- Separate achievement, citation-resolution, review-event, remediation-status, or retention tables.
- Email/notifications, attachments beyond HTML audit uploads, or PDF parsing.

## 7. Next steps

1. Owner review and acceptance or modification of ADRs 008–013.
2. Add a human-reviewed evaluator gold set and regression cases before any public accuracy claim.
3. Implement retention/deletion policy and backup guidance beyond the local copy procedure.
4. Add screen-reader and cross-browser testing.
5. If provider or remote website work is authorized, add capability declarations, terms review, SSRF/network isolation, and live validation under new ADRs.
6. Add the achievement/publication workflow only after its trust, approval, and correction controls are implemented and tested.
