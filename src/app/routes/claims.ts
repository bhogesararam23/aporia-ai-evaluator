import {
  validateClaimRevisionInput,
  validateEvidenceWithRelationInput,
  validatePropositionAssessmentInput,
  validatePropositionInput,
  validateRelationshipChangeInput,
} from '../../core/inputs.ts';
import {
  canAddProposition,
  canRecordPropositionAssessment,
  canTransitionClaim,
} from '../../core/lifecycle.ts';
import {
  CLAIM_STATUSES,
  CLAIM_STATUS_LABELS,
  EVIDENCE_EXTRACTION_METHODS,
  EVIDENCE_EXTRACTION_METHOD_LABELS,
  EVIDENCE_RELATIONS,
  EVIDENCE_RELATION_LABELS,
  PROPOSITION_STATUSES,
  PROPOSITION_STATUS_LABELS,
  SOURCE_INDEPENDENCE_LABELS,
  SOURCE_TYPE_LABELS,
  type ClaimStatus,
} from '../../core/vocabulary.ts';
import {
  deriveEvidenceStatus,
  resolvePropositionConclusion,
  type RecordedPropositionAssessment,
} from '../../core/evidence.ts';
import type { ValidationIssue } from '../../core/validation.ts';
import { enumValue } from '../../core/validation.ts';
import { AppError } from '../../errors.ts';
import {
  addClaimRevision,
  addProposition,
  createClaim,
  getClaimOrThrow,
  listClaims,
  transitionClaim,
} from '../../persistence/repositories/claims.ts';
import {
  activeRelationshipsForProposition,
  getRelationship,
  listPropositionAssessments,
  listPropositionEvidence,
  listSources,
  recordEvidence,
  recordPropositionAssessment,
  supersedeRelationship,
} from '../../persistence/repositories/evidence.ts';
import { getProjectOrThrow } from '../../persistence/repositories/projects.ts';
import { dateTimeLocalValue, normalizeDateTimeInput } from '../forms.ts';
import { htmlResponse, redirectWithNotice } from '../http/responses.ts';
import { writeContext, type RequestContext, type RouteDefinition } from '../http/types.ts';
import {
  csrfField,
  dateTimeField,
  definitionRow,
  emptyState,
  errorSummary,
  externalUrl,
  formatDateTime,
  pageHeader,
  plural,
  propositionStatusBadge,
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
  projectId: string,
  current: string,
  notice: string | null,
): Html {
  return layout({
    title,
    body,
    notice,
    navigation: projectNav({ projectId, current }),
  });
}

function claimRevisionFields(values: Values, issues: readonly ValidationIssue[]): Html {
  return html`
    ${textareaField({
      name: 'text',
      label: 'Claim text',
      value: valueOf(values, 'text'),
      issues,
      required: true,
      rows: 4,
      maxLength: 5000,
      help: 'The exact statement to evaluate. Editing meaningful wording creates a new immutable revision.',
    })}
    ${textField({
      name: 'sourceUrl',
      label: 'Source URL (optional)',
      value: valueOf(values, 'sourceUrl'),
      issues,
      type: 'url',
      maxLength: 2048,
      help: 'Where the claim was made. Aporia does not fetch this URL locally.',
    })}
    ${textareaField({
      name: 'intendedMeaning',
      label: 'Intended meaning (optional)',
      value: valueOf(values, 'intendedMeaning'),
      issues,
      rows: 2,
      maxLength: 2000,
      help: 'Disambiguate scope, terms, or what the claim is not saying.',
    })}
    ${textField({
      name: 'timeScope',
      label: 'Time scope (optional)',
      value: valueOf(values, 'timeScope'),
      issues,
      maxLength: 500,
      placeholder: 'e.g. Release 1.0, 2026',
    })}
    ${textField({
      name: 'locale',
      label: 'Language tag',
      value: valueOf(values, 'locale', 'en'),
      issues,
      required: true,
      maxLength: 35,
      help: 'For example en, en-GB, or zh-Hant.',
    })}
  `;
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
    maxLength: 2000,
  });
}

