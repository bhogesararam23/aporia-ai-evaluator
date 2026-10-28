# Implemented Metrics and Evidence Rule v1

- Status: Implemented and unit-tested locally; not empirically calibrated
- Date: 2026-10-29
- Rule version: `evidence-aggregation-v1`
- Metric version: `metrics-v1`
- Code: `src/core/evidence.ts`, `src/core/metrics.ts`
- Tests: `tests/unit/evidence.test.ts`, `tests/unit/metrics.test.ts`, `tests/integration/reporting-service.test.ts`

This document records the exact calculations shipped in local v0.1. It does not introduce weights, composite scores, confidence intervals, or provider-normalized probability claims.

## 1. Units and eligibility

Evidence is assessed at the **proposition** level. Answer metrics use **observations** as their unit, and coverage uses **query intents** as a separate unit.

An observation enters answer-level denominators only when:

- its run status is `FINALIZED` in a report (open runs may show a preview in the UI);
- it is not voided;
- its capture status is `COMPLETED` (an answer is available).

`REFUSAL`, `NO_ANSWER`, `ERROR`, `BLOCKED`, `TIMEOUT`, and `UNAVAILABLE` are coverage/exclusion states, never negative mentions or negative factual verdicts.

Supported exclusion reason codes are:

`VOIDED_OBSERVATION`, `PROVIDER_ERROR`, `BLOCKED`, `TIMEOUT`, `UNAVAILABLE_TOOL`, `POLICY_REFUSAL`, `NO_ANSWER`, `PRESENCE_UNASSESSED`, `PRESENCE_NOT_ASSESSABLE`, `FIDELITY_UNASSESSED`, `FIDELITY_NOT_ASSESSABLE`, `CITATION_METADATA_UNAVAILABLE`, `NO_ACTIVE_CITATIONS`, `CITATION_SUPPORT_UNASSESSED`, `CITATION_SUPPORT_NOT_ASSESSABLE`, `ATTRIBUTION_NOT_ADDRESSED`, `ATTRIBUTION_UNASSESSED`, `ATTRIBUTION_NOT_ASSESSABLE`, `QUERY_UNTESTED`, `QUERY_PRESENCE_UNASSESSED`.

Every metric returns:

- its definition and versioned identity;
- a numerator or `null` if there is no eligible numerator;
- a denominator (possibly zero);
- a value as a fraction or `null` when the denominator is zero;
- the exclusion reasons and counts;
- optional label breakdowns;
- notes about interpretation.

A `null` value means **unknown/not defined**, never “zero percent.”

## 2. Evidence rule v1

The evidence rule summarizes human-recorded relationships for one proposition. It does not assess truth by itself.

Precedence:

1. No active relationships → `NOT_ASSESSED`.
2. At least one `SUPPORTS` and one `CONTRADICTS` → `CONFLICTING_EVIDENCE`.
3. At least one `CONTRADICTS` and no `SUPPORTS` → `CONTRADICTED`.
4. At least one `SUPPORTS` and one `QUALIFIES` → `PARTIALLY_SUPPORTED`.
5. At least one `SUPPORTS` and no `CONTRADICTS`/`QUALIFIES` → `SUPPORTED_WITHIN_SCOPE`.
6. At least one `QUALIFIES` and no `SUPPORTS`/`CONTRADICTS` → `PARTIALLY_SUPPORTED`.
7. Only `UNAVAILABLE` edges → `UNAVAILABLE`.
8. Only `CONTEXTUALIZES`/`DOES_NOT_ADDRESS` (optionally with unavailable) → `INSUFFICIENT_EVIDENCE`.

The output contains counts, distinct-source counts, rationale, and caveats for duplicate sources, self-published-only support, unknown independence, unreadable material, and contextual-only material. No source type is weighted.

A human can record an append-only proposition assessment with any controlled status and rationale. The UI and report show the human conclusion as primary and the rule output alongside it. Disagreement is surfaced. Neither conclusion deletes the other.

## 3. Answer metrics

### Mention rate

- **Numerator:** eligible observations with latest presence assessment `MENTIONED`.
- **Denominator:** eligible observations with latest presence assessment `MENTIONED` or `NOT_MENTIONED`.
- **Exclusions:** ineligible observations; `PRESENCE_UNASSESSED`; `PRESENCE_NOT_ASSESSABLE`.
- **Interpretation:** an entity mention does not imply endorsement, recommendation, accuracy, or citation.

### Target-source citation rate

