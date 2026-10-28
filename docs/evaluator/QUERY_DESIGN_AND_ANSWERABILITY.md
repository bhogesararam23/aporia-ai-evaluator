# Query Design and Answerability

## Objective

Measure responses to a declared, reproducible query set—not an undefined concept of whether an AI “knows” a subject. Query design is a source of measurement bias and must be versioned.

## Query dimensions

Cover applicable intents such as:
- identity and entity disambiguation;
- project/product description;
- factual claim verification;
- discovery or recommendation;
- source/citation seeking;
- comparison and alternatives;
- attribution and ownership;
- time-sensitive status.

For each query, record intent, target entity/claim, expected answer elements, acceptable alternatives, critical errors, required evidence, language/locale, temporal assumptions, and inclusion rationale. Avoid leading wording that presupposes the desired answer.

## Answerability states

Return separate states for **answerable**, **partially answerable**, **ambiguous**, **insufficient evidence**, **not found in tested sources**, **provider unavailable**, and **not tested**. Do not convert a timeout, access denial, or missing citation into a factual negative.

## Sampling and bias controls

- Use a fixed, versioned core set for longitudinal comparisons and a separately reported exploratory set.
- Include positive, negative, ambiguous, and abstention cases.
- Document query inclusion/exclusion, deduplicate semantically similar items, and report language/topic coverage.
- Do not select or remove queries after seeing a customer's result without recording the change.
- Keep provider/model identifiers, run time, region, configuration, and retrieval context when available.
- Report sample size and uncertainty; do not generalize a small benchmark to all users or all AI systems.

## Acceptance

A query set is reviewable when each item has a defined intent, expected evidence, answerability policy, scoring rubric, and version. Changes to core query composition or scoring semantics require a methodology update and regression review; material changes may require an ADR.
