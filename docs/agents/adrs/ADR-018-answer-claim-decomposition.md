# ADR-018: Decompose Captured Answers into Append-Only Answer Claims

- Status: Proposed
- Date: 2026-11-01
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-002, ADR-003, ADR-006, ADR-009, ADR-010, ADR-013, ADR-019

## Context

Local core v0.1/v0.2 records a captured AI answer as one immutable `observations` row with one
`answer_text`, then attaches up to four observation-level assessment labels (presence, fidelity,
citation support, attribution) and a flat list of `citations`.

That model cannot represent a real answer. A single answer such as:

> "Aram led the project and authored the parser. The system launched in 2021, though some sources
> say 2022. I'm not certain about the funding body."

contains one correct attribution, one date claim with a recorded contradiction, an uncertainty
marker, and an implicit omission. Reducing it to a single `FIDELITY: PARTIALLY_ACCURATE` label
destroys exactly the information the evaluator exists to capture, and makes the citation list
unreadable: one citation may support the launch-date sentence and be irrelevant to the authorship
sentence.

The milestone requirement is therefore a statement-level layer that:

- preserves the exact captured answer and never rewrites it;
- lets the operator record individual factual statements drawn from that answer;
- relates each statement to the project's target propositions, including the cases where the
  statement is unrelated, ambiguous, only partially relevant, an explicit denial, a refusal, an
  abstention, or a relevant omission;
- relates captured citations to the specific statements they appear to support, with support
  assessed per relation rather than per answer;
- assesses attribution per statement rather than per answer;
- corrects statements by supersession rather than edit;
- keeps the observation-level records working exactly as before, because stored `metrics-v1` and
  `metrics-v2` report snapshots interpret them.

## Decision

1. **Answer claims are children of one observation.** A new `answer_claims` row belongs to a
   project and to exactly one non-void observation, and holds a pointer to its current revision.
   The `observations` and `citations` tables are unchanged. The raw answer remains the single
   source of truth and the only place the answer's bytes are stored.
2. **Statement text is revisioned, not edited.** `answer_claim_revisions` is append-only and
   stores: the exact `quote_text` the operator recorded, an ordinal, the capture basis, the
   offset range within the raw answer when it can be established, a free-text `paraphrase` that is
   explicitly labelled as the operator's reading, and creation metadata. Changing a statement
   inserts a new revision and moves `answer_claims.current_revision_id`; the previous revision stays
   readable and its assessments stay attached to it.
3. **Offsets are only claimed when they are verifiable, and a quote is never a paraphrase.**
   `statement_kind` separates the two kinds of text an operator records:
   - `QUOTED` — words the captured answer contained. It must carry a locatable range, so a later
     reader cannot mistake the operator's summary for the model's output.
   - `REVIEWER_DESCRIPTION` — the operator's own words, used for a summary of several sentences and
     for a recorded omission. It must never carry a range, because the answer did not contain them.
   `offset_basis` then records how a `QUOTED` range was established:
   - `EXACT_MATCH` — the quote occurs verbatim in the raw answer and the recorded range is the
     verbatim occurrence, recomputed and checked at write time;
   - `NORMALIZED_MATCH` — the quote matches after Unicode NFKC normalisation and whitespace
     collapsing, with the range recomputed the same way;
   - `NOT_ESTABLISHED` — no reliable range exists, which is the only basis a
     `REVIEWER_DESCRIPTION` may use. Offsets are never inferred from an approximate or edited quote,
     and a mismatch between the recorded range and the raw answer aborts the write.
   Offsets count Unicode code points, not UTF-16 code units, because that is what SQL `substr()` and
   `length()` use. Storing code-unit offsets would have made the database unable to re-verify any
   quote from an answer containing an emoji or other astral character.
