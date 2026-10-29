import {
  ACHIEVEMENT_CLAIM_SUPPORT_STATE_LABELS,
  ACHIEVEMENT_CONTRIBUTOR_SUPPORT_STATE_LABELS,
} from '../../core/achievements.ts';
import { ATTRIBUTION_ROLE_LABELS, PROPOSITION_STATUS_LABELS } from '../../core/vocabulary.ts';
import type { ValidationIssue } from '../../core/validation.ts';
import type {
  AchievementRecord,
  AchievementRevisionRecord,
} from '../../persistence/repositories/achievements.ts';
import {
  csrfField,
  dateField,
  definitionRow,
  errorSummary,
  externalUrl,
  formatDateTime,
  statusBadge,
  submitButton,
  textField,
  textareaField,
  valueOf,
  type Values,
} from './components.ts';
import { html, externalLink, type Html } from './html.ts';

export interface AchievementFormClaim {
  readonly id: string;
  readonly text: string;
}

export interface AchievementFormSource {
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
  readonly evidence: readonly {
    readonly id: string;
    readonly locator: string;
    readonly digest: string;
  }[];
}

export interface AchievementFormOptions {
  readonly action: string;
  readonly csrfToken: string;
  readonly projectId: string;
  readonly issues: readonly ValidationIssue[];
  readonly values: Values;
  readonly defaults: {
    readonly projectName: string;
    readonly projectDescription: string;
    readonly projectUrl: string;
  };
  readonly current: AchievementRevisionRecord | null;
  readonly claims: readonly AchievementFormClaim[];
  readonly sources: readonly AchievementFormSource[];
  readonly selectedClaims: ReadonlySet<string>;
  readonly selectedSources: ReadonlySet<string>;
  readonly selectedEvidence: ReadonlySet<string>;
  readonly submitLabel: string;
}

function contributorLines(revision: AchievementRevisionRecord | null): string {
  if (revision === null) {
    return '';
  }
  return revision.contributors
    .map(
      (contributor) =>
        `${contributor.name} | ${contributor.role} | ${contributor.contribution} | ${contributor.supportState} | ${contributor.evidenceNote ?? ''}`,
    )
    .join('\n');
}

function formValue(values: Values, name: string, fallback: string): string {
  return values.has(name) ? valueOf(values, name) : fallback;
}

