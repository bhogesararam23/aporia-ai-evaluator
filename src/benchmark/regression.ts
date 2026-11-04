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
import {
  EVIDENCE_RELATIONS,
  SOURCE_INDEPENDENCE,
  SOURCE_TYPES,
  type EvidenceRelation,
  type SourceIndependence,
  type SourceType,
} from '../core/vocabulary.ts';
import { deriveEvidenceStatus, type EvidenceRelationshipRecord } from '../core/evidence.ts';
import { EVIDENCE_RULE_VERSION, EVIDENCE_RULE_VERSION_V2 } from '../core/versions.ts';
import { computeRunMetrics, type ObservationInput, type QueryInput } from '../core/metrics.ts';
import { permittedPropositionRelations } from '../core/claimEligibility.ts';
import type {
  BenchmarkCase,
  BenchmarkDimension,
  BenchmarkEvidenceRecord,
  EvidenceRuleRow,
  RegressionResultRow,
} from './types.ts';

/** Dimensions whose value the software itself produces. */
export const DETERMINISTIC_DIMENSIONS: readonly BenchmarkDimension[] = ['EVIDENCE_SUPPORT'];

/** Dimensions that exist only as recorded human judgement, so no code change can alter them. */
export const HUMAN_JUDGEMENT_DIMENSIONS: readonly BenchmarkDimension[] = [
  'ANSWER_FIDELITY',
  'CITATION_SUPPORT',
  'ATTRIBUTION',
];

const RELATION_SET = new Set<string>(EVIDENCE_RELATIONS);
const SOURCE_TYPE_SET = new Set<string>(SOURCE_TYPES);
const INDEPENDENCE_SET = new Set<string>(SOURCE_INDEPENDENCE);

/**
 * The `evidence-aggregation-v1` input for one proposition, plus anything the case recorded that the
 * rule cannot read.
 *
 * `unusable` is returned rather than swallowed. Under the v1 contract the scorer silently dropped an
 * evidence record whose vocabulary did not match, the proposition lost all its relationships, the
 * rule produced `NOT_ASSESSED`, and a case authored with garbage still "passed" against a
 * `NOT_ASSESSED` gold label. A dropped record is now visible at every layer that reads the result.
 */
export interface PropositionRelationships {
  readonly relationships: EvidenceRelationshipRecord[];
  readonly unusable: readonly BenchmarkEvidenceRecord[];
}

/**
 * Map benchmark evidence onto the core relationship record.
 *
 * The underlying source identity comes from `sourceId`, which `benchmark-case-v2` requires. A v1 case
 * has none, and the relationship id stands in — which makes every excerpt its own source and leaves
 * the duplicate-and-syndication rule unreachable. That fallback is reported as `contract: v1` in the
 * harness output rather than presented as a test of shared sources.
 */
export function toRelationships(
  benchmarkCase: BenchmarkCase,
  propositionId: string,
): PropositionRelationships | null {
  const proposition = benchmarkCase.input.propositions.find((row) => row.id === propositionId);
  if (proposition === undefined) {
    return null;
  }
  const relationships: EvidenceRelationshipRecord[] = [];
  const unusable: BenchmarkEvidenceRecord[] = [];
  for (const evidence of proposition.evidence) {
    if (
      !RELATION_SET.has(evidence.relation) ||
      !SOURCE_TYPE_SET.has(evidence.sourceType) ||
      !INDEPENDENCE_SET.has(evidence.independence)
    ) {
      // The validator refuses this pairing before scoring. Reaching here means a caller skipped it,
      // so the record is collected and reported rather than dropped.
      unusable.push(evidence);
      continue;
    }
    relationships.push({
      id: evidence.id,
      relation: evidence.relation as EvidenceRelation,
      sourceId: evidence.sourceId ?? evidence.id,
      sourceType: evidence.sourceType as SourceType,
      independence: evidence.independence as SourceIndependence,
      canonicalUri: evidence.canonicalUri ?? null,
    });
  }
  return { relationships, unusable };
}

/**
 * Run the current deterministic implementations over a case's frozen input pack and return the
 * label each produced, keyed as `DIMENSION:subjectId`.
 */
export function produceDeterministicLabels(benchmarkCase: BenchmarkCase): Map<string, string> {
  const produced = new Map<string, string>();
  for (const proposition of benchmarkCase.input.propositions) {
    const mapped = toRelationships(benchmarkCase, proposition.id);
    if (mapped === null) {
      continue;
    }
    produced.set(
      `EVIDENCE_SUPPORT:${proposition.id}`,
      deriveEvidenceStatus(mapped.relationships).status,
    );
  }
  return produced;
}

