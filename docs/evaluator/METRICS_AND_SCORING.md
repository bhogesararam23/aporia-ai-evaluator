# Metrics and Scoring Specification

- Status: Definitions proposed; calibrate through validation before public scoring.
- Principle: Report individual metrics before considering any composite indicator.

## 1. Evaluation eligibility

Each metric needs a defined eligible test set. A test is eligible only if the query was executed successfully under the intended configuration and the output is available for scoring. Provider errors, blocked requests, rate-limit responses, and unavailable models are not negative mention results. Report planned count, completed count, excluded count, and exclusion reasons.

## 2. Core metrics

### Mention rate
For a fixed eligible query set:
Mention rate = eligible outputs that mention the target entity / eligible outputs.

Report numerator, denominator, query set version, provider/model, date range, locale, and whether mentions are exact-name, alias, or unambiguous reference. An entity mention does not imply endorsement, recommendation, factual accuracy, or citation.

### Target-source citation rate
Target-source citation rate = eligible outputs that cite at least one designated target-owned canonical source / eligible outputs.

Also report any-source citation rate separately. Do not treat a citation shown by an interface as evidence that the cited URL supports every assertion.

### Citation support rate
Citation support rate = evaluated answer claims for which the cited material materially supports the claim / evaluated answer claims with an assessable citation.

State how answer claims were selected and how unavailable citation text is handled. A citation may support only part of a multi-part statement.

### Claim fidelity
Classify answer claims as accurate within scope, partially accurate/qualified, contradicted, unsupported by available evidence, or not assessable. A rate may be reported only when the scoring rule, eligible units, and handling of partial answers are explicit. Do not score silence as an incorrect statement.

### Attribution correctness
For each response that attributes the accomplishment, assess separately:
- correct entity/person identified;
- role accurately represented (author, co-author, maintainer, contributor, team, organization);
- underlying source correctly linked;
- sole credit not claimed where evidence shows collaboration;
- identity ambiguity handled appropriately.

Report component results and an explicit denominator. Do not award correct attribution merely because a person is mentioned in the same answer.

### Discovery coverage
Discovery coverage = pre-defined query intents for which relevant evidence/entity is returned or used / eligible query intents tested. If only an answer endpoint is accessible, call this answer-level observed coverage, not internal retrieval coverage. Do not claim to observe hidden retrieval steps unless the integration exposes them.

### Share of voice
Share of voice can be computed as target mentions divided by all measured eligible mentions of a predeclared competitor set for the same query cohort. Publish competitor inclusion criteria and the count definition. This is not market share, quality, or authority.

### Crawl accessibility
Report technical checks individually: reachable HTTP response, content availability, robots outcome, canonical status, sitemap presence, and supported provider-specific signals. Do not compress them into “AI cache score.”

## 3. Repeatability and confidence intervals

When outputs are stochastic, repeat some prompts under the same versioned conditions. Report run-to-run variability and test count. For proportions, confidence intervals may be shown if the sampling assumptions are appropriate. If prompts are purposively chosen rather than randomly sampled from a defined population, do not imply that an interval estimates universal user-facing probability.

The effective sampling unit may be a query cohort rather than a provider call: repeated responses to the same prompt are correlated. Statistical summaries must account for this design where possible, and the report must explain limitations.

## 4. Composite score policy

A single “Aporia score” is not part of the initial baseline. If introduced later:
1. each component must have a documented meaning and independent validation;
2. weights and normalization must be published;
3. missing/unsupported components must not silently become zero or one;
4. material weakness in evidence cannot be hidden by high mention rate;
5. the score must not imply objective truth, guaranteed discovery, or future citation probability;
6. methodology version must be visible on reports;
7. the score must pass benchmark, calibration, and misuse review.

Preferred top-line report: a vector of evidence status, discoverability findings, measured mention/citation rates, claim fidelity, attribution correctness, and uncertainty/coverage.

## 5. Prompt set integrity

Query sets must include multiple realistic intents:
- non-branded discovery;
- direct entity questions;
- feature/capability questions;
- recommendation/comparison questions;
- source/evidence-seeking questions;
- time-sensitive questions when appropriate;
- multilingual and regional variants when included in scope.

Avoid only asking leading prompts such as “Why is Project X the best?” Preserve the original query and its version. Define inclusion/exclusion before observing results when practical to reduce selection bias.

## 6. Accuracy versus visibility

These are orthogonal:
- supported claim + low visibility: evidence exists but was not surfaced under tested conditions;
- supported claim + incorrect answer: response fidelity problem under tested conditions;
- unsupported claim + high visibility: broad exposure does not validate it;
- correct mention + wrong attribution: recognition occurred but credit is misassigned;
- source cited + unsupported sentence: citation is not adequate evidence for that sentence.

## 7. Anti-gaming and reporting controls

- Never remove failed tests from denominator without reason-coded exclusion.
- Never change query sets between baseline and retest without marking versions.
- Report target-owned citations separately from independent citations.
- Do not count duplicate syndicated sources as independent confirmation.
- Preserve negative and contradictory results.
- Use stable aliases and disambiguation rules.
- Do not score “brand is mentioned in a disclaimer” as a positive recommendation.
- Keep provider/API errors separate from answer-level misses.
- Audit evaluator outputs against human labels and known failure cases.