function evidenceFields(
  context: RequestContext,
  propositionId: string,
  claimId: string,
  sources: ReturnType<typeof listSources>,
  values: Values,
  issues: readonly ValidationIssue[],
): Html {
  if (sources.length === 0) {
    return html`
      <p class="small muted">
        Record a source first. Aporia does not discover sources automatically and does not fetch
        remote pages.
      </p>
      <p>
        <a class="button" href="/projects/${context.params['projectId'] ?? ''}/sources/new"
          >Add a source</a
        >
      </p>
    `;
  }
  return html`
    <details>
      <summary>Record evidence for this proposition</summary>
      <form
        method="post"
        action="/projects/${context.params['projectId'] ?? ''}/claims/${claimId}/propositions/${propositionId}/evidence"
        novalidate
      >
        ${csrfField(context.csrfToken)}
        ${selectField({
          name: 'sourceId',
          label: 'Source',
          value: valueOf(values, 'sourceId'),
          issues,
          required: true,
          includeBlank: 'Choose a recorded source',
          options: sources.map((source) => ({
            value: source.id,
            label: `${source.title} · ${SOURCE_TYPE_LABELS[source.sourceType]}`,
          })),
        })}
        ${textField({
          name: 'locator',
          label: 'Locator',
          value: valueOf(values, 'locator'),
          issues,
          required: true,
          maxLength: 500,
          placeholder: 'e.g. README section 1, commit abc123, page 4',
        })}
        ${textareaField({
          name: 'excerpt',
          label: 'Excerpt or artifact description',
          value: valueOf(values, 'excerpt'),
          issues,
          required: true,
          rows: 4,
          maxLength: 20000,
          help: 'Paste only what is needed. Aporia stores this exact excerpt locally.',
        })}
        ${selectField({
          name: 'extractionMethod',
          label: 'Extraction method',
          value: valueOf(values, 'extractionMethod', 'PASTED_TEXT'),
          issues,
          required: true,
          options: EVIDENCE_EXTRACTION_METHODS.map((method) => ({
            value: method,
            label: EVIDENCE_EXTRACTION_METHOD_LABELS[method],
          })),
        })}
        ${dateTimeField({
          name: 'extractedAt',
          label: 'Extracted at',
          value: valueOf(values, 'extractedAt', dateTimeLocalValue(context.now)),
          issues,
          required: true,
        })}
        ${selectField({
          name: 'relation',
          label: 'Relationship to this proposition',
          value: valueOf(values, 'relation', 'SUPPORTS'),
          issues,
          required: true,
          options: EVIDENCE_RELATIONS.map((relation) => ({
            value: relation,
            label: EVIDENCE_RELATION_LABELS[relation],
          })),
        })}
        ${textareaField({
          name: 'rationale',
          label: 'Reviewer rationale',
          value: valueOf(values, 'rationale'),
          issues,
          required: true,
          rows: 2,
          maxLength: 4000,
          help: 'Explain why the excerpt supports, contradicts, qualifies, or does not address the proposition.',
        })}
        ${textField({
          name: 'reviewer',
          label: 'Reviewer',
          value: valueOf(values, 'reviewer', context.deps.config.operator),
          issues,
          required: true,
          maxLength: 80,
          help: 'A local label, not an authenticated identity.',
        })}
        <div class="form-actions">${submitButton('Record evidence')}</div>
      </form>
    </details>
  `;
}

function assessmentFields(
  context: RequestContext,
  claimId: string,
  propositionId: string,
  values: Values,
  issues: readonly ValidationIssue[],
): Html {
  return html`
    <details>
      <summary>Record a reviewed proposition conclusion</summary>
      <form
        method="post"
        action="/projects/${context.params['projectId'] ?? ''}/claims/${claimId}/propositions/${propositionId}/assessments"
        novalidate
      >
        ${csrfField(context.csrfToken)}
        <p class="field-help">
          This is an explicit human assessment. It appears alongside the deterministic evidence-rule
          result and never replaces the recorded relationships.
        </p>
        ${selectField({
          name: 'label',
          label: 'Reviewed status',
          value: valueOf(values, 'label'),
          issues,
          required: true,
          includeBlank: 'Choose a status',
          options: PROPOSITION_STATUSES.map((status) => ({
            value: status,
            label: PROPOSITION_STATUS_LABELS[status],
          })),
        })}
        ${textareaField({
          name: 'rationale',
          label: 'Assessment rationale',
          value: valueOf(values, 'rationale'),
          issues,
          required: true,
          rows: 3,
          maxLength: 4000,
        })}
        ${textField({
          name: 'reviewer',
          label: 'Reviewer',
          value: valueOf(values, 'reviewer', context.deps.config.operator),
          issues,
          required: true,
          maxLength: 80,
        })}
        <div class="form-actions">${submitButton('Record reviewed conclusion')}</div>
      </form>
    </details>
  `;
}

