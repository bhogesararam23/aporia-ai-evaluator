import type { ReportRunView, ReportSnapshot } from '../../reporting/types.ts';
import { FINDING_SEVERITY_LABELS, type FindingSeverity } from '../../website/types.ts';
import {
  assessmentBadge,
  definitionRow,
  formatDateTime,
  formatPercent,
  propositionStatusBadge,
  statusBadge,
  externalUrl,
} from './components.ts';
import { html, type Html } from './html.ts';

function severityLabel(value: string): string {
  return FINDING_SEVERITY_LABELS[value as FindingSeverity] ?? value;
}

function severityTone(value: string): string {
  return value === 'BLOCKING'
    ? 'bad'
    : value === 'LIKELY_DISCOVERABILITY_ISSUE'
      ? 'warn'
      : value === 'UNAVAILABLE'
        ? 'neutral'
        : 'neutral';
}

function metricTable(run: ReportRunView): Html {
  const metrics = [
    run.metrics.mentionRate,
    run.metrics.targetSourceCitationRate,
    run.metrics.anySourceCitationRate,
    run.metrics.citationSupportRate,
    run.metrics.claimFidelityRate,
    run.metrics.attributionCorrectnessRate,
    run.metrics.observedAnswerCoverage,
  ];
  return html`
    <div class="table-wrap">
      <table class="metric-table">
        <caption>
          Metrics for ${run.name}; definitions, denominators, and exclusions are explicit.
        </caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">Value</th>
            <th scope="col">Numerator / denominator</th>
            <th scope="col">Exclusions</th>
            <th scope="col">Definition</th>
          </tr>
        </thead>
        <tbody>
          ${metrics.map(
            (metric) => html`
              <tr>
                <th scope="row">${metric.label}</th>
                <td class="numeric">${formatPercent(metric.value)}</td>
                <td class="numeric">
                  ${metric.numerator === null ? 'Not available' : `${metric.numerator} / ${metric.denominator}`}
                </td>
                <td>
                  ${
                    metric.exclusions.length === 0
                      ? html`<span class="muted">None</span>`
                      : html`<ul class="small">
                          ${metric.exclusions.map((exclusion) => html`<li>${exclusion.reason}: ${exclusion.count}</li>`)}
                        </ul>`
                  }
                </td>
                <td class="small">${metric.definition}</td>
              </tr>
            `,
          )}
        </tbody>
      </table>
    </div>
    <p class="small muted">${run.metrics.notes.join(' ')}</p>
  `;
}