export function achievementForm(options: AchievementFormOptions): Html {
  const current = options.current;
  const title = formValue(options.values, 'title', current?.title ?? '');
  const summary = formValue(options.values, 'summary', current?.summary ?? '');
  const projectName = formValue(
    options.values,
    'projectName',
    current?.projectName ?? options.defaults.projectName,
  );
  const projectDescription = formValue(
    options.values,
    'projectDescription',
    current?.projectDescription ?? options.defaults.projectDescription,
  );
  const projectUrl = formValue(
    options.values,
    'projectUrl',
    current?.projectUrl ?? options.defaults.projectUrl,
  );
  const startDate = formValue(options.values, 'startDate', current?.startDate ?? '');
  const endDate = formValue(options.values, 'endDate', current?.endDate ?? '');
  const lines = formValue(options.values, 'contributorLines', contributorLines(current));

  return html`
    <div class="form-narrow">
      ${errorSummary(options.issues)}
      <div class="notice" role="status">
        Creating or editing this record is local. It produces a draft revision. A separate explicit
        approval is required before any publication-ready export; nothing is published by Aporia.
      </div>
      <form method="post" action="${options.action}" novalidate>
        ${csrfField(options.csrfToken)}
        ${textField({
          name: 'title',
          label: 'Achievement title',
          value: title,
          issues: options.issues,
          required: true,
          maxLength: 200,
        })}
        ${textareaField({
          name: 'summary',
          label: 'Summary',
          value: summary,
          issues: options.issues,
          required: true,
          rows: 4,
          maxLength: 4000,
          help: 'State what was done, in bounded terms. Do not claim independent verification.',
        })}
        <fieldset>
          <legend>Project details at this revision</legend>
          <p class="field-help">
            These values are snapshotted into the revision. Editing the project later will not
            change this historical record.
          </p>
          ${textField({
            name: 'projectName',
            label: 'Project name',
            value: projectName,
            issues: options.issues,
            required: true,
            maxLength: 200,
          })}
          ${textareaField({
            name: 'projectDescription',
            label: 'Project description',
            value: projectDescription,
            issues: options.issues,
            rows: 3,
            maxLength: 4000,
          })}
          ${textField({
            name: 'projectUrl',
            label: 'Project URL (optional)',
            value: projectUrl,
            issues: options.issues,
            type: 'url',
            maxLength: 2048,
            help: 'A page the owner controls or is authorized to discuss. It is not fetched.',
          })}
        </fieldset>
        <fieldset>
          <legend>Dates (optional)</legend>
          ${dateField({
            name: 'startDate',
            label: 'Start date',
            value: startDate,
            issues: options.issues,
          })}
          ${dateField({
            name: 'endDate',
            label: 'End date',
            value: endDate,
            issues: options.issues,
          })}
        </fieldset>
        <fieldset>
          <legend>Claims in this record</legend>
          <p class="field-help">
            Select at least one claim. Its current text, recorded evidence status and human
            assessment summary are snapshotted into the revision. A claim with no active evidence is
            labelled self-declared.
          </p>
          ${
            options.claims.length === 0
              ? html`<p class="notice">
                  No claims exist in this project yet.
                  <a href="/projects/${options.projectId}/claims/new">Create a claim first.</a>
                </p>`
              : html`<div class="stack">
                  ${options.claims.map(
                    (claim) => html`
                      <label class="checkbox-label">
                        <input
                          type="checkbox"
                          name="claim_${claim.id}"
                          value="on"
                          ${options.selectedClaims.has(claim.id) ? html`checked` : ''}
                        />
                        <span>${claim.text}</span>
                      </label>
                    `,
                  )}
                </div>`
          }
        </fieldset>
        <fieldset>
          <legend>Contributors and roles</legend>
          ${textareaField({
            name: 'contributorLines',
            label: 'One contributor per line',
            value: lines,
            issues: options.issues,
            required: true,
            rows: 6,
            maxLength: 12000,
            help: 'Format: Name | ROLE | Contribution | SELF_DECLARED|EVIDENCE_LINKED|DISPUTED | optional evidence note. Roles: AUTHOR, COAUTHOR, MAINTAINER, CONTRIBUTOR, PROJECT_LEAD, ORGANIZATION, FUNDER, PUBLISHER, UNSPECIFIED. A role is an operator record, not identity or ownership verification.',
          })}
        </fieldset>
        <fieldset>
          <legend>Evidence sources and excerpts (optional)</legend>
          <p class="field-help">
            Select source records and, where available, specific excerpts. Selecting an excerpt also
            includes its source. These are reviewer links, not independent verification.
          </p>
          ${
            options.sources.length === 0
              ? html`<p class="small muted">
                  No sources exist yet. A record can be created with self-declared claims and
                  contributions.
                </p>`
              : html`<div class="stack">
                  ${options.sources.map(
                    (source) => html`
                      <div>
                        <label class="checkbox-label">
                          <input
                            type="checkbox"
                            name="source_${source.id}"
                            value="on"
                            ${options.selectedSources.has(source.id) ? html`checked` : ''}
                          />
                          <span
                            ><strong>${source.title}</strong> ${
                              source.url === null ? '' : externalLink(source.url, source.url)
                            }</span
                          >
                        </label>
                        ${
                          source.evidence.length === 0
                            ? ''
                            : html`<div class="stack small nested-evidence">
                                ${source.evidence.map(
                                  (evidence) => html`
                                    <label class="checkbox-label">
                                      <input
                                        type="checkbox"
                                        name="evidence_${evidence.id}"
                                        value="on"
                                        ${options.selectedEvidence.has(evidence.id) ? html`checked` : ''}
                                      />
                                      <span>
                                        ${evidence.locator} · digest
                                        ${evidence.digest.slice(0, 12)}…
                                      </span>
                                    </label>
                                  `,
                                )}
                              </div>`
                        }
                      </div>
                    `,
                  )}
                </div>`
          }
        </fieldset>
        <div class="form-actions">${submitButton(options.submitLabel)}</div>
      </form>
    </div>
  `;
}

function toneForSupport(state: string): 'good' | 'bad' | 'warn' | 'neutral' {
  if (state === 'UNRESOLVED' || state === 'CONTRADICTION_RECORDED' || state === 'DISPUTED') {
    return 'bad';
  }
  if (state === 'EVIDENCE_RECORDED' || state === 'EVIDENCE_LINKED') {
    return 'good';
  }
  return 'neutral';
}

export interface AchievementPreviewOptions {
  readonly projectId: string;
  readonly achievement: AchievementRecord;
  readonly revision: AchievementRevisionRecord;
  readonly csrfToken: string;
  readonly approvalIssues: readonly ValidationIssue[];
  readonly approvalValues: Values;
}