function evidenceDisplay(
  context: RequestContext,
  projectId: string,
  claimId: string,
  propositionId: string,
  rows: ReturnType<typeof listPropositionEvidence>,
  values: Values,
  issues: readonly ValidationIssue[],
): Html {
  if (rows.length === 0) {
    return html`<p class="muted">No evidence relationships recorded.</p>`;
  }
  return html`
    <div class="stack">
      ${rows.map(
        (row) => html`
          <article class="finding ${row.relationship.supersededBy === null ? '' : 'muted'}">
            <p>
              ${statusBadge(EVIDENCE_RELATION_LABELS[row.relationship.relation], row.relationship.relation === 'SUPPORTS' ? 'good' : row.relationship.relation === 'CONTRADICTS' ? 'bad' : 'warn')}
              ${row.relationship.supersededBy === null ? '' : statusBadge('Superseded')} ·
              ${SOURCE_TYPE_LABELS[row.source.sourceType]} ·
              ${SOURCE_INDEPENDENCE_LABELS[row.source.independence]}
            </p>
            <p><strong>${row.source.title}</strong> ${externalUrl(row.source.canonicalUri)}</p>
            <p class="small muted">
              Locator: ${row.evidence.locator} · extracted
              ${formatDateTime(row.evidence.extractedAt)}
            </p>
            <pre class="raw-answer">${row.evidence.excerpt}</pre>
            <p><strong>Rationale:</strong> ${row.relationship.rationale}</p>
            <p class="small muted">
              Reviewer: ${row.relationship.reviewer} · ${formatDateTime(row.relationship.createdAt)}
            </p>
            ${
              row.relationship.supersededBy === null
                ? html`
                    <details>
                      <summary>Supersede this relationship</summary>
                      <form
                        method="post"
                        action="/projects/${projectId}/claims/${claimId}/propositions/${propositionId}/relationships/${row.relationship.id}/supersede"
                        novalidate
                      >
                        ${csrfField(context.csrfToken)}
                        ${selectField({
                          name: 'relation',
                          label: 'New relationship',
                          value: valueOf(values, 'relation', row.relationship.relation),
                          issues,
                          required: true,
                          options: EVIDENCE_RELATIONS.map((relation) => ({
                            value: relation,
                            label: EVIDENCE_RELATION_LABELS[relation],
                          })),
                        })}
                        ${textareaField({
                          name: 'rationale',
                          label: 'Correction rationale',
                          value: valueOf(values, 'rationale'),
                          issues,
                          required: true,
                          rows: 2,
                          maxLength: 4000,
                        })}
                        ${textField({
                          name: 'reviewer',
                          label: 'Reviewer',
                          value: valueOf(values, 'reviewer', context.deps.config.operator),
                          issues,
                          required: true,
                          maxLength: 80,
                        })}
                        <div class="form-actions">
                          ${submitButton('Supersede relationship', 'secondary')}
                        </div>
                      </form>
                    </details>
                  `
                : html`<p class="small muted">
                    Superseded by ${row.relationship.supersededBy} at
                    ${formatDateTime(row.relationship.supersededAt)}.
                  </p>`
            }
          </article>
        `,
      )}
    </div>
  `;
}

