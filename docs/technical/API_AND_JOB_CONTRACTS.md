# API and Job Contract Guidance

- Status: Design guidance; exact endpoint paths and API technology are not yet selected.
- Related: System Architecture, Data Model, Provider Adapters, Module Boundaries.

## 1. Design goals

The API must validate requests, authorize the caller, apply resource limits, create traceable jobs, and return stable domain responses. It must not hide evaluator decisions in route handlers or expose provider-specific schemas to clients. Exact public endpoints are implementation decisions and require an ADR if they cause a major architecture change.

## 2. Request categories

### Claim evaluation request
Contains project reference, claim revision or text, optional URL and evidence references, locale, evaluation scope, preferred depth/budget, requested providers, and consent/authorization flags. Validation returns a stable request identifier and a list of accepted/rejected input reasons. Missing optional data remains missing; it is never guessed.

### Website audit request
Contains authorized starting URL, crawl scope/page budget, selected checks, allowed user-agents where relevant, and whether the caller requests a proposed patch or read-only audit. Read-only is the default. A requested write/publish operation requires a separate explicit action.

### AI response evaluation request
Contains a target claim/proposition, query-set version or query-generation constraints, provider/model configurations, language/region, repetition plan, expected target outcome, and resource budget.

### Achievement publication request
Contains reviewed achievement content, public URL/path, structured-data candidate, evidence references, and explicit owner approval token/state. Preview and publication are separate endpoints or separate state transitions. Publication should be idempotent and logged.

## 3. Job envelope

Every background job includes:
- job ID and correlation ID;
- project/tenant reference;
- job type and schema version;
- idempotency key where supported;
- validated request payload reference;
- created time, deadline, cancellation status;
- budget limits;
- privacy/data-retention classification;
- requesting actor and authorization context;
- orchestration version.

Do not put provider secrets, raw uploaded documents, session cookies, or unredacted credentials in the queue payload. Use controlled references to protected storage.

## 4. Job state contract

States: QUEUED, RUNNING, COMPLETED, PARTIAL, FAILED, UNAVAILABLE, CANCELLED, and BLOCKED_BY_POLICY. State transitions must be validated. A completed run means required steps completed; it does not mean the claim is true. Partial runs explicitly list omitted steps. Retries are bounded and logged.

## 5. Response contract

The API should return a stable domain envelope with:
- request/job ID;
- current status;
- timestamps;
- result/report reference when available;
- warnings and known limitations;
- retryability indicator where meaningful;
- usage and budget summary where known;
- links to detailed evidence and run configuration where authorized.

Do not present provider-only fields as universally available. Use optional capability metadata. Avoid returning internal stack traces or secrets.

## 6. Error taxonomy

Use distinct categories for invalid input, unauthorized access, forbidden action, not found, conflict/state mismatch, rate limit, budget exceeded, unavailable provider, provider rejection/refusal, timeout, malformed provider output, source blocked, source fetch error, unsafe URL, upload rejected, evaluator failure, and internal error.

Only answer outputs that pass eligibility rules enter mention/citation denominators. Network/API errors must not become negative evidence or missing-mention outcomes.

## 7. Authorization and state changes

Every read/write verifies project ownership or explicit role-based access. Public report links must be unguessable or intentionally public. Publication, deletion, identity change, and attribution changes require higher assurance than reading a report. Record actor, action, timestamp, prior state, and new state in audit events.

## 8. Idempotency and concurrency

Run creation and publish requests should support idempotency keys to avoid duplicate costly jobs or duplicate pages. Use locking or concurrency control when multiple workers update one achievement record. A stale worker must not overwrite a newer reviewed version. Public page updates should use version preconditions.

## 9. API versioning and compatibility

Version external API schemas. Version stored job envelopes and normalized outputs. Add fields compatibly when possible; breaking changes require migration notes, tests, and a release-policy review. Metric formula versions are independent from API versions. Reports reference all relevant schema/method versions.

## 10. Future code enforcement

Add contract tests for valid/invalid requests, authorization, idempotency, state transitions, budget exhaustion, cancellation, provider failure, and cross-tenant access. No endpoint is production-ready based on a README example alone.
