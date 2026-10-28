import {
  validateCitationDraftInput,
  validateObservationAssessmentDraftInput,
  validateObservationDraftInput,
  validateReasonInput,
  validateRunInput,
} from '../../core/inputs.ts';
import {
  ASSESSMENT_DIMENSION_LABELS,
  ASSESSMENT_LABELS_BY_DIMENSION,
  ASSESSMENT_LABEL_DISPLAY,
  ATTRIBUTION_ROLES,
  ATTRIBUTION_ROLE_LABELS,
  CITATION_CAPTURE_STATES,
  CITATION_CAPTURE_LABELS,
  GROUNDING_MODES,
  GROUNDING_MODE_LABELS,
  OBSERVATION_STATUSES,
  OBSERVATION_STATUS_LABELS,
  type AssessmentDimension,
} from '../../core/vocabulary.ts';
import type { RunMetrics } from '../../core/metrics.ts';
import type { ValidationIssue } from '../../core/validation.ts';
import { requiredText } from '../../core/validation.ts';
import { AppError } from '../../errors.ts';
import { withTransaction } from '../../persistence/db.ts';
import { getProjectOrThrow } from '../../persistence/repositories/projects.ts';
import { getQuerySetOrThrow, listQuerySets } from '../../persistence/repositories/querySets.ts';
import {
  addCitation,
  addObservation,
  cancelRun,
  createRun,
  finalizeRun,
  getRunOrThrow,
  listRuns,
  recordObservationAssessment,
  voidCitation,
  voidObservation,
  type ObservationAssessmentRecord,
  type ObservationRecord,
  type RunDetail,
} from '../../persistence/repositories/runs.ts';
import { parseObservationImport } from '../importObservations.ts';
import { dateTimeLocalValue, normalizeDateTimeInput } from '../forms.ts';
import { computeMetricsForRun } from '../runMetrics.ts';
import { htmlResponse, redirectWithNotice } from '../http/responses.ts';
import { writeContext, type RequestContext, type RouteDefinition } from '../http/types.ts';
import {
  assessmentBadge,
  checkboxField,
  csrfField,
  dateTimeField,
  definitionRow,
  emptyState,
  errorSummary,
  externalUrl,
  formatDateTime,
  formatPercent,
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

function page(title: string, body: Html, projectId: string, notice: string | null): Html {
  return layout({
    title,
    body,
    notice,
    navigation: projectNav({ projectId, current: 'runs' }),
  });
}

function runFields(
  values: Values,
  issues: readonly ValidationIssue[],
  approvedSets: ReturnType<typeof listQuerySets>,
  context: RequestContext,
): Html {
  return html`
    ${selectField({
      name: 'querySetId',
      label: 'Approved query set',
      value: valueOf(values, 'querySetId'),
      issues,
      required: true,
      includeBlank: 'Choose an approved set',
      options: approvedSets.map((detail) => ({
        value: detail.set.id,
        label: `${detail.set.name} v${detail.set.version} · ${detail.queries.length} queries`,
      })),
    })}
    ${textField({
      name: 'name',
      label: 'Run name',
      value: valueOf(values, 'name'),
      issues,
      required: true,
      maxLength: 200,
    })}
    ${textField({
      name: 'providerLabel',
      label: 'Provider label',
      value: valueOf(values, 'providerLabel'),
      issues,
      required: true,
      maxLength: 200,
      help: 'What system did you actually observe? A free-text label, not a verified integration.',
    })}
    ${textField({
      name: 'modelLabel',
      label: 'Model / version label (optional)',
      value: valueOf(values, 'modelLabel'),
      issues,
      maxLength: 200,
      help: 'Only record what the interface displayed; do not guess.',
    })}
    ${textField({
      name: 'interfaceLabel',
      label: 'Interface label',
      value: valueOf(values, 'interfaceLabel'),
      issues,
      required: true,
      maxLength: 200,
      placeholder: 'Consumer web interface, API console, mobile app…',
    })}
    ${selectField({
      name: 'groundingMode',
      label: 'Search / grounding mode',
      value: valueOf(values, 'groundingMode', 'UNKNOWN'),
      issues,
      required: true,
      options: GROUNDING_MODES.map((mode) => ({ value: mode, label: GROUNDING_MODE_LABELS[mode] })),
      help: 'Record what was actually enabled or displayed. Unknown is a valid answer.',
    })}
    ${textField({
      name: 'locale',
      label: 'Language tag',
      value: valueOf(values, 'locale', 'en'),
      issues,
      required: true,
      maxLength: 35,
    })}
    ${textField({
      name: 'region',
      label: 'Region (optional)',
      value: valueOf(values, 'region'),
      issues,
      maxLength: 100,
    })}
    ${dateTimeField({
      name: 'captureFrom',
      label: 'Capture window start',
      value: valueOf(values, 'captureFrom', dateTimeLocalValue(context.now)),
      issues,
      required: true,
    })}
    ${dateTimeField({
      name: 'captureTo',
      label: 'Capture window end',
      value: valueOf(values, 'captureTo', dateTimeLocalValue(context.now)),
      issues,
      required: true,
    })}
    ${textareaField({
      name: 'conditions',
      label: 'Recorded conditions',
      value: valueOf(values, 'conditions'),
      issues,
      required: true,
      rows: 3,
      maxLength: 2000,
      help: 'Logged-in state, tools, account plan, interface language, and anything else that could affect results.',
    })}
    ${textareaField({
      name: 'notes',
      label: 'Run notes (optional)',
      value: valueOf(values, 'notes'),
      issues,
      rows: 2,
      maxLength: 4000,
    })}
  `;
}

function observationFields(
  values: Values,
  issues: readonly ValidationIssue[],
  detail: RunDetail,
  context: RequestContext,
): Html {
  return html`
    ${selectField({
      name: 'queryId',
      label: 'Query',
      value: valueOf(values, 'queryId'),
      issues,
      required: true,
      includeBlank: 'Choose a query',
      options: detail.querySet.queries.map((query) => ({
        value: query.id,
        label: `${query.ordinal}. ${query.text}`,
      })),
    })}
    ${selectField({
      name: 'status',
      label: 'Observation status',
      value: valueOf(values, 'status', 'COMPLETED'),
      issues,
      required: true,
      options: OBSERVATION_STATUSES.map((status) => ({
        value: status,
        label: OBSERVATION_STATUS_LABELS[status],
      })),
      help: 'Errors, refusals, and abstentions are recorded as coverage states, never as negative mentions.',
    })}
    ${dateTimeField({
      name: 'capturedAt',
      label: 'Captured at',
      value: valueOf(values, 'capturedAt', dateTimeLocalValue(context.now)),
      issues,
      required: true,
    })}
    ${textareaField({
      name: 'answerText',
      label: 'Raw answer',
      value: valueOf(values, 'answerText'),
      issues,
      rows: 6,
      maxLength: 50000,
      help: 'Paste the exact observed answer. Preserve typos and formatting; do not paraphrase. Required for completed, refusal, and no-answer states.',
    })}
    ${textareaField({
      name: 'errorNote',
      label: 'Error / capture note',
      value: valueOf(values, 'errorNote'),
      issues,
      rows: 2,
      maxLength: 2000,
      help: 'Required for error, blocked, timeout, and unavailable states.',
    })}
    ${selectField({
      name: 'citationCapture',
      label: 'Citation metadata',
      value: valueOf(values, 'citationCapture', 'UNKNOWN'),
      issues,
      required: true,
      options: CITATION_CAPTURE_STATES.map((state) => ({
        value: state,
        label: CITATION_CAPTURE_LABELS[state],
      })),
      help: 'Choose NOT_SHOWN if the interface did not expose citations. Do not assume no source was used.',
    })}
    ${textareaField({
      name: 'contextNotes',
      label: 'Context notes (optional)',
      value: valueOf(values, 'contextNotes'),
      issues,
      rows: 2,
      maxLength: 4000,
    })}
  `;
}

function citationFields(
  context: RequestContext,
  runId: string,
  observationId: string,
  values: Values,
  issues: readonly ValidationIssue[],
): Html {
  return html`
    <details>
      <summary>Add a citation shown by the interface</summary>
      <form
        method="post"
        action="/projects/${context.params['projectId'] ?? ''}/runs/${runId}/observations/${observationId}/citations"
        novalidate
      >
        ${csrfField(context.csrfToken)}
        ${textField({
          name: 'url',
          label: 'Citation URL',
          value: valueOf(values, 'url'),
          issues,
          required: true,
          type: 'url',
          maxLength: 2048,
        })}
        ${textField({
          name: 'title',
          label: 'Title (optional)',
          value: valueOf(values, 'title'),
          issues,
          maxLength: 500,
        })}
        ${textareaField({
          name: 'snippet',
          label: 'Snippet (optional)',
          value: valueOf(values, 'snippet'),
          issues,
          rows: 2,
          maxLength: 2000,
        })}
        ${checkboxField({
          name: 'targetOwned',
          label: 'Target-owned canonical source',
          checked: valueOf(values, 'targetOwned') === 'on',
        })}
        <div class="form-actions">${submitButton('Add citation', 'secondary')}</div>
      </form>
    </details>
  `;
}

function assessmentForm(
  context: RequestContext,
  runId: string,
  observationId: string,
  dimension: AssessmentDimension,
  values: Values,
  issues: readonly ValidationIssue[],
): Html {
  const labels = ASSESSMENT_LABELS_BY_DIMENSION[dimension];
  return html`
    <details>
      <summary>${ASSESSMENT_DIMENSION_LABELS[dimension]}</summary>
      <form
        method="post"
        action="/projects/${context.params['projectId'] ?? ''}/runs/${runId}/observations/${observationId}/assessments"
        novalidate
      >
        ${csrfField(context.csrfToken)}
        <input type="hidden" name="dimension" value="${dimension}" />
        ${selectField({
          name: 'label',
          label: 'Assessment label',
          value: valueOf(values, 'label'),
          issues,
          required: true,
          includeBlank: 'Choose a label',
          options: labels.map((label) => ({
            value: label,
            label: ASSESSMENT_LABEL_DISPLAY[label] ?? label,
          })),
        })}
        ${
          dimension === 'ATTRIBUTION'
            ? selectField({
                name: 'attributionRole',
                label: 'Role assessed (optional)',
                value: valueOf(values, 'attributionRole'),
                issues,
                includeBlank: 'Role not specified',
                options: ATTRIBUTION_ROLES.map((role) => ({
                  value: role,
                  label: ATTRIBUTION_ROLE_LABELS[role],
                })),
              })
            : ''
        }
        ${textareaField({
          name: 'rationale',
          label: 'Assessment rationale',
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
        <div class="form-actions">${submitButton('Record assessment', 'secondary')}</div>
      </form>
    </details>
  `;
}

function latestAssessments(
  assessments: readonly ObservationAssessmentRecord[],
): ObservationAssessmentRecord[] {
  const latest = new Map<string, ObservationAssessmentRecord>();
  for (const assessment of assessments) {
    const current = latest.get(assessment.dimension);
    if (current === undefined || assessment.version > current.version) {
      latest.set(assessment.dimension, assessment);
    }
  }
  return [...latest.values()].sort((left, right) => left.dimension.localeCompare(right.dimension));
}

function citationList(
  context: RequestContext,
  projectId: string,
  runId: string,
  observation: ObservationRecord,
  open: boolean,
): Html {
  if (observation.citations.length === 0) {
    return html`<p class="muted">No citations recorded.</p>`;
  }
  return html`
    <ul>
      ${observation.citations.map(
        (citation) => html`
          <li>
            ${externalUrl(citation.url, citation.title ?? citation.url)}
            ${citation.targetOwned ? statusBadge('Target-owned', 'good') : statusBadge('Third-party')}
            ${citation.voidedAt === null ? '' : statusBadge('Voided')}
            ${citation.title === null ? '' : html`<span class="small muted"> · ${citation.title}</span>`}
            ${citation.snippet === null ? '' : html`<div class="small muted">${citation.snippet}</div>`}
            ${
              citation.voidedAt === null && citation.voidReason !== null
                ? html`<div class="small muted">Void reason: ${citation.voidReason}</div>`
                : ''
            }
            ${
              citation.voidedAt !== null || !open
                ? ''
                : html`
                    <details>
                      <summary>Void citation</summary>
                      <form
                        method="post"
                        action="/projects/${projectId}/runs/${runId}/observations/${observation.id}/citations/${citation.id}/void"
                      >
                        ${csrfField(context.csrfToken)}
                        ${textareaField({ name: 'reason', label: 'Void reason', value: '', required: true, rows: 2, maxLength: 1000 })}
                        ${textField({ name: 'reviewer', label: 'Reviewer', value: context.deps.config.operator, required: true, maxLength: 80 })}
                        <div class="form-actions">${submitButton('Void citation', 'danger')}</div>
                      </form>
                    </details>
                  `
            }
          </li>
        `,
      )}
    </ul>
  `;
}

function observationBlock(
  context: RequestContext,
  projectId: string,
  run: RunDetail,
  observation: ObservationRecord,
  values: Values,
  issues: readonly ValidationIssue[],
): Html {
  const open = run.run.status === 'OPEN';
  const active = observation.voidedAt === null && observation.status === 'COMPLETED';
  const latest = latestAssessments(observation.assessments);
  return html`
    <article class="card home-grid">
      <p class="muted small">
        Query ${observation.queryOrdinal} · ${humanize(observation.status)}
        ${observation.voidedAt === null ? '' : statusBadge('Voided')} · captured
        ${formatDateTime(observation.capturedAt)}
      </p>
      <h3>${observation.queryTextSnapshot}</h3>
      ${
        observation.answerText === null
          ? html`<p class="muted">No answer text recorded.</p>`
          : html`<pre class="raw-answer">${observation.answerText}</pre>`
      }
      ${
        observation.errorNote === null
          ? ''
          : html`<p class="field-error">Capture note: ${observation.errorNote}</p>`
      }
      ${
        observation.contextNotes === null
          ? ''
          : html`<p class="small muted">Context: ${observation.contextNotes}</p>`
      }
      <p class="small muted">
        Citation capture: ${CITATION_CAPTURE_LABELS[observation.citationCapture]}
        ${
          observation.voidedAt === null
            ? ''
            : html` · voided ${formatDateTime(observation.voidedAt)}:
              ${observation.voidReason ?? ''}`
        }
      </p>
      <h4>Citations</h4>
      ${citationList(context, projectId, run.run.id, observation, open)}
      ${
        open && observation.voidedAt === null
          ? citationFields(context, run.run.id, observation.id, values, issues)
          : ''
      }
      <h4>Answer assessments</h4>
      ${
        latest.length === 0
          ? html`<p class="muted">No answer-level assessments recorded.</p>`
          : html`
              <ul>
                ${latest.map(
                  (assessment) => html`
                    <li>
                      <strong>${ASSESSMENT_DIMENSION_LABELS[assessment.dimension]}:</strong>
                      ${assessmentBadge(assessment.label)}
                      <span class="small muted">
                        v${assessment.version} · ${assessment.reviewer}
                        ${assessment.attributionRole === null ? '' : ` · ${ATTRIBUTION_ROLE_LABELS[assessment.attributionRole]}`}
                      </span>
                      <div class="small">${assessment.rationale}</div>
                    </li>
                  `,
                )}
              </ul>
            `
      }
      ${
        open && active
          ? html`
              <p class="small muted">
                Assessments are append-only. A later version supersedes the previous conclusion in
                metrics and reports while history remains below.
              </p>
              ${(['PRESENCE', 'FIDELITY', 'CITATION_SUPPORT', 'ATTRIBUTION'] as const).map(
                (dimension) =>
                  assessmentForm(context, run.run.id, observation.id, dimension, values, issues),
              )}
            `
          : open
            ? html`<p class="small muted">
                This status is excluded from answer-level denominators. Refusals and errors are not
                factual negatives.
              </p>`
            : html`<p class="small muted">
                This run is ${run.run.status.toLowerCase()}; assessments and citations are frozen.
              </p>`
      }
      ${
        observation.assessments.length > 0
          ? html`
              <details>
                <summary>Assessment history (${observation.assessments.length})</summary>
                <ol class="small">
                  ${observation.assessments.map(
                    (assessment) => html`
                      <li>
                        ${ASSESSMENT_DIMENSION_LABELS[assessment.dimension]} v${assessment.version}
                        · ${assessmentBadge(assessment.label)} · ${assessment.reviewer}
                        <div>${assessment.rationale}</div>
                      </li>
                    `,
                  )}
                </ol>
              </details>
            `
          : ''
      }
      ${
        open && observation.voidedAt === null
          ? html`
              <details>
                <summary>Void this observation</summary>
                <form
                  method="post"
                  action="/projects/${projectId}/runs/${run.run.id}/observations/${observation.id}/void"
                >
                  ${csrfField(context.csrfToken)}
                  ${textareaField({
                    name: 'reason',
                    label: 'Void reason',
                    value: '',
                    required: true,
                    rows: 2,
                    maxLength: 1000,
                  })}
                  ${textField({
                    name: 'reviewer',
                    label: 'Reviewer',
                    value: context.deps.config.operator,
                    required: true,
                    maxLength: 80,
                  })}
                  <div class="form-actions">${submitButton('Void observation', 'danger')}</div>
                </form>
              </details>
            `
          : ''
      }
    </article>
  `;
}

function metricCard(metric: RunMetrics['mentionRate']): Html {
  const exclusionCount = metric.exclusions.reduce((sum, exclusion) => sum + exclusion.count, 0);
  return html`
    <article class="metric">
      <h3>${metric.label}</h3>
      <p class="metric-value">${formatPercent(metric.value)}</p>
      <p class="metric-detail">
        ${metric.numerator === null ? 'No numerator' : `${metric.numerator} / ${metric.denominator}`}
        · ${plural(exclusionCount, 'excluded unit')}
      </p>
      <details>
        <summary>Definition and exclusions</summary>
        <p class="small">${metric.definition}</p>
        ${
          metric.exclusions.length === 0
            ? html`<p class="small muted">No excluded units.</p>`
            : html`<ul class="small">
                ${metric.exclusions.map((exclusion) => html`<li>${exclusion.reason}: ${exclusion.count} — ${exclusion.description}</li>`)}
              </ul>`
        }
        ${
          metric.notes.length === 0
            ? ''
            : html`<ul class="small muted">
                ${metric.notes.map((note) => html`<li>${note}</li>`)}
              </ul>`
        }
      </details>
    </article>
  `;
}

function metricsSection(metrics: RunMetrics): Html {
  return html`
    ${
      metrics.runStatus !== 'FINALIZED'
        ? html`<div class="notice" role="status">
            Preview only: this run is ${metrics.runStatus}, not finalized. Finalize it before citing
            its results in a report.
          </div>`
        : ''
    }
    <div class="metric-grid">
      ${metricCard(metrics.mentionRate)} ${metricCard(metrics.targetSourceCitationRate)}
      ${metricCard(metrics.anySourceCitationRate)} ${metricCard(metrics.citationSupportRate)}
      ${metricCard(metrics.claimFidelityRate)} ${metricCard(metrics.attributionCorrectnessRate)}
      ${metricCard(metrics.observedAnswerCoverage)}
    </div>
    <div class="grid home-grid">
      <section class="card">
        <h2>Coverage</h2>
        <dl class="definition-list">
          ${definitionRow('Queries planned', html`${metrics.coverage.plannedQueries}`)}
          ${definitionRow('Queries tested', html`${metrics.coverage.testedQueries}`)}
          ${definitionRow('Queries untested', html`${metrics.coverage.untestedQueries}`)}
          ${definitionRow('Observations recorded', html`${metrics.coverage.observationsRecorded}`)}
          ${definitionRow('Eligible completed observations', html`${metrics.coverage.eligibleObservations}`)}
        </dl>
        <p class="small muted">
          Excluded observations are reported with reasons; provider errors are not negative answers.
        </p>
      </section>
      <section class="card">
        <h2>Interpretation limits</h2>
        <ul class="small">
          ${metrics.notes.map((note) => html`<li>${note}</li>`)}
          ${metrics.coverage.exclusions.map((exclusion) => html`<li>${exclusion.reason}: ${exclusion.count} — ${exclusion.description}</li>`)}
        </ul>
      </section>
    </div>
  `;
}

function runDetailPage(
  context: RequestContext,
  projectId: string,
  runId: string,
  options: { issues?: readonly ValidationIssue[]; values?: Values; notice?: string | null } = {},
): Html {
  const run = getRunOrThrow(context.deps.db, projectId, runId);
  const project = getProjectOrThrow(context.deps.db, projectId);
  const values = options.values ?? new Map<string, string>();
  const issues = options.issues ?? [];
  const metrics = computeMetricsForRun(run);
  const open = run.run.status === 'OPEN';
  const nonVoided = run.observations.filter((observation) => observation.voidedAt === null).length;
  const body = html`
    ${pageHeader(
      run.run.name,
      `${humanize(run.run.status)} · ${plural(run.observations.length, 'observation')} · ${plural(run.querySet.queries.length, 'query', 'queries')}`,
      html`
        <a class="button" href="/projects/${projectId}/runs">All runs</a>
        <a class="button" href="/projects/${projectId}/query-sets/${run.querySet.set.id}"
          >Query set v${run.querySet.set.version}</a
        >
        ${run.run.status === 'FINALIZED' ? html`<a class="button button-primary" href="/projects/${projectId}/reports">Generate report</a>` : ''}
      `,
    )}
    ${errorSummary(issues)}
    <div class="notice" role="status">
      <strong>Manual capture only.</strong> Aporia did not call this provider. Every answer was
      entered or imported by the operator; provider and model labels are unverified.
    </div>
    <div class="grid">
      <section class="card">
        <h2>Run conditions</h2>
        <dl class="definition-list">
          ${definitionRow('Provider label', html`${run.run.providerLabel}`)}
          ${definitionRow('Model label', html`${run.run.modelLabel ?? 'Not recorded'}`)}
          ${definitionRow('Interface', html`${run.run.interfaceLabel}`)}
          ${definitionRow('Grounding', html`${GROUNDING_MODE_LABELS[run.run.groundingMode]}`)}
          ${definitionRow('Locale / region', html`${run.run.locale}${run.run.region === null ? '' : ` / ${run.run.region}`}`)}
          ${definitionRow('Capture window', html`${formatDateTime(run.run.captureFrom)} → ${formatDateTime(run.run.captureTo)}`)}
          ${definitionRow('Created', html`${formatDateTime(run.run.createdAt)} · ${run.run.createdBy}`)}
          ${run.run.finalizedAt === null ? '' : definitionRow('Finalized', html`${formatDateTime(run.run.finalizedAt)}`)}
          ${run.run.cancelledAt === null ? '' : definitionRow('Cancelled', html`${formatDateTime(run.run.cancelledAt)} · ${run.run.cancelReason ?? ''}`)}
          ${definitionRow('Query set', html`${run.querySet.set.name} v${run.querySet.set.version} · ${run.querySet.set.status}`)}
        </dl>
        <p>${run.run.conditions}</p>
        ${run.run.notes === null ? '' : html`<p class="small muted">${run.run.notes}</p>`}
        <p class="small muted">
          Project: <a href="/projects/${projectId}">${project.project.name}</a>
        </p>
      </section>
      <section class="card">
        <h2>Run controls</h2>
        ${
          open
            ? html`
                <p class="small">
                  This run is open. Add observations and assessments, then finalize to freeze a
                  reportable record.
                </p>
                ${
                  nonVoided === 0
                    ? html`<p class="small muted">
                        At least one non-voided observation is required before finalizing.
                      </p>`
                    : html`<form
                        method="post"
                        action="/projects/${projectId}/runs/${run.run.id}/finalize"
                      >
                        ${csrfField(context.csrfToken)}
                        <div class="form-actions">${submitButton('Finalize run')}</div>
                      </form>`
                }
                <details>
                  <summary>Cancel run</summary>
                  <form method="post" action="/projects/${projectId}/runs/${run.run.id}/cancel">
                    ${csrfField(context.csrfToken)}
                    ${textareaField({ name: 'reason', label: 'Cancellation reason', value: '', required: true, rows: 2, maxLength: 1000 })}
                    ${textField({ name: 'reviewer', label: 'Reviewer', value: context.deps.config.operator, required: true, maxLength: 80 })}
                    <div class="form-actions">${submitButton('Cancel run', 'danger')}</div>
                  </form>
                </details>
              `
            : html`
                <p class="small">
                  This run is ${humanize(run.run.status).toLowerCase()} and immutable. Create a new
                  run with the same query-set version to retest.
                </p>
                ${
                  run.run.status === 'FINALIZED'
                    ? html`<form method="post" action="/projects/${projectId}/reports">
                        ${csrfField(context.csrfToken)}
                        <div class="form-actions">
                          ${submitButton('Generate report from all finalized runs')}
                        </div>
                      </form>`
                    : ''
                }
              `
        }
      </section>
    </div>
    <h2>Metrics</h2>
    ${metricsSection(metrics)}
    <h2>Observations</h2>
    ${
      run.observations.length === 0
        ? emptyState(
            'No observations yet',
            'Enter an answer you actually observed, or import a JSON array of genuine captures.',
          )
        : html`<div class="stack">
            ${run.observations.map((observation) => observationBlock(context, projectId, run, observation, values, issues))}
          </div>`
    }
    ${
      open
        ? html`
            <section class="card home-grid">
              <h2>Add observation</h2>
              <form
                method="post"
                action="/projects/${projectId}/runs/${run.run.id}/observations"
                novalidate
              >
                ${csrfField(context.csrfToken)} ${observationFields(values, issues, run, context)}
                <div class="form-actions">${submitButton('Record observation')}</div>
              </form>
            </section>
            <section class="card home-grid">
              <h2>Import manual captures</h2>
              <p class="small muted">
                JSON array; one object per observation. Use the exact answers you observed.
                Validation is all-or-nothing, so a bad row imports nothing.
              </p>
              <details>
                <summary>JSON field reference</summary>
                <pre>
[
  {
    "query_ordinal": 1,
    "status": "COMPLETED",
    "captured_at": "2026-10-28T12:00:00Z",
    "answer_text": "Exact observed answer",
    "error_note": null,
    "citation_capture": "CAPTURED",
    "context_notes": "Optional context",
    "citations": [
      { "url": "https://example.com/source", "title": "Source", "snippet": "Optional", "target_owned": true }
    ],
    "assessments": [
      { "dimension": "PRESENCE", "label": "MENTIONED", "rationale": "Why", "reviewer": "Ram", "attribution_role": null }
    ]
  }
]</pre>
              </details>
              <form
                method="post"
                action="/projects/${projectId}/runs/${run.run.id}/import"
                novalidate
              >
                ${csrfField(context.csrfToken)}
                ${textareaField({
                  name: 'json',
                  label: 'Observations JSON',
                  value: valueOf(values, 'json'),
                  issues,
                  rows: 10,
                  maxLength: 200000,
                })}
                <div class="form-actions">${submitButton('Import observations')}</div>
              </form>
            </section>
          `
        : ''
    }
  `;
  return page('Run', body, projectId, options.notice ?? context.url.searchParams.get('notice'));
}

function approvedSetOptions(
  context: RequestContext,
  projectId: string,
): ReturnType<typeof listQuerySets> {
  return listQuerySets(context.deps.db, projectId).filter(
    (detail) => detail.set.status === 'APPROVED',
  );
}

function newRunPage(
  context: RequestContext,
  projectId: string,
  options: { issues?: readonly ValidationIssue[]; values?: Values } = {},
): Html {
  const project = getProjectOrThrow(context.deps.db, projectId);
  const sets = approvedSetOptions(context, projectId);
  const body = html`
    ${pageHeader(
      'Create manual run',
      'Choose a frozen query set and declare the conditions under which you actually observed answers.',
      html`<a class="button" href="/projects/${projectId}/runs">Back to runs</a>`,
    )}
    ${
      sets.length === 0
        ? emptyState(
            'No approved query set',
            'A run requires an approved, versioned query set. Create and approve one first.',
            html`<a class="button button-primary" href="/projects/${projectId}/query-sets"
              >Manage query sets</a
            >`,
          )
        : html`
            <div class="form-narrow">
              <form method="post" action="/projects/${projectId}/runs" novalidate>
                ${csrfField(context.csrfToken)} ${errorSummary(options.issues ?? [])}
                ${runFields(options.values ?? new Map(), options.issues ?? [], sets, context)}
                <div class="form-actions">
                  ${submitButton('Create run')}
                  <a class="button button-secondary" href="/projects/${projectId}/runs">Cancel</a>
                </div>
              </form>
            </div>
          `
    }
    <p class="small muted">Project: ${project.project.name}</p>
  `;
  return page('Create run', body, projectId, null);
}

export const runRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/projects/:projectId/runs',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const project = getProjectOrThrow(context.deps.db, projectId);
      const runs = listRuns(context.deps.db, projectId);
      const body = html`
        ${pageHeader(
          'Manual runs',
          'Capture what a named system actually answered under recorded conditions. No provider is called by Aporia.',
          html`<a class="button button-primary" href="/projects/${projectId}/runs/new"
            >Create run</a
          >`,
        )}
        ${
          runs.length === 0
            ? emptyState(
                'No manual runs yet',
                'Approve a query set, then record real answers you observed. There are no seeded runs or fabricated provider results.',
                html`<a class="button button-primary" href="/projects/${projectId}/runs/new"
                  >Create a run</a
                >`,
              )
            : html`
                <div class="table-wrap">
                  <table>
                    <caption>
                      Manual capture runs in ${project.project.name}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Name</th>
                        <th scope="col">State</th>
                        <th scope="col">Provider / model</th>
                        <th scope="col">Query set</th>
                        <th scope="col">Observations</th>
                        <th scope="col">Created</th>
                        <th scope="col">Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${runs.map(
                        (run) => html`
                          <tr>
                            <td>${run.name}</td>
                            <td>
                              ${statusBadge(humanize(run.status), run.status === 'FINALIZED' ? 'good' : run.status === 'CANCELLED' ? 'neutral' : 'warn')}
                            </td>
                            <td>
                              ${run.providerLabel}${run.modelLabel === null ? '' : ` / ${run.modelLabel}`}
                            </td>
                            <td>${run.querySetName} v${run.querySetVersion}</td>
                            <td>${run.observationCount}</td>
                            <td>${formatDateTime(run.createdAt)}</td>
                            <td><a href="/projects/${projectId}/runs/${run.id}">Open run</a></td>
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
        page('Manual runs', body, projectId, context.url.searchParams.get('notice')),
      );
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/runs/new',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      return htmlResponse(newRunPage(context, projectId));
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/runs',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const raw = Object.fromEntries(context.fields.entries()) as Record<string, unknown>;
      raw['captureFrom'] = normalizeDateTimeInput(context.fields.get('captureFrom'));
      raw['captureTo'] = normalizeDateTimeInput(context.fields.get('captureTo'));
      const result = validateRunInput(raw);
      const selectResult = requiredText(context.fields.get('querySetId'), 'querySetId', {
        max: 100,
      });
      const issues = [
        ...(result.ok ? [] : result.issues),
        ...(selectResult.ok ? [] : selectResult.issues),
      ];
      if (selectResult.ok) {
        const set = getQuerySetOrThrow(context.deps.db, projectId, selectResult.value);
        if (set.set.status !== 'APPROVED') {
          issues.push({ field: 'querySetId', message: 'Choose an approved query set.' });
        }
      }
      if (issues.length > 0 || !result.ok || !selectResult.ok) {
        return htmlResponse(
          newRunPage(context, projectId, { issues, values: context.fields }),
          422,
        );
      }
      const run = createRun(
        context.deps.db,
        projectId,
        selectResult.value,
        result.value,
        writeContext(context),
      );
      return redirectWithNotice(`/projects/${projectId}/runs/${run.run.id}`, 'run-created');
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/runs/:runId',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const runId = context.params['runId'] ?? '';
      return htmlResponse(runDetailPage(context, projectId, runId));
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/runs/:runId/observations',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const runId = context.params['runId'] ?? '';
      const raw = Object.fromEntries(context.fields.entries()) as Record<string, unknown>;
      raw['capturedAt'] = normalizeDateTimeInput(context.fields.get('capturedAt'));
      const result = validateObservationDraftInput(raw);
      if (!result.ok) {
        return htmlResponse(
          runDetailPage(context, projectId, runId, {
            issues: result.issues,
            values: context.fields,
          }),
          422,
        );
      }
      addObservation(context.deps.db, projectId, runId, result.value, writeContext(context));
      return redirectWithNotice(`/projects/${projectId}/runs/${runId}`, 'observation-added');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/runs/:runId/observations/:observationId/citations',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const runId = context.params['runId'] ?? '';
      const observationId = context.params['observationId'] ?? '';
      const raw = Object.fromEntries(context.fields.entries()) as Record<string, unknown>;
      raw['targetOwned'] = context.fields.get('targetOwned') ?? '';
      const result = validateCitationDraftInput(raw);
      if (!result.ok) {
        return htmlResponse(
          runDetailPage(context, projectId, runId, {
            issues: result.issues,
            values: context.fields,
          }),
          422,
        );
      }
      addCitation(
        context.deps.db,
        projectId,
        runId,
        observationId,
        result.value,
        writeContext(context),
      );
      return redirectWithNotice(`/projects/${projectId}/runs/${runId}`, 'citation-added');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/runs/:runId/observations/:observationId/void',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const runId = context.params['runId'] ?? '';
      const observationId = context.params['observationId'] ?? '';
      const result = validateReasonInput(
        Object.fromEntries(context.fields.entries()) as Record<string, unknown>,
      );
      if (!result.ok) {
        return htmlResponse(
          runDetailPage(context, projectId, runId, {
            issues: result.issues,
            values: context.fields,
          }),
          422,
        );
      }
      voidObservation(
        context.deps.db,
        projectId,
        runId,
        observationId,
        result.value,
        writeContext(context),
      );
      return redirectWithNotice(`/projects/${projectId}/runs/${runId}`, 'observation-voided');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/runs/:runId/observations/:observationId/citations/:citationId/void',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const runId = context.params['runId'] ?? '';
      const observationId = context.params['observationId'] ?? '';
      const citationId = context.params['citationId'] ?? '';
      const result = validateReasonInput(
        Object.fromEntries(context.fields.entries()) as Record<string, unknown>,
      );
      if (!result.ok) {
        return htmlResponse(
          runDetailPage(context, projectId, runId, {
            issues: result.issues,
            values: context.fields,
          }),
          422,
        );
      }
      voidCitation(
        context.deps.db,
        projectId,
        runId,
        observationId,
        citationId,
        result.value,
        writeContext(context),
      );
      return redirectWithNotice(`/projects/${projectId}/runs/${runId}`, 'citation-voided');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/runs/:runId/observations/:observationId/assessments',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const runId = context.params['runId'] ?? '';
      const observationId = context.params['observationId'] ?? '';
      const result = validateObservationAssessmentDraftInput(
        Object.fromEntries(context.fields.entries()) as Record<string, unknown>,
      );
      if (!result.ok) {
        return htmlResponse(
          runDetailPage(context, projectId, runId, {
            issues: result.issues,
            values: context.fields,
          }),
          422,
        );
      }
      recordObservationAssessment(
        context.deps.db,
        projectId,
        runId,
        observationId,
        result.value,
        writeContext(context),
      );
      return redirectWithNotice(`/projects/${projectId}/runs/${runId}`, 'observation-assessed');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/runs/:runId/finalize',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const runId = context.params['runId'] ?? '';
      try {
        finalizeRun(context.deps.db, projectId, runId, writeContext(context));
      } catch (error) {
        if (error instanceof AppError) {
          return htmlResponse(
            runDetailPage(context, projectId, runId, {
              issues: [{ field: 'run', message: error.publicMessage }],
            }),
            422,
          );
        }
        throw error;
      }
      return redirectWithNotice(`/projects/${projectId}/runs/${runId}`, 'run-finalized');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/runs/:runId/cancel',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const runId = context.params['runId'] ?? '';
      const result = validateReasonInput(
        Object.fromEntries(context.fields.entries()) as Record<string, unknown>,
      );
      if (!result.ok) {
        return htmlResponse(
          runDetailPage(context, projectId, runId, {
            issues: result.issues,
            values: context.fields,
          }),
          422,
        );
      }
      cancelRun(context.deps.db, projectId, runId, result.value, writeContext(context));
      return redirectWithNotice(`/projects/${projectId}/runs/${runId}`, 'run-cancelled');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/runs/:runId/import',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const runId = context.params['runId'] ?? '';
      const run = getRunOrThrow(context.deps.db, projectId, runId);
      const raw = context.fields.get('json') ?? '';
      const parsed = parseObservationImport(raw);
      if (!parsed.ok) {
        return htmlResponse(
          runDetailPage(context, projectId, runId, {
            issues: parsed.issues,
            values: context.fields,
          }),
          422,
        );
      }
      const byOrdinal = new Map(run.querySet.queries.map((query) => [query.ordinal, query]));
      const missingOrdinals = parsed.value
        .map((row) => row.queryOrdinal)
        .filter((ordinal) => !byOrdinal.has(ordinal));
      if (missingOrdinals.length > 0) {
        return htmlResponse(
          runDetailPage(context, projectId, runId, {
            issues: missingOrdinals.map((ordinal) => ({
              field: 'json',
              message: `No query has ordinal ${String(ordinal)} in this run's query set.`,
            })),
            values: context.fields,
          }),
          422,
        );
      }
      try {
        withTransaction(context.deps.db, () => {
          for (const row of parsed.value) {
            const query = byOrdinal.get(row.queryOrdinal);
            if (query === undefined) {
              throw new AppError('INVALID_INPUT', 'Query ordinal missing.');
            }
            const observation = addObservation(
              context.deps.db,
              projectId,
              runId,
              { ...row.observation, queryId: query.id },
              writeContext(context),
            );
            for (const citation of row.citations) {
              addCitation(
                context.deps.db,
                projectId,
                runId,
                observation.id,
                citation,
                writeContext(context),
              );
            }
            for (const assessment of row.assessments) {
              recordObservationAssessment(
                context.deps.db,
                projectId,
                runId,
                observation.id,
                assessment,
                writeContext(context),
              );
            }
          }
        });
      } catch (error) {
        if (error instanceof AppError) {
          return htmlResponse(
            runDetailPage(context, projectId, runId, {
              issues: [{ field: 'json', message: error.publicMessage }],
              values: context.fields,
            }),
            422,
          );
        }
        throw error;
      }
      return redirectWithNotice(`/projects/${projectId}/runs/${runId}`, 'observations-imported');
    },
  },
];
