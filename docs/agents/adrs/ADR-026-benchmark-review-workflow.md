# ADR-026: Run Benchmark Human Review as Reproducible Offline Artifacts (Packet, Submission, Merge, Review, Audit)

- Status: Proposed — **workflow implemented and tested, not owner-accepted**; additive tooling only
- Date: 2026-11-04
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-020, ADR-022, ADR-015, ADR-025

## Context

ADR-020 built the offline benchmark harness: a versioned case contract (`benchmark-case-v1`/`v2`),
strata coverage, and two scorers that keep deterministic regression apart from methodology agreement.
It was honest that no gold set has been produced, because a gold set can only come from real material a
human actually reviewed and the operator is authorised to store.

What the harness did **not** yet provide is the human-review workflow itself. Today a reviewer would
hand-edit a case JSON file that already contains the gold `expected` labels and any prior annotations,
then commit it. That has three concrete problems:

1. **Anchoring / leakage.** Reviewing against a file that already shows the gold answer, existing
   annotations, or what the evaluator produced biases the reviewer toward agreeing with the tool. It is
   the opposite of an independent human judgement.
2. **Unsafe merge.** There is no gate that refuses a submission aimed at a case whose input changed,
   a second submission from the same reviewer, a submission for the wrong case, or a label outside the
   dimension's vocabulary. Hand-editing lets a bad submission half-apply or overwrite gold silently.
3. **Disagreement becomes a coin-flip.** Nothing separates "two reviewers agree", "one reviewer wrote a
   note", and "reviewers split". A split can get quietly averaged into a gold label, which is exactly
   the fabrication the milestone forbids.

`docs/evaluator/BENCHMARK_ANNOTATION_RUBRIC.md` describes the labelling procedure; it was still marked
current for `benchmark-case-v1`. The workflow this ADR records gives that rubric a reproducible, offline
mechanics that never manufactures a label, a reviewer, a timestamp, a permission, or a gold answer.

## Decision

1. **Introduce workflow *artifact* versions, not a new case-contract version.** The new files — blinded
   packet, reviewer submission, adjudication template, corpus audit — get their own versions in
   `src/benchmark/types.ts` (`benchmark-packet-v1`, `benchmark-submission-v1`,
   `benchmark-adjudication-v1`, `benchmark-audit-v1`). The benchmark **case** contract is unchanged:
   `benchmark-case-v1`/`v2` still read, and `benchmark-report-v2` still parses. No corpus migration is
   implied, because none is needed — a merged case is a normal case file with `reviewerLabels` filled in.
   A version bump of the case contract was considered and rejected as unnecessary churn (see Alternatives).
2. **Freeze and hash the input the reviewer sees.** `contentHash` is a key-order-independent SHA-256 over
   a canonicalised value (recursive sorted object keys, `undefined` dropped). A packet's `packetHash`
   covers `{version, caseId, subjects, input}` only. Because the hash is a pure function of the frozen
   input, a submission bound to an old packet fails the check the moment the case input changes — the
   stale-submission refusal is derived, never trusted from the file's own claim.
3. **Blind the packet by construction.** `buildReviewerPacket` emits `input` plus the subject list and
   the fixed instructions, and omits `expected`, `reviewerLabels`, `adjudications`, `stratum`, `title`,
   `provenance`, and `limitations` — so the reviewer cannot be anchored by gold, prior annotations, or
   evaluator output. The subject set is derived from the **input** (`deriveSubjects`), never copied from
   `expected`; copying subjects from gold would leak which labels exist and how many.
4. **Keep submissions separate, with reviewer-supplied provenance.** `buildSubmissionTemplate` yields one
   blank annotation per subject and empty `reviewer` / `submittedAt`. Nothing is pre-filled. The reviewer
   provides their label, rationale, their own identity, and their own timestamp; the tool never invents
   any of them. Reviewer identity stays operator-asserted (ADR-015/ADR-020): it records who the operator
   says reviewed, and proves nothing about independence or authentication.
