/**
 * Deterministic benchmark report (ADR-020).
 *
 * The report is built from the corpus content only: no timestamp, no random ordering, no filesystem
 * path. Running it twice over the same corpus yields identical bytes, which is what makes a stored
 * report a checkable artifact rather than a screenshot of a run.
 */
import { EVIDENCE_RULE_VERSION, METHODOLOGY_VERSION, METRICS_VERSION } from '../core/versions.ts';
import { BENCHMARK_CASE_VERSION, BENCHMARK_STRATUM_LABELS } from './types.ts';
import type {
  AgreementRow,
  BenchmarkCase,
  BenchmarkCorpusValidation,
  DimensionScore,
  RegressionResultRow,
} from './types.ts';
import {
  HUMAN_JUDGEMENT_DIMENSIONS,
  produceMetricCounts,
  regressionLimitations,
  type ExpectedMetricCount,
} from './regression.ts';
import { BENCHMARK_LIMITS } from './validate.ts';

export const BENCHMARK_REPORT_VERSION = 'benchmark-report-v1';

export interface CorpusDigest {
  readonly caseCount: number;
  readonly digest: string;
  readonly bytes: number;
}

export interface MetricRegressionRow {
  readonly caseId: string;
  readonly metricId: string;
  readonly expectedNumerator: number | null;
  readonly producedNumerator: number | null;
  readonly expectedDenominator: number;
  readonly producedDenominator: number;
  readonly matched: boolean;
}

export interface BenchmarkReport {
  readonly version: string;
  readonly caseFormat: string;
  readonly methodologyVersion: string;
  readonly metricsVersion: string;
  readonly evidenceRuleVersion: string;
  readonly corpus: {
    readonly caseCount: number;
    readonly invalidCount: number;
    readonly strataPresent: readonly { readonly stratum: string; readonly label: string }[];
    readonly strataMissing: readonly { readonly stratum: string; readonly label: string }[];
    readonly digests: readonly CorpusDigest[];
    readonly limits: { readonly maxCases: number; readonly maxCaseBytes: number };
  };
  readonly regression: {
    readonly scored: number;
    readonly mismatches: readonly RegressionResultRow[];
    readonly metricChecks: readonly MetricRegressionRow[];
    readonly humanJudgementDimensions: readonly string[];
    readonly limitations: readonly string[];
  };
  readonly methodology: {
    readonly dimensions: readonly DimensionScore[];
    readonly agreement: readonly AgreementRow[];
    readonly unresolvedDisagreements: number;
    readonly reviewerIdentityNote: string;
  };
  readonly statement: {
    readonly accuracyClaimable: boolean;
    readonly reason: string;
    readonly generalisation: string;
    readonly statistics: string;
  };
  readonly cases: readonly {
    readonly id: string;
    readonly stratum: string;
    readonly dimensions: readonly string[];
    readonly reviewerCount: number;
    readonly limitations: readonly string[];
  }[];
}

function stratumEntries(values: readonly string[]) {
  return values.map((stratum) => ({
    stratum,
    label: BENCHMARK_STRATUM_LABELS[stratum as keyof typeof BENCHMARK_STRATUM_LABELS] ?? stratum,
  }));
}

/**
 * A stable digest of one case, computed from its serialised form with keys in declaration order. Two
 * corpora that differ in any scored or provenance field produce different digests, so a report names
 * the exact corpus it describes.
 */
