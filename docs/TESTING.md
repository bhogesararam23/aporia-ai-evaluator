# Testing and Verification Guide

- Status: Local checks passing
- Date: 2026-10-30
- Runtime used: Node.js 24.13.1 on Windows x64; npm 11.8.0
- Test runner: `node --test` with native TypeScript type stripping

## 1. Prerequisites

- Node.js 24 or later (the project uses `node:sqlite` and native `.ts` execution).
- npm.
- No provider API keys, network connection, database server, or browser is required for automated tests.

The `node:sqlite` driver emits an experimental warning. That warning is expected in this Node release and is not a test failure.

## 2. Commands

```bash
npm ci
npm run typecheck
npm run lint
npm run format:check
npm run check:boundaries
npm test
npm run check          # runs all of the above in sequence
```

The application itself:

```bash
npm start              # serves http://127.0.0.1:4310 by default
npm run dev            # auto-restarts on source changes
```

The project has no build step: Node runs the TypeScript sources and `tsc --noEmit` checks types. There is no frontend bundler and no generated build directory.

## 3. Automated suite map

| Suite | Examples | What it verifies |
|---|---|---|
| Unit: core vocabulary and lifecycle | `tests/unit/vocabulary.test.ts`, `lifecycle.test.ts` | Controlled labels, descriptions, allowed transitions |
| Unit: validation and inputs | `validation.test.ts`, `inputs.test.ts` | Unsafe URLs, dates, text limits, enums, reviewer fields, cross-field rules |
| Unit: evidence rule | `evidence.test.ts` | Every precedence branch, duplicate-source caveats, human/rule disagreement |
| Unit: metrics v2 | `metrics.test.ts` | Denominators, exclusions, nulls, latest assessments, no composite score, determinism, intent-group coverage, repeated intents, untested groups, partial assessment |
| Unit: website parsing | `website.test.ts` | Metadata, JSON-LD, noindex, visible-text mismatch, size/encoding limits, determinism, active-content inertness |
| Unit: report snapshots and exports | `reporting-snapshot.test.ts`, `reporting-csv.test.ts` | Reproducible snapshots, comparisons, unknown states, CSV quoting/formula injection, JSON round-trip |
| Unit: achievement validation and exports | `achievements.test.ts`, `achievement-export.test.ts` | Draft validation, contributor roles/states, claim evidence states, canonical content, HTML escaping, JSON-LD consistency, script-breakout and active-URL refusal |
| Integration: achievements | `repositories-achievements.test.ts`, `achievement-workflows.test.ts` | Revision snapshots, claim immutability, hash-bound approval, cross-project refusal, deletion cascade, draft/approved/historical previews, CSRF, duplicate approval, HTML/JSON-LD downloads |
| Integration: backup and restore | `backup-restore.test.ts`, `backup-cli.test.ts` | Consistent snapshots, manifest validation, corrupt/bad-report refusal, overwrite guards, safety backup, rollback, digest/count/schema mismatch, real CLI backup/restore |
| Integration: atomicity and migration identity | `audit-atomicity.test.ts`, `migrations.test.ts` | Primary insert + audit rollback for project, claim, source, query set, run, website audit, achievement; renamed applied migration refusal |
| Unit: HTTP and security helpers | `security.test.ts`, `body.test.ts`, `router.test.ts`, `views.test.ts` | Host/Origin/CSRF, multipart limits, route matching, HTML escaping, labels |
| Integration: configuration and database | `config.test.ts`, `db.test.ts`, `migrations.test.ts` | Loopback-only config, WAL/pragmas, transactions/savepoints, checksummed migrations, rollback |
| Integration: schema | `schema-*.test.ts` | Foreign keys, immutable revisions, status transitions, frozen query sets/runs, append-only assessments, report supersession, achievement snapshot/approval triggers |
| Integration: repositories | `repositories-*.test.ts` | CRUD/scoping, evidence supersession, run finalization, project export data, cross-project rejection |
| Integration: achievements and exports | `achievement-workflows.test.ts`, `repositories-achievements.test.ts`, `achievement-export.test.ts`, `schema-achievements.test.ts` | Draft/approval/export workflow, revision history, cross-project isolation, hash-bound approval, HTML/JSON-LD visible-content consistency, script-breakout escaping, record immutability |
| Integration: backup and restore | `backup-restore.test.ts`, `backup-cli.test.ts` | Read-only snapshot with manifest, digest/count/schema validation, overwrite protection, safety backup, rollback, achievement survival, CLI backup/restore/verify |
| Integration: HTTP workflows | `project-workflows.test.ts`, `claim-workflows.test.ts`, `evaluation-workflows.test.ts` | Real form submissions, CSRF, XSS escaping, project/entity editing, claim disputes/revisions, query-set approval/cloning, observation/import, assessment, finalization, reports, upload, report export headers, download audit events |
| Integration: safety and accessibility | `accessibility.test.ts`, `report-immutability.test.ts`, `audit-upload.test.ts`, `http-security.test.ts` | Labels/structure across every page, immutable snapshots, file extension, encoding and mixed-input rejection, asset traversal, CSRF token presence, no seeded records |
| Architecture and policy | `boundaries.test.ts`, `docs-links.test.ts`, `no-network.test.ts` | Layer boundaries, relative documentation links, no external network/provider client code |

