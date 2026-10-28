# API and orchestration boundary

**Status: Not implemented as a separate process for local v0.1.**

Local v0.1 does not expose a public or multi-user API. Its HTTP request pipeline, validation, CSRF/Host/Origin checks, transaction orchestration, and report access live inside the single local process under `src/app/http` and `src/app/routes`.

The boundary rules still apply to any future API:

- Authenticate and authorize every project/report/upload access server-side.
- Validate requests and apply bounded limits before work starts.
- Keep evaluator scoring out of route handlers.
- Pass plan-neutral job specifications to the evaluator; commercial state must never affect verdicts or metrics.
- Keep provider credentials out of client payloads, queue messages, and logs.
- Audit publication, deletion, attribution changes, exports, and connector writes.

No quota, job queue, background worker, or public API exists in this milestone. See [Security and privacy](../../docs/security/SECURITY_PRIVACY.md) and [API and job contract guidance](../../docs/technical/API_AND_JOB_CONTRACTS.md).
