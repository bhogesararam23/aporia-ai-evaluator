# ADR-021: Persist Remediation Findings With an Explicit Lifecycle and a Guarded Retest Comparison

- Status: Proposed
- Date: 2026-11-01
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-003, ADR-010, ADR-013, ADR-018, ADR-019

## Context

`buildRemediation` in `src/reporting/snapshot.ts` already derives up to forty
`RemediationSuggestion` objects from recorded gaps: claims without propositions, unassessed
propositions, unresolved contradictions, human/rule disagreement, untested query intents, empty
metric denominators, blocking HTML-audit findings, and absent independent corroboration. Those
suggestions are computed into a report snapshot and then die there. Nothing in local core lets an
operator say "I accept this, I own it, I am working on it, and here is what the next measurement
showed".

`docs/evaluator/REMEDIATION_AND_LONGITUDINAL_RETESTING.md` specifies the missing workflow and names
the trap that makes it delicate: a later observation that looks better is not evidence that a
website change caused it. Any implementation that shows a before/after arrow invites a causal
reading the product explicitly refuses.

The existing comparison machinery is a good foundation and an incomplete one. `buildComparisons`
already restricts comparison to runs sharing a query-set id and provider/model/interface/grounding/
locale/region configuration, and labels deltas "descriptive associations". But it lives inside a
snapshot, only covers finalized runs, has no claim-level awareness, and cannot be reached on its own
to answer "did this specific finding change?".

## Decision

1. **Findings are persisted, project-scoped records.** `remediation_findings` stores a stable
   identifier, a per-project human-readable reference (a monotonically increasing per-project number
   rendered as `F-0001`), title, the observed issue, supporting-evidence narrative, cause class,
   severity with a mandatory rationale, recommended action, owner label, current status,
   first/last observed timestamps, and creation/update metadata. Owner is an operator-asserted label
   and must be described as such: local core has no accounts.
2. **Findings reference records by typed link, not by embedded copy.** `finding_references` attaches
   a finding to claims, propositions, queries, runs, observations, answer claims, citations, and
   website audits, each validated by trigger to belong to the finding's project. A finding created
   from a report suggestion carries the suggestion id so the derivation is traceable. Referenced
   records are never duplicated into the finding, so a superseded claim cannot make a historical
   finding silently describe different content — the reference points at the id, and the UI shows
   the current revision with an explicit "record has changed since" note when it has.
3. **Status is a controlled lifecycle with a declared transition graph.** `FINDING_STATUSES` are
   `OPEN`, `ACCEPTED`, `IN_PROGRESS`, `AWAITING_EXTERNAL_CHANGE`, `RETEST_REQUIRED`, `IMPROVED`,
   `UNCHANGED`, `REGRESSED`, `UNABLE_TO_VERIFY`, `CLOSED_WITH_RATIONALE`, `WONT_FIX`. Transitions are
   enforced by trigger. Terminal outcomes (`CLOSED_WITH_RATIONALE`, `WONT_FIX`) require a rationale.
   `IMPROVED`, `UNCHANGED`, `REGRESSED`, and `UNABLE_TO_VERIFY` are outcomes of a retest and may only
   be set by a retest comparison, never by free editing, so a finding cannot be marked improved
   without a measurement.
4. **Every update is an append-only event.** `finding_updates` records the actor label, timestamp,
   previous status, new status, note, and optional comparison reference. The finding row keeps a
   current view for rendering; the event log is the history. Updates are transactional with their
   audit event.
5. **Retest comparison is a first-class read over stored runs.** A comparison names a base run and a
   later run, and reports:
   - the comparability verdict, using the existing identical query-set plus configuration rule, now
     extracted into a shared helper so the report and the retest workflow cannot drift apart;
   - the specific conditions that broke comparability, each stated in plain language;
   - per-metric before/after/delta for observation-level metrics, and per-metric before/after/delta
     for claim-level metrics when both sides have claim data;
   - claim-level coverage on both sides, because a change in decomposition effort is not a change in
     answer behaviour;
   - an explicit causal-boundary statement.
6. **Comparison result drives status, not the other way round.** Setting `IMPROVED`, `UNCHANGED`,
   `REGRESSED`, or `UNABLE_TO_VERIFY` requires a stored comparison. A non-comparable pair may only
   produce `UNABLE_TO_VERIFY` with the reason recorded. `UNABLE_TO_VERIFY` is never rendered as
   "fixed".
7. **No causation language anywhere in the workflow.** Copy uses "the later observation recorded
   X"; the UI states that provider, model, interface, retrieval, and environmental conditions outside
   Aporia's control may have changed, and that a website edit and a better answer are an association.
8. **No scheduling and no new measurement.** Creating `RETEST_REQUIRED` records an intent. It does
   not schedule anything, does not call a provider, and does not fabricate a follow-up run. The
   operator must capture a genuine later observation under a cloned query set, exactly as the
   existing manual-capture rule requires.
9. **Findings appear in reports without changing historical reports.** The report snapshot gains a
   `findings` section listing current status and the update log at generation time. Stored snapshots
   are never rewritten; a report generated before this change simply has no findings section, and
   the renderer distinguishes "absent from this snapshot" from "no findings exist".
