# Implemented Metrics v4 — Claim Eligibility Contract

- Status: Implemented in local core v0.4; validated by `tests/unit/claim-eligibility.test.ts`, `tests/unit/claim-metrics.test.ts`, `tests/integration/schema-evaluator-integrity.test.ts` and `tests/unit/report-compatibility.test.ts`
- Date: 2026-11-02
- Version string: `metrics-v4`
- Related: [Implemented Metrics v3](IMPLEMENTED_METRICS_V3.md), [Evaluator Methodology](EVALUATOR_METHODOLOGY.md), [ADR-019](../agents/adrs/ADR-019-metrics-v3-claim-level.md), [ADR-023](../agents/adrs/ADR-023-claim-eligibility-metrics-v4.md)

This document records what changed between `metrics-v3` and `metrics-v4`. It does not restate the
observation-level rates, which are unchanged from `metrics-v2` and `metrics-v3`, and it does not
restate the claim-level units, which are the ones given in
[Implemented Metrics v3](IMPLEMENTED_METRICS_V3.md) section 2.

## 1. Version boundary

| Version | What it produced | Status |
| --- | --- | --- |
| `metrics-v1` | Observation-level rates with coverage counted per query row | Historical. Stored snapshots render their own numbers. |
| `metrics-v2` | Same, with coverage counted per query-intent group (ADR-014) | Historical for new reports; stored snapshots unchanged. |
| `metrics-v3` | `metrics-v2` output plus the optional `claimLevel` block, whose denominators were driven by the stored label alone | Historical for new reports; stored snapshots unchanged. |
| `metrics-v4` | `metrics-v3` output, with every claim-level denominator gated by the recorded relevance (ADR-023) | Current. |

No `metrics-v3` observation-level field was renamed, removed or redefined. Within the claim-level
block, `partiallyDecomposedObservations` was renamed to `partiallyAssessedObservations` because it
never measured decomposition; a stored `metrics-v3` snapshot keeps the key it was written with and is
rendered with wording that matches what it recorded. A stored snapshot is never recomputed.

### Why this is a new version rather than a bug fix in place

`metrics-v3` claimed in its notes that a refusal was outside the fidelity denominator. It was not: the
calculation looked only at the stored label. A report generated under `metrics-v3` from a database
that contains a refusal carrying an `ACCURATE` assessment therefore published a figure that current
code would not produce from the same rows. Recomputing that stored report would silently rewrite what
it claimed, so the version moves instead.

## 2. The rule

**Relevance decides whether a statement asserts anything. A label decides only what was asserted about
it.** A label can never promote a non-assertion into a scored assertion.

The eight non-asserting relevances are `UNRELATED`, `AMBIGUOUS`, `REFUSAL`, `ABSTENTION`, `OMISSION`,
`UNAVAILABLE`, `DOES_NOT_ADDRESS` and `NOT_ASSESSABLE`. The four asserting ones are `ADDRESSES`,
`PARTIALLY_ADDRESSES`, `QUALIFIES` and `CONTRADICTS`. The tables live in
`src/core/claimEligibility.ts` and are restated in migration `010_evaluator_integrity.sql`; a test
compares the two, so a change on one side cannot pass unnoticed.

Three ordering decisions inside the rule are load-bearing:

1. **A voided statement leaves first**, whatever its label, because the reviewer withdrew the record.
2. **An unrecognised relevance excludes with `CLAIM_LABEL_INVALID`** rather than being guessed at.
3. **A definitive label on a non-asserting relevance is reported as a conflict**,
   `CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE`, and counted in `labelConflictClaims`. It is never resolved
   by preferring the label, and never dropped quietly.

A fourth point is easy to miss: **consistent is not the same as scorable.** `NOT_ASSESSABLE` is
reachable from an asserting relevance, and it stays outside the denominator, so an unjudged statement
widens the recorded unknowns instead of pulling a rate down.

## 3. Per-axis denominators and exclusions

### 3.1 `answer_statement_fidelity_rate`, `answer_statement_contradiction_rate`, `answer_statement_unsupported_rate`

- **Denominator** — statements on an eligible observation, not voided, whose relevance is one of the
  four asserting values, and whose latest fidelity label on the current revision is definitive:
  `ACCURATE`, `PARTIALLY_ACCURATE`, `CONTRADICTED`, `UNSUPPORTED`.
- **Excluded, each with its own reason** — voided (`CLAIM_VOIDED`); no label
  (`CLAIM_FIDELITY_UNASSESSED`); label off-axis (`CLAIM_LABEL_INVALID`); relevance says nothing was
  asserted (`CLAIM_UNRELATED`, `CLAIM_AMBIGUOUS`, `CLAIM_ABSTENTION`, `CLAIM_REFUSED`,
  `CLAIM_OMITTED`, `CLAIM_UNAVAILABLE`, `CLAIM_NOT_ADDRESSED`, `CLAIM_NOT_ASSESSABLE`); label
  contradicts relevance (`CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE`).
