import { validateReportInput } from '../../core/inputs.ts';
import type { ValidationIssue } from '../../core/validation.ts';
import type { ReportSnapshot } from '../../reporting/types.ts';
import { findingsCsv, metricsCsv } from '../../reporting/csv.ts';
import { AppError } from '../../errors.ts';
import { getProjectOrThrow } from '../../persistence/repositories/projects.ts';
import {
  getReport,
  listReports,
  type ReportRecord,
} from '../../persistence/repositories/reports.ts';
import { generateReport } from '../reportingService.ts';
import { csvResponse, htmlResponse, jsonResponse, redirectWithNotice } from '../http/responses.ts';
import { writeContext, type RequestContext, type RouteDefinition } from '../http/types.ts';
import {
  csrfField,
  emptyState,
  errorSummary,
  formatDateTime,
  pageHeader,
  statusBadge,
  submitButton,
  textField,
  valueOf,
  type Values,
} from '../views/components.ts';
import { html, type Html } from '../views/html.ts';
import { layout, projectNav } from '../views/layout.ts';
import { renderReport } from '../views/report.ts';

function page(title: string, body: Html, projectId: string, notice: string | null): Html {
  return layout({
    title,
    body,
    notice,
    navigation: projectNav({ projectId, current: 'reports' }),
  });
}

function snapshotOf(report: ReportRecord): ReportSnapshot {
  const snapshot = report.snapshot;
  if (
    typeof snapshot !== 'object' ||
    snapshot === null ||
    (snapshot as Record<string, unknown>)['schemaVersion'] !== 'report-snapshot-v1'
  ) {
    throw new AppError('INTERNAL_ERROR', 'The stored report snapshot is not readable.');
  }
  return snapshot as ReportSnapshot;
}

function reportsListPage(
  context: RequestContext,
  projectId: string,
  options: { issues?: readonly ValidationIssue[]; values?: Values } = {},
): Html {
  const project = getProjectOrThrow(context.deps.db, projectId);
  const reports = listReports(context.deps.db, projectId);
  const body = html`
    ${pageHeader(
      'Reports',
      'Immutable snapshots generated from persisted claims, evidence, observations, audits, and metrics. Existing reports are never re-read from live data.',
    )}
    ${errorSummary(options.issues ?? [])}
    <div class="card">
      <h2>Generate a report</h2>
      <p class="small muted">
        A report includes every current claim revision, every local HTML audit, and all finalized
        runs. Open and cancelled runs are counted but contribute no metrics. Earlier reports are
        marked superseded, never rewritten.
      </p>
      <form method="post" action="/projects/${projectId}/reports" class="form-narrow" novalidate>
        ${csrfField(context.csrfToken)}
        ${textField({
          name: 'title',
          label: 'Report title (optional)',
          value: valueOf(options.values ?? new Map(), 'title'),
          issues: options.issues ?? [],
          maxLength: 200,
          help: 'Defaults to “<project> evaluation report <date>”.',
        })}
        <div class="form-actions">${submitButton('Generate snapshot')}</div>
      </form>
    </div>
    <h2>Snapshots</h2>
    ${
      reports.length === 0
        ? emptyState(
            'No reports yet',
            'Generate a report after recording claims and at least one finalized run. An empty project can still produce an honest empty report.',
          )
        : html`
            <div class="table-wrap">
              <table>
                <caption>
                  Report snapshots for ${project.project.name}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Number</th>
                    <th scope="col">Title</th>
                    <th scope="col">Generated</th>
                    <th scope="col">State</th>
                    <th scope="col">Open</th>
                  </tr>
                </thead>
                <tbody>
                  ${reports.map(
                    (report) => html`
                      <tr>
                        <td>#${report.reportNumber}</td>
                        <td>${report.title}</td>
                        <td>${formatDateTime(report.generatedAt)}</td>
                        <td>
                          ${report.supersededByReportId === null ? statusBadge('Current', 'good') : statusBadge('Superseded')}
                        </td>
                        <td>
                          <a href="/projects/${projectId}/reports/${report.id}">Open report</a>
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
  return page('Reports', body, projectId, context.url.searchParams.get('notice'));
}

export const reportRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/projects/:projectId/reports',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      return htmlResponse(reportsListPage(context, projectId));
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/reports',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const result = validateReportInput(
        Object.fromEntries(context.fields.entries()) as Record<string, unknown>,
      );
      if (!result.ok) {
        return htmlResponse(
          reportsListPage(context, projectId, { issues: result.issues, values: context.fields }),
          422,
        );
      }
      const generated = generateReport(
        context.deps.db,
        projectId,
        result.value.title,
        writeContext(context),
      );
      return redirectWithNotice(
        `/projects/${projectId}/reports/${generated.report.id}`,
        'report-generated',
      );
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/reports/:reportId',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const reportId = context.params['reportId'] ?? '';
      const project = getProjectOrThrow(context.deps.db, projectId);
      const report = getReport(context.deps.db, projectId, reportId);
      if (report === null) {
        throw new AppError('NOT_FOUND', 'Report not found.');
      }
      const snapshot = snapshotOf(report);
      const body = html`
        <div class="report-actions">
          <a class="button" href="/projects/${projectId}/reports">All reports</a>
          <a class="button" href="/projects/${projectId}/reports/${report.id}/export.json"
            >Download JSON</a
          >
          <a class="button" href="/projects/${projectId}/reports/${report.id}/metrics.csv"
            >Download metrics CSV</a
          >
          <a class="button" href="/projects/${projectId}/reports/${report.id}/findings.csv"
            >Download findings CSV</a
          >
        </div>
        ${renderReport(snapshot, { supersededByReportId: report.supersededByReportId })}
        <p class="small muted">
          Project: ${project.project.name} · Report record ${report.id} · created
          ${formatDateTime(report.createdAt)}.
        </p>
      `;
      return htmlResponse(page('Report', body, projectId, context.url.searchParams.get('notice')));
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/reports/:reportId/export.json',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const reportId = context.params['reportId'] ?? '';
      const report = getReport(context.deps.db, projectId, reportId);
      if (report === null) {
        throw new AppError('NOT_FOUND', 'Report not found.');
      }
      return jsonResponse(
        snapshotOf(report),
        200,
        `aporia-report-${String(report.reportNumber)}.json`,
      );
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/reports/:reportId/metrics.csv',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const reportId = context.params['reportId'] ?? '';
      const report = getReport(context.deps.db, projectId, reportId);
      if (report === null) {
        throw new AppError('NOT_FOUND', 'Report not found.');
      }
      return csvResponse(
        metricsCsv(snapshotOf(report)),
        `aporia-report-${String(report.reportNumber)}-metrics.csv`,
      );
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/reports/:reportId/findings.csv',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const reportId = context.params['reportId'] ?? '';
      const report = getReport(context.deps.db, projectId, reportId);
      if (report === null) {
        throw new AppError('NOT_FOUND', 'Report not found.');
      }
      return csvResponse(
        findingsCsv(snapshotOf(report)),
        `aporia-report-${String(report.reportNumber)}-findings.csv`,
      );
    },
  },
];