- **Numerator:** eligible observations with at least one active citation marked target-owned.
- **Denominator:** eligible observations whose citation metadata was captured (`CAPTURED`).
- **Exclusions:** ineligible observations; `CITATION_METADATA_UNAVAILABLE` when the interface did not show citations or availability was unknown.
- **Interpretation:** a returned citation does not prove that the cited URL supports every assertion.

### Any-source citation rate

- **Numerator:** eligible observations with at least one active citation of any kind.
- **Denominator:** eligible observations with captured citation metadata.
- **Exclusions:** same citation-metadata exclusions.
- **Interpretation:** citation presence is not citation support.

### Citation support rate

- **Numerator:** observations with latest citation-support assessment `SUPPORTED`.
- **Denominator:** eligible observations with captured citations, at least one active citation, and a definitive assessment (`SUPPORTED`, `PARTIALLY_SUPPORTED`, `NOT_SUPPORTED`).
- **Exclusions:** ineligible observations; citation metadata unavailable; no active citations; unassessed; not assessable.
- **Breakdown:** supported, partially supported, not supported. Partial support is not in the numerator.

### Claim fidelity rate

- **Numerator:** eligible observations with latest fidelity assessment `ACCURATE`.
- **Denominator:** eligible observations with a definitive assessment (`ACCURATE`, `PARTIALLY_ACCURATE`, `CONTRADICTED`, `UNSUPPORTED`).
- **Exclusions:** ineligible observations; unassessed; not assessable.
- **Breakdown:** all definitive labels. Silence and refusals are not scored as incorrect statements.

### Attribution correctness rate

- **Numerator:** eligible observations with latest attribution assessment `CORRECT`.
- **Denominator:** eligible observations with a definitive assessment (`CORRECT`, `PARTIALLY_CORRECT`, `INCORRECT`).
- **Exclusions:** ineligible observations; `NOT_ADDRESSED`; unassessed; not assessable.
- **Breakdown:** correct, partially correct, incorrect.
- **Interpretation:** a name mention is not correct attribution unless the assessed role and source are correct. Roles are stored on attribution assessments.

### Observed answer-level coverage

- **Numerator:** query intents with at least one eligible observation whose latest presence assessment is `MENTIONED`.
- **Denominator:** query intents with at least one eligible observation and an assessed presence result.
- **Exclusions:** `QUERY_UNTESTED`; `QUERY_PRESENCE_UNASSESSED`.
- **Interpretation:** this is observed answer-level coverage, not internal provider retrieval coverage.

## 4. Coverage and exclusions

The run result also reports:

- planned, tested, and untested query counts;
- observations recorded, voided, and eligible;
- per-query observation/eligible/presence counts and status;
- global observation eligibility exclusions with counts;
- metric-specific exclusions with counts and descriptions.

A tested query with no presence assessment is `TESTED_UNASSESSED`; it is not treated as a negative result. A query with no eligible observation is `UNTESTED`.

## 5. No composite score

No weighted or composite score is calculated or displayed. Each metric remains separate. The top-level report is a vector of evidence statuses, discoverability findings, presence/citation/fidelity/attribution metrics, coverage, and uncertainty. Introducing a composite would require a new ADR with calibration, missing-data behavior, and misuse review under ADR-003.

## 6. Sampling and uncertainty

Metrics are descriptive of the captured sample under the recorded conditions. The implementation does not compute confidence intervals because query selection is purposive and repeated responses to one query may be correlated. Reports state this limitation. Provider/model behavior may change; comparisons are limited to identical query-set versions and declared provider configurations and are explicitly descriptive, not causal.

## 7. Worked eligibility example

A finalized run has four observations:

| Observation | Status | Presence | Eligible? |
|---|---|---|---|
| o1 | COMPLETED | MENTIONED | Yes |
| o2 | COMPLETED | NOT_MENTIONED | Yes |
| o3 | ERROR | none | No: `PROVIDER_ERROR` |
| o4 | REFUSAL | none | No: `POLICY_REFUSAL` |

Mention rate = 1 / 2 = 50%. The two excluded observations are reported by reason; they are not counted as “not mentioned.” If o1 also has a captured target-owned citation with a supported citation assessment, the target-source citation rate denominator is based on observations with captured citation metadata, which may differ from the presence denominator.

## 8. Change control

Any change to the precedence rule, status labels, eligibility criteria, numerator, denominator, exclusion taxonomy, or attribution criteria requires a methodology update, regression tests, and an ADR where required by the evaluator methodology. Existing reports retain their version identifiers and stored snapshots.
