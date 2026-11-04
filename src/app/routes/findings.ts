import {
  FINDING_CAUSE_DESCRIPTIONS,
  FINDING_CAUSE_LABELS,
  FINDING_CAUSES,
  FINDING_REFERENCE_LABELS,
  FINDING_REFERENCE_TYPES,
  FINDING_SEVERITIES,
  FINDING_SEVERITY_DESCRIPTIONS,
  FINDING_SEVERITY_LABELS,
  FINDING_STATUSES,
  FINDING_STATUS_DESCRIPTIONS,
  FINDING_STATUS_LABELS,
  FINDING_TRANSITIONS,
  isMeasurementOnlyStatus,
  requiresClosureRationale,
  statusAllowedForOutcome,
  SUGGESTION_PRIORITY_TO_SEVERITY,
  type FindingReferenceType,
  type FindingStatus,
} from '../../core/findings.ts';
import {
  validateFindingDetailsInput,
  validateFindingDraftInput,
  validateFindingReferenceInput,
  validateFindingTransitionInput,
  validateRetestFocusInput,
} from '../../core/findingInputs.ts';
import { COMPARISON_METRICS, FOCUS_METRICS, isFocusMetric } from '../../core/runComparison.ts';
import { isOneOf } from '../../core/vocabulary.ts';
import type { MetricComparisonRow } from '../../core/runComparison.ts';
import {
  addFindingReference,
  availableFocusMetrics,
  createFinding,
  getFindingOrThrow,
  listFindings,
  listReferenceCandidates,
  previewRetestComparison,
  recordRetestComparison,
  referenceTargetLabels,
  removeFindingReference,
  transitionFinding,
  updateFindingDetails,
  type FindingRecord,
  type FindingReferenceRecord,
  type ReferenceChoiceMap,
  type RetestComparisonPreview,
} from '../../persistence/repositories/findings.ts';
import { listRuns } from '../../persistence/repositories/runs.ts';
import { getProjectOrThrow } from '../../persistence/repositories/projects.ts';
import { dateTimeLocalValue, normalizeDateTimeInput } from '../forms.ts';
import type { ValidationIssue } from '../../core/validation.ts';
import { htmlResponse, redirectWithNotice, type AppResponse } from '../http/responses.ts';
import { writeContext, type RequestContext, type RouteDefinition } from '../http/types.ts';
import {
  csrfField,
  dateTimeField,
  definitionRow,
  emptyState,
  errorSummary,
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

const REFERENCE_TYPE_LABELS = FINDING_REFERENCE_LABELS;

interface FormState {
  readonly issues: readonly ValidationIssue[];
  readonly values: Values;
  /** The session token every write form on the page must carry. */
  readonly csrf: string;
}

function rawFields(context: RequestContext): Record<string, unknown> {
  return Object.fromEntries(context.fields.entries()) as Record<string, unknown>;
}

function formState(context: RequestContext, issues: readonly ValidationIssue[] = []): FormState {
  return { issues, values: context.fields, csrf: context.csrfToken };
}

function findingsPath(projectId: string): string {
  return `/projects/${projectId}/findings`;
}

function findingPath(projectId: string, findingId: string): string {
  return `${findingsPath(projectId)}/${findingId}`;
}

function page(body: Html, projectId: string, title: string, notice: string | null): Html {
  return layout({
    title,
    body,
    notice,
    navigation: projectNav({ projectId, current: 'findings' }),
  });
}

function statusTone(status: FindingStatus): 'good' | 'bad' | 'warn' | 'neutral' {
  if (status === 'IMPROVED' || status === 'CLOSED_WITH_RATIONALE') {
    return 'good';
  }
  if (status === 'REGRESSED' || status === 'WONT_FIX') {
    return 'bad';
  }
  if (status === 'UNCHANGED' || status === 'UNABLE_TO_VERIFY' || status === 'RETEST_REQUIRED') {
    return 'warn';
  }
  return 'neutral';
}

function statusSelect(
  values: Values,
  issues: readonly ValidationIssue[],
  allowed: readonly FindingStatus[],
  name = 'status',
): Html {
  return selectField({
    name,
    label: 'New status',
    value: valueOf(values, name),
    issues,
    required: true,
    includeBlank: 'Choose the status to move to',
    options: allowed.map((status) => ({ value: status, label: FINDING_STATUS_LABELS[status] })),
    help: 'Only the statuses this finding may legally reach are offered.',
  });
}

// ---------------------------------------------------------------------------
// Shared panels
// ---------------------------------------------------------------------------

/** What a finding points at, in the words of the record rather than its identifier. */
function referencePanel(
  finding: FindingRecord,
  projectId: string,
  labels: Map<string, string | null>,
  state: FormState,
): Html {
  const rows = finding.references.map((reference: FindingReferenceRecord) => {
    const label = labels.get(reference.id);
    return html`
      <tr>
        <td>${REFERENCE_TYPE_LABELS[reference.type]}</td>
        <td>
          ${
            label === null || label === undefined
              ? html`<span class="muted"
                  >No longer present in this project. The pointer was removed with its record, so
                  this finding no longer describes live content.</span
                >`
              : html`<span class="reference-label">${label}</span>`
          }
        </td>
        <td>${formatDateTime(reference.createdAt)}</td>
        <td>
          <form
            method="post"
            action="${findingPath(projectId, finding.id)}/references/${reference.id}/remove"
          >
            ${csrfField(state.csrf)} ${submitButton('Remove pointer', 'secondary')}
          </form>
        </td>
      </tr>
    `;
  });
  return html`
    <section class="panel" id="references">
      <h2>What this finding is about</h2>
      <p class="small muted">
        A pointer stores only the record's identity, never a copy of its text, so the wording shown
        here is what that record says today.
      </p>
      ${
        finding.references.length === 0
          ? html`<p class="small muted">
              No record is pointed at yet. Link one below so the finding is anchored to evidence
              rather than to memory.
            </p>`
          : html`
              <div class="table-wrap">
                <table>
                  <caption>
                    Records pointed at by ${finding.reference}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Kind</th>
                      <th scope="col">Record</th>
                      <th scope="col">Linked</th>
                      <th scope="col">Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows}
                  </tbody>
                </table>
              </div>
            `
      }
    </section>
  `;
}

/**
 * The add-pointer control. A type select and a target select cannot share one form without client
 * scripting, so the type is chosen first and comes back as a query parameter that fills the target
 * list for that kind of record only.
 */
