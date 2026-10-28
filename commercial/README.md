# Commercial Boundary — Reserved for Future Optional Features

**Status: Not implemented.**

This directory is intentionally separated for any future billing, subscription, pricing, invoice, entitlement, or customer-commercial lifecycle logic. Aporia does not need a commercial layer to define or validate evaluator semantics.

Hard constraints:
- This code must not be imported by packages/evaluator-core.
- Commercial state may authorize a job or limit resources before it starts; it must not change claim verdicts, source weight, metric formulas, attribution labels, or report caveats.
- The same evaluator input and evaluator version must yield the same result regardless of subscription plan.
- Do not create a paid-only verification standard or sell citations.
- Any exception requires a new ADR and owner review.

This README creates a planned boundary only; no billing or commercial implementation is implied.
