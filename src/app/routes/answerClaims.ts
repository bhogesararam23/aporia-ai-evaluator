import {
  validateAnswerClaimAssessmentInput,
  validateAnswerClaimDraftInput,
  validateClaimCitationLinkInput,
  validateClaimPropositionLinkInput,
} from '../../core/answerClaimInputs.ts';
import {
  ANSWER_OFFSET_BASES,
  ANSWER_OFFSET_BASIS_DESCRIPTIONS,
  ANSWER_OFFSET_BASIS_LABELS,
  ANSWER_STATEMENT_KIND_DESCRIPTIONS,
  ANSWER_STATEMENT_KIND_LABELS,
  CLAIM_ATTRIBUTION_DESCRIPTIONS,
  CLAIM_ATTRIBUTION_DISPLAY,
  CLAIM_ATTRIBUTION_LABELS,
  CLAIM_CITATION_SUPPORT_DESCRIPTIONS,
  CLAIM_CITATION_SUPPORT_DISPLAY,
  CLAIM_CITATION_SUPPORT_LABELS,
  CLAIM_FIDELITY_DESCRIPTIONS,
  CLAIM_FIDELITY_DISPLAY,
  CLAIM_FIDELITY_LABELS,
  CLAIM_PROPOSITION_RELATION_DESCRIPTIONS,
  CLAIM_PROPOSITION_RELATION_LABELS,
  CLAIM_PROPOSITION_RELATIONS,
  CLAIM_RELEVANCE_DESCRIPTIONS,
  CLAIM_RELEVANCE_LABELS,
  CLAIM_RELEVANCES,
} from '../../core/answerClaims.ts';
import type { ValidationIssue } from '../../core/validation.ts';
import { requiredText } from '../../core/validation.ts';
import {
  citationMappingRelevance,
  createAnswerClaim,
  currentClaimLabels,
  currentClaimRelevance,
  getAnswerClaimWorkspace,
  linkAnswerClaimCitation,
  linkAnswerClaimProposition,
  propositionLinkRelevance,
  recordAnswerClaimAssessment,
  reviseAnswerClaim,
  supersedeAnswerClaimCitation,
  supersedeAnswerClaimProposition,
  voidAnswerClaim,
  type AnswerClaimRecord,
  type AnswerClaimWorkspace,
  type ClaimCitationLinkRecord,
  type ClaimPropositionLinkRecord,
} from '../../persistence/repositories/answerClaims.ts';
import { htmlResponse, redirectWithNotice, type AppResponse } from '../http/responses.ts';
import { writeContext, type RequestContext, type RouteDefinition } from '../http/types.ts';
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

/** Where a form posts to, and whether the observation is still writable. */
interface Target {
  readonly projectId: string;
  readonly runId: string;
  readonly observationId: string;
  readonly csrf: string;
  readonly writable: boolean;
}

interface FormState {
  readonly issues: readonly ValidationIssue[];
  readonly values: Values;
}

const EMPTY_FORM: FormState = { issues: [], values: new Map() };

function rawFields(context: RequestContext): Record<string, unknown> {
  return Object.fromEntries(context.fields.entries()) as Record<string, unknown>;
}

function formState(context: RequestContext, issues: readonly ValidationIssue[] = []): FormState {
  return { issues, values: context.fields };
}

function claimsPath(target: Target): string {
  return `/projects/${target.projectId}/runs/${target.runId}/observations/${target.observationId}/claims`;
}

/** Path a per-statement form posts to, including the statement id. */
function claimPath(claim: AnswerClaimRecord, target: Target): string {
  return `${claimsPath(target)}/${claim.id}`;
}

function labelFor(labels: Readonly<Record<string, string>>, value: string): string {
  return labels[value] ?? humanize(value);
}

function optionsFor(values: readonly string[], labels: Readonly<Record<string, string>>) {
  return values.map((value) => ({ value, label: labels[value] ?? humanize(value) }));
}

// ---------------------------------------------------------------------------
// Panels that explain the vocabulary, so no operator has to read the database schema.
// ---------------------------------------------------------------------------

function answerPanel(workspace: AnswerClaimWorkspace, target: Target): Html {
  const readOnlyReason =
    workspace.voidedAt !== null
      ? 'This observation was voided, so no statement may be added or changed. Existing statements stay readable.'
      : `The run is ${humanize(workspace.runStatus)}, so its answers are frozen. Generate a new report instead of re-judging a finalized run.`;
  return html`
    <section class="panel" id="captured-answer">
      <h2>The captured answer, exactly as recorded</h2>
      ${
        !target.writable
          ? html`<div class="notice notice-warn" role="status"><p>${readOnlyReason}</p></div>`
          : ''
      }
      ${
        workspace.answerText === null
          ? html`<p class="muted">No answer text was captured for this observation.</p>`
          : html`<blockquote class="answer-text">${workspace.answerText}</blockquote>`
      }
      <p class="field-help">
        This text is immutable. Recording statements here never changes it, and a quoted statement
        is only stored if it can be located inside it.
      </p>
      ${definitionRow('Question asked', html`<span>${workspace.queryTextSnapshot}</span>`)}
      ${definitionRow('Citation metadata', html`<span>${humanize(workspace.citationCapture)}</span>`)}
      ${definitionRow(
        'Statements recorded',
        html`<span>${plural(workspace.claims.length, 'statement')}</span>`,
      )}
      ${definitionRow(
        'Citations available',
        html`<span
          >${plural(workspace.citations.filter((row) => !row.voided).length, 'citation')}</span
        >`,
      )}
      ${definitionRow(
        'Target propositions available',
        html`<span>${plural(workspace.propositions.length, 'proposition')}</span>`,
      )}
    </section>
  `;
}

