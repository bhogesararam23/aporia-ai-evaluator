import { APP_NAME, APP_VERSION } from '../../version.ts';
import { html, type Html } from './html.ts';

const NOTICES: Record<string, string> = {
  'project-created': 'Project created.',
  'entity-created': 'Entity added.',
  'entity-updated': 'Entity updated.',
  'target-set': 'Target entity updated.',
  'claim-created': 'Claim revision recorded.',
  'revision-created': 'New claim revision recorded; review status reset.',
  'proposition-added': 'Proposition added.',
  'claim-status': 'Claim status updated.',
  'source-created': 'Source recorded.',
  'evidence-created': 'Evidence and relationship recorded.',
  'relationship-superseded': 'Evidence relationship superseded. The prior record is retained.',
  'proposition-assessed': 'Reviewed proposition assessment recorded.',
  'query-set-created': 'Query set draft created.',
  'query-added': 'Query added to the draft.',
  'query-removed': 'Query removed from the draft.',
  'query-set-approved': 'Query set approved and frozen.',
  'query-set-cloned': 'New draft version created from the approved set.',
  'run-created': 'Manual capture run created.',
  'observation-added': 'Observation recorded.',
  'observations-imported': 'Observations imported.',
  'citation-added': 'Citation recorded.',
  'observation-voided': 'Observation voided. The original record is retained.',
  'citation-voided': 'Citation voided. The original record is retained.',
  'observation-assessed': 'Observation assessment recorded.',
  'run-finalized': 'Run finalized and frozen.',
  'run-cancelled': 'Run cancelled.',
  'audit-created': 'Local HTML audit recorded.',
  'report-generated': 'Report snapshot generated.',
  'project-exported': 'Project export prepared.',
};

export function noticeMessage(code: string | null): string | null {
  if (code === null) {
    return null;
  }
  return NOTICES[code] ?? null;
}

function noticeBanner(code: string | null): Html {
  const message = noticeMessage(code);
  if (message === null) {
    return html``;
  }
  return html`<div class="notice" role="status">${message}</div>`;
}

export interface ProjectNavOptions {
  projectId: string;
  current: string;
}

const PROJECT_LINKS = [
  { key: 'overview', label: 'Overview', suffix: '' },
  { key: 'claims', label: 'Claims', suffix: '/claims' },
  { key: 'sources', label: 'Sources', suffix: '/sources' },
  { key: 'query-sets', label: 'Query sets', suffix: '/query-sets' },
  { key: 'runs', label: 'Runs', suffix: '/runs' },
  { key: 'audits', label: 'HTML audits', suffix: '/audits' },
  { key: 'reports', label: 'Reports', suffix: '/reports' },
  { key: 'activity', label: 'Activity', suffix: '/activity' },
] as const;

export function projectNav(options: ProjectNavOptions): Html {
  return html`
    <nav class="subnav" aria-label="Project sections">
      <ul>
        ${PROJECT_LINKS.map((link) => {
          const href = `/projects/${options.projectId}${link.suffix}`;
          const current = options.current === link.key;
          return html`<li>
            <a href="${href}" ${current ? html`aria-current="page"` : ''}>${link.label}</a>
          </li>`;
        })}
      </ul>
    </nav>
  `;
}

export interface LayoutOptions {
  title: string;
  body: Html;
  notice?: string | null;
  navigation?: Html;
}

export function layout(options: LayoutOptions): Html {
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>${options.title} · ${APP_NAME}</title>
        <link rel="stylesheet" href="/assets/app.css" />
      </head>
      <body>
        <a class="skip-link" href="#main">Skip to content</a>
        <header class="site-header">
          <div class="container header-inner">
            <a class="brand" href="/">${APP_NAME}</a>
            <span class="local-badge">Local core v${APP_VERSION} · no external providers</span>
          </div>
        </header>
        ${options.navigation ?? ''}
        <main id="main" class="container" tabindex="-1">
          ${noticeBanner(options.notice ?? null)} ${options.body}
        </main>
        <footer class="site-footer">
          <div class="container">
            <p>
              Local-first evidence review. Data stays in the local SQLite database unless you export
              it. Aporia does not call providers, crawl the web, or guarantee indexing, caching, or
              citations.
            </p>
          </div>
        </footer>
      </body>
    </html>`;
}
