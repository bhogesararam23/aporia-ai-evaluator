# Implemented Metrics v3 — Claim-Level Answer Evaluation

- Status: Implemented in local core v0.3; validated by `tests/unit/claim-metrics.test.ts`
- Date: 2026-11-01
- Version string: `metrics-v3`
- Related: [Implemented Metrics v2](IMPLEMENTED_METRICS_V2.md), [Evaluator Methodology](EVALUATOR_METHODOLOGY.md), [ADR-018](../agents/adrs/ADR-018-answer-claim-decomposition.md), [ADR-019](../agents/adrs/ADR-019-metrics-v3-claim-level.md)

This document records the exact numerators, denominators, exclusions, and unknowns for the measures
`metrics-v3` adds. It does not restate the observation-level rates; those keep the meaning given in
[Implemented Metrics v2](IMPLEMENTED_METRICS_V2.md) and are unchanged.

## 1. Version boundary

| Version | What it produced | Status |
| --- | --- | --- |
| `metrics-v1` | Observation-level rates with coverage counted per query row | Historical. Stored snapshots render their own numbers. |
| `metrics-v2` | Same, with coverage counted per query-intent group (ADR-014) | Historical for new reports; stored snapshots unchanged. |
| `metrics-v3` | `metrics-v2` output, plus an optional `claimLevel` block | Current. |

No `metrics-v2` field was renamed, removed, or redefined to produce `metrics-v3`. A stored snapshot
is rendered from the JSON written with it and is never recomputed, so a report generated under
`metrics-v1` or `metrics-v2` continues to mean exactly what it meant when it was generated.

## 2. Units

Every claim-level measure states its unit explicitly, because assuming "observations" would misread
all of them:

Claim-level metric identifiers are prefixed `answer_` so they can never collide with an
observation-level identifier. The pre-existing whole-answer `claim_fidelity_rate` measures
observations, and the new `answer_statement_fidelity_rate` measures statements; sharing an id would
put two different numbers in the same CSV column with the same name.

| Unit | One unit means |
| --- | --- |
| `answer statements` | One factual statement the reviewer recorded from a captured answer, at its current revision |
| `claim-citation mappings` | One judgement about whether one cited material supports one recorded statement |
| `propositions` | One target proposition of the project that at least one recorded statement relates to |
| `observations` | One non-voided, completed captured answer (the existing observation-level unit) |

Superseded revisions never enter a numerator or denominator. Their assessments remain readable in
the review history, so correcting a statement cannot double-count it.

## 3. Eligibility gate

A statement is scored only if its observation is eligible under the existing observation-level rule:
not voided, and status `COMPLETED`. Statements recorded against a refusal, an abstention, an error, a
blocked capture, a timeout, or an unavailable route are excluded with
`CLAIM_OBSERVATION_INELIGIBLE`. Those statements stay in the database and stay visible in the review
history; they simply do not produce numbers.

## 4. Whether a statement asserts anything

The reviewer's relevance label governs. `ADDRESSES`, `PARTIALLY_ADDRESSES`, `QUALIFIES`, and
`CONTRADICTS` are asserting. `DOES_NOT_ADDRESS`, `AMBIGUOUS`, `UNRELATED`, `REFUSAL`, `ABSTENTION`,
`OMISSION`, `UNAVAILABLE`, and `NOT_ASSESSABLE` are not.

Proposition relations do **not** override this. A refusal can legitimately be linked to the
proposition it refused, and letting that link pull the refusal into a fidelity denominator would
turn a refusal into a de facto factual verdict — the specific error the product rules forbid.

## 5. The claim-level measures

### 5.1 `answer_decomposition_coverage` — Answer decomposition coverage

- **Numerator** — eligible observations with at least one recorded statement.
- **Denominator** — eligible observations.
- **Excluded** — statements on ineligible observations, with `CLAIM_OBSERVATION_INELIGIBLE`.

This figure must be read before any other claim-level rate. A run where the reviewer decomposed one
answer out of twenty produces a decomposition coverage of 1/20 and claim-level denominators drawn
from that one answer only. An observation with no statements contributes to the denominator; that is
not evidence the answer was wrong.

