# ADR-009: Derive Evidence Status Deterministically from Human-Recorded Relationships

- Status: Proposed
- Date: 2026-10-28
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-002, ADR-003, ADR-006, ADR-008

## Context

The methodology requires separate supporting, contradicting, qualifying, contextualizing, unavailable, and non-addressing evidence, and it forbids disguising heuristics as AI evaluation. It also requires a controlled proposition status vocabulary. Without a defined aggregation step, a user or report reader would have to interpret an unordered list of evidence edges, and different interfaces could summarize the same evidence differently.

No provider or language model is available in v0.1. Semantic judgment about whether a passage supports a proposition cannot be automated honestly. The semantic act must therefore be an explicit human classification with a rationale and reviewer. What can be deterministic is how already-classified relationships are summarized.

## Decision

1. Every evidence-to-proposition edge is created by a human reviewer who selects one controlled relation (`SUPPORTS`, `CONTRADICTS`, `QUALIFIES`, `CONTEXTUALIZES`, `DOES_NOT_ADDRESS`, or `UNAVAILABLE`) and supplies a rationale. The relationship records the reviewer and creation time. Corrections supersede the prior edge with a new edge and a review event; history is retained.
2. A pure function (`deriveEvidenceStatus`, rule version `evidence-aggregation-v1`) summarizes the active relationships for one proposition using this precedence:
   - No active relationships → `NOT ASSESSED`.
   - At least one `SUPPORTS` and at least one `CONTRADICTS` → `CONFLICTING EVIDENCE`.
   - At least one `CONTRADICTS` and no `SUPPORTS` → `CONTRADICTED`.
   - At least one `SUPPORTS` and at least one `QUALIFIES` → `PARTIALLY SUPPORTED`.
   - At least one `SUPPORTS` and no `CONTRADICTS` or `QUALIFIES` → `SUPPORTED WITHIN SCOPE`.
   - At least one `QUALIFIES` and no `SUPPORTS` or `CONTRADICTS` → `PARTIALLY SUPPORTED`.
   - Only `UNAVAILABLE` edges → `UNAVAILABLE`.
   - Only `CONTEXTUALIZES` and/or `DOES_NOT_ADDRESS` edges → `INSUFFICIENT EVIDENCE`.
3. The rule emits counts, a plain-language rationale, source-count caveats, and notes when all supporting evidence is self-published, user-supplied, or duplicated from one source. It does not weight source types, assign confidence probabilities, or collapse the result into a score.
4. A human may record a versioned proposition assessment that selects any controlled status and supplies a rationale. The explicit assessment is displayed as the reviewed conclusion alongside—not instead of—the derived rule output. Later assessments append new versions; earlier versions remain visible. Reports show both and identify the method (`RULE` or `HUMAN`).
5. Source quality, independence, identity, and attribution remain separate descriptive records and are not silently converted into verdict weights.
6. Any change to precedence, vocabulary, or rule version requires a methodology update, regression tests, and a new ADR.

## Alternatives considered

1. **Language-model evidence assessment.** Rejected for v0.1 because no provider integration is permitted and unvalidated semantic judgments would be presented as evaluation.
2. **A single human-entered status with no derivation.** Rejected because it would lose consistent summarization of the recorded edges and make omissions easier.
3. **Majority vote or weighted source score.** Rejected because source independence and quality cannot be reduced to fixed weights, and ADR-003 prohibits unsupported composite scoring.
4. **Treating “no supporting evidence” as `CONTRADICTED`.** Rejected: absence of evidence is not contradiction, and provider/source failure must not become a negative factual verdict.
5. **Automatic keyword matching.** Rejected because lexical overlap does not establish material support and would be misleading evidence analysis.

## Consequences and trade-offs

- Summaries are transparent and reproducible for the same recorded relationships and rule version.
- The quality of the result depends on human classification quality; reports must state this and preserve rationales.
- `SUPPORTED WITHIN SCOPE` can be reached from a single supporting source. The rationale and source caveats must make the evidence boundary visible; the label is explicitly not universal proof.
- The rule treats counts of relationships as diagnostic only; duplicate evidence can inflate counts, so reports include distinct-source counts and independence caveats rather than a strength score.
- Human and rule conclusions can disagree. The UI and report must show the disagreement instead of hiding it.

## Security, privacy, safety, and evaluator-validity implications

- Human reviewers are named by operator-supplied labels; v0.1 does not authenticate identity, so reviewer labels are assertions, not verified identities.
- Rationales and excerpts may contain sensitive material; local storage and explicit project export/deletion controls apply.
- No semantic claim is made about evidence truth. Reports must distinguish recorded classification from independent verification.
- Contradictory evidence remains visible and cannot be deleted through the relationship workflow; corrections supersede with history.

## Implementation and migration plan

1. Add controlled vocabularies and validators in the evaluator core.
2. Implement `deriveEvidenceStatus` as a pure function with no I/O.
3. Persist relationships, review events, and versioned proposition assessments.
4. Display derived and human conclusions together in the UI and reports.
5. Version reports with `evidence-aggregation-v1`.

## Tests and validation required

- Unit tests for every precedence branch, including contradictory evidence, qualifying evidence, unavailable-only, non-addressing-only, and empty sets.
- Tests proving support and contradiction coexist and are never silently merged.
- Tests proving a human assessment is versioned, not overwritten.
- Tests proving duplicate-source caveats are emitted and no numeric confidence is produced.
- Report regression cases covering disagreement between derived and human conclusions.
