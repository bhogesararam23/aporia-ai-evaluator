# Module Boundaries and Separation Rules

- Status: Required architectural constraint for future implementation
- Related: ADR-004 and ADR-007

## 1. Objective

Keep evaluator semantics, external-provider behavior, application orchestration, website publishing, and commercial concerns separate enough that changes in one area cannot silently change the meaning or trustworthiness of another.

## 2. Required conceptual modules

### Evaluator core
Owns claim/proposition types, evidence relationships, verdict taxonomy, score definitions, uncertainty, attribution rules, and deterministic aggregation. Prefer pure functions and explicit inputs/outputs. It MUST NOT import:
- billing/subscription/plan packages;
- web frameworks or UI packages;
- provider SDKs or provider-specific response types;
- direct network-fetching or browser automation code;
- database clients or application configuration.

### Provider contracts and adapters
Contracts define normalized requests, observations, citations, capability metadata, and error states. Provider adapters own provider SDKs, endpoint schemas, authentication injection, retry/rate-limit interpretation, grounding configuration, and provider-specific mappings. Adapters MUST NOT redefine core verdict labels or metrics.

### Evidence and storage adapters
Own persistence, object storage, source snapshots, data access, and provenance retrieval. Persistence models map to domain models but must not encode commercial policy into evaluator fields.

### Application/API and orchestration
Own authentication, authorization, request validation, job creation, quotas before job start, workflow sequencing, and lifecycle state. API policy may deny access to a feature, but must not alter the result of a job that is allowed to run.

### Website publishing
Own URL audits, structured-data generation, sitemap/canonical guidance, CMS adapters, preview, publication approvals, rollback, and correction flows. It may suggest content but cannot mark claims verified merely because metadata exists.

### Reporting
Own deterministic rendering of versioned inputs and results. It must not silently recompute old data under new metrics or hide negative/unknown results by default.

### Commercial module (optional future)
Owns products/plans, billing, invoices, usage accounting, customer lifecycle, and entitlements. It may provide a quota decision at the API/application boundary. It MUST NOT be imported by evaluator core or influence verdict weights, source selection, claim confidence, attribution, or metric formulas.

## 3. Proposed directory/package separation

The architecture proposal in SYSTEM_ARCHITECTURE.md defines possible package names. The exact language/runtime has not been selected. Any implementation must preserve these dependency directions:

- UI -> API contracts (not evaluator internals).
- API/application -> evaluator-core contracts, evidence interfaces, provider contracts.
- Worker/orchestrator -> provider adapters and evaluator core.
- Provider adapters -> provider contracts (not evaluator policy).
- Storage adapters -> persistence/domain mapping interfaces.
- Commercial -> application/usage boundaries only.
- Evaluator core -> standard library and explicitly approved domain-level libraries only.

Forbidden dependency directions include evaluator-core -> billing, evaluator-core -> provider SDK, evaluator-core -> UI, provider adapter -> commercial pricing tier, and report renderer -> hidden plan-based score changes.

## 4. Interface discipline

- Pass typed domain records and immutable run configuration across package boundaries.
- Use versioned schemas for stored/serialized evaluation results.
- Normalize provider-specific schemas at adapter boundaries.
- Keep provider-specific optional fields in metadata namespaces, not as required core assumptions.
- Use explicit unavailable/error states rather than fake defaults.
- Avoid global state for provider credentials, active user, pricing plan, or metric weights.
- Keep metric formula version separate from implementation build version.

## 5. Enforcement

A documentation rule is not yet machine-enforced. Before implementation is considered mature, add:
1. package dependency checks or import-linter rules;
2. CI tests that evaluator-core imports no provider/commercial/UI packages;
3. deterministic tests showing identical evaluator input produces identical verdict/metrics independent of account plan;
4. code review checklist item for new cross-boundary imports;
5. an ADR for any necessary exception.

The first code skeleton should not create a circular dependency that is hard to remove later.

## 6. Change control

Any change that violates a boundary requires an ADR specifying why the boundary is insufficient, what alternatives were considered, the risk, tests, and a migration/rollback plan. Do not grant a permanent exception merely to expedite one feature.