function addReferencePanel(
  finding: FindingRecord,
  projectId: string,
  candidates: ReferenceChoiceMap,
  picked: string | null,
  state: FormState,
): Html {
  const choices = picked === null ? undefined : candidates[picked as keyof ReferenceChoiceMap];
  const empty = choices !== undefined && choices.items.length === 0;
  return html`
    <section class="panel" id="add-reference">
      <h2>Link a record</h2>
      <form method="get" action="${findingPath(projectId, finding.id)}">
        ${selectField({
          name: 'referenceType',
          label: 'Kind of record',
          value: picked ?? valueOf(state.values, 'referenceType'),
          issues: state.issues,
          includeBlank: 'Choose what kind of record this finding is about',
          options: FINDING_REFERENCE_TYPES.filter((type) => type !== 'report_suggestion').map(
            (type) => ({ value: type, label: REFERENCE_TYPE_LABELS[type] }),
          ),
          help: 'The list is the project’s own records of that kind, named in words rather than by identifier.',
        })}
        ${submitButton('Show records of this kind', 'secondary')}
      </form>
      ${
        picked === null || choices === undefined
          ? ''
          : html`
              <form
                method="post"
                action="${findingPath(projectId, finding.id)}/references"
                novalidate
              >
                ${csrfField(state.csrf)}
                <input type="hidden" name="referenceType" value="${picked}" />
                ${
                  empty
                    ? html`<p class="small muted">This project has no records of that kind yet.</p>`
                    : selectField({
                        name: 'referenceId',
                        label: REFERENCE_TYPE_LABELS[picked as FindingReferenceType],
                        value: valueOf(state.values, 'referenceId'),
                        issues: state.issues,
                        required: true,
                        includeBlank: 'Choose the record',
                        options: choices.items.map((item) => ({
                          value: item.id,
                          label: item.label,
                        })),
                        ...(choices.truncated
                          ? {
                              help: 'Showing the 50 most recent records of this kind. Older ones are not listed here.',
                            }
                          : {}),
                      })
                }
                ${submitButton('Link this record')}
              </form>
            `
      }
    </section>
  `;
}

/**
 * The measured states cannot be typed by hand, and the form must not offer one the server is obliged
 * to refuse. Offering every measured status as soon as any comparison exists would read as a bug to
 * the operator, when the rule is really about which outcome was actually measured.
 */
function offeredStatuses(finding: FindingRecord): FindingStatus[] {
  return FINDING_TRANSITIONS[finding.status].filter(
    (status) =>
      !isMeasurementOnlyStatus(status) ||
      finding.comparisons.some((comparison) => statusAllowedForOutcome(status, comparison.outcome)),
  );
}

/** The measured states reachable from here that no stored comparison supports yet. */
function withheldStatuses(finding: FindingRecord): FindingStatus[] {
  const offered = new Set<string>(offeredStatuses(finding));
  return FINDING_TRANSITIONS[finding.status].filter(
    (status) => isMeasurementOnlyStatus(status) && !offered.has(status),
  );
}

/** A posted status only means something if the declared vocabulary contains it. */
function postedStatus(raw: Record<string, unknown>): FindingStatus | null {
  const value = raw['status'];
  return typeof value === 'string' && isOneOf(value, FINDING_STATUSES) ? value : null;
}

/** The lifecycle, not the form, decides when a written rationale is owed. */
function missingClosureRationale(raw: Record<string, unknown>): ValidationIssue[] {
  const status = postedStatus(raw);
  if (status === null || !requiresClosureRationale(status)) {
    return [];
  }
  const rationale = typeof raw['rationale'] === 'string' ? raw['rationale'].trim() : '';
  return rationale.length < 3
    ? [
        {
          field: 'rationale',
          message: 'Closing a finding, or declining to fix it, requires a written rationale.',
        },
      ]
    : [];
}

/**
 * A measured status is refused here with the reason, rather than reaching the repository and coming
 * back as an opaque conflict page. The message names what would unlock it, because "unable to verify"
 * is a respectable answer and the operator needs to see that.
 */
function refusedMeasurementStatus(
  finding: FindingRecord,
  raw: Record<string, unknown>,
): ValidationIssue[] {
  const status = postedStatus(raw);
  if (
    status === null ||
    !isMeasurementOnlyStatus(status) ||
    finding.comparisons.some((comparison) => statusAllowedForOutcome(status, comparison.outcome))
  ) {
    return [];
  }
  const label = FINDING_STATUS_LABELS[status];
  return [
    {
      field: 'status',
      message:
        finding.comparisons.length === 0
          ? `${label} requires a stored retest comparison that concluded it. Record the retest first.`
          : `None of the ${plural(
              finding.comparisons.length,
              'stored comparison',
              'stored comparisons',
            )} for this finding concluded ${label.toLowerCase()}. Record the retest that measured it, or choose the status the measurement supports.`,
    },
  ];
}

function transitionIssues(
  finding: FindingRecord,
  raw: Record<string, unknown>,
  validation: readonly ValidationIssue[],
): ValidationIssue[] {
  return [
    ...validation,
    ...missingClosureRationale(raw),
    ...refusedMeasurementStatus(finding, raw),
  ];
}

/** A readable label for one stored comparison, used wherever the record must be cited. */
function comparisonOptionLabel(comparison: FindingRecord['comparisons'][number]): string {
  const focus = comparison.focusMetric ?? 'focus metric not recorded';
  const moved = comparison.deltas.find((row) => row.metricId === comparison.focusMetric);
  const movement =
    moved === undefined || moved.prior === null || moved.current === null
      ? ''
      : ` — ${formatPercent(moved.prior)} → ${formatPercent(moved.current)}`;
  return `${humanize(comparison.outcome)} · ${focus}${movement} · runs ${comparison.baseRunId} → ${comparison.laterRunId} · ${formatDateTime(comparison.createdAt)}`;
}

/**
 * Which stored comparison justifies the status being chosen.
 *
 * A measured status is a claim about a specific measurement, so the citation is offered as a choice
 * from this finding's own comparisons rather than a free-text id. A status that needs no measurement
 * can leave it blank.
 */
function comparisonCitationField(
  finding: FindingRecord,
  values: Values,
  issues: readonly ValidationIssue[],
): Html {
  if (finding.comparisons.length === 0) {
    return html`
      <p class="small muted">
        No comparison is stored on this finding yet, so no measured status can be recorded. Use the
        retest form to compare two finalized runs first.
      </p>
    `;
  }
  return selectField({
    name: 'comparisonId',
    label: 'Comparison that justifies this status (required for a measured status)',
    value: valueOf(values, 'comparisonId'),
    issues,
    includeBlank: 'None — this status is not a measurement',
    options: finding.comparisons.map((comparison) => ({
      value: comparison.id,
      label: comparisonOptionLabel(comparison),
    })),
    help: 'The cited comparison must belong to this finding and must carry the outcome being recorded. The choice is stored in the history row, so a later reader can check the status against the measurement behind it.',
  });
}

