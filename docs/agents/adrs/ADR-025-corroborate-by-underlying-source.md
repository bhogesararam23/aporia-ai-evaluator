# ADR-025: Count Corroboration by Underlying Source, Not by Evidence Record (`evidence-aggregation-v2`)

- Status: Proposed — **not implemented**
- Date: 2026-11-02
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-009, ADR-015, ADR-019, ADR-022, ADR-023

## Context

`deriveEvidenceStatus` (`src/core/evidence.ts`, rule version `evidence-aggregation-v1`) decides whether
recorded relationships support, contradict, qualify or leave a proposition unresolved, and its result is
stored in every report snapshot ever generated. For corroboration it counts **distinct `sourceId` values
among the active supporting relationships**. Independence is consulted in one place only: a
self-published source is caveated rather than ignored.

That leaves a hole the benchmark work found directly. A benchmark case can express syndication — the same
material carried by two publishers, recorded as two evidence items with two different source ids and
`independence: 'RELATED'` — and the scorer treats those as one underlying source, because
`benchmark-case-v2` added `sourceId` precisely to say which underlying source an evidence record came
from (`tests/unit/benchmark-source-identity.test.ts` proves both halves). The deterministic rule inside the
application has no such field: two records with different source ids count as two sources no matter what
their independence says. So the tool that judges an answer can see a duplicate, while the rule that
summarizes the reviewer's own evidence cannot.

The consequence is the one this product is most careful about: apparent corroboration. Two syndicated
copies of one press release read as two independent supports, which raises a proposition from
`PARTIALLY_SUPPORTED` or `INSUFFICIENT_EVIDENCE` toward `SUPPORTED_WITHIN_SCOPE` on the strength of a
single underlying source. Nothing in the report says so, because the rule's own output does not know it
happened.

This was written down rather than fixed while the v0.4 milestone was open, for the reason ADR-019 and
ADR-023 established: `evidence-aggregation-v1` is a versioned rule whose verdicts are already embedded in
stored snapshots. Silently redefining it would make an old report mean something its author did not record.

## Decision (proposed, not made)

Introduce `evidence-aggregation-v2` in which corroboration is counted by **underlying source**, with
independence as the gate:

1. Two relationships support each other's corroboration claim only when their sources are distinct by
   identity — the same `canonicalUri`, or an explicitly recorded shared underlying source, counts once.
2. A relationship whose source is recorded `RELATED` never adds to the distinct-source count. It still
   records what the reviewer observed and still appears in the report; it simply cannot corroborate.
3. `UNKNOWN` independence behaves as it does today for the status itself, and the existing
   "cannot distinguish duplicate/syndicated copies from genuinely independent reporting" caveat is
   attached whenever the distinct-source count would have been higher under rule v1. A reader must be able
   to see that the two rules disagree.
4. New reports carry `evidenceRuleVersion: 'evidence-aggregation-v2'`. A snapshot storing `v1` renders the
   status it was written with and is never recomputed, exactly as `metrics-v1` to `v3` snapshots are
   handled now.
5. The rule stays pure, deterministic and dependency-free, and its precedence order over
   contradict/qualify/support/unavailable is unchanged. Only the corroboration count changes.

## Consequences

- Some propositions will move from "support recorded within scope" to "partial support recorded", and a
  small number from supported to insufficient, wherever a reviewer recorded syndicated material as if it
  were independent. That is the defect being corrected, and it will make existing projects look less
  corroborated than they did.
- Reports must show which rule version produced a status, and where `v1` and `v2` disagree about a
  proposition that disagreement should be visible rather than quietly resolved.
- The website-audit side keeps its own independence caveats; this decision changes no discoverability
  check.
- No new vocabulary is required. `SOURCE_INDEPENDENCE` already has `INDEPENDENT`, `SELF_PUBLISHED`,
  `RELATED` and `UNKNOWN`, and the benchmark layer already distinguishes an evidence record from its
  underlying source.

## Implementation would require

1. Owner acceptance of this ADR, or a revision of it, because it changes the meaning of a stored verdict.
2. `EVIDENCE_RULE_VERSION` in `src/core/versions.ts` bumped to `evidence-aggregation-v2`, with `v1`
   retained wherever the metric versions are listed, and the snapshot renderer honouring it.
3. A versioned entry point so a stored snapshot can still be re-derived under the rule that produced it,
   the way claim-level metrics keep `metrics-v3` readable.
4. Tests that would fail against `v1`: two `RELATED` records with distinct source ids corroborate once;
   the same canonical URI recorded twice corroborates once; `UNKNOWN` independence produces the caveat and
   the lower confidence, not the benefit of the doubt; a stored `v1` snapshot still renders its recorded
   status.
5. A migration-free change — no column and no stored row is touched — and a check that the backup
   manifest still validates, since the rule version travels in the snapshot rather than the schema.

## Explicitly out of scope

This ADR records a proposal and changes no code. `evidence-aggregation-v1` remains the implemented rule as
of local core v0.4, with the limitation stated in `docs/KNOWN_LIMITATIONS.md` and named in the test that
documents it. No benchmark dataset, provider integration, remote fetch, publication path or authentication
is introduced by any option considered here.
