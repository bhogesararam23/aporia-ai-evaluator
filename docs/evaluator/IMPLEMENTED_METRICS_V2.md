# Implemented Metrics v2 — Intent-Group Coverage

- Status: Implemented and unit-tested locally; not empirically calibrated
- Date: 2026-10-30
- Supersedes for **new reports**: [Implemented Metrics v1](IMPLEMENTED_METRICS_V1.md)
- Rule version: `evidence-aggregation-v1` (unchanged)
- Metric version: `metrics-v2`
- Code: `src/core/metrics.ts`, `src/core/versions.ts`
- Tests: `tests/unit/metrics.test.ts`, `tests/unit/reporting-snapshot.test.ts`
- Decision: [ADR-014](../agents/adrs/ADR-014-metrics-v2-intent-coverage.md)

This document records the metric change shipped in local v0.2. Every metric other than observed
answer-level coverage is unchanged from v1 and is still defined in
[Implemented Metrics v1](IMPLEMENTED_METRICS_V1.md). Historical reports remain readable under their
stored `metrics-v1` identity and are never recomputed.

## 1. Why the unit changed

The v1 document already defines observed answer-level coverage in **query intents**. The v1 code
counted query rows. A query set can contain several prompts for one intent (for example, three
discovery phrasings); those rows were counted separately. That inflated the denominator, let one
covered phrasing look like partial coverage of an intent, and hid intent groups that were never
tested at all. Partial assessment within a group was also invisible: a group with one assessed and
one unassessed eligible observation looked fully assessed.

## 2. The v2 unit: the intent group

Queries are grouped by their controlled `intent` value (`IDENTITY`, `DESCRIPTION`,
`FACTUAL_VERIFICATION`, `DISCOVERY`, `SOURCE_SEEKING`, `COMPARISON`, `ATTRIBUTION`,
`TIME_SENSITIVE`, `OTHER`). All queries with the same intent are one coverage unit.

| group state | condition |
|---|---|
| `UNTESTED` | no eligible completed observation exists for any query in the group |
| `TESTED_UNASSESSED` | at least one eligible observation exists, but none has a presence assessment |
| `TESTED_COVERED` | at least one eligible observation's latest presence assessment is `MENTIONED` |
| `TESTED_NOT_MENTIONED` | at least one eligible observation is assessed, and none is `MENTIONED` |

An eligible observation is a non-voided, `COMPLETED` observation in a finalized report, as in v1.
`NOT_ASSESSABLE` presence is not an assessed presence result.

### Partial assessment

When a group has some eligible observations with a presence assessment and some without, the group
remains in the denominator under the v1 wording ("at least one eligible observation and an assessed
presence result"). v2 marks `partialAssessment: true` and reports both `presenceAssessed` and
`unassessedEligibleObservations`. The metric notes state how many groups were partially assessed.
The unassessed observations are not silently treated as complete.

## 3. The coverage metric

- **Numerator:** intent groups with status `TESTED_COVERED`.
- **Denominator:** `TESTED_COVERED` + `TESTED_NOT_MENTIONED` groups.
- **Exclusions:** `UNTESTED` groups → `QUERY_UNTESTED`; `TESTED_UNASSESSED` groups →
  `QUERY_PRESENCE_UNASSESSED`.
- **Unit:** query intents (groups).
- **Value:** numerator / denominator, or `null` when no group has an assessed presence result.
- **Breakdown:** covered and tested-not-mentioned group counts.
- **Notes:** partial-assessment count, unit statement, denominator rule, and the retrieval caveat.

Query-row counts remain in `coverage.byQuery` and `plannedQueries`/`testedQueries`/`untestedQueries`
for drill-down. They are labeled as query rows, not as the metric unit.

## 4. Worked examples

### Repeated intent

Queries: `q1` and `q2`, both `DISCOVERY`. `q1` has a `MENTIONED` observation; `q2` is untested.

- `plannedQueries = 2`, `untestedQueries = 1`
- `plannedIntents = 1`, `untestedIntents = 0`
- group status `TESTED_COVERED`
- coverage = `1 / 1 = 100%`

The untested sibling query remains visible in the query-row detail and the group's
`untestedQueries = 1`. It does not turn the intent into an untested group.

### Untested group

Queries: `q1` (`DISCOVERY`, mentioned) and `q2` (`COMPARISON`, no observation).

- `plannedIntents = 2`, `untestedIntents = 1`
- coverage = `1 / 1 = 100%` with one `QUERY_UNTESTED` exclusion
- the `COMPARISON` group is `UNTESTED`

### Partial assessment

Queries: `q1` and `q2`, both `DISCOVERY`. `q1` is `MENTIONED`; `q2` has an eligible observation
with no presence assessment.

- group status `TESTED_COVERED`
- `presenceAssessed = 1`, `unassessedEligibleObservations = 1`, `partialAssessment = true`
- coverage = `1 / 1 = 100%`, with a note that the group was partially assessed

### Mention and non-mention in one group

Two `DISCOVERY` observations, one `MENTIONED` and one `NOT_MENTIONED`: the group is
`TESTED_COVERED`, denominator 1, numerator 1. The observation-level mention rate remains `1 / 2`;
the two units answer different questions.

## 5. Versions and historical reports

- New runs and reports carry `metrics-v2`.
- Stored `metrics-v1` snapshots keep their numerator, denominator, value, definition, and notes.
  The report renderer does not recompute them and does not require v2 fields.
- The report template version becomes `report-template-v2` for new snapshots. The report schema
  remains `report-snapshot-v1`; the intent-group fields are optional so an older snapshot is still
  valid.
- The report JSON and CSV exports include the new intent-group data when present.

## 6. What did not change

- Mention, target/any citation, citation support, claim fidelity, attribution correctness, exclusion
  taxonomy, and eligibility rules are unchanged.
- No composite score, confidence interval, or provider-normalized probability is introduced.
- `evidence-aggregation-v1` is unchanged.

## 7. Change control

Any further change to the coverage unit, a denominator, an exclusion, or a status label requires a
methodology update, regression tests, a new metric version, and an ADR. Historical snapshots are
never recalculated under a newer version.
