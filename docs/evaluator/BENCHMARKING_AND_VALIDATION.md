# Benchmarking and Validation Plan

- Status: Required before public reliability claims. No accuracy claim is currently supportable.
- Goal: Validate claim/evidence judgments and AI-answer metrics against human-reviewed cases.
- Implementation record: [ADR-020](../agents/adrs/ADR-020-offline-benchmark-harness.md), [ADR-023](../agents/adrs/ADR-023-claim-eligibility-metrics-v4.md), [ADR-026](../agents/adrs/ADR-026-benchmark-review-workflow.md), `npm run benchmark -- --corpus <directory>`, `npm run benchmark:case -- <subcommand>`

## 0. What exists and what is only planned

This document is a plan, and plans outgrow their implementation. Each section below says which part
is code in this repository today, because a document that reads like a completed method is exactly how
a benchmark becomes decoration.

| Section | Implemented | Not implemented |
| --- | --- | --- |
| 2. Strata | 16 required strata, enforced by `src/benchmark/validate.ts`; a corpus missing one fails the run unless `--allow-partial-strata`, and the absence is printed either way | Any real case material. There is no gold corpus in this repository. |
| 3. Gold labels | Case contract `benchmark-case-v2`: provenance and authorisation, named reviewers, per-dimension gold labels with rationale and subject, reviewer labels retained separately, scoped adjudications. Since v0.6, the offline review workflow (§3.4) issues blinded packets, safely merges separate submissions, reports disagreement per subject, and audits corpus readiness — all as new *artifact* versions, with the case contract and report unchanged. | Independent review. The application has no authentication, so reviewer identity is operator-asserted. Two names agreeing is not proof two people reviewed. And no gold corpus exists yet — the workflow runs the review; it does not perform one. |
| 4. Performance measures | Per-class precision/recall, confusion matrices, macro-F1 with an explicit reason when withheld, per-dimension and per-label reporting, no composite score | Confidence intervals, calibration, class-balance reporting. Sample sizes in any plausible local corpus are too small to justify either. |
| 5. Ablation | Version-aware deterministic regression of `evidence-aggregation-v1` **and** `-v2` (verdict plus corroborating-source count) over a frozen input pack, plus metric-formula checks. Duplicate-source counting and canonical-URI collapse are expressible and tested since v2. | Model-assisted classification comparison, query-generation strategies, citation extraction, multilingual processing, contradiction detection. None of these are components that exist yet. |
| 6. Leakage | Not applicable to an offline corpus of reviewer-recorded cases | Development/validation/held-out splits and time splits. Meaningless until a real corpus exists. |
| 7. Provider integration | — | Everything. There are no providers, no adapters, and no network access in this build. |
| 8. Release gates | The harness refuses to print a percentage over an empty corpus, exits non-zero on invalid cases, on deterministic mismatches, and on missing strata | Any release gate that depends on measured results. |
| 9. Monitoring | — | Nothing. Local single-operator use has no monitoring pipeline. |
| 10. Public claims | `accuracyClaimable` is reported as `false` in every artifact, with the reason beside it | — |

**A green `npm run benchmark` is not evidence that the evaluator is accurate.** It means the software
produced the labels recorded in the corpus it was given. Those are different claims, and the report
keeps them in separate sections.

## 1. Why validation is required

An LLM judging another LLM may repeat mistakes, follow misleading source text, overlook context, or express unjustified certainty. A mathematically precise metric may still be invalid if its unit or denominator is wrong. Validate the evaluator independently from the AI provider responses.

## 2. Benchmark strata

Include cases for:
1. strongly supported claims backed by primary evidence;
2. partially supported claims with important conditions;
3. claims contradicted by credible evidence;
4. conflicting evidence;
5. insufficient evidence after a bounded search;
6. version/date-sensitive claims;
7. identity and attribution ambiguity;
8. collaborative achievements and multiple contribution roles;
9. duplicate/syndicated sources;
10. inaccessible pages, robots blocks, provider failures, and missing citation metadata;
11. multilingual and regional cases;
12. safety refusals that are not factual denials;
13. fabricated sources and prompt-injection content;
14. claims mixing true and false subclaims.

## 3. Gold-label procedure

