# API and orchestration boundary

**Status: Planned package — not yet implemented.**

This application boundary is reserved for authentication, authorization, input validation, job scheduling, quota checks, and report access. It sequences work but must not be the source of truth for claim/evidence scoring.

The API may check whether a user is allowed to start a job before dispatch. Once authorized, the job specification passed to the evaluator must be plan-neutral. Keep provider credentials server-side; never put credentials in client payloads or queue messages.

Every protected route must verify tenant/project access on the server. Public publication, attribution changes, deletion, and connector writes require explicit authorization and an audit event. Follow API and job contracts in docs/technical/API_AND_JOB_CONTRACTS.md.
