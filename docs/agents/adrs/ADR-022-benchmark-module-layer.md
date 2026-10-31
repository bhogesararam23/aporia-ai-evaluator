# ADR-022: Add a `benchmark` Module Layer With Core-Only Read Access

- Status: Proposed
- Date: 2026-11-01
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-007, ADR-008, ADR-020

## Context

`scripts/check-boundaries.ts` recognises five source layers plus a catch-all. Anything that is not
`core`, `website`, `persistence`, `reporting`, or `app` is classified `infrastructure`, and
`infrastructure` is forbidden from importing `core`. That rule exists so that server bootstrapping,
configuration, and logging cannot smuggle evaluator behaviour into plumbing.

The benchmark harness required by ADR-020 is different: its entire purpose is to exercise the
evaluator's own rules and metric formulas against frozen inputs and compare the result with
human-supplied gold labels. Placing it in `src/` without registering a layer would put it in
`infrastructure`, and the boundary check would then refuse its imports of `src/core` — or, worse,
someone would work around the check by re-exporting core values through a permitted layer.

The milestone also warns against restructuring the repository to look sophisticated. This is not a
split for appearance: it is the minimum change that lets the boundary checker keep saying something
true about a new component.

## Decision

1. Add a `benchmark` layer to `scripts/check-boundaries.ts`, recognised from `src/benchmark/`.
2. `benchmark` may import `core` and Node builtins. It must not import `website`, `persistence`,
   `reporting`, `app`, or `infrastructure`, and may not import third-party packages. Validation and
   scoring are therefore pure functions over declared inputs; a benchmark result cannot depend on
   live database state or on rendering.
3. `core` remains forbidden from importing `benchmark`, so evaluator semantics cannot depend on the
   harness that scores them.
4. `app` and scripts may import `benchmark`. The CLI in `scripts/` is the only place that reads
   corpus files from disk; the harness itself stays I/O-free so scoring is testable without a
   filesystem.
5. `persistence` and `reporting` must not import `benchmark`. Benchmark material must never enter
   the application database or a report snapshot, keeping evaluation results and evaluator-validation
   results separate artifacts.
6. `docs/technical/MODULE_BOUNDARIES.md` is updated in the same change to describe the layer and its
   permitted directions.

## Alternatives considered

1. **Put the harness under `src/core/benchmark/`.** Rejected: `core` must be dependency-free, so the
   case loader and report writer could not use Node builtins, and evaluator semantics would grow a
   validation-and-scoring subsystem that is not part of judging a claim.
2. **Put it under `src/reporting/`.** Rejected: reporting renders project snapshots and is forbidden
   from importing persistence; a benchmark is not a project artifact.
3. **Exempt `src/benchmark/` from the boundary check.** Rejected: an unenforced directory is how a
   boundary document becomes fiction.
4. **Relax the `infrastructure` rule to allow core imports.** Rejected: it would weaken a real,
   currently-satisfied constraint for every other top-level file to accommodate one component.
5. **Split the repository into `packages/evaluator-core` and a benchmark package.** Rejected for this
   milestone: the existing `packages/` tree holds documentation placeholders, and a physical split
   would be architectural churn rather than needed isolation.

## Consequences and trade-offs

- The layer list is now six, and the boundary checker is the authority on what that means. Adding a
  layer is deliberate work, which is the intended friction.
- Because `benchmark` cannot import `persistence`, corpus cases must restate their input pack rather
  than reference database ids. This is also a feature: a case stays reproducible after the project
  that inspired it changes or is deleted.
- The harness cannot reuse the report renderer for its output, so it has its own small deterministic
  serializer.

## Tests and validation required

- `npm run check:boundaries` passes with `src/benchmark/` present.
- A deliberate `benchmark` → `persistence` import is reported as a violation by the checker.
- A deliberate `core` → `benchmark` import is reported as a violation.
- `benchmark` files importing a third-party package are reported.
- The existing `tests/unit/boundaries.test.ts` and `tests/unit/no-network.test.ts` still pass.
- `MODULE_BOUNDARIES.md` matches the checker's actual rules.
