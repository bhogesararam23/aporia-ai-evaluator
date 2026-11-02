# ADR-024: Bind Retest Statuses to Their Comparison, Persist the Focus Metric, and Version Comparability

- Status: Proposed
- Date: 2026-11-02
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-013, ADR-019, ADR-021, ADR-023

## Context

ADR-021 sets out two rules that the v0.3 implementation did not hold.

**A measured status needs the measurement behind it.** `transitionFinding` checked that *some* stored
comparison on the finding had an outcome compatible with the requested status, then wrote whatever
`comparisonId` the caller supplied into the history row without checking it. Four things were therefore
unverified about a cited comparison: that it exists in the project, that it belongs to this finding,
that its outcome is the one being claimed, and that it is the comparison the transition was actually
about. The only schema protection was a bare foreign key, so a comparison from another project
satisfied it. Nothing in the interface showed the citation either: the history panel rendered sequence,
statuses, timestamp, actor and note, and the report mapped the id to a positional index over the
finding's own comparisons — so a foreign id silently became `-1`, and `comparisonIndex` was never
rendered anywhere. The defect could not be seen and could not be refused.

**The focus metric has to survive.** ADR-021 says one selected metric decides the outcome. That choice
was written only into the audit event's `details` JSON, under the finding's id. No column, no blob, and
no code path read it back — `mapComparison`, `ComparisonRecord`, the report snapshot and the finding
page all omitted it. The record of *why* a finding was called improved was therefore recoverable only
by a JSON query nobody performs.

Two related findings came from the same audit. `recordRetestComparison` inserted the caller's
`comparable`, `outcome`, `reasons` and `deltas` exactly as supplied; the HTTP route recomputed them
honestly, which left the trust boundary in the wrong place — an internal contract with no enforcement
and no test that ever called it with a hand-made preview. And `comparabilityReasons` compared seven
declared fields while ignoring `runs.conditions`, a required, immutable, operator-authored field whose
help text on the capture form says it holds "logged-in state, tools, account plan, interface language,
and anything else that could affect results". Two runs were declared comparable on evidence that did
not cover the thing the operator recorded as capable of changing results. There was also no identifier
for which comparability rule produced a stored verdict, while reports carry `metrics_version` for
exactly that purpose.

## Options considered

**Binding the citation.** Rejected: validating only in the route, because a restore or a script bypasses
a route. Rejected: inferring the comparison from its outcome, because "some row says UNCHANGED" is what
produced the original defect — the status then has no identifiable evidence. Chosen: the cited comparison
must be one of this finding's, must carry the claimed outcome, and must be named in the history row,
enforced in the application and in SQLite.

**Persisting the focus metric.** Rejected: leaving it in the audit event, because audit rows are keyed
to the finding and nothing reads that detail. Rejected: marking the focus row inside `deltas_json`,
because a verdict cannot be recovered from a decoration on the numbers that produced it. Chosen: real
columns on the comparison — the metric id, its display label, the comparability rule version, and the
metrics version each side was computed under.

**Who computes the comparison.** Rejected: keep the caller-supplied preview and re-validate it inside
the transaction, because it means maintaining two derivation paths and a "verify" step that can drift
from the thing it verifies. Chosen: the write accepts only two run ids and one metric, and recomputes
the comparison from the persisted runs inside its own transaction. A fabricated outcome becomes
unrepresentable rather than detectable.

**Comparability and `conditions`.** Rejected: silently continuing to ignore it. Rejected: a fuzzy
similarity test on free text, because "close enough" is not a rule anyone can audit. Chosen: exact
equality as `comparison-rule-v2`, with the exclusions and their reasons stated in code.

## Decision

1. `recordRetestComparison(db, projectId, findingId, { baseRunId, laterRunId, focusMetric }, context)`
   — the signature carries no derived data. The comparison is recomputed from stored runs inside the
   write transaction.
2. `retest_comparisons` gains `focus_metric`, `focus_label`, `rule_version`, `base_metrics_version` and
   `later_metrics_version`. Migration `011_retest_provenance.sql` is additive and applies constraints to
   new writes only.
3. A measured status must cite a comparison that is on the same finding, in the same project, and
   carries that outcome. `UNABLE_TO_VERIFY` must cite the comparison that could not verify it. Enforced
   in `transitionFinding` and by five triggers.
4. `comparison-rule-v2` adds the recorded conditions to the seven declared fields. `comparison-rule-v1`
   remains a known identifier; a stored row's own `rule_version` says which produced it, and
   comparability can still be evaluated under it.
5. The finding page shows the focus metric, its earlier and later value with numerator and denominator,
   the direction, every other metric as context, the comparability failures, and the causal boundary. The
   history row shows the comparison it cites.
6. `COMPARABILITY_EXCLUSIONS` states, in code, which run metadata is deliberately outside the rule and
   why — capture window, free-text notes, sample size, query text inside an approved set, and the
   metrics version.

## Historical rows

Rows written before this change keep `NULL` in the five new columns, and that is left as it is. They
were produced under `comparison-rule-v1` and never recorded their deciding metric. Backfilling either
would invent data: an imputed focus metric would be a guess about somebody's intent, and an imputed
rule version would claim a rule the row was not produced by. The finding page says so in those words.
The same applies to stored report snapshots, which continue to render from the JSON they were written
with (ADR-013, ADR-023).

## Consequences

- A v0.3 history row that cited nothing while asserting `IMPROVED` stays exactly as recorded. The rule
  applies to new writes, so an audited history cannot be rewritten to look compliant.
- The transition form now offers the finding's own comparisons as a choice with their outcomes and
  values visible, because a citation an operator cannot see is a citation they cannot get right.
- Two runs captured under different recorded conditions can no longer be called comparable. Operators
  who previously recorded incidental prose in `conditions` will have to reconcile it or accept
  `NOT_COMPARABLE`. That is the intended cost: the field said it recorded things that change results.
- Free-text equality is brittle by design. It fails toward "not comparable", which is the safe
  direction for a claim about change over time.

## What this does not establish

- **No causal claim.** A comparison is an association between two captures. The boundary sentence is
  stored with every comparison and rendered beside it.
- **No independent verification.** Run configuration labels are typed by the operator; the rule compares
  strings, so an unchanged label over a silently changed underlying system still reads as comparable.
- **No evaluator accuracy.** Recomputing a comparison makes the record self-consistent. It says nothing
  about whether the metrics measure what they claim (ADR-020, ADR-023).
- **Owner approval is still outstanding.** ADR-021 through ADR-023 remain Proposed, and this record
  does not accept them.
