# ADR-014: Measure Observed Answer Coverage by Query Intent Group

- Status: Proposed
- Date: 2026-10-30
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-003, ADR-010, ADR-013, ADR-009

## Context

The implemented metrics document defines observed answer-level coverage with **query intents** as its unit: query intents with an eligible mentioned observation over query intents with an eligible assessed presence result. The v0.1 implementation instead iterates over each query row. A query set may contain several prompts for one intent (for example three discovery phrasings). Those repeats are counted as separate units, so one covered prompt among three inflates the rate to 1/3 or 2/3 depending on which prompts were tested, rather than describing the one intent.

Two further cases are not represented honestly:

- **Untested groups.** If every query for one intent is untested, the report shows untested query rows but no intent-group statement. A reader cannot see which investigation purposes were never exercised.
- **Partial assessment.** An intent group can have several eligible observations where only some have a presence assessment. v0.1 silently treats "at least one assessed" as a fully assessed group; the unassessed observations disappear from the coverage narrative.

This is a material semantic change to a metric. Historical reports must remain interpretable under the version they used.

## Decision

1. Coverage is computed over **intent groups**, keyed by the controlled `QueryIntent` value. Multiple queries with the same intent belong to one group. Per-query detail remains available for inspection but does not define the metric unit.
2. Each intent group receives:
   - `TESTED_COVERED` when at least one eligible observation has a latest presence assessment of `MENTIONED`;
   - `TESTED_NOT_MENTIONED` when at least one eligible observation is assessed and none is `MENTIONED`;
   - `TESTED_UNASSESSED` when the group has eligible observations but none has an assessed presence result;
   - `UNTESTED` when the group has no eligible observation.
3. The coverage numerator is the number of `TESTED_COVERED` groups. The denominator is the number of `TESTED_COVERED` plus `TESTED_NOT_MENTIONED` groups. `UNTESTED` groups are excluded with `QUERY_UNTESTED`; `TESTED_UNASSESSED` groups are excluded with `QUERY_PRESENCE_UNASSESSED`.
4. A group with some assessed and some unassessed eligible observations remains in the denominator, because the documented unit enters on "at least one assessed" observation. The group carries `partialAssessment: true` and both counts, so the partial state is visible rather than silently treated as complete.
5. The run coverage report adds group-level counts and a per-intent breakdown: planned, tested, untested, covered, assessed, unassessed, and partially assessed groups. Query-level counts remain for drill-down and are labeled as query rows, not intent groups.
6. The metric version becomes `metrics-v2`. `metrics-v1` remains a recognized historical version. Report snapshots continue to store the metric version that produced them and are never recomputed. The report template may render new optional fields only when present; v1 snapshots keep their stored values and their original meaning.
7. The rule change requires a methodology/documentation update, a regression test for each case below, and no retroactive rewriting of stored reports.

## Alternatives considered

1. **Keep counting query rows and rename the unit.** Rejected: the methodology and product requirement name query intents; renaming the unit to hide a mismatch would weaken the documented meaning.
2. **Deduplicate identical query text only.** Rejected: repeated phrasings for one intent still measure one investigative purpose, and the `intent` field exists to express that grouping.
3. **Count every observation as the unit.** Rejected: this would make repeated samples of one prompt dominate coverage and confuse coverage with mention rate.
4. **Treat any partial assessment as unassessed.** Rejected: the documented denominator admits a group with an assessed result; excluding it would understate tested coverage. Visibility is the correct remedy.
5. **Recompute historical reports under v2.** Rejected by ADR-013 and the reproducibility requirement.

## Consequences and trade-offs

- Coverage denominators change for query sets with repeated intents. New reports will state `metrics-v2`; old reports remain valid under `metrics-v1`.
- Grouping can hide that only one of three phrasings was tested; the per-query detail and `untestedQueries` counts remain visible to prevent that.
- The coverage metric can remain `null` when no group has an assessed result, even if many observations exist; that is the honest unknown state.
- The report and UI must label query-level and intent-level counts distinctly.

## Tests and validation required

- Repeated intents: two `DISCOVERY` queries with one covered and one untested produce one covered intent group, not 1/2.
- Untested groups: a group with no eligible observations is `UNTESTED`, increments `untestedIntents`, and is excluded with `QUERY_UNTESTED`.
- Partial assessment: a group with one assessed and one unassessed eligible observation is in the denominator and carries `partialAssessment: true` with both counts.
- Mixed groups: one mentioned and one not-mentioned observation in the same group yields `TESTED_COVERED` for the group and retains both observation counts.
- Historical snapshots: a stored `metrics-v1` snapshot still renders its original numerator, denominator, and value after the code change.
- Empty input: no groups and no observations produce a `null` value, not zero.
