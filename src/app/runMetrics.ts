import {
  computeRunMetrics,
  type ObservationAssessmentInput,
  type RunMetrics,
} from '../core/metrics.ts';
import type { RunDetail } from '../persistence/repositories/runs.ts';
import type {
  AttributionLabel,
  CitationSupportLabel,
  FidelityLabel,
  PresenceLabel,
} from '../core/vocabulary.ts';

function assessmentInputs(
  observation: RunDetail['observations'][number],
): ObservationAssessmentInput[] {
  return observation.assessments.map((assessment) => {
    switch (assessment.dimension) {
      case 'PRESENCE':
        return {
          dimension: 'PRESENCE',
          version: assessment.version,
          label: assessment.label as PresenceLabel,
        };
      case 'FIDELITY':
        return {
          dimension: 'FIDELITY',
          version: assessment.version,
          label: assessment.label as FidelityLabel,
        };
      case 'CITATION_SUPPORT':
        return {
          dimension: 'CITATION_SUPPORT',
          version: assessment.version,
          label: assessment.label as CitationSupportLabel,
        };
      case 'ATTRIBUTION':
        return {
          dimension: 'ATTRIBUTION',
          version: assessment.version,
          label: assessment.label as AttributionLabel,
        };
      default:
        throw new Error('Unsupported assessment dimension.');
    }
  });
}

export function computeMetricsForRun(detail: RunDetail): RunMetrics {
  return computeRunMetrics({
    runStatus: detail.run.status,
    queries: detail.querySet.queries.map((query) => ({ id: query.id, intent: query.intent })),
    observations: detail.observations.map((observation) => ({
      id: observation.id,
      queryId: observation.queryId,
      status: observation.status,
      voided: observation.voidedAt !== null,
      citationCapture: observation.citationCapture,
      citations: observation.citations.map((citation) => ({
        id: citation.id,
        targetOwned: citation.targetOwned,
        voided: citation.voidedAt !== null,
      })),
      assessments: assessmentInputs(observation),
    })),
  });
}
