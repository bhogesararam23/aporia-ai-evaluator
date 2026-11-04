# Testing and Verification Guide

- Status: Local checks passing; the full local workflow is verified against the running application, and both checks and the workflow now run in CI across Windows, Linux and macOS
- Date: 2026-11-04
- Runtime used: Node.js v24.13.1; npm 11.8.0. Automated results below were measured on Windows x64; `.github/workflows/ci.yml` runs `npm run check` and `npm run verify:workflow` on a Node 24 Windows/Linux/macOS matrix.
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

Two verification commands are deliberately outside `npm run check`, because they need a port and a
temporary directory rather than only an in-memory database:

```bash
npm run verify:workflow   # boots the server on a free loopback port against a fresh temp data dir
npm run benchmark -- --corpus <dir>   # scores a corpus of reviewed cases you supply
npm run benchmark:case -- scaffold --stratum <S> | validate --corpus <dir> | normalise ... | provenance ...
```

`benchmark:case` supports local corpus authoring without fabricating anything: `scaffold` writes a
non-scoreable template (refused by `validate`), `normalise` canonicalises valid cases for a
reproducible import/export, and `provenance` reports reviewer labels, disagreements and scoped
adjudications as the operator's own assertions.

`verify:workflow` drives §6's 24-step sequence by submitting the forms the running application served:
it reads each form's action, method, field names, select choices and default values from the returned
HTML, and treats a field it cannot fill, or a value the page never offered, as a failure of that step.
It exits zero only when every step passed and none was left unrun, so a step that could not be
completed stays visibly unverified. `npm run check` alone does not prove the browser workflow works —
four defects found in v0.4 were invisible to it, because the suite composed its own URLs instead of
reading the pages.

The project has no build step: Node runs the TypeScript sources and `tsc --noEmit` checks types. There is no frontend bundler and no generated build directory.

## 3. Automated suite map

| Suite | Examples | What it verifies |
|---|---|---|
| Unit: core vocabulary and lifecycle | `tests/unit/vocabulary.test.ts`, `lifecycle.test.ts` | Controlled labels, descriptions, allowed transitions |
| Unit: validation and inputs | `validation.test.ts`, `inputs.test.ts` | Unsafe URLs, dates, text limits, enums, reviewer fields, cross-field rules |
| Unit: evidence rule | `evidence.test.ts` | Every precedence branch, duplicate-source caveats, human/rule disagreement — all under the `evidence-aggregation-v1` default |
| Unit: corroboration by underlying source (ADR-025) | `source-identity.test.ts`, `evidence-aggregation-v2.test.ts` | Conservative canonical-URI normalisation (scheme/host case, default port, `www.`, fragment, tracking params, trailing slash, path case) and its source-id fallback; `evidence-aggregation-v2` collapsing `RELATED` copies and two records of one canonical URI to a single corroborating source; `UNKNOWN` keeping its caveat; status precedence unchanged; `v1` output byte-identical; `apparentCorroboratingSourceCount` naming the `v1` figure |
| Unit: metrics v1–v4 | `metrics.test.ts`, `claim-metrics.test.ts`, `claim-eligibility.test.ts` | Observation-level denominators, exclusions, nulls, latest assessments, no composite score, determinism, intent-group coverage, repeated intents, untested groups, partial assessment; statement-level eligibility per relevance, voided/unrelated/refusal/abstention/omission exclusions, label-relevance conflicts, citation mappings that stop counting when the citation is withdrawn, and the separate review-progress counts |
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
| Integration: rendered form actions | `form-actions.test.ts`, `citation-void-visibility.test.ts` | Every form on 24 reachable pages posts to a registered route with a floor on how many forms were inspected; the workspace's link, mapping, assessment, revise, void and both supersede forms are submitted through the action the page rendered and must be accepted; a withdrawn citation keeps its reason visible and its mapping retained into a report |
| Integration: statement workflows and provenance | `answer-claim-workflows.test.ts`, `findings-workflows.test.ts`, `report-retest-parity.test.ts`, `project-export-findings.test.ts` | Decomposition, revision, linking, mapping and assessment lifecycles; finding lifecycle, references and retest recording; the report summary and the retest comparison computing identical figures for one finalized run; the portable export carrying the backlog with its comparison, focus metric and cited status |
| Integration: schema enforcement for evaluator integrity | `schema-evaluator-integrity.test.ts`, `schema-answer-claims.test.ts`, `schema-assessments.test.ts` | Trigger-level refusal of label/relevance pairings and off-axis relations, a citation mapping that requires a live citation, and a guard that parses the migration SQL and compares it with the TypeScript table definitions so the two cannot drift |
| Integration: migration, upgrade and backup lifecycle | `migrations.test.ts`, `upgrade-v03-to-v04.test.ts`, `backup-restore.test.ts`, `backup-cli.test.ts` | Checksummed applied migrations, a populated v0.3 database upgraded to v0.4 with its stored snapshots untouched, manifest counts for the v0.4 tables, restore into an empty directory, refusal to overwrite live data without confirmation, rollback |
| Integration: query-count and write-atomicity measurement | `query-counts.test.ts`, `write-atomicity.test.ts`, `audit-atomicity.test.ts` | Measured statement counts that must not grow with the number of records, and every multi-record write path rolling back as one unit when a later step or the audit append fails |
| Unit: report compatibility | `report-compatibility.test.ts`, `reporting-snapshot.test.ts` | `metrics-v1` to `v4` and `report-template-v1` to `v4` snapshots rendering the figures they were stored with, absent blocks shown as not recorded rather than zero, and the review-progress wording following the version that produced the snapshot |
| Unit and integration: benchmark contract | `benchmark-validate.test.ts`, `benchmark-source-identity.test.ts`, `benchmark-cli.test.ts` | Nested field-by-field corpus validation, evidence versus underlying-source identity, reviewer disagreement staying unresolved rather than becoming a manufactured consensus, adjudication scoping, and a harness that refuses to present an accuracy claim from synthetic or insufficient material |
| Architecture and policy | `boundaries.test.ts`, `docs-links.test.ts`, `no-network.test.ts` | Layer boundaries, relative documentation links, no external network/provider client code |