function claimSection(snapshot: ReportSnapshot): Html {
  if (snapshot.claims.length === 0) {
    return html`<p class="muted">No claims were recorded in this project.</p>`;
  }
  return html`
    <div class="stack">
      ${snapshot.claims.map(
        (claim) => html`
          <article class="card">
            <h3>Claim ${claim.id}</h3>
            <p class="muted small">
              ${
                claim.currentRevision === null
                  ? 'No current revision'
                  : `Revision ${String(claim.currentRevision.revisionNumber)} · ${claim.currentRevision.locale} · created ${formatDateTime(claim.currentRevision.createdAt)}`
              }
              · ${claim.status}
            </p>
            <p>${claim.currentRevision?.text ?? 'Revision unavailable.'}</p>
            ${
              claim.currentRevision?.sourceUrl === null ||
              claim.currentRevision?.sourceUrl === undefined
                ? ''
                : html`<p class="small">Source: ${externalUrl(claim.currentRevision.sourceUrl)}</p>`
            }
            ${
              claim.currentRevision?.intendedMeaning === null ||
              claim.currentRevision?.intendedMeaning === undefined
                ? ''
                : html`<p class="small muted">
                    Intended meaning: ${claim.currentRevision.intendedMeaning}
                  </p>`
            }
            <h4>Propositions</h4>
            ${
              claim.propositions.length === 0
                ? html`<p class="muted">No propositions.</p>`
                : claim.propositions.map(
                    (proposition) => html`
                      <section class="finding">
                        <h4>${String(proposition.ordinal)}. ${proposition.text}</h4>
                        <p>
                          ${propositionStatusBadge(proposition.primaryConclusion.status)}
                          <span class="small muted">
                            ${proposition.primaryConclusion.method} ·
                            ${proposition.primaryConclusion.reviewer ?? 'no reviewer'}
                          </span>
                        </p>
                        <p class="small">${proposition.primaryConclusion.rationale}</p>
                        ${
                          proposition.disagreement
                            ? html`<p class="field-error">
                                The human conclusion and the deterministic evidence rule disagree.
                              </p>`
                            : ''
                        }
                        <details>
                          <summary>Deterministic rule output</summary>
                          <p>
                            ${propositionStatusBadge(proposition.derivedStatus.status)}
                            ${proposition.derivedStatus.rationale}
                          </p>
                          ${
                            proposition.derivedStatus.notes.length === 0
                              ? ''
                              : html`<ul class="small muted">
                                  ${proposition.derivedStatus.notes.map((note) => html`<li>${note}</li>`)}
                                </ul>`
                          }
                        </details>
                        <p class="small muted">
                          Evidence requirements: ${proposition.evidenceRequirements}
                        </p>
                        ${
                          proposition.evidence.length === 0
                            ? html`<p class="muted">No evidence relationships recorded.</p>`
                            : html`
                                <div class="table-wrap">
                                  <table>
                                    <caption>
                                      Evidence for proposition ${proposition.id}
                                    </caption>
                                    <thead>
                                      <tr>
                                        <th scope="col">Relation</th>
                                        <th scope="col">Source</th>
                                        <th scope="col">Excerpt</th>
                                        <th scope="col">Rationale</th>
                                        <th scope="col">Reviewer</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      ${proposition.evidence.map(
                                        (row) => html`
                                          <tr>
                                            <td>
                                              ${row.relationship.relation}${row.active ? '' : ' (superseded)'}
                                            </td>
                                            <td>
                                              ${row.source.title}
                                              ${externalUrl(row.source.canonicalUri)}
                                            </td>
                                            <td>
                                              <pre class="raw-answer">${row.evidence.excerpt}</pre>
                                              <div class="small muted">${row.evidence.locator}</div>
                                            </td>
                                            <td>${row.relationship.rationale}</td>
                                            <td>${row.relationship.reviewer}</td>
                                          </tr>
                                        `,
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              `
                        }
                        ${
                          proposition.humanAssessment === null
                            ? ''
                            : html`
                                <p class="small">
                                  Latest reviewed conclusion:
                                  ${assessmentBadge(proposition.humanAssessment.label)} ·
                                  ${proposition.humanAssessment.rationale} ·
                                  ${proposition.humanAssessment.reviewer}
                                </p>
                              `
                        }
                      </section>
                    `,
                  )
            }
          </article>
        `,
      )}
    </div>
  `;
}

function auditSection(snapshot: ReportSnapshot): Html {
  if (snapshot.websiteAudits.length === 0) {
    return html`<p class="muted">No local HTML audit was included in this report.</p>`;
  }
  return html`
    <div class="stack">
      ${snapshot.websiteAudits.map(
        (audit) => html`
          <article class="card">
            <h3>${audit.label}</h3>
            <p class="small muted">
              ${audit.inputMethod === 'UPLOADED' ? `Uploaded ${audit.inputFilename ?? 'file'}` : 'Pasted HTML'}
              · ${audit.byteLength} bytes · SHA-256 ${audit.contentHash} · audited
              ${formatDateTime(audit.auditedAt)} · ${audit.methodologyVersion}
            </p>
            <p class="small muted">
              Only supplied HTML was inspected. Raw HTML is stored locally and never rendered here.
            </p>
            ${
              audit.findings.length === 0
                ? html`<p class="muted">No in-document findings were emitted.</p>`
                : audit.findings.map(
                    (finding) => html`
                      <section
                        class="finding finding-${finding.severity === 'BLOCKING' ? 'blocking' : finding.severity === 'LIKELY_DISCOVERABILITY_ISSUE' ? 'likely' : 'other'}"
                      >
                        <h4>
                          ${finding.title}
                          ${statusBadge(severityLabel(finding.severity), severityTone(finding.severity))}
                        </h4>
                        <p>${finding.observation}</p>
                        <p class="small muted">${finding.rationale}</p>
                        <p><strong>Suggested action:</strong> ${finding.recommendation}</p>
                        <p class="small muted">
                          Locator: ${finding.locator} · code: ${finding.code}
                        </p>
                      </section>
                    `,
                  )
            }
            <h4>Unavailable checks</h4>
            <ul class="unavailable-list">
              ${audit.unavailableChecks.map((check) => html`<li><strong>${check.label}</strong>: ${check.reason}</li>`)}
            </ul>
          </article>
        `,
      )}
    </div>
  `;
}

function runSection(snapshot: ReportSnapshot): Html {
  if (snapshot.runs.length === 0) {
    return html`<p class="muted">
      No finalized manual run is included. Answer metrics are unavailable.
    </p>`;
  }
  return html`
    <div class="stack">
      ${snapshot.runs.map(
        (run) => html`
          <article class="card">
            <h3>${run.name}</h3>
            <dl class="definition-list">
              ${definitionRow('Provider / model', html`${run.providerLabel} / ${run.modelLabel ?? 'Not recorded'}`)}
              ${definitionRow('Interface', html`${run.interfaceLabel}`)}
              ${definitionRow('Grounding', html`${run.groundingMode}`)}
              ${definitionRow('Locale / region', html`${run.locale}${run.region === null ? '' : ` / ${run.region}`}`)}
              ${definitionRow('Capture window', html`${formatDateTime(run.captureFrom)} → ${formatDateTime(run.captureTo)}`)}
              ${definitionRow('Query set', html`${run.querySetName} v${run.querySetVersion}`)}
              ${definitionRow('Conditions', html`${run.conditions}`)}
              ${definitionRow('Manual capture', html`Yes. Aporia did not call a provider; answers were supplied by the operator.`)}
            </dl>
            ${metricTable(run)}
            <h4>Observations</h4>
            ${run.observations.map(
              (observation) => html`
                <section class="finding">
                  <p class="small muted">
                    Query ${String(observation.queryOrdinal)} · ${observation.status} ·
                    ${observation.statusEligibility} · captured
                    ${formatDateTime(observation.capturedAt)}
                    ${observation.voidedAt === null ? '' : ` · voided: ${observation.voidReason ?? ''}`}
                  </p>
                  <p><strong>${observation.queryTextSnapshot}</strong></p>
                  ${
                    observation.answerText === null
                      ? html`<p class="muted">
                          No answer text (${observation.errorNote ?? observation.status}).
                        </p>`
                      : html`<pre class="raw-answer">${observation.answerText}</pre>`
                  }
                  ${observation.errorNote === null ? '' : html`<p class="field-error">Note: ${observation.errorNote}</p>`}
                  ${
                    observation.citations.length === 0
                      ? html`<p class="small muted">
                          No citations recorded (${observation.citationCapture}).
                        </p>`
                      : html`<ul class="small">
                          ${observation.citations.map((citation) => html`<li>${externalUrl(citation.url, citation.title ?? citation.url)}${citation.targetOwned ? ' · target-owned' : ''}${citation.voidedAt === null ? '' : ' · voided'}</li>`)}
                        </ul>`
                  }
                  ${
                    observation.assessments.length === 0
                      ? html`<p class="small muted">No answer-level assessments.</p>`
                      : html`
                          <ul class="small">
                            ${observation.assessments.map(
                              (assessment) => html`
                                <li>
                                  ${assessment.dimension} v${String(assessment.version)} ·
                                  ${assessmentBadge(assessment.label)} ·
                                  ${assessment.reviewer}${assessment.attributionRole === null ? '' : ` · ${assessment.attributionRole}`}
                                  <div>${assessment.rationale}</div>
                                </li>
                              `,
                            )}
                          </ul>
                        `
                  }
                </section>
              `,
            )}
          </article>
        `,
      )}
    </div>
  `;
}

function comparisonSection(snapshot: ReportSnapshot): Html {
  if (snapshot.comparisons.length === 0) {
    return html`<p class="muted">No comparisons are available.</p>`;
  }
  return html`
    <div class="stack">
      ${snapshot.comparisons.map(
        (comparison) => html`
          <article class="card">
            <h3>Run ${comparison.runId}</h3>
            <p>
              ${comparison.comparable ? 'Comparable under the recorded conditions.' : 'Not comparable.'}
            </p>
            <ul class="small">
              ${comparison.reasons.map((reason) => html`<li>${reason}</li>`)}
            </ul>
            ${
              comparison.metricDeltas.length === 0
                ? ''
                : html`
                    <div class="table-wrap">
                      <table>
                        <caption>
                          Descriptive deltas; association is not causation.
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">Metric</th>
                            <th scope="col">Current</th>
                            <th scope="col">Prior</th>
                            <th scope="col">Delta</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${comparison.metricDeltas.map(
                            (delta) => html`
                              <tr>
                                <th scope="row">${delta.label}</th>
                                <td class="numeric">${formatPercent(delta.current)}</td>
                                <td class="numeric">${formatPercent(delta.prior)}</td>
                                <td class="numeric">
                                  ${delta.delta === null ? 'Not available' : `${(delta.delta * 100).toFixed(1)} pp`}
                                </td>
                              </tr>
                            `,
                          )}
                        </tbody>
                      </table>
                    </div>
                  `
            }
          </article>
        `,
      )}
    </div>
  `;
}

export function renderReport(
  snapshot: ReportSnapshot,
  options: { supersededByReportId?: string | null } = {},
): Html {
  return html`
    <article class="report">
      <header class="card">
        <p class="report-meta">
          Report #${snapshot.report.number} · ${snapshot.report.title} · generated
          ${formatDateTime(snapshot.report.generatedAt)}
        </p>
        ${
          options.supersededByReportId === null || options.supersededByReportId === undefined
            ? ''
            : html`<div class="notice" role="status">
                This report has been superseded by report ${options.supersededByReportId}. Its
                snapshot remains unchanged for audit.
              </div>`
        }
        <h1>${snapshot.report.title}</h1>
        <p class="lede">${snapshot.scope.subject}</p>
        <dl class="definition-list">
          ${definitionRow('Methodology', html`${snapshot.report.methodologyVersion}`)}
          ${definitionRow('Metrics', html`${snapshot.report.metricsVersion}`)}
          ${definitionRow('Evidence rule', html`${snapshot.report.evidenceRuleVersion}`)}
          ${definitionRow('Template', html`${snapshot.templateVersion}`)}
        </dl>
        <nav aria-label="Report sections" class="report-actions">
          <a class="button button-small" href="#scope">Scope</a>
          <a class="button button-small" href="#method">Method</a>
          <a class="button button-small" href="#coverage">Coverage</a>
          <a class="button button-small" href="#claims">Claims</a>
          <a class="button button-small" href="#audits">HTML audits</a>
          <a class="button button-small" href="#runs">Runs</a>
          <a class="button button-small" href="#comparisons">Change over time</a>
          <a class="button button-small" href="#remediation">Next steps</a>
          <a class="button button-small" href="#limitations">Limitations</a>
        </nav>
      </header>

      <section class="report-section" id="scope">
        <h2>1. Scope</h2>
        <p>${snapshot.scope.authorization}</p>
        <dl class="definition-list">
          ${definitionRow('Project', html`${snapshot.project.name}`)}
          ${definitionRow('Target entity', html`${snapshot.targetEntity?.canonicalName ?? 'Not set'}`)}
          ${definitionRow('Primary domain', html`${snapshot.project.primaryDomain ?? 'Not recorded'}`)}
          ${definitionRow('Created', html`${formatDateTime(snapshot.project.createdAt)}`)}
        </dl>
        <p class="small muted">Exclusions:</p>
        <ul class="small">
          ${snapshot.scope.exclusions.map((exclusion) => html`<li>${exclusion}</li>`)}
        </ul>
      </section>

      <section class="report-section" id="method">
        <h2>2. Method</h2>
        <ul class="small">
          <li><strong>Answer source:</strong> ${snapshot.methodology.answerSource}</li>
          <li>
            <strong>Evidence aggregation:</strong> ${snapshot.methodology.evidenceAggregation}
          </li>
          <li>
            <strong>Metric definitions:</strong> ${snapshot.methodology.metricDefinitionsVersion}
          </li>
          <li>
            <strong>Query-set versions:</strong>
            ${snapshot.methodology.querySetVersions.join('; ') || 'None'}
          </li>
          <li>
            <strong>HTML audit versions:</strong>
            ${snapshot.methodology.websiteAuditVersions.join('; ') || 'None'}
          </li>
        </ul>
        <p class="small muted">
          No provider integration was called. Provider, model, and interface labels are
          operator-supplied. Evidence relationship classifications are human-recorded judgments.
        </p>
      </section>

      <section class="report-section" id="coverage">
        <h2>3. Coverage</h2>
        <dl class="stat-grid">
          <div class="stat">
            <dt>Claims</dt>
            <dd>${snapshot.coverage.claims}</dd>
          </div>
          <div class="stat">
            <dt>Propositions</dt>
            <dd>${snapshot.coverage.propositions}</dd>
          </div>
          <div class="stat">
            <dt>Sources</dt>
            <dd>${snapshot.coverage.sources}</dd>
          </div>
          <div class="stat">
            <dt>Evidence items</dt>
            <dd>${snapshot.coverage.evidenceItems}</dd>
          </div>
          <div class="stat">
            <dt>Relationships</dt>
            <dd>${snapshot.coverage.evidenceRelationships}</dd>
          </div>
          <div class="stat">
            <dt>Finalized runs</dt>
            <dd>${snapshot.coverage.finalizedRuns}</dd>
          </div>
          <div class="stat">
            <dt>Open runs</dt>
            <dd>${snapshot.coverage.openRuns}</dd>
          </div>
          <div class="stat">
            <dt>Cancelled runs</dt>
            <dd>${snapshot.coverage.cancelledRuns}</dd>
          </div>
          <div class="stat">
            <dt>Observations</dt>
            <dd>${snapshot.coverage.observations}</dd>
          </div>
          <div class="stat">
            <dt>HTML audits</dt>
            <dd>${snapshot.coverage.websiteAudits}</dd>
          </div>
          <div class="stat">
            <dt>Unassessed props</dt>
            <dd>${snapshot.coverage.unassessedPropositions}</dd>
          </div>
          <div class="stat">
            <dt>No-proposition claims</dt>
            <dd>${snapshot.coverage.claimsWithoutPropositions}</dd>
          </div>
        </dl>
        <p class="small muted">
          Open and cancelled runs are counted but contribute no metrics. Unassessed dimensions
          remain unknown.
        </p>
      </section>

      <section class="report-section" id="claims">
        <h2>4. Claims and evidence</h2>
        ${claimSection(snapshot)}
      </section>

      <section class="report-section" id="audits">
        <h2>5. Website and HTML discoverability</h2>
        <p class="small muted">
          Only supplied HTML was analysed. Network-dependent checks were unavailable, not passed.
        </p>
        ${auditSection(snapshot)}
        ${
          snapshot.unavailableChecks.length === 0
            ? ''
            : html`
                <h3>Unavailable checks in this report</h3>
                <ul class="unavailable-list">
                  ${snapshot.unavailableChecks.map((check) => html`<li><strong>${check.label}</strong>: ${check.reason}</li>`)}
                </ul>
              `
        }
      </section>

      <section class="report-section" id="runs">
        <h2>6. Manual AI answer runs and metrics</h2>
        ${runSection(snapshot)}
      </section>

      <section class="report-section" id="comparisons">
        <h2>7. Change over time</h2>
        <p class="small muted">
          Comparisons are shown only for finalized runs with the same query-set version and declared
          provider configuration. Deltas are descriptive and do not establish causation.
        </p>
        ${comparisonSection(snapshot)}
      </section>

      <section class="report-section" id="remediation">
        <h2>8. Suggested next steps</h2>
        <p class="small muted">
          Suggestions are derived only from recorded gaps, findings, and limitations. They are not
          claims that a change will cause any provider behavior.
        </p>
        ${
          snapshot.remediation.length === 0
            ? html`<p class="muted">No specific next steps were derived.</p>`
            : html`
                <div class="table-wrap">
                  <table>
                    <caption>
                      Remediation suggestions derived from recorded evidence and findings
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">Priority</th>
                        <th scope="col">Action</th>
                        <th scope="col">Rationale</th>
                        <th scope="col">Related</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${snapshot.remediation.map(
                        (item) => html`
                          <tr>
                            <td>
                              ${statusBadge(item.priority, item.priority === 'HIGH' ? 'warn' : item.priority === 'MEDIUM' ? 'neutral' : 'neutral')}
                            </td>
                            <td>${item.action}</td>
                            <td>${item.rationale}</td>
                            <td class="mono">${item.relatedType}:${item.relatedId}</td>
                          </tr>
                        `,
                      )}
                    </tbody>
                  </table>
                </div>
              `
        }
      </section>

      <section class="report-section" id="limitations">
        <h2>9. Limitations</h2>
        <ul>
          ${snapshot.limitations.map((limitation) => html`<li>${limitation}</li>`)}
        </ul>
        <p class="small muted">
          Audit events recorded at snapshot time: ${snapshot.audit.eventCount}; latest
          ${formatDateTime(snapshot.audit.lastEventAt)}.
        </p>
        <p class="small muted">
          This report is one snapshot. Aporia makes no guarantee about provider indexing, caching,
          memory, ranking, recommendation, or future citation.
        </p>
      </section>
    </article>
  `;
}
