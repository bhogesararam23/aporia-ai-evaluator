# ADR-015: Evidence Labels Describe Recorded Relationships, Not Verified Truth

- Status: Proposed
- Date: 2026-10-30
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-002, ADR-006, ADR-009, ADR-014

## Context

Aporia stores evidence-to-proposition relationships chosen by a human reviewer. v0.1's controlled vocabulary describes several outputs in language that can be read as an independent verification: `CONTRADICTED` says "at least one credible recorded source materially conflicts", source independence is displayed simply as "Independent", and the report places these labels next to human assessments. A source's independence is a reviewer judgment, not something Aporia checks; the application has no credibility scoring, no source authentication, and no remote retrieval. The distinction matters for attribution and achievement records, where a reader could otherwise treat a recorded relationship as corroborated fact.

## Decision

1. Status identifiers remain unchanged for persistence and historical snapshots. Human-facing labels and descriptions change to state the provenance:
   - `CONTRADICTED` is displayed as "Contradiction recorded".
   - `CONFLICTING_EVIDENCE` says "Recorded support and recorded contradiction coexist; the conflict is unresolved unless a human assessment adjudicates it."
   - `SUPPORTED_WITHIN_SCOPE` says "Recorded supporting evidence only, within the stated scope. This is not independent verification."
   - `PARTIALLY_SUPPORTED`, `INSUFFICIENT_EVIDENCE`, `UNAVAILABLE`, and `NOT_ASSESSED` descriptions name the recorded relationships and their limits.
2. Source independence values remain `INDEPENDENT`, `SELF_PUBLISHED`, `RELATED`, and `UNKNOWN`, but the UI label for `INDEPENDENT` becomes "Recorded as independent" and its description states that the reviewer recorded the relationship and Aporia has not verified it. The source form explains that independence is not credibility, verification, or a guarantee of accuracy.
3. Every derived evidence summary includes a standing caveat: it summarizes human-recorded relationships and is not independent verification. The caveat is emitted by the rule and stored in report snapshots, so it remains visible in exports.
4. Aporia does not introduce a credibility score, a source-quality weight, or an "independently verified" label. A primary source can be authoritative about what it published without independently confirming the truth of its claims.
5. Human proposition assessments remain separate and primary; the rule output remains visible alongside them. Disagreement is not resolved by the rule.
6. Historical snapshots keep their stored strings and labels. The clarification applies to new renderings and new snapshots; a stored v1 report is not rewritten.
7. Any future change to the precedence rule still requires a methodology update and a new ADR. This ADR changes wording and visibility, not precedence.

## Alternatives considered

1. **Rename status identifiers.** Rejected: it would break stored snapshots, exports, and the controlled vocabulary, for no gain over clearer labels.
2. **Add a credibility score or source rank.** Rejected: source quality is contextual, the application has no validated calibration, and a weight would create a false composite.
3. **Remove independence from the source form.** Rejected: reviewers need to record their judgment; the problem is the display claiming more than the record supports.
4. **Say nothing and rely on the methodology document.** Rejected: the UI and report are where a reader encounters the label; a caveat only in a separate document is not visible at the point of use.

## Consequences and trade-offs

- Some labels become longer. That is deliberate: the label is the claim.
- Existing tests that assert old wording must be updated to assert the provenance wording.
- A reader may still misread the label; the caveat, description, and evidence links are repeated in the report and achievement preview rather than hidden behind a tooltip.
- The rule's status logic is unchanged, so `evidence-aggregation-v1` remains the rule version; the clarification is a display and documentation change. New report snapshots record the caveat text as part of the derived status notes.

## Tests and validation required

- A derived status for each precedence branch contains the standing recorded-evidence caveat.
- `CONTRADICTED` and `SUPPORTED_WITHIN_SCOPE` labels and descriptions do not contain the words "credible", "verified", or "independent corroboration" as an assertion about Aporia's own checking.
- The source independence label and help text state "recorded" and disclaim verification.
- A report snapshot keeps the caveat and renders it; an older stored snapshot still renders its original text.
- No code path emits a credibility score, verification badge, or "independently verified" label.