function transitionPanel(finding: FindingRecord, projectId: string, state: FormState): Html {
  const allowed = FINDING_TRANSITIONS[finding.status];
  const offered = offeredStatuses(finding);
  const withheld = withheldStatuses(finding);
  return html`
    <section class="panel" id="transition">
      <h2>Move this finding forward</h2>
      ${
        allowed.length === 0
          ? html`<p class="small muted">
              <strong>${FINDING_STATUS_LABELS[finding.status]}</strong> is a recorded end point. The
              history stays, and a new finding is opened for anything that comes after it rather
              than rewriting this one.
            </p>`
          : html`
              <form
                method="post"
                action="${findingPath(projectId, finding.id)}/transition"
                novalidate
              >
                ${csrfField(state.csrf)} ${statusSelect(state.values, state.issues, offered)}
                ${comparisonCitationField(finding, state.values, state.issues)}
                ${textareaField({
                  name: 'note',
                  scope: 'transition',
                  label: 'What changed and why',
                  value: valueOf(state.values, 'note'),
                  issues: state.issues,
                  required: true,
                  rows: 3,
                  maxLength: 4000,
                  help: 'Written as an update to the finding. Every status change is appended to the history and cannot be edited afterwards.',
                })}
                ${textareaField({
                  name: 'rationale',
                  label: 'Closure rationale (only for closed or wont-fix)',
                  value: valueOf(state.values, 'rationale'),
                  issues: state.issues,
                  rows: 2,
                  maxLength: 4000,
                  help: 'Required when closing or declining to fix. Leave blank for any other status.',
                })}
                ${submitButton('Record this status change')}
              </form>
            `
      }
      <p class="small muted">
        ${plural(
          finding.comparisons.length,
          'stored retest comparison',
          'stored retest comparisons',
        )}
        ${
          finding.comparisons.length === 0
            ? 'so improved, unchanged, regressed and unable to verify are not offered: each of them requires a measurement, not a judgement.'
            : 'are on record, so a measured status may be chosen only where one of them carries that outcome.'
        }
      </p>
      ${
        withheld.length === 0
          ? ''
          : html`<p class="small muted">
              Not offered right now:
              ${withheld.map((status) => FINDING_STATUS_LABELS[status]).join(', ')} — each one is an
              outcome of a retest, and only a stored comparison that concluded it can put the
              finding there.
            </p>`
      }
      <details>
        <summary>What each status claims</summary>
        <dl class="definition-list">
          ${FINDING_STATUSES.map((status) =>
            definitionRow(
              FINDING_STATUS_LABELS[status],
              html`<p class="small">${FINDING_STATUS_DESCRIPTIONS[status]}</p>`,
            ),
          )}
        </dl>
      </details>
    </section>
  `;
}

function historyPanel(finding: FindingRecord): Html {
  return html`
    <section class="panel" id="history">
      <h2>History</h2>
      <p class="small muted">
        Append-only. The actor label is typed by the person using this computer; local core has no
        accounts, so it identifies nobody.
      </p>
      <ol class="timeline">
        ${finding.updates.map(
          (update) => html`
            <li>
              <strong>
                ${update.sequence}.
                ${
                  update.previousStatus === null
                    ? 'Opened'
                    : `${FINDING_STATUS_LABELS[update.previousStatus]} → ${
                        update.newStatus === null
                          ? 'no status change'
                          : FINDING_STATUS_LABELS[update.newStatus]
                      }`
                }
              </strong>
              <span class="muted"> · ${formatDateTime(update.createdAt)} · ${update.actor}</span>
              <p>${update.note}</p>
              ${
                update.comparisonId === null
                  ? ''
                  : html`<p class="small muted">
                      Cited comparison:
                      <strong
                        >${
                          finding.comparisons.find(
                            (comparison) => comparison.id === update.comparisonId,
                          )
                            ? comparisonOptionLabel(
                                finding.comparisons.find(
                                  (comparison) => comparison.id === update.comparisonId,
                                )!,
                              )
                            : 'a comparison no longer on this finding'
                        }</strong
                      >
                    </p>`
              }
            </li>
          `,
        )}
      </ol>
    </section>
  `;
}

/** One metric row of a stored comparison, rendered as a value movement rather than a bare delta. */
function comparisonDeltaRow(row: MetricComparisonRow, focusMetric: string | null): Html {
  const isFocus = row.metricId === focusMetric;
  return html`
    <tr>
      <th scope="row">
        ${isFocus ? html`<strong>${row.label} — decided this outcome</strong>` : row.label}
      </th>
      <td class="small muted">${row.unit}</td>
      <td class="numeric">
        ${row.prior === null ? 'not available' : formatPercent(row.prior)}
        <span class="muted small"
          >(${row.priorNumerator ?? '—'}/${String(row.priorDenominator)})</span
        >
      </td>
      <td class="numeric">
        ${row.current === null ? 'not available' : formatPercent(row.current)}
        <span class="muted small"
          >(${row.currentNumerator ?? '—'}/${String(row.currentDenominator)})</span
        >
      </td>
      <td>${humanize(row.direction)}</td>
    </tr>
  `;
}

function comparisonsPanel(finding: FindingRecord, projectId: string): Html {
  if (finding.comparisons.length === 0) {
    return html`
      <section class="panel" id="comparisons">
        <h2>Retest comparisons</h2>
        <p class="small muted">
          None recorded. A comparison needs an earlier finalized run and a later finalized run under
          the same query set, captured by hand.
        </p>
      </section>
    `;
  }
  return html`
    <section class="panel" id="comparisons">
      <h2>Retest comparisons</h2>
      ${finding.comparisons.map(
        (comparison) => html`
          <article class="sub-panel">
            <h3>
              ${humanize(comparison.outcome)} ·
              <a
                href="${findingPath(projectId, finding.id)}/retest?baseRunId=${comparison.baseRunId}&amp;laterRunId=${comparison.laterRunId}"
                >runs ${comparison.baseRunId} and ${comparison.laterRunId}</a
              >
            </h3>
            <p class="small muted">
              Recorded ${formatDateTime(comparison.createdAt)} by ${comparison.createdBy}.
              Comparable: ${comparison.comparable ? 'yes' : 'no'}.
            </p>
            ${
              comparison.focusMetric === null
                ? html`<p class="small muted">
                    This comparison was recorded before the focus metric was stored, so the single
                    measurement that decided its outcome is not recoverable from the record. It is
                    shown exactly as stored and is never recalculated.
                  </p>`
                : html` <p class="small">
                      <strong>Focus metric:</strong>
                      ${comparison.focusLabel ?? comparison.focusMetric}
                      (<code>${comparison.focusMetric}</code>) — the one value ADR-021 says decides
                      whether this finding improved, stayed unchanged, or regressed. Every other
                      metric below is context.
                    </p>
                    <p class="small muted">
                      Comparability rule: ${comparison.ruleVersion ?? 'comparison-rule-v1'}. Metrics
                      version: ${comparison.baseMetricsVersion ?? 'not recorded'} then,
                      ${comparison.laterMetricsVersion ?? 'not recorded'} now.
                    </p>`
            }
            ${
              comparison.reasons.length === 0
                ? ''
                : html`<ul class="small">
                    ${comparison.reasons.map((reason) => html`<li>${reason}</li>`)}
                  </ul>`
            }
            ${
              comparison.statementNote === null
                ? ''
                : html`<p class="small">
                    <strong>Statements:</strong> ${comparison.statementNote}
                  </p>`
            }
            ${
              comparison.deltas.length === 0
                ? ''
                : html` <div class="table-wrap">
                    <table>
                      <caption>
                        What moved, and by how much, between the two captures
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Metric</th>
                          <th scope="col">Unit</th>
                          <th scope="col">Earlier run</th>
                          <th scope="col">Later run</th>
                          <th scope="col">Direction</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${comparison.deltas.map((row) =>
                          comparisonDeltaRow(row, comparison.focusMetric),
                        )}
                      </tbody>
                    </table>
                  </div>`
            }
          </article>
        `,
      )}
      <p class="small muted boundary">
        Every comparison above is an association between two captures, not evidence that a change
        caused anything.
      </p>
    </section>
  `;
}

