# Work Intake and Delivery Standard

- **Status:** Proposed standard for owner adoption.
- **Purpose:** Convert product ideas, defects, research findings, and operational risks into bounded, reviewable work.

## Work-item types

Choose one primary type: **bug** (observed behavior violates a contract), **product change** (new or changed user behavior), **research** (uncertainty must be resolved before implementation), **security/privacy/safety risk**, **reliability/technical debt**, or **documentation/governance**.

## Required framing

For non-trivial work, record:
- user/problem statement and affected workflow;
- evidence, current behavior, and expected outcome;
- directly responsible individual (DRI), dependencies, and priority rationale;
- acceptance criteria that can be checked;
- explicit non-goals and known failure cases;
- impacted ADRs, contracts, data, providers, privacy/security/safety, and cost;
- verification plan, observability, migration/compatibility, and rollback where relevant.

Small corrections may use a lightweight description, but must still explain the intended change and validation.

## Triage and priority

- **P0:** active severe security, privacy, safety, or data-integrity incident; follow incident handling.
- **P1:** core workflow blocked, materially incorrect verdict/report, or release-blocking defect.
- **P2:** important defect or improvement with a reasonable workaround.
- **P3:** low-impact polish or deferred enhancement.

Priority describes impact, not a promise of response time. Do not publish service-level commitments without an operating capability and owner-approved target.

## Delivery states

Use distinct states: **proposed → ready → in progress → blocked (when applicable) → in review → accepted → released**. Not every change needs every state. A merge does not mean a feature is deployed or its outcome validated.

## Completion and handoff

Link acceptance criteria to test results, code, evidence, or an explicit owner decision. Record checks not run and why. Document remaining risks, follow-up work, and the exact revision. Do not close work solely because code was written or documentation was added.