function propositionBlock(
  context: RequestContext,
  projectId: string,
  claimId: string,
  proposition: ReturnType<typeof getClaimOrThrow>['propositions'][number],
  canAssess: boolean,
  canAdd: boolean,
  sources: ReturnType<typeof listSources>,
  values: Values,
  issues: readonly ValidationIssue[],
): Html {
  const relationships = listPropositionEvidence(context.deps.db, projectId, proposition.id);
  const active = activeRelationshipsForProposition(context.deps.db, projectId, proposition.id);
  const derived = deriveEvidenceStatus(active);
  const assessments = listPropositionAssessments(context.deps.db, projectId, proposition.id);
  const coreAssessments: RecordedPropositionAssessment[] = assessments.map((assessment) => ({
    id: assessment.id,
    version: assessment.version,
    label: assessment.label,
    rationale: assessment.rationale,
    method: assessment.method,
    reviewer: assessment.reviewer,
    createdAt: assessment.createdAt,
  }));
  const conclusion = resolvePropositionConclusion(derived, coreAssessments);
  return html`
    <article class="card home-grid">
      <p class="muted small">
        Proposition ${proposition.ordinal} · ${formatDateTime(proposition.createdAt)}
      </p>
      <h3>${proposition.text}</h3>
      <dl class="definition-list">
        ${definitionRow('Evidence requirements', html`${proposition.evidenceRequirements}`)}
        ${
          proposition.expectedAnswerCriterion === null
            ? ''
            : definitionRow(
                'Expected answer criterion',
                html`${proposition.expectedAnswerCriterion}`,
              )
        }
        ${
          proposition.ambiguityNotes === null
            ? ''
            : definitionRow('Unresolved ambiguity', html`${proposition.ambiguityNotes}`)
        }
        ${definitionRow(
          'Primary conclusion',
          html`${propositionStatusBadge(conclusion.primary.status)}
            <span class="small muted"
              >${conclusion.primary.method} · ${conclusion.primary.rationale}</span
            >
            ${conclusion.primary.reviewer === null ? '' : html`<span class="small muted">Reviewer: ${conclusion.primary.reviewer}</span>`}`,
        )}
        ${definitionRow(
          'Deterministic rule',
          html`${propositionStatusBadge(derived.status)}
            <span class="small muted">${derived.rationale}</span>
            ${
              derived.notes.length === 0
                ? ''
                : html`<ul class="small muted">
                    ${derived.notes.map((note) => html`<li>${note}</li>`)}
                  </ul>`
            }`,
        )}
      </dl>
      ${
        conclusion.disagreement
          ? html`<div class="notice" role="status">
              The reviewed conclusion and the deterministic evidence rule disagree. Both are
              retained; explain the adjudication in the reviewed rationale.
            </div>`
          : ''
      }
      <h4>Evidence</h4>
      ${evidenceDisplay(context, projectId, claimId, proposition.id, relationships, values, issues)}
      ${evidenceFields(context, proposition.id, claimId, sources, values, issues)}
      ${
        canAssess
          ? assessmentFields(context, claimId, proposition.id, values, issues)
          : html`<p class="small muted">
              Reviewed conclusions require the claim to be under review or assessed.
            </p>`
      }
      ${canAdd ? '' : html`<p class="small muted">Propositions are locked after review starts. Create a new revision to change decomposition.</p>`}
      ${
        assessments.length > 0
          ? html`
              <details>
                <summary>Reviewed assessment history (${assessments.length})</summary>
                <ol class="small">
                  ${assessments.map(
                    (assessment) => html`
                      <li>
                        <strong
                          >v${assessment.version} ·
                          ${PROPOSITION_STATUS_LABELS[assessment.label]}</strong
                        >
                        <div>${assessment.rationale}</div>
                        <div class="muted">
                          ${assessment.reviewer} · ${formatDateTime(assessment.createdAt)}
                        </div>
                      </li>
                    `,
                  )}
                </ol>
              </details>
            `
          : ''
      }
      ${
        sources.length === 0
          ? ''
          : html`<p class="small muted">
              Evidence is classified by a human reviewer. Reclassify by superseding the
              relationship; history remains visible.
            </p>`
      }
    </article>
  `;
}

