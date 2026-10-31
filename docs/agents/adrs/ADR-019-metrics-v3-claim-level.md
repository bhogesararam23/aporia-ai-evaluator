# ADR-019: Add Claim-Level Metrics as `metrics-v3` and Preserve `metrics-v1`/`metrics-v2`

- Status: Proposed
- Date: 2026-11-01
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-003, ADR-013, ADR-014, ADR-015, ADR-018

## Context

ADR-018 introduces answer-claim records. Turning those records into numbers is a change of metric
semantics, not an addition of fields:

- the **unit** changes from "eligible completed observation" to "assessed answer claim within an
  eligible completed observation";
- the **denominator** changes because a partially decomposed answer would otherwise over- or
  under-state the result;
- new states exist that have no observation-level equivalent — recorded omissions, refusals to
  assert, shared citations, and not-assessable statements.

Local core already has a precedent for this. `metrics-v1` counted query rows for coverage;
ADR-014 changed the unit to intent groups and created `metrics-v2` rather than silently editing the
v1 meaning. Stored report snapshots are immutable and are rendered from the JSON they were written
with (ADR-013). A report generated under `metrics-v2` must keep meaning what it meant.

Two options are therefore open, and the choice matters for reproducibility:

1. Add claim-level fields to the existing `metrics-v2` result object.
2. Introduce `metrics-v3` as a new version, and keep `metrics-v2` producing exactly what it
   produces today.

Option 1 would let a reader of a stored snapshot confuse a number produced before claim
decomposition with one produced after it, because the same version label would cover two different
definitions. That is precisely the failure ADR-014 was written to prevent.

## Decision

1. **The current metrics output becomes `metrics-v3` by extension, not by mutation.** `computeRunMetrics`
   keeps every existing field, definition, numerator, denominator, and exclusion reason unchanged and
   with its current meaning. The version string emitted for a newly generated report becomes
   `metrics-v3`. No field is removed, renamed, or redefined relative to `metrics-v2`.
2. **`metrics-v3` adds a `claimLevel` block alongside, not inside, the observation-level rates.** The
   new block is optional on the result type, so a `metrics-v2` result remains a structurally valid
   `metrics-v3`-shaped object with the block absent.
3. **Claim-level metrics are stated per run, with a decomposition-completeness guard.** The added
   measures are:
   - `claimFidelityRate` — claims whose latest fidelity assessment is `ACCURATE` over claims with a
     definitive fidelity assessment, excluding `OMITTED`, `REFUSED`, `UNAVAILABLE`,
     `NOT_ADDRESSED`, and `NOT_ASSESSABLE`;
   - `claimContradictionRate` — claims assessed `CONTRADICTED` over the same denominator, reported
     separately so a favourable fidelity rate cannot hide recorded contradictions;
   - `claimUnsupportedRate` — claims assessed `UNSUPPORTED` over the same denominator;
   - `claimCitationSupportRate` — claim-to-citation mappings whose latest support assessment is
     `SUPPORTS` over mappings with a definitive assessment. `SUPPORTS_WITH_CONDITIONS` and
     `PARTIALLY_SUPPORTS` are counted in the denominator and broken out separately, never folded
     into "supported";
   - `claimAttributionRate` — claims whose latest attribution assessment is `CORRECT` over claims
     with a definitive attribution assessment, with `WRONG_ROLE`, `AMBIGUOUS`,
     `FALSE_SOLE_CREDIT`, `COLLABORATIVE_PARTIAL`, and `INCORRECT` broken out separately;
   - `relevantOmissionRate` — propositions in the run's project that a claim explicitly relates to
     as an omission, over propositions with at least one claim relation in an eligible observation.
     This is a visibility gap measure, not a factual-accuracy measure;
   - `decompositionCoverage` — eligible observations with at least one answer claim over eligible
     observations, reported next to every claim-level rate.
4. **Partial decomposition is disclosed, never smoothed over.** When an eligible observation has
   claims but some of its claims are unassessed, the observation still contributes its assessed
   claims, and `partialDecompositionObservations` is counted so the reader can see that claim-level
   denominators are narrower than the answer set. No claim-level rate may be presented without the
   decomposition-coverage figure in the same view.
5. **Claims are counted once per current revision.** A superseded revision's assessments remain
   readable in history but do not enter any numerator or denominator, so editing a statement cannot
   double-count it.
6. **Refusal, abstention, omission, and unavailability are never negative factual verdicts.** They
   appear in their own breakdown buckets and in the exclusion list with an explicit reason. A run
   containing only refusals produces a `null` claim-fidelity rate, not `0`.
7. **No composite score and no cross-dimension arithmetic.** Claim-level fidelity, citation support,
   and attribution remain separate measures; nothing averages them, and observation-level rates are
   never blended with claim-level rates.