export function caseDigest(benchmarkCase: BenchmarkCase): string {
  const canonical = JSON.stringify(benchmarkCase);
  // A small FNV-1a-64 over the canonical text. It is not a security hash; it identifies the exact
  // case content a report was produced from, which is all a reproducibility note needs.
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= BigInt(canonical.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

function metricChecks(cases: readonly BenchmarkCase[]): MetricRegressionRow[] {
  const rows: MetricRegressionRow[] = [];
  for (const benchmarkCase of cases) {
    const produced: ExpectedMetricCount[] = produceMetricCounts(benchmarkCase);
    const declared = new Map<string, ExpectedMetricCount>();
    for (const expected of benchmarkCase.expected) {
      if (expected.dimension !== 'EVIDENCE_SUPPORT' || !expected.subjectId.startsWith('metric:')) {
        continue;
      }
      // A metric expectation encodes "metricId:numerator:denominator" in its subject id.
      const [, metricId, numerator, denominator] = expected.subjectId.split(':');
      if (metricId === undefined || denominator === undefined) {
        continue;
      }
      declared.set(metricId, {
        metricId,
        numerator: numerator === 'null' ? null : Number(numerator),
        denominator: Number(denominator),
      });
    }
    for (const [metricId, expected] of declared) {
      const actual = produced.find((row) => row.metricId === metricId);
      rows.push({
        caseId: benchmarkCase.id,
        metricId,
        expectedNumerator: expected.numerator,
        producedNumerator: actual?.numerator ?? null,
        expectedDenominator: expected.denominator,
        producedDenominator: actual?.denominator ?? 0,
        matched:
          actual !== undefined &&
          actual.numerator === expected.numerator &&
          actual.denominator === expected.denominator,
      });
    }
  }
  return rows;
}

export function buildBenchmarkReport(
  validation: BenchmarkCorpusValidation,
  regression: readonly RegressionResultRow[],
  dimensions: readonly DimensionScore[],
  agreement: readonly AgreementRow[],
  digests: readonly CorpusDigest[],
): BenchmarkReport {
  const mismatches = regression.filter((row) => !row.matched);
  const scored = validation.caseCount;
  const unresolved = agreement.filter((row) => row.adjudication === 'UNRESOLVED').length;
  const accuracyClaimable = false;
  return {
    version: BENCHMARK_REPORT_VERSION,
    caseFormat: BENCHMARK_CASE_VERSION,
    methodologyVersion: METHODOLOGY_VERSION,
    metricsVersion: METRICS_VERSION,
    evidenceRuleVersion: EVIDENCE_RULE_VERSION,
    corpus: {
      caseCount: scored,
      invalidCount: validation.issues.length,
      strataPresent: stratumEntries(validation.strataPresent),
      strataMissing: stratumEntries(validation.strataMissing),
      digests,
      limits: {
        maxCases: BENCHMARK_LIMITS.maxCases,
        maxCaseBytes: BENCHMARK_LIMITS.maxCaseBytes,
      },
    },
    regression: {
      scored: regression.length,
      mismatches,
      metricChecks: metricChecks(validation.cases),
      humanJudgementDimensions: [...HUMAN_JUDGEMENT_DIMENSIONS],
      limitations: regressionLimitations(),
    },
    methodology: {
      dimensions,
      agreement,
      unresolvedDisagreements: unresolved,
      reviewerIdentityNote:
        'Reviewer identifiers in a case file are operator-asserted labels. Local core has no authentication, so agreement between two labels is not proof of independent review.',
    },
    statement: {
      accuracyClaimable,
      reason:
        scored === 0
          ? 'The corpus holds no valid case, so no accuracy claim of any kind is supportable.'
          : 'A framework producing numbers over a small purposive corpus is not a validated accuracy result. Accuracy requires a corpus whose provenance, authorisation, and human review are demonstrable, and a stated sampling method.',
      generalisation:
        'Results describe the cases supplied. They do not extend to other providers, models, languages, regions, or future provider behaviour.',
      statistics:
        'No confidence interval, calibration, or significance test is computed. Sample sizes here are too small and too selective to justify one.',
    },
    cases: validation.cases.map((benchmarkCase) => ({
      id: benchmarkCase.id,
      stratum: benchmarkCase.stratum,
      dimensions: [...new Set(benchmarkCase.expected.map((expected) => expected.dimension))].sort(),
      reviewerCount: new Set(benchmarkCase.reviewerLabels.map((label) => label.reviewer)).size,
      limitations: benchmarkCase.limitations,
    })),
  };
}

/**
 * Serialise the report with keys in a fixed order. Determinism is a property of the artifact, not a
 * nicety: a report whose bytes drift between runs cannot be compared across versions.
 */
export function serialiseBenchmarkReport(report: BenchmarkReport): string {
  return `${JSON.stringify(sortKeys(report), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === 'object' && value !== null) {
    const entries: [string, unknown][] = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, inner]) => [key, sortKeys(inner)]);
    return Object.fromEntries(entries);
  }
  return value;
}
