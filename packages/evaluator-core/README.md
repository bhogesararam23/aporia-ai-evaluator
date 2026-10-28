# Evaluator Core

**Status: Implemented for local v0.1 in `src/core`.**

The core contains:

- controlled claim, proposition, relation, observation, assessment, attribution, source, and query vocabularies;
- claim/run lifecycle transitions;
- boundary input validation used by the local HTTP workflows;
- `evidence-aggregation-v1` over human-recorded evidence relationships;
- explicit human conclusion resolution with visible disagreement;
- `metrics-v1` mention, citation, citation-support, fidelity, attribution, and observed-coverage calculations with explicit exclusions and null unknowns.

Hard boundaries:

- no UI, HTTP, database, crawler, provider SDK, or commercial imports;
- no network access;
- no composite score or invented weights;
- no keyword matching or model claim presented as evidence analysis.

The dependency rule is enforced by `scripts/check-boundaries.ts` and `tests/unit/boundaries.test.ts`. Metric semantics are documented in [Implemented metrics v1](../../docs/evaluator/IMPLEMENTED_METRICS_V1.md). Identical core inputs produce identical outputs; commercial state is not part of the input or output.
