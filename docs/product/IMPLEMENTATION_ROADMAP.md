# Implementation Roadmap

- Status: Proposed sequencing, not a delivery commitment
- Date: 2026-11-04

## Implementation note — 2026-11-04 (v0.6, in progress — PR pending, not merged)

Local core v0.6 turns the offline benchmark tooling into a reproducible human-review workflow
([ADR-026](../agents/adrs/ADR-026-benchmark-review-workflow.md)), and changes only what v0.5 had
skipped — the *mechanics of running a review* — not what it had shipped. Four new
`npm run benchmark:case` subcommands (`packet`, `merge`, `review`, `audit`) over a pure
`src/benchmark/review.ts` module let a reviewer work **blinded**: a packet carries only the frozen
input and the subjects derived from it, bound by a key-order-independent content hash, and omits gold
labels, existing annotations and evaluator output so a judgement is not anchored by the tool. Separate
submissions carry the reviewer's own labels, rationale, identity and timestamp — none of which the tool
ever invents. An **all-or-nothing merge** refuses a stale packet hash, a wrong case, a duplicate
reviewer, an unknown or repeated subject, an out-of-vocabulary label or a blank rationale, and never
edits the gold `expected` array or removes another reviewer's label. A **disagreement report** classifies
each subject (single-reviewer is not consensus; a split stays `UNRESOLVED` and is never averaged into a
label), leaving adjudication to a human via a blank scoped `benchmark-adjudication-v1` entry. A **corpus
readiness/provenance audit** names missing strata, cases lacking storage authorisation or a review date,
thin review and unresolved disagreement, and always reports `accuracyClaimable: false`. These are new
*workflow artifact* versions; the `benchmark-case-v1`/`v2` contract and `benchmark-report-v2` are
untouched, so **no corpus migration and no change to the `evidence-aggregation` default**. The
local-first boundaries hold (no network, database, provider, auth, billing, or reviewer accounts), and
reviewer identity stays operator-asserted with no independence claim. Phase 3's reviewed gold set still
does not exist — v0.6 makes running that review honest and reproducible; it does not perform one.
This milestone is on a feature branch with a pull request pending and is not owner-accepted.

## Implementation note — 2026-11-04 (v0.5)

Local core v0.5 continued on the merged v0.4 line and stayed a correctness/coverage milestone, not a
new capability phase. It **finished the evidence-identity work (ADR-025)**: `evidence-aggregation-v2`
now counts corroboration by underlying source, collapsing two records that share a normalised
canonical URI and excluding records marked `RELATED`; `evidence-aggregation-v1` is byte-identical and
remains the default, with the ADR still Proposed — flipping it is an owner decision. The **benchmark
pipeline became explicitly version-aware**, scoring each proposition under both `v1` and `v2` and
reporting the corroborating-source count and the v1/v2 disagreement beside the verdict, and a local
case-curation CLI (`npm run benchmark:case`: scaffold/validate/normalise/provenance) lets a reviewer
prepare real cases — a scaffold is deliberately refused by the validator, so the tool cannot fabricate
a scoreable case. An **accessibility defect** (duplicate field ids where the same form is rendered per
record) was found by the audit and fixed with a deterministic per-form id scope, now enforced by the
shared checker. **CI widened** to run `npm run check` *and* the live 25-step workflow across Windows,
Linux and macOS on Node 24 — the cross-platform workflow evidence v0.4 did not have. The reliability
audit found the bulk import already all-or-nothing and guarded; it added adversarial parser coverage
rather than a defect. Phase 2 publication, Phase 3's reviewed gold set, and Phases 4–6 remain
unimplemented, and Phase 3 stays open in the way that matters: no dataset ships, so no accuracy
figure is established. See the [v0.5 session report](../agents/sessions/2026-11-04-local-core-v0.5-evaluation-reliability.md).

## Implementation note — 2026-11-02

Local core v0.4 was an audit-and-correction milestone rather than a new phase. It changed what v0.3 had shipped, not what v0.3 had skipped: statement-level metrics became `metrics-v4`, where the recorded relevance decides whether a statement asserts anything, so a refusal, abstention, ambiguity, unrelated remark, reviewer description of an omission or voided record is excluded with a named reason instead of being scored — enforced in the pure calculation, the form validator, the repository transaction and SQLite triggers. A voided statement or withdrawn citation now stays readable with its reason and simply stops counting. A retest comparison stores the metric that decided it, both runs' metric versions and the rule version, is recomputed from the persisted runs inside its own write transaction, and a measured finding status is accepted only against a comparison on that finding that carries that outcome. The benchmark case contract became `benchmark-case-v2`, separating an evidence record from the underlying source and refusing to turn reviewer disagreement, a single annotator, or a genuinely ambiguous case into gold. Performance and durability were measured rather than assumed: the statement reader's query count no longer grows with the number of records, and every multi-record write was tested by failing it partway.

Most importantly for Phase 1's exit criteria, the whole workflow is now verified through the forms the running application serves (`npm run verify:workflow`, 25 entries passed, none left unrun), which found four defects the documentation described as working: two sets of workspace forms returning 404, a withdrawal reason never displayed, and a project export missing the remediation backlog. Phase 2's publication half, Phase 3's reviewed gold set, and Phases 4–6 remain unimplemented, and Phase 3 stays open in the only way that matters: no dataset ships, so no accuracy figure is established. See [Implementation Status](../IMPLEMENTATION_STATUS.md) and the [v0.4 session report](../agents/sessions/2026-11-02-local-core-v0.4-audit-and-traceability.md).