function statusActions(
  context: RequestContext,
  claim: ReturnType<typeof getClaimOrThrow>,
  projectId: string,
  hasPropositions: boolean,
): Html {
  const id = claim.claim.id;
  const status = claim.claim.status;
  const action = (to: ClaimStatus, label: string) =>
    canTransitionClaim(status, to)
      ? html`<form
          class="inline-form"
          method="post"
          action="/projects/${projectId}/claims/${id}/status"
        >
          ${csrfField(context.csrfToken)}<input type="hidden" name="to" value="${to}" /><button
            class="button button-small"
            type="submit"
          >
            ${label}
          </button>
        </form>`
      : '';
  return html`
    <div class="page-actions">
      ${
        status === 'SUBMITTED' || status === 'DECOMPOSED'
          ? hasPropositions
            ? action('UNDER_REVIEW', 'Start review')
            : html`<span class="small muted"
                >Add and decompose at least one proposition before starting review.</span
              >`
          : ''
      }
      ${action('ASSESSED', 'Mark assessed')}
      ${status === 'ASSESSED' || status === 'DISPUTED' ? action('UNDER_REVIEW', 'Return to review') : ''}
    </div>
    ${
      canTransitionClaim(status, 'DISPUTED')
        ? html`
            <details>
              <summary>Record a dispute</summary>
              <form method="post" action="/projects/${projectId}/claims/${id}/status">
                ${csrfField(context.csrfToken)}
                <input type="hidden" name="to" value="DISPUTED" />
                ${textareaField({
                  name: 'reason',
                  label: 'Dispute reason',
                  value: '',
                  required: true,
                  rows: 2,
                  maxLength: 1000,
                  help: 'This reason is recorded in the audit trail.',
                })}
                <div class="form-actions">${submitButton('Mark disputed', 'danger')}</div>
              </form>
            </details>
          `
        : ''
    }
  `;
}

