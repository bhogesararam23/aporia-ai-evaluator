import {
  validateConfirmationName,
  validateEntityInput,
  validateProjectInput,
  validateProjectUpdateInput,
} from '../../core/inputs.ts';
import {
  CLAIM_STATUS_LABELS,
  ENTITY_TYPES,
  ENTITY_TYPE_LABELS,
  IDENTITY_STATUSES,
  IDENTITY_STATUS_DESCRIPTIONS,
  IDENTITY_STATUS_LABELS,
} from '../../core/vocabulary.ts';
import type { ValidationIssue } from '../../core/validation.ts';
import { AppError } from '../../errors.ts';
import { appendAuditEvent, listAuditEvents } from '../../persistence/audit.ts';
import { listClaims } from '../../persistence/repositories/claims.ts';
import { listSources } from '../../persistence/repositories/evidence.ts';
import {
  createEntity,
  createProject,
  deleteProject,
  getEntity,
  getProjectOrThrow,
  listEntities,
  setTargetEntity,
  updateEntity,
  updateProject,
} from '../../persistence/repositories/projects.ts';
import { listQuerySets } from '../../persistence/repositories/querySets.ts';
import { listReports } from '../../persistence/repositories/reports.ts';
import { listRuns } from '../../persistence/repositories/runs.ts';
import { listWebsiteAudits } from '../../persistence/repositories/websiteAudits.ts';
import { exportProject } from '../reportingService.ts';
import { htmlResponse, jsonResponse, redirectWithNotice } from '../http/responses.ts';
import { writeContext, type RouteDefinition } from '../http/types.ts';
import {
  csrfField,
  definitionRow,
  emptyState,
  errorSummary,
  formatDateTime,
  humanize,
  pageHeader,
  plural,
  selectField,
  statusBadge,
  submitButton,
  textField,
  textareaField,
  valueOf,
  type Values,
} from '../views/components.ts';
import { html, type Html } from '../views/html.ts';
import { layout, projectNav } from '../views/layout.ts';

function page(
  title: string,
  body: Html,
  options: { notice?: string | null; projectId?: string; current?: string } = {},
): Html {
  return layout({
    title,
    body,
    notice: options.notice ?? null,
    ...(options.projectId === undefined
      ? {}
      : {
          navigation: projectNav({
            projectId: options.projectId,
            current: options.current ?? 'overview',
          }),
        }),
  });
}

function projectForm(options: {
  values: Values;
  issues: readonly ValidationIssue[];
  action: string;
  csrfToken: string;
  submitLabel: string;
}): Html {
  return html`
    <div class="form-narrow">
      ${errorSummary(options.issues)}
      <form method="post" action="${options.action}" novalidate>
        ${csrfField(options.csrfToken)}
        ${textField({
          name: 'name',
          label: 'Project name',
          value: valueOf(options.values, 'name'),
          issues: options.issues,
          required: true,
          maxLength: 200,
          help: 'A concise local label for this workspace. It is not a public claim.',
        })}
        ${textareaField({
          name: 'description',
          label: 'Description',
          value: valueOf(options.values, 'description'),
          issues: options.issues,
          maxLength: 4000,
          rows: 3,
          help: 'What this project is evaluating, and any important scope notes.',
        })}
        ${textField({
          name: 'primaryDomain',
          label: 'Primary site URL (optional)',
          value: valueOf(options.values, 'primaryDomain'),
          issues: options.issues,
          type: 'url',
          maxLength: 2048,
          help: 'A URL you control or are authorized to discuss. Aporia does not fetch it in local v0.1.',
        })}
        <fieldset>
          <legend>Target entity (optional)</legend>
          <p class="field-help">
            The person, organization, product, repository, or artifact the project concerns. Adding
            one records a self-declared label, not verified identity.
          </p>
          ${textField({
            name: 'targetEntityName',
            label: 'Entity name',
            value: valueOf(options.values, 'targetEntityName'),
            issues: options.issues,
            maxLength: 200,
          })}
          ${selectField({
            name: 'targetEntityType',
            label: 'Entity type',
            value: valueOf(options.values, 'targetEntityType'),
            issues: options.issues,
            includeBlank: 'No target entity',
            options: ENTITY_TYPES.map((type) => ({ value: type, label: ENTITY_TYPE_LABELS[type] })),
          })}
        </fieldset>
        <div class="form-actions">
          ${submitButton(options.submitLabel)}
          <a class="button button-secondary" href="/">Cancel</a>
        </div>
      </form>
    </div>
  `;
}