5. **Merge refuses rather than repairs.** `mergeSubmission` is all-or-nothing: it collects every reason a
   submission is untrustworthy (unsupported version, case-id mismatch, stale packet hash, blank reviewer,
   blank timestamp, duplicate reviewer against existing labels and against the batch, no annotations,
   annotation for a non-subject, repeated subject, out-of-vocabulary label, blank rationale, unannotated
   subject) and returns them together with the case **untouched** on any failure. On success it appends
   `BenchmarkReviewerLabel` entries only; it never edits `expected`, never deletes an existing reviewer's
   label, and never mutates the input case. `mergeSubmissions` runs a batch deterministically and tracks
   per-case reviewers so a same-reviewer repeat inside one import is a duplicate.
6. **Report agreement without resolving it.** `disagreementReport` classifies each subject as
   `UNANNOTATED`, `SINGLE_REVIEWER` (fewer than two distinct reviewers — not consensus), `UNANIMOUS`,
   `ADJUDICATED` (only when a *scoped* adjudication names that exact dimension+subject), or `UNRESOLVED`.
   A split with no scoped adjudication stays `UNRESOLVED` and `adjudicatedLabel` is `null`; the report
   never picks a side. `adjudicationTemplate` lists only unresolved subjects with blank outcome/label/
   reason/adjudicator — resolving a disagreement is a human act.
7. **Audit is a readiness report, not a score.** `auditCorpus` names missing strata (against
   `BENCHMARK_STRATA`), cases without storage authorisation or a review date, subjects nobody or only one
   reviewer judged, and unresolved disagreements, and it hard-codes `accuracyClaimable: false` with a
   reason. A thin, honest corpus reads as under-ready; the audit never pads a case to look complete and
   never converts readiness into an accuracy claim.
8. **One CLI, new subcommands.** `npm run benchmark:case` gains `packet`, `merge`, `review`, `audit` and
   `adjudicate` alongside the existing `scaffold`/`validate`/`normalise`/`provenance`. They read and write
   local JSON files only. `merge` re-exports every valid case unchanged (so an import is a full-corpus
   rewrite, not a partial one), sets a non-zero exit when any submission is refused, and prints each
   rejection reason. `adjudicate` applies a human-authored scoped adjudication to a case via
   `applyAdjudication`, which **refuses** to settle a subject that is not currently an `UNRESOLVED`
   disagreement (so an adjudication cannot manufacture a decision where reviewers did not split, overwrite
   an existing adjudication, or decide for a lone or unanimous reviewer), requires an in-vocabulary label
   for `RESOLVED` and **no** label for `GENUINELY_AMBIGUOUS`, and never edits the gold `expected` array.
9. **The `benchmark` layer boundary is unchanged.** This stays pure logic in `src/benchmark/` importing
   `core` and Node builtins only (ADR-022). It reaches no network, no database, no provider, no clock.

## Alternatives considered

1. **Bump the case contract to `benchmark-case-v3` and migrate.** Rejected: nothing about a *case*
   changed. Packets and submissions are separate, short-lived files; the merged result is a valid
   `v1`/`v2` case. A contract bump would force a migration with no data to migrate.
2. **Store reviewer submissions and packets in the application database.** Rejected: prohibited by the
   local-first boundaries; benchmark material must not surface as project data or leak into reports
   (ADR-020 §5, §8). Files stay outside the database.
3. **Let the reviewer edit the case file directly (status quo ante).** Rejected: it anchors the reviewer
   on gold/annotations and lets a stale or duplicate submission overwrite a gold label with no gate.
4. **Auto-resolve a 2-1 split by majority into gold.** Rejected outright: that manufactures a consensus
   label the reviewers did not agree on, the central honesty violation. A split stays unresolved until a
   human files a scoped adjudication.
5. **Have the tool set `submittedAt` from the clock, or assert a reviewer is independent.** Rejected: the
   tool has no clock and no authentication; identity and timestamps stay operator-supplied and explicitly
   unverified.
6. **Report the audit's readiness as an accuracy percentage.** Rejected: readiness (coverage, authorisation,
   agreement state) is not accuracy; `accuracyClaimable` stays false until genuine validity requirements are
   met, which this tooling does not by itself establish.

## Consequences and trade-offs