function detailFields(finding: FindingRecord, projectId: string, state: FormState): Html {
  return html`
    <section class="panel" id="amend">
      <h2>Amend the finding without changing its status</h2>
      <p class="small muted">
        Severity and cause are classifications that can be re-made as evidence grows. Each change is
        appended to the history in the same transaction, and the original wording stays.
      </p>
      <form method="post" action="${findingPath(projectId, finding.id)}/details" novalidate>
        ${csrfField(state.csrf)}
        ${selectField({
          name: 'severity',
          label: 'Severity (blank keeps the current one)',
          value: valueOf(state.values, 'severity'),
          issues: state.issues,
          includeBlank: `Unchanged: currently ${FINDING_SEVERITY_LABELS[finding.severity]}`,
          options: FINDING_SEVERITIES.map((severity) => ({
            value: severity,
            label: FINDING_SEVERITY_LABELS[severity],
          })),
        })}
        ${selectField({
          name: 'cause',
          label: 'Cause class (blank keeps the current one)',
          value: valueOf(state.values, 'cause'),
          issues: state.issues,
          includeBlank: `Unchanged: currently ${FINDING_CAUSE_LABELS[finding.cause]}`,
          options: FINDING_CAUSES.map((cause) => ({
            value: cause,
            label: FINDING_CAUSE_LABELS[cause],
          })),
        })}
        ${textField({
          name: 'ownerLabel',
          label: 'Owner label (blank keeps the current one)',
          value: valueOf(state.values, 'ownerLabel'),
          issues: state.issues,
          maxLength: 80,
          help: 'An operator-asserted label. It does not prove who is responsible.',
        })}
        ${textareaField({
          name: 'recommendedAction',
          label: 'Recommended action (blank keeps the current one)',
          value: valueOf(state.values, 'recommendedAction'),
          issues: state.issues,
          rows: 2,
          maxLength: 4000,
        })}
        ${dateTimeField({
          name: 'lastObservedAt',
          label: 'Last observed when (blank keeps the current one)',
          value: valueOf(state.values, 'lastObservedAt'),
          issues: state.issues,
        })}
        ${textareaField({
          name: 'note',
          scope: 'details',
          label: 'Why this amendment is being made',
          value: valueOf(state.values, 'note'),
          issues: state.issues,
          required: true,
          rows: 2,
          maxLength: 4000,
        })}
        ${submitButton('Save the amendment')}
      </form>
    </section>
  `;
}

function summaryPanel(finding: FindingRecord): Html {
  return html`
    <section class="panel" id="summary">
      <h2>${finding.reference} · ${finding.title}</h2>
      <dl class="definition-list">
        ${definitionRow('Status', statusBadge(FINDING_STATUS_LABELS[finding.status], statusTone(finding.status)))}
        ${definitionRow(
          'Severity',
          html`<p>${FINDING_SEVERITY_LABELS[finding.severity]} — ${finding.severityRationale}</p>`,
        )}
        ${definitionRow(
          'Cause',
          html`<p>
            ${FINDING_CAUSE_LABELS[finding.cause]} — ${FINDING_CAUSE_DESCRIPTIONS[finding.cause]}
          </p>`,
        )}
        ${definitionRow('Observed issue', html`<p>${finding.observedIssue}</p>`)}
        ${definitionRow('Supporting evidence', html`<p>${finding.supportingEvidence}</p>`)}
        ${definitionRow('Recommended action', html`<p>${finding.recommendedAction}</p>`)}
        ${definitionRow('Owner label', html`<p>${finding.ownerLabel}</p>`)}
        ${definitionRow(
          'Observed between',
          html`<p>
            ${formatDateTime(finding.firstObservedAt)} and ${formatDateTime(finding.lastObservedAt)}
          </p>`,
        )}
        ${
          finding.statusRationale === null
            ? ''
            : definitionRow('Closure rationale', html`<p>${finding.statusRationale}</p>`)
        }
        ${definitionRow(
          'Created',
          html`<p>${formatDateTime(finding.createdAt)} by ${finding.createdBy}</p>`,
        )}
        ${definitionRow('Last change', html`<p>${formatDateTime(finding.updatedAt)}</p>`)}
      </dl>
    </section>
  `;
}

// ---------------------------------------------------------------------------
// List page
// ---------------------------------------------------------------------------

