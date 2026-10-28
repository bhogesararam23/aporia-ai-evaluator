# Local Core Architecture (v0.1)

- Status: Implemented and locally validated
- Date: 2026-10-29
- Related: ADR-008, ADR-009, ADR-010, ADR-011, ADR-012, ADR-013
- Scope: the runnable local application in this repository, not a production or multi-user architecture

## 1. Purpose and constraints

This document describes the architecture that is actually present in the repository. It does not describe planned provider integrations, remote crawling, accounts, billing, or publishing features. Those are intentionally absent from local v0.1 and are listed in [Known Limitations](../KNOWN_LIMITATIONS.md).

The implementation is a single Node.js 24 TypeScript process using:

- the built-in `node:sqlite` driver;
- the built-in `node:http` server;
- server-rendered HTML and CSS with no client framework or bundler;
- `parse5` for local HTML parsing;
- `busboy` for bounded multipart uploads;
- Node's built-in test runner;
- strict TypeScript type checking, ESLint, and Prettier.

There is no build output. Node runs the `.ts` sources directly using type stripping, while `tsc --noEmit` and ESLint validate types and style. See ADR-008 for the decision and its trade-offs.

## 2. Module map

```text
src/
  server.ts                 composition root: config, database, migrations, HTTP server
  config.ts                 validated environment configuration
  logger.ts                 structured local logging with sensitive-key redaction
  errors.ts                 stable application error categories
  core/                     pure evaluator domain; no I/O, database, HTTP, UI, or commercial code
    vocabulary.ts           controlled labels and display text
    lifecycle.ts            claim and run state transitions
    validation.ts           text, URL, timestamp, locale, and range validation
    inputs.ts               boundary validators for every workflow input
    evidence.ts             deterministic evidence aggregation and human/rule resolution
    metrics.ts              metrics v1 definitions and calculations
    versions.ts             methodology, rule, and metric versions
  persistence/              SQLite, migrations, repositories, audit events
    migrations/             six forward, checksummed SQL migrations
    repositories/           project, entity, claim, evidence, query set, run, audit, report
  website/                  local-only HTML analysis; no network access
  reporting/                immutable snapshot construction and JSON/CSV serialization
  app/                      HTTP, validation orchestration, views, and workflows
    http/                   request pipeline, router, sessions, CSRF, body limits, responses
    routes/                 home, projects, entities, claims, sources, query sets, runs, audits, reports
    views/                  escaped HTML rendering, accessible components, report rendering
    importObservations.ts   atomic JSON observation import validation
    reportingService.ts     maps persisted records to reporting input and stores snapshots
    runMetrics.ts           maps a stored run to core metrics input
  assets/app.css            local stylesheet, light/dark, print support
```

## 3. Dependency direction

The dependency rules are enforced by `scripts/check-boundaries.ts` and `tests/unit/boundaries.test.ts`:

| Layer | May import | Must not import |
|---|---|---|
| `core` | other `core` modules | HTTP, database, persistence, reporting, website, app, infrastructure |
| `website` | `parse5`, Node built-ins, website modules | persistence, reporting, app, infrastructure |
| `persistence` | Node built-ins, core types, infrastructure modules | website, reporting, app |
| `reporting` | Node built-ins, core types, reporting modules | persistence, website, app, infrastructure |
| `app` | all modules | no restriction beyond ordinary layering |
| `server.ts` | composition root; may import config, persistence, and app | no external provider or network client |

Commercial state does not exist in the domain or database. There are no imports from evaluator code to a commercial module under ADR-007. A future commercial boundary must remain outside `core` and cannot alter metrics.

## 4. Request pipeline

A browser request passes through:

1. HTTP server accepts the connection. In local v0.1 the socket is bound to `127.0.0.1` or `::1`; remote binding is rejected by configuration.
2. `Host` header validation compares the parsed hostname and port against the configured loopback address.
3. A session cookie is read or created. The CSRF token is an HMAC of the session ID using an in-memory process secret. The cookie is `HttpOnly` and `SameSite=Strict`.
4. The router matches an exact method and path. Unknown paths produce 404; known paths with a wrong method produce 405 with `Allow`.
5. For POST, the origin is checked when present (opaque `null` is accepted only because the synchronizer token is mandatory), the body is parsed within configured limits, and the CSRF token is compared in constant time.
6. The route validates all user input with core validators, calls repositories inside transactions where needed, writes audit events, and returns an HTML response or a 303 redirect (POST/redirect/GET).
7. Responses receive a restrictive Content Security Policy, `nosniff`, `no-referrer`, frame denial, permissions restrictions, `noindex`, and `no-store`.
8. Errors render a safe page with a request ID. Stack traces, raw SQL, database paths, cookies, and secrets are not shown in the browser. Server logs contain request metadata and error categories, not request bodies.

Multipart bodies are limited to one file, a field count, a file-size cap, and an overall body cap. Uploaded filenames are reduced to a basename and displayed as escaped text. Uploaded HTML is stored as data and never executed or inserted into a response.

## 5. Domain and data flow

The user workflow maps to persisted records:

1. Project and optional target entity.
2. Claim, immutable claim revision, and atomic propositions.
3. Source records and user-supplied evidence excerpts with locators and digests.
4. Human-recorded evidence relationships. Corrections supersede with history.
5. Deterministic evidence status and optional versioned human proposition assessment.
6. Approved versioned query set.
7. Open manual run with frozen query-set name/version and declared conditions.
8. Observations with exact prompt snapshots, raw answers, capture status, citation metadata, and append-only assessments.
9. Finalized run, which is immutable.
10. Local HTML audits with stored snapshot digest and findings.
11. Immutable report snapshot built from all current records.
12. JSON, metrics CSV, and findings CSV exports rendered from the stored snapshot.

