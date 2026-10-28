# ADR-008: Implement Local Core v0.1 as a Single-Package TypeScript Application

- Status: Proposed
- Date: 2026-10-28
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-001, ADR-002, ADR-003, ADR-007

## Context

The repository contains a documentation baseline and no application code. The first milestone must deliver a runnable, local-first evaluator with durable storage, a complete evidence and observation workflow, transparent metrics, reports, and tests. It must not call external providers, cloud services, crawlers, or remote websites.

The architecture documents describe conceptual packages (`evaluator-core`, `evidence-registry`, `provider-contracts`, `provider-adapters`, `website-integration`, `reporting`, `apps/web`, `apps/api`) but explicitly state that the boundaries, not the folder syntax, are normative. A full multi-package workspace with separate API, worker, and web applications would add build, dependency, and deployment overhead without serving a local single-operator release. Splitting services is not justified until independent scaling, isolation, or multi-user needs exist.

Node.js 24 is available in the target environment and includes a built-in SQLite driver (`node:sqlite`) and native TypeScript type stripping. Avoiding native database addons and a bundler reduces installation and supply-chain risk on a local Windows workstation.

## Decision

Implement v0.1 as one Node.js 24 TypeScript application with internal modules that preserve the documented dependency direction:

- `src/core` — provider-independent evaluator domain types, evidence aggregation, metric definitions, and pure calculations. It imports only standard-library-safe language features and other core modules. It must not import HTTP, database, HTML-parsing, reporting, or UI code.
- `src/persistence` — SQLite schema, migrations, repositories, transactions, and audit writes.
- `src/reporting` — immutable report snapshot construction and deterministic CSV serialization.
- `src/website` — local-only HTML analysis. It never performs network access.
- `src/app` — HTTP routing, validation at the request boundary, HTML rendering, CSRF, and workflow orchestration.
- `src/config.ts`, `src/logger.ts`, `src/errors.ts` — configuration validation, structured local logging, and stable error categories.

Use SQLite through `node:sqlite` with explicit foreign keys, WAL journaling, busy timeout, and append-only migrations with checksums. Use server-rendered HTML and plain CSS over Node's HTTP server. No SPA, client framework, bundler, or build output is required; `tsc --noEmit` performs type checking and Node runs the TypeScript source directly. The only runtime dependencies are a spec-compliant HTML parser (`parse5`) and a multipart parser (`busboy`).

Enforce boundaries with an automated import check and deterministic tests. A future multi-tenant or provider-integrated release may extract these modules into workspace packages; that requires a new ADR and migration plan.

## Alternatives considered

1. **Full npm workspace monorepo with separate packages and apps.** Rejected for v0.1 because it adds install/build complexity without independent deployment, while the required boundaries can be enforced inside one package. It remains the likely direction when provider adapters and a background worker exist.
2. **Next.js or another React framework.** Rejected because the core report must be readable as server-rendered HTML, the local app needs no client state, and a build pipeline would add avoidable complexity and attack surface.
3. **PostgreSQL, Prisma, or a hosted database.** Rejected because the milestone is local-first, has no multi-user requirements, and native/external database tooling is unnecessary.
4. **A native SQLite addon (for example better-sqlite3).** Rejected because `node:sqlite` is available and avoids native binary installation risk. The experimental status of `node:sqlite` is documented as a limitation.
5. **Python or Go implementation.** Rejected because the available Node runtime provides TypeScript, SQLite, HTTP, and the test runner in one toolchain, minimizing setup.

## Consequences and trade-offs

- One process serves the UI and all workflows; there is no separate API or worker in v0.1.
- The application is single-operator and loopback-only; authentication, tenant isolation, queues, and scheduled runs are out of scope (see ADR-012).
- `node:sqlite` emits an experimental warning on the target Node release. Upgrading Node may require compatibility checks.
- Internal module rules are verified by tests rather than package-level resolution. A violation that bypasses the check is still a review defect.
- The proposed package names in earlier documents remain design intent. Their current implementation locations are recorded in the implementation status documentation.

## Security, privacy, safety, and evaluator-validity implications

- No network client is implemented in v0.1, so remote SSRF and provider-cost risks are absent rather than mitigated. Adding remote fetching later requires the controls in `docs/security/SECURITY_PRIVACY.md` and a new ADR.
- Local data lives in a single SQLite file under an operator-selected data directory; file-system access control is the primary confidentiality boundary.
- Evaluator logic remains isolated from commercial state under ADR-007 and from persistence and HTTP concerns by construction and test.
- Deterministic core calculations must be reproducible from persisted inputs.

## Implementation and migration plan

1. Add the project manifest, strict TypeScript configuration, test runner, lint/format configuration, and local asset layout.
2. Add configuration validation, structured logging, and stable error categories.
3. Implement `core`, `persistence`, `website`, `reporting`, then `app` in that dependency order.
4. Add the import-boundary test before the web layer depends on the core.
5. Update the planned-package READMEs and implementation status to point to the actual layout.
6. Extract modules into packages only with a superseding ADR and a tested migration path.

## Tests and validation required

- Type checking, formatting, linting, and unit/integration tests pass or failures are recorded.
- An automated test rejects imports from `src/core` to HTTP, database, website-parsing, reporting, or application modules.
- A test demonstrates identical core inputs produce identical outputs with unrelated commercial metadata present.
- Boot tests prove the app refuses non-loopback binding and validates configuration.
- Migration tests cover fresh installs, idempotent startup, and checksum mismatch rejection.
