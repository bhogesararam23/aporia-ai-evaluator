import {
  analyzeHtml,
  decodeHtmlBytes,
  WebsiteAnalysisError,
  FINDING_SEVERITY_LABELS,
  type FindingSeverity,
  type WebsiteFinding,
} from '../../website/index.ts';
import { requiredText, type ValidationIssue } from '../../core/validation.ts';
import { AppError } from '../../errors.ts';
import { getProjectOrThrow } from '../../persistence/repositories/projects.ts';
import {
  createWebsiteAudit,
  getWebsiteAudit,
  listWebsiteAudits,
} from '../../persistence/repositories/websiteAudits.ts';
import { appendAuditEvent } from '../../persistence/audit.ts';
import { htmlResponse, jsonResponse, redirectWithNotice } from '../http/responses.ts';
import { writeContext, type RouteDefinition } from '../http/types.ts';
import {
  csrfField,
  emptyState,
  errorSummary,
  formatDateTime,
  pageHeader,
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
    navigation: projectNav({ projectId, current: 'audits' }),
  });
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function findingList(values: readonly unknown[]): WebsiteFinding[] {
  return values.map((value) => {
    const item = record(value);
    return {
      code: typeof item['code'] === 'string' ? item['code'] : 'unknown',
      severity:
        typeof item['severity'] === 'string'
          ? (item['severity'] as FindingSeverity)
          : 'INFORMATIONAL',
      category: (typeof item['category'] === 'string'
        ? item['category']
        : 'CONTENT') as WebsiteFinding['category'],
      title: typeof item['title'] === 'string' ? item['title'] : 'Untitled finding',
      observation: typeof item['observation'] === 'string' ? item['observation'] : '',
      rationale: typeof item['rationale'] === 'string' ? item['rationale'] : '',
      recommendation: typeof item['recommendation'] === 'string' ? item['recommendation'] : '',
      locator: typeof item['locator'] === 'string' ? item['locator'] : '',
    };
  });
}

function unavailableList(
  values: readonly unknown[],
): { code: string; label: string; reason: string }[] {
  return values.map((value) => {
    const item = record(value);
    return {
      code: typeof item['code'] === 'string' ? item['code'] : 'unknown',
      label: typeof item['label'] === 'string' ? item['label'] : 'Unavailable check',
      reason: typeof item['reason'] === 'string' ? item['reason'] : 'Not performed.',
    };
  });
}

function severityTone(severity: FindingSeverity): string {
  return severity === 'BLOCKING'
    ? 'bad'
    : severity === 'LIKELY_DISCOVERABILITY_ISSUE'
      ? 'warn'
      : severity === 'EVIDENCE_CLARITY'
        ? 'warn'
        : 'neutral';
}

function auditForm(
  context: Parameters<RouteDefinition['handler']>[0],
  values: Values,
  issues: readonly ValidationIssue[],
): Html {
  return html`
    <div class="form-narrow">
      ${errorSummary(issues)}
      <form
        method="post"
        action="/projects/${context.params['projectId'] ?? ''}/audits"
        enctype="multipart/form-data"
        novalidate
      >
        ${csrfField(context.csrfToken)}
        ${textField({
          name: 'label',
          label: 'Audit label',
          value: valueOf(values, 'label'),
          issues,
          required: true,
          maxLength: 200,
          help: 'For example “Homepage snapshot, 2026-10-28”. A local label only.',
        })}
        <fieldset>
          <legend>HTML input</legend>
          <p class="field-help">
            Supply exactly one: paste the HTML or upload an .html/.htm file. Aporia does not fetch a
            URL or load remote resources. Network-dependent checks will be marked unavailable.
          </p>
          ${textareaField({
            name: 'html',
            label: 'Paste HTML',
            value: valueOf(values, 'html'),
            issues,
            rows: 10,
            maxLength: context.deps.config.maxHtmlBytes,
          })}
          <div class="field">
            <label for="field-htmlFile">Upload HTML file</label>
            <input id="field-htmlFile" name="htmlFile" type="file" accept=".html,.htm,text/html" />
            <p class="field-help">
              UTF-8, up to ${context.deps.config.maxHtmlBytes} bytes. Choose one input method.
            </p>
          </div>
        </fieldset>
        <div class="form-actions">
          ${submitButton('Analyse supplied HTML')}
          <a
            class="button button-secondary"
            href="/projects/${context.params['projectId'] ?? ''}/audits"
            >Cancel</a
          >
        </div>
      </form>
    </div>
  `;
}