function statementKindHelp(): Html {
  return html`<div class="field-help">
    <p>
      A quote asserts the answer contained these words. A reviewer description is your own wording.
    </p>
    <dl class="vocabulary">
      ${Object.entries(ANSWER_STATEMENT_KIND_DESCRIPTIONS).map(
        ([key, value]) =>
          html`<dt>
              ${ANSWER_STATEMENT_KIND_LABELS[key as keyof typeof ANSWER_STATEMENT_KIND_LABELS]}
            </dt>
            <dd>${value}</dd>`,
      )}
    </dl>
  </div>`;
}

function relevanceHelp(): Html {
  return html`<dl class="vocabulary">
    ${CLAIM_RELEVANCES.map(
      (value) =>
        html`<dt>${CLAIM_RELEVANCE_LABELS[value]}</dt>
          <dd>${CLAIM_RELEVANCE_DESCRIPTIONS[value]}</dd>`,
    )}
  </dl>`;
}

function addStatementForm(target: Target, state: FormState): Html {
  const { issues, values } = state;
  return html`
    <section class="panel" id="add-statement">
      <h2>Record a statement</h2>
      <form method="post" action="${claimsPath(target)}">
        ${csrfField(target.csrf)}
        ${textareaField({
          name: 'quoteText',
          label: 'Statement text',
          value: valueOf(values, 'quoteText'),
          issues,
          required: true,
          rows: 3,
          maxLength: 4000,
          help: 'For a quote, paste the words exactly as the answer shows them. For an omission or a summary, write it in your own words and choose the reviewer-description kind.',
        })}
        ${selectField({
          name: 'statementKind',
          label: 'What is this text?',
          value: valueOf(values, 'statementKind', 'QUOTED'),
          issues,
          required: true,
          options: optionsFor(
            Object.keys(ANSWER_STATEMENT_KIND_LABELS),
            ANSWER_STATEMENT_KIND_LABELS,
          ),
          help: 'Only a quote may claim a position inside the answer.',
        })}
        ${selectField({
          name: 'offsetBasis',
          label: 'How reliably can this be located in the answer?',
          value: valueOf(values, 'offsetBasis', 'EXACT_MATCH'),
          issues,
          required: true,
          options: optionsFor(ANSWER_OFFSET_BASES, ANSWER_OFFSET_BASIS_LABELS),
          help: 'Choose “no reliable position” for a reviewer description. A mismatched position is refused.',
        })}
        ${selectField({
          name: 'relevance',
          label: 'How does it relate to what we are evaluating?',
          value: valueOf(values, 'relevance', 'ADDRESSES'),
          issues,
          required: true,
          options: optionsFor(CLAIM_RELEVANCES, CLAIM_RELEVANCE_LABELS),
          help: 'Relevance is separate from accuracy. Refusal, abstention, and omission are never a negative factual verdict.',
        })}
        ${textField({
          name: 'paraphrase',
          label: 'Your reading of it (optional)',
          value: valueOf(values, 'paraphrase'),
          issues,
          maxLength: 2000,
          help: 'Only if the answer’s wording needs unpacking. This never replaces the original text.',
        })}
        ${textField({
          name: 'note',
          label: 'Note for the reviewer record (optional)',
          value: valueOf(values, 'note'),
          issues,
          maxLength: 2000,
        })}
        <p>${submitButton('Record statement')}</p>
      </form>
      <details>
        <summary>What each relevance choice means</summary>
        ${relevanceHelp()} ${statementKindHelp()}
      </details>
    </section>
  `;
}

function reviseStatementForm(claim: AnswerClaimRecord, target: Target, state: FormState): Html {
  const { issues, values } = state;
  const revision = claim.currentRevision;
  const action = `${claimPath(claim, target)}/${claim.id}/revise`;
  return html`
    <form method="post" action="${action}">
      ${csrfField(target.csrf)}
      ${textareaField({
        name: 'quoteText',
        label: 'Corrected statement text',
        value: valueOf(values, `revise-${claim.id}-quoteText`, revision?.quoteText ?? ''),
        issues,
        required: true,
        rows: 3,
        maxLength: 4000,
        help: 'The earlier revision and everything assessed against it are kept. Nothing is overwritten.',
      })}
      ${selectField({
        name: 'offsetBasis',
        label: 'How reliably can the corrected text be located?',
        value: valueOf(
          values,
          `revise-${claim.id}-offsetBasis`,
          revision?.offsetBasis ?? 'EXACT_MATCH',
        ),
        issues,
        required: true,
        options: optionsFor(ANSWER_OFFSET_BASES, ANSWER_OFFSET_BASIS_LABELS),
      })}
      ${selectField({
        name: 'relevance',
        label: 'Relationship to what we are evaluating',
        value: valueOf(values, `revise-${claim.id}-relevance`, revision?.relevance ?? 'ADDRESSES'),
        issues,
        required: true,
        options: optionsFor(CLAIM_RELEVANCES, CLAIM_RELEVANCE_LABELS),
      })}
      ${textField({
        name: 'paraphrase',
        label: 'Your reading of it (optional)',
        value: valueOf(values, `revise-${claim.id}-paraphrase`, revision?.paraphrase ?? ''),
        issues,
        maxLength: 2000,
      })}
      ${textField({
        name: 'note',
        label: 'Note (optional)',
        value: valueOf(values, `revise-${claim.id}-note`, revision?.note ?? ''),
        issues,
        maxLength: 2000,
      })}
      <p>${submitButton('Save as a new revision', 'secondary')}</p>
    </form>
  `;
}

