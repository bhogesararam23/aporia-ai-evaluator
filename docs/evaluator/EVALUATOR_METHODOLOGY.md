# Evaluator Methodology

- Status: Initial methodology proposal
- Primary objective: Make evaluations inspectable, repeatable, and appropriately uncertain.
- This document does not claim that the methodology has already been validated empirically.

## 1. Evaluation questions

Aporia evaluates four questions separately:

1. **Evidence support:** Does the collected evidence support, contradict, qualify, or leave unresolved a proposition?
2. **Discoverability:** Can specified systems access or retrieve the relevant public information under tested conditions?
3. **Answer fidelity:** Does an observed AI answer accurately represent the proposition and its evidence?
4. **Attribution:** Does the answer correctly identify the creator, contributors, organization, and primary source?

These dimensions must not be collapsed into one verdict. A claim may be supported by strong evidence while still being absent from AI answers. An AI may mention a project but misattribute it. A website may be crawlable but never cited.

## 2. Unit of evaluation

The atomic unit is a **proposition**, not an entire paragraph, biography, product page, or person. A proposition should be sufficiently bounded to judge independently.

Examples:
- “Repository R contains an implementation of feature F.”
- “The implementation passed test T under environment E on date D.”
- “Person P is listed as the author of release V.”
- “The method outperforms baseline B on dataset S under protocol M.”

The first proposition does not imply the second. A repository listing a person as author does not prove that person was the sole creator. “First,” “best,” “working,” “safe,” “state-of-the-art,” and “impossible” require explicit scope and operational definitions.

## 3. Claim decomposition

The system should preserve the original wording and generate a proposed decomposition. A decomposition may include:
- subject/entity;
- predicate or relationship;
- object/value;
- conditions and environment;
- timeframe and version;
- units and metric definitions;
- quantifiers such as all, only, first, never, or always;
- required evidence type;
- explicit unresolved ambiguity.

A human review is required when decomposition changes the practical meaning, involves a high-impact claim, or depends on an unclear term. The model must not silently remove qualifiers or turn an aspiration into an accomplishment.

## 4. Evidence collection

Search breadth is bounded by source integrations, budget, accessible sources, and provider permissions. Reports must state the source categories and tools actually checked. “The whole internet was searched” is never an acceptable description.

Prioritize evidence fit to the proposition:
1. primary artifacts (repository release, original paper, test data, official records, demo with context);
2. reproducible or independently inspected results;
3. independent sources with direct access to the underlying facts;
4. secondary reporting that cites primary evidence;
5. self-published descriptions;
6. unattributed claims, copied aggregations, social posts, and snippets without context.

This is a heuristic ordering, not a universal ranking. The closest available source may be unreliable; an official source may be interested or incomplete. Record source incentives, expertise, independence, dates, directness, and limitations.

## 5. Source independence and duplication

Ten pages copying one press release are not ten independent confirmations. Track canonical URL, publisher, citations/quoted origin, shared wording, timestamps, and known syndication relationships. Where independence cannot be determined, mark it unknown. Do not inflate evidence strength by counting duplicates as separate corroboration.

## 6. Evidence relations

For each proposition/source pair, assign one of:
- **Supports:** content materially increases support for the exact proposition.
- **Contradicts:** content materially conflicts with the proposition.
- **Qualifies:** supports only under conditions or narrow scope.
- **Contextualizes:** useful background but neither direct support nor contradiction.
- **Does not address:** source is not probative for this proposition.
- **Unreadable/unavailable:** content could not be inspected reliably.

The evaluator must preserve both supporting and contradictory evidence. An LLM-generated assessment is a proposal unless its validity has been established for the use case. The report should show the relevant passage or artifact locator and the rationale.

## 7. Claim status vocabulary

Use the following controlled labels:
- **SUPPORTED WITHIN SCOPE:** the inspected evidence sufficiently supports the bounded proposition under the stated criteria.
- **PARTIALLY SUPPORTED:** some components are supported; qualifiers, scope, or other components remain unresolved.
- **CONTRADICTED:** credible evidence materially conflicts with the proposition.
- **INSUFFICIENT EVIDENCE:** available evidence does not support a confident conclusion.
- **CONFLICTING EVIDENCE:** credible sources conflict and the conflict remains unresolved.
- **NOT ASSESSED:** the proposition was not evaluated.
- **UNAVAILABLE:** the assessment could not be completed for technical, access, or policy reasons.

“Supported within scope” is not universal proof. “Insufficient evidence” is not false. “Not found” is not “does not exist.” Reports should state the evidence boundary and search method.

## 8. Evaluating AI answers

Every provider response is an observation with a precise context, not a timeless model property. The answer evaluator should:
1. preserve the exact prompt and response;
2. extract factual answer claims relevant to the target proposition;
3. evaluate each answer claim against the evidence set;
4. inspect returned citations, if the provider returns them;
5. assess whether citations actually support the sentence or relevant proposition;
6. evaluate identity and contribution attribution separately;
7. mark omissions separately from false statements;
8. indicate uncertainty, ambiguity, and evaluation method.

An answer can be relevant but inaccurate; accurate but uncited; cited but poorly supported; or correct about an outcome but wrong about its creator.

## 9. Refusals and impossible claims

Distinguish:
- policy/safety refusal;
- model lacks access or cannot perform an action;
- absence of known public evidence;
- a factual assertion that the action is impossible;
- assertion that the action has never been done;
- uncertainty or abstention;
- search/retrieval failure.

A policy refusal is not a factual claim about whether an event occurred. A user-provided artifact can show that a claim deserves investigation but does not automatically establish every detail. If the task is harmful, private, or unlawful, Aporia must not bypass safety controls to prove capability; it can assess public claims at a suitable high level.

## 10. Uncertainty and abstention

Uncertainty should be represented as structured reasons, not only as a decimal:
- evidence quality or coverage is low;
- evidence conflicts;
- source independence unknown;
- evaluator methods disagree;
- model or provider unavailable;
- output parsing incomplete;
- human adjudication required;
- claim scope ambiguous.

Calibrated numerical confidence may be introduced only after evaluation against a suitable labelled dataset and a documented calibration method. Before calibration, use categorical labels plus rationale.

## 11. Human review

High-impact, disputed, identity-sensitive, reputational, scientific novelty, health/legal/financial, and consequential claims should receive human review or an explicit limited-use warning. Human adjudicators must have access to evidence, know whether each artifact is user-supplied or independently found, and record rationale. Reviewer disagreement should be recorded and used to improve guidance.

## 12. Reproducibility

Every report must capture:
- source URLs, relevant excerpts/locators and retrieval dates;
- claim and proposition revisions;
- query set and query-generation version;
- provider, model identifier where available, API/interface version, locale, and search/grounding settings;
- raw response and citation metadata as permitted;
- evaluator and metric version;
- human overrides and review history;
- denominator, exclusions, and run status;
- known limitations and failed stages.

Provider internals, hidden prompts, or model weights may be inaccessible; the report must not imply reproducibility beyond the inputs actually recorded.

## 13. Change control

Any change to verdict taxonomy, evidence aggregation, query sampling, attribution criteria, metric formula, or confidence calibration requires:
- an ADR;
- reason and alternatives;
- benchmark impact analysis;
- regression tests against prior cases;
- versioned release note;
- a statement on how existing reports remain interpretable.