The key separation is that a provider observation, an evidence relationship, a human assessment, and a report are distinct records. Supporting and contradictory evidence can coexist. A provider error is an eligibility exclusion, not a negative answer. See [Evaluator methodology](../evaluator/EVALUATOR_METHODOLOGY.md), [Implemented metrics v1](../evaluator/IMPLEMENTED_METRICS_V1.md), and [Local schema](LOCAL_SCHEMA.md).

## 6. Evaluator core

`src/core` is deliberately dependency-free. It contains:

- controlled vocabularies for relations, proposition statuses, claim states, observation statuses, assessment dimensions, attribution roles, and query intents;
- input validators used at every HTTP boundary;
- claim and run transitions;
- `deriveEvidenceStatus`, rule version `evidence-aggregation-v1`, which is a transparent precedence rule over human-recorded relationships;
- `resolvePropositionConclusion`, which keeps a human assessment and the rule result separately visible;
- `computeRunMetrics`, metric version `metrics-v1`, with explicit numerators, denominators, exclusions, null unknowns, and no composite score.

No keyword matching, language model, provider call, or heuristic is presented as AI evaluation. Human reviewers classify evidence relationships; the rule only summarizes those recorded classifications.

## 7. Persistence

SQLite is opened with foreign keys, a busy timeout, `synchronous=NORMAL`, and WAL journaling for file databases. Migrations are forward-only, named `NNN_name.sql`, applied inside transactions, and recorded with SHA-256 checksums. Editing an applied migration fails startup. See [Local schema](LOCAL_SCHEMA.md).

SQLite triggers enforce important invariants in addition to repository checks:

- claim revisions, propositions, sources, evidence, and audit events are append-only in the ways described in the schema document;
- approved query sets and their queries are frozen;
- observations and citations can only be added to open runs;
- observations can be voided once with a reason;
- only one active evidence relationship exists per evidence/proposition pair;
- finalized and cancelled runs are immutable;
- reports are immutable except for the one-way supersession reference.

The repository layer maps rows to typed records and writes audit events. It does not make HTTP decisions and does not touch evaluator internals for scoring.

## 8. Reporting

`src/reporting` accepts plain source data, builds a versioned snapshot, and serializes it. It does not read the database. `src/app/reportingService.ts` is the orchestration layer that maps repository records into that source data and calls `createReport`.

Report snapshots contain claims, evidence, query sets, finalized runs, raw answers, citations, assessments, local HTML findings, remediation suggestions, limitations, audit counts, and version identifiers. The HTML report, JSON export, and both CSV exports read the stored snapshot and never re-query live tables. Superseded reports retain their original body. See ADR-013.

CSV output is RFC 4180 quoted and protects against spreadsheet formula injection by prefixing cells that begin with `=`, `+`, `-`, `@`, tab, or carriage return with an apostrophe.

## 9. Local HTML analysis

`src/website` parses only user-supplied HTML. It does not resolve URLs, fetch resources, execute scripts, or use a headless browser. It reports:

- title, description, language, viewport, meta robots;
- canonical link count and syntax;
- sitemap link presence without retrieval;
- headings, main/article regions, author and date signals;
- JSON-LD syntax and simple visible-text alignment;
- link counts and unsafe link schemes;
- image alternative-text coverage;
- visible-text length relative to script presence, with a disclosed heuristic;
- parser issues.

Network-dependent checks are always returned as unavailable with a reason. They are never reported as passed or clean.

## 10. Security posture

ADR-012 defines the local single-operator posture. In summary:

- loopback-only binding, host validation, and origin validation;
- synchronizer CSRF tokens for every state-changing request;
- restrictive CSP and security headers;
- escaped HTML rendering through one auto-escaping template helper;
- validated HTTP(S) URLs and scheme-safe external links;
- bounded request bodies, uploads, fields, and HTML;
- parameterized SQL;
- no user-controlled filesystem path or static path;
- no external network client, provider SDK, credentials, or secrets;
- local data and exports under the operator's control, with an explicit typed-confirmation delete.

There is no authentication. Anyone with access to the local operating-system account and data directory can read the database. Reports and exports may contain sensitive material.

## 11. What is intentionally absent

- Provider SDKs, API keys, LLM calls, search APIs, and provider capability claims.
- Remote URL fetching, crawling, robots.txt retrieval, sitemap retrieval, and live link checking.
- Achievement-page publication, structured-data publishing, CMS adapters, and public routes.
- Accounts, multi-tenancy, roles, OAuth, billing, analytics, and background workers.
- Scheduled retesting, alerting, and benchmark calibration.
- A dedicated achievement or review-event table; review history is represented by append-only assessments and audit events.

These exclusions are product and safety decisions, not hidden missing pieces. Reports and the UI state the applicable unavailable states.

## 12. Verification

The implementation is exercised by unit, schema, repository, HTTP, workflow, accessibility, and report-immutability tests. See [Testing](../TESTING.md) and [Implementation Status](../IMPLEMENTATION_STATUS.md). Browser verification was performed locally against a loopback server using real form submissions; the visual check covered the empty state, project creation, claim creation, and empty report generation.