export const auditRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/projects/:projectId/audits',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const project = getProjectOrThrow(context.deps.db, projectId);
      const audits = listWebsiteAudits(context.deps.db, projectId);
      const body = html`
        ${pageHeader(
          'Local HTML audits',
          'Inspect HTML bytes you supply. No URL is fetched, no script is executed, and no provider index is queried.',
          html`<a class="button button-primary" href="/projects/${projectId}/audits/new"
            >Analyse HTML</a
          >`,
        )}
        <div class="card card-subtle">
          <p>
            <strong>What is available:</strong> in-document title, robots meta, canonical, JSON-LD,
            headings, dates, authorship signals, links, alt text, and parser observations.
          </p>
          <p class="small muted">
            <strong>What is not available:</strong> HTTP status, robots.txt retrieval, sitemaps,
            TLS, live link health, rendered content, indexing, caching, and provider citations.
            These are reported as unavailable rather than passed.
          </p>
        </div>
        ${
          audits.length === 0
            ? emptyState(
                'No HTML audits yet',
                'Save or paste the HTML you actually intend to inspect. There is no crawler and no sample audit.',
                html`<a class="button button-primary" href="/projects/${projectId}/audits/new"
                  >Analyse the first page</a
                >`,
              )
            : html`
                <div class="table-wrap home-grid">
                  <table>
                    <caption>
                      HTML audits in ${project.project.name}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Label</th>
                        <th scope="col">Input</th>
                        <th scope="col">Findings</th>
                        <th scope="col">Unavailable</th>
                        <th scope="col">Audited</th>
                        <th scope="col">Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${audits.map(
                        (audit) => html`
                          <tr>
                            <td>${audit.label}</td>
                            <td>
                              ${audit.inputMethod === 'UPLOADED' ? `Uploaded ${audit.inputFilename ?? 'file'}` : 'Pasted HTML'}
                            </td>
                            <td>${audit.findingCount}</td>
                            <td>${audit.unavailableCheckCount}</td>
                            <td>${formatDateTime(audit.auditedAt)}</td>
                            <td>
                              <a href="/projects/${projectId}/audits/${audit.id}">Open audit</a>
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
        page('HTML audits', body, projectId, context.url.searchParams.get('notice')),
      );
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/audits/new',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      getProjectOrThrow(context.deps.db, projectId);
      const body = html`
        ${pageHeader(
          'Analyse supplied HTML',
          'A local parse of exactly the bytes you provide.',
          html`<a class="button" href="/projects/${projectId}/audits">Back to audits</a>`,
        )}
        ${auditForm(context, context.fields, [])}
      `;
      return htmlResponse(page('Analyse HTML', body, projectId, null));
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/audits',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      getProjectOrThrow(context.deps.db, projectId);
      const issues: ValidationIssue[] = [];
      const labelResult = requiredText(context.fields.get('label'), 'label', { max: 200 });
      if (!labelResult.ok) {
        issues.push(...labelResult.issues);
      }
      const file = context.file;
      const pasted = context.fields.get('html') ?? '';
      if (
        file !== null &&
        !file.filename.toLowerCase().endsWith('.html') &&
        !file.filename.toLowerCase().endsWith('.htm')
      ) {
        issues.push({ field: 'htmlFile', message: 'Upload an .html or .htm file.' });
      }
      if (file !== null && pasted.trim().length > 0) {
        issues.push({ field: 'html', message: 'Choose either pasted HTML or a file, not both.' });
      }
      if (file === null && pasted.trim().length === 0) {
        issues.push({ field: 'html', message: 'Paste HTML or upload an HTML file.' });
      }
      if (issues.length > 0 || !labelResult.ok) {
        const body = html`
          ${pageHeader('Analyse supplied HTML', 'Correct the highlighted input and submit again.')}
          ${auditForm(context, context.fields, issues)}
        `;
        return htmlResponse(page('Analyse HTML', body, projectId, null), 422);
      }

      let htmlSnapshot: string;
      let inputMethod: 'PASTED' | 'UPLOADED';
      let inputFilename: string | null = null;
      try {
        if (file !== null) {
          htmlSnapshot = decodeHtmlBytes(file.bytes, context.deps.config.maxHtmlBytes);
          inputMethod = 'UPLOADED';
          inputFilename = file.filename;
        } else {
          htmlSnapshot = pasted;
          inputMethod = 'PASTED';
        }
        const analysis = analyzeHtml(htmlSnapshot, { maxBytes: context.deps.config.maxHtmlBytes });
        const audit = createWebsiteAudit(
          context.deps.db,
          projectId,
          {
            label: labelResult.value,
            inputMethod,
            inputFilename,
            contentHash: analysis.contentHash,
            byteLength: analysis.byteLength,
            htmlSnapshot,
            auditedAt: context.now,
            methodologyVersion: analysis.version,
            findings: analysis.findings,
            unavailableChecks: analysis.unavailableChecks,
            metadata: analysis.metadata as unknown as Record<string, unknown>,
          },
          writeContext(context),
        );
        return redirectWithNotice(`/projects/${projectId}/audits/${audit.id}`, 'audit-created');
      } catch (error) {
        if (error instanceof WebsiteAnalysisError) {
          issues.push({
            field: file === null ? 'html' : 'htmlFile',
            message: error.message,
          });
          const body = html`
            ${pageHeader('Analyse supplied HTML', 'The supplied HTML could not be analysed.')}
            ${auditForm(context, context.fields, issues)}
          `;
          return htmlResponse(page('Analyse HTML', body, projectId, null), 422);
        }
        throw error;
      }
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/audits/:auditId/export.json',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const auditId = context.params['auditId'] ?? '';
      const audit = getWebsiteAudit(context.deps.db, projectId, auditId);
      if (audit === null) {
        throw new AppError('NOT_FOUND', 'Website audit not found.');
      }
      appendAuditEvent(context.deps.db, {
        projectId,
        actor: context.deps.config.operator,
        action: 'website_audit.exported',
        entityType: 'website_audit',
        entityId: audit.id,
        details: { format: 'json', contentHash: audit.contentHash },
        at: context.now,
      });
      return jsonResponse(audit, 200, `aporia-audit-${audit.id}.json`);
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/audits/:auditId',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const auditId = context.params['auditId'] ?? '';
      const audit = getWebsiteAudit(context.deps.db, projectId, auditId);
      if (audit === null) {
        throw new AppError('NOT_FOUND', 'Website audit not found.');
      }
      const findings = findingList(audit.findings);
      const unavailable = unavailableList(audit.unavailableChecks);
      const metadata = audit.metadata;
      const body = html`
        ${pageHeader(
          audit.label,
          `Local HTML audit · ${audit.inputMethod === 'UPLOADED' ? (audit.inputFilename ?? 'uploaded file') : 'pasted HTML'} · ${formatDateTime(audit.auditedAt)}`,
          html`<a class="button" href="/projects/${projectId}/audits">All audits</a>
            <a class="button" href="/projects/${projectId}/audits/${audit.id}/export.json"
              >Download audit JSON</a
            >`,
        )}
        <div class="notice" role="status">
          This audit inspected only the supplied HTML. HTTP status, robots.txt, sitemaps, TLS, live
          link health, indexing, caching, rendered content, and provider citations were not tested.
        </div>
        <div class="grid">
          <section class="card">
            <h2>Input provenance</h2>
            <dl class="definition-list">
              <div class="definition-row">
                <dt>Content hash</dt>
                <dd class="mono">${audit.contentHash}</dd>
              </div>
              <div class="definition-row">
                <dt>Byte length</dt>
                <dd>${audit.byteLength}</dd>
              </div>
              <div class="definition-row">
                <dt>Methodology</dt>
                <dd>${audit.methodologyVersion}</dd>
              </div>
              <div class="definition-row">
                <dt>Stored snapshot</dt>
                <dd>Raw HTML is stored locally for reproducibility and is never rendered here.</dd>
              </div>
            </dl>
          </section>
          <section class="card">
            <h2>Extracted metadata</h2>
            <dl class="definition-list">
              <div class="definition-row">
                <dt>Title</dt>
                <dd>${typeof metadata['title'] === 'string' ? metadata['title'] : 'Not found'}</dd>
              </div>
              <div class="definition-row">
                <dt>Language</dt>
                <dd>${typeof metadata['lang'] === 'string' ? metadata['lang'] : 'Not found'}</dd>
              </div>
              <div class="definition-row">
                <dt>Canonical</dt>
                <dd class="mono">
                  ${typeof metadata['canonicalUrl'] === 'string' ? metadata['canonicalUrl'] : 'Not found'}
                </dd>
              </div>
              <div class="definition-row">
                <dt>H1 count</dt>
                <dd>
                  ${typeof metadata['h1Count'] === 'number' ? metadata['h1Count'] : 'Unknown'}
                </dd>
              </div>
              <div class="definition-row">
                <dt>JSON-LD blocks</dt>
                <dd>
                  ${typeof metadata['jsonLdBlockCount'] === 'number' ? `${metadata['jsonLdBlockCount']} (${typeof metadata['jsonLdValidCount'] === 'number' ? metadata['jsonLdValidCount'] : 0} valid)` : 'Unknown'}
                </dd>
              </div>
              <div class="definition-row">
                <dt>Visible text length</dt>
                <dd>
                  ${typeof metadata['visibleTextLength'] === 'number' ? metadata['visibleTextLength'] : 'Unknown'}
                </dd>
              </div>
            </dl>
          </section>
        </div>
        <h2>Findings</h2>
        ${
          findings.length === 0
            ? html`<p class="muted">No in-document findings were emitted.</p>`
            : html`<div class="stack">
                ${findings.map(
                  (finding) => html`
                    <section
                      class="finding finding-${finding.severity === 'BLOCKING' ? 'blocking' : finding.severity === 'LIKELY_DISCOVERABILITY_ISSUE' ? 'likely' : 'other'}"
                    >
                      <h3>
                        ${finding.title}
                        ${statusBadge(FINDING_SEVERITY_LABELS[finding.severity] ?? finding.severity, severityTone(finding.severity))}
                      </h3>
                      <p>${finding.observation}</p>
                      <p class="small muted">${finding.rationale}</p>
                      <p><strong>Suggested action:</strong> ${finding.recommendation}</p>
                      <p class="small muted">Locator: ${finding.locator} · code: ${finding.code}</p>
                    </section>
                  `,
                )}
              </div>`
        }
        <h2>Checks not performed</h2>
        <ul class="unavailable-list">
          ${unavailable.map((check) => html`<li><strong>${check.label}</strong>: ${check.reason}</li>`)}
        </ul>
      `;
      return htmlResponse(
        page('HTML audit', body, projectId, context.url.searchParams.get('notice')),
      );
    },
  },
];