export function achievementPreview(options: AchievementPreviewOptions): Html {
  const { achievement, revision, projectId } = options;
  const current = achievement.currentRevisionId === revision.id;
  const approved = revision.approval !== null;
  const approval = revision.approval;
  return html`
    <div class="stack">
      ${errorSummary(options.approvalIssues)}
      <div class="notice" role="status">
        ${
          approved
            ? current
              ? 'This revision is approved for local publication. Nothing has been published by Aporia.'
              : 'This is an approved historical revision. It is not current, so it cannot be exported; approve the current revision for a new export.'
            : current
              ? 'This is a draft revision. It is not approved for publication and cannot be exported as publication-ready.'
              : 'This is a historical revision. Only the current revision can be approved or exported.'
        }
      </div>
      <section class="card">
        ${statusBadge(approved ? 'Approved for local publication' : 'Draft', approved ? 'good' : 'warn')}
        <span class="badge">Revision ${revision.revisionNumber}${current ? ' · current' : ''}</span>
        <h2>${revision.title}</h2>
        <p>${revision.summary}</p>
        <dl class="definition-list">
          ${definitionRow('Project', html`${revision.projectName}`)}
          ${definitionRow(
            'Project description',
            revision.projectDescription === null
              ? html`<span class="muted">Not recorded</span>`
              : html`${revision.projectDescription}`,
          )}
          ${definitionRow(
            'Project URL',
            revision.projectUrl === null
              ? html`<span class="muted">Not recorded</span>`
              : externalUrl(revision.projectUrl, revision.projectUrl),
          )}
          ${definitionRow('Start date', html`${revision.startDate ?? 'Not stated'}`)}
          ${definitionRow('End date', html`${revision.endDate ?? 'Not stated'}`)}
          ${definitionRow('Revision created', html`${formatDateTime(revision.createdAt)} by ${revision.createdBy}`)}
          ${definitionRow('Content hash', html`<code>${revision.contentHash}</code>`)}
        </dl>
        <p class="small muted">
          Owner-supplied local record. Evidence labels summarize reviewer records, not independent
          verification. Identity and contributor roles are operator-supplied.
        </p>
      </section>
      <section class="card">
        <h2>Claims and recorded evidence</h2>
        <ol class="stack">
          ${revision.claims.map(
            (claim) => html`
              <li>
                <p>
                  ${
                    claim.claimId === null
                      ? html`${claim.claimText}`
                      : html`<a href="/projects/${projectId}/claims/${claim.claimId}"
                          >${claim.claimText}</a
                        >`
                  }
                </p>
                <p>
                  ${statusBadge(
                    ACHIEVEMENT_CLAIM_SUPPORT_STATE_LABELS[claim.supportState],
                    toneForSupport(claim.supportState),
                  )}
                  ${statusBadge(PROPOSITION_STATUS_LABELS[claim.evidenceStatus])}
                  <span class="badge"
                    >${claim.evidenceRelationshipCount} recorded relationship(s)</span
                  >
                </p>
                <p class="small muted">
                  Human assessment summary:
                  ${
                    claim.humanAssessmentStatus === null
                      ? 'none recorded'
                      : PROPOSITION_STATUS_LABELS[claim.humanAssessmentStatus]
                  }.
                </p>
              </li>
            `,
          )}
        </ol>
        <p class="small muted">
          Self-declared means no active evidence relationship is recorded. Evidence-recorded means a
          reviewer recorded supporting relationships. Neither label is independent verification.
        </p>
      </section>
      <section class="card">
        <h2>Contributors and roles</h2>
        <div class="table-wrap">
          <table>
            <caption>
              Roles and contributions in revision ${revision.revisionNumber}
            </caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Role</th>
                <th scope="col">Contribution</th>
                <th scope="col">Support state</th>
                <th scope="col">Evidence note</th>
              </tr>
            </thead>
            <tbody>
              ${revision.contributors.map(
                (contributor) => html`
                  <tr>
                    <td>${contributor.name}</td>
                    <td>${ATTRIBUTION_ROLE_LABELS[contributor.role]}</td>
                    <td>${contributor.contribution}</td>
                    <td>
                      ${statusBadge(
                        ACHIEVEMENT_CONTRIBUTOR_SUPPORT_STATE_LABELS[contributor.supportState],
                        toneForSupport(contributor.supportState),
                      )}
                    </td>
                    <td>${contributor.evidenceNote ?? ''}</td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
        <p class="small muted">
          A contributor role is not identity, account control, ownership, or proof of sole credit.
          Team contributions remain visible as separate rows.
        </p>
      </section>
      <section class="card">
        <h2>Evidence sources</h2>
        ${
          revision.evidence.length === 0
            ? html`<p class="muted">No source records were linked in this revision.</p>`
            : html`<ul>
                ${revision.evidence.map(
                  (item) => html`
                    <li>
                      ${externalLink(item.sourceTitle, item.sourceUrl)}
                      ${item.evidenceLocator === null ? '' : html` · ${item.evidenceLocator}`}
                      ${
                        item.evidenceExcerptDigest === null
                          ? ''
                          : html`<div class="small muted mono">
                              digest ${item.evidenceExcerptDigest}
                            </div>`
                      }
                      ${item.note === null ? '' : html`<div class="small muted">${item.note}</div>`}
                    </li>
                  `,
                )}
              </ul>`
        }
      </section>
      <section class="card">
        <h2>Unresolved contradictions</h2>
        ${
          revision.unresolvedContradictions.length === 0
            ? html`<p class="muted">None recorded in this revision.</p>`
            : html`<ul>
                ${revision.unresolvedContradictions.map(
                  (contradiction) => html`
                    <li>
                      <strong>${contradiction.claimText}</strong>
                      <div class="small muted">${contradiction.reason}</div>
                    </li>
                  `,
                )}
              </ul>`
        }
      </section>
      <section class="card">
        <h2>Approval and exports</h2>
        ${
          approved && approval !== null
            ? html`
                <p>
                  Approved for local publication by <strong>${approval.approvedBy}</strong> at
                  ${formatDateTime(approval.approvedAt)}.
                </p>
                <p><strong>Approval note:</strong> ${approval.note}</p>
                ${
                  current
                    ? html`<div class="page-actions">
                        <a
                          class="button"
                          href="/projects/${projectId}/achievements/${achievement.id}/export.html"
                          >Download HTML</a
                        >
                        <a
                          class="button"
                          href="/projects/${projectId}/achievements/${achievement.id}/export.jsonld"
                          >Download JSON-LD</a
                        >
                      </div>`
                    : html`<p class="small muted">
                        This approved revision is historical. Export uses the current revision only.
                      </p>`
                }
              `
            : current
              ? html`
                  <p class="small muted">
                    Approval records that this revision is ready for local publication. It does not
                    publish anything. The title must be typed exactly to confirm.
                  </p>
                  <form
                    method="post"
                    action="/projects/${projectId}/achievements/${achievement.id}/approve"
                    novalidate
                  >
                    ${csrfField(options.csrfToken)}
                    ${textareaField({
                      name: 'note',
                      label: 'Approval note',
                      value: valueOf(options.approvalValues, 'note'),
                      issues: options.approvalIssues,
                      required: true,
                      rows: 2,
                      maxLength: 2000,
                      help: 'State what you reviewed. This note is stored with the approval.',
                    })}
                    ${textField({
                      name: 'confirmation',
                      label: 'Type the revision title to confirm',
                      value: valueOf(options.approvalValues, 'confirmation'),
                      issues: options.approvalIssues,
                      required: true,
                      maxLength: 200,
                      help: `Type exactly: ${revision.title}`,
                    })}
                    <div class="form-actions">
                      ${submitButton('Approve this revision for local publication')}
                    </div>
                  </form>
                `
              : html`<p class="muted">
                  Historical revision; only the current revision can be approved.
                </p>`
        }
      </section>
      <section class="card">
        <h2>Revision history</h2>
        <div class="table-wrap">
          <table>
            <caption>
              All revisions of ${revision.title}
            </caption>
            <thead>
              <tr>
                <th scope="col">Revision</th>
                <th scope="col">Created</th>
                <th scope="col">Approval</th>
                <th scope="col">Open</th>
              </tr>
            </thead>
            <tbody>
              ${[...achievement.revisions].reverse().map(
                (item) => html`
                  <tr>
                    <td>
                      ${item.revisionNumber}${item.id === achievement.currentRevisionId ? ' · current' : ''}
                    </td>
                    <td>${formatDateTime(item.createdAt)}</td>
                    <td>
                      ${
                        item.approval === null
                          ? statusBadge('Draft', 'warn')
                          : statusBadge('Approved', 'good')
                      }
                    </td>
                    <td>
                      <a
                        href="/projects/${projectId}/achievements/${achievement.id}/revisions/${item.id}"
                        >Preview</a
                      >
                    </td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
      </section>
      <p>
        <a class="button" href="/projects/${projectId}/achievements">All achievement records</a>
        ${
          current
            ? html`<a
                class="button"
                href="/projects/${projectId}/achievements/${achievement.id}/revisions/new"
                >Create a new revision</a
              >`
            : ''
        }
      </p>
    </div>
  `;
}
