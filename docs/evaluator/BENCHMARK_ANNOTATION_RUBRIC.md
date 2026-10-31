# Benchmark Annotation Rubric

- Status: Current for `benchmark-case-v1`
- Date: 2026-11-01
- Related: [Benchmarking and Validation](BENCHMARKING_AND_VALIDATION.md), [Implemented Metrics v3](IMPLEMENTED_METRICS_V3.md), [ADR-020](../agents/adrs/ADR-020-offline-benchmark-harness.md)

This rubric tells a human reviewer how to assign the gold labels a benchmark case carries. It exists
because a benchmark is only as good as the discipline behind its labels, and because Aporia's own
vocabulary has several pairs of labels that look alike and mean different things.

**Read the label descriptions in `src/core/vocabulary.ts` and `src/core/answerClaims.ts` before
labelling.** Those strings are the definitions the software reports, so a disagreement with them is a
methodology problem to raise, not a licence to label differently in private.

## 1. What a gold label is

A gold label is one careful reviewer's recorded judgement about a frozen input pack, made *before*
seeing what Aporia produced, so the judgement is not anchored by the tool's output. It is not ground
truth about the world. It is what a competent reviewer concluded from the material the case contains.

Two reviewers should label high-impact cases independently. Where they differ, either adjudicate to a
single recorded outcome with a written reason, or record that the case is genuinely ambiguous and keep
both labels. Never average two categorical labels, and never silently overwrite the first reviewer.

Reviewer names in a case file are operator-asserted labels. Local core has no authentication, so
"two reviewers" means two entered identifiers and must never be described as independent verified
review.

## 2. The four dimensions are labelled separately

Never let one dimension influence another. If you find yourself reasoning "the citation looks bad, so
the answer is probably wrong", stop and label each dimension on its own evidence.

| Dimension | Question you are answering | Vocabulary |
| --- | --- | --- |
| Evidence support | What do the recorded relationships say about this target proposition? | `PROPOSITION_STATUSES` |
| Answer fidelity | Does this captured statement match the recorded evidence, within its recorded scope? | `CLAIM_FIDELITY_LABELS` |
| Citation support | Does this cited material actually support this statement? | `CLAIM_CITATION_SUPPORT_LABELS` |
| Attribution | Does this statement credit the right party in the right role? | `CLAIM_ATTRIBUTION_LABELS` |

## 3. Standing rules that override convenience

1. **A refusal is not a denial.** If the answer declined, label `REFUSED` or `NOT_ADDRESSED`. Never
   `CONTRADICTED`.
2. **Silence is not a wrong statement.** Something the answer did not say is `OMITTED`, and it is a
   visibility gap, not a factual error.
3. **Absence of recorded evidence is not contradiction.** Label `UNSUPPORTED`, not `CONTRADICTED`.
4. **A missing capture is unavailable, not failed.** If citation metadata was never shown, or the page
   could not be read, label `METADATA_MISSING`, `UNAVAILABLE`, or `NOT_ASSESSABLE`. Never infer.
5. **Citation presence is not citation support.** A citation that exists but does not back the
   statement is `DOES_NOT_SUPPORT`.
6. **Conditional support is not support.** If the cited material only backs the statement under a date,
   jurisdiction, or narrower scope, label `SUPPORTS_WITH_CONDITIONS`.
7. **A name appearing is not attribution.** Credit must be asserted for the label to apply at all.
8. **Do not use knowledge the case does not contain.** If you know the fact from outside the frozen
   input pack, write that in the case's limitation note rather than letting it steer the label.
9. **When responsible judgement is impossible, say so.** `NOT_ASSESSABLE` is a respectable outcome and
   is better than a guess that later looks like evidence.

## 4. Dimension-by-dimension procedure

### 4.1 Evidence support

Look only at the reviewer-recorded relationships in the case, then apply the documented precedence:

- support with no recorded contradiction or qualifier → `SUPPORTED_WITHIN_SCOPE`
- support alongside a qualifier, or qualifiers only → `PARTIALLY_SUPPORTED`
- contradiction with no recorded support → `CONTRADICTED`
- support and contradiction both recorded → `CONFLICTING_EVIDENCE`
- contextual or non-probative records only → `INSUFFICIENT_EVIDENCE`
- nothing recorded → `NOT_ASSESSED` (see §5 for the trap with `NOT_ASSESSABLE`)
- the evidence could not be inspected → `UNAVAILABLE`

`SUPPORTED_WITHIN_SCOPE` is a summary of human records. Do not label it because you believe the fact.