function claimDetailPage(
  context: RequestContext,
  projectId: string,
  claimId: string,
  options: { issues?: readonly ValidationIssue[]; values?: Values; notice?: string | null } = {},
): Html {
  const claim = getClaimOrThrow(context.deps.db, projectId, claimId);
  const detail = getProjectOrThrow(context.deps.db, projectId);
  const sources = listSources(context.deps.db, projectId);
  const values = options.values ?? new Map<string, string>();
  const issues = options.issues ?? [];
  const canAdd = canAddProposition(claim.claim.status);
  const canAssess = canRecordPropositionAssessment(claim.claim.status);
  const body = html`
    ${pageHeader(
      claim.currentRevision?.text ?? 'Claim revision unavailable',
      `${CLAIM_STATUS_LABELS[claim.claim.status]} · ${plural(claim.propositions.length, 'proposition')}`,
      html`<a class="button" href="/projects/${projectId}/claims">All claims</a>`,
    )}
    ${errorSummary(issues)}
    <div class="grid">
      <section class="card">
        <h2>Current revision</h2>
        <dl class="definition-list">
          ${definitionRow('Revision', html`${claim.currentRevision?.revisionNumber ?? 'None'}`)}
          ${definitionRow('Locale', html`${claim.currentRevision?.locale ?? 'Not recorded'}`)}
          ${definitionRow(
            'Source',
            claim.currentRevision?.sourceUrl === null ||
              claim.currentRevision?.sourceUrl === undefined
              ? html`<span class="muted">Not recorded</span>`
              : externalUrl(claim.currentRevision.sourceUrl),
          )}
          ${definitionRow(
            'Time scope',
            html`${claim.currentRevision?.timeScope ?? 'Not recorded'}`,
          )}
          ${definitionRow(
            'Intended meaning',
            html`${claim.currentRevision?.intendedMeaning ?? 'Not recorded'}`,
          )}
        </dl>
        <p class="small muted">
          Project: <a href="/projects/${projectId}">${detail.project.name}</a> · created
          ${formatDateTime(claim.claim.createdAt)} · updated
          ${formatDateTime(claim.claim.updatedAt)}
        </p>
        ${statusActions(context, claim, projectId, claim.propositions.length > 0)}
      </section>
      <section class="card">
        <h2>Revision history</h2>
        <ol class="small">
          ${claim.revisions
            .slice()
            .reverse()
            .map(
              (revision) => html`
                <li>
                  <strong>v${revision.revisionNumber}</strong> ·
                  ${formatDateTime(revision.createdAt)} · ${revision.createdBy}
                  ${revision.id === claim.claim.currentRevisionId ? statusBadge('Current') : ''}
                  <div class="muted">${revision.text}</div>
                </li>
              `,
            )}
        </ol>
        <details>
          <summary>Create a new claim revision</summary>
          <form
            method="post"
            action="/projects/${projectId}/claims/${claim.claim.id}/revisions"
            novalidate
          >
            ${csrfField(context.csrfToken)}
            <p class="field-help">
              A new revision is immutable. It becomes current, resets the claim to submitted, and
              starts a new decomposition; evidence on prior revisions remains in history.
            </p>
            ${claimRevisionFields(values, issues)}
            <div class="form-actions">${submitButton('Create revision')}</div>
          </form>
        </details>
      </section>
    </div>
    <h2>Propositions</h2>
    ${
      claim.propositions.length === 0
        ? emptyState(
            'No propositions yet',
            'Split the claim into bounded statements that can be assessed independently.',
          )
        : html`<div class="stack">
            ${claim.propositions.map((proposition) =>
              propositionBlock(
                context,
                projectId,
                claim.claim.id,
                proposition,
                canAssess,
                canAdd,
                sources,
                values,
                issues,
              ),
            )}
          </div>`
    }
    ${
      canAdd
        ? html`
            <section class="card home-grid">
              <h2>Add proposition</h2>
              <form
                method="post"
                action="/projects/${projectId}/claims/${claim.claim.id}/propositions"
                novalidate
              >
                ${csrfField(context.csrfToken)}
                ${textareaField({
                  name: 'text',
                  label: 'Proposition text',
                  value: valueOf(values, 'text'),
                  issues,
                  required: true,
                  rows: 3,
                  maxLength: 2000,
                })}
                ${textField({ name: 'subject', label: 'Subject (optional)', value: valueOf(values, 'subject'), issues, maxLength: 500 })}
                ${textField({ name: 'predicate', label: 'Predicate (optional)', value: valueOf(values, 'predicate'), issues, maxLength: 500 })}
                ${textField({ name: 'objectValue', label: 'Object / value (optional)', value: valueOf(values, 'objectValue'), issues, maxLength: 500 })}
                ${textAreaSmall('conditions', 'Conditions (optional)', values, issues)}
                ${textField({ name: 'timeInterval', label: 'Time interval (optional)', value: valueOf(values, 'timeInterval'), issues, maxLength: 500 })}
                ${textField({ name: 'units', label: 'Units / metric definition (optional)', value: valueOf(values, 'units'), issues, maxLength: 500 })}
                ${textareaField({
                  name: 'evidenceRequirements',
                  label: 'Evidence requirements',
                  value: valueOf(values, 'evidenceRequirements'),
                  issues,
                  required: true,
                  rows: 2,
                  maxLength: 2000,
                })}
                ${textAreaSmall('expectedAnswerCriterion', 'Expected answer criterion (optional)', values, issues)}
                ${textAreaSmall('ambiguityNotes', 'Unresolved ambiguity (optional)', values, issues)}
                <div class="form-actions">${submitButton('Add proposition')}</div>
              </form>
            </section>
          `
        : html`<p class="small muted">
            Review has started, so decomposition is locked. Create a new revision to change it.
          </p>`
    }
  `;
  return page(
    'Claim',
    body,
    projectId,
    'claims',
    options.notice ?? context.url.searchParams.get('notice'),
  );
}

