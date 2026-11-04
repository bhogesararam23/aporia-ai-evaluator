# Implementation Status — Local Core

- Status: Implemented and verified against the running application; owner acceptance and release remain pending
- Date: 2026-11-04
- Branch: `feat/aporia-v0.6-benchmark-review-workflow`
- Milestones: v0.1–v0.5 are merged to `main` (v0.4 `43ce438`, evidence-corroboration fix PR #7, v0.5 `d941171`); v0.6 — the offline benchmark human-review workflow (ADR-026) — is in progress on this feature branch with a pull request pending, so it is **not merged and not owner-accepted**
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
| Metrics v2: intent-group coverage | Implemented / Validated | Coverage aggregates repeated queries by controlled intent, exposes untested and partially assessed groups, and preserves v1 snapshots; `src/core/metrics.ts` | `tests/unit/metrics.test.ts`, snapshot tests |
| Recorded-evidence semantics | Implemented / Validated | Status and independence labels name reviewer records; no credibility score or independent-verification claim; standing rule caveat | Vocabulary/evidence tests, report tests |
| Atomic primary + audit | Implemented / Validated | Project, claim, source, query set, run, website audit and achievement creation wrap the primary rows and audit event in one transaction | `tests/integration/audit-atomicity.test.ts` |
| Migration identity | Implemented / Validated | Applied names and checksums are checked; a renamed applied migration is refused | `tests/integration/migrations.test.ts` |
| Local HTML audit | Implemented / Validated | User-supplied paste/upload, parse5, in-document findings, network checks unavailable | Website unit tests, audit repository and upload tests |
| HTML snapshot storage | Implemented / Validated | SHA-256, byte length, raw local snapshot, findings/unavailable/metadata; immutable | Audit schema and repository tests |
| Immutable report snapshots | Implemented / Validated | Versioned snapshot, rendered only from stored JSON; earlier reports retained and superseded | Reporting unit, service, repository, HTTP immutability tests |
| JSON/CSV exports | Implemented / Validated | Report JSON, metrics/findings/observations CSV, local audit JSON, project JSON; formula-injection protection; download audit events | CSV unit tests, workflow and audit tests |
| Run comparisons | Implemented / Validated | Only identical query set/config are comparable; deltas labelled descriptive, not causal | Reporting unit tests |
| Audit trail | Implemented / Validated | Append-only local events; project deletion removes them (disclosed); export actions audited | Audit/schema, project, claim, run tests |
| Deletion and export control | Implemented / Validated | Explicit JSON export and typed-name project deletion with cascade disclosure | Project workflow tests |
| Server-rendered UI | Implemented / Validated | Complete claim/evidence/query/run/audit/report workflows, empty/error states, forms | HTTP, workflow, and accessibility tests |
| Local security controls | Implemented / Validated | Loopback binding, Host/Origin/CSRF, CSP, body/upload limits, escaping, safe URLs, parameterized SQL | Config, security, body, HTTP, view, audit tests |
| Documentation and runbook | Implemented / Validated | Architecture, schema, metrics, testing, limitations, operations, README | Link check, docs tests, and manual review |
| CI quality gate | Implemented / Validated | GitHub Actions runs `npm ci` and `npm run check` on Node 24 | Hosted runs 40773185352 (`38d3006`) and 40775144790 (`4dae6ce`) succeeded; the v0.4 checkpoints recorded in the session report are cited there per push |

### v0.3 additions

| Capability | Status | Implementation | Verification |
|---|---|---|---|
| Answer-statement decomposition | Implemented / Validated | `008_answer_claims.sql`, `src/core/answerClaims.ts`, statement workspace at `/…/observations/:observationId/claims`; raw answer never edited; corrections create superseding revisions | `tests/unit/answer-claims.test.ts`, `tests/unit/answer-claim-inputs.test.ts`, `tests/integration/schema-answer-claims.test.ts`, `tests/integration/repositories-answer-claims.test.ts`, `tests/integration/answer-claim-workflows.test.ts` |
| Quote location and verification | Implemented / Validated | Exact/normalised/no-offset bases in Unicode **code points**; NFKC mapping back to code-unit positions; a trigger re-derives the quote from the stored answer | `tests/unit/answer-claim-inputs.test.ts` (astral-character offsets, whitespace-only refusal), `tests/integration/schema-answer-claims.test.ts` |
| Statement–proposition relations | Implemented / Validated | One-to-many and many-to-one links over `SUPPORTS_TARGET`, `PARTIALLY_SUPPORTS_TARGET`, `CONTRADICTS_TARGET`, `QUALIFIES_TARGET`, `DOES_NOT_ADDRESS_TARGET`, `AMBIGUOUS_TARGET`, `REFUSES_TARGET`, `ABSTAINS_TARGET`, `OMITS_TARGET`, `NOT_ASSESSABLE_TARGET`; corrections supersede, never delete. `OMITS_TARGET` is reachable only from a statement that partially addresses the target or records an omission | `tests/integration/repositories-answer-claims.test.ts`, `tests/unit/claim-eligibility.test.ts`, `tests/integration/schema-evaluator-integrity.test.ts` |
| Statement–citation mapping | Implemented / Validated | Support label per mapping row (`SUPPORTS`, `PARTIALLY_SUPPORTS`, `SUPPORTS_WITH_CONDITIONS`, `DOES_NOT_SUPPORT`, `UNCLEAR`, `METADATA_MISSING`, `NOT_ASSESSABLE`), shared citations recorded as shared; citation presence is never treated as accuracy | `tests/unit/claim-metrics.test.ts`, `tests/integration/answer-claim-workflows.test.ts` |
| Statement-level attribution | Implemented / Validated | Right person/wrong role, partial, ambiguous, incorrect, unattributed, false sole credit, collaborative/organisational labels; authorship is never inferred from a name | `tests/unit/claim-metrics.test.ts`, `tests/integration/repositories-answer-claims.test.ts` |
| metrics-v3 with historical compatibility | Implemented / Superseded by v4 | `src/core/claimMetrics.ts` added a statement-level block keyed `answer_*`; its denominators were driven by the stored label alone, which is what [v4](evaluator/IMPLEMENTED_METRICS_V4.md) corrects. `metrics-v1`/`metrics-v2`/`metrics-v3` are never recomputed and render from stored snapshots; an absent block renders as "not recorded", never zero | `tests/unit/claim-metrics.test.ts`, `tests/unit/metrics.test.ts`, `tests/unit/report-compatibility.test.ts` |
| Claim-level reporting | Implemented / Validated | Snapshot, report view, and metrics CSV carry the statement block, coverage counts, and limitation lines; the template is `report-template-v4` as of v0.4 and `v1`–`v3` snapshots still render their stored figures | `tests/unit/reporting-claim-level.test.ts`, `tests/integration/reporting-service.test.ts`, `tests/unit/report-compatibility.test.ts` |
| Offline benchmark harness | Implemented / Validated | `src/benchmark/` validates a versioned case format, scores per-label precision/recall with confusion matrices, separates software regression from methodology failure; `npm run benchmark` | `tests/unit/benchmark-validate.test.ts`, `tests/unit/benchmark-scoring.test.ts`, `tests/integration/benchmark-cli.test.ts` |
| Tracked remediation findings | Implemented / Validated | `009_remediation.sql`, `src/core/findings.ts`, `src/persistence/repositories/findings.ts`, findings workspace and retest pages | `tests/unit/findings-lifecycle.test.ts`, `tests/unit/finding-inputs.test.ts`, `tests/integration/findings-workflows.test.ts`, `tests/integration/finding-workflows.test.ts` |
| Longitudinal retest comparison | Implemented / Validated | One shared comparability rule for report and retest, metric polarity per metric, causal-boundary text, append-only comparisons; a measured status requires a stored comparison | `tests/integration/findings-workflows.test.ts`, `tests/integration/finding-workflows.test.ts` |
| Backup coverage of v0.3 tables | Implemented / Validated | All nine new tables in `BACKUP_TABLES`; the manifest is checked against the live schema in both directions | `tests/integration/backup-restore.test.ts` |
| Module-boundary enforcement for the benchmark layer | Implemented / Validated | `scripts/check-boundaries.ts` takes the tree it checks as an argument and knows the `benchmark` layer | `tests/unit/boundaries.test.ts` |
| Documentation-to-code drift guard | Implemented / Validated | The published route map is compared with the registered routes in both directions | `tests/unit/route-map.test.ts` |

### v0.4 additions

| Capability | Status | Implementation | Verification |
|---|---|---|---|
| Claim eligibility (`metrics-v4`) | Implemented / Validated | `src/core/claimEligibility.ts` is the single contract: relevance decides whether a statement asserts anything, the label describes what was asserted, and each of the four statement-level gates returns its own exclusion reason. Enforced again in `src/core/answerClaimInputs.ts`, in the repository transaction and by SQLite triggers, so a refusal, abstention, ambiguity, unrelated remark or voided record cannot enter a factual denominator from any caller | `tests/unit/claim-eligibility.test.ts`, `tests/integration/schema-evaluator-integrity.test.ts`, `tests/integration/answer-claim-workflows.test.ts` |
| Voided statements kept, excluded, and readable | Implemented / Validated | A void keeps the statement, its reason, its assessments and its links visible while removing it from the figures through `CLAIM_VOIDED`; the workspace and the report both state the count | `tests/integration/report-retest-parity.test.ts`, `tests/integration/citation-void-visibility.test.ts` |
| Withdrawn citation lifecycle | Implemented / Validated | Chosen lifecycle: a withdrawn citation retains its mappings, which stop counting with `CLAIM_CITATION_VOIDED`; forced supersession was rejected because it destroys history. The run page shows the reason after the withdrawal | `tests/integration/citation-void-visibility.test.ts`, `tests/integration/schema-evaluator-integrity.test.ts` |
| Decomposition separated from assessment effort | Implemented / Validated | `partiallyDecomposedObservations` was renamed and split: `statementsRecorded`, `statementsFidelityAssessed`, `statementsAttributionAssessed`, `citationMappingsRecorded`, `citationMappingsAssessed` and `partiallyAssessedObservations` are reported separately, so reviewer effort cannot read as AI performance | `tests/unit/claim-metrics.test.ts`, `tests/unit/report-compatibility.test.ts` |
| Retest provenance bound to the status | Implemented / Validated | `011_retest_provenance.sql` stores `focus_metric`, `focus_label`, `rule_version` and both runs' metrics versions; `recordRetestComparison` recomputes the comparison from the persisted runs inside its transaction; four triggers bind a measured transition to a comparison on that finding carrying that outcome | `tests/integration/findings-workflows.test.ts`, `tests/integration/upgrade-v03-to-v04.test.ts`, `scripts/local-workflow.ts` steps 18–19 |
| Comparability completeness | Implemented / Validated | `comparison-rule-v2` also compares recorded `conditions`, and `COMPARABILITY_EXCLUSIONS` names what a local comparison cannot see (capture window, notes, sample size, query text, metrics version). v1 pairs keep their stored meaning | `tests/unit/findings-lifecycle.test.ts`, `tests/unit/reporting-claim-level.test.ts`, `tests/integration/findings-workflows.test.ts`, `tests/integration/report-retest-parity.test.ts` |
| Nested benchmark corpus validation | Implemented / Validated | `src/benchmark/validate.ts` rewritten around a reporting object that walks every nested array and object, imports the core vocabularies instead of restating them, checks cross-field references (statements→propositions→evidence→sources, citations, reviewer labels), and refuses an unknown case version rather than guessing | `tests/unit/benchmark-validate.test.ts`, `tests/unit/benchmark-source-identity.test.ts` |
| Reviewer consensus that cannot be manufactured | Implemented / Validated | Disagreement stays unresolved and is reported per subject; a single reviewer is never treated as consensus; an adjudication applies only to the dimension and subject it names; a genuinely ambiguous case is not scored as ordinary gold; `accuracyClaimable` stays false without reviewed material | `tests/unit/benchmark-scoring.test.ts`, `tests/integration/benchmark-cli.test.ts` |
| Benchmark source identity | Implemented / Validated | `benchmark-case-v2` separates an evidence record from the underlying source it came from (`sourceId`), scores independence by underlying source, and reports records that cannot be used rather than silently dropping them | `tests/unit/benchmark-source-identity.test.ts` |
| Batched statement reads with measured query counts | Implemented / Validated | `assembleClaim`'s per-record loading was replaced by one batched assemble over all claim rows bucketed by observation; the dead per-claim loaders were deleted | `tests/integration/query-counts.test.ts` (statement counts must not grow with record count) |
| Atomic multi-record writes under injected failure | Implemented / Validated | Fifteen write paths tested by failing the second statement or the audit append and confirming nothing persisted | `tests/integration/write-atomicity.test.ts`, `tests/integration/audit-atomicity.test.ts` |
| v0.3 → v0.4 upgrade and backup lifecycle with populated data | Implemented / Validated | A populated v0.3 database upgraded in place keeps its stored snapshots readable, the manifest counts the v0.4 tables, restore into an empty directory works, and restore over live data is refused without `--replace --confirm` | `tests/integration/upgrade-v03-to-v04.test.ts`, `tests/integration/backup-restore.test.ts`, `tests/integration/backup-cli.test.ts` |
| Portable record carries remediation | Implemented / Validated | `project-export-v2` adds findings with their status history, references and recorded comparisons | `tests/integration/project-export-findings.test.ts`, `scripts/local-workflow.ts` step 21 |
| Rendered form actions resolve | Implemented / Validated | Every form on 24 reachable pages is checked against the registered routes, and the workspace's link, mapping, assessment, revise, void and both supersede forms are submitted through the action the page rendered. This is what found the two 404 defects | `tests/integration/form-actions.test.ts` |
| Whole-workflow verification against the running app | Implemented / Validated | `npm run verify:workflow` drives §6's 24 steps through the served forms against a fresh temporary data directory, then backs up, verifies, restores elsewhere, restarts and reads everything back | 25 entries passed, 0 failed, 0 not-run on 2026-11-02 (Windows x64, Node v24.13.1); not run in CI |
| Metric and template version registry | Implemented / Validated | `metrics-v1`…`v4`, `report-template-v1`…`v4`, `comparison-rule-v1`/`v2`, `benchmark-case-v1`/`v2` are declared in one place, and stored snapshots render what they were written with | `tests/unit/report-compatibility.test.ts`, `tests/integration/upgrade-v03-to-v04.test.ts` |

### v0.5 additions (merged to `main` at `d941171`)

| Capability | Status | Implementation | Verification |
|---|---|---|---|
| Version-aware benchmark regression | Implemented / Validated | `src/benchmark/scoring.ts` scores every frozen proposition under **both** `evidence-aggregation-v1` and `-v2`, reporting each verdict plus the corroborating-source count; a case file may carry an optional `canonicalUri` that `v2` uses to collapse two records of one source | `tests/unit/benchmark-evidence-rules.test.ts`, `tests/unit/benchmark-source-identity.test.ts` |
| Local benchmark case-authoring CLI | Implemented / Validated | `src/benchmark/authoring.ts` + `scripts/benchmark-case.ts` (`npm run benchmark:case`) scaffold a non-scoreable template, validate, canonically normalise (byte-stable round-trip), and summarise provenance; a scaffold is refused by `validate` so it cannot enter a scored corpus | `tests/unit/benchmark-authoring.test.ts`, `tests/integration/benchmark-case-cli.test.ts` |
| Accessibility: unique per-form control ids | Implemented / Validated | Shared field components take an optional per-form `scope`, and every repeated renderer on the claim, run, finding and answer-claim pages scopes its ids and label `for` references; a shared check enforces unique ids and resolvable label references | `tests/unit/dom-a11y.test.ts`, `tests/integration/accessibility-v04-states.test.ts` |
| Three-platform CI matrix | Implemented | GitHub Actions runs `npm run check` and the live `verify:workflow` on Node 24 across Windows, Linux and macOS | CI run green across the three runners (verified via `gh` at the v0.5 checkpoint) |
| Bulk-import parser adversarial coverage | Implemented / Validated | The observation-import parser is exercised against malformed / hostile payloads; the import path was confirmed already atomic (no defect to fix) | `tests/integration/*import*` parser cases |

### v0.6 additions (this branch, ADR-026, PR pending)

| Capability | Status | Implementation | Verification |
|---|---|---|---|
| Blinded reviewer packets with stable content hash | Implemented / Validated (not merged) | `src/benchmark/review.ts` `contentHash` (key-order-independent SHA-256) and `buildReviewerPacket` emit the frozen input + subjects derived from the input only, omitting gold, annotations, adjudications, stratum, provenance and evaluator output; the `packetHash` detects a changed input | `tests/unit/benchmark-review-packet.test.ts` |
| Separate reviewer submissions | Implemented / Validated (not merged) | `buildSubmissionTemplate` yields one blank annotation per subject with empty reviewer/timestamp; the reviewer supplies label, rationale, identity and time — nothing is pre-filled or invented | `tests/unit/benchmark-review-packet.test.ts` |
| All-or-nothing safe merge | Implemented / Validated (not merged) | `mergeSubmission`/`mergeSubmissions` refuse stale hash, wrong case, duplicate reviewer, unknown/repeated subject, out-of-vocabulary label, blank rationale/reviewer/timestamp — leaving the case untouched — and never edit `expected` | `tests/unit/benchmark-review-merge.test.ts` |
| Per-subject disagreement report and scoped adjudication template | Implemented / Validated (not merged) | `disagreementReport` classifies UNANNOTATED/SINGLE_REVIEWER/UNANIMOUS/ADJUDICATED/UNRESOLVED and never manufactures a consensus; `adjudicationTemplate` lists only unresolved subjects, blank | `tests/unit/benchmark-review-disagreement.test.ts` |
| Corpus readiness and provenance audit | Implemented / Validated (not merged) | `auditCorpus` reports missing strata, missing authorisation/review date, thin review and unresolved disagreement with `accuracyClaimable: false` | `tests/unit/benchmark-review-audit.test.ts` |
| Review-workflow CLI subcommands | Implemented / Validated (not merged) | `npm run benchmark:case -- packet / merge / review / audit` run the workflow over local JSON files; new *artifact* versions in `types.ts`, case contract and report unchanged | `tests/integration/benchmark-review-cli.test.ts` |

## 2. Product requirement mapping

| Requirement | Status | Notes |
|---|---|---|
| FR-001: accept URL, claims, intended outcome, optional evidence | Partial | Project URL, claim, time scope, intended meaning, and evidence excerpts are accepted. Evidence file upload is limited to HTML audits; arbitrary artifact upload is not implemented. |
| FR-002: URL-only, claim-only, combined intake; no fabrication | Implemented | Empty/claim-only/URL-only data is allowed; empty states are explicit. |
| FR-003: atomic propositions with scope/time/units/evidence needs | Implemented | Manual decomposition; no model-generated decomposition. |
| FR-004: identity/account/project/authorship/contribution distinctions | Partial | Entity identity status, method, scope, and achievement contributor-role records exist. Account-control verification and authenticated reviewer identity remain absent. |
| FR-005: supported URLs/files/size limits | Partial | HTTP(S) URLs validated; HTML only for uploads; no general file ingestion. |
| FR-006: source descriptor and provenance | Implemented | Canonical URL optional, retrieval time, type, publisher/author, language, access route, independence, digest. |
| FR-007: evidence relations | Implemented | Supports, contradicts, qualifies, contextualizes, does not address, unavailable. |
| FR-008: preserve contradictions and unknowns | Implemented | Coexisting active relations; rule and report preserve both; unknown states explicit. |
| FR-009: source-linked verdict rationale | Implemented | Every relationship has a reviewer rationale; reports link evidence rows and assessment rationale. |
| FR-010: human correction/adjudication with audit | Partial | Supersession, append-only assessments, audit events, and disputes exist. A dedicated review-event object and reviewer identity authentication do not. |
| FR-011: generate achievement page/metadata | Partial | Local structured achievement revisions, preview, and downloadable HTML/JSON-LD after approval exist. No publication, CMS, canonical URL, sitemap, or remote write is implemented. |
| FR-012: copy/paste, CMS, API integration | Not implemented | No publication path. |
| FR-013: structured data/visible content consistency | Partial | Achievement exports generate JSON-LD from the same view as the visible page and refuse mismatched output; there is no remote page publication. |
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
| Reliability | Implemented / Validated | Transactions, foreign keys, triggers, checksummed migrations, explicit errors, validated backup/restore with safety copy. No crash-recovery, scheduling, retention enforcement, or encryption at rest. |
| Explainability | Implemented | Rule counts/notes, human rationale, metric definitions/exclusions, limitations. |
| Accessibility | Partial / locally checked | Semantic HTML, labels, skip link, text badges, keyboard-native controls, automated structural checks. No screen-reader audit. |
| Portability | Implemented | Provider-independent core; SQLite local data. |
| Extensibility | Partial | Provider contracts are documented only; adding an adapter requires a new ADR and tests. |
| Cost controls | Not applicable | No paid or external calls. |
| Localization | Partial | Locale/region are explicit fields; UI is English only. |

## 4. Acceptance criteria for the initial usable release

The local milestone's end-to-end path is validated: create a project, record claims and evidence, record genuine manual observations, decompose answers into statements, perform transparent assessments, compute defined metrics, generate a reproducible report, track a finding, compare a later capture against it, and export everything. As of v0.4 that path is verified by driving the forms the running application serves (`npm run verify:workflow`, 25 entries passed, none left not-run), not only by tests that call routes directly — which is how two workspace forms returning 404, an invisible citation withdrawal reason, and a project export missing the remediation backlog were found and fixed. Provider testing is intentionally absent.

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
| ADR-014 metrics-v2 intent-group coverage | Implemented | `tests/unit/metrics.test.ts`; stored v1 snapshots re-rendered in `tests/unit/report-compatibility.test.ts` |
| ADR-015 recorded-relationship wording | Implemented | `tests/unit/vocabulary.test.ts`, `tests/unit/evidence.test.ts` |
| ADR-016 local achievement records and approval | Implemented | `tests/integration/achievement-workflows.test.ts`, `tests/unit/achievement-export.test.ts` |
| ADR-017 validated local backup and restore | Implemented | `tests/integration/backup-restore.test.ts`, `tests/integration/backup-cli.test.ts` |
| ADR-018 answer-statement decomposition | Implemented, and corrected in v0.4 | The label field, not the relevance field, was driving statement denominators; the eligibility contract now makes relevance authoritative for whether a statement asserts anything. **Status remains Proposed** | `tests/unit/claim-eligibility.test.ts`, `tests/integration/schema-evaluator-integrity.test.ts` |
| ADR-019 metrics-v3 claim-level block | Implemented, superseded by v4 | Stored `metrics-v3` snapshots render their recorded figures and are never recomputed. **Status remains Proposed** | `tests/unit/report-compatibility.test.ts` |
| ADR-020 offline benchmark harness | Implemented | No dataset ships with it; the harness reports structural readiness only. **Status remains Proposed** | `tests/integration/benchmark-cli.test.ts` |
| ADR-021 remediation findings and retest | Implemented, with an appended amendment about the template version it claimed | See the amendment: `report-template-v3` already existed under ADR-019, and v0.4 moved the current template to v4. **Status remains Proposed** | `tests/integration/findings-workflows.test.ts` |
| ADR-022 benchmark module layer | Implemented | Boundary enforcement covers `src/benchmark`. **Status remains Proposed** | `tests/unit/boundaries.test.ts` |
| ADR-023 claim eligibility and metrics-v4 | Implemented, **Proposed** — awaiting owner review | Four-layer enforcement plus the separate review-progress counts | `tests/unit/claim-eligibility.test.ts`, `tests/integration/report-retest-parity.test.ts` |
| ADR-024 retest provenance and comparability | Implemented, **Proposed** — awaiting owner review | Durable focus metric and rule version, comparison recomputed in the write transaction, status bound to the cited comparison by trigger | `tests/integration/upgrade-v03-to-v04.test.ts`, `scripts/local-workflow.ts` steps 18–19 |
| ADR-025 corroboration by underlying source | **Proposed** — `evidence-aggregation-v2` implemented and tested, **not the default** | The rule lives behind the versioned `deriveEvidenceStatus(relationships, ruleVersion)` entry point: a `RELATED` supporting record never adds a source and two records sharing one normalised canonical URI collapse to one underlying source; the status precedence is unchanged and the `v1` figure is disclosed via `apparentCorroboratingSourceCount`. The canonical URI is threaded through the live read path, the achievements query and the report mapper. `EVIDENCE_RULE_VERSION` stays `v1`, so no live report or stored snapshot changes until the owner accepts the ADR and flips the one-line default | `tests/unit/source-identity.test.ts`, `tests/unit/evidence-aggregation-v2.test.ts` (fail against `v1`), `tests/integration/repositories-evidence.test.ts` (DB-to-core) |
| ADR-026 benchmark review workflow | Implemented on the v0.6 branch, **Proposed** — awaiting owner review; not yet merged | Blinded reviewer packets bound to a stable content hash, separate submissions, all-or-nothing merge that refuses stale/duplicate/mismatched/out-of-vocabulary input without editing gold, per-subject disagreement that never manufactures consensus, and a corpus readiness audit that keeps `accuracyClaimable: false`. New *artifact* versions only — the `benchmark-case-v1`/`v2` contract and `benchmark-report` are unchanged, so no corpus migration and no default change | `tests/unit/benchmark-review-*.test.ts`, `tests/integration/benchmark-review-cli.test.ts` |

The ADRs remain **Proposed** in the index pending owner review; implementation does not equal owner acceptance.

## 6. Explicitly not implemented

- LLM/provider/search integrations, credentials, cost accounting, or live tests.
- Remote URL fetching, crawling, robots.txt/sitemap retrieval, link health checks, or rendered-page analysis.
- Public achievement pages or URLs, remote JSON-LD publication, sitemap generation, CMS/API publication, or remote rollback (local approved HTML/JSON-LD export exists).
- User accounts, authentication, tenant isolation, roles, OAuth, billing, quotas, analytics, or scheduled jobs.
- Benchmark/gold-set validation, calibration, confidence intervals, or composite scoring.
- Separate citation-resolution, review-event, remediation-status, or retention tables. Achievement revisions, links and approvals are implemented.
- Email/notifications, attachments beyond HTML audit uploads, or PDF parsing.

## 7. Next steps

1. Owner review and acceptance or modification of ADRs 008–026. ADR-018 through ADR-024 and the new ADR-026 are still **Proposed**, and v0.4–v0.6 did not change that; implementation is not approval.
2. Use the v0.6 review workflow (ADR-026) to recruit real reviewed benchmark cases: issue blinded packets, collect at least two independent operator-asserted reviewers per high-impact subject, merge the submissions, and record observed disagreement and human adjudication. Until that material exists no accuracy figure can be stated, and the harness and the audit will both keep saying so.
3. Owner decision on ADR-025: `evidence-aggregation-v2` is implemented and tested behind the versioned entry point, but `evidence-aggregation-v1` remains the default, so material recorded under two identifiers, or as `RELATED`, still counts twice in live reports until the owner accepts the ADR and flips `EVIDENCE_RULE_VERSION`.
4. Add screen-reader, mobile and cross-browser testing, and run `verify:workflow` on macOS and Linux. None of it has been executed here.
5. Implement retention/deletion policy and backup guidance beyond the local copy procedure.
6. If provider or remote website work is authorized, add capability declarations, terms review, SSRF/network isolation, and live validation under new ADRs.
7. Review the local achievement workflow and decide whether a future publication milestone is authorized; publication requires a new ADR, destination control, rollback, and correction/dispute handling.