/**
 * Score each proposition's evidence under both evidence-aggregation rules, separately.
 *
 * This is the version-aware half of the harness: for every proposition it runs the frozen evidence
 * through `evidence-aggregation-v1` and `evidence-aggregation-v2` and records the produced verdict
 * **and** the corroborating-source count for each. Where the case carries an EVIDENCE_SUPPORT gold
 * label for that proposition, `statusMatched` says whether each rule reproduced it; a v1/v2
 * disagreement, or a differing corroboration count, is then visible as itself rather than hidden
 * behind a single number. It changes no product behaviour: the application's default rule is still
 * whatever `EVIDENCE_RULE_VERSION` says, and `v2` remains the ADR-025 proposal.
 */
export function evidenceRuleRegressions(cases: readonly BenchmarkCase[]): EvidenceRuleRow[] {
  const rows: EvidenceRuleRow[] = [];
  for (const benchmarkCase of cases) {
    for (const proposition of benchmarkCase.input.propositions) {
      const mapped = toRelationships(benchmarkCase, proposition.id);
      if (mapped === null || mapped.relationships.length === 0) {
        continue;
      }
      const gold = benchmarkCase.expected.find(
        (expected) =>
          expected.dimension === 'EVIDENCE_SUPPORT' && expected.subjectId === proposition.id,
      )?.label;
      for (const ruleVersion of [EVIDENCE_RULE_VERSION, EVIDENCE_RULE_VERSION_V2]) {
        const derived = deriveEvidenceStatus(mapped.relationships, ruleVersion);
        rows.push({
          caseId: benchmarkCase.id,
          propositionId: proposition.id,
          ruleVersion,
          expected: gold ?? null,
          produced: derived.status,
          statusMatched: gold === undefined ? false : derived.status === gold,
          supportingSourceCount: derived.supportingSourceCount,
          apparentCorroboratingSourceCount: derived.apparentCorroboratingSourceCount ?? null,
        });
      }
    }
  }
  return rows;
}

/**
 * The relation a statement of this relevance may record, taken from the product's own table.
 *
 * `NOT_ASSESSABLE_TARGET` is the fallback for a relevance outside the vocabulary: the harness must not
 * invent a relationship the contract would refuse.
 */
function firstPermittedRelation(relevance: string): string {
  const permitted = permittedPropositionRelations(relevance as never);
  return permitted[0] ?? 'NOT_ASSESSABLE_TARGET';
}

/** Evidence records across a corpus that the deterministic rule could not read. */
export function unusableEvidenceRecords(cases: readonly BenchmarkCase[]): {
  readonly caseId: string;
  readonly propositionId: string;
  readonly evidence: BenchmarkEvidenceRecord;
}[] {
  const rows: {
    readonly caseId: string;
    readonly propositionId: string;
    readonly evidence: BenchmarkEvidenceRecord;
  }[] = [];
  for (const benchmarkCase of cases) {
    for (const proposition of benchmarkCase.input.propositions) {
      const mapped = toRelationships(benchmarkCase, proposition.id);
      for (const evidence of mapped?.unusable ?? []) {
        rows.push({ caseId: benchmarkCase.id, propositionId: proposition.id, evidence });
      }
    }
  }
  return rows;
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
            // Read as recorded. Casting every value to `CAPTURED` made the inaccessible-and-
            // unavailable stratum measure as if the metadata had been captured, which is the opposite
            // of what the case declares.
            citationCapture: benchmarkCase.input
              .citationCapture as ObservationInput['citationCapture'],
            citations: benchmarkCase.input.citations.map((citation) => ({
              id: citation.id,
              targetOwned: false,
              // `voided` is the reviewer withdrawing the cited record. It is not the same statement as
              // "the material does not support the answer", which is `supportsStatement: false`.
              voided: citation.voided === true,
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
          citationVoided: citation.voided === true,
        })),
      // The relation comes from the case's own relevance, through the same table the product uses.
      // Hard-coding `SUPPORTS_TARGET` for every statement meant an unrelated statement entered the
      // omission denominator, and the harness never exercised the pairing at all.
      propositionRelations: statement.propositionIds.map((propositionId) => ({
        propositionId,
        relation: firstPermittedRelation(statement.relevance),
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