8. **Historical snapshots are untouched.** Reports store the metrics version that produced them.
   The report renderer must display `metrics-v1` and `metrics-v2` snapshots with their original
   numbers, must render the claim-level block only when present, and must label its absence as
   "claim-level metrics were not recorded for this snapshot" rather than as zero or as a gap in the
   data.
9. **Comparison is version-aware.** Run comparisons remain limited to identical query-set and
   configuration, and additionally must not present a claim-level delta between a run whose
   observations have no claims and a run whose observations do, because the change may reflect
   decomposition effort rather than answer behaviour. Non-comparability in that case is stated as a
   reason, not silently allowed.
10. **The methodology and metrics documents are updated in the same change** as the code, and the
    decision is recorded here because it changes stored data semantics.

## Alternatives considered

1. **Extend `metrics-v2` in place.** Rejected: it would make stored snapshots ambiguous, which is
   the specific failure ADR-014 already guards against.
2. **Replace observation-level metrics with claim-level metrics.** Rejected: observation-level rates
   exist for answers that were never decomposed, and stored reports depend on them. The milestone
   requires historical compatibility.
3. **Derive one headline "claim accuracy" score.** Rejected by ADR-003; it would hide whether a low
   score came from contradiction, missing evidence, or an unassessed statement.
4. **Weight claims by length or sentence count.** Rejected: arbitrary, unjustified, and unauditable.
5. **Count propositions rather than claims for omissions.** Rejected as the primary measure, because
   one proposition can be omitted by several answers; the proposition-level view is retained as the
   denominator for `relevantOmissionRate` and is labelled as such.
6. **Recompute old reports under v3.** Rejected by ADR-013.
7. **Bootstrap confidence intervals over claim counts.** Rejected for now: purposive manual samples
   with correlated repeats do not support them. A future interval needs a justified method and
   sample size, per the benchmarking document.

## Consequences and trade-offs

- Two families of fidelity numbers now exist for one answer, and they can disagree. That is real:
  an answer can be non-committally accurate as a whole while containing one contradicted statement.
  The report presents both, labelled.
- Denominators get small quickly. Rates with a denominator of 1 or 2 must render with their counts
  visible so a reader cannot mistake them for stability.
- Version proliferation is a maintenance cost. It is the accepted cost of reproducibility, and the
  version list stays short: `metrics-v1`, `metrics-v2`, `metrics-v3`.
- Claim-level metrics depend entirely on operator decomposition discipline; the
  decomposition-coverage figure exists to stop a well-decomposed answer set from looking like a
  general result.
- The benchmark framework (ADR-020) is the only route to any accuracy claim about these numbers.
  Implementing `metrics-v3` does not validate it.

## Security, privacy, safety, and evaluator-validity implications

- Claim-level rates describe captured, human-decomposed statements under recorded conditions. They
  are not provider-quality measures and must not be presented as such.
- `relevantOmissionRate` names what an answer failed to say. It is an observation about a captured
  response under one configuration, not a claim that the fact is unavailable elsewhere.
- Because decomposition is human work, claim-level numbers carry a reviewer-labour dependency that
  observation-level numbers do not. The UI must show `decompositionCoverage` beside every
  claim-level rate.
- No new outbound access, no new identity claim, and no new persistence of credentials is involved.

## Implementation plan

1. Add `METRICS_VERSION_V2` retention and set the emitted version to `metrics-v3`.
2. Extend `RunMetricsInput` with an optional claim collection and add the `claimLevel` block to the
   result type, with new exclusion reasons.
3. Implement the rates behind the new input so that an absent collection yields the block being
   absent, not empty zeros.
4. Wire the report builder to load claim data for finalized runs only.
5. Render the block in the report view, the metric table, and the CSV export, with counts visible.
6. Add version-aware comparison handling.
7. Update `docs/evaluator/IMPLEMENTED_METRICS_V2.md` with a v3 section, or add an
   `IMPLEMENTED_METRICS_V3.md` and index it.

## Tests and validation required

- A `metrics-v2` shaped input produces byte-identical observation-level output to the pre-change
  code, with the version string as the only difference.
- A stored `metrics-v1` and a stored `metrics-v2` snapshot both still render their original values
  and are not recomputed.
- A run with claims produces every claim-level rate with numerator, denominator, exclusions, and
  breakdown.
- A run with no claims produces no claim-level block, not zeros.
- `REFUSAL`/`ABSTENTION`/`OMISSION`/`UNAVAILABLE` claims are excluded with named reasons and never
  enter a fidelity numerator.
- `SUPPORTS_WITH_CONDITIONS` appears in the citation denominator and breakdown but not the
  numerator.
- Superseded revisions do not double-count.
- Partial decomposition raises `partialDecompositionObservations` and leaves the assessed claims in
  the denominator.
- Comparing a decomposed run with a non-decomposed run reports a non-comparability reason for the
  claim-level metrics.
- Denominator zero yields `null`, and the CSV export renders it as an explicit "not available".
