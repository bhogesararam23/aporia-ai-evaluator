/**
 * Deterministic regression scoring (ADR-020).
 *
 * Aporia's evaluator contains exactly one automatic judgement: the `evidence-aggregation-v1` rule
 * over relationships a human already recorded. Everything else — statement fidelity, citation
 * support, and attribution — is a human assessment that the software stores and counts but never
 * makes. So the regression section can only detect a software change in the deterministic rule and
 * in the metric formulas, and it says so rather than pretending to validate the rest.
 *
 * This distinction is the point of the harness. A human-judgement dimension whose gold label
 * disagrees with the reviewer consensus is a methodology finding, never a code bug.
 */
import { deriveEvidenceStatus, type EvidenceRelationshipRecord } from '../core/evidence.ts';
import { computeRunMetrics, type ObservationInput, type QueryInput } from '../core/metrics.ts';
import type { BenchmarkCase, BenchmarkDimension, RegressionResultRow } from './types.ts';

/** Dimensions whose value the software itself produces. */
export const DETERMINISTIC_DIMENSIONS: readonly BenchmarkDimension[] = ['EVIDENCE_SUPPORT'];

/** Dimensions that exist only as recorded human judgement, so no code change can alter them. */
export const HUMAN_JUDGEMENT_DIMENSIONS: readonly BenchmarkDimension[] = [
  'ANSWER_FIDELITY',
  'CITATION_SUPPORT',
  'ATTRIBUTION',
];

const RELATION_SET = new Set([
  'SUPPORTS',
  'CONTRADICTS',
  'QUALIFIES',
  'CONTEXTUALIZES',
  'DOES_NOT_ADDRESS',
  'UNAVAILABLE',
]);

const SOURCE_TYPE_SET = new Set([
  'PRIMARY_ARTIFACT',
  'REPRODUCIBLE_RESULT',
  'INDEPENDENT_SOURCE',
  'SECONDARY_REPORT',
  'SELF_PUBLISHED',
  'UNATTRIBUTED',
  'OTHER',
]);

const INDEPENDENCE_SET = new Set(['INDEPENDENT', 'SELF_PUBLISHED', 'RELATED', 'UNKNOWN']);

function toRelationships(benchmarkCase: BenchmarkCase, propositionId: string) {
  const proposition = benchmarkCase.input.propositions.find((row) => row.id === propositionId);
  if (proposition === undefined) {
    return null;
  }
  const records: EvidenceRelationshipRecord[] = [];
  for (const evidence of proposition.evidence) {
    if (
      !RELATION_SET.has(evidence.relation) ||
      !SOURCE_TYPE_SET.has(evidence.sourceType) ||
      !INDEPENDENCE_SET.has(evidence.independence)
    ) {
      // An unknown vocabulary value is a case-authoring failure, not a rule failure. The validator
      // catches it earlier; this guard keeps the scorer from inventing a status.
      continue;
    }
    records.push({
      id: evidence.id,
      relation: evidence.relation as EvidenceRelationshipRecord['relation'],
      sourceId: evidence.id,
      sourceType: evidence.sourceType as EvidenceRelationshipRecord['sourceType'],
      independence: evidence.independence as EvidenceRelationshipRecord['independence'],
    });
  }
  return records;
}

/**
 * Run the current deterministic implementations over a case's frozen input pack and return the
 * label each produced, keyed as `DIMENSION:subjectId`.
 */
export function produceDeterministicLabels(benchmarkCase: BenchmarkCase): Map<string, string> {
  const produced = new Map<string, string>();
  for (const proposition of benchmarkCase.input.propositions) {
    const relationships = toRelationships(benchmarkCase, proposition.id);
    if (relationships === null) {
      continue;
    }
    produced.set(`EVIDENCE_SUPPORT:${proposition.id}`, deriveEvidenceStatus(relationships).status);
  }
  return produced;
}

/**
 * A metrics-formula regression check. The case may declare expected metric counts, and the current
 * formulas are run over the case's statements to see whether the arithmetic moved. A change here is
 * a code regression, because the definitions are fixed by the metrics document.
 */
