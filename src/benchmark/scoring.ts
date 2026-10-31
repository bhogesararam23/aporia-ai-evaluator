/**
 * Benchmark scoring (ADR-020).
 *
 * Two distinct questions are answered here and never merged:
 *   - did the current software produce the label a human recorded (regression), and
 *   - do the human labels agree with each other (methodology).
 *
 * A measure is only computed over what the corpus actually contains. A single-class dimension gets
 * `null` macro-F1 with a stated reason rather than a number that would look like a result.
 */
import type {
  AgreementRow,
  BenchmarkCase,
  BenchmarkDimension,
  ConfusionCell,
  DimensionScore,
  LabelScoreRow,
  RegressionResultRow,
} from './types.ts';
import { BENCHMARK_DIMENSION_LABELS } from './types.ts';

export interface ScoredPair {
  readonly caseId: string;
  readonly dimension: BenchmarkDimension;
  readonly subjectId: string;
  readonly expected: string;
  readonly predicted: string;
  readonly component: string;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function f1Of(precision: number | null, recall: number | null): number | null {
  if (precision === null || recall === null) {
    return null;
  }
  const sum = precision + recall;
  if (sum === 0) {
    return null;
  }
  return (2 * precision * recall) / sum;
}

/**
 * Per-label precision, recall, F1 and support for one dimension.
 *
 * A label that no gold example uses is reported with `support: 0` and `null` measures rather than
 * `0` precision, because zero precision would claim the evaluator produced a wrong label when it
 * never produced that label at all.
 */
export function scoreDimension(pairs: readonly ScoredPair[]): DimensionScore {
  const labels = [
    ...new Set([...pairs.map((pair) => pair.expected), ...pairs.map((pair) => pair.predicted)]),
  ].sort();

  const rows: LabelScoreRow[] = labels.map((label) => {
    const support = pairs.filter((pair) => pair.expected === label).length;
    const predicted = pairs.filter((pair) => pair.predicted === label).length;
    const truePositive = pairs.filter(
      (pair) => pair.expected === label && pair.predicted === label,
    ).length;
    const precision = ratio(truePositive, predicted);
    const recall = ratio(truePositive, support);
    return {
      label,
      support,
      predicted,
      truePositive,
      precision,
      recall,
      f1: f1Of(precision, recall),
    };
  });

  const correct = pairs.filter((pair) => pair.expected === pair.predicted).length;
  const withSupport = rows.filter((row) => row.support > 0);
  const missing = rows.filter((row) => row.support === 0);
  let macroF1: number | null = null;
  let macroF1Reason: string | null = null;
  if (pairs.length === 0) {
    macroF1Reason = 'No scored pair exists for this dimension.';
  } else if (labels.length < 2) {
    macroF1Reason =
      'Only one label appears in this dimension, so a macro average over classes is not meaningful.';
  } else if (missing.length > 0) {
    macroF1Reason = `${missing.length} label(s) have no gold example, so macro-F1 would silently exclude them. Report per-label recall instead.`;
  } else {
    const values = withSupport
      .map((row) => row.f1)
      .filter((value): value is number => value !== null);
    macroF1 =
      values.length === withSupport.length && values.length > 0
        ? sum(values) / values.length
        : null;
    if (macroF1 === null) {
      macroF1Reason = 'At least one class has neither precision nor recall computable.';
    }
  }

  const actualLabels = [...new Set(pairs.map((entry) => entry.expected))].sort();
  const predictedLabels = [...new Set(pairs.map((entry) => entry.predicted))].sort();
  const confusion: ConfusionCell[] = [];
  let confusionSuppressedReason: string | null = null;
  if (actualLabels.length < 2 || predictedLabels.length < 2) {
    confusionSuppressedReason =
      'A confusion matrix needs at least two labels on each axis; this dimension has fewer.';
  } else {
    for (const actual of actualLabels) {
      for (const predicted of predictedLabels) {
        const count = pairs.filter(
          (pair) => pair.expected === actual && pair.predicted === predicted,
        ).length;
        if (count > 0) {
          confusion.push({ actual, predicted, count });
        }
      }
    }
  }

  const notes: string[] = [];
  if (pairs.length > 0 && pairs.length <= 5) {
    notes.push(
      `Only ${pairs.length} pair(s) were scored in this dimension. Treat the figures as illustrative, not as an accuracy claim.`,
    );
  }
  notes.push(
    'Aggregate accuracy alone is inadequate here: a rare but costly failure can disappear in a favourable average.',
  );

  return {
    dimension: pairs[0]?.dimension ?? 'EVIDENCE_SUPPORT',
    scored: pairs.length,
    correct,
    accuracy: ratio(correct, pairs.length),
    labels: rows,
    macroF1,
    macroF1Reason,
    confusion,
    confusionSuppressedReason,
    notes,
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Group scored pairs by dimension so each dimension is reported on its own terms. */
export function scoreByDimension(
  pairs: readonly ScoredPair[],
  dimensions: readonly BenchmarkDimension[],
): DimensionScore[] {
  return dimensions
    .map((dimension) => {
      const forDimension = pairs.filter((pair) => pair.dimension === dimension);
      if (forDimension.length === 0) {
        return null;
      }
      const score = scoreDimension(forDimension);
      return { ...score, dimension };
    })
    .filter((score): score is DimensionScore => score !== null);
}

/**
 * Turn expected-versus-produced differences into named regression candidates. Every mismatch names
 * the component that produced the value, so a software regression can be separated from a
 * methodology disagreement without re-reading the case.
 */
export function regressionRows(
  cases: readonly BenchmarkCase[],
  produced: (benchmarkCase: BenchmarkCase) => Map<string, string>,
): RegressionResultRow[] {
  const rows: RegressionResultRow[] = [];
  for (const benchmarkCase of cases) {
    const producedLabels = produced(benchmarkCase);
    for (const expected of benchmarkCase.expected) {
      const key = `${expected.dimension}:${expected.subjectId}`;
      const value = producedLabels.get(key);
      if (value === undefined) {
        rows.push({
          caseId: benchmarkCase.id,
          dimension: expected.dimension,
          subjectId: expected.subjectId,
          expected: expected.label,
          produced: 'NOT_PRODUCED',
          matched: false,
          component: componentOf(expected.dimension),
        });
        continue;
      }
      rows.push({
        caseId: benchmarkCase.id,
        dimension: expected.dimension,
        subjectId: expected.subjectId,
        expected: expected.label,
        produced: value,
        matched: value === expected.label,
        component: componentOf(expected.dimension),
      });
    }
  }
  return rows;
}

function componentOf(dimension: BenchmarkDimension): string {
  switch (dimension) {
    case 'EVIDENCE_SUPPORT':
      return 'evidence-aggregation-v1';
    case 'ANSWER_FIDELITY':
      return 'claim-level fidelity assessment';
    case 'CITATION_SUPPORT':
      return 'claim-citation mapping assessment';
    case 'ATTRIBUTION':
      return 'claim-level attribution assessment';
  }
}

/**
 * Reviewer-to-reviewer agreement. Computed only where a subject carries two or more reviewer labels,
 * and a disagreement with no recorded adjudication is reported as UNRESOLVED rather than smoothed
 * into the gold label.
 */
export function agreementRows(cases: readonly BenchmarkCase[]): AgreementRow[] {
  const rows: AgreementRow[] = [];
  for (const benchmarkCase of cases) {
    const grouped = new Map<string, { reviewers: string[]; labels: string[] }>();
    for (const label of benchmarkCase.reviewerLabels) {
      const key = `${label.dimension}:${label.subjectId}`;
      const entry = grouped.get(key) ?? { reviewers: [], labels: [] };
      entry.reviewers.push(label.reviewer);
      entry.labels.push(label.label);
      grouped.set(key, entry);
    }
    for (const [key, entry] of grouped) {
      const [dimension, subjectId] = key.split(':');
      if (dimension === undefined || subjectId === undefined) {
        continue;
      }
      if (entry.reviewers.length < 2) {
        continue;
      }
      const unanimous = new Set(entry.labels).size === 1;
      const adjudication = unanimous
        ? 'NOT_APPLICABLE'
        : (benchmarkCase.adjudication?.outcome ?? 'UNRESOLVED');
      rows.push({
        caseId: benchmarkCase.id,
        dimension: dimension as BenchmarkDimension,
        subjectId,
        reviewers: entry.reviewers,
        labels: entry.labels,
        unanimous,
        adjudication,
      });
    }
  }
  return rows.sort(
    (left, right) =>
      left.caseId.localeCompare(right.caseId) ||
      left.dimension.localeCompare(right.dimension) ||
      left.subjectId.localeCompare(right.subjectId),
  );
}

export function unresolvedDisagreements(rows: readonly AgreementRow[]): number {
  return rows.filter((row) => row.adjudication === 'UNRESOLVED').length;
}

export function dimensionLabel(dimension: BenchmarkDimension): string {
  return BENCHMARK_DIMENSION_LABELS[dimension];
}
