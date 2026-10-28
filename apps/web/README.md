# Web application boundary

**Status: Implemented for local v0.1 in `src/app`.**

The browser-facing application is a server-rendered Node HTTP UI under `src/app`. It provides project, entity, claim/revision, evidence, source, query-set, manual-run, observation, assessment, HTML-audit, report, export, and audit-log workflows.

Rules retained from the architecture baseline:

- Claims, verdicts, evidence-weighting rules, and metric formulae stay in `src/core`, not in view or route modules.
- Routes validate input at the boundary and call repositories/domain functions; they do not reimplement metric semantics.
- Untrusted source content, raw answers, audit metadata, and uploaded HTML are escaped as text and never rendered as trusted HTML.
- No provider is shown as supported; provider labels are operator-supplied and every answer is labelled manual capture.
- Unknown, unavailable, partial, voided, and disputed states remain visible.
- Publication is not implemented. There is no owner-approval or public-page workflow in this milestone.
- CSRF, Host/Origin validation, CSP, loopback binding, body limits, and accessibility requirements are implemented and tested.

The separate `apps/api` process remains unimplemented; local routing lives in `src/app/http`. See [Local core architecture](../../docs/technical/LOCAL_CORE_ARCHITECTURE.md).