function propositionLinkForm(
  claim: AnswerClaimRecord,
  workspace: AnswerClaimWorkspace,
  target: Target,
  state: FormState,
): Html {
  const { issues, values } = state;
  const key = `${claim.id}-link`;
  const used = new Set(
    claim.propositionLinks
      .filter((row) => row.supersededBy === null)
      .map((row) => row.propositionId),
  );
  const available = workspace.propositions.filter((row) => !used.has(row.id));
  if (available.length === 0) {
    return html`<p class="muted">
      Every available proposition is already linked to this statement.
    </p>`;
  }
  return html`
    <form method="post" action="${claimPath(claim, target)}/${claim.id}/propositions">
      ${csrfField(target.csrf)}
      ${selectField({
        name: 'propositionId',
        label: 'Target proposition',
        value: valueOf(values, `${key}-propositionId`),
        issues,
        required: true,
        includeBlank: 'Choose a proposition',
        options: available.map((row) => ({
          value: row.id,
          label: `P${String(row.ordinal)}: ${row.text}`,
        })),
        help: 'One statement can address several propositions, and several statements can address one proposition.',
      })}
      ${selectField({
        name: 'relation',
        label: 'Relationship',
        value: valueOf(values, `${key}-relation`, 'SUPPORTS_TARGET'),
        issues,
        required: true,
        options: optionsFor(CLAIM_PROPOSITION_RELATIONS, CLAIM_PROPOSITION_RELATION_LABELS),
        help: 'Refuses, abstentions and omissions are separate relationships and are never scored as denials.',
      })}
      ${textareaField({
        name: 'rationale',
        label: 'Why this relationship',
        value: valueOf(values, `${key}-rationale`),
        issues,
        required: true,
        rows: 2,
        maxLength: 4000,
        help: 'Name what you compared. An unsupported link is not recorded as a judgement.',
      })}
      ${textField({
        name: 'reviewer',
        label: 'Reviewer label',
        value: valueOf(values, `${key}-reviewer`, reviewerDefault()),
        issues,
        required: true,
        maxLength: 80,
        help: 'A locally entered label. It is not an authenticated identity and proves no independent review.',
      })}
      <p>${submitButton('Link to proposition')}</p>
    </form>
  `;
}

function reviewerDefault(): string {
  // The operator label comes from configuration, never from the form, so it is left blank here and
  // the validator requires the operator to type it. An empty field must not silently borrow an
  // identity.
  return '';
}

