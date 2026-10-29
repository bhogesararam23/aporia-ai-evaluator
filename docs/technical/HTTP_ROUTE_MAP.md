# Local HTTP Route Map (v0.2)

- Status: Implemented
- Date: 2026-10-30
- Server: loopback-only `node:http`; no separate public API
- Authentication: none; local single-operator only
- CSRF: every POST requires a synchronizer token in `_csrf`; GETs do not mutate state

All project routes are scoped by `projectId` and resolve records only within that project. A valid project ID from another local project returns not found rather than leaking data across the scope.

## Pages and actions

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Project list / empty state |
| GET | `/health` | Local health and mode JSON |
| GET | `/assets/app.css` | Local stylesheet (no traversal; cacheable) |
| GET | `/favicon.ico` | Empty favicon response |
| GET | `/projects/new` | Create-project form |
| POST | `/projects` | Create project and optional target entity |
| GET | `/projects/:projectId` | Project overview, counts, recent activity |
| GET | `/projects/:projectId/edit` | Edit project profile form |
| POST | `/projects/:projectId/edit` | Update project name, description, site URL |
| GET | `/projects/:projectId/entities` | Entity list and add form |
| POST | `/projects/:projectId/entities` | Add entity |
| GET | `/projects/:projectId/entities/:entityId/edit` | Edit entity form |
| POST | `/projects/:projectId/entities/:entityId` | Update entity |
| POST | `/projects/:projectId/entities/:entityId/target` | Set project target entity |
| GET | `/projects/:projectId/activity` | Append-only audit events (most recent 100) |
| GET | `/projects/:projectId/export.json` | Project JSON export; audits the export |
| GET | `/projects/:projectId/delete` | Typed-name deletion confirmation |
| POST | `/projects/:projectId/delete` | Delete project and cascaded records |
| GET | `/projects/:projectId/claims` | Claim list |
| GET | `/projects/:projectId/claims/new` | Claim entry form |
| POST | `/projects/:projectId/claims` | Create claim and immutable revision 1 |
| GET | `/projects/:projectId/claims/:claimId` | Claim revision, propositions, evidence, assessments |
| POST | `/projects/:projectId/claims/:claimId/propositions` | Add proposition to the current revision |
| POST | `/projects/:projectId/claims/:claimId/revisions` | Create a new immutable revision and reset status |
| POST | `/projects/:projectId/claims/:claimId/status` | Validated claim transition/dispute |
| POST | `/projects/:projectId/claims/:claimId/propositions/:propositionId/evidence` | Add evidence and relationship |
| POST | `/projects/:projectId/claims/:claimId/propositions/:propositionId/assessments` | Add human proposition assessment |
| POST | `/projects/:projectId/claims/:claimId/propositions/:propositionId/relationships/:relationshipId/supersede` | Supersede relationship with history |
| GET | `/projects/:projectId/sources` | Source list |
| GET | `/projects/:projectId/sources/new` | Source entry form |
| POST | `/projects/:projectId/sources` | Create source |
| GET | `/projects/:projectId/query-sets` | Query-set list |
| GET | `/projects/:projectId/query-sets/new` | Draft query-set form |
| POST | `/projects/:projectId/query-sets` | Create draft query set |
| GET | `/projects/:projectId/query-sets/:setId` | Query set, queries, approval/clone controls |
| POST | `/projects/:projectId/query-sets/:setId/queries` | Add draft query |
| POST | `/projects/:projectId/query-sets/:setId/queries/:queryId/delete` | Remove draft query |
| POST | `/projects/:projectId/query-sets/:setId/approve` | Approve and freeze query set |
| POST | `/projects/:projectId/query-sets/:setId/clone` | Clone approved set into a new draft version |
| GET | `/projects/:projectId/runs` | Manual run list |
| GET | `/projects/:projectId/runs/new` | Create run form |
| POST | `/projects/:projectId/runs` | Create open run from approved set |
| GET | `/projects/:projectId/runs/:runId` | Run conditions, metrics preview, observations, controls |
| POST | `/projects/:projectId/runs/:runId/observations` | Add manual observation |
| POST | `/projects/:projectId/runs/:runId/observations/:observationId/citations` | Add citation |
| POST | `/projects/:projectId/runs/:runId/observations/:observationId/void` | Void observation with reason |
| POST | `/projects/:projectId/runs/:runId/observations/:observationId/citations/:citationId/void` | Void citation with reason |
| POST | `/projects/:projectId/runs/:runId/observations/:observationId/assessments` | Add observation assessment |
| POST | `/projects/:projectId/runs/:runId/finalize` | Finalize run |
| POST | `/projects/:projectId/runs/:runId/cancel` | Cancel run with reason |
| POST | `/projects/:projectId/runs/:runId/import` | Atomic JSON observation import |
| GET | `/projects/:projectId/audits` | Local HTML audit list |
| GET | `/projects/:projectId/audits/new` | Paste/upload HTML form |
| POST | `/projects/:projectId/audits` | Parse and store local audit |
| GET | `/projects/:projectId/audits/:auditId` | Audit findings, unavailable checks, metadata |
| GET | `/projects/:projectId/audits/:auditId/export.json` | Audit JSON export; audits the export |
| GET | `/projects/:projectId/reports` | Report list and generation form |
| POST | `/projects/:projectId/reports` | Generate immutable project snapshot |
| GET | `/projects/:projectId/reports/:reportId` | Readable snapshot report |
| GET | `/projects/:projectId/reports/:reportId/export.json` | Snapshot JSON export; audits the export |
| GET | `/projects/:projectId/reports/:reportId/metrics.csv` | Metrics CSV; audits the export |
| GET | `/projects/:projectId/reports/:reportId/findings.csv` | Findings CSV; audits the export |
| GET | `/projects/:projectId/reports/:reportId/observations.csv` | Observation evidence CSV; audits the export |
| GET | `/projects/:projectId/achievements` | Achievement record list and draft/approval state |
| GET | `/projects/:projectId/achievements/new` | Create-achievement form from project claims and evidence |
| POST | `/projects/:projectId/achievements` | Create a draft achievement with revision 1 |
| GET | `/projects/:projectId/achievements/:achievementId` | Current revision preview, claims, contributors, evidence, contradictions, approval and history |
| GET | `/projects/:projectId/achievements/:achievementId/revisions/new` | New-revision form prefilled from the current revision |
| POST | `/projects/:projectId/achievements/:achievementId/revisions` | Create a new immutable revision; approval does not carry forward |
| GET | `/projects/:projectId/achievements/:achievementId/revisions/:revisionId` | Historical revision preview |
| POST | `/projects/:projectId/achievements/:achievementId/approve` | Approve the current revision with a note and exact title; audits the approval |
| GET | `/projects/:projectId/achievements/:achievementId/export.html` | Approved current revision HTML; audits the export; 409 when unapproved |
| GET | `/projects/:projectId/achievements/:achievementId/export.jsonld` | Approved current revision JSON-LD; audits the export; 409 when unapproved |

## Response and failure behavior

- POST success returns 303 to a project-scoped page with a notice; re-submitting the same form is not a supported idempotency mechanism.
- Validation failure returns 422 with escaped field errors and preserved values (except file inputs).
- Missing scoped records return 404; invalid state changes return 409; forbidden host/origin/CSRF returns 403; oversized bodies return 413; unsupported content types return 415.
- HTML responses receive CSP, `nosniff`, frame denial, no-referrer, permissions restrictions, and no-store. JSON/CSV downloads also receive no-store and an attachment filename.
- Achievement approval failures return 422 with preserved values; an unapproved or non-current export returns 409; downloads are attachments and are audited only after generation succeeds.
- Internal errors return a generic page with a request ID; no stack trace is shown.

## Absent routes

There are no provider-call, remote-fetch, publication, OAuth, billing, analytics, public-sharing, or HTTP backup/restore endpoints. See [Known Limitations](../KNOWN_LIMITATIONS.md).