- Freeze claim version, evidence pack, permitted search budget, and assessment rubric for each case.
- Have at least two trained reviewers independently label high-impact gold cases where feasible.
- Ask reviewers for an initial label before showing the automated verdict, to reduce anchoring.
- Adjudicate reviewer disagreement or record that the case is genuinely ambiguous.
- Store rationale and evidence locators, not only labels.
- Distinguish insufficient evidence from contradiction.
- Version labeling guidance; changes require an impact review.

### 3.1 How agreement is computed, and how it is never invented

The harness reports four things separately and does not convert one into another:

- **deterministic regression** — what the current code produced versus the recorded gold label;
- **reviewer agreement** — subjects whose reviewers were unanimous;
- **adjudicated labels** — subjects a scoped adjudication settled, naming the subject, the settled
  label, the reason and the adjudicator;
- **unresolved disagreement** — subjects with no settling adjudication, and subjects recorded as
  genuinely ambiguous.

The rules that follow from that split:

1. A subject labelled by fewer than two distinct reviewers is `NOT_ENOUGH_REVIEWERS`. One reviewer is
   one opinion. The same reviewer writing twice does not become two reviewers.
2. Disagreement without an adjudication stays `UNRESOLVED`. It is excluded from any agreement rate and
   counted in the open, so a clean figure cannot be produced by quietly dropping the hard cases.
3. `GENUINELY_AMBIGUOUS` may not carry a label. Choosing one would score an unresolved subject as an
   ordinary gold verdict.
4. A `RESOLVED` adjudication must name the label it settled and the subject it settled it for. A v1
   case's unscoped adjudication is honoured only where the case disagrees on exactly one subject;
   one unnamed decision cannot settle two disputes.
5. Nothing selects a reviewer label to manufacture a consensus. `metrics-v3`'s harness took the
   alphabetically first label, which made one dissenting `ACCURATE` outrank two `UNSUPPORTED` and
   folded the result into the same accuracy figure as software output. There is no such step now.

Reviewer identifiers remain operator-asserted strings. Local core has no authentication, so agreement
between two labels is not proof of independent review, and no number in a benchmark report establishes
it.

### 3.2 The deterministic regression is version-aware

The only automatic judgement in the product is `evidence-aggregation`. Because `evidence-aggregation-v2`
(ADR-025) is still a proposal and the application default remains `v1`, the harness scores every
proposition's frozen evidence under **both** rules and reports them side by side rather than picking
one:

- for each rule, the produced verdict and the **corroborating-source count** (`supportingSourceCount`),
  so a reader can see a rule change move the corroboration figure even where the verdict label is
  unchanged;
- `ruleStatusDisagreements` — propositions where the two rules give different verdicts — and
  `corroborationCollapses` — where `v2` counts fewer underlying sources than `v1`;
- a canonical source identity: an evidence record may carry an optional `canonicalUri` (older `v1`/`v2`
  files simply omit it), which `v2` uses to collapse two records of one document reached differently.

A `v2` divergence from a gold label is **analysis, not a failing regression**: the report's pass/fail
stays tied to the product's default rule, and the report never promotes `v2` over `v1`. This mirrors
how the application treats the two rules — both computable, one in force.

### 3.3 Local curation workflows

`npm run benchmark:case` supports the human work of building a corpus without ever letting the tool
fabricate one:

- **scaffold** — emit a skeleton for a chosen stratum. It is deliberately *not* a valid case: it
  carries a `benchmark-case-template` version and no gold labels, so `validate` refuses it and it
  cannot enter a scored corpus. Structure is provided; content must come from a real review.
- **validate** — report structural and semantic problems in a corpus directory; exit non-zero on any.
- **normalise** — canonicalise each valid case (sorted keys, deterministic) into an output directory;
  invalid entries are refused, never exported. Re-running is byte-stable, so an import/export
  round-trip is reproducible.
- **provenance** — per-case summary of the reviewer labels, disagreements and how many a scoped
  adjudication settles. Reviewer names are operator-asserted; the summary states this and asserts no
  accuracy.

None of these reaches the network or the application database. They are authoring aids, not a source
of gold cases.

### 3.4 Offline human-review workflow (v0.6, ADR-026)