10. **Template version bump.** Because the report gains a section, `report-template-v3` becomes the
    current template for newly generated reports, and the v2 template rendering path stays intact.

## Alternatives considered

1. **Keep suggestions transient and treat the report as enough.** Rejected: it is the specific gap
   the milestone names, and it makes progress untrackable.
2. **Model a finding as a generic task/ticket with due dates and assignees.** Rejected: it drifts
   toward project management rather than evaluation, invites a false promise of accountability, and
   needs accounts that local core does not have.
3. **Copy referenced record text into the finding at creation.** Rejected: it freezes interpretation
   silently and makes it impossible to notice that the underlying record was later revised.
4. **Let the operator freely set `IMPROVED`.** Rejected: that is how a tool manufactures its own
   success story. Requiring a stored comparison is the guardrail.
5. **Compute deltas across any two runs and let the user judge.** Rejected: ADR-013 already restricts
   this, and mixing non-comparable pairs would produce numbers with no meaning.
6. **Add a scheduled retest or a monitoring job.** Rejected: prohibited for this milestone and
   requires provider integration.
7. **Reuse `audit_events` as the finding history.** Rejected: audit events are a coarse project log;
   finding transitions need their own ordering, previous/new status, and comparison linkage.
8. **Store findings inside the report snapshot.** Rejected: findings outlive one report and are
   updated between reports.

## Consequences and trade-offs

- The status graph is a maintenance surface. Adding a status requires a transition rule, a
  description, and a report-rendering path.
- Comparability is often denied in practice, because providers and interfaces change. The workflow
  must stay useful when the honest answer is "cannot verify", and `UNABLE_TO_VERIFY` must be a
  respectable state rather than a failure state.
- Typed references mean a deletion cascade removes finding references; the finding body survives
  only if it was not project-deleted, and project deletion still removes the local trail (ADR-012).
- Bumping the report template version is churn, but a new required section is exactly what the
  version field exists to record.

## Security, privacy, safety, and evaluator-validity implications

- Owner and actor labels are asserted, not authenticated. Neither proves who acted, and no view may
  describe a finding as independently reviewed or approved.
- Findings may record that an answer got a fact wrong about a real person. The narrative fields are
  plain escaped text, are local, and are included in exports; sharing remains an operator judgement.
- Severity is a human classification with a mandatory rationale, so a low justification cannot hide
  behind a numeric-looking label.
- The retest workflow must not become a way to quietly replace an inconvenient earlier measurement:
  base and later runs are immutable, and both are shown.

## Implementation plan

1. `src/core/findings.ts` — statuses, transition graph, cause classes, severities, human
   descriptions.
2. Shared comparability helper extracted from `buildComparisons` and used by both the report and the
   retest view.
3. Migration `009_remediation.sql` — findings, references, updates, triggers, per-project numbering.
4. Repository: create, transition, reference, update log, comparison persistence, listing.
5. Routes and views: finding list/detail, create-from-suggestion, status transitions, retest
   comparison page.
6. Report snapshot `findings` section and `report-template-v3`.
7. Backup counts for the new tables.

## Tests and validation required

- Each legal transition succeeds and each illegal transition is refused by trigger.
- `IMPROVED`/`UNCHANGED`/`REGRESSED` cannot be set without a stored comparison.
- A non-comparable pair cannot produce `IMPROVED`; it yields `UNABLE_TO_VERIFY` with the reason.
- A reference to another project's claim, proposition, run, observation, or answer claim is refused.
- Finding updates are append-only and atomic with their audit event.
- Report generation before any finding exists still succeeds and renders an explicit "no findings
  recorded" state; a stored `report-template-v2` snapshot still renders unchanged.
- Deltas render with counts and the causal-boundary statement.
- Per-project finding numbering is monotonic and unique, and does not reuse a number after deletion.
- Backup/restore preserves findings, references, update history, and status exactly.
- Project deletion cascades findings and their update log.

## Amendment (2026-11-02, local core v0.4)

Item 10 overstated the version change. `report-template-v3` had already been introduced by
[ADR-019](ADR-019-metrics-v3-claim-level.md) inside the same unreleased milestone, when the report
gained its statement-level block. The findings section did not create a template version; it joined
`report-template-v3`, and both sections shipped together under it. The decision to bump the template
when a report gains a section stands, and no earlier wording is being rewritten here — this note
records that the described bump was not a new version at the time it was written.

Two further things are true now, and they are recorded rather than assumed:

- `report-template-v4` is the current template for newly generated reports as of local core v0.4,
  because the report renders the claim-eligibility exclusions and the review-progress counts
  ([ADR-023](ADR-023-claim-eligibility-metrics-v4.md)). A stored `report-template-v1`, `v2` or `v3`
  snapshot still renders the figures it was written with and is never recomputed.
- The guard in item 7 and the "one selected metric determines the outcome" rule are now durable
  rather than only computed at view time: the focus metric, its label, both runs' metric versions and
  the comparison rule version are stored beside the comparison, the comparison is recomputed from the
  persisted runs inside the write transaction, and a measured status is accepted only when the cited
  comparison belongs to that finding and carries that outcome — enforced in the repository and by
  SQLite triggers ([ADR-024](ADR-024-retest-provenance-and-comparability.md)).

Status remains **Proposed**. This amendment does not accept the decision; owner review is still
pending.
