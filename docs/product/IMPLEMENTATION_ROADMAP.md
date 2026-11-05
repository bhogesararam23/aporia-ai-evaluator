# Implementation Roadmap

- Status: Proposed sequencing, not a delivery commitment
- Date: 2026-11-05

## Implementation note — 2026-11-05 (v0.8, in progress — PR open, not merged)

Local core v0.8 makes the release v0.7 created actually govern a run, and hardens the file handling around it.
Seven defects were reproduced against merged v0.7 (`e72e77a`) before any fix was written
([ADR-028](../agents/adrs/ADR-028-release-bound-execution-and-artifact-identities.md)): a case id of
`../../../../pwned` validated cleanly and `normalise` exited zero while writing a case file outside the `--out`
it had been given; a directory named `nested.json` produced a raw `EISDIR` stack trace on two of three benchmark
commands while the third skipped it; byte ceilings applied only to the harness; a pre-existing report and a
pre-existing manifest were destroyed without a word; report bytes depended on locale collation; and `--release`
was an unknown argument, so no report could name the corpus it scored. The milestone then does four things: **one
bounded corpus and artifact read** across all three commands, with typed refusals for symlinks, non-regular
entries, oversized or over-counted files and over-deep documents; **release-bound execution**, where
`npm run benchmark -- --release <manifest>` verifies the corpus before scoring and refuses to write a report when
anything drifted, a blocking gate failed or the manifest came from another contract; **a deterministic
`benchmark-run-record-v1`** binding release id, manifest bytes, corpus hash, canonical and exact-text report
hashes, case count and the applicable case/report/methodology/metrics/evidence-rule versions, with a source
revision only when an operator supplies one, checked afterwards by `npm run benchmark:verify`; and **atomic,
refuse-by-default publication** of every artifact, with a staged directory batch that rolls back rather than
half-publishing.

Two things changed deliberately, both recorded in ADR-028: the per-file byte ceiling now applies to
`benchmark:case` and `benchmark:release` as well as the harness (no ceiling was loosened — the commands that had
none became as strict as the one that did), and an existing output target is refused unless `--overwrite` is
passed. `benchmark-case-v1`/`v2` still read, and **`benchmark-report-v2` was left byte-for-byte unchanged on
purpose**: the binding lives in the receipt rather than in the report, so a stored report stays comparable and a
receipt written on one operating system can still be verified on another, because the receipt also records the
report's canonical content hash, which does not depend on collation.

**What v0.8 does not do:** it establishes no accuracy. A receipt proves that this build scored this corpus into
this report; it cannot show the material is genuine, that two reviewer names are two people, or that any reviewer
existed. It creates no case, no review and no corpus, it does not make `--release` mandatory, it leaves
`evidence-aggregation-v1` the default, and it accepts no ADR: `accuracyClaimable` is `false` in the report, the
manifest and the receipt. Symlink refusal is implemented and tested but cannot be demonstrated on this Windows
host (creating a link fails `EPERM`), so the test says so and skips; the Linux and macOS CI jobs execute it.

## Implementation note — 2026-11-05 (v0.7, merged to `main` at `e72e77a` via PR #10)

Local core v0.7 closes five defects that were reproduced in the merged v0.6 review workflow and adds
reproducible corpus releases ([ADR-027](../agents/adrs/ADR-027-review-provenance-and-corpus-releases.md)).
v0.6 had built honest *mechanics* but leaked the results: it demanded a reviewer's rationale and
submission timestamp and then discarded both, it accepted reviewer names the case never authorised — so
`merge` wrote corpora that `validate` rejected — an adjudication was checked against whatever the
disagreement happened to be at application time rather than the one it was written against, and a batch
partially applied with no dry run, staging or recovery. v0.7 persists the rationale, the reviewer's own
timestamp, the packet hash and a submission hash as **optional additive fields on `benchmark-case-v2`, so
there is no contract bump and no migration**; enforces the declared roster without ever widening it;
canonicalises reviewer identity so one person cannot be counted twice by respelling their name; binds every
new adjudication to a hash of the exact disagreement and resolves `MATCHING`/`STALE`/`UNBOUND` in **one**
resolver shared by the disagreement report and the benchmark scorer; and makes batch writes atomic by
default, published through a staging directory and a journal so an interrupted run rolls back or completes
to the bytes a clean run would have produced. `npm run benchmark:release` then freezes a corpus into a
deterministic `benchmark-release-manifest-v1` — per-case canonical digests, a content-derived release id, no
clock, path or machine input — with verify, diff and named provenance/completeness gates.

Two things changed deliberately: the batch default is now atomic (`--allow-partial` restores the v0.6
behaviour), and ordering that reaches a digest is by code unit rather than locale collation, so v0.6-computed
packet hashes differ and an old packet must be re-issued — no such packet exists, since no review has been
run. `benchmark-case-v1`/`v2` and `benchmark-report-v2` still read, and the report keeps its version and
status vocabulary, disclosing binding through additive fields only.

**What v0.7 does not do:** it establishes no accuracy. A hash is an integrity check over recorded content,
not proof of reviewer identity or material genuineness; readiness gates are not validation; legacy unbound
adjudications are disclosed rather than credited; and no case, reviewer, timestamp or label is real. Phase
3's reviewed gold set still does not exist. `accuracyClaimable` remains `false`, the
`evidence-aggregation-v1` default is untouched, and ADR-025/026/027 all still await owner acceptance. That
v0.7 status is now historical: the milestone was merged to `main` at `e72e77a` (PR #10) on 2026-11-05 and remains
not owner-accepted, and the release machinery it added is what v0.8 above binds execution to.

## Implementation note — 2026-11-04 (v0.6, merged to `main` at `2b1ecab` via PR #9)

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
This milestone was merged to `main` as v0.6 (PR #9, `2b1ecab`) on 2026-11-05 and is not owner-accepted;
five of its gaps are closed by v0.7 above.

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
