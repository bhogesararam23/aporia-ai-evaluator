# Session Report — Repository Operating Model

- Date: 2026-10-28
- Base revision: `94fb59563787e2d78e06f863d344f77efa24d7a9`
- Scope: documentation and GitHub issue intake metadata only
- Application code changed: no
- Accepted ADRs rewritten: no

## Work prepared

Added an explicit operating model, work-intake standard, risk-based quality gates, product/evaluator specifications for external reputation, query answerability, remediation/retesting, reporting, and website-only scope. Added structured issue forms and additive links/guidance in existing repository documentation.

## Validation and limitations

- The source branch was inspected before changes were prepared.
- Existing policy and accepted ADRs are preserved; no new architecture decision is implied by these specifications.
- YAML and relative Markdown links should be checked against the resulting branch before merge.
- GitHub branch protection, required reviews/checks, CODEOWNERS enforcement, and release permissions are not changed by these files and must be verified separately.
- These documents define intended behavior; they do not claim that application functionality, CI, deployment, or live-provider validation exists.

## Handoff

Review the proposed pull request and verify all links and issue forms. Resolve open product/architecture questions before implementing functionality. Merge only after the applicable checks and owner review.