Most tests use in-memory SQLite and temporary data directories. No test writes to the production `data/` directory. Test fixtures are isolated from the shipped application; the application starts with no seeded projects, claims, runs, or reports.

## 4. Results at the time of this document

Measured on 2026-11-04 in this checkout (`feat/aporia-local-core-v0.5-evaluation-reliability`), Node
v24.13.1, npm 11.8.0 (local figures taken on Windows x64; the CI matrix confirms all three OSes):

- `npm ci`: pass.
- `npm run typecheck`: pass.
- `npm run lint`: pass.
- `npm run format:check`: pass.
- `npm run check:boundaries`: pass.
- `npm test`: **713 tests, 713 passing, 0 failing** — 393 under `tests/unit`, 320 under
  `tests/integration`, counted by running each glob separately rather than inferred.
- `npm run check`: exit 0 with the same 713/713 result.
- `npm run verify:workflow`: exit 0, **25 step entries passed, 0 failed, 0 left not-run**, against a
  server booted on a free loopback port with a fresh temporary data directory. `/health` reported
  `0.4.0` (the v0.5 work is additive; the release version is not bumped while ADR-025 stays Proposed).
  The run entered every record by hand through the served forms; nothing was seeded, and no
  provider or network call was made.
- CI (`.github/workflows/ci.yml`): `npm run check` and `npm run verify:workflow` each run on Windows,
  Linux and macOS runners on Node 24. Confirmed green on v0.5 run `41807701771` — all six jobs passed,
  including the 25-step live workflow on every platform.
- Backup, verification, restore into a separate temporary directory, restart on the restored data, and
  a read-back of the restored statements, both reports, and the finding with its recorded comparison
  all completed inside that same run (steps 22–24).
- Earlier runs of this workflow recorded the specific refusals it depends on rather than assuming
  them: a reviewer description claiming a verbatim position, a quote absent from the captured answer, a
  `REFUSED` fidelity label filed against a statement that addresses the target, a measured status with
  no comparison behind it, a hand-built transition citing a comparison that measured something else,
  and a restore over live data without `--replace --confirm`.

Four defects came out of the workflow run rather than out of the audit, all of them in code the
documentation described as working: two sets of statement-workspace forms posted to paths with an
extra segment and returned 404, a withdrawn citation's reason was stored but never displayed, and the
project export omitted the entire remediation backlog. Each is fixed and each has a regression test
that fails against the earlier code. That gap is the reason `verify:workflow` exists: the automated
suite composed its own URLs from repository identifiers, so it exercised routes the browser never
reached.

The final session report records the exact checks and any later test-count change. A check that is not
run must be recorded as not run; it must not be described as passing. Test counts in this document are
never copied forward from an earlier checkout without re-running the current one.

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
- project deletion requiring exact typed confirmation;
- a refusal, abstention, ambiguity, unrelated remark, or voided statement being counted as a factual
  verdict — refused at the pure calculation, the form validator, the repository transaction and a SQLite
  trigger, so no layer can be bypassed by another caller;
- an omission relationship recorded against a statement that engages the target, and a citation mapping
  pointing at a withdrawn citation;
- a retest status that cites no comparison, cites a comparison belonging to another finding or project,
  or cites one that measured a different outcome; and a client submitting an outcome the stored runs do
  not produce;
- a benchmark corpus whose reviewer labels disagree being reported as agreement, a single reviewer being
  treated as consensus, an ambiguous subject being scored as ordinary gold, or evidence and its
  underlying source being collapsed into one identity;
- a multi-record write that fails partway, checked by injecting the failure into each of the fifteen
  write paths and confirming nothing was persisted and no audit event was left behind;
- a reader whose query count grows with the number of records it loads, measured before and after the
  batched statement read;
- a rendered form whose action does not resolve, which is how the two 404 defects were caught.

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

`.github/workflows/ci.yml` runs `npm ci` and `npm run check` on Node 24 for every push to the
milestone branch, which is the same gate as locally: typecheck, lint, formatting, boundaries, and all
691 tests. The first hosted run was
[40773185352](https://github.com/bhogesararam23/aporia-ai-evaluator/actions/runs/40773185352) at commit
`38d3006`; since then each checkpoint has been confirmed before the next push, and no checkpoint was
pushed while an earlier one was failing. Runs cited in the v0.4 session report are per checkpoint. The
most recent at the time of writing is
[41389015942](https://github.com/bhogesararam23/aporia-ai-evaluator/actions/runs/41389015942) at
`b22b5fb`, **success**.

`npm run verify:workflow` is **not** part of the CI job. It binds a loopback port and creates temporary
directories, which is not what the hosted runner is for, and a workflow check that silently cannot
start would look like a pass. It is run locally per milestone and its result is recorded in the session
report; the automated HTTP workflow tests that do run in CI are the ones that read rendered form actions
rather than assembling URLs.

## 8. Adding tests

- Put pure domain behavior in `tests/unit` and persistence/HTTP behavior in `tests/integration`.
- Prefer real SQLite transactions and real HTTP form submissions over mocks for boundary behavior.
- Keep fixtures small, synthetic, and isolated; never ship test fixtures as application records.
- Add a regression test for every defect and every change to a metric, verdict, eligibility rule, or security boundary.
- Do not relax a test to make a build green without recording why the behavior is correct.
