# Web application boundary

**Status: Planned package — not yet implemented.**

This directory is reserved for the user interface: intake forms, evidence inspection, query-set review, run progress, reports, and website integration previews.

Rules:
- Keep claims, verdicts, evidence-weighting rules, and metric formulae out of UI components.
- Call versioned API contracts instead of importing provider SDKs or evaluator internals.
- Never render untrusted source content as trusted HTML.
- Never show a provider integration as supported unless capability metadata says it is available and tested.
- Make unknown, unavailable, partial, and disputed results visible.
- Require explicit review before initiating publication or destructive changes.
- Apply accessibility and privacy requirements from the documentation set.

No frontend framework has been selected by this README.