function listPage(
  projectId: string,
  findings: ReturnType<typeof listFindings>,
  filter: FindingStatus | null,
  notice: string | null,
): Html {
  const openCount = findings.filter((finding) =>
    ['OPEN', 'ACCEPTED', 'IN_PROGRESS', 'AWAITING_EXTERNAL_CHANGE', 'RETEST_REQUIRED'].includes(
      finding.status,
    ),
  ).length;
  return page(
    html`
      ${pageHeader(
        'Findings',
        'Evaluation problems somebody has agreed to track, with the status of the tracking. Nothing here promises a fix or measures one without a retest.',
        html`<a class="button button-primary" href="${findingsPath(projectId)}/new"
          >Raise a finding</a
        >`,
      )}
      <p class="small muted">
        ${plural(findings.length, 'finding')} tracked, ${plural(openCount, 'open')} still needing
        work. Numbering is per project and a number is never reused.
      </p>
      <form method="get" action="${findingsPath(projectId)}">
        ${selectField({
          name: 'status',
          label: 'Filter by status',
          value: filter ?? '',
          issues: [],
          includeBlank: 'Every status',
          options: FINDING_STATUSES.map((status) => ({
            value: status,
            label: FINDING_STATUS_LABELS[status],
          })),
        })}
        ${submitButton('Filter', 'secondary')}
      </form>
      ${
        findings.length === 0
          ? emptyState(
              filter === null ? 'No findings tracked' : 'No findings with that status',
              filter === null
                ? 'A finding is raised by a person who has decided something is worth tracking. Aporia does not invent findings from sample data.'
                : 'Widen the filter to see the rest of this project’s findings.',
              html`<a class="button button-primary" href="${findingsPath(projectId)}/new"
                >Raise the first finding</a
              >`,
            )
          : html`
              <div class="table-wrap">
                <table>
                  <caption>
                    Findings in this project
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Reference</th>
                      <th scope="col">Title</th>
                      <th scope="col">Status</th>
                      <th scope="col">Severity</th>
                      <th scope="col">Owner label</th>
                      <th scope="col">Last change</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${findings.map(
                      (finding) => html`
                        <tr>
                          <td>
                            <a href="${findingPath(projectId, finding.id)}">${finding.reference}</a>
                          </td>
                          <td>${finding.title}</td>
                          <td>
                            ${statusBadge(FINDING_STATUS_LABELS[finding.status], statusTone(finding.status))}
                          </td>
                          <td>${FINDING_SEVERITY_LABELS[finding.severity]}</td>
                          <td>${finding.ownerLabel}</td>
                          <td>${formatDateTime(finding.updatedAt)}</td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              </div>
            `
      }
    `,
    projectId,
    'Findings',
    notice,
  );
}

// ---------------------------------------------------------------------------
// Create page
// ---------------------------------------------------------------------------

function createFields(
  values: Values,
  issues: readonly ValidationIssue[],
  candidates: ReferenceChoiceMap,
): Html {
  const pickedType = values.get('referenceType') ?? '';
  const isPicked =
    pickedType !== '' &&
    (FINDING_REFERENCE_TYPES as readonly string[]).includes(pickedType) &&
    pickedType !== 'report_suggestion';
  const choices = isPicked ? candidates[pickedType as keyof ReferenceChoiceMap] : undefined;
  return html`
    ${textareaField({
      name: 'title',
      label: 'Title',
      value: valueOf(values, 'title'),
      issues,
      required: true,
      maxLength: 300,
      help: 'One line that says what is wrong, in the words you would use to describe it to a colleague.',
    })}
    ${textareaField({
      name: 'observedIssue',
      label: 'Observed issue',
      value: valueOf(values, 'observedIssue'),
      issues,
      required: true,
      rows: 4,
      maxLength: 8000,
      help: 'What was seen in the captured answers. Describe the observation, not a theory about why it happened.',
    })}
    ${textareaField({
      name: 'supportingEvidence',
      label: 'Supporting evidence',
      value: valueOf(values, 'supportingEvidence'),
      issues,
      required: true,
      rows: 3,
      maxLength: 8000,
      help: 'Which recorded observations, statements or audits back this up. Point at the records below rather than paraphrasing them.',
    })}
    ${selectField({
      name: 'cause',
      label: 'Cause class',
      value: valueOf(values, 'cause'),
      issues,
      required: true,
      includeBlank: 'Choose the closest cause',
      options: FINDING_CAUSES.map((cause) => ({
        value: cause,
        label: `${FINDING_CAUSE_LABELS[cause]} — ${FINDING_CAUSE_DESCRIPTIONS[cause]}`,
      })),
      help: 'A human classification of the most plausible cause. Aporia cannot see the provider, so this is a judgement, not a finding of fact.',
    })}
    ${selectField({
      name: 'severity',
      label: 'Severity',
      value: valueOf(values, 'severity'),
      issues,
      required: true,
      includeBlank: 'Choose a severity',
      options: FINDING_SEVERITIES.map((severity) => ({
        value: severity,
        label: `${FINDING_SEVERITY_LABELS[severity]} — ${FINDING_SEVERITY_DESCRIPTIONS[severity]}`,
      })),
    })}
    ${textareaField({
      name: 'severityRationale',
      label: 'Why that severity',
      value: valueOf(values, 'severityRationale'),
      issues,
      required: true,
      rows: 2,
      maxLength: 4000,
      help: 'Required. A severity label without a written reason is not a classification anybody can review.',
    })}
    ${textareaField({
      name: 'recommendedAction',
      label: 'Recommended action',
      value: valueOf(values, 'recommendedAction'),
      issues,
      required: true,
      rows: 2,
      maxLength: 4000,
      help: 'The concrete next step a person could take. It must not promise an index, a ranking, or a memory.',
    })}
    ${textField({
      name: 'ownerLabel',
      label: 'Owner label',
      value: valueOf(values, 'ownerLabel'),
      issues,
      required: true,
      maxLength: 80,
      help: 'Whoever is tracking this, written by you. Local core has no accounts and cannot verify it.',
    })}
    ${dateTimeField({
      name: 'firstObservedAt',
      label: 'First observed',
      value: valueOf(values, 'firstObservedAt'),
      issues,
      required: true,
    })}
    ${dateTimeField({
      name: 'lastObservedAt',
      label: 'Last observed',
      value: valueOf(values, 'lastObservedAt'),
      issues,
      required: true,
    })}
    ${selectField({
      name: 'referenceType',
      label: 'Link a record now (optional)',
      value: pickedType,
      issues,
      includeBlank: 'No record linked yet',
      options: FINDING_REFERENCE_TYPES.filter((type) => type !== 'report_suggestion').map(
        (type) => ({ value: type, label: REFERENCE_TYPE_LABELS[type] }),
      ),
    })}
    ${
      isPicked && choices !== undefined
        ? choices.items.length === 0
          ? html`<p class="small muted">This project has no records of that kind yet.</p>`
          : selectField({
              name: 'referenceId',
              label: REFERENCE_TYPE_LABELS[pickedType as FindingReferenceType],
              value: valueOf(values, 'referenceId'),
              issues,
              required: true,
              includeBlank: 'Choose the record',
              options: choices.items.map((item) => ({ value: item.id, label: item.label })),
              ...(choices.truncated
                ? { help: 'Showing the 50 most recent records of this kind.' }
                : {}),
            })
        : ''
    }
  `;
}

function createPage(
  projectId: string,
  projectName: string,
  state: FormState,
  candidates: ReferenceChoiceMap,
  notice: string | null,
): Html {
  return page(
    html`
      ${pageHeader(
        'Raise a finding',
        `A tracked evaluation problem for ${projectName}. It starts open: accepting it, working on it and measuring it are later steps that each leave their own record.`,
      )}
      ${errorSummary(state.issues)}
      <form method="post" action="${findingsPath(projectId)}" novalidate>
        ${csrfField(state.csrf)} ${createFields(state.values, state.issues, candidates)}
        ${submitButton('Create the finding')}
      </form>
      <details>
        <summary>How severity and cause are used</summary>
        <p class="small">
          Severity is a human classification with a mandatory written rationale, so a weak label
          cannot hide behind a numeric-looking name. Cause is the most plausible explanation you can
          state from the captured evidence; Aporia did not observe the provider, the retrieval, or
          the prompt, so no cause can be reported as proven.
        </p>
      </details>
    `,
    projectId,
    'Raise a finding',
    notice,
  );
}

// ---------------------------------------------------------------------------
// Retest comparison
// ---------------------------------------------------------------------------

const DIRECTION_WORDS: Record<MetricComparisonRow['direction'], string> = {
  IMPROVED: 'Improved',
  UNCHANGED: 'Unchanged',
  REGRESSED: 'Regressed',
  UNABLE_TO_VERIFY: 'No measurement on one side',
  NOT_A_VERDICT: 'Not a verdict',
};

function runChoice(runs: ReturnType<typeof listRuns>, name: string, label: string, value: string) {
  return selectField({
    name,
    label,
    value,
    issues: [],
    required: true,
    includeBlank: 'Choose a finalized run',
    options: runs
      .filter((run) => run.status === 'FINALIZED')
      .map((run) => ({
        value: run.id,
        label: `${run.name} · ${run.querySetName} v${String(run.querySetVersion)} · ${run.providerLabel}${
          run.modelLabel === null ? '' : ` · ${run.modelLabel}`
        } · ${plural(run.observationCount, 'answer')}`,
      })),
  });
}

function deltaTable(rows: readonly MetricComparisonRow[]): Html {
  if (rows.length === 0) {
    return html`<p class="small muted">
      Neither run produced a metric this comparison can carry. That is reported as no measurement,
      never as zero.
    </p>`;
  }
  return html`
    <div class="table-wrap">
      <table>
        <caption>
          Every metric both runs produced
        </caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">Earlier</th>
            <th scope="col">Later</th>
            <th scope="col">Change</th>
            <th scope="col">Reading</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (row) => html`
              <tr>
                <th scope="row">${row.label}</th>
                <td>${formatPercent(row.prior)}</td>
                <td>${formatPercent(row.current)}</td>
                <td>${row.delta === null ? 'Not available' : formatPercent(row.delta)}</td>
                <td>
                  ${DIRECTION_WORDS[row.direction]}
                  ${
                    row.polarity === 'LOWER_IS_BETTER'
                      ? html`<span class="small muted"> (falls are better)</span>`
                      : ''
                  }
                  ${
                    row.polarity === 'CONTEXT'
                      ? html`<span class="small muted">
                          (describes the review, not the answer)</span
                        >`
                      : ''
                  }
                </td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
  `;
}

function previewPanel(
  projectId: string,
  finding: FindingRecord,
  preview: RetestComparisonPreview,
  focusMetric: string,
  state: FormState,
): Html {
  return html`
    <section class="panel" id="preview">
      <h2>What this comparison would record</h2>
      <p>
        <strong>${humanize(preview.outcome)}</strong> for
        ${focusMetric.length === 0 ? 'no metric chosen' : focusMetric}.
      </p>
      ${
        preview.reasons.length === 0
          ? html`<p class="small muted">
              The two runs match on query set, provider, model, interface, grounding, locale and
              region, so the difference is readable as a trend.
            </p>`
          : html`
              <ul class="small">
                ${preview.reasons.map((reason) => html`<li>${reason}</li>`)}
              </ul>
            `
      }
      ${deltaTable(preview.deltas)}
      <p class="small boundary"><strong>Read this carefully:</strong> ${preview.causalBoundary}</p>
      ${
        finding.status !== 'RETEST_REQUIRED'
          ? html`<p class="small muted">
              Nothing can be recorded yet: a retest is recorded against a finding that is waiting
              for one. Move this finding to retest-required first.
            </p>`
          : html`
              <form
                method="post"
                action="${findingPath(projectId, finding.id)}/retest/record"
                novalidate
              >
                ${csrfField(state.csrf)}
                <input type="hidden" name="baseRunId" value="${preview.baseRunId}" />
                <input type="hidden" name="laterRunId" value="${preview.laterRunId}" />
                <input type="hidden" name="focusMetric" value="${focusMetric}" />
                ${submitButton('Record this comparison')}
              </form>
            `
      }
    </section>
  `;
}

/**
 * The retest workspace.
 *
 * The run pair is chosen with a plain get form rather than a post-and-redirect, because a preview
 * writes nothing and the operator should be able to re-read it, share the URL, and change one side
 * without a redirect cycle. The record step is the only write, and it recomputes the comparison from
 * the stored runs instead of trusting anything carried through the form.
 */
function retestPage(
  context: RequestContext,
  finding: FindingRecord,
  state: FormState,
  preview: RetestComparisonPreview | null,
  focusMetric: string,
  notice: string | null,
): Html {
  const projectId = context.params['projectId'] ?? '';
  const runs = listRuns(context.deps.db, projectId);
  const baseRunId = context.url.searchParams.get('baseRunId') ?? valueOf(state.values, 'baseRunId');
  const laterRunId =
    context.url.searchParams.get('laterRunId') ?? valueOf(state.values, 'laterRunId');
  const focusable =
    baseRunId.length > 0 && laterRunId.length > 0 && baseRunId !== laterRunId
      ? availableFocusMetrics(context.deps.db, projectId, baseRunId).filter((metric) =>
          availableFocusMetrics(context.deps.db, projectId, laterRunId).includes(metric),
        )
      : [...FOCUS_METRICS];
  const labelFor = (metric: string): string =>
    preview?.deltas.find((row) => row.metricId === metric)?.label ?? humanize(metric);
  const finalized = runs.filter((run) => run.status === 'FINALIZED');
  return page(
    html`
      ${pageHeader(
        `Retest ${finding.reference}`,
        'Compare an earlier finalized capture with a later one. Aporia does not create the later capture, schedule it, or fetch anything: you generate a new run by hand under the same query set, then come back here.',
        html`<a class="button" href="${findingPath(projectId, finding.id)}"
          >Back to the finding</a
        >`,
      )}
      ${errorSummary(state.issues)}
      ${
        finalized.length < 2
          ? emptyState(
              'Two finalized runs are needed',
              'A comparison reads two stored captures. This project has ' +
                plural(finalized.length, 'finalized run') +
                '. Finalize a later run before measuring anything.',
              html`<a class="button button-primary" href="${findingsPath(projectId)}"
                >Back to findings</a
              >`,
            )
          : html`
              <form method="get" action="${findingPath(projectId, finding.id)}/retest">
                ${runChoice(finalized, 'baseRunId', 'Earlier run', baseRunId)}
                ${runChoice(finalized, 'laterRunId', 'Later run', laterRunId)}
                ${selectField({
                  name: 'focusMetric',
                  label: 'The metric this finding is about',
                  value: focusMetric,
                  issues: state.issues,
                  required: true,
                  includeBlank: 'Choose the one metric to judge by',
                  options: focusable.map((metric) => ({ value: metric, label: labelFor(metric) })),
                  help: 'One metric decides the outcome, because a finding is about one thing. Every metric is still shown below.',
                })}
                <input type="hidden" name="notice" value="" />
                ${submitButton('Preview the comparison', 'secondary')}
              </form>
              ${
                preview === null
                  ? html`<p class="small muted">
                      Nothing has been compared yet. Choosing both runs and one metric shows what a
                      comparison would conclude and which conditions it relies on, before anything
                      is recorded.
                    </p>`
                  : previewPanel(projectId, finding, preview, focusMetric, state)
              }
            `
      }
      <details>
        <summary>Why most retests come back as unable to verify</summary>
        <p class="small">
          A later capture has to match the earlier one on query set, provider label, model label,
          interface label, grounding mode, locale and region. Providers change underneath a manual
          capture all the time, and when any of those differ, the honest outcome is that the pair
          cannot be compared. That is a respectable result, not a failure of the finding.
        </p>
        <dl class="definition-list">
          ${COMPARISON_METRICS.map((metric) =>
            definitionRow(
              labelFor(metric),
              html`<p class="small">
                ${
                  isFocusMetric(metric)
                    ? 'A finding may be about this metric.'
                    : 'Shown as context only. It describes the review, not the answer, so no finding is judged by it.'
                }
              </p>`,
            ),
          )}
        </dl>
      </details>
    `,
    projectId,
    `Retest ${finding.reference}`,
    notice,
  );
}

// ---------------------------------------------------------------------------
// Assembled pages
// ---------------------------------------------------------------------------

function findingPage(
  projectId: string,
  finding: FindingRecord,
  state: FormState,
  labels: Map<string, string | null>,
  picked: string | null,
  candidates: ReferenceChoiceMap,
  notice: string | null,
): Html {
  return page(
    html`
      ${pageHeader(
        `${finding.reference} · ${finding.title}`,
        'A tracked evaluation problem. The narrative, the pointers and the history are what this page shows; nothing here claims a fix until a retest measures one.',
        html`<a class="button" href="${findingPath(projectId, finding.id)}/retest"
          >Compare a later run</a
        >`,
      )}
      ${errorSummary(state.issues)} ${summaryPanel(finding)}
      ${referencePanel(finding, projectId, labels, state)}
      ${addReferencePanel(finding, projectId, candidates, picked, state)}
      ${transitionPanel(finding, projectId, state)} ${detailFields(finding, projectId, state)}
      ${historyPanel(finding)} ${comparisonsPanel(finding, projectId)}
    `,
    projectId,
    finding.reference,
    notice,
  );
}

/**
 * Re-render a finding with the submitted values kept.
 *
 * A refused write has to leave the typed text on the page. Losing it would make the operator re-enter
 * a long narrative to fix one field, and it would hide what was actually attempted. The error summary
 * at the top names each field, and every field keeps its own id, so the page stays reachable with the
 * keyboard alone and needs no script to move focus.
 */
function reRenderFinding(context: RequestContext, issues: readonly ValidationIssue[]): AppResponse {
  const projectId = context.params['projectId'] ?? '';
  const findingId = context.params['findingId'] ?? '';
  const finding = getFindingOrThrow(context.deps.db, projectId, findingId);
  const state = formState(context, issues);
  const labels = referenceTargetLabels(context.deps.db, projectId, finding.references);
  const picked = String(state.values.get('referenceType') ?? '');
  return htmlResponse(
    findingPage(
      projectId,
      finding,
      state,
      labels,
      picked.length === 0 ? null : picked,
      listReferenceCandidates(context.deps.db, projectId),
      // A refused write shows what broke, not a success banner carried over from an earlier redirect.
      null,
    ),
    422,
  );
}

/**
 * Values for a fresh create form.
 *
 * A finding raised from a report suggestion or from a record's own page arrives through query
 * parameters. They prefill the form so the operator is not retyping what the screen already said, and
 * they stay editable, because a suggestion is a gap in the record rather than a decision to fix it.
 */
function presetValues(context: RequestContext): Values {
  const values = new Map<string, string>();
  for (const key of ['referenceType', 'referenceId', 'title', 'observedIssue'] as const) {
    const value = context.url.searchParams.get(key);
    if (value !== null && value.length > 0) {
      values.set(key, value);
    }
  }
  const suggestion = context.url.searchParams.get('suggestion');
  if (suggestion !== null && suggestion.length > 0) {
    values.set('observedIssue', suggestion);
    if (!values.has('title')) {
      values.set('title', suggestion.slice(0, 120));
    }
    const key = context.url.searchParams.get('suggestionKey');
    if (key !== null && key.length > 0) {
      values.set('reportSuggestionKey', key);
    }
  }
  const priority = context.url.searchParams.get('priority');
  if (priority === 'HIGH' || priority === 'MEDIUM' || priority === 'LOW') {
    values.set('severity', SUGGESTION_PRIORITY_TO_SEVERITY[priority]);
  }
  const suggestedOwner = context.deps.config.operator;
  if (suggestedOwner.length > 0) {
    values.set('ownerLabel', suggestedOwner);
  }
  const now = dateTimeLocalValue(context.now);
  values.set('firstObservedAt', now);
  values.set('lastObservedAt', now);
  return values;
}

/** datetime-local values are wall-clock text; the stored form is one UTC instant. */
function withNormalizedTimes(fields: Record<string, unknown>): Record<string, unknown> {
  const next = { ...fields };
  for (const key of ['firstObservedAt', 'lastObservedAt'] as const) {
    const normalized = normalizeDateTimeInput(
      typeof next[key] === 'string' ? (next[key] as string) : undefined,
    );
    if (normalized !== undefined) {
      next[key] = normalized;
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Every write here recomputes its own inputs from stored state and posted identifiers. No preview,
 * label or metric list is carried through a hidden field, because a form value is an argument from
 * the browser, and the comparison must describe the runs as they are stored at record time.
 */
export const findingRoutes: RouteDefinition[] = [
  {
    method: 'GET',
    path: '/projects/:projectId/findings',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      getProjectOrThrow(context.deps.db, projectId);
      const requested = context.url.searchParams.get('status');
      const filter = FINDING_STATUSES.includes(requested as FindingStatus)
        ? (requested as FindingStatus)
        : undefined;
      const findings = listFindings(
        context.deps.db,
        projectId,
        filter === undefined ? {} : { status: filter },
      );
      return htmlResponse(
        listPage(projectId, findings, filter ?? null, context.url.searchParams.get('notice')),
      );
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/findings/new',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const detail = getProjectOrThrow(context.deps.db, projectId);
      const state: FormState = {
        issues: [],
        values: presetValues(context),
        csrf: context.csrfToken,
      };
      return htmlResponse(
        createPage(
          projectId,
          detail.project.name,
          state,
          listReferenceCandidates(context.deps.db, projectId),
          null,
        ),
      );
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/findings',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const fields = withNormalizedTimes(rawFields(context));
      const candidates = listReferenceCandidates(context.deps.db, projectId);
      const redraft = (issues: readonly ValidationIssue[]): AppResponse =>
        htmlResponse(
          createPage(
            projectId,
            getProjectOrThrow(context.deps.db, projectId).project.name,
            formState(context, issues),
            candidates,
            null,
          ),
          422,
        );
      // A pointer is optional, but a half-filled one is a mistake rather than a blank. Dropping it
      // quietly would leave the operator believing the finding was anchored to the record they chose.
      const referenceType = fields['referenceType'];
      const referenceCheck =
        typeof referenceType === 'string' && referenceType.length > 0
          ? validateFindingReferenceInput(fields)
          : null;
      if (referenceCheck !== null && !referenceCheck.ok) {
        return redraft(referenceCheck.issues);
      }
      if (referenceCheck !== null && referenceCheck.value.type === 'report_suggestion') {
        return redraft([
          {
            field: 'referenceType',
            message: 'A report suggestion is recorded on the finding itself, not as a pointer.',
          },
        ]);
      }
      const result = validateFindingDraftInput(fields);
      if (!result.ok) {
        return redraft(result.issues);
      }
      const finding = createFinding(
        context.deps.db,
        projectId,
        {
          title: result.value.title,
          observedIssue: result.value.observedIssue,
          supportingEvidence: result.value.supportingEvidence,
          cause: result.value.cause,
          severity: result.value.severity,
          severityRationale: result.value.severityRationale,
          recommendedAction: result.value.recommendedAction,
          ownerLabel: result.value.ownerLabel,
          firstObservedAt: result.value.firstObservedAt,
          lastObservedAt: result.value.lastObservedAt,
          ...(result.value.reportSuggestionKey === undefined
            ? {}
            : { reportSuggestionKey: result.value.reportSuggestionKey }),
          references: referenceCheck === null ? [] : [referenceCheck.value],
        },
        writeContext(context),
      );
      return redirectWithNotice(findingPath(projectId, finding.id), 'finding-created');
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/findings/:findingId',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const findingId = context.params['findingId'] ?? '';
      const finding = getFindingOrThrow(context.deps.db, projectId, findingId);
      const state = formState(context);
      const labels = referenceTargetLabels(context.deps.db, projectId, finding.references);
      const picked = context.url.searchParams.get('referenceType');
      return htmlResponse(
        findingPage(
          projectId,
          finding,
          state,
          labels,
          picked,
          listReferenceCandidates(context.deps.db, projectId),
          context.url.searchParams.get('notice'),
        ),
      );
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/findings/:findingId/transition',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const findingId = context.params['findingId'] ?? '';
      const raw = withNormalizedTimes(rawFields(context));
      const result = validateFindingTransitionInput(raw);
      if (!result.ok) {
        return reRenderFinding(context, result.issues);
      }
      // The lifecycle rules are checked against the stored finding before the write, so a refusal
      // arrives as a field error on the form that caused it instead of as a conflict page.
      const finding = getFindingOrThrow(context.deps.db, projectId, findingId);
      const refused = transitionIssues(finding, raw, []);
      if (refused.length > 0) {
        return reRenderFinding(context, refused);
      }
      transitionFinding(
        context.deps.db,
        projectId,
        findingId,
        {
          status: result.value.status,
          note: result.value.note,
          ...(result.value.rationale === undefined ? {} : { rationale: result.value.rationale }),
          ...(result.value.comparisonId === undefined
            ? {}
            : { comparisonId: result.value.comparisonId }),
        },
        writeContext(context),
      );
      return redirectWithNotice(findingPath(projectId, findingId), 'finding-transitioned');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/findings/:findingId/details',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const findingId = context.params['findingId'] ?? '';
      const result = validateFindingDetailsInput(rawFields(context));
      if (!result.ok) {
        return reRenderFinding(context, result.issues);
      }
      updateFindingDetails(
        context.deps.db,
        projectId,
        findingId,
        {
          note: result.value.note,
          ...(result.value.severity === undefined ? {} : { severity: result.value.severity }),
          ...(result.value.cause === undefined ? {} : { cause: result.value.cause }),
          ...(result.value.recommendedAction === undefined
            ? {}
            : { recommendedAction: result.value.recommendedAction }),
          ...(result.value.ownerLabel === undefined ? {} : { ownerLabel: result.value.ownerLabel }),
          ...(result.value.lastObservedAt === undefined
            ? {}
            : { lastObservedAt: result.value.lastObservedAt }),
        },
        writeContext(context),
      );
      return redirectWithNotice(findingPath(projectId, findingId), 'finding-updated');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/findings/:findingId/references',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const findingId = context.params['findingId'] ?? '';
      const result = validateFindingReferenceInput(rawFields(context));
      if (!result.ok) {
        return reRenderFinding(context, result.issues);
      }
      if (result.value.type === 'report_suggestion') {
        return reRenderFinding(context, [
          {
            field: 'referenceType',
            message: 'A report suggestion is recorded on the finding itself, not as a pointer.',
          },
        ]);
      }
      addFindingReference(
        context.deps.db,
        projectId,
        findingId,
        result.value,
        writeContext(context),
      );
      return redirectWithNotice(findingPath(projectId, findingId), 'finding-referenced');
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/findings/:findingId/references/:referenceId/remove',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const findingId = context.params['findingId'] ?? '';
      const referenceId = context.params['referenceId'] ?? '';
      removeFindingReference(
        context.deps.db,
        projectId,
        findingId,
        referenceId,
        writeContext(context),
      );
      return redirectWithNotice(findingPath(projectId, findingId), 'finding-reference-removed');
    },
  },
  {
    method: 'GET',
    path: '/projects/:projectId/findings/:findingId/retest',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const findingId = context.params['findingId'] ?? '';
      const finding = getFindingOrThrow(context.deps.db, projectId, findingId);
      const baseRunId = context.url.searchParams.get('baseRunId') ?? '';
      const laterRunId = context.url.searchParams.get('laterRunId') ?? '';
      const focusMetric = context.url.searchParams.get('focusMetric') ?? '';
      if (baseRunId.length === 0 || laterRunId.length === 0 || focusMetric.length === 0) {
        return htmlResponse(
          retestPage(context, finding, formState(context), null, focusMetric, null),
        );
      }
      const check = validateRetestFocusInput({
        baseRunId,
        laterRunId,
        focusMetric,
      });
      if (!check.ok) {
        return htmlResponse(
          retestPage(context, finding, formState(context, check.issues), null, focusMetric, null),
          422,
        );
      }
      const preview = previewRetestComparison(
        context.deps.db,
        projectId,
        baseRunId,
        laterRunId,
        focusMetric,
      );
      return htmlResponse(
        retestPage(context, finding, formState(context), preview, focusMetric, null),
      );
    },
  },
  {
    method: 'POST',
    path: '/projects/:projectId/findings/:findingId/retest/record',
    handler: (context) => {
      const projectId = context.params['projectId'] ?? '';
      const findingId = context.params['findingId'] ?? '';
      const check = validateRetestFocusInput(rawFields(context));
      if (!check.ok) {
        const finding = getFindingOrThrow(context.deps.db, projectId, findingId);
        return htmlResponse(
          retestPage(context, finding, formState(context, check.issues), null, '', null),
          422,
        );
      }
      const finding = getFindingOrThrow(context.deps.db, projectId, findingId);
      // Only the two run ids and the chosen metric leave this handler. The comparison itself is
      // recomputed by the repository inside its own transaction, so no derived value — outcome,
      // comparability, reasons or deltas — travels through a caller-supplied object.
      recordRetestComparison(
        context.deps.db,
        projectId,
        finding.id,
        {
          baseRunId: check.value.baseRunId,
          laterRunId: check.value.laterRunId,
          focusMetric: check.value.focusMetric,
        },
        writeContext(context),
      );
      return redirectWithNotice(findingPath(projectId, findingId), 'finding-comparison-recorded');
    },
  },
];
