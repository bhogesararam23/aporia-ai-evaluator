# Release and Change Policy

## 1. Release classes

- **Documentation baseline:** policy and architecture documents, no implication of implemented code.
- **Prototype:** functional proof-of-concept with known limitations, not production assurance.
- **Private beta:** limited users, explicit provider/data limitations, monitoring and support.
- **Public release:** security/privacy review, benchmark and operational checks, documented user-facing behavior, correction route, and approved release notes.

Never use a release label to imply a completed review that did not happen.

## 2. Release checklist

Before any software release:
- acceptance criteria and known gaps are reviewed;
- relevant unit, integration, security, and evaluator regression tests are run;
- provider integrations and API schemas are verified;
- secrets/dependencies/configuration are checked;
- data retention, deletion, backup, and privacy behaviors are defined;
- cost/rate limits and a disable/rollback path exist;
- reports expose methodology/provider versions;
- public claims about performance are backed by measured evidence;
- support, incident response, and correction processes are documented;
- owner approval and the change summary are recorded.

## 3. Versioning

Use a versioning scheme appropriate to the project runtime. Track application version separately from evaluator-methodology version, metric formula version, query-set version, provider adapter version, and report template version. A new metric formula cannot silently rewrite historic interpretation. Keep report data readable or mark it as requiring a migration.

## 4. Change categories

Patch: documentation, non-semantic bug fixes, and compatible improvements with no intended metric meaning change.

Minor: backward-compatible features, provider additions, new optional report fields, or new query scopes.

Major: breaking API/data changes, changed verdict semantics, changed score formulas, changed evidence policy, or incompatible reports.

These are guidelines; actual version numbers should follow the repository's chosen release scheme once code exists.

## 5. Rollback

Each release needs a way to disable a failing provider, pause queued jobs, restore compatible application version/schema, and prevent further public page writes. Rollback must not erase audit events or falsely reverse a published claim without recording the correction.

## 6. Public reporting and communication

Release notes describe what changed, what was tested, known limitations, provider versions, and whether old results are comparable. Do not advertise “accuracy,” “visibility improvement,” or “provider support” without evidence and a defined evaluation protocol.

## 7. Incident-triggered release stop

Stop or roll back when a vulnerability risks private data, a critical evaluator regression appears, attribution is systematically wrong, a provider integration violates applicable terms, or a runaway-cost incident occurs. Resumption requires mitigation and documented review.

## Evidence of engineering readiness

Use [Quality Gates](QUALITY_GATES.md) as the acceptance baseline. Policy text is not enforcement: required reviews, branch protection, status checks, environment approvals, and release permissions must be configured and verified in GitHub separately. Record which controls are active and which remain manual or unavailable.

Avoid blanket labels such as “enterprise-ready,” “production-ready,” or “secure.” State the exact capabilities, checks, review scope, operating limits, and remaining risks that support a claim.