Most tests use in-memory SQLite and temporary data directories. No test writes to the production `data/` directory. Test fixtures are isolated from the shipped application; the application starts with no seeded projects, claims, runs, or reports.

## 4. Results at the time of this document

- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npm run format:check`: pass.
- `npm run check:boundaries`: pass.
- `npm test`: **335 passing tests, 0 failing**.
- Local v0.2 browser and command-line verification (2026-10-30): a fresh `APORIA_DATA_DIR` on loopback was driven through project, claim, proposition, source, evidence, achievement draft, explicit approval, HTML/JSON-LD downloads, backup, verification, restore into a fresh directory, and serving the restored record and exports. The database was not seeded; every record was entered through the running application.
- Earlier v0.1 browser verification found an opaque `Origin: null` form submission rejected by the origin check; the server accepts opaque origins while still requiring a valid synchronizing CSRF token, and a unit test covers this. The v0.2 run did not change that behavior.

The final session report records the exact checks and any later test-count change. A check that is not run must be recorded as not run; it must not be described as passing.

## 5. Coverage of important failure cases

The suite explicitly covers:

- provider/capture errors, refusals, no-answer, timeout, blocked, unavailable;
- voided observations and citations, with retained originals;
- missing citation metadata and zero-citation captures;
- unassessed answer dimensions and null rates;
- contradictory evidence, human/rule disagreement, and supersession history;
- query sets that are empty, approved, frozen, or cloned;
- finalized runs rejecting changes;
- rejected Host, Origin, CSRF, oversized bodies, malformed multipart, non-HTML upload extensions;
- script/HTML injection attempts in project names, claim text, fields, and reports;
- report snapshots that remain unchanged after new evidence;
- cross-project lookups returning not found rather than leaking another project’s data;
- project deletion requiring exact typed confirmation.

## 6. Not tested

- Live provider or search integrations — none exist.
- Remote URL fetching, robots.txt, sitemaps, rendered pages, or live link health — intentionally absent.
- Screen-reader traversal with NVDA/JAWS/VoiceOver; automated structural checks are not a substitute.
- Safari, Firefox, mobile browsers, or touch-only interaction.
- macOS and Linux installations in this session.
- Concurrent users, multi-tenant isolation, rate limits, load, or performance at scale.
- Crash recovery or power-loss durability; restore tests cover corrupt files and deliberate failures, not every filesystem failure mode.
- Security penetration testing, legal/privacy review, or production deployment.
- Benchmark calibration, confidence intervals, gold-set accuracy, or public performance claims.

## 7. CI

The repository runs the same gate in `.github/workflows/ci.yml` using Node 24 and `npm ci`, `npm run check`. The first hosted run was [40773185352](https://github.com/bhogesararam23/aporia-ai-evaluator/actions/runs/40773185352) at commit `38d3006`. The final checkpoint run [40775144790](https://github.com/bhogesararam23/aporia-ai-evaluator/actions/runs/40775144790) at `4dae6ce` was also **success**, with install, typecheck, lint, formatting, boundaries, and all 266 tests passing.

## 8. Adding tests

- Put pure domain behavior in `tests/unit` and persistence/HTTP behavior in `tests/integration`.
- Prefer real SQLite transactions and real HTTP form submissions over mocks for boundary behavior.
- Keep fixtures small, synthetic, and isolated; never ship test fixtures as application records.
- Add a regression test for every defect and every change to a metric, verdict, eligibility rule, or security boundary.
- Do not relax a test to make a build green without recording why the behavior is correct.