The block also reports `observationsWithClaims`, `eligibleObservations`,
`partiallyDecomposedObservations`, and `unassessedClaims` as plain counts.

### 5.2 `answer_statement_fidelity_rate` — Statement fidelity rate

- **Numerator** — statements whose latest fidelity assessment on the current revision is `ACCURATE`.
- **Denominator** — statements with a definitive fidelity assessment: `ACCURATE`,
  `PARTIALLY_ACCURATE`, `CONTRADICTED`, or `UNSUPPORTED`.
- **Excluded with a reason** — `OMITTED` (`CLAIM_OMITTED`), `REFUSED` (`CLAIM_REFUSED`),
  `UNAVAILABLE` (`CLAIM_UNAVAILABLE`), `NOT_ADDRESSED` (`CLAIM_NOT_ADDRESSED`),
  `NOT_ASSESSABLE` (`CLAIM_NOT_ASSESSABLE`), and no assessment at all
  (`CLAIM_FIDELITY_UNASSESSED`).
- **Breakdown** — the four definitive labels, counted separately.

`ACCURATE` means accurate against the evidence the reviewer recorded, within the scope the reviewer
recorded. It is not a claim that the statement is independently proven or universally true.

`UNSUPPORTED` means the recorded evidence does not bear on the statement. It is deliberately inside
the denominator as a non-accurate outcome and outside the numerator, and it is reported separately so
an evidence gap cannot be mistaken for a contradiction.

### 5.3 `answer_statement_contradiction_rate` and `answer_statement_unsupported_rate`

- **Numerators** — statements assessed `CONTRADICTED`, and statements assessed `UNSUPPORTED`.
- **Denominator** — the same definitive-fidelity denominator as `answer_statement_fidelity_rate`.

These exist so a favourable fidelity rate cannot conceal recorded contradictions, and so an evidence
gap is reported at its own size rather than folded into accuracy or error.

### 5.4 `answer_statement_citation_support_rate` — Statement citation support rate

- **Numerator** — claim-to-citation mappings assessed `SUPPORTS`.
- **Denominator** — mappings with a definitive assessment: `SUPPORTS`, `PARTIALLY_SUPPORTS`,
  `SUPPORTS_WITH_CONDITIONS`, `DOES_NOT_SUPPORT`.
- **Excluded with a reason** — `UNCLEAR` (`CLAIM_CITATION_UNCLEAR`), `METADATA_MISSING`
  (`CLAIM_CITATION_METADATA_MISSING`), `NOT_ASSESSABLE` (`CLAIM_CITATION_NOT_ASSESSABLE`), and
  statements with no mapped citation (`CLAIM_NO_MAPPED_CITATION`).
- **Breakdown** — all four definitive values.

Partial support and conditional support are in the denominator and broken out separately; they are
never counted as supported. One citation mapped to several statements is assessed once per statement,
so a shared citation stays visible instead of being averaged. A statement with no citation is not a
citation failure — it is an absence, and it is reported as such.

### 5.5 `answer_statement_attribution_rate` — Statement attribution rate

- **Numerator** — statements assessed `CORRECT`.
- **Denominator** — statements with a definitive attribution assessment: `CORRECT`,
  `PARTIALLY_CORRECT`, `WRONG_ROLE`, `WRONG_PERSON`, `AMBIGUOUS`, `COLLABORATIVE_PARTIAL`,
  `FALSE_SOLE_CREDIT`, `UNATTRIBUTED`, `INCORRECT`.
- **Excluded with a reason** — `NOT_ADDRESSED` (`CLAIM_ATTRIBUTION_NOT_ADDRESSED`) and
  `NOT_ASSESSABLE` (`CLAIM_ATTRIBUTION_NOT_ASSESSABLE`), plus statements with no assessment
  (`CLAIM_ATTRIBUTION_UNASSESSED`).
- **Breakdown** — every definitive label, so wrong role and false sole credit are visible on their
  own.