export const claimRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/projects/:projectId/claims',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const detail = getProjectOrThrow(context.deps.db, projectId);
      const claims = listClaims(context.deps.db, projectId);
      const body = html`
        ${pageHeader(
          'Claims',
          'Versioned user claims decomposed into atomic propositions. A revision never overwrites its predecessor.',
          html`<a class="button button-primary" href="/projects/${projectId}/claims/new"
            >Add claim</a
          >`,
        )}
        ${
          claims.length === 0
            ? emptyState(
                'No claims recorded',
                'Enter the actual statement you want to evaluate. Aporia does not include sample claims.',
                html`<a class="button button-primary" href="/projects/${projectId}/claims/new"
                  >Add the first claim</a
                >`,
              )
            : html`
                <div class="table-wrap">
                  <table>
                    <caption>
                      Claims in ${detail.project.name}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Current text</th>
                        <th scope="col">Status</th>
                        <th scope="col">Propositions</th>
                        <th scope="col">Updated</th>
                        <th scope="col">Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${claims.map(
                        (claim) => html`
                          <tr>
                            <td>${claim.currentText ?? 'No current revision'}</td>
                            <td>${statusBadge(CLAIM_STATUS_LABELS[claim.status])}</td>
                            <td>${claim.propositionCount}</td>
                            <td>${formatDateTime(claim.updatedAt)}</td>
                            <td>
                              <a href="/projects/${projectId}/claims/${claim.id}">Open claim</a>
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
        page('Claims', body, projectId, 'claims', context.url.searchParams.get('notice')),
      );
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/claims/new',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      getProjectOrThrow(context.deps.db, projectId);
      const body = html`
        ${pageHeader(
          'Add claim',
          'Record the exact statement, where it came from, and its scope. The first revision is immutable.',
          html`<a class="button" href="/projects/${projectId}/claims">Back to claims</a>`,
        )}
        <div class="form-narrow">
          <form method="post" action="/projects/${projectId}/claims" novalidate>
            ${csrfField(context.csrfToken)} ${claimRevisionFields(context.fields, [])}
            <div class="form-actions">
              ${submitButton('Record claim')}
              <a class="button button-secondary" href="/projects/${projectId}/claims">Cancel</a>
            </div>
          </form>
        </div>
      `;
      return htmlResponse(page('Add claim', body, projectId, 'claims', null));
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/claims',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const result = validateClaimRevisionInput(
        Object.fromEntries(context.fields.entries()) as Record<string, unknown>,
      );
      if (!result.ok) {
        getProjectOrThrow(context.deps.db, projectId);
        const body = html`
          ${pageHeader('Add claim', 'Correct the highlighted fields and submit again.')}
          ${errorSummary(result.issues)}
          <div class="form-narrow">
            <form method="post" action="/projects/${projectId}/claims" novalidate>
              ${csrfField(context.csrfToken)} ${claimRevisionFields(context.fields, result.issues)}
              <div class="form-actions">${submitButton('Record claim')}</div>
            </form>
          </div>
        `;
        return htmlResponse(page('Add claim', body, projectId, 'claims', null), 422);
      }
      const claim = createClaim(context.deps.db, projectId, result.value, writeContext(context));
      return redirectWithNotice(`/projects/${projectId}/claims/${claim.claim.id}`, 'claim-created');
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/claims/:claimId',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const claimId = context.params['claimId'] ?? '';
      return htmlResponse(claimDetailPage(context, projectId, claimId));
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/claims/:claimId/propositions',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const claimId = context.params['claimId'] ?? '';
      const result = validatePropositionInput(
        Object.fromEntries(context.fields.entries()) as Record<string, unknown>,
      );
      if (!result.ok) {
        return htmlResponse(
          claimDetailPage(context, projectId, claimId, {
            issues: result.issues,
            values: context.fields,
          }),
          422,
        );
      }
      addProposition(context.deps.db, projectId, claimId, result.value, writeContext(context));
      return redirectWithNotice(`/projects/${projectId}/claims/${claimId}`, 'proposition-added');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/claims/:claimId/revisions',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const claimId = context.params['claimId'] ?? '';
      const result = validateClaimRevisionInput(
        Object.fromEntries(context.fields.entries()) as Record<string, unknown>,
      );
      if (!result.ok) {
        return htmlResponse(
          claimDetailPage(context, projectId, claimId, {
            issues: result.issues,
            values: context.fields,
          }),
          422,
        );
      }
      addClaimRevision(context.deps.db, projectId, claimId, result.value, writeContext(context));
      return redirectWithNotice(`/projects/${projectId}/claims/${claimId}`, 'revision-created');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/claims/:claimId/status',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const claimId = context.params['claimId'] ?? '';
      const claim = getClaimOrThrow(context.deps.db, projectId, claimId);
      const toResult = enumValue(context.fields.get('to'), 'to', CLAIM_STATUSES);
      if (!toResult.ok) {
        return htmlResponse(
          claimDetailPage(context, projectId, claimId, { issues: toResult.issues }),
          422,
        );
      }
      const to = toResult.value;
      const reason = context.fields.get('reason')?.trim();
      if (!canTransitionClaim(claim.claim.status, to)) {
        return htmlResponse(
          claimDetailPage(context, projectId, claimId, {
            issues: [
              {
                field: 'to',
                message: `The claim cannot move from ${claim.claim.status} to ${to}.`,
              },
            ],
          }),
          422,
        );
      }
      if (to === 'UNDER_REVIEW' && claim.propositions.length === 0) {
        return htmlResponse(
          claimDetailPage(context, projectId, claimId, {
            issues: [{ field: 'to', message: 'Add at least one proposition before review.' }],
          }),
          422,
        );
      }
      if (to === 'DISPUTED' && (reason === undefined || reason.length < 3)) {
        return htmlResponse(
          claimDetailPage(context, projectId, claimId, {
            issues: [{ field: 'reason', message: 'A dispute reason is required.' }],
          }),
          422,
        );
      }
      transitionClaim(context.deps.db, projectId, claimId, to, writeContext(context), reason);
      return redirectWithNotice(`/projects/${projectId}/claims/${claimId}`, 'claim-status');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/claims/:claimId/propositions/:propositionId/evidence',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const claimId = context.params['claimId'] ?? '';
      const propositionId = context.params['propositionId'] ?? '';
      const raw = Object.fromEntries(context.fields.entries()) as Record<string, unknown>;
      raw['extractedAt'] = normalizeDateTimeInput(context.fields.get('extractedAt'));
      const result = validateEvidenceWithRelationInput(raw);
      if (!result.ok) {
        return htmlResponse(
          claimDetailPage(context, projectId, claimId, {
            issues: result.issues,
            values: context.fields,
          }),
          422,
        );
      }
      recordEvidence(
        context.deps.db,
        projectId,
        context.fields.get('sourceId') ?? '',
        propositionId,
        result.value,
        writeContext(context),
      );
      return redirectWithNotice(`/projects/${projectId}/claims/${claimId}`, 'evidence-created');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/claims/:claimId/propositions/:propositionId/assessments',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const claimId = context.params['claimId'] ?? '';
      const propositionId = context.params['propositionId'] ?? '';
      const result = validatePropositionAssessmentInput(
        Object.fromEntries(context.fields.entries()) as Record<string, unknown>,
      );
      if (!result.ok) {
        return htmlResponse(
          claimDetailPage(context, projectId, claimId, {
            issues: result.issues,
            values: context.fields,
          }),
          422,
        );
      }
      recordPropositionAssessment(
        context.deps.db,
        projectId,
        propositionId,
        result.value,
        writeContext(context),
      );
      return redirectWithNotice(`/projects/${projectId}/claims/${claimId}`, 'proposition-assessed');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/claims/:claimId/propositions/:propositionId/relationships/:relationshipId/supersede',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const claimId = context.params['claimId'] ?? '';
      const propositionId = context.params['propositionId'] ?? '';
      const relationshipId = context.params['relationshipId'] ?? '';
      const relationship = getRelationship(context.deps.db, projectId, relationshipId);
      const claim = getClaimOrThrow(context.deps.db, projectId, claimId);
      if (
        relationship === null ||
        relationship.propositionId !== propositionId ||
        !claim.propositions.some((proposition) => proposition.id === propositionId)
      ) {
        throw new AppError('NOT_FOUND', 'Evidence relationship not found for this proposition.');
      }
      const result = validateRelationshipChangeInput(
        Object.fromEntries(context.fields.entries()) as Record<string, unknown>,
      );
      if (!result.ok) {
        return htmlResponse(
          claimDetailPage(context, projectId, claimId, {
            issues: result.issues,
            values: context.fields,
          }),
          422,
        );
      }
      supersedeRelationship(
        context.deps.db,
        projectId,
        relationshipId,
        result.value,
        writeContext(context),
      );
      return redirectWithNotice(
        `/projects/${projectId}/claims/${claimId}`,
        'relationship-superseded',
      );
    },
  },
];