4. **Relevance is a separate axis from truth.** `answer_claim_relevance` records, per claim
   revision: `ADDRESSES`, `PARTIALLY_ADDRESSES`, `QUALIFIES`, `CONTRADICTS`, `DOES_NOT_ADDRESS`,
   `AMBIGUOUS`, `UNRELATED`, `REFUSAL`, `ABSTENTION`, `OMISSION`, `UNAVAILABLE`, `NOT_ASSESSABLE`.
   `OMISSION` is a statement the operator records about what the answer failed to say and is
   scored separately from an assertion. Because an omission is by definition not something the
   answer said, `OMISSION` requires `statement_kind = 'REVIEWER_DESCRIPTION'`, enforced by a table
   CHECK. `REFUSAL` and `ABSTENTION` are never negative factual
   verdicts, matching the standing rule that applies to observation statuses today.
5. **Claim-to-proposition links are their own rows.** `answer_claim_propositions` maps a claim
   revision to one proposition with a controlled relation (`SUPPORTS_TARGET`,
   `PARTIALLY_SUPPORTS_TARGET`, `CONTRADICTS_TARGET`, `DOES_NOT_ADDRESS_TARGET`,
   `QUALIFIES_TARGET`, `AMBIGUOUS_TARGET`, `REFUSES_TARGET`, `ABSTAINS_TARGET`,
   `OMITS_TARGET`, `NOT_ASSESSABLE_TARGET`) plus a mandatory rationale. Many-to-many is native:
   one claim revision may link several propositions, and several claim revisions may link one
   proposition. Cross-project links are refused by trigger, following the existing
   `evidence_relationships` pattern.
6. **Claim-to-citation links are their own rows.** `answer_claim_citations` maps a claim revision
   to a citation from the **same observation** and records `support` as `SUPPORTS`,
   `PARTIALLY_SUPPORTS`, `DOES_NOT_SUPPORT`, `SUPPORTS_WITH_CONDITIONS`, `UNCLEAR`,
   `METADATA_MISSING`, or `NOT_ASSESSABLE`, with a mandatory rationale. Citation rows are never
   duplicated per claim; a citation referenced by several claims is referenced by id, so "multiple
   claims share one citation" is visible rather than implicit. A citation being mapped and assessed
   `SUPPORTS` still does not affect fidelity: fidelity is assessed on the claim, citation support on
   the mapping.
7. **Assessment is versioned per claim revision.** `answer_claim_assessments` is append-only with
   `dimension` in `FIDELITY` and `ATTRIBUTION` and a version per (claim, dimension), mirroring
   `observation_assessments`. Citation support is deliberately **not** an assessment dimension: it is
   recorded on the claim-to-citation mapping row (decision 6), because one statement can be supported
   by one citation and contradicted by another, and a single claim-level "citation support" label
   would re-merge exactly what claim-level evaluation exists to separate. Correcting a mapping uses
   the one-way supersession fields that `evidence_relationships` already uses, so the revised
   judgement is a new row and the original stays readable.
   Fidelity labels extend the existing set with `OMITTED`, `REFUSED`, and `UNAVAILABLE`, so that
   "did not say" is never counted as "said wrong". Attribution labels add `WRONG_ROLE`,
   `WRONG_PERSON`, `AMBIGUOUS`, `FALSE_SOLE_CREDIT`, `COLLABORATIVE_PARTIAL`, and `UNATTRIBUTED` to
   distinguish "right person, wrong role" and "shared work claimed as
   sole credit" from a flat `INCORRECT`.
8. **Assessment is allowed while the run is open, and only then.** The claim layer inherits the
   existing rule that observation assessments require an open run, so a finalized run cannot be
   re-judged. This keeps historical report snapshots meaningful.
9. **Nothing retroactive.** Adding the claim layer does not reinterpret `metrics-v1` or
   `metrics-v2` snapshots and does not change observation-level assessment forms. Claim-level
   metrics get their own version — see ADR-019.
10. **Every claim write is transactional with its audit event**, using the existing
    `withTransaction` + `appendAuditEvent` pattern, and the backup manifest counts the new tables.

## Alternatives considered

1. **Add nullable statement columns to `observations`.** Rejected: one answer holds N statements,
   so this needs a 1:N table regardless, and it would blur the immutable raw capture with derived
   interpretation.
2. **Reuse `propositions` and treat each answer statement as a proposition.** Rejected: propositions
   are the *target* under evaluation, defined before the answer was captured. Folding answer
   statements into them would let the observed answer redefine what was being tested, and would
   corrupt the evidence-rule inputs.
