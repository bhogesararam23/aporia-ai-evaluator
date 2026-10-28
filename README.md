# Aporia AI Evaluator

**Evidence-first evaluation for claim verification, AI discoverability, answer fidelity, and creator attribution.**

Aporia helps a person or organization document a verifiable accomplishment, publish an accessible record of the work, and measure whether supported AI/search systems discover, describe, and correctly attribute it. It also evaluates cases where AI systems omit an achievement or state that something has not been done when evidence suggests otherwise.

Aporia does **not** promise that any provider will crawl, index, retain, recommend, or cite a page. Provider behavior is outside Aporia's control. Its job is to improve evidence quality and accessibility, test observed outcomes, expose uncertainty, and provide reproducible reports.

## Project status

**Local core v0.1 is implemented and locally validated.** It is a single-operator, loopback-only application with durable SQLite storage, a complete claim-to-report workflow, local HTML analysis, manual AI-answer capture, transparent metrics, and immutable reports.

**Not implemented and intentionally out of scope for this milestone:** provider/LLM/search integrations, API keys, remote URL fetching, crawling, publishing, accounts, multi-tenancy, OAuth, billing, analytics, background jobs, and seeded demo data. It is not production-ready, independently audited, or validated against a provider. See [Known Limitations](docs/KNOWN_LIMITATIONS.md) and [Implementation Status](docs/IMPLEMENTATION_STATUS.md).

The documentation baseline remains the requirements source of truth. Implementation status is tracked in the repository, not inferred from the presence of a specification.

## Quick start

Requirements: Node.js 24 or later and npm. No provider credentials, database server, or build step is required.

```bash
npm ci
npm start
```

Open `http://127.0.0.1:4310`. The app starts with an honest empty state. Data is stored in `./data/aporia.db` unless `APORIA_DATA_DIR` is set.

Optional local configuration:

```bash
cp .env.example .env
npm run dev
```

| Variable | Default | Notes |
|---|---|---|
| `APORIA_HOST` | `127.0.0.1` | Only loopback addresses; remote binding is rejected |
| `APORIA_PORT` | `4310` | Local port |
| `APORIA_DATA_DIR` | `./data` | Contains `aporia.db` and SQLite sidecars |
| `APORIA_OPERATOR` | `local-operator` | Audit-actor label |
| `APORIA_MAX_BODY_BYTES` | `2097152` | Form/request cap |
| `APORIA_MAX_HTML_BYTES` | `1000000` | Pasted/uploaded HTML cap |
| `APORIA_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

`node:sqlite` emits an experimental warning in the tested Node release; this is expected. Review the [Local runbook](docs/operations/LOCAL_RUNBOOK.md) for backup and data-control procedures.

## What works

- **Projects and entities:** create and edit a project profile, target person/product/repository/artifact, alternate names, public URLs, explicitly asserted identity status (never described as verified).
- **Claims and propositions:** immutable claim revisions, atomic propositions with scope/time/units/evidence requirements, versioned review status.
- **Sources and evidence:** source descriptors, user-supplied excerpts and locators with SHA-256 digests, supporting and contradictory relationships that coexist, one-way supersession with retained history.
- **Evidence review:** a transparent `evidence-aggregation-v1` rule over human-recorded relationships, plus versioned explicit human proposition assessments and visible disagreement when the two differ.
- **Query sets:** versioned, reviewable, approved/frozen sets and clone-for-retest versions.
- **Manual runs:** declared provider/model/interface/grounding/locale/region conditions; exact prompt snapshots; raw answers entered or imported by JSON; citation metadata with unavailable states; open/finalized/cancelled lifecycle.
- **Assessments:** separate presence, fidelity, citation-support, and attribution assessments with append-only versions and reviewer rationale.
- **Metrics:** mention rate, target-source and any-source citation rates, citation support, claim fidelity, attribution correctness, observed answer-level coverage, explicit numerators/denominators/exclusions, and `null` unknowns. No composite score.
- **Local HTML audits:** paste or upload HTML; inspect title, robots meta, canonical, JSON-LD alignment, headings, author/date signals, links, alt text, and parser issues. No network request, script execution, or crawler is used. Network-dependent checks are reported as unavailable.
- **Reports:** immutable snapshots built from persisted records, with scope, method, coverage, claims/evidence, audits, runs, metric definitions/exclusions, comparisons, remediation suggestions, limitations, and unavailable checks. JSON, metrics CSV, findings CSV, observations CSV, and local audit JSON exports; export actions are audited.
- **Data control:** project JSON export, typed-name deletion, local audit trail, and no telemetry or provider calls.

## Commands

```bash
npm start              # run the local app
npm run dev            # restart on changes
npm test               # Node test runner, TypeScript sources
npm run typecheck      # tsc --noEmit
npm run lint           # ESLint
npm run format:check   # Prettier check
npm run check:boundaries
npm run check          # all gates in sequence
```

See [Testing and verification](docs/TESTING.md) for suite coverage, exact local results, and checks that were not run.

## Architecture at a glance

```text
Browser
  -> node:http loopback server (Host/Origin/CSRF/body limits)
  -> app routes and core input validation
  -> SQLite repositories and append-only audit events
  -> evaluator core (pure evidence rule + metrics v1)
  -> immutable report snapshot -> HTML / JSON / CSV exports
