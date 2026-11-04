# Known Limitations and Out-of-Scope Behavior

- Status: Current as of local core v0.4
- Date: 2026-11-02

This document prevents the implementation from being mistaken for the complete product or a production-ready system. It should be updated whenever a milestone closes one of these gaps.

## 1. No provider, LLM, search, or remote integrations

- Aporia does not call any AI provider, search API, model, embedding service, or cloud function.
- There is no scraping, browser automation, headless rendering, crawling, or remote website fetching.
- No provider capability is advertised as supported. Provider/model/interface labels in a run are operator-supplied strings, not verified integrations.
- Manual observations are the only answer source. Results are limited to what an operator actually captured and recorded.
- No automatic query generation, answer extraction, semantic matching, or model-assisted judgment exists. Human assessments are explicit; the evidence summary is a transparent rule over human-recorded relationships.

## 2. No publication or discovery control

- Achievement records are local structured revisions with a preview and downloadable HTML/JSON-LD after explicit approval. No achievement page is published, no remote file is written, and no canonical URL, sitemap, indexing, or provider submission exists.
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
- The `metrics-v4` eligibility correction is a correctness fix, not validation evidence. Refusals, abstentions, ambiguities, unrelated remarks, reviewer descriptions of omissions and voided records no longer enter factual denominators, so a rate means what it claims; that still says nothing about whether reviewers classified the underlying statements well. Nothing in this repository has measured agreement between reviewers, and no accuracy figure is established or claimed.

## 4. Identity, attribution, and trust limits

- Identity statuses are `UNVERIFIED` or `SELF_DECLARED`; no account control, domain control, or independent identity verification exists.
- Attribution assessment covers the answer’s named entity, role, and source only as recorded by a reviewer. It does not establish legal authorship, ownership, or sole credit.
- Supporting and contradictory evidence can coexist. A `SUPPORTED_WITHIN_SCOPE` rule result is not universal proof.
- No dedicated achievement registry, correction/appeal workflow, independent reviewer assignment, or public dispute handling exists. Audit events and append-only assessments provide a local review history.

### 4.1 Achievement-record and approval limits

- Contributor names, roles, contribution statements, claim support states and evidence links are operator records. They are not identity or account-control verification, ownership proof, independent corroboration, or a guarantee of sole credit.
- Approval is a local operator action bound to one revision's content hash. It is not a publication, a legal or ethical review, an endorsement, or a guarantee that linked evidence is true.
- HTML and JSON-LD exports are generated only from an approved current revision. Their visible and structured values are checked for consistency, but the file does not guarantee that any search engine or AI system will crawl, index, cite, retain, or recommend it.
- There is no public page, public URL, correction portal, or remote publication path. Downloading an export is the end of the implemented workflow.
- A new revision is a draft and requires a new approval; approval never carries forward.

## 5. Platform and operations limits

- Single local operator, single process, one loopback host; no authentication, authorization, role separation, or multi-tenancy.
- No remote access, TLS, reverse proxy, rate limiting, or production hardening.
- SQLite via `node:sqlite` is experimental in the tested Node release. Schema and driver compatibility should be rechecked on Node upgrades.
- Backup and restore are implemented as offline local commands with validation, a manifest and a pre-restore safety copy. There is no scheduled backup, retention enforcement, encryption at rest, remote backup, or disaster recovery. Backups are unencrypted and are not tamper-proof against an attacker who can rewrite both the database and its manifest.
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
- Automated structural accessibility checks pass for the tested pages, but no screen-reader, keyboard-only user study, mobile device, or cross-browser audit has been completed. The v0.5 shared checks additionally assert every `<a href>` has an accessible name and no element uses a positive `tabindex`; both pass.
- **Known defect (found in the v0.5 audit, not yet fixed): duplicate `id` attributes where the same form is rendered once per record.** On the run-detail page and the statement workspace, the shared field helpers emit `id="field-<name>"` for every instance, so a page with several citation/statement forms repeats ids such as `field-reviewer`, `field-rationale` and `field-quoteText` (observed up to 11 times). A `<label for>` and the `aria-describedby` help/error references then resolve to only the first match, so screen-reader and keyboard users lose the label/description on the other instances. Form submission is unaffected (fields submit by `name`), which is why the functional suite stayed green. Fixing it needs a per-form id scope threaded through the ~173 field call sites where forms repeat, so it is tracked rather than enforced by the shared check (which would fail today).
- Some long forms are necessarily dense (especially proposition decomposition and observation entry). They prioritize completeness over a guided wizard.
- Error summaries are textual and server-rendered; there is no client-side field focus management beyond native HTML and links.
- The interface was visually checked in a desktop dark color scheme. Light mode uses the same semantic structure but was not visually reviewed in this session.

## 8. Reporting and governance limits

