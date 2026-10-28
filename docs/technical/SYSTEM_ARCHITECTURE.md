# System Architecture

- Status: Proposed initial architecture
- Design drivers: Evidence fidelity, testability, provider independence, and separation of evaluator logic from commercial concerns.

## 1. Architecture principles

1. Core evaluation is deterministic where practical and labels model-assisted judgments.
2. Provider behavior is isolated behind adapters.
3. Raw observations are stored separately from derived metrics and verdicts.
4. Every finding links to a run version and evidence set.
5. Retrieval, evidence assessment, answer scoring, and publication are distinct stages.
6. Billing state and sales signals never enter claim truth or evaluator scoring.
7. External side effects are authorized, logged, bounded, and retry-safe where possible.
8. User-provided content is untrusted data, never policy or system instruction.

## 2. Logical components

### Client and UI
Provides intake, claim review, evidence inspection, query approval, run status, reports, correction workflow, and public achievement preview. Core report content must be accessible HTML, not available only through an interaction-only JavaScript widget or image.

### Application API
Authenticates, validates tenant/project permissions, creates durable jobs, serves report data, checks quotas before scheduling costly work, and coordinates state transitions. It must not independently score claims.

### Orchestrator
Runs a versioned workflow: intake; parse; retrieve; normalize; assess claims; generate/test queries; score outputs; review/adjudicate; report. Each stage records inputs, versions, status, timings, and failures. Retries are idempotent or create explicit child attempts.

### Source discovery service
Connects to approved search APIs, page fetchers, official repositories, user-authorized integrations, and document parsers. It records where each source was found, how it was retrieved, and whether retrieval failed. It is not a universal crawler. It respects applicable terms, robots directives, access controls, and rate limits.

### Evidence registry
Stores source records and claim-evidence relationships. Immutable source/run references are preferred. Corrections create new versions and provenance events rather than silently replacing a published verdict's basis.

### Evaluator core
A provider-independent package containing typed claim/evidence models, verdict taxonomy, source-quality features, support/contradiction/qualification analysis, answer-claim alignment, citation support evaluation, metric definitions, uncertainty/coverage records, and calibration/regression interfaces.

The core accepts normalized inputs and emits versioned outputs. It must not make network requests, read billing plans, or depend on one provider response schema.

### Provider adapters
Each adapter declares supported operations, model/API identifiers, search/grounding modes, citation format, locale support, costs/limits where known, retry semantics, data-retention constraints, and limitations. Capabilities are machine-readable and verified by integration tests.

### Website integration service
Audits accessible pages and creates drafts of human-readable pages, JSON-LD, canonical/sitemap guidance, and CMS/API deployment packages. Publishing is a separate authorized action requiring owner approval. It cannot claim to trigger private model caches.

### Reporting service
Renders immutable run snapshots with evidence links, raw outputs as retained, test configuration, metric numerator/denominator, uncertainty, limitations, and actions. A report must not recalculate old metrics under a new formula without recording the version change.

### Commercial/application support (future)
Identity, organization membership, billing, quota, invoice, and subscription services are separate from core evaluator types. An API may check whether a user can start an expensive job, but the evaluation worker receives a validated job specification, not billing logic. This boundary is mandatory if commercial functions are added.

## 3. Suggested future repository layout

This is a documentation-only baseline. The following monorepo layout is a proposal for implementation; exact languages and tooling remain undecided:

    apps/
      web/                  # UI; no evaluator rules embedded in components
      api/                  # authentication, validation, orchestration endpoints
      worker/               # job processing and external side effects
    packages/
      evaluator-core/       # claims, evidence, verdicts, metrics; domain logic
      evidence-registry/    # persistence interfaces and provenance
      provider-contracts/   # normalized request/response and capability interfaces
      provider-adapters/    # isolated integration per provider
      website-integration/  # crawler audit, schema generation, CMS integrations
      reporting/            # deterministic report rendering
      shared-schemas/       # API schemas and serialization contracts
    commercial/             # optional future billing and entitlement service
    docs/
    tests/
      unit/
      integration/
      evaluator-gold/
      security/
      provider-contracts/

A Python monorepo could implement these as distinct packages; a TypeScript monorepo could use workspace packages. The boundaries, not the exact folder syntax, are normative.

## 4. Core data flow

1. Intake creates a project, claim, and evaluation request.
2. URL/upload validators produce source candidates without trusting content instructions.
3. Discovery retrieves permitted evidence.
4. Normalization records source and content provenance.
5. Claim decomposition creates proposition versions linked to original wording.
6. Evidence assessment returns claim-level findings and unresolved questions.
7. Query planning selects a versioned representative set independently of expected answer.
8. Provider adapters run tests and return normalized observations.
9. Output scoring evaluates mention, fidelity, citation relevance/support, and attribution separately.
10. Aggregation produces metrics with denominator and coverage status.
11. Report snapshots persist the exact evaluator, metric, prompt-set, and adapter versions.
12. Corrections/new runs create new versions; old results are not silently rewritten.

## 5. Trust boundaries

- Browser to API: untrusted input and uploaded bytes.
- API to queue: validated job envelope.
- Worker to arbitrary URL: high-risk SSRF boundary.
- Worker to model/search providers: external data transfer and cost boundary.
- Retrieved content to evaluator: prompt-injection/untrusted-data boundary.
- Evaluator to report: consequential factual statement boundary.
- Public page publisher: externally visible action requiring user approval.
- Future commercial service to evaluator: entitlement boundary; only job authorization passes through.

## 6. Persistence and versioning

Persist immutable run IDs, source references, query-set version, evaluator/metric/adapter versions, model identifier, tool configuration, timestamps, terminal status, and review overrides. Store raw content only when needed and lawful. Apply retention and redact secrets or irrelevant personal data. A report must show whether it reflects a fresh rerun or older evidence.

## 7. Failure isolation

A failed provider call is ERROR or UNAVAILABLE, not “not mentioned.” A fetch blocked by robots is BLOCKED_BY_POLICY, not evidence against the claim. Missing citation annotations mean citation data is unavailable in that interface, not automatically that no source was used. Partial results must be labeled partial.

## 8. Deployment topology

A first deployment can use one web app, one API, background worker, PostgreSQL, controlled object storage, and a queue. Provider requests require timeouts, rate limits, retry budgets, and spending limits. Split services only when independent scaling, isolation, or reliability justifies the cost.

## 9. Quality attributes

- Testability: core domain functions can run without external APIs.
- Provider independence: adapters conform to shared contracts and fixture tests.
- Auditability: findings link to immutable run/source records.
- Privacy: tenant checks and deletion workflows are testable.
- Extensibility: new providers do not alter core claim or metric semantics.
- Cost safety: unbounded search/model loops are prohibited.
- Correctness: uncertainty and unavailability remain explicit through reports.
