# Test Organization

**Status: Test structure guidance; the repository currently contains documentation only.**

Proposed suites:
- unit: pure core functions and domain invariants;
- integration: persistence, API, queue, and source retrieval;
- evaluator-gold: human-reviewed benchmark cases and metric regression;
- provider-contracts: request/response schema fixtures and provider-specific errors;
- security: SSRF, tenant isolation, upload limits, prompt injection, secrets, and publication authorization;
- end-to-end: achievement intake through evidence-linked report and retest.

A failing test must not be removed merely to make CI green. Changes to verdicts, attribution, or metric formulae require a regression case and a methodology/ADR review. Tests that call a live provider must be separately labeled, budget-limited, and excluded from deterministic unit-test assumptions.