- Reports are project snapshots; there is no scheduled monitoring, alerting, retest notification, or longitudinal dashboard.
- Comparisons are limited to identical query-set versions and declared provider configuration. Deltas are descriptive, not causal.
- Findings are tracked work items with an owner **label**, a status lifecycle, and a retest comparison, but they are not a project-management system: there are no due dates, no assignments, no notifications, and no accounts, so nothing verifies who owns or changed a finding. A measured status (`improved`, `unchanged`, `regressed`, `unable to verify`) requires a stored comparison; `unable to verify` is a respectable outcome and is never rendered as fixed.
- A retest compares two captures the operator made by hand. Creating `retest required` schedules nothing and calls no provider; if no later run exists, there is nothing to compare.
- Remediation suggestions are derived from recorded gaps and findings. A suggestion becomes a tracked finding only when somebody raises one; the report does not open findings by itself, and a finding raised from a suggestion records the suggestion key rather than a decision that the suggestion was correct.
- Report exports include all recorded material; there is no redaction workflow or share-scope control. Findings, statement narratives, and comparison reasons are included, so an export may carry an operator's written account of a wrong statement about a real person.
- No license is declared. No legal, privacy, consumer-protection, or regulatory review has been completed.
- The repository is not production-ready, independently audited, or backed by verified CI/release controls merely because checks pass locally.

## 9. Missing domain entities and workflows

The following data-model concepts are documented in the baseline but are not implemented in any local core release through v0.4:

- public achievement pages, public URLs and publication statuses (local achievement records and approved exports exist);
- public report sharing and unguessable links;
- dedicated review/appeal events (local audit and assessment history are used instead);
- provider capability records;
- citation-to-source resolution;
- scheduled provider tests and monitoring;
- accounts, organizations, plans, billing, and quotas.

Implemented later, with their own limits:

- **Remediation work-item tracking** exists from v0.3 as tracked findings (`009_remediation.sql`), with pointers, an append-only history, and stored retest comparisons. It carries no due dates, notifications, or identities.
- **Benchmark and gold-set management** exists from v0.3 as an offline file format with validation and scoring (`src/benchmark/`, `npm run benchmark`). It manages **no dataset**: there are no gold cases in this repository, no published corpus, and no measured agreement figure. Until a real annotator records labels, the harness is a machine that can score a comparison, not evidence that the evaluator is correct.
- **Answer-statement decomposition** exists from v0.3 (`008_answer_claims.sql`). A statement is what a reviewer says the answer asserted: extraction is manual, the raw answer is never edited, and a statement whose quote cannot be located is stored as a reviewer description rather than as a quote.
- Observation-level attribution still uses the v0.2 labels (`correct`, `partially correct`, `incorrect`, `not addressed`, `not assessable`). The finer distinctions — right person with the wrong role, false sole credit, collaborative or organisational contribution — exist only at statement level, so an answer-level rate cannot express them.
- A statement-level metric appears in a report only when the answers were decomposed. Its absence means "not recorded"; it is never reported as zero, and a change in how much of the answer a reviewer decomposed is reported as context rather than as improvement.
- **Withdrawn records are excluded, not deleted.** A voided statement stays readable with its reason, its assessments stay on the record, and both leave the current figures through a named exclusion reason. The same applies to a citation: withdrawing one keeps its mappings visible, and the report states that those mappings support nothing in the current figures. Earlier metric versions are never recalculated with these rules; a `metrics-v3` snapshot renders the numbers it was written with.
- **The default rule, `evidence-aggregation-v1`, counts distinct underlying-source identifiers, not distinct sources.** Two records that share an identifier, or one record reused across propositions, collapse to one; two copies of the same material filed under different identifiers, or material recorded as `RELATED` rather than `INDEPENDENT`, still count as two and can inflate apparent corroboration. `evidence-aggregation-v2` (ADR-025) now implements the fix — a `RELATED` supporting record never adds a corroborating source and two source records that share one normalised canonical URI collapse to a single underlying source, with the status precedence unchanged and the `v1` figure disclosed — but it sits behind the versioned `deriveEvidenceStatus(relationships, ruleVersion)` entry point and is **not the default**: `EVIDENCE_RULE_VERSION` stays `v1` until the owner accepts ADR-025, so live reports and stored snapshots are unaffected. Because it changes a stored verdict's figure, it needed its own version rather than an edit here, exactly as planned.
- **Remediation provenance is durable but local.** A comparison stores its focus metric, both runs' metric versions and the rule version, is recomputed inside its own write transaction, and a measured status is accepted only against a comparison on that finding which carries that outcome. None of this establishes that a change caused the movement; the comparison is an association between two captures, and conditions outside Aporia's view may have changed.
- **The portable record is now `project-export-v2`.** It carries the findings, their status history and their recorded comparisons, which `v1` omitted. An export taken before this change does not contain them, so restoring an old export and expecting a backlog is a difference between the formats, not a lost record.
- **`npm run verify:workflow` runs locally, not in CI.** It binds a loopback port and creates temporary directories. Its 25 steps were verified on Windows x64 with Node v24.13.1; they have not been run on macOS or Linux, and a hosted runner that could not bind a port would have to be recorded as not run rather than as passing.

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
