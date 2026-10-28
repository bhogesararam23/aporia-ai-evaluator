# Benchmarking and Validation Plan

- Status: Required before public reliability claims.
- Goal: Validate claim/evidence judgments and AI-answer metrics against human-reviewed cases.

## 1. Why validation is required

An LLM judging another LLM may repeat mistakes, follow misleading source text, overlook context, or express unjustified certainty. A mathematically precise metric may still be invalid if its unit or denominator is wrong. Validate the evaluator independently from the AI provider responses.

## 2. Benchmark strata

Include cases for:
1. strongly supported claims backed by primary evidence;
2. partially supported claims with important conditions;
3. claims contradicted by credible evidence;
4. conflicting evidence;
5. insufficient evidence after a bounded search;
6. version/date-sensitive claims;
7. identity and attribution ambiguity;
8. collaborative achievements and multiple contribution roles;
9. duplicate/syndicated sources;
10. inaccessible pages, robots blocks, provider failures, and missing citation metadata;
11. multilingual and regional cases;
12. safety refusals that are not factual denials;
13. fabricated sources and prompt-injection content;
14. claims mixing true and false subclaims.

## 3. Gold-label procedure

- Freeze claim version, evidence pack, permitted search budget, and assessment rubric for each case.
- Have at least two trained reviewers independently label high-impact gold cases where feasible.
- Ask reviewers for an initial label before showing the automated verdict, to reduce anchoring.
- Adjudicate reviewer disagreement or record that the case is genuinely ambiguous.
- Store rationale and evidence locators, not only labels.
- Distinguish insufficient evidence from contradiction.
- Version labeling guidance; changes require an impact review.

## 4. Evaluator performance measures

For categorical verdicts, measure per-class precision/recall, confusion matrices, macro-F1 where appropriate, and calibration only when meaningful probabilities are emitted. Track false-positive SUPPORT and false-negative CONTRADICT closely. For attribution, measure wrong identity, wrong role, and false sole-credit assignments separately. For citations, assess whether the cited content actually supports the answer claim.

Report confidence intervals and class balance. Aggregate accuracy alone is inadequate when rare failures are costly.

## 5. Ablation and component testing

Compare rule-only and model-assisted classification, duplicate-source detection, primary-source handling, query generation strategies, citation extraction, multilingual processing, contradiction detection, and human adjudication. This helps identify which components improve performance and where they introduce regressions.

## 6. Leakage and contamination controls

Separate development, validation, and held-out test cases. Do not repeatedly optimize prompts against the held-out set. Use time-split tests for changing facts. Record contamination risks. A public benchmark may itself be found by tested models; consider a rolling or restricted subset while preserving documented governance and reproducibility.

## 7. Provider integration tests

For each adapter, test success, malformed/empty/partial output, timeout, rate limit, invalid credentials, policy refusal, cancellation, citation parsing, and budget exhaustion. Verify that errors are not scored as misses. Record supported models/tools, fixture coverage, live-test result, and last verification date.

## 8. Release gates

Before public reliability claims, document dataset size and composition, annotation guidance, reviewer agreement, target metrics/tolerances, validation split, evaluator version, measured results, and limitations. Initial engineering release requires regression cases for all verdict labels, wrong attribution, citation-support mismatch, and provider-unavailable states. Critical regressions block release unless an owner-approved exception is documented.

## 9. Monitoring after launch

Track review overrides, user disputes, unsupported-confidence reports, parsing failures, provider schema changes, and metric drift. Sample outputs for human review with privacy safeguards. Distinguish upstream provider drift from Aporia code regressions.

## 10. Public claims about performance

Any statement such as “X% accurate” must identify task, dataset, sample, labels, date, interval where appropriate, and known limitations. Do not generalize a small curated benchmark to all real-world claims or every AI provider.
