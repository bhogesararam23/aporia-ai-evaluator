# Agent Session Report — YYYY-MM-DD — Short Label

## 1. Session metadata
- Date/time and timezone:
- Task or request:
- Repository:
- Branch:
- Starting commit:
- Operator/context:
- Session status: completed / partial / blocked / no-change

## 2. Objective and scope
Describe the intended result, in-scope files/services, and explicit out-of-scope work.

## 3. Initial state
Record what was actually inspected: branch status, relevant files, recent commits, available tests, and any access limitations. Do not infer unseen state.

## 4. Changes made
| Path | Action | Purpose | Validation |
|---|---|---|---|
| path | added/changed/removed | why | check performed or not run |

List code, docs, configuration, data/schema, and policy changes separately when useful.

## 5. Decisions and ADRs
- ADRs created/updated:
- Decisions made within existing policy:
- Decisions deferred for owner approval:
- Alternatives rejected and why:

## 6. Validation
For each check, name the exact command/tool/method and result.
- Automated tests:
- Lint/type/style:
- Security checks:
- Link/reference validation:
- Provider live tests:
- Manual review:
- Not run and why:

Separate local/fixture validation from live provider validation. Do not claim a successful test without an observable result.

## 7. Evidence and external sources
List primary sources consulted, the claim supported by each source, and when verified. If no external sources were needed, state that.

## 8. Risks and limitations
Include untested assumptions, provider limitations, data/security implications, uncertain decisions, and known failure cases.

## 9. Commit and publication
- Commit SHA:
- Commit URL:
- Files included:
- Push/branch result:
- Pull request URL, if applicable:
- Any failed or partial write:

## 10. Handoff
List the next concrete steps in priority order, blockers, owner decisions needed, and where a future agent should resume.

## 11. Integrity statement
This report records actions observed in this session. It must not claim tests, reviews, approvals, external checks, or deployments that did not occur.
