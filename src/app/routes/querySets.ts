import {
  validateQueryDraftInput,
  validateQuerySetApprovalInput,
  validateQuerySetInput,
} from '../../core/inputs.ts';
import { QUERY_INTENTS, QUERY_INTENT_LABELS, type QuerySetStatus } from '../../core/vocabulary.ts';
import type { ValidationIssue } from '../../core/validation.ts';
import { getProjectOrThrow } from '../../persistence/repositories/projects.ts';
import {
  addQuery,
  approveQuerySet,
  cloneQuerySetVersion,
  createQuerySet,
  deleteQuery,
  getQuerySetOrThrow,
  listQuerySets,
  type QuerySetDetail,
} from '../../persistence/repositories/querySets.ts';
import { htmlResponse, redirectWithNotice } from '../http/responses.ts';
import { writeContext, type RouteDefinition } from '../http/types.ts';
import {
  checkboxField,
  csrfField,
  emptyState,
  errorSummary,
  formatDateTime,
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

function page(title: string, body: Html, projectId: string, notice: string | null): Html {
  return layout({
    title,
    body,
    notice,
    navigation: projectNav({ projectId, current: 'query-sets' }),
  });
}

function setStatusBadge(status: QuerySetStatus): Html {
  return statusBadge(
    status === 'APPROVED' ? 'Approved' : 'Draft',
    status === 'APPROVED' ? 'good' : 'neutral',
  );
}

function querySetFields(values: Values, issues: readonly ValidationIssue[]): Html {
  return html`
    ${textField({
      name: 'name',
      label: 'Query set name',
      value: valueOf(values, 'name'),
      issues,
      required: true,
      maxLength: 200,
      help: 'A stable name for longitudinal comparisons. A new version keeps the same name.',
    })}
    ${textareaField({
      name: 'description',
      label: 'Description (optional)',
      value: valueOf(values, 'description'),
      issues,
      rows: 2,
      maxLength: 4000,
    })}
    ${textField({
      name: 'locale',
      label: 'Query-set language tag',
      value: valueOf(values, 'locale', 'en'),
      issues,
      required: true,
      maxLength: 35,
    })}
  `;
}

function queryFields(values: Values, issues: readonly ValidationIssue[]): Html {
  return html`
    ${textareaField({
      name: 'text',
      label: 'Query text',
      value: valueOf(values, 'text'),
      issues,
      required: true,
      rows: 2,
      maxLength: 1000,
      help: 'Use the exact question you actually tested. Avoid leading wording that presupposes the desired answer.',
    })}
    ${selectField({
      name: 'intent',
      label: 'Intent',
      value: valueOf(values, 'intent'),
      issues,
      required: true,
      includeBlank: 'Choose an intent',
      options: QUERY_INTENTS.map((intent) => ({
        value: intent,
        label: QUERY_INTENT_LABELS[intent],
      })),
    })}
    ${textField({
      name: 'locale',
      label: 'Query language tag (optional)',
      value: valueOf(values, 'locale', 'en'),
      issues,
      maxLength: 35,
    })}
    ${textField({
      name: 'region',
      label: 'Region (optional)',
      value: valueOf(values, 'region'),
      issues,
      maxLength: 100,
    })}
    ${checkboxField({
      name: 'branded',
      label: 'Branded query',
      checked: valueOf(values, 'branded') === 'on',
      help: 'Include both branded and non-branded discovery intents where appropriate.',
    })}
    ${textareaField({
      name: 'expectedElements',
      label: 'Expected answer elements',
      value: valueOf(values, 'expectedElements'),
      issues,
      required: true,
      rows: 2,
      maxLength: 2000,
      help: 'What should a correct answer contain? This is a review aid, not a score.',
    })}
    ${textareaField({
      name: 'inclusionRationale',
      label: 'Inclusion rationale',
      value: valueOf(values, 'inclusionRationale'),
      issues,
      required: true,
      rows: 2,
      maxLength: 1000,
      help: 'Why is this query in the fixed set? Record the rationale before seeing results.',
    })}
  `;
}

function querySetDetailPage(
  context: Parameters<RouteDefinition['handler']>[0],
  projectId: string,
  detail: QuerySetDetail,
  options: { issues?: readonly ValidationIssue[]; values?: Values; notice?: string | null } = {},
): Html {
  const project = getProjectOrThrow(context.deps.db, projectId);
  const issues = options.issues ?? [];
  const values = options.values ?? new Map<string, string>();
  const set = detail.set;
  const body = html`
    ${pageHeader(
      `${set.name} v${set.version}`,
      `${set.locale} · ${plural(detail.queries.length, 'query', 'queries')} · ${set.status === 'APPROVED' ? `approved by ${set.approvedBy ?? 'unknown'}` : 'draft'}`,
      html`<a class="button" href="/projects/${projectId}/query-sets">All query sets</a>`,
    )}
    ${errorSummary(issues)}
    <div class="grid">
      <section class="card">
        <h2>Status</h2>
        <dl class="definition-list">
          <div class="definition-row">
            <dt>State</dt>
            <dd>${setStatusBadge(set.status)}</dd>
          </div>
          ${
            set.approvedBy === null
              ? ''
              : html`<div class="definition-row">
                  <dt>Approved by</dt>
                  <dd>${set.approvedBy} · ${formatDateTime(set.approvedAt)}</dd>
                </div>`
          }
          ${
            set.approvalNote === null
              ? ''
              : html`<div class="definition-row">
                  <dt>Approval note</dt>
                  <dd>${set.approvalNote}</dd>
                </div>`
          }
          <div class="definition-row">
            <dt>Project</dt>
            <dd><a href="/projects/${projectId}">${project.project.name}</a></dd>
          </div>
        </dl>
        ${set.description === null ? '' : html`<p>${set.description}</p>`}
        ${
          set.status === 'DRAFT'
            ? html`
                <form
                  method="post"
                  action="/projects/${projectId}/query-sets/${set.id}/approve"
                  novalidate
                >
                  ${csrfField(context.csrfToken)}
                  <p class="field-help">
                    Approval freezes the text and metadata. Create a new version for later retests.
                  </p>
                  ${textField({
                    name: 'reviewer',
                    label: 'Reviewer',
                    value: valueOf(values, 'reviewer', context.deps.config.operator),
                    issues,
                    required: true,
                    maxLength: 80,
                  })}
                  ${textAreaSmall('note', 'Approval note (optional)', values, issues)}
                  <div class="form-actions">${submitButton('Approve and freeze')}</div>
                </form>
              `
            : html`
                <p class="small muted">
                  Approved query sets are immutable. Use “Create new version” to prepare a retest
                  while preserving this version.
                </p>
                <form method="post" action="/projects/${projectId}/query-sets/${set.id}/clone">
                  ${csrfField(context.csrfToken)}
                  <div class="form-actions">${submitButton('Create new version', 'secondary')}</div>
                </form>
              `
        }
      </section>
      <section class="card">
        <h2>What this set covers</h2>
        <p class="small muted">
          ${plural(detail.queries.filter((query) => query.branded).length, 'branded query', 'branded queries')}
          ·
          ${plural(detail.queries.filter((query) => !query.branded).length, 'non-branded query', 'non-branded queries')}
        </p>
        <p class="small muted">
          Runs compare only when the query-set version and provider configuration match. Query
          changes require a new version.
        </p>
        <p><a class="button" href="/projects/${projectId}/runs">View manual runs</a></p>
      </section>
    </div>
    <h2>Queries</h2>
    ${
      detail.queries.length === 0
        ? emptyState(
            'No queries yet',
            'Add representative questions with declared intent, expected elements, and inclusion rationale.',
          )
        : html`
            <div class="table-wrap">
              <table>
                <caption>
                  Query set ${set.name} version ${set.version}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Query</th>
                    <th scope="col">Intent</th>
                    <th scope="col">Branded</th>
                    <th scope="col">Expected elements</th>
                    <th scope="col">Rationale</th>
                    ${set.status === 'DRAFT' ? html`<th scope="col">Action</th>` : ''}
                  </tr>
                </thead>
                <tbody>
                  ${detail.queries.map(
                    (query) => html`
                      <tr>
                        <td>${query.ordinal}</td>
                        <td>${query.text}</td>
                        <td>${QUERY_INTENT_LABELS[query.intent]}</td>
                        <td>${query.branded ? 'Yes' : 'No'}</td>
                        <td>${query.expectedElements}</td>
                        <td>${query.inclusionRationale}</td>
                        ${
                          set.status === 'DRAFT'
                            ? html`<td>
                                <form
                                  class="inline-form"
                                  method="post"
                                  action="/projects/${projectId}/query-sets/${set.id}/queries/${query.id}/delete"
                                >
                                  ${csrfField(context.csrfToken)}<button
                                    class="button button-small"
                                    type="submit"
                                  >
                                    Remove
                                  </button>
                                </form>
                              </td>`
                            : ''
                        }
                      </tr>
                    `,
                  )}
                </tbody>
              </table>
            </div>
          `
    }
    ${
      set.status === 'DRAFT'
        ? html`
            <section class="card home-grid">
              <h2>Add query</h2>
              <form
                method="post"
                action="/projects/${projectId}/query-sets/${set.id}/queries"
                novalidate
              >
                ${csrfField(context.csrfToken)} ${queryFields(values, issues)}
                <div class="form-actions">${submitButton('Add query')}</div>
              </form>
            </section>
          `
        : ''
    }
    ${
      detail.queries.length > 0 && set.status === 'DRAFT'
        ? html`<p class="small muted">
            Approve this set only after the queries and expected outcomes have been reviewed.
          </p>`
        : ''
    }
  `;
  return page(
    'Query set',
    body,
    projectId,
    options.notice ?? context.url.searchParams.get('notice'),
  );
}

function textAreaSmall(
  name: string,
  label: string,
  values: Values,
  issues: readonly ValidationIssue[],
): Html {
  return textareaField({
    name,
    label,
    value: valueOf(values, name),
    issues,
    rows: 2,
    maxLength: 1000,
  });
}

export const querySetRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/projects/:projectId/query-sets',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const project = getProjectOrThrow(context.deps.db, projectId);
      const sets = listQuerySets(context.deps.db, projectId);
      const body = html`
        ${pageHeader(
          'Query sets',
          'Versioned, reviewable questions for manual AI-answer testing. Approved sets are frozen; changes create a new version.',
          html`<a class="button button-primary" href="/projects/${projectId}/query-sets/new"
            >Create query set</a
          >`,
        )}
        ${
          sets.length === 0
            ? emptyState(
                'No query sets yet',
                'Create a fixed set of questions you actually intend to test. Include non-branded discovery, entity, source-seeking, and attribution intents where relevant.',
                html`<a class="button button-primary" href="/projects/${projectId}/query-sets/new"
                  >Create the first query set</a
                >`,
              )
            : html`
                <div class="table-wrap">
                  <table>
                    <caption>
                      Query sets in ${project.project.name}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Name</th>
                        <th scope="col">Version</th>
                        <th scope="col">State</th>
                        <th scope="col">Queries</th>
                        <th scope="col">Approved</th>
                        <th scope="col">Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${sets.map(
                        (detail) => html`
                          <tr>
                            <td>${detail.set.name}</td>
                            <td>${detail.set.version}</td>
                            <td>${setStatusBadge(detail.set.status)}</td>
                            <td>${detail.queries.length}</td>
                            <td>
                              ${detail.set.approvedAt === null ? 'Not approved' : formatDateTime(detail.set.approvedAt)}
                            </td>
                            <td>
                              <a href="/projects/${projectId}/query-sets/${detail.set.id}"
                                >Open set</a
                              >
                            </td>
                          </tr>
                        `,
                      )}
                    </tbody>
                  </table>
                </div>
              `
        }
      `;
      return htmlResponse(
        page('Query sets', body, projectId, context.url.searchParams.get('notice')),
      );
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/query-sets/new',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      getProjectOrThrow(context.deps.db, projectId);
      const body = html`
        ${pageHeader(
          'Create query set',
          'New sets start as drafts. Add and review queries before approving.',
          html`<a class="button" href="/projects/${projectId}/query-sets">Back to query sets</a>`,
        )}
        <div class="form-narrow">
          <form method="post" action="/projects/${projectId}/query-sets" novalidate>
            ${csrfField(context.csrfToken)} ${querySetFields(context.fields, [])}
            <div class="form-actions">${submitButton('Create draft')}</div>
          </form>
        </div>
      `;
      return htmlResponse(page('Create query set', body, projectId, null));
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/query-sets',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const result = validateQuerySetInput(
        Object.fromEntries(context.fields.entries()) as Record<string, unknown>,
      );
      getProjectOrThrow(context.deps.db, projectId);
      if (!result.ok) {
        const body = html`
          ${pageHeader('Create query set', 'Correct the highlighted fields and submit again.')}
          ${errorSummary(result.issues)}
          <div class="form-narrow">
            <form method="post" action="/projects/${projectId}/query-sets" novalidate>
              ${csrfField(context.csrfToken)} ${querySetFields(context.fields, result.issues)}
              <div class="form-actions">${submitButton('Create draft')}</div>
            </form>
          </div>
        `;
        return htmlResponse(page('Create query set', body, projectId, null), 422);
      }
      const created = createQuerySet(
        context.deps.db,
        projectId,
        result.value,
        writeContext(context),
      );
      return redirectWithNotice(
        `/projects/${projectId}/query-sets/${created.set.id}`,
        'query-set-created',
      );
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/query-sets/:setId',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const setId = context.params['setId'] ?? '';
      const detail = getQuerySetOrThrow(context.deps.db, projectId, setId);
      return htmlResponse(querySetDetailPage(context, projectId, detail));
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/query-sets/:setId/queries',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const setId = context.params['setId'] ?? '';
      const raw = Object.fromEntries(context.fields.entries()) as Record<string, unknown>;
      raw['branded'] = context.fields.get('branded') ?? '';
      const result = validateQueryDraftInput(raw);
      const detail = getQuerySetOrThrow(context.deps.db, projectId, setId);
      if (!result.ok) {
        return htmlResponse(
          querySetDetailPage(context, projectId, detail, {
            issues: result.issues,
            values: context.fields,
          }),
          422,
        );
      }
      addQuery(context.deps.db, projectId, setId, result.value, writeContext(context));
      return redirectWithNotice(`/projects/${projectId}/query-sets/${setId}`, 'query-added');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/query-sets/:setId/queries/:queryId/delete',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const setId = context.params['setId'] ?? '';
      const queryId = context.params['queryId'] ?? '';
      deleteQuery(context.deps.db, projectId, setId, queryId, writeContext(context));
      return redirectWithNotice(`/projects/${projectId}/query-sets/${setId}`, 'query-removed');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/query-sets/:setId/approve',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const setId = context.params['setId'] ?? '';
      const detail = getQuerySetOrThrow(context.deps.db, projectId, setId);
      const result = validateQuerySetApprovalInput(
        Object.fromEntries(context.fields.entries()) as Record<string, unknown>,
      );
      if (!result.ok) {
        return htmlResponse(
          querySetDetailPage(context, projectId, detail, {
            issues: result.issues,
            values: context.fields,
          }),
          422,
        );
      }
      approveQuerySet(context.deps.db, projectId, setId, result.value, writeContext(context));
      return redirectWithNotice(`/projects/${projectId}/query-sets/${setId}`, 'query-set-approved');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/query-sets/:setId/clone',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const setId = context.params['setId'] ?? '';
      const clone = cloneQuerySetVersion(context.deps.db, projectId, setId, writeContext(context));
      return redirectWithNotice(
        `/projects/${projectId}/query-sets/${clone.set.id}`,
        'query-set-cloned',
      );
    },
  },
];
