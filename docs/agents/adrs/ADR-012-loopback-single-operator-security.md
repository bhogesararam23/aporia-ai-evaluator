# ADR-012: Adopt a Loopback-Only, Single-Operator Security Posture for v0.1

- Status: Proposed
- Date: 2026-10-28
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-008, ADR-011, ADR-013

## Context

The product’s long-term security model includes authenticated accounts, tenant isolation, provider credentials, object storage, and public publication. Local v0.1 has none of those external boundaries, but it still handles sensitive claims, evidence, raw AI answers, and uploaded HTML. Adding authentication and multi-tenancy now would expand scope and create the impression of security properties that have not been reviewed or tested.

A local web application is reachable by any process or webpage that can send requests to its port. Binding to all interfaces without authentication would expose private evaluation data to the network. Cross-site request forgery could trick a local browser into submitting forms. DNS rebinding could bypass naive origin assumptions. Malicious uploaded content could attempt script injection.

## Decision

1. The server binds only to loopback (`127.0.0.1`, with optional `::1`) on a configurable port. Non-loopback hosts, including `0.0.0.0`, LAN addresses, and hostnames, are rejected at startup. There is no “allow remote” flag in v0.1.
2. The HTTP layer validates the `Host` header against the configured loopback address and port. Requests with other hosts are rejected before routing, mitigating DNS-rebinding-style access.
3. All state-changing requests require a synchronizing CSRF token tied to a random, HttpOnly, `SameSite=Strict` session cookie. Tokens are compared in constant time. The cookie session secret is ephemeral per process; restarting the server invalidates outstanding forms. When an `Origin` header is present it must match the configured local origin. An opaque `Origin: null` is accepted because a browser or automated context may legitimately omit a comparable origin, while the mandatory synchronizer token and same-site cookie remain the primary CSRF controls. An explicit non-matching origin is rejected.
4. Responses set a restrictive Content Security Policy (`default-src 'none'`, self-hosted styles only, no inline or remote scripts), `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and `Permissions-Policy` restrictions. Dynamic HTML is escaped through a single rendering helper; external URLs are scheme-validated.
5. Request bodies, HTML uploads, field lengths, and JSON imports are bounded. SQL is parameterized; identifiers are not interpolated from user input. There is no user-controlled filesystem path or static file path. Uploaded HTML is stored as data and never executed or rendered raw.
6. There is no authentication, account recovery, role model, tenant boundary, TLS termination, or remote API. The UI labels the application as a local single-operator tool. Data confidentiality depends on the operating-system account and data-directory permissions.
7. The operator can export project data as JSON and delete a project through an explicit, typed confirmation. Deletion removes the project’s records, including its local audit trail; this behavior is disclosed. Logging records request metadata, status, duration, request ID, and stable error codes—not request bodies, raw answers, evidence excerpts, credentials, or cookies.
8. No secrets are required for v0.1. The session secret is generated in memory. Configuration values are documented without real credentials. Provider credentials are absent by design.
9. Any move to multi-user, remote, published, or provider-connected operation requires a new ADR covering authentication, authorization, tenant isolation, TLS, rate limiting, retention, and security review.

## Alternatives considered

1. **Bind to all interfaces for convenience.** Rejected: without authentication, it would expose private evaluation data to the network.
2. **Add password authentication now.** Deferred: it would create a partial identity system without recovery, rotation, audit, or review, and is outside the milestone.
3. **Rely on localhost being safe.** Rejected: browser-based CSRF and DNS rebinding still apply; host, origin, and CSRF controls are warranted.
4. **Use a full web framework’s defaults without explicit headers.** Rejected: critical headers and limits should be explicit and tested.
5. **Persist a session secret in the data directory.** Rejected for v0.1: an ephemeral secret is sufficient for short-lived local forms and avoids a new secret-storage requirement.

## Consequences and trade-offs

- The application cannot be shared on a LAN or deployed remotely without code change and a new security decision.
- Users lose unsaved forms after a server restart because CSRF sessions are ephemeral.
- No account separation exists; anyone with filesystem access to the data directory can read the database.
- The security posture is smaller and more testable, and it avoids implying production readiness.

## Security, privacy, safety, and evaluator-validity implications

- Local-only binding removes remote attack surface but does not protect against a compromised local account or malicious local process.
- Report exports contain the same sensitive data as the local database and must be handled by the user.
- CSV exports protect against spreadsheet formula injection by escaping leading formula characters.
- The audit trail supports review but is not tamper-evident against an operator with filesystem access.

## Implementation and migration plan

1. Add config validation that rejects non-loopback hosts.
2. Add host validation, security headers, CSRF sessions, body limits, and escaping helpers before any business form is implemented.
3. Add a project export and typed-confirmation deletion path.
4. Add tests for each control.
5. Document the local-only limitation and the path to a future security model.

## Tests and validation required

- Startup tests reject non-loopback hosts and invalid ports/data paths.
- Requests with a foreign `Host` header are rejected.
- State-changing requests without a valid CSRF token are rejected; valid tokens succeed.
- Oversized bodies and uploads receive a bounded error without crashing.
- Script payloads in project names, claims, evidence, citations, and audits are escaped; CSP and security headers are present.
- `javascript:` and non-HTTP(S) URLs are rejected for stored links.
- Project export works and deletion requires explicit confirmation.
- Logs do not contain request bodies or cookie values (verified by inspecting emitted log records in tests where practical).
