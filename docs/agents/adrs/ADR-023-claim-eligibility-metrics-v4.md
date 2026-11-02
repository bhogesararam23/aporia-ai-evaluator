# ADR-023: Gate Claim-Level Metrics on Relevance and Version the Result as `metrics-v4`

- Status: Proposed
- Date: 2026-11-02
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-018, ADR-019, ADR-021, ADR-022

## Context

`metrics-v3` (ADR-019) records two independent things about every answer statement: a **relevance**
drawn from `CLAIM_RELEVANCES`, and one **label per axis** — fidelity, attribution, and support on each
citation mapping. The implementation documented a rule it did not enforce.
`src/core/claimMetrics.ts` computed `isAssertingRelevance(claim.relevance)` and used the result only to
raise a footnote, while the denominators were driven entirely by the stored label. Four defects follow
from that single omission, all of which were reproduced in code before this decision was written:

1. A statement recorded as `REFUSAL` with a stored `ACCURATE` fidelity assessment entered the fidelity
   denominator and counted as an accurate factual statement. The same path fed
   `claimContradictionRate` and `claimUnsupportedRate`, which share that denominator.
2. A claim-to-citation mapping stayed countable as valid support after the cited record was voided.
   Both metric-assembly sites filtered on `supersededBy === null` and consulted nothing else.
3. A proposition link with `OMITS_TARGET` entered the relevant-omission measure regardless of the
   statement's relevance, so an unrelated statement could manufacture an omission.
4. Voided statements were dropped by two independent callers without producing an exclusion reason,
   so a report showed a narrowed denominator and could not say why.

The product's founding distinctions make this more than a numerical tidy-up. AGENTS.md and the
Evaluator Methodology state that a refusal is not a factual denial and that an omission is not a
false assertion. A metric that scores a refusal as accurate contradicts the claim the product makes
about itself.

Two further findings shaped the scope. `partiallyDecomposedObservations` counted answers whose
recorded statements were part-way through *assessment*, and the report described it as the answer
being "only partially decomposed" — reviewer effort rendered as an apparent statement about the AI.
And because the eligibility rules change which statements belong in a denominator, a stored
`metrics-v3` report no longer matches what current code would produce from the same rows.

## Options considered

**Option A — keep the label authoritative and validate on entry only.** Cheapest: the form refuses an
inconsistent pairing and the calculation is untouched. Rejected. A stored database can predate any
validation rule, and restore, migration, or a future scripted write can carry an inconsistent row
that the metric would then score. The comment in `claimMetrics.ts` already asserted relevance was
authoritative; leaving the calculation inconsistent with the schema keeps two claims alive at once.

**Option B — make relevance authoritative everywhere, including the calculation, and version the
result.** Accepted. One contract, evaluated in the pure metric function, enforced again at the form,
again in the repository, and again in SQLite triggers. Because the figures change, `metrics-v4` is a
new version and stored `metrics-v1` through `metrics-v3` snapshots are rendered from the JSON they
were written with.

**Option C — recompute historical snapshots under the new rules.** Rejected outright. ADR-013 and
ADR-019 make stored reports immutable records of what was claimed at the time. Recalculating would
silently rewrite a published figure, which is the failure mode the version constant exists to prevent.

**Option D — require every affected mapping to be superseded before a citation can be voided.**
Considered for the citation lifecycle and rejected. It deletes the reviewer's record of what was
believed before the withdrawal, and it turns a void into a cascade of edits the operator may not
understand. Chosen instead: the mapping survives and is excluded with a named reason,
`CLAIM_CITATION_VOIDED`, so the history stays inspectable and the current figure stays clean. New
mappings to a voided citation remain impossible — that direction has no history to protect.

## Decision

1. **Relevance is authoritative on whether an assertion exists.** The label describes only what was
   asserted about it. A non-asserting relevance — `UNRELATED`, `AMBIGUOUS`, `REFUSAL`, `ABSTENTION`,
   `OMISSION`, `UNAVAILABLE`, `DOES_NOT_ADDRESS`, `NOT_ASSESSABLE` — keeps the statement out of the
   fidelity, attribution and citation-support denominators whatever was recorded against it.
2. **Every exclusion names its kind.** Eight reasons were added so a report can distinguish a refusal
   from an unrelated row, and a voided statement from an unassessed one. An excluded unit with no
   reason is treated as a defect, not a rounding detail.
3. **A label that overstates its relevance is reported as a conflict**, `CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE`,
   and counted in `labelConflictClaims`. It is never resolved by preferring either field, because the
   operator needs to correct the record rather than watch the number move.
4. **Consistent is not the same as scorable.** `NOT_ASSESSABLE` is reachable from an asserting
   relevance and stays out of the denominator, so an unjudged statement widens the recorded unknowns
   instead of pulling a rate down.
5. **Voided statements are passed to the calculation and excluded there.** The report and retest paths
   no longer keep private filters over the same rows, which is what allowed them to drift.
6. **Proposition relations are checked as a pair with relevance.** `OMITS_TARGET` is reachable only
   from `PARTIALLY_ADDRESSES` and `OMISSION`, so an unrelated statement cannot create an omission, and
   `NOT_ASSESSABLE_TARGET` stays reachable from everywhere so an honest unknown is always available.
7. **The contract is enforced at four layers** — the pure function, the form validator, the repository
   transaction, and SQLite triggers in migration `010`. The triggers only speak when the value belongs
   to its own axis, leaving vocabulary membership to the checks that already owned it and produced a
   clearer message.
8. **Review progress is named for the work it measures.** `partiallyDecomposedObservations` becomes
   `partiallyAssessedObservations`, and the block carries the separate counts a reader needs:
   statements recorded, how many carry fidelity and attribution assessments, and how many citation
   mappings carry a recorded support label.
9. **`metrics-v4` under `report-template-v4`.** Historical versions stay renderable. The new fields are
   optional on read, and the statement list falls back to the `citationSupports` shape a v3 file
   actually stored.

## What this does not establish

- **No evaluator accuracy is claimed.** This fixes internal consistency, not correspondence with the
  world. Accuracy still requires a genuinely reviewed corpus, which does not exist in this repository
  (see ADR-020 and `docs/evaluator/BENCHMARKING_AND_VALIDATION.md`).
- **Reviewer identity is still operator-asserted.** There is no authentication; nothing here verifies
  that a label came from a particular person.
- **`NOT_ASSESSABLE` remains a recorded unknown.** Choosing it is not a negative verdict and is not
  counted as one.
- **A recorded contradiction is not a finding that no contrary source exists**, and an omission is a
  visibility gap rather than a factual error.
- **The permitted-pairing tables are a design judgement.** They are readable in
  `src/core/claimEligibility.ts` and restated in migration `010`, and a test compares the two so a
  change on one side cannot pass unnoticed. A stricter or looser table is a decision an owner may
  want to revise; the mechanism for keeping both copies honest is the part that should not change.

## Implementation note

`tests/unit/claim-eligibility.test.ts` exercises the tables against the vocabulary rather than a
chosen example, so a new relevance value cannot arrive without a permitted set on every axis.
`tests/integration/schema-evaluator-integrity.test.ts` parses the migration's own SQL arms and
compares them to the TypeScript tables, then writes rows straight through the schema to prove the
database refuses what the code refuses. `tests/unit/report-compatibility.test.ts` stores a v3-shaped
report whose fidelity figures are impossible under v4 and asserts the rendered page prints what was
recorded beside what current code would produce for the same statements.