- A reproducible offline review loop now exists: packet → review → submit → merge → review/audit →
  (human) adjudicate → re-merge. It is file-based and re-runnable; the same inputs give the same bytes.
- Blinding removes anchoring but means the reviewer must be given the rubric separately; the packet's
  instructions point at `docs/evaluator/BENCHMARK_ANNOTATION_RUBRIC.md`.
- All-or-nothing merge is stricter than hand-editing: a submission with any defect is bounced whole, so
  the operator fixes and resubmits rather than shipping a half-applied annotation.
- `UNANIMOUS` requires two *distinct* operator-asserted names; with no authentication this is a weaker
  guarantee than verified independent review, and every report says so.
- The artifact versions are a new compatibility surface. Changing packet or submission semantics needs a
  new `benchmark-*-vN` and a documented note, exactly as the case contract does.

## Security, privacy, safety, and evaluator-validity implications

- Packets, submissions and audits are operator-managed local JSON. They may contain sensitive claims and
  evidence excerpts and are never uploaded; treat the corpus and packet directories like the database file.
- Submission files are untrusted input. The CLI coerces each file to a well-formed submission before
  merging (a malformed file is refused, not thrown on); `mergeSubmission` then validates everything, so a
  hostile or corrupted file produces refusals, never a crash or a partial gold edit.
- Storage-authorisation and reviewed-at are read from case provenance and surfaced in the audit; nothing
  here asserts a reviewer's independence, authority, or identity beyond what the operator recorded.
- Output must not be quoted as an accuracy claim. The audit states `accuracyClaimable: false`; the merge
  and review output state that reviewer names are operator-asserted.

## Implementation plan

1. `src/benchmark/types.ts` — review-artifact version constants and `KNOWN_BENCHMARK_REVIEW_ARTIFACT_VERSIONS`.
2. `src/benchmark/review.ts` — `contentHash`, `deriveSubjects`, `buildReviewerPacket`,
   `buildSubmissionTemplate`, `mergeSubmission`, `mergeSubmissions`, `disagreementReport`,
   `adjudicationTemplate`, `applyAdjudication`, `auditCorpus`.
3. `src/benchmark/validate.ts` — export `benchmarkDimensionLabels` so merge checks the same vocabulary the
   validator uses (single source, no duplicated label lists).
4. `scripts/benchmark-case.ts` — `packet` / `merge` / `review` / `audit` / `adjudicate` subcommands;
   `--submissions` and `--adjudications` flags.
5. Tests — unit coverage for packets/hashing, merge refusals and all-or-nothing, disagreement/adjudication,
   and the audit; integration coverage for the CLI end to end (hash binding, stale, duplicate, malformed).

## Tests and validation required

- A packet carries no gold, annotations, adjudications, stratum, provenance or evaluator output; its hash
  changes when the input changes.
- A submission bound to a changed input (stale hash), a different case, a repeat reviewer, an unknown
  subject, an out-of-vocabulary label, a blank rationale, or a blank reviewer/timestamp is refused whole
  and leaves the case untouched; a valid one appends labels and never edits `expected`.
- A batch refuses a second submission from the same reviewer within one import.
- A 2-way split stays `UNRESOLVED` with no label; only a scoped adjudication on that exact subject flips
  it to `ADJUDICATED`; a lone reviewer is `SINGLE_REVIEWER`, not agreement.
- The audit lists missing strata, unauthorised/thin cases and unresolved subjects, and reports
  `accuracyClaimable: false`.
- The CLI: `packet` writes a blinded packet + blank template; `merge` applies a valid submission and
  refuses a stale/duplicate/malformed one (non-zero exit) while still re-exporting the untouched cases;
  `review` shows an unresolved split without resolving; `audit` reports coverage without claiming accuracy.
- `applyAdjudication`/`adjudicate`: a `RESOLVED` adjudication is accepted only for a subject currently in
  unresolved disagreement, must carry an in-vocabulary label, and never edits `expected`; adjudicating a
  unanimous or single-reviewer subject, or a `GENUINELY_AMBIGUOUS` outcome carrying a label, is refused.
- No review code imports persistence, reporting, app, or website; the boundary check and `no-network` test
  keep passing.