export interface ExpectedMetricCount {
  readonly metricId: string;
  readonly numerator: number | null;
  readonly denominator: number;
}

export function produceMetricCounts(benchmarkCase: BenchmarkCase): ExpectedMetricCount[] {
  const queries: QueryInput[] = [{ id: 'qry_1', intent: 'OTHER' }];
  const observations: ObservationInput[] =
    benchmarkCase.input.answerText === null
      ? []
      : [
          {
            id: 'obs_1',
            queryId: 'qry_1',
            status: 'COMPLETED',
            voided: false,
            citationCapture: benchmarkCase.input.citationCapture as 'CAPTURED',
            citations: benchmarkCase.input.citations.map((citation) => ({
              id: citation.id,
              targetOwned: false,
              voided: !citation.supportsStatement,
            })),
            assessments: [],
          },
        ];
  const metrics = computeRunMetrics({
    runStatus: 'FINALIZED',
    queries,
    observations,
    claims: benchmarkCase.input.statements.map((statement) => ({
      claimId: statement.id,
      observationId: 'obs_1',
      revisionId: `${statement.id}.1`,
      relevance: statement.relevance,
      voided: false,
      fidelityLabel: undefined,
      attributionLabel: undefined,
      citationMappings: statement.citationIds
        .map((citationId) =>
          benchmarkCase.input.citations.find((citation) => citation.id === citationId),
        )
        .filter((citation) => citation !== undefined)
        .map((citation) => ({
          citationId: citation.id,
          support: citation.supportsStatement ? 'SUPPORTS' : 'DOES_NOT_SUPPORT',
          // A benchmark case records the material a reviewer read; nothing in the v1 contract can
          // express a withdrawn citation, so the deterministic run reads every citation as live.
          citationVoided: false,
        })),
      propositionRelations: statement.propositionIds.map((propositionId) => ({
        propositionId,
        relation: 'SUPPORTS_TARGET',
      })),
    })),
  });
  const rows: ExpectedMetricCount[] = [];
  for (const metric of [
    metrics.claimLevel?.decompositionCoverage,
    metrics.claimLevel?.claimFidelityRate,
    metrics.claimLevel?.claimCitationSupportRate,
  ]) {
    if (metric !== undefined) {
      rows.push({
        metricId: metric.id,
        numerator: metric.numerator,
        denominator: metric.denominator,
      });
    }
  }
  return rows;
}

/**
 * Compare the deterministic outputs against the recorded gold labels. Expected labels on
 * human-judgement dimensions are reported in the methodology section instead, and are never turned
 * into a software-failure count.
 */
export function regressionResults(cases: readonly BenchmarkCase[]): RegressionResultRow[] {
  const rows: RegressionResultRow[] = [];
  for (const benchmarkCase of cases) {
    const produced = produceDeterministicLabels(benchmarkCase);
    for (const expected of benchmarkCase.expected) {
      if (!DETERMINISTIC_DIMENSIONS.includes(expected.dimension)) {
        continue;
      }
      const key = `${expected.dimension}:${expected.subjectId}`;
      const value = produced.get(key);
      rows.push({
        caseId: benchmarkCase.id,
        dimension: expected.dimension,
        subjectId: expected.subjectId,
        expected: expected.label,
        produced: value ?? 'NOT_PRODUCED',
        matched: value === expected.label,
        component: 'evidence-aggregation-v1',
      });
    }
  }
  return rows;
}

export function regressionLimitations(): readonly string[] {
  return [
    'Only the evidence-aggregation rule and the metric formulas are deterministic in this build. Fidelity, citation support, and attribution are human assessments the software stores but never makes, so no code change can alter them and a disagreement there is a methodology finding, not a regression.',
    'A mismatch here is a candidate software regression. It is not evidence that the evaluator is inaccurate: accuracy requires a human-reviewed gold corpus, which is a separate input.',
    'No provider call is made and no answer is generated. A case carries only material a reviewer already captured and recorded.',
  ];
}
