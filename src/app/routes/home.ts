import { listProjects } from '../../persistence/repositories/projects.ts';
import { formatDateTime, pageHeader, plural, emptyState } from '../views/components.ts';
import { html } from '../views/html.ts';
import { layout } from '../views/layout.ts';
import type { RouteDefinition } from '../http/types.ts';

export const homeRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/',
    handler: (context) => {
      const projects = listProjects(context.deps.db);
      const body = html`
        ${pageHeader(
          'Projects',
          'Evidence-first evaluations of claims, local HTML, manually captured AI answers, and creator attribution.',
          html`<a class="button button-primary" href="/projects/new">Create project</a>`,
        )}
        <div class="card card-subtle stack">
          <p>
            This is a local, single-operator workspace. It has no external provider integrations and
            does not fetch remote websites. All evidence and AI answers must be entered or supplied
            by you, and every metric reports what was actually captured.
          </p>
          <p class="small muted">
            Local data remains in the SQLite database in your configured data directory. Export or
            delete a project at any time from its overview page.
          </p>
        </div>
        ${
          projects.length === 0
            ? emptyState(
                'No projects yet',
                'Create a project for the actual claim, artifact, or question you want to evaluate. Aporia does not include sample projects or fabricated results.',
                html`<a class="button button-primary" href="/projects/new"
                  >Create your first project</a
                >`,
              )
            : html`
                <div class="grid home-grid">
                  ${projects.map(
                    (project) => html`
                      <article class="card stack">
                        <div>
                          <h2><a href="/projects/${project.id}">${project.name}</a></h2>
                          <p class="muted small">
                            ${
                              project.targetEntityName === null
                                ? 'No target entity set'
                                : `Target: ${project.targetEntityName}`
                            }
                            · Updated ${formatDateTime(project.updatedAt)}
                          </p>
                        </div>
                        ${project.description === null ? '' : html`<p>${project.description}</p>`}
                        <dl class="stat-grid">
                          <div class="stat">
                            <dt>Claims</dt>
                            <dd>${project.counts.claims}</dd>
                          </div>
                          <div class="stat">
                            <dt>Sources</dt>
                            <dd>${project.counts.sources}</dd>
                          </div>
                          <div class="stat">
                            <dt>Runs</dt>
                            <dd>${project.counts.runs}</dd>
                          </div>
                          <div class="stat">
                            <dt>Reports</dt>
                            <dd>${project.counts.reports}</dd>
                          </div>
                          <div class="stat">
                            <dt>Achievements</dt>
                            <dd>${project.counts.achievements}</dd>
                          </div>
                        </dl>
                        <p class="small muted">
                          ${plural(project.counts.audits, 'HTML audit')} ·
                          ${plural(project.counts.evidence, 'evidence item')}
                        </p>
                        <p><a href="/projects/${project.id}">Open project overview</a></p>
                      </article>
                    `,
                  )}
                </div>
              `
        }
      `;
      return {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: layout({
          title: 'Projects',
          body,
          notice: context.url.searchParams.get('notice'),
        }).value,
      };
    },
  },
];
