import { validateSourceInput } from '../../core/inputs.ts';
import {
  SOURCE_ACCESS_ROUTES,
  SOURCE_ACCESS_ROUTE_LABELS,
  SOURCE_INDEPENDENCE,
  SOURCE_INDEPENDENCE_LABELS,
  SOURCE_TYPES,
  SOURCE_TYPE_LABELS,
} from '../../core/vocabulary.ts';
import type { ValidationIssue } from '../../core/validation.ts';
import { listSources, createSource } from '../../persistence/repositories/evidence.ts';
import { getProjectOrThrow } from '../../persistence/repositories/projects.ts';
import { dateTimeLocalValue, normalizeDateTimeInput } from '../forms.ts';
import { htmlResponse, redirectWithNotice } from '../http/responses.ts';
import { writeContext, type RouteDefinition } from '../http/types.ts';
import {
  csrfField,
  dateField,
  dateTimeField,
  emptyState,
  errorSummary,
  externalUrl,
  formatDateTime,
  pageHeader,
  selectField,
  submitButton,
  textField,
  textareaField,
  valueOf,
  type Values,
} from '../views/components.ts';
import { html, type Html } from '../views/html.ts';
import { layout, projectNav } from '../views/layout.ts';

function sourceFields(options: {
  context: { now: string; deps: { config: { operator: string } } };
  values: Values;
  issues: readonly ValidationIssue[];
}): Html {
  return html`
    ${textField({
      name: 'title',
      label: 'Source title',
      value: valueOf(options.values, 'title'),
      issues: options.issues,
      required: true,
      maxLength: 300,
      help: 'A short local label, for example “Release 1.0 archive” or “Independent review”.',
    })}
    ${textField({
      name: 'canonicalUri',
      label: 'Canonical URL (optional)',
      value: valueOf(options.values, 'canonicalUri'),
      issues: options.issues,
      type: 'url',
      maxLength: 2048,
      help: 'A URL for the source. Aporia does not fetch or resolve it locally.',
    })}
    ${textField({
      name: 'publisher',
      label: 'Publisher (optional)',
      value: valueOf(options.values, 'publisher'),
      issues: options.issues,
      maxLength: 200,
    })}
    ${textField({
      name: 'author',
      label: 'Author (optional)',
      value: valueOf(options.values, 'author'),
      issues: options.issues,
      maxLength: 200,
    })}
    ${selectField({
      name: 'sourceType',
      label: 'Source type',
      value: valueOf(options.values, 'sourceType', 'PRIMARY_ARTIFACT'),
      issues: options.issues,
      required: true,
      options: SOURCE_TYPES.map((type) => ({ value: type, label: SOURCE_TYPE_LABELS[type] })),
    })}
    ${selectField({
      name: 'accessRoute',
      label: 'Access route',
      value: valueOf(options.values, 'accessRoute', 'MANUAL_ENTRY'),
      issues: options.issues,
      required: true,
      options: SOURCE_ACCESS_ROUTES.map((route) => ({
        value: route,
        label: SOURCE_ACCESS_ROUTE_LABELS[route],
      })),
    })}
    ${dateTimeField({
      name: 'retrievedAt',
      label: 'Retrieved at',
      value: valueOf(options.values, 'retrievedAt', dateTimeLocalValue(options.context.now)),
      issues: options.issues,
      required: true,
    })}
    ${dateField({
      name: 'publicationDate',
      label: 'Publication date (optional)',
      value: valueOf(options.values, 'publicationDate'),
      issues: options.issues,
    })}
    ${textField({
      name: 'language',
      label: 'Language tag',
      value: valueOf(options.values, 'language', 'en'),
      issues: options.issues,
      required: true,
      maxLength: 35,
    })}
    ${selectField({
      name: 'independence',
      label: 'Independence assessment',
      value: valueOf(options.values, 'independence', 'UNKNOWN'),
      issues: options.issues,
      required: true,
      options: SOURCE_INDEPENDENCE.map((value) => ({
        value,
        label: SOURCE_INDEPENDENCE_LABELS[value],
      })),
      help: 'Independence is a reviewer-recorded judgment, not verification of the source or its credibility. “Recorded as independent” means you recorded it; Aporia did not check it. Unknown is not independent.',
    })}
    ${textareaField({
      name: 'notes',
      label: 'Source notes (optional)',
      value: valueOf(options.values, 'notes'),
      issues: options.issues,
      rows: 3,
      maxLength: 4000,
      help: 'Access limitations, conflicts of interest, or licensing notes.',
    })}
  `;
}

