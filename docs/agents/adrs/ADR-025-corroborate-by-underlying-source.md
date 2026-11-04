# ADR-025: Count Corroboration by Underlying Source, Not by Evidence Record (`evidence-aggregation-v2`)

- Status: Proposed — **rule implemented and tested, not the application default**. `evidence-aggregation-v2`
  now exists in `src/core/evidence.ts` behind the versioned `deriveEvidenceStatus(relationships, ruleVersion)`
  entry point and is covered by `tests/unit/evidence-aggregation-v2.test.ts`. `EVIDENCE_RULE_VERSION` still
  resolves to `evidence-aggregation-v1`, so no live report, claim view, achievement or stored snapshot
  changes until the owner accepts this ADR and flips the default. Acceptance remains the owner's decision.
- Date: 2026-11-02
- Decision owners: Project owner (rule implemented on delegated authority; acceptance and the default change pending owner review)
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

## Implementation status against this ADR

The engineering the ADR described is now in place, held behind the versioned rule so it changes no
verdict until the owner accepts it:

1. **Pending — the owner's, not made here.** Acceptance of this ADR, because the corroboration figure
   travels in report snapshots and flipping the default changes what new reports claim.
2. **Done.** `EVIDENCE_RULE_VERSION_V2 = 'evidence-aggregation-v2'` and `KNOWN_EVIDENCE_RULE_VERSIONS`
   exist in `src/core/versions.ts`; `EVIDENCE_RULE_VERSION` remains `v1`, so the default does not move.
3. **Done.** `deriveEvidenceStatus(relationships, ruleVersion)` is the versioned entry point. A stored
   snapshot recorded under either rule can be re-derived under the rule that produced it, and an
   unrecognised version is refused rather than silently falling back.
4. **Done — §1 rule 1 (shared underlying source).** `underlyingSourceIdentity` in `src/core/evidence.ts`
   gives a conservative identity for the source behind a record: a full `canonicalUri` is normalised
   (scheme and host lower-cased, default port and a leading `www.` dropped, fragment and tracking query
   parameters removed, remaining parameters sorted, a trailing path slash stripped, path case preserved),
   and a missing or unparseable URI falls back to the record's own `sourceId` so nothing merges on a
   guess. Under `v2` supporting records are grouped by that identity, so two source records that reach
   the same document collapse to one corroborating source; `v1` still counts distinct `sourceId`s. The
   identity is available to the whole path — `activeRelationshipsForProposition`, the achievements
   evidence query and the report snapshot mapper now carry the source `canonicalUri` into
   `EvidenceRelationshipRecord`. An explicitly recorded shared underlying source beyond `canonicalUri`
   (a dedicated source-identity column) is deliberately not invented here; it would need its own schema
   change and ADR.
5. **Done — §1 rule 2 and §3.** `tests/unit/evidence-aggregation-v2.test.ts`,
   `tests/unit/source-identity.test.ts` and `tests/integration/repositories-evidence.test.ts` hold the
   cases that fail against `v1`: a `RELATED` record never adds a source; two records sharing one
   canonical URI corroborate once; genuinely distinct URIs stay separate; a `null`/unparseable URI falls
   back to the source id; `UNKNOWN` independence keeps its caveat without the benefit of the doubt; the
   status precedence is unchanged; the `apparentCorroboratingSourceCount` field names the `v1` figure so
   a reader sees where the two rules disagree; and the DB-to-core read path delivers the collapse.
6. **Done.** The change is migration-free — no column, no stored row — because the rule version travels
   in the snapshot, so the backup manifest is unaffected.

## Explicitly out of scope

This ADR is still **Proposed**: the default rule is unchanged and no existing verdict is recomputed.
`evidence-aggregation-v1` remains the rule the application applies to new reports as of local core v0.4,
with the limitation stated in `docs/KNOWN_LIMITATIONS.md`. Accepting this ADR is a single, atomic change to
`EVIDENCE_RULE_VERSION`, which every call site reads through that one constant. No benchmark dataset,
provider integration, remote fetch, publication path or authentication is introduced by any option here.