3. **Reuse `evidence_relationships` for claim-to-proposition links.** Rejected: that table's
   semantics are "this recorded source excerpt bears on this proposition". An answer statement is
   not evidence; treating it as evidence would let a model's assertion strengthen the evidence-rule
   result.
4. **Store statement text as a JSON array on the observation.** Rejected: no stable per-statement
   identity, so citations, links, assessments, and version history have nothing to attach to, and a
   correction silently rewrites the whole array.
5. **Allow editing a statement in place with an `updated_at`.** Rejected: it breaks the repository's
   standing append-only rule for anything that assessments or reports reference.
6. **Auto-split the answer into sentences programmatically.** Rejected: this milestone has no
   language model, sentence boundaries are not statement boundaries, and a mechanical split would
   imply a decomposition that no human verified.
7. **Let offsets be free-text.** Rejected: an unverifiable offset invites false precision; recording
   the basis and refusing to store an unprovable range is honest.

## Consequences and trade-offs

- Storage grows with the number of statements per answer. Acceptable for a local tool and required
  for traceability.
- Operators must do more work per answer. The UI mitigates this with pre-populated quote selection
  and one form per action; the milestone explicitly requires the real workflow, not only tables.
- A claim with no recorded statement is different from a claim set with a recorded `OMISSION`; both
  must be renderable, and the report must not read "no claims" as "answer was wrong".
- Assessments attached to a superseded revision remain part of history. Current reporting uses the
  current revision's latest assessment per dimension; the history view shows both.
- Offsets computed with normalisation may not round-trip into the operator's original text for
  exotic whitespace. The basis label records this explicitly rather than hiding it.
- Project deletion cascades the new rows, which further reduces the local audit trail already
  disclosed in ADR-012.

## Security, privacy, safety, and evaluator-validity implications

- Quote text is untrusted model output. It is escaped on render exactly like `answer_text`; nothing
  in the claim layer is ever interpreted as markup.
- A citation URL is already validated. Claim-to-citation mapping must not introduce a new URL field
  or a new outbound fetch path; it references an existing citation id only.
- Reviewer labels remain operator-asserted strings. Nothing here constitutes authenticated identity
  or proof of independent review, and the UI must not imply otherwise.
- Recording `FALSE_SOLE_CREDIT` is a claim about an answer's wording, not a legal finding about
  authorship. The vocabulary descriptions must say so.
- No statement extraction may fabricate content. The write path refuses a quote that is not present
  in the raw answer when the basis claims it is.

## Implementation plan

1. Vocabulary, relevance and relation sets, with human descriptions (`src/core/answerClaims.ts`).
2. Input validators, including verbatim/normalised offset resolution.
3. Migration `008_answer_claims.sql`: tables, indexes, append-only triggers, project-scope triggers,
   offset-consistency triggers, open-run triggers.
4. Repository: create/revise claims, add/remove links, record assessments, read a full workspace.
5. Routes and views: observation claim workspace, forms, history, omission affordance.
6. Reporting: claim-level inputs into the snapshot, claim-level metrics under ADR-019.
7. Backup counts and restore verification for the new tables.

## Tests and validation required

- A quote whose recorded range does not match the raw answer is refused for `EXACT_MATCH` and
  `NORMALIZED_MATCH`.
- `NOT_ESTABLISHED` requires null offsets.
- Editing a statement creates revision 2 and leaves revision 1 intact with its assessments.
- A claim linked to another project's proposition is refused by trigger.
- A citation from a different observation cannot be mapped to a claim.
- The same citation mapped to two claims is reported as shared, not duplicated.
- `REFUSAL`, `ABSTENTION`, `OMISSION`, and `UNAVAILABLE` never enter a factual-accuracy numerator.
- Writing a claim assessment on a finalized run is refused.
- Claim creation plus audit event is atomic; a failing link insert rolls back both.
- Voiding an observation prevents new claims; existing claims remain readable.
- Project deletion removes the claim rows and the audit trail together.
- Backup/restore preserves claim revisions, links, assessments, and their version numbers.