function citationLinkForm(
  claim: AnswerClaimRecord,
  workspace: AnswerClaimWorkspace,
  target: Target,
  state: FormState,
): Html {
  const { issues, values } = state;
  const key = `${claim.id}-cit`;
  const used = new Set(
    claim.citationLinks.filter((row) => row.supersededBy === null).map((row) => row.citationId),
  );
  const available = workspace.citations.filter((row) => !used.has(row.id) && !row.voided);
  if (workspace.citationCapture !== 'CAPTURED') {
    return html`<p class="muted">
      The capture states that citation metadata was ${humanize(workspace.citationCapture)}, so no
      citation can be mapped. That is an unavailable check, not a citation failure.
    </p>`;
  }
  if (available.length === 0) {
    return html`<p class="muted">No unmapped citation remains for this answer.</p>`;
  }
  return html`
    <form method="post" action="${claimPath(claim, target)}/${claim.id}/citations">
      ${csrfField(target.csrf)}
      ${selectField({
        name: 'citationId',
        label: 'Citation from this answer',
        value: valueOf(values, `${key}-citationId`),
        issues,
        required: true,
        includeBlank: 'Choose a citation',
        options: available.map((row) => ({
          value: row.id,
          label: `#${String(row.position)} ${row.title ?? row.url}`,
        })),
        help: 'Only citations captured with this answer can be mapped. One citation may support several statements.',
      })}
      ${selectField({
        name: 'support',
        label: 'Does the cited material support this statement?',
        value: valueOf(values, `${key}-support`, 'SUPPORTS'),
        issues,
        required: true,
        options: optionsFor(CLAIM_CITATION_SUPPORT_LABELS, CLAIM_CITATION_SUPPORT_DISPLAY),
        help: 'Partial or conditional support is recorded as itself, never as supported.',
      })}
      ${textareaField({
        name: 'rationale',
        label: 'What you compared and what you found',
        value: valueOf(values, `${key}-rationale`),
        issues,
        required: true,
        rows: 2,
        maxLength: 4000,
      })}
      ${textField({
        name: 'reviewer',
        label: 'Reviewer label',
        value: valueOf(values, `${key}-reviewer`),
        issues,
        required: true,
        maxLength: 80,
      })}
      <p>${submitButton('Map citation')}</p>
    </form>
  `;
}

function assessmentForm(claim: AnswerClaimRecord, target: Target, state: FormState): Html {
  const { issues, values } = state;
  const key = `${claim.id}-assess`;
  return html`
    <form method="post" action="${claimPath(claim, target)}/${claim.id}/assessments">
      ${csrfField(target.csrf)}
      ${selectField({
        name: 'dimension',
        label: 'Which assessment are you recording?',
        value: valueOf(values, `${key}-dimension`, 'FIDELITY'),
        issues,
        required: true,
        options: [
          { value: 'FIDELITY', label: 'Fidelity of this statement to the recorded target' },
          { value: 'ATTRIBUTION', label: 'Attribution made by this statement' },
        ],
        help: 'Citation support is recorded on a citation mapping, because one statement can be supported by one citation and contradicted by another.',
      })}
      ${selectField({
        name: 'fidelityLabel',
        label: 'Fidelity outcome',
        value: valueOf(values, `${key}-fidelityLabel`, 'ACCURATE'),
        issues,
        required: true,
        options: optionsFor(CLAIM_FIDELITY_LABELS, CLAIM_FIDELITY_DISPLAY),
        help: 'Accurate means accurate against the recorded evidence, within the recorded scope.',
      })}
      ${selectField({
        name: 'attributionLabel',
        label: 'Attribution outcome',
        value: valueOf(values, `${key}-attributionLabel`, 'NOT_ADDRESSED'),
        issues,
        required: true,
        options: optionsFor(CLAIM_ATTRIBUTION_LABELS, CLAIM_ATTRIBUTION_DISPLAY),
        help: 'A name appearing in the answer is not attribution. Silence about credit is not incorrect credit.',
      })}
      ${textField({
        name: 'attributionSubject',
        label: 'Who the answer credited (attribution only)',
        value: valueOf(values, `${key}-attributionSubject`),
        issues,
        maxLength: 200,
      })}
      ${textField({
        name: 'attributionRole',
        label: 'Which role the answer claimed (attribution only)',
        value: valueOf(values, `${key}-attributionRole`),
        issues,
        maxLength: 200,
      })}
      ${textareaField({
        name: 'rationale',
        label: 'Why',
        value: valueOf(values, `${key}-rationale`),
        issues,
        required: true,
        rows: 2,
        maxLength: 4000,
      })}
      ${textField({
        name: 'reviewer',
        label: 'Reviewer label',
        value: valueOf(values, `${key}-reviewer`),
        issues,
        required: true,
        maxLength: 80,
      })}
      <p>${submitButton('Record assessment')}</p>
    </form>
  `;
}

function voidStatementForm(claim: AnswerClaimRecord, target: Target, state: FormState): Html {
  const { issues, values } = state;
  const key = `${claim.id}-void`;
  return html`
    <form method="post" action="${claimPath(claim, target)}/${claim.id}/void">
      ${csrfField(target.csrf)}
      ${textareaField({
        name: 'reason',
        label: 'Why is this statement record voided?',
        value: valueOf(values, `${key}-reason`),
        issues,
        required: true,
        rows: 2,
        maxLength: 2000,
        help: 'Voiding hides nothing: the statement and its assessments stay readable and leave the metrics.',
      })}
      <p>${submitButton('Void statement', 'danger')}</p>
    </form>
  `;
}

function linkRow(
  link: ClaimPropositionLinkRecord,
  workspace: AnswerClaimWorkspace,
  claim: AnswerClaimRecord,
  target: Target,
  state: FormState,
): Html {
  const proposition = workspace.propositions.find((row) => row.id === link.propositionId);
  const key = `sup-${link.id}`;
  return html`
    <li>
      <strong>${CLAIM_PROPOSITION_RELATION_LABELS[link.relation]}</strong>
      <span>
        ${
          proposition === undefined
            ? `Proposition ${link.propositionId} (no longer a current target)`
            : `P${String(proposition.ordinal)}: ${proposition.text}`
        }
      </span>
      <p class="muted">${link.rationale} — ${link.reviewer}, ${formatDateTime(link.createdAt)}</p>
      ${
        target.writable
          ? html`<form
              method="post"
              action="${claimPath(claim, target)}/propositions/${link.id}/supersede"
            >
              ${csrfField(target.csrf)}
              <input type="hidden" name="propositionId" value="${link.propositionId}" />
              ${selectField({
                name: 'relation',
                label: 'Record a corrected relationship',
                value: valueOf(state.values, `${key}-relation`, link.relation),
                issues: state.issues,
                required: true,
                options: optionsFor(CLAIM_PROPOSITION_RELATIONS, CLAIM_PROPOSITION_RELATION_LABELS),
              })}
              ${textareaField({
                name: 'rationale',
                label: 'Why the correction',
                value: valueOf(state.values, `${key}-rationale`),
                issues: state.issues,
                required: true,
                rows: 2,
                maxLength: 4000,
              })}
              ${textField({
                name: 'reviewer',
                label: 'Reviewer label',
                value: valueOf(state.values, `${key}-reviewer`),
                issues: state.issues,
                required: true,
                maxLength: 80,
              })}
              <p>${submitButton('Supersede this link', 'secondary')}</p>
            </form>`
          : ''
      }
    </li>
  `;
}

function citationRow(
  link: ClaimCitationLinkRecord,
  workspace: AnswerClaimWorkspace,
  claim: AnswerClaimRecord,
  target: Target,
  state: FormState,
): Html {
  const citation = workspace.citations.find((row) => row.id === link.citationId);
  const sharers = workspace.claims.filter((other) =>
    other.citationLinks.some(
      (row) => row.supersededBy === null && row.citationId === link.citationId,
    ),
  ).length;
  const key = `sup-${link.id}`;
  return html`
    <li>
      <strong>${CLAIM_CITATION_SUPPORT_DISPLAY[link.support]}</strong>
      <span
        >${citation === undefined ? `Citation ${link.citationId}` : `#${String(citation.position)} ${citation.url}`}</span
      >
      ${
        sharers > 1
          ? statusBadge(`Also mapped to ${String(sharers - 1)} other statement(s)`, 'neutral')
          : ''
      }
      <p class="muted">${link.rationale} — ${link.reviewer}, ${formatDateTime(link.createdAt)}</p>
      ${
        target.writable
          ? html`<form
              method="post"
              action="${claimPath(claim, target)}/citations/${link.id}/supersede"
            >
              ${csrfField(target.csrf)}
              <input type="hidden" name="citationId" value="${link.citationId}" />
              ${selectField({
                name: 'support',
                label: 'Record a corrected support assessment',
                value: valueOf(state.values, `${key}-support`, link.support),
                issues: state.issues,
                required: true,
                options: optionsFor(CLAIM_CITATION_SUPPORT_LABELS, CLAIM_CITATION_SUPPORT_DISPLAY),
              })}
              ${textareaField({
                name: 'rationale',
                label: 'Why the correction',
                value: valueOf(state.values, `${key}-rationale`),
                issues: state.issues,
                required: true,
                rows: 2,
                maxLength: 4000,
              })}
              ${textField({
                name: 'reviewer',
                label: 'Reviewer label',
                value: valueOf(state.values, `${key}-reviewer`),
                issues: state.issues,
                required: true,
                maxLength: 80,
              })}
              <p>${submitButton('Supersede this mapping', 'secondary')}</p>
            </form>`
          : ''
      }
    </li>
  `;
}

function historyPanel(claim: AnswerClaimRecord): Html {
  const labels = currentClaimLabels(claim);
  return html`
    <details>
      <summary>
        Review history — ${String(claim.assessments.length)} assessment(s),
        ${String(claim.revisions.length)} revision(s)
      </summary>
      <h4>Current conclusions</h4>
      ${definitionRow(
        'Statement fidelity',
        labels.FIDELITY === undefined
          ? html`<span class="muted">Not assessed</span>`
          : statusBadge(CLAIM_FIDELITY_DISPLAY[labels.FIDELITY], 'neutral'),
      )}
      ${definitionRow(
        'Attribution',
        labels.ATTRIBUTION === undefined
          ? html`<span class="muted">Not assessed</span>`
          : statusBadge(CLAIM_ATTRIBUTION_DISPLAY[labels.ATTRIBUTION], 'neutral'),
      )}
      <h4>Assessments</h4>
      ${
        claim.assessments.length === 0
          ? html`<p class="muted">Nothing recorded yet.</p>`
          : html`<ol class="history">
              ${claim.assessments.map(
                (assessment) =>
                  html`<li>
                    <span>
                      ${humanize(assessment.dimension)} v${String(assessment.version)}
                      ${statusBadge(assessment.label, 'neutral')}
                    </span>
                    <p>${assessment.rationale}</p>
                    <p class="muted">
                      ${assessment.reviewer}, ${formatDateTime(assessment.createdAt)} ·
                      ${
                        assessment.claimRevisionId === claim.currentRevisionId
                          ? 'current revision'
                          : 'superseded revision'
                      }
                      ${
                        assessment.attributionSubject !== null
                          ? ` · subject: ${assessment.attributionSubject}`
                          : ''
                      }
                      ${
                        assessment.attributionRole !== null
                          ? ` · role: ${humanize(assessment.attributionRole)}`
                          : ''
                      }
                    </p>
                  </li>`,
              )}
            </ol>`
      }
      <h4>Statement revisions</h4>
      <ol class="history">
        ${claim.revisions.map(
          (row) =>
            html`<li>
              <span>Revision ${String(row.revision)}</span>
              <blockquote class="quote-text">${row.quoteText}</blockquote>
              <p class="muted">
                ${ANSWER_STATEMENT_KIND_LABELS[row.statementKind]} ·
                ${ANSWER_OFFSET_BASIS_LABELS[row.offsetBasis]} ·
                ${CLAIM_RELEVANCE_LABELS[row.relevance]} · ${row.createdBy},
                ${formatDateTime(row.createdAt)}
              </p>
            </li>`,
        )}
      </ol>
    </details>
  `;
}

function claimPanel(
  claim: AnswerClaimRecord,
  workspace: AnswerClaimWorkspace,
  target: Target,
  state: FormState,
): Html {
  const revision = claim.currentRevision;
  const activePropositions = claim.propositionLinks.filter((row) => row.supersededBy === null);
  const activeCitations = claim.citationLinks.filter((row) => row.supersededBy === null);
  const supersededPropositions = claim.propositionLinks.length - activePropositions.length;
  const supersededCitations = claim.citationLinks.length - activeCitations.length;
  return html`
    <section class="panel panel-nested" id="claim-${claim.id}">
      <h3>
        Statement ${String(claim.ordinal)}
        ${statusBadge(labelFor(CLAIM_RELEVANCE_LABELS, revision?.relevance ?? ''), 'neutral')}
        ${claim.voidedAt !== null ? statusBadge('Voided', 'bad') : ''}
        ${
          revision?.statementKind === 'REVIEWER_DESCRIPTION'
            ? statusBadge(ANSWER_STATEMENT_KIND_LABELS.REVIEWER_DESCRIPTION, 'warn')
            : ''
        }
      </h3>
      <blockquote class="quote-text">${revision?.quoteText ?? 'No text recorded.'}</blockquote>
      <p class="muted">
        Revision ${String(revision?.revision ?? '?')} ·
        ${revision === null ? 'no basis' : ANSWER_OFFSET_BASIS_LABELS[revision.offsetBasis]}
        ${
          revision !== null && revision.startOffset !== null
            ? ` · characters ${String(revision.startOffset)}–${String(revision.endOffset)}`
            : ''
        }
        · recorded ${formatDateTime(revision?.createdAt ?? '')}
      </p>
      ${
        revision?.paraphrase !== null && revision?.paraphrase !== undefined
          ? definitionRow('Reviewer reading', html`<span>${revision?.paraphrase}</span>`)
          : ''
      }
      ${
        revision?.note !== null && revision?.note !== undefined
          ? definitionRow('Note', html`<span>${revision?.note}</span>`)
          : ''
      }
      ${
        claim.voidedAt !== null
          ? definitionRow('Void reason', html`<span>${claim.voidReason}</span>`)
          : ''
      }

      <h4>Target propositions</h4>
      ${
        activePropositions.length === 0
          ? html`<p class="muted">
              None linked yet. Link one to record that this statement addresses, contradicts,
              qualifies, or omits a specific target.
            </p>`
          : html`<ul class="claim-links">
              ${activePropositions.map((link) => linkRow(link, workspace, claim, target, state))}
            </ul>`
      }
      ${
        supersededPropositions > 0
          ? html`<p class="muted">
              ${String(supersededPropositions)} superseded link(s) retained.
            </p>`
          : ''
      }
      ${target.writable ? propositionLinkForm(claim, workspace, target, state) : ''}

      <h4>Citations mapped to this statement</h4>
      ${
        activeCitations.length === 0
          ? html`<p class="muted">
              None mapped. A statement without a citation is an absence, not a citation failure.
            </p>`
          : html`<ul class="claim-links">
              ${activeCitations.map((link) => citationRow(link, workspace, claim, target, state))}
            </ul>`
      }
      ${
        supersededCitations > 0
          ? html`<p class="muted">
              ${String(supersededCitations)} superseded mapping(s) retained.
            </p>`
          : ''
      }
      ${target.writable ? citationLinkForm(claim, workspace, target, state) : ''}
      ${target.writable ? assessmentForm(claim, target, state) : ''}
      ${
        target.writable
          ? html`<details>
              <summary>Correct this statement</summary>
              <p class="field-help">
                Saving creates a new revision. The earlier wording and everything assessed against
                it stay readable, and links recorded against the old revision are not carried over.
              </p>
              ${reviseStatementForm(claim, target, state)}
            </details>`
          : ''
      }
      ${historyPanel(claim)}
      ${
        target.writable && claim.voidedAt === null
          ? html`<details>
              <summary>Void this statement</summary>
              ${voidStatementForm(claim, target, state)}
            </details>`
          : ''
      }
    </section>
  `;
}

function reportContributionPanel(workspace: AnswerClaimWorkspace): Html {
  const scored = workspace.claims.filter((claim) => {
    const labels = currentClaimLabels(claim);
    return labels.FIDELITY !== undefined || labels.ATTRIBUTION !== undefined;
  });
  const mapped = workspace.claims.reduce(
    (total, claim) => total + claim.citationLinks.filter((row) => row.supersededBy === null).length,
    0,
  );
  return html`
    <section class="panel" id="how-this-reports">
      <h2>How this contributes to a report</h2>
      <p>
        A report computes statement-level figures only for answers that are eligible: not voided,
        and captured as a completed answer. ${String(workspace.claims.length)} statement(s) are
        recorded for this observation and ${String(scored.length)} carry at least one assessment.
        ${String(mapped)} citation mapping(s) exist.
      </p>
      <ul>
        <li>
          Fidelity and attribution are assessed per statement. Citation support is assessed per
          statement-and-citation pair, never once for the whole answer.
        </li>
        <li>
          A refusal, abstention, omission, or unavailable check is excluded from the accuracy
          figures and reported with its reason. It is never counted as a wrong statement.
        </li>
        <li>
          These figures sit beside the whole-answer figures and do not replace them. The two can
          disagree, and that difference is real information.
        </li>
        <li>
          Statement figures only appear in a report generated as
          <code>metrics-v4</code>. An older report keeps the numbers it was generated with.
        </li>
        <li>
          Decomposition coverage is published next to every statement-level rate, because those
          denominators describe only the answers someone took the trouble to break down.
        </li>
      </ul>
    </section>
  `;
}

function explanationPanel(): Html {
  return html`
    <section class="panel" id="vocabulary">
      <h2>Label meanings</h2>
      <details>
        <summary>Statement relevance</summary>
        ${relevanceHelp()}
      </details>
      <details>
        <summary>Quote kinds and position basis</summary>
        ${statementKindHelp()}
        <dl class="vocabulary">
          ${ANSWER_OFFSET_BASES.map(
            (value) =>
              html`<dt>${ANSWER_OFFSET_BASIS_LABELS[value]}</dt>
                <dd>${ANSWER_OFFSET_BASIS_DESCRIPTIONS[value]}</dd>`,
          )}
        </dl>
      </details>
      <details>
        <summary>Proposition relationships</summary>
        <dl class="vocabulary">
          ${CLAIM_PROPOSITION_RELATIONS.map(
            (value) =>
              html`<dt>${CLAIM_PROPOSITION_RELATION_LABELS[value]}</dt>
                <dd>${CLAIM_PROPOSITION_RELATION_DESCRIPTIONS[value]}</dd>`,
          )}
        </dl>
      </details>
      <details>
        <summary>Citation support</summary>
        <dl class="vocabulary">
          ${CLAIM_CITATION_SUPPORT_LABELS.map(
            (value) =>
              html`<dt>${CLAIM_CITATION_SUPPORT_DISPLAY[value]}</dt>
                <dd>${CLAIM_CITATION_SUPPORT_DESCRIPTIONS[value]}</dd>`,
          )}
        </dl>
      </details>
      <details>
        <summary>Statement fidelity</summary>
        <dl class="vocabulary">
          ${CLAIM_FIDELITY_LABELS.map(
            (value) =>
              html`<dt>${CLAIM_FIDELITY_DISPLAY[value]}</dt>
                <dd>${CLAIM_FIDELITY_DESCRIPTIONS[value]}</dd>`,
          )}
        </dl>
      </details>
      <details>
        <summary>Attribution</summary>
        <dl class="vocabulary">
          ${CLAIM_ATTRIBUTION_LABELS.map(
            (value) =>
              html`<dt>${CLAIM_ATTRIBUTION_DISPLAY[value]}</dt>
                <dd>${CLAIM_ATTRIBUTION_DESCRIPTIONS[value]}</dd>`,
          )}
        </dl>
      </details>
    </section>
  `;
}

function workspacePage(
  context: RequestContext,
  projectId: string,
  runId: string,
  observationId: string,
  state: FormState,
): Html {
  const workspace = getAnswerClaimWorkspace(context.deps.db, projectId, observationId);
  const target: Target = {
    projectId,
    runId,
    observationId,
    csrf: context.csrfToken,
    writable: workspace.runStatus === 'OPEN' && workspace.voidedAt === null,
  };
  return layout({
    title: 'Answer statements',
    notice: context.url.searchParams.get('notice'),
    navigation: projectNav({ projectId, current: 'runs' }),
    body: html`
      ${pageHeader(
        'Answer statements',
        'Record the individual factual statements inside this captured answer, link each one to the propositions it concerns, and map the citations that appear to support them.',
      )}
      ${errorSummary(state.issues)} ${answerPanel(workspace, target)}
      ${target.writable ? addStatementForm(target, state) : ''}
      ${
        workspace.claims.length === 0
          ? emptyState(
              'No statements recorded yet',
              'Read the answer above and record each factual statement separately. Opinion or filler can be recorded as unrelated, and something the answer failed to say can be recorded as an omission. Neither is scored as a wrong statement.',
            )
          : workspace.claims.map((claim) => claimPanel(claim, workspace, target, state))
      }
      ${reportContributionPanel(workspace)} ${explanationPanel()}
      <p>
        <a href="/projects/${projectId}/runs/${runId}">Back to the evaluation run</a>
      </p>
    `,
  });
}

function fail(
  context: RequestContext,
  projectId: string,
  runId: string,
  observationId: string,
  state: FormState,
): AppResponse {
  return htmlResponse(workspacePage(context, projectId, runId, observationId, state), 422);
}

export const answerClaimRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/projects/:projectId/runs/:runId/observations/:observationId/claims',
    handler: (context) =>
      htmlResponse(
        workspacePage(
          context,
          context.params['projectId'] ?? '',
          context.params['runId'] ?? '',
          context.params['observationId'] ?? '',
          EMPTY_FORM,
        ),
      ),
  },
  {
    method: 'POST',
    path: '/projects/:projectId/runs/:runId/observations/:observationId/claims',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const runId = context.params['runId'] ?? '';
      const observationId = context.params['observationId'] ?? '';
      const workspace = getAnswerClaimWorkspace(context.deps.db, projectId, observationId);
      const result = validateAnswerClaimDraftInput(rawFields(context), workspace.answerText ?? '');
      if (!result.ok) {
        return fail(context, projectId, runId, observationId, formState(context, result.issues));
      }
      createAnswerClaim(
        context.deps.db,
        projectId,
        observationId,
        result.value,
        writeContext(context),
      );
      return redirectWithNotice(
        `/projects/${projectId}/runs/${runId}/observations/${observationId}/claims`,
        'answer-claim-created',
      );
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/runs/:runId/observations/:observationId/claims/:claimId/revise',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const runId = context.params['runId'] ?? '';
      const observationId = context.params['observationId'] ?? '';
      const claimId = context.params['claimId'] ?? '';
      const workspace = getAnswerClaimWorkspace(context.deps.db, projectId, observationId);
      const result = validateAnswerClaimDraftInput(rawFields(context), workspace.answerText ?? '');
      if (!result.ok) {
        return fail(context, projectId, runId, observationId, formState(context, result.issues));
      }
      reviseAnswerClaim(context.deps.db, projectId, claimId, result.value, writeContext(context));
      return redirectWithNotice(
        claimsPath({ projectId, runId, observationId, csrf: '', writable: true }),
        'answer-claim-revised',
      );
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/runs/:runId/observations/:observationId/claims/:claimId/void',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const runId = context.params['runId'] ?? '';
      const observationId = context.params['observationId'] ?? '';
      const claimId = context.params['claimId'] ?? '';
      const result = requiredText(context.fields.get('reason'), 'reason', {
        max: 2000,
        min: 3,
        multiline: true,
      });
      if (!result.ok) {
        return fail(context, projectId, runId, observationId, formState(context, result.issues));
      }
      voidAnswerClaim(context.deps.db, projectId, claimId, result.value, writeContext(context));
      return redirectWithNotice(
        claimsPath({ projectId, runId, observationId, csrf: '', writable: true }),
        'answer-claim-voided',
      );
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/runs/:runId/observations/:observationId/claims/:claimId/propositions',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const runId = context.params['runId'] ?? '';
      const observationId = context.params['observationId'] ?? '';
      const claimId = context.params['claimId'] ?? '';
      // The relevance is read from the stored statement rather than the form, so a tampered or stale
      // field cannot present a pairing the record does not support.
      const relevance = currentClaimRelevance(context.deps.db, projectId, claimId);
      const result = validateClaimPropositionLinkInput(rawFields(context), relevance);
      if (!result.ok) {
        return fail(context, projectId, runId, observationId, formState(context, result.issues));
      }
      linkAnswerClaimProposition(
        context.deps.db,
        projectId,
        claimId,
        result.value,
        writeContext(context),
      );
      return redirectWithNotice(
        claimsPath({ projectId, runId, observationId, csrf: '', writable: true }),
        'answer-claim-linked',
      );
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/runs/:runId/observations/:observationId/claims/propositions/:linkId/supersede',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const runId = context.params['runId'] ?? '';
      const observationId = context.params['observationId'] ?? '';
      const linkId = context.params['linkId'] ?? '';
      const relevance = propositionLinkRelevance(context.deps.db, projectId, linkId);
      const result = validateClaimPropositionLinkInput(rawFields(context), relevance);
      if (!result.ok) {
        return fail(context, projectId, runId, observationId, formState(context, result.issues));
      }
      // The proposition comes from the stored link, and the database refuses a replacement whose
      // pair does not match, so a tampered hidden field cannot move a link to another target.
      supersedeAnswerClaimProposition(
        context.deps.db,
        projectId,
        linkId,
        result.value,
        writeContext(context),
      );
      return redirectWithNotice(
        claimsPath({ projectId, runId, observationId, csrf: '', writable: true }),
        'answer-claim-link-superseded',
      );
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/runs/:runId/observations/:observationId/claims/citations/:linkId/supersede',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const runId = context.params['runId'] ?? '';
      const observationId = context.params['observationId'] ?? '';
      const linkId = context.params['linkId'] ?? '';
      const relevance = citationMappingRelevance(context.deps.db, projectId, linkId);
      const result = validateClaimCitationLinkInput(rawFields(context), relevance);
      if (!result.ok) {
        return fail(context, projectId, runId, observationId, formState(context, result.issues));
      }
      supersedeAnswerClaimCitation(
        context.deps.db,
        projectId,
        linkId,
        result.value,
        writeContext(context),
      );
      return redirectWithNotice(
        claimsPath({ projectId, runId, observationId, csrf: '', writable: true }),
        'answer-claim-mapping-superseded',
      );
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/runs/:runId/observations/:observationId/claims/:claimId/citations',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const runId = context.params['runId'] ?? '';
      const observationId = context.params['observationId'] ?? '';
      const claimId = context.params['claimId'] ?? '';
      const relevance = currentClaimRelevance(context.deps.db, projectId, claimId);
      const result = validateClaimCitationLinkInput(rawFields(context), relevance);
      if (!result.ok) {
        return fail(context, projectId, runId, observationId, formState(context, result.issues));
      }
      linkAnswerClaimCitation(
        context.deps.db,
        projectId,
        claimId,
        result.value,
        writeContext(context),
      );
      return redirectWithNotice(
        claimsPath({ projectId, runId, observationId, csrf: '', writable: true }),
        'answer-claim-citation-mapped',
      );
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/runs/:runId/observations/:observationId/claims/:claimId/assessments',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const runId = context.params['runId'] ?? '';
      const observationId = context.params['observationId'] ?? '';
      const claimId = context.params['claimId'] ?? '';
      const dimension = context.fields.get('dimension') ?? 'FIDELITY';
      const relevance = currentClaimRelevance(context.deps.db, projectId, claimId);
      const result = validateAnswerClaimAssessmentInput(
        {
          ...rawFields(context),
          label:
            dimension === 'FIDELITY'
              ? context.fields.get('fidelityLabel')
              : context.fields.get('attributionLabel'),
        },
        relevance,
      );
      if (!result.ok) {
        return fail(context, projectId, runId, observationId, formState(context, result.issues));
      }
      recordAnswerClaimAssessment(
        context.deps.db,
        projectId,
        claimId,
        result.value,
        writeContext(context),
      );
      return redirectWithNotice(
        claimsPath({ projectId, runId, observationId, csrf: '', writable: true }),
        'answer-claim-assessed',
      );
    },
  },
];