- The three rates continue to share one denominator so they read as a partition.

### 3.2 `answer_statement_attribution_rate`

- **Denominator** — statements with an asserting relevance, not voided, carrying an attribution label
  that describes a credit claim.
- A statement that refuses, abstains, stands unrelated or is ambiguous cannot credit anybody, so only
  `NOT_ADDRESSED` and `NOT_ASSESSABLE` are honest labels for it, and both stay outside.

### 3.3 `answer_statement_citation_support_rate`

- **Unit** — the claim-to-citation mapping, not the statement.
- **Denominator** — mappings whose statement has an asserting relevance, is not voided, **whose cited
  record is not voided**, and whose support label is definitive: `SUPPORTS`, `PARTIALLY_SUPPORTS`,
  `SUPPORTS_WITH_CONDITIONS`, `DOES_NOT_SUPPORT`.
- **New exclusions** — `CLAIM_CITATION_VOIDED` for a mapping to a citation the reviewer withdrew, and
  `CLAIM_CITATION_NON_ASSERTING` for a mapping on a statement that asserts nothing.
- `CLAIM_NO_MAPPED_CITATION` is now raised only for an asserting statement. A refusal with no citation
  is a complete record, not a missing check.

### 3.4 `relevant_omission_rate`

- **Denominator** — distinct propositions linked by a statement whose relevance engages the target:
  the four asserting values plus `OMISSION`.
- **Numerator** — those linked as `OMITS_TARGET`, which is reachable only from `PARTIALLY_ADDRESSES`
  and `OMISSION`.
- **New exclusion** — `CLAIM_OMISSION_NON_ENGAGING`. This closes the defect where an unrelated
  statement carrying an inconsistent `OMITS_TARGET` link created a relevant omission out of nothing.

## 4. Void lifecycle decisions

**Voided statements.** A voided statement is passed to the calculation and excluded there, under
`CLAIM_VOIDED`, rather than filtered out by whoever assembles the input. Its record, reason and
history stay inspectable, and the report says how many were excluded. An observation whose only
statements were voided counts as not decomposed. Both metric-assembly paths — report generation and
retest comparison — now pass every statement through the same contract, which is why they cannot
disagree about one finalized run.

**Voided citations.** A mapping survives the void of its citation and stops counting, under
`CLAIM_CITATION_VOIDED`. The alternative — forcing every affected mapping to be superseded before a
citation may be withdrawn — was rejected because it destroys the reviewer's record of what was
believed before the withdrawal. New mappings to a voided citation remain impossible at the form, the
repository and the schema, because that direction has no history to protect.

## 5. Review progress, stated separately

`metrics-v3` reported `partiallyDecomposedObservations` and the report described it as answers "only
partially decomposed". The count measured answers whose recorded statements were part-way through
assessment — reviewer effort rendered as though it were a statement about the AI. It is now
`partiallyAssessedObservations`, and the block carries the separate counts a reader actually needs:

| Field | One unit means |
| --- | --- |
| `statementsRecorded` | A live statement on an eligible observation |
| `statementsFidelityAssessed` | …that carries a fidelity label |
| `statementsAttributionAssessed` | …that carries an attribution label |
| `citationMappingsRecorded` | A live statement's active claim-to-citation mapping |
| `citationMappingsAssessed` | …whose support label is inside the support vocabulary |
| `voidedClaims` | A statement the reviewer withdrew |
| `labelConflictClaims` | A statement whose label overstates its relevance |

Finishing review moves these figures and moves no rate. The report renders them in their own block,
and a statement that no reviewer has judged is reported as unassessed rather than treated as a result.

## 6. Where the rule is enforced

| Layer | File | What it refuses |
| --- | --- | --- |
| Calculation | `src/core/claimMetrics.ts` | Any ineligible unit entering a denominator; the exclusion is reported |
| Form | `src/core/answerClaimInputs.ts` | An assessment or link inconsistent with the stored relevance, naming the values that would be honest |
| Repository | `src/persistence/repositories/answerClaims.ts` | The same pairings on writes that never passed through a form |
| Schema | `src/persistence/migrations/010_evaluator_integrity.sql` | The same pairings on a raw `INSERT` |

The triggers only speak when the value already belongs to its axis's vocabulary. Vocabulary membership
is owned by the `metrics-v3` checks and triggers, which report a wrong-axis label more clearly than a
pairing message would.

## 7. What `metrics-v4` does not claim

- **No evaluator accuracy.** This is internal consistency. Accuracy needs a genuinely reviewed corpus,
  which does not exist in this repository.
- **No independent review.** Reviewer fields are operator-asserted; there is no authentication.
- **No causal claim.** A later run that reads better is not proof that a remediation caused it.
- **No verification of the world.** `ACCURATE` means accurate against the evidence the reviewer
  recorded, within the scope they recorded.
- **No guarantee that the tables are the ones the owner would choose.** They are a design judgement,
  readable in one file and mirrored in one migration. The mechanism keeping the two copies honest is
  the durable part; the specific sets are open to revision.