function projectEditForm(options: {
  values: Values;
  issues: readonly ValidationIssue[];
  action: string;
  csrfToken: string;
}): Html {
  return html`
    <div class="form-narrow">
      ${errorSummary(options.issues)}
      <form method="post" action="${options.action}" novalidate>
        ${csrfField(options.csrfToken)}
        ${textField({
          name: 'name',
          label: 'Project name',
          value: valueOf(options.values, 'name'),
          issues: options.issues,
          required: true,
          maxLength: 200,
        })}
        ${textareaField({
          name: 'description',
          label: 'Description',
          value: valueOf(options.values, 'description'),
          issues: options.issues,
          rows: 3,
          maxLength: 4000,
        })}
        ${textField({
          name: 'primaryDomain',
          label: 'Primary site URL (optional)',
          value: valueOf(options.values, 'primaryDomain'),
          issues: options.issues,
          type: 'url',
          maxLength: 2048,
          help: 'A URL you control or are authorized to discuss. Aporia does not fetch it.',
        })}
        <div class="form-actions">${submitButton('Save project profile')}</div>
      </form>
    </div>
  `;
}

function entityForm(options: {
  values: Values;
  issues: readonly ValidationIssue[];
  action: string;
  csrfToken: string;
  submitLabel: string;
  cancelHref: string;
}): Html {
  return html`
    <div class="form-narrow">
      ${errorSummary(options.issues)}
      <form method="post" action="${options.action}" novalidate>
        ${csrfField(options.csrfToken)}
        ${selectField({
          name: 'type',
          label: 'Entity type',
          value: valueOf(options.values, 'type'),
          issues: options.issues,
          required: true,
          includeBlank: 'Choose a type',
          options: ENTITY_TYPES.map((type) => ({ value: type, label: ENTITY_TYPE_LABELS[type] })),
        })}
        ${textField({
          name: 'canonicalName',
          label: 'Canonical name',
          value: valueOf(options.values, 'canonicalName'),
          issues: options.issues,
          required: true,
          maxLength: 200,
        })}
        ${textareaField({
          name: 'alternateNames',
          label: 'Alternate names (optional)',
          value: valueOf(options.values, 'alternateNames'),
          issues: options.issues,
          rows: 3,
          help: 'One per line or comma-separated. Useful for namesakes and aliases.',
        })}
        ${textareaField({
          name: 'publicUrls',
          label: 'Public URLs (optional)',
          value: valueOf(options.values, 'publicUrls'),
          issues: options.issues,
          rows: 3,
          help: 'One absolute HTTP or HTTPS URL per line. These are labels, not verified evidence.',
        })}
        ${selectField({
          name: 'identityStatus',
          label: 'Identity status',
          value: valueOf(options.values, 'identityStatus', 'UNVERIFIED'),
          issues: options.issues,
          required: true,
          options: IDENTITY_STATUSES.map((status) => ({
            value: status,
            label: IDENTITY_STATUS_LABELS[status],
          })),
          help: 'Aporia v0.1 performs no independent identity or account-control verification.',
        })}
        ${textareaField({
          name: 'identityMethod',
          label: 'Identity method / basis (optional)',
          value: valueOf(options.values, 'identityMethod'),
          issues: options.issues,
          rows: 2,
          maxLength: 500,
          help: 'Describe exactly what was checked, or state that nothing was independently checked.',
        })}
        ${textareaField({
          name: 'identityScope',
          label: 'Identity scope (optional)',
          value: valueOf(options.values, 'identityScope'),
          issues: options.issues,
          rows: 2,
          maxLength: 500,
        })}
        ${textareaField({
          name: 'notes',
          label: 'Notes (optional)',
          value: valueOf(options.values, 'notes'),
          issues: options.issues,
          rows: 3,
          maxLength: 4000,
        })}
        <div class="form-actions">
          ${submitButton(options.submitLabel)}
          <a class="button button-secondary" href="${options.cancelHref}">Cancel</a>
        </div>
      </form>
    </div>
  `;
}

