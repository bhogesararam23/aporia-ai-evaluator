# Evaluation Reporting Specification

## Report purpose

A report must allow a reader to understand what was tested, what was observed, what evidence supports the finding, and what cannot be concluded. It must not imply comprehensive coverage when only a sample was tested.

## Required sections

1. **Scope:** subject/site, evaluation date, objectives, exclusions, and authorization basis.
2. **Method:** query-set version, scoring/methodology version, providers/models tested, locale/region, run configuration, and sample size where available.
3. **Coverage:** attempted, completed, failed, skipped, and unavailable checks; explain missing coverage.
4. **Findings:** stable finding ID, query/intent, observed answer or behavior, source/citation references, classification, and limitations.
5. **Metrics:** definition, numerator/denominator, sample size, aggregation, missing-data policy, and uncertainty where meaningful.
6. **Remediation:** evidence-linked action, priority rationale, owner/status if known, and retest plan.
7. **Change over time:** comparable-run deltas, changed conditions, regressions, and inability to compare.
8. **Limitations:** sample bias, provider variability, stale/inaccessible sources, nondeterminism, and untested systems.

## Metric separation

Keep website accessibility/discoverability, external corroboration, answer presence, factual fidelity, citation support, attribution, and provider coverage separate. Any composite score must publish its formula, weights, missing-data behavior, version, and sensitivity/limitations. Do not let a composite hide a critical error.

## Language requirements

Use “observed in this run/sample” rather than universal claims. Distinguish no result from a negative factual finding. Never promise search indexing, model memory, recommendations, or citations. Include source timestamps and links where legally and technically appropriate; redact secrets and unnecessary personal data.

## Reproducibility

Every saved report should reference immutable run metadata, source/query versions, and the scoring version. Corrections create a new version or audit event; they do not silently rewrite historical evidence.