## Implementation note — 2026-11-01

Local core v0.3 added answer-statement decomposition (`answer_claims` and its revisions, proposition links, citation mappings and assessments), the first claim-level metric block under `metrics-v3`, tracked remediation findings with an append-only lifecycle and stored retest comparisons, and the offline benchmark harness with a versioned case format. It did not add a benchmark dataset, provider integration, or publication path. Its own session report recorded six of nineteen manual workflow steps as unresolved because the driver had guessed field names — an end-to-end gap that v0.4 closed, together with the label-versus-relevance defect in its claim-level denominators.

## Implementation note — 2026-10-30

Local core v0.2 keeps the v0.1 slice and adds the local half of Phase 2 without crossing the publication boundary: versioned intent-group coverage (metrics v2), corrected evidence wording, atomic record/audit writes, immutable local achievement revisions with evidence-linked claims, contributor roles, unresolved contradictions, hash-bound operator approval, validated HTML and JSON-LD downloads, and validated offline backup/restore. Sitemap generation, crawler/indexing verification, deployment packages, remote website changes, and actual publication remain unimplemented, as do safe URL fetching and provider adapters. See [Implementation Status](../IMPLEMENTATION_STATUS.md), [Local Core Architecture](../technical/LOCAL_CORE_ARCHITECTURE.md), and [Known Limitations](../KNOWN_LIMITATIONS.md).

## Implementation note — 2026-10-29

Local core v0.1 implements the Phase 1 slice in a deliberately narrower form: claim intake and decomposition, local evidence provenance, human evidence relationships and assessments, approved query sets, manual observation capture/import, separate metrics, local HTML analysis, and immutable reports. Safe URL fetching and a search-grounded provider adapter remain intentionally unimplemented because this milestone prohibits remote access and provider integrations. Phases 2–6 and website publication remain future work. See [Implementation Status](../IMPLEMENTATION_STATUS.md) and [Known Limitations](../KNOWN_LIMITATIONS.md).

## Guiding strategy

Prove that Aporia can generate a useful, evidence-linked report before building broad provider coverage or a complex business dashboard. Prioritize the correctness of evidence and attribution. The order below is a dependency sequence, not a promise of dates.

## Phase 0 — Specification and risk foundation

Deliverables:
- Product, architecture, data, evaluator, trust, safety, privacy/security, operations, and agent documents.
- Accepted foundational ADRs.
- Explicit non-goals around caching and universal citation guarantees.
- Threat model and evidence-status vocabulary.
- Provider research register with last-verified dates.

Exit criteria:
- Owners can explain the difference between claim support, discovery, answer fidelity, and attribution.
- Core interfaces and package boundaries are documented.
- Open questions and release gates are visible.

## Phase 1 — One end-to-end vertical slice

Build:
- Claim intake and proposition review.
- Safe URL fetching with SSRF protections.
- Source record and evidence locator.
- A minimal evidence assessment and human correction route.
- One supported search-grounded provider adapter.
- Raw response/citation storage under defined retention.
- Mention/citation/fidelity/attribution result schema.
- Evidence-linked HTML report and one rerun flow.

Exit criteria:
- A reviewer can trace each verdict to evidence.
- Provider errors remain distinct from negative outcomes.
- No provider or caching guarantee is made.
- Security tests cover URL and tenant boundaries.

## Phase 2 — Achievement Registry and website integration

Build:
- Human-readable achievement record pages.
- Role-aware attribution fields and correction/dispute states.
- JSON-LD generation with visible-content consistency checks.
- Sitemap/canonical guidance and crawl audit.
- Copy/paste or Git-based integration with preview and explicit approval.
- Page reachability and structured-data validation.

Exit criteria:
- User can export or publish an accurate record with evidence links.
- The system accurately distinguishes public page reachability from indexing or AI recognition.
- Publication and rollback actions are auditable.

## Phase 3 — Benchmark and trust validation

Build:
- Human-reviewed gold set and adjudication guidance.
- Fixture/regression tests for every verdict label.
- Citation-support and attribution tests.
- Error, partial, unsupported provider, and prompt injection cases.
- Evaluation-version reporting and reliability dashboards.

Exit criteria:
- Public performance statements are based on disclosed, measured benchmarks.
- Critical false-support and false-attribution failures are tracked.
- Methodology can be reproduced from versioned inputs.

## Phase 4 — Additional provider integrations

Add providers individually after:
- a supported, authorized access method is confirmed;
- provider terms/data retention are reviewed;
- request/response schemas are captured;
- search/grounding and citation signals are understood;
- fixture and live integration tests exist;
- costs and regional availability are documented.

Chinese systems are separate research/integration tasks; do not claim broad support simply because a provider API or consumer website exists.

## Phase 5 — Monitoring and multi-project support

Build scheduled runs, provider/citation history, source freshness checks, user alerts, cross-project views, and first-party webmaster integrations where authorized. Use comparable query-set versions and annotate provider updates.

## Phase 6 — Optional commercial operations

Only after evidence quality and customer value are validated, consider billing, paid tiers, agency workspaces, quotas, and APIs. These must remain outside evaluator-core logic under ADR-007. Plan access may control whether a job can start; it cannot change a verdict.

## Cross-cutting release blockers

- Critical SSRF or cross-tenant access bug.
- Secret exposure.
- False claim-support verdicts above the reviewed tolerance on core benchmark cases.
- Untraceable material verdict.
- Provider outage treated as negative answer.
- Unsupported claim of universal caching/indexing/citation.
- Attribution that falsely assigns sole credit.
- Public publication without explicit approval.