### 4.2 Answer fidelity

Judge one statement at a time against the recorded evidence, within the statement's own scope.

- matches, within scope → `ACCURATE`
- matches part of what it asserts, or matches only under an unstated condition →
  `PARTIALLY_ACCURATE`
- conflicts with directly relevant recorded evidence → `CONTRADICTED`
- nothing recorded bears on it → `UNSUPPORTED`
- the answer did not say it at all → `OMITTED`
- the answer declined to say it → `REFUSED`
- the evidence could not be checked → `UNAVAILABLE`
- the statement is opinion, filler, or about something else → `NOT_ADDRESSED`
- you cannot responsibly judge → `NOT_ASSESSABLE`

For an answer mixing true and false subclaims, split it into statements first. A single blended label
over a multi-part sentence is the most common way a benchmark hides a real failure.

### 4.3 Citation support

Open the cited material as captured and compare it with the statement.

- materially backs the statement → `SUPPORTS`
- backs part of it → `PARTIALLY_SUPPORTS`
- backs it only under a condition the source itself states → `SUPPORTS_WITH_CONDITIONS`
- you read it and it does not back the statement → `DOES_NOT_SUPPORT`
- its bearing cannot be determined from what was captured → `UNCLEAR`
- no citation content was captured → `METADATA_MISSING`
- you cannot assess → `NOT_ASSESSABLE`

Where several statements lean on one citation, label each pairing. A citation supporting one sentence
and being irrelevant to another is the normal case, not an inconsistency.

### 4.4 Attribution

Judge the credit claim, not the person's worth or your knowledge of the project.

- party and contribution role both match the record → `CORRECT`
- some element right, some wrong → `PARTIALLY_CORRECT`
- right party, wrong role (for example maintainer called author) → `WRONG_ROLE`
- wrong party → `WRONG_PERSON`
- the credited party cannot be resolved → `AMBIGUOUS`
- collaborative work, some participants credited → `COLLABORATIVE_PARTIAL`
- shared or others' work presented as one party's sole authorship → `FALSE_SOLE_CREDIT`
- a contribution asserted with no party named → `UNATTRIBUTED`
- wrong in a way none of the above covers → `INCORRECT`
- the statement makes no credit claim → `NOT_ADDRESSED`
- you cannot assess → `NOT_ASSESSABLE`

`WRONG_ROLE`, `WRONG_PERSON`, and `FALSE_SOLE_CREDIT` are tracked separately because the benchmarking
plan requires them to be measured separately and the remedy differs for each. Do not collapse them
into `INCORRECT` for speed.

## 5. Spelling and vocabulary traps

Labels are validated against the controlled lists, and an unknown value fails the case at load time.
The pairs that most often get mistyped:

| Correct | Commonly mistyped form |
| --- | --- |
| `NOT_ASSESSED` | `NOT_ASSESSABLE` — these are different labels with different meanings |
| `NOT_ASSESSABLE` | `NOT_ASSESSIBLE`, `UNASSESSABLE` |
| `SUPPORTED_WITHIN_SCOPE` | `SUPPORTED`, `IN_SCOPE` |
| `DOES_NOT_SUPPORT` | `NOT_SUPPORTED` (that is the observation-level label, not the mapping label) |
| `PARTIALLY_ACCURATE` | `PARTIAL` |

`NOT_ASSESSED` means nobody recorded a judgement yet. `NOT_ASSESSABLE` means a reviewer looked and
could not judge. Confusing them silently changes a benchmark's exclusion counts.

## 6. What to record beside a label

Every label needs:

- a rationale that says what you compared and what you concluded, in plain language;
- the locator or evidence reference you actually used;
- a confidence note if you were unsure, and which alternative label you considered;
- for ambiguous cases, the specific thing that made them ambiguous.

A label with no rationale cannot be adjudicated later and cannot be used to explain a disagreement.

## 7. Provenance and authorisation

A case may only enter a corpus if the reviewer can state:

- where the material came from;
- whether they are authorised to store and share it in this form;
- who reviewed it, and when;
- what remains unverified.

Material that fails any of these is not a benchmark case. Personal data, confidential captures, and
unlicensed content must not be recorded to make a corpus look larger. A smaller honest corpus is more
useful than a bigger unaccountable one.

## 8. The empty-corpus rule

If a corpus has no cases, or is missing a required stratum, the harness reports that and exits
non-zero. Do not generate filler cases to make it pass. Synthetic cases belong in automated tests and
must never be written into a corpus directory or described as gold labels.