The authoring aids prepare a corpus; the review workflow runs the human judgement *against* a corpus
without letting the tool bias or overwrite it. It is four more `npm run benchmark:case` subcommands, all
pure file tooling (no network, no database, no clock) built on `src/benchmark/review.ts`:

- **packet** — per case, emit a blinded `benchmark-packet-v1` (the frozen input, the subject list derived
  from the input alone, and rubric guidance) and a blank `benchmark-submission-v1` template. The packet
  omits gold `expected`, existing annotations, the stratum, provenance, and evaluator output, and is bound
  by a key-order-independent SHA-256 of the input, so a review is made *before* and apart from what Aporia
  concluded. This is the "initial label before showing the automated verdict" rule from §3, made mechanical.
- **merge** — import filled submissions into the case's `reviewerLabels`, refusing (leaving the case
  untouched) a stale packet hash, a wrong case id, a duplicate reviewer, an unknown or repeated subject, an
  out-of-vocabulary label, a blank rationale, or a missing reviewer/timestamp. It never edits `expected` and
  never deletes another reviewer's label; a rejected import exits non-zero so a partial merge cannot slip in.
- **review** — per-subject agreement status (unannotated / single-reviewer / unanimous / adjudicated /
  **unresolved**). A split is reported as unresolved and left unresolved; the tool never picks a side.
- **audit** — corpus readiness and provenance: missing strata, cases lacking storage authorisation or a
  review date, subjects judged by fewer than two reviewers, and unresolved disagreements — always reporting
  `accuracyClaimable: false`. Readiness to review is explicitly not a claim that the evaluator is accurate.

These are new *workflow artifact* versions; the benchmark **case** contract (`benchmark-case-v1`/`v2`) and
the report are unchanged, so no corpus migration is implied and existing benchmark reports stay valid. A
merged case is an ordinary case file with `reviewerLabels` populated. Reviewer names and timestamps stay
operator-supplied and unverified; independence is never claimed. The adjudication step remains a human act
recorded as a scoped `benchmark-adjudication-v1` entry on the case — see [ADR-026](../agents/adrs/ADR-026-benchmark-review-workflow.md).


## 4. Evaluator performance measures

For categorical verdicts, measure per-class precision/recall, confusion matrices, macro-F1 where appropriate, and calibration only when meaningful probabilities are emitted. Track false-positive SUPPORT and false-negative CONTRADICT closely. For attribution, measure wrong identity, wrong role, and false sole-credit assignments separately. For citations, assess whether the cited content actually supports the answer claim.

Report confidence intervals and class balance. Aggregate accuracy alone is inadequate when rare failures are costly.

## 5. Ablation and component testing

Compare rule-only and model-assisted classification, duplicate-source detection, primary-source handling, query generation strategies, citation extraction, multilingual processing, contradiction detection, and human adjudication. This helps identify which components improve performance and where they introduce regressions.

## 6. Leakage and contamination controls

Separate development, validation, and held-out test cases. Do not repeatedly optimize prompts against the held-out set. Use time-split tests for changing facts. Record contamination risks. A public benchmark may itself be found by tested models; consider a rolling or restricted subset while preserving documented governance and reproducibility.

## 7. Provider integration tests

For each adapter, test success, malformed/empty/partial output, timeout, rate limit, invalid credentials, policy refusal, cancellation, citation parsing, and budget exhaustion. Verify that errors are not scored as misses. Record supported models/tools, fixture coverage, live-test result, and last verification date.

## 8. Release gates

Before public reliability claims, document dataset size and composition, annotation guidance, reviewer agreement, target metrics/tolerances, validation split, evaluator version, measured results, and limitations. Initial engineering release requires regression cases for all verdict labels, wrong attribution, citation-support mismatch, and provider-unavailable states. Critical regressions block release unless an owner-approved exception is documented.

## 9. Monitoring after launch

Track review overrides, user disputes, unsupported-confidence reports, parsing failures, provider schema changes, and metric drift. Sample outputs for human review with privacy safeguards. Distinguish upstream provider drift from Aporia code regressions.

## 10. Public claims about performance

Any statement such as “X% accurate” must identify task, dataset, sample, labels, date, interval where appropriate, and known limitations. Do not generalize a small curated benchmark to all real-world claims or every AI provider.