```

- `src/core` contains no I/O, database, HTTP, UI, or commercial imports.
- `src/persistence` owns SQLite, migrations, integrity triggers, and repositories.
- `src/website` parses only supplied HTML with `parse5`; it never fetches.
- `src/reporting` builds and serializes snapshots without reading the database.
- `src/app` owns routing, security middleware, orchestration, and server-rendered HTML.
- Boundaries are enforced by `scripts/check-boundaries.ts` and a unit test.

Read [Local core architecture](docs/technical/LOCAL_CORE_ARCHITECTURE.md) and [Local schema](docs/technical/LOCAL_SCHEMA.md).

## Evidence and metric semantics

The evaluator does not use keyword matching, language models, or arbitrary weights. A human records supporting, contradicting, qualifying, contextual, unaddressed, or unavailable evidence. A documented precedence rule summarizes those relationships. Human assessments are separate and append-only. Reports show rule output, human conclusions, disagreement, rationale, and caveats.

Answer metrics are defined in [Implemented metrics v1](docs/evaluator/IMPLEMENTED_METRICS_V1.md). Eligibility excludes provider/capture errors, refusals, abstentions, timeouts, blocked access, and voided records. Those states remain visible as coverage and exclusion reasons; they are never negative mentions or negative factual verdicts. There is no composite “AI score.”

## Documentation

- [Documentation index](docs/README.md)
- [Product requirements](docs/product/PRODUCT_REQUIREMENTS.md)
- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
- [System architecture](docs/technical/SYSTEM_ARCHITECTURE.md)
- [Local core architecture](docs/technical/LOCAL_CORE_ARCHITECTURE.md)
- [Local schema](docs/technical/LOCAL_SCHEMA.md)
- [Evaluator methodology](docs/evaluator/EVALUATOR_METHODOLOGY.md)
- [Implemented metrics v1](docs/evaluator/IMPLEMENTED_METRICS_V1.md)
- [Reporting specification](docs/evaluator/REPORTING_SPECIFICATION.md)
- [Claim and attribution trust model](docs/trust/CLAIM_AND_ATTRIBUTION_TRUST.md)
- [Safety policy](docs/safety/SAFETY_POLICY.md)
- [Security and privacy](docs/security/SECURITY_PRIVACY.md)
- [Testing](docs/TESTING.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
- [Local runbook](docs/operations/LOCAL_RUNBOOK.md)
- [Agent operating protocol](docs/agents/AGENT_OPERATING_PROTOCOL.md)
- [ADR index](docs/agents/ADR_INDEX.md)

## Core product loop

1. **Collect:** accept a URL, claim, goal, identity information, and optional source artifacts.
2. **Decompose:** express the claim as bounded propositions that can be evaluated separately.
3. **Establish evidence:** record source provenance, assess quality, and preserve conflicts and unknowns.
4. **Publish accessibly:** help the owner maintain a canonical, human-readable achievement page and machine-readable metadata on a website they control. *(Not implemented in local v0.1.)*
5. **Test:** run versioned queries through supported provider interfaces and record exact conditions and outputs. *(Manual capture only in local v0.1.)*
6. **Report:** keep evidence assessment, discoverability observations, AI answer behavior, and creator attribution separate.
7. **Improve and retest:** recommend evidence-led changes and compare later runs without implying causation without evidence.

## Architectural boundary

The evaluator core determines what was tested, how evidence maps to claims, and how measurements are calculated. Provider adapters would translate external systems into normalized observations; none are implemented. The application layer coordinates workflows and persistence. Future commercial features—accounts, plans, billing, subscriptions, sales, or entitlements—must live outside the evaluator core and must not change factual verdicts or metric definitions. See [ADR-007](docs/agents/adrs/ADR-007-separate-evaluator-core-from-commercial-concerns.md) and [ADR-008](docs/agents/adrs/ADR-008-local-first-single-package-typescript.md).

## Working principles

- Evidence before conclusions.
- Claim-level, not blanket, verification.
- Attribution is separate from whether an accomplishment occurred.
- An observed measurement is not a universal probability.
- No claim that all AI systems are supported unless each integration is implemented and tested.
- No false certainty about crawling, indexing, model memory, caching, or citations.
- Reproducibility, privacy, user control, and correction paths are first-class requirements.
- Agent sessions end with a durable report; architectural decisions use sequential ADRs.

## License and governance

No license is declared by this repository. Before publishing implementation code for external reuse, the project owner should choose and add an explicit license. Contributor and agent work must follow [Contributing](docs/governance/CONTRIBUTING.md), [Definition of Done](docs/governance/DEFINITION_OF_DONE.md), and the [agent operating protocol](docs/agents/AGENT_OPERATING_PROTOCOL.md).

**Maturity statement:** this repository now contains a working local core, but it is not production-ready, independently audited, backed by verified provider integrations, or approved for public operation. Do not describe it otherwise unless implementation and verification evidence exists.