export const sourceRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/projects/:projectId/sources',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const detail = getProjectOrThrow(context.deps.db, projectId);
      const sources = listSources(context.deps.db, projectId);
      const body = html`
        ${pageHeader(
          'Sources',
          'Recorded source descriptors. A source type, URL, and independence label are reviewer records — not proof of truth, credibility, or independent verification.',
          html`<a class="button button-primary" href="/projects/${projectId}/sources/new"
            >Add source</a
          >`,
        )}
        ${
          sources.length === 0
            ? emptyState(
                'No sources recorded',
                'Add the primary artifact, official record, independent report, or other material you actually inspected.',
                html`<a class="button button-primary" href="/projects/${projectId}/sources/new"
                  >Add the first source</a
                >`,
              )
            : html`
                <div class="table-wrap">
                  <table>
                    <caption>
                      Sources in ${detail.project.name}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Title</th>
                        <th scope="col">Type (recorded)</th>
                        <th scope="col">Independence (recorded)</th>
                        <th scope="col">Retrieved</th>
                        <th scope="col">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${sources.map(
                        (source) => html`
                          <tr>
                            <td>
                              <strong>${source.title}</strong>
                              ${
                                source.publisher === null && source.author === null
                                  ? ''
                                  : html`<div class="small muted">
                                      ${[source.author, source.publisher].filter((value) => value !== null).join(' · ')}
                                    </div>`
                              }
                              ${source.notes === null ? '' : html`<div class="small muted">${source.notes}</div>`}
                            </td>
                            <td>${SOURCE_TYPE_LABELS[source.sourceType]}</td>
                            <td>${SOURCE_INDEPENDENCE_LABELS[source.independence]}</td>
                            <td>${formatDateTime(source.retrievedAt)}</td>
                            <td>${externalUrl(source.canonicalUri)}</td>
                          </tr>
                        `,
                      )}
                    </tbody>
                  </table>
                </div>
                <p class="small muted">
                  Retrieval time records when you inspected the source. Aporia did not fetch it.
                  Independence and source type are reviewer records, not verified properties; a
                  source recorded as independent has not been checked by Aporia.
                </p>
              `
        }
      `;
      return htmlResponse(
        layout({
          title: 'Sources',
          body,
          notice: context.url.searchParams.get('notice'),
          navigation: projectNav({ projectId, current: 'sources' }),
        }),
      );
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/sources/new',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      getProjectOrThrow(context.deps.db, projectId);
      const body = html`
        ${pageHeader(
          'Add source',
          'Describe the material you inspected. Add evidence excerpts and relationship classifications from the claim page.',
          html`<a class="button" href="/projects/${projectId}/sources">Back to sources</a>`,
        )}
        <div class="form-narrow">
          <form method="post" action="/projects/${projectId}/sources" novalidate>
            ${csrfField(context.csrfToken)}
            ${sourceFields({ context, values: context.fields, issues: [] })}
            <div class="form-actions">
              ${submitButton('Record source')}
              <a class="button button-secondary" href="/projects/${projectId}/sources">Cancel</a>
            </div>
          </form>
        </div>
      `;
      return htmlResponse(
        layout({
          title: 'Add source',
          body,
          navigation: projectNav({ projectId, current: 'sources' }),
        }),
      );
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/sources',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const raw = Object.fromEntries(context.fields.entries()) as Record<string, unknown>;
      raw['retrievedAt'] = normalizeDateTimeInput(context.fields.get('retrievedAt'));
      const result = validateSourceInput(raw);
      getProjectOrThrow(context.deps.db, projectId);
      if (!result.ok) {
        const body = html`
          ${pageHeader('Add source', 'Correct the highlighted fields and submit again.')}
          ${errorSummary(result.issues)}
          <div class="form-narrow">
            <form method="post" action="/projects/${projectId}/sources" novalidate>
              ${csrfField(context.csrfToken)}
              ${sourceFields({ context, values: context.fields, issues: result.issues })}
              <div class="form-actions">${submitButton('Record source')}</div>
            </form>
          </div>
        `;
        return htmlResponse(
          layout({
            title: 'Add source',
            body,
            navigation: projectNav({ projectId, current: 'sources' }),
          }),
          422,
        );
      }
      createSource(context.deps.db, projectId, result.value, writeContext(context));
      return redirectWithNotice(`/projects/${projectId}/sources`, 'source-created');
    },
  },
];