function entityValues(entity: {
  type: string;
  canonicalName: string;
  alternateNames: readonly string[];
  publicUrls: readonly string[];
  identityStatus: string;
  identityMethod: string | null;
  identityScope: string | null;
  notes: string | null;
}): Values {
  return new Map([
    ['type', entity.type],
    ['canonicalName', entity.canonicalName],
    ['alternateNames', entity.alternateNames.join('\n')],
    ['publicUrls', entity.publicUrls.join('\n')],
    ['identityStatus', entity.identityStatus],
    ['identityMethod', entity.identityMethod ?? ''],
    ['identityScope', entity.identityScope ?? ''],
    ['notes', entity.notes ?? ''],
  ]);
}

export const projectRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/projects/new',
    handler: (context) =>
      htmlResponse(
        page(
          'Create project',
          html`
            ${pageHeader(
              'Create project',
              'Start with an honest empty workspace. You will add claims, evidence, manual observations, and local HTML yourself.',
            )}
            ${projectForm({
              values: context.fields,
              issues: [],
              action: '/projects',
              csrfToken: context.csrfToken,
              submitLabel: 'Create project',
            })}
          `,
        ),
      ),
  },
  {
    method: 'POST',
    path: '/projects',
    handler: (context) => {
      const result = validateProjectInput(
        Object.fromEntries(context.fields.entries()) as Record<string, unknown>,
      );
      if (!result.ok) {
        return htmlResponse(
          page(
            'Create project',
            html`
              ${pageHeader('Create project', 'Correct the highlighted fields and submit again.')}
              ${projectForm({
                values: context.fields,
                issues: result.issues,
                action: '/projects',
                csrfToken: context.csrfToken,
                submitLabel: 'Create project',
              })}
            `,
          ),
          422,
        );
      }
      const detail = createProject(context.deps.db, result.value, writeContext(context));
      return redirectWithNotice(`/projects/${detail.project.id}`, 'project-created');
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const detail = getProjectOrThrow(context.deps.db, projectId);
      const claims = listClaims(context.deps.db, projectId);
      const sources = listSources(context.deps.db, projectId);
      const querySets = listQuerySets(context.deps.db, projectId);
      const runs = listRuns(context.deps.db, projectId);
      const audits = listWebsiteAudits(context.deps.db, projectId);
      const reports = listReports(context.deps.db, projectId);
      const entities = listEntities(context.deps.db, projectId);
      const activity = listAuditEvents(context.deps.db, projectId, { limit: 5 });
      const body = html`
        ${pageHeader(
          detail.project.name,
          detail.project.description ?? 'No project description recorded.',
          html`
            <a class="button button-primary" href="/projects/${projectId}/claims/new">Add claim</a>
            <a class="button" href="/projects/${projectId}/sources/new">Add source</a>
            <a class="button" href="/projects/${projectId}/edit">Edit project</a>
            <a class="button" href="/projects/${projectId}/reports">Reports</a>
          `,
        )}
        <div class="grid">
          <section class="card">
            <h2>Scope</h2>
            <dl class="definition-list">
              ${definitionRow(
                'Target entity',
                detail.targetEntity === null
                  ? html`<span class="muted">Not set</span>`
                  : html`${detail.targetEntity.canonicalName}
                      <span class="badge"
                        >${IDENTITY_STATUS_LABELS[detail.targetEntity.identityStatus]}</span
                      >`,
              )}
              ${definitionRow(
                'Primary site',
                detail.project.primaryDomain === null
                  ? html`<span class="muted">Not recorded</span>`
                  : html`<span class="mono">${detail.project.primaryDomain}</span>`,
              )}
              ${definitionRow('Created', html`${formatDateTime(detail.project.createdAt)}`)}
              ${definitionRow(
                'Visibility',
                html`Local only · no publication, provider submission, or remote crawl was
                performed.`,
              )}
            </dl>
            <p class="small muted">${IDENTITY_STATUS_DESCRIPTIONS.SELF_DECLARED}</p>
            <p><a href="/projects/${projectId}/entities">Manage entities</a></p>
          </section>
          <section class="card">
            <h2>Record counts</h2>
            <dl class="stat-grid">
              <div class="stat">
                <dt>Claims</dt>
                <dd>${detail.counts.claims}</dd>
              </div>
              <div class="stat">
                <dt>Sources</dt>
                <dd>${detail.counts.sources}</dd>
              </div>
              <div class="stat">
                <dt>Evidence</dt>
                <dd>${detail.counts.evidence}</dd>
              </div>
              <div class="stat">
                <dt>Runs</dt>
                <dd>${detail.counts.runs}</dd>
              </div>
              <div class="stat">
                <dt>Audits</dt>
                <dd>${detail.counts.audits}</dd>
              </div>
              <div class="stat">
                <dt>Reports</dt>
                <dd>${detail.counts.reports}</dd>
              </div>
              <div class="stat">
                <dt>Achievements</dt>
                <dd>${detail.counts.achievements}</dd>
              </div>
            </dl>
            <p class="small muted">
              ${plural(entities.length, 'entity', 'entities')} · no external provider or network
              call is included in these counts.
            </p>
          </section>
        </div>
        <div class="grid home-grid">
          <section class="card">
            <h2>Claims and evidence</h2>
            ${
              claims.length === 0
                ? emptyState(
                    'No claims yet',
                    'Enter the actual statement you want to evaluate, then decompose it into propositions.',
                    html`<a class="button button-primary" href="/projects/${projectId}/claims/new"
                      >Add the first claim</a
                    >`,
                  )
                : html`
                    <ul class="audit-list">
                      ${claims.slice(0, 5).map(
                        (claim) => html`
                          <li>
                            <a href="/projects/${projectId}/claims/${claim.id}">
                              ${claim.currentText ?? 'Revision unavailable'}
                            </a>
                            <div class="small muted">
                              ${CLAIM_STATUS_LABELS[claim.status]} ·
                              ${plural(claim.propositionCount, 'proposition')} · updated
                              ${formatDateTime(claim.updatedAt)}
                            </div>
                          </li>
                        `,
                      )}
                    </ul>
                    <p><a href="/projects/${projectId}/claims">View all claims</a></p>
                  `
            }
            <p class="small muted">
              Sources: ${sources.length}. Evidence must be recorded with a locator and a reviewer
              classification; Aporia does not discover sources automatically.
            </p>
          </section>
          <section class="card">
            <h2>Evaluation setup</h2>
            <dl class="definition-list">
              ${definitionRow(
                'Query sets',
                querySets.length === 0
                  ? html`<span class="muted">None</span>`
                  : html`${plural(querySets.length, 'set')} ·
                    ${querySets.filter((set) => set.set.status === 'APPROVED').length} approved`,
              )}
              ${definitionRow(
                'Manual runs',
                runs.length === 0
                  ? html`<span class="muted">None</span>`
                  : html`${plural(runs.length, 'run')} ·
                    ${runs.filter((run) => run.status === 'FINALIZED').length} finalized`,
              )}
              ${definitionRow(
                'HTML audits',
                audits.length === 0
                  ? html`<span class="muted">None</span>`
                  : html`${plural(audits.length, 'local audit')}`,
              )}
              ${definitionRow(
                'Reports',
                reports.length === 0
                  ? html`<span class="muted">None</span>`
                  : html`${plural(reports.length, 'snapshot')} · latest
                    #${reports[0]?.reportNumber ?? ''}`,
              )}
            </dl>
            <p class="report-actions">
              <a class="button" href="/projects/${projectId}/query-sets">Query sets</a>
              <a class="button" href="/projects/${projectId}/runs">Runs</a>
              <a class="button" href="/projects/${projectId}/audits">HTML audits</a>
              <a class="button button-primary" href="/projects/${projectId}/reports"
                >Generate report</a
              >
            </p>
          </section>
        </div>
        <section class="card home-grid">
          <h2>Recent activity</h2>
          ${
            activity.length === 0
              ? emptyState(
                  'No activity recorded',
                  'Audit events appear as you create and change records.',
                )
              : html`
                  <ul class="audit-list">
                    ${activity.map(
                      (event) => html`
                        <li>
                          <span class="badge">${humanize(event.action.replace('.', ' '))}</span>
                          <span class="small muted">
                            ${formatDateTime(event.createdAt)} · ${event.actor}
                          </span>
                        </li>
                      `,
                    )}
                  </ul>
                  <p><a href="/projects/${projectId}/activity">View full activity log</a></p>
                `
          }
        </section>
        <section class="card home-grid">
          <h2>Data control</h2>
          <p class="small">
            Export includes claims, evidence, query sets, raw observations, local HTML snapshots,
            reports, and audit events. It may contain sensitive material. Deletion removes the
            project’s records, including its local audit trail.
          </p>
          <p class="report-actions">
            <a class="button" href="/projects/${projectId}/export.json">Export project JSON</a>
            <a class="button button-danger" href="/projects/${projectId}/delete">Delete project</a>
          </p>
        </section>
      `;
      return htmlResponse(
        page('Project overview', body, {
          projectId,
          current: 'overview',
          notice: context.url.searchParams.get('notice'),
        }),
      );
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/entities',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const detail = getProjectOrThrow(context.deps.db, projectId);
      const entities = listEntities(context.deps.db, projectId);
      const body = html`
        ${pageHeader(
          'Entities',
          'People, organizations, products, repositories, publications, or artifacts in this project. Identity status is a local assertion, not verification.',
        )}
        <section class="card">
          <h2>Add entity</h2>
          ${entityForm({
            values: context.fields,
            issues: [],
            action: `/projects/${projectId}/entities`,
            csrfToken: context.csrfToken,
            submitLabel: 'Add entity',
            cancelHref: `/projects/${projectId}`,
          })}
        </section>
        <section class="card home-grid">
          <h2>Recorded entities</h2>
          ${
            entities.length === 0
              ? emptyState(
                  'No entities recorded',
                  'Entities are optional, but they help describe roles and attribution.',
                )
              : html`
                  <div class="table-wrap">
                    <table>
                      <caption>
                        All entities in ${detail.project.name}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Name</th>
                          <th scope="col">Type</th>
                          <th scope="col">Identity</th>
                          <th scope="col">Target</th>
                          <th scope="col">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${entities.map(
                          (entity) => html`
                            <tr>
                              <td>
                                <strong>${entity.canonicalName}</strong>
                                ${
                                  entity.alternateNames.length === 0
                                    ? ''
                                    : html`<div class="small muted">
                                        Also: ${entity.alternateNames.join(', ')}
                                      </div>`
                                }
                                ${
                                  entity.publicUrls.length === 0
                                    ? ''
                                    : html`<div class="small muted mono">
                                        ${entity.publicUrls.join(' · ')}
                                      </div>`
                                }
                              </td>
                              <td>${ENTITY_TYPE_LABELS[entity.type]}</td>
                              <td>
                                ${statusBadge(IDENTITY_STATUS_LABELS[entity.identityStatus])}
                                ${
                                  entity.identityMethod === null
                                    ? ''
                                    : html`<div class="small muted">${entity.identityMethod}</div>`
                                }
                              </td>
                              <td>${detail.project.targetEntityId === entity.id ? 'Yes' : ''}</td>
                              <td>
                                <div class="page-actions">
                                  <a
                                    class="button button-small"
                                    href="/projects/${projectId}/entities/${entity.id}/edit"
                                    >Edit</a
                                  >
                                  ${
                                    detail.project.targetEntityId === entity.id
                                      ? html`<span class="small muted">Current target</span>`
                                      : html`<form
                                          class="inline-form"
                                          method="post"
                                          action="/projects/${projectId}/entities/${entity.id}/target"
                                        >
                                          ${csrfField(context.csrfToken)}<button
                                            class="button button-small"
                                            type="submit"
                                          >
                                            Set as target
                                          </button>
                                        </form>`
                                  }
                                </div>
                              </td>
                            </tr>
                          `,
                        )}
                      </tbody>
                    </table>
                  </div>
                `
          }
        </section>
      `;
      return htmlResponse(
        page('Entities', body, {
          projectId,
          current: 'entities',
          notice: context.url.searchParams.get('notice'),
        }),
      );
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/entities',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const detail = getProjectOrThrow(context.deps.db, projectId);
      const result = validateEntityInput(
        Object.fromEntries(context.fields.entries()) as Record<string, unknown>,
      );
      if (!result.ok) {
        const entities = listEntities(context.deps.db, projectId);
        const body = html`
          ${pageHeader('Entities', 'Correct the highlighted fields and submit again.')}
          <section class="card">
            <h2>Add entity</h2>
            ${entityForm({
              values: context.fields,
              issues: result.issues,
              action: `/projects/${projectId}/entities`,
              csrfToken: context.csrfToken,
              submitLabel: 'Add entity',
              cancelHref: `/projects/${projectId}`,
            })}
          </section>
          <section class="card home-grid">
            <h2>Recorded entities</h2>
            <p>${plural(entities.length, 'entity')} already recorded.</p>
          </section>
        `;
        return htmlResponse(page('Entities', body, { projectId, current: 'entities' }), 422);
      }
      createEntity(context.deps.db, projectId, result.value, writeContext(context));
      return redirectWithNotice(`/projects/${detail.project.id}/entities`, 'entity-created');
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/entities/:entityId/edit',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const entityId = context.params['entityId'] ?? '';
      const entity = getEntity(context.deps.db, projectId, entityId);
      if (entity === null) {
        throw new AppError('NOT_FOUND', 'Entity not found.');
      }
      const body = html`
        ${pageHeader('Edit entity', 'Changes are audited. Identity status is still a local assertion.')}
        ${entityForm({
          values: entityValues(entity),
          issues: [],
          action: `/projects/${projectId}/entities/${entityId}`,
          csrfToken: context.csrfToken,
          submitLabel: 'Save entity',
          cancelHref: `/projects/${projectId}/entities`,
        })}
      `;
      return htmlResponse(page('Edit entity', body, { projectId, current: 'entities' }));
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/entities/:entityId',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const entityId = context.params['entityId'] ?? '';
      const result = validateEntityInput(
        Object.fromEntries(context.fields.entries()) as Record<string, unknown>,
      );
      if (!result.ok) {
        const body = html`
          ${pageHeader('Edit entity', 'Correct the highlighted fields and submit again.')}
          ${entityForm({
            values: context.fields,
            issues: result.issues,
            action: `/projects/${projectId}/entities/${entityId}`,
            csrfToken: context.csrfToken,
            submitLabel: 'Save entity',
            cancelHref: `/projects/${projectId}/entities`,
          })}
        `;
        return htmlResponse(page('Edit entity', body, { projectId, current: 'entities' }), 422);
      }
      updateEntity(context.deps.db, projectId, entityId, result.value, writeContext(context));
      return redirectWithNotice(`/projects/${projectId}/entities`, 'entity-updated');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/entities/:entityId/target',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const entityId = context.params['entityId'] ?? '';
      setTargetEntity(context.deps.db, projectId, entityId, writeContext(context));
      return redirectWithNotice(`/projects/${projectId}/entities`, 'target-set');
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/edit',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const detail = getProjectOrThrow(context.deps.db, projectId);
      const values = new Map([
        ['name', detail.project.name],
        ['description', detail.project.description ?? ''],
        ['primaryDomain', detail.project.primaryDomain ?? ''],
      ]);
      const body = html`
        ${pageHeader('Edit project profile', 'Changes are recorded in the local audit trail. The target entity is managed separately.')}
        <section class="card">
          ${projectEditForm({
            values,
            issues: [],
            action: `/projects/${projectId}/edit`,
            csrfToken: context.csrfToken,
          })}
        </section>
      `;
      return htmlResponse(page('Edit project', body, { projectId, current: 'overview' }));
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/edit',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      getProjectOrThrow(context.deps.db, projectId);
      const result = validateProjectUpdateInput(
        Object.fromEntries(context.fields.entries()) as Record<string, unknown>,
      );
      if (!result.ok) {
        const body = html`
          ${pageHeader('Edit project profile', 'Correct the highlighted fields and submit again.')}
          <section class="card">
            ${projectEditForm({
              values: context.fields,
              issues: result.issues,
              action: `/projects/${projectId}/edit`,
              csrfToken: context.csrfToken,
            })}
          </section>
        `;
        return htmlResponse(page('Edit project', body, { projectId, current: 'overview' }), 422);
      }
      updateProject(context.deps.db, projectId, result.value, writeContext(context));
      return redirectWithNotice(`/projects/${projectId}`, 'project-updated');
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/activity',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const detail = getProjectOrThrow(context.deps.db, projectId);
      const events = listAuditEvents(context.deps.db, projectId, { limit: 100 });
      const body = html`
        ${pageHeader(
          'Activity log',
          'Append-only local audit events. Project deletion removes these records.',
        )}
        ${
          events.length === 0
            ? emptyState(
                'No audit events',
                'Events are recorded when records are created or changed.',
              )
            : html`
                <div class="table-wrap">
                  <table>
                    <caption>
                      Most recent 100 events in ${detail.project.name}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Time</th>
                        <th scope="col">Actor</th>
                        <th scope="col">Action</th>
                        <th scope="col">Entity</th>
                        <th scope="col">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${events.map(
                        (event) => html`
                          <tr>
                            <td>${formatDateTime(event.createdAt)}</td>
                            <td>${event.actor}</td>
                            <td><span class="badge">${event.action}</span></td>
                            <td class="mono">${event.entityType}:${event.entityId}</td>
                            <td>
                              <details>
                                <summary>View</summary>
                                <pre>${JSON.stringify(event.details, null, 2)}</pre>
                              </details>
                            </td>
                          </tr>
                        `,
                      )}
                    </tbody>
                  </table>
                </div>
                <p class="small muted">
                  Showing ${events.length} event(s), newest first. The full project export includes
                  up to 500 recent events.
                </p>
              `
        }
      `;
      return htmlResponse(
        page('Activity log', body, {
          projectId,
          current: 'activity',
          notice: context.url.searchParams.get('notice'),
        }),
      );
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/export.json',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      getProjectOrThrow(context.deps.db, projectId);
      const exported = exportProject(context.deps.db, projectId, context.now);
      appendAuditEvent(context.deps.db, {
        projectId,
        actor: context.deps.config.operator,
        action: 'project.exported',
        entityType: 'project',
        entityId: projectId,
        details: { format: 'json' },
        at: context.now,
      });
      return jsonResponse(exported, 200, `aporia-project-${projectId}.json`);
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/delete',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const detail = getProjectOrThrow(context.deps.db, projectId);
      const body = html`
        ${pageHeader('Delete project', 'This action removes local records and cannot be undone.')}
        <div class="card stack">
          <p>
            Deleting <strong>${detail.project.name}</strong> removes its claims, sources, evidence,
            query sets, runs, observations, local HTML snapshots, achievement records and their
            approvals, reports, and audit events from this database. Exported files elsewhere are
            not affected.
          </p>
          <form method="post" action="/projects/${projectId}/delete">
            ${csrfField(context.csrfToken)}
            ${textField({
              name: 'confirmation',
              label: `Type the project name to confirm`,
              value: '',
              required: true,
              maxLength: 200,
              help: `Type exactly: ${detail.project.name}`,
            })}
            <div class="form-actions">
              ${submitButton('Delete project permanently', 'danger')}
              <a class="button button-secondary" href="/projects/${projectId}">Cancel</a>
            </div>
          </form>
        </div>
      `;
      return htmlResponse(page('Delete project', body, { projectId, current: 'overview' }));
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/delete',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const detail = getProjectOrThrow(context.deps.db, projectId);
      const result = validateConfirmationName(
        context.fields.get('confirmation'),
        detail.project.name,
      );
      if (!result.ok) {
        const body = html`
          ${pageHeader('Delete project', 'The confirmation did not match. Nothing was deleted.')}
          <div class="card stack">
            ${errorSummary(result.issues)}
            <form method="post" action="/projects/${projectId}/delete">
              ${csrfField(context.csrfToken)}
              ${textField({
                name: 'confirmation',
                label: 'Type the project name to confirm',
                value: context.fields.get('confirmation') ?? '',
                issues: result.issues,
                required: true,
                maxLength: 200,
                help: `Type exactly: ${detail.project.name}`,
              })}
              <div class="form-actions">
                ${submitButton('Delete project permanently', 'danger')}
                <a class="button button-secondary" href="/projects/${projectId}">Cancel</a>
              </div>
            </form>
          </div>
        `;
        return htmlResponse(page('Delete project', body, { projectId, current: 'overview' }), 422);
      }
      deleteProject(context.deps.db, projectId);
      return redirectWithNotice('/', 'project-deleted');
    },
  },
];
