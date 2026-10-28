import type { MetricResult } from '../core/metrics.ts';
import type { ReportObservationAssessmentInput, ReportRunView, ReportSnapshot } from './types.ts';

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '""';
  }
  let text = String(value);
  if (FORMULA_PREFIX.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

function csvLine(values: readonly (string | number | null | undefined)[]): string {
  return `${values.map(csvCell).join(',')}\n`;
}

function formatValue(value: number | null): string {
  return value === null ? '' : value.toFixed(6);
}

function metricRows(run: ReportRunView): MetricResult[] {
  return [
    run.metrics.mentionRate,
    run.metrics.targetSourceCitationRate,
    run.metrics.anySourceCitationRate,
    run.metrics.citationSupportRate,
    run.metrics.claimFidelityRate,
    run.metrics.attributionCorrectnessRate,
    run.metrics.observedAnswerCoverage,
  ];
}

export function metricsCsv(snapshot: ReportSnapshot): string {
  let output = csvLine([
    'run_id',
    'run_name',
    'provider_label',
    'model_label',
    'interface_label',
    'grounding_mode',
    'locale',
    'region',
    'query_set_name',
    'query_set_version',
    'metric_id',
    'metric_label',
    'unit',
    'numerator',
    'denominator',
    'value',
    'exclusions',
    'definition',
    'notes',
  ]);
  for (const run of snapshot.runs) {
    for (const metric of metricRows(run)) {
      output += csvLine([
        run.id,
        run.name,
        run.providerLabel,
        run.modelLabel,
        run.interfaceLabel,
        run.groundingMode,
        run.locale,
        run.region,
        run.querySetName,
        run.querySetVersion,
        metric.id,
        metric.label,
        metric.unit,
        metric.numerator,
        metric.denominator,
        formatValue(metric.value),
        metric.exclusions.map((exclusion) => `${exclusion.reason}:${exclusion.count}`).join('; '),
        metric.definition,
        metric.notes.join(' '),
      ]);
    }
  }
  return output;
}

function latestAssessments(
  assessments: readonly ReportObservationAssessmentInput[],
): ReportObservationAssessmentInput[] {
  const latest = new Map<string, ReportObservationAssessmentInput>();
  for (const assessment of assessments) {
    const current = latest.get(assessment.dimension);
    if (current === undefined || assessment.version > current.version) {
      latest.set(assessment.dimension, assessment);
    }
  }
  return [...latest.values()].sort((left, right) => left.dimension.localeCompare(right.dimension));
}

export function findingsCsv(snapshot: ReportSnapshot): string {
  let output = csvLine([
    'record_type',
    'record_id',
    'context',
    'classification',
    'title',
    'observation',
    'action_or_rationale',
    'locator',
  ]);
  for (const claim of snapshot.claims) {
    for (const proposition of claim.propositions) {
      output += csvLine([
        'PROPOSITION_CONCLUSION',
        proposition.id,
        `claim ${claim.id} · revision ${claim.currentRevision?.revisionNumber ?? 'none'}`,
        proposition.primaryConclusion.status,
        proposition.text,
        proposition.primaryConclusion.rationale,
        `${proposition.primaryConclusion.method} · ${proposition.primaryConclusion.reviewer ?? 'no reviewer'}${proposition.disagreement ? ' · human/rule disagreement' : ''}`,
        `proposition:${proposition.id}`,
      ]);
      for (const row of proposition.evidence) {
        output += csvLine([
          'EVIDENCE_RELATIONSHIP',
          row.relationship.id,
          `proposition ${proposition.id}`,
          row.active ? row.relationship.relation : `SUPERSEDED_${row.relationship.relation}`,
          row.source.title,
          row.evidence.excerpt,
          row.relationship.rationale,
          row.evidence.locator,
        ]);
      }
    }
  }
  for (const run of snapshot.runs) {
    for (const observation of run.observations) {
      for (const assessment of latestAssessments(observation.assessments)) {
        output += csvLine([
          'OBSERVATION_ASSESSMENT',
          observation.id,
          `${run.providerLabel} · ${observation.queryTextSnapshot}`,
          assessment.dimension,
          assessment.label,
          assessment.rationale,
          `${assessment.reviewer}${assessment.attributionRole === null ? '' : ` · role ${assessment.attributionRole}`}`,
          `observation:${observation.id} · ${assessment.createdAt}`,
        ]);
      }
    }
  }
  for (const audit of snapshot.websiteAudits) {
    for (const finding of audit.findings) {
      output += csvLine([
        'WEBSITE_FINDING',
        audit.id,
        audit.label,
        finding.severity,
        finding.title,
        finding.observation,
        finding.recommendation,
        finding.locator,
      ]);
    }
    for (const check of audit.unavailableChecks) {
      output += csvLine([
        'UNAVAILABLE_CHECK',
        audit.id,
        audit.label,
        'UNAVAILABLE',
        check.label,
        check.reason,
        'Not performed',
        check.code,
      ]);
    }
  }
  return output;
}

export function reportJson(snapshot: ReportSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export function observationsCsv(snapshot: ReportSnapshot): string {
  let output = csvLine([
    'run_id',
    'run_name',
    'provider_label',
    'model_label',
    'interface_label',
    'grounding_mode',
    'locale',
    'region',
    'query_ordinal',
    'query_text',
    'observation_status',
    'eligibility',
    'captured_at',
    'citation_capture',
    'answer_text',
    'error_note',
    'context_notes',
    'citations',
    'latest_assessments',
    'voided_at',
    'void_reason',
  ]);
  for (const run of snapshot.runs) {
    for (const observation of run.observations) {
      const citations = observation.citations
        .map(
          (citation) =>
            `${String(citation.position)}|${citation.url}|${citation.title ?? ''}|${citation.targetOwned ? 'target-owned' : 'third-party'}|${citation.voidedAt === null ? 'active' : 'voided'}`,
        )
        .join('; ');
      const assessments = latestAssessments(observation.assessments)
        .map((assessment) => `${assessment.dimension}:${assessment.label}`)
        .join('; ');
      output += csvLine([
        run.id,
        run.name,
        run.providerLabel,
        run.modelLabel,
        run.interfaceLabel,
        run.groundingMode,
        run.locale,
        run.region,
        observation.queryOrdinal,
        observation.queryTextSnapshot,
        observation.status,
        observation.statusEligibility,
        observation.capturedAt,
        observation.citationCapture,
        observation.answerText,
        observation.errorNote,
        observation.contextNotes,
        citations,
        assessments,
        observation.voidedAt,
        observation.voidReason,
      ]);
    }
  }
  return output;
}
