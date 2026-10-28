# Evaluator Core

**Status: Planned package — no evaluator implementation is present yet.**

This package will define provider-independent domain types and evidence evaluation:
- claims and proposition decomposition contracts;
- typed evidence relationships and verdict vocabulary;
- source quality and independence assessment contracts;
- answer-claim fidelity and citation-support evaluation;
- attribution correctness;
- versioned metric definitions and deterministic aggregation;
- uncertainty, coverage, and adjudication records.

Hard boundary: this package must not depend on UI frameworks, web APIs, provider SDKs, crawler implementation, database clients, subscription/billing/entitlement services, or sales/customer lifecycle code. Network retrieval and provider calls must be injected through contracts at application boundaries.

Every semantic change requires methodology review, benchmark/regression tests, and an ADR where required. Identical normalized inputs and evaluator version should produce deterministic outputs except for explicitly identified model-assisted stages; those stages must record their model/configuration and may require repeated evaluation.