`UNATTRIBUTED` is inside the denominator on purpose: a statement that asserts a contribution while
naming nobody is a credit claim with a missing subject, and excluding it would make the rate look
better than the answer was. `NOT_ADDRESSED` stays outside, because silence about credit is not
incorrect credit.

### 5.6 `relevant_omission_rate` — Relevant omission rate

- **Numerator** — distinct propositions that at least one recorded statement relates to as
  `OMITS_TARGET`.
- **Denominator** — distinct propositions that any recorded statement relates to at all.
- **Excluded** — when the denominator is empty, `CLAIM_NO_PROPOSITION_RELATION` is reported and the
  value is `null`.

The unit is the proposition, so several answers omitting the same fact counts once. This measures
what the captured answers left unsaid. It is not a factual-accuracy measure, and it is not a claim
that the omitted fact is unavailable elsewhere. A proposition no statement relates to at all is
absent from this measure, not silently counted as omitted.

## 6. What the software judges, and what it only counts

This distinction matters for anyone reading a benchmark result.

Local core contains exactly **one automatic judgement**: the `evidence-aggregation-v1` rule, which is
a documented, versioned precedence over relationships a human already recorded. Every other
claim-level value in this document is a **human assessment the software stores and counts but never
makes**:

| Measure | Who produced the label |
| --- | --- |
| Evidence support per proposition | `evidence-aggregation-v1`, deterministically |
| Statement fidelity | A reviewer |
| Statement citation support | A reviewer |
| Statement attribution | A reviewer |
| Decomposition coverage | A count of what a reviewer chose to decompose |
| Relevant omission rate | A count of what a reviewer chose to record as omitted |

So a change in a fidelity, citation-support, or attribution number means a reviewer labelled
differently, not that the evaluator changed. A change in the evidence-support number means the code
changed. The benchmark harness keeps these in separate sections for exactly this reason; see
[Benchmark Annotation Rubric](BENCHMARK_ANNOTATION_RUBRIC.md).

## 7. Invalid stored labels are reported, not trusted

`metrics-v3` re-checks every label against its dimension on read. A row that carries an attribution
label in the fidelity column — which the schema prevents, but a restored or hand-edited database
might not — is excluded as `CLAIM_LABEL_INVALID` and reported as unassessed. The metrics never
silently accept a value it cannot interpret.

## 8. What is deliberately not computed

- **No composite score.** Nothing averages fidelity, citation support, and attribution, and
  observation-level rates are never blended with claim-level rates (ADR-003).
- **No weighting** by statement length or sentence count. Any such weight would be arbitrary and
  unauditable.
- **No confidence intervals, calibration, or significance tests.** The sample is purposive and
  repeated responses to one prompt are correlated. A future interval needs a justified method,
  sample size, and its own ADR.
- **No cross-run claim-level delta** where one side's answers were not decomposed. A change in
  decomposition effort is not a change in answer behaviour, and the comparison says so.

## 9. Reading these numbers honestly

A claim-level rate with a denominator of 1 or 2 is a description of one or two sentences, not a
property of a provider. Denominators are rendered with their counts wherever they appear. Claim-level
numbers depend on how thoroughly a reviewer decomposed the answers, which is why decomposition
coverage is published beside them and why the block's own notes state the ratio in plain language.

Implementing these measures does not validate them. Until a human-reviewed gold corpus has been run
through the benchmark harness, no accuracy claim about any number here is supportable.

## 10. Code and tests

| Concern | Code | Tests |
| --- | --- | --- |
| Claim-level computation | `src/core/claimMetrics.ts` | `tests/unit/claim-metrics.test.ts` |
| Shared exclusion vocabulary | `src/core/metricsCommon.ts` | `tests/unit/metrics.test.ts` |
| Assembly into the run result | `computeRunMetrics` in `src/core/metrics.ts` | `tests/unit/metrics.test.ts`, `tests/unit/claim-metrics.test.ts` |
| Version constants | `src/core/versions.ts` | `tests/unit/reporting-snapshot.test.ts` |
| Statement records feeding the block | `src/persistence/repositories/answerClaims.ts` | `tests/integration/repositories-answer-claims.test.ts` |
