# ADR-003: Separate Evidence Verdicts from AI Visibility Metrics

- Status: Accepted for initial baseline
- Date: 2026-10-28
- Related: ADR-002, ADR-004, ADR-006

## Context

A single “AI score” would hide important differences among whether a claim is true, whether a website is discoverable, whether an answer mentions an entity, whether a citation supports an answer, and whether credit is assigned correctly. It could also misleadingly imply universal visibility probability.

## Decision

Report at least four dimensions independently: evidence support, discoverability observations, answer fidelity/citation behavior, and attribution correctness. Define each metric with an explicit unit, numerator, denominator, exclusions, query-set version, provider configuration, date, and limitations. Do not introduce a composite score until the underlying metrics are benchmarked and a separately reviewed ADR defines calibration, weights, missing data, and misuse controls.

## Alternatives considered

- Weighted score at launch: rejected as unsupported and easy to misinterpret.
- Mention rate as the sole success measure: rejected because mentions may be inaccurate, irrelevant, uncited, or misattributed.
- Treating no search result as proof of nonexistence: rejected because search coverage is incomplete.

## Consequences

Reports are more detailed and may take longer to understand; the UI must help non-experts interpret the dimensions. The benefit is semantic honesty, better diagnosis, and an independent basis for validation.

## Validation

Gold cases must include supported-but-not-mentioned, mentioned-but-inaccurate, cited-but-unsupported, correctly mentioned-but-misattributed, and provider-error states. Metrics must not classify technical failures as negative answers.
