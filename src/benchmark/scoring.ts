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
  AnnotationSummary,
  BenchmarkAdjudication,
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
 * The adjudication that settles one (dimension, subject) pair.
 *
 * A v2 case scopes each adjudication explicitly. A v1 case carries one unscoped record, which is
 * honoured only when the case disagrees on exactly one subject — otherwise a single decision would
 * settle disputes it never named.
 */
function adjudicationFor(
  benchmarkCase: BenchmarkCase,
  dimension: BenchmarkDimension,
  subjectId: string,
  disagreementCount: number,
): BenchmarkAdjudication | undefined {
  const scoped = benchmarkCase.adjudications?.find(
    (entry) => entry.dimension === dimension && entry.subjectId === subjectId,
  );
  if (scoped !== undefined) {
    return scoped;
  }
  const legacy = benchmarkCase.adjudication;
  if (legacy === undefined || legacy === null || disagreementCount !== 1) {
    return undefined;
  }
  return {
    dimension,
    subjectId,
    outcome: legacy.outcome,
    // A v1 record names no settled label, so a resolved v1 adjudication cannot become a gold label;
    // the pair is reported as resolved-without-a-value and stays out of any accuracy summary.
    label: null,
    reason: legacy.reason,
    adjudicatedBy: legacy.adjudicatedBy,
  };
}

/**
 * Reviewer-to-reviewer agreement, one row per labelled subject.
 *
 * Four things used to be wrong here. A subject with one reviewer was skipped, so a corpus of single
 * opinions looked like a corpus of agreements; the same reviewer writing twice counted as two
 * reviewers; one case-level adjudication settled every disagreement in that case; and disagreement
 * with no adjudication was invisible outside a single count. Now every pair is reported with a status
 * that says which kind it is, `NOT_ENOUGH_REVIEWERS` included.
 *
 * Agreement between two operator-asserted names is still not proof of independent review.
 */
export function agreementRows(cases: readonly BenchmarkCase[]): AgreementRow[] {
  const rows: AgreementRow[] = [];
  for (const benchmarkCase of cases) {
    const grouped = new Map<string, { reviewers: string[]; labels: string[] }>();
    for (const label of benchmarkCase.reviewerLabels ?? []) {
      const key = `${label.dimension}:${label.subjectId}`;
      const entry = grouped.get(key) ?? { reviewers: [], labels: [] };
      entry.reviewers.push(label.reviewer);
      entry.labels.push(label.label);
      grouped.set(key, entry);
    }
    const gold = new Map<string, string>();
    for (const expected of benchmarkCase.expected ?? []) {
      gold.set(`${expected.dimension}:${expected.subjectId}`, expected.label);
    }
    const disagreementCount = [...grouped.values()].filter(
      (entry) => new Set(entry.labels).size > 1,
    ).length;

    for (const [key, entry] of grouped) {
      const [dimension, subjectId] = key.split(':');
      if (dimension === undefined || subjectId === undefined) {
        continue;
      }
      const distinctReviewers = [...new Set(entry.reviewers)];
      const distinctLabels = [...new Set(entry.labels)].sort();
      const unanimous = distinctLabels.length === 1;
      const adjudication = unanimous
        ? undefined
        : adjudicationFor(
            benchmarkCase,
            dimension as BenchmarkDimension,
            subjectId,
            disagreementCount,
          );
      let status: AgreementRow['status'];
      if (distinctReviewers.length < 2) {
        // One reviewer is one opinion. Calling it agreement is how a solo note becomes a consensus.
        status = 'NOT_ENOUGH_REVIEWERS';
      } else if (unanimous) {
        status = 'UNANIMOUS';
      } else if (adjudication?.outcome === 'GENUINELY_AMBIGUOUS') {
        status = 'GENUINELY_AMBIGUOUS';
      } else if (adjudication?.outcome === 'RESOLVED') {
        status = 'RESOLVED_BY_ADJUDICATION';
      } else {
        status = 'UNRESOLVED';
      }
      rows.push({
        caseId: benchmarkCase.id,
        dimension: dimension as BenchmarkDimension,
        subjectId,
        reviewers: distinctReviewers.sort(),
        labels: entry.labels,
        unanimous,
        status,
        adjudicatedLabel:
          status === 'RESOLVED_BY_ADJUDICATION' ? (adjudication?.label ?? null) : null,
        goldLabel: gold.get(key) ?? null,
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
  return rows.filter((row) => row.status === 'UNRESOLVED').length;
}

/** Disagreements a genuine ambiguity settled, which must never be scored as an ordinary gold label. */
export function ambiguousSubjects(rows: readonly AgreementRow[]): number {
  return rows.filter((row) => row.status === 'GENUINELY_AMBIGUOUS').length;
}

/** Subjects carrying fewer than two distinct reviewers, so no agreement claim can be made about them. */
export function soloReviewedSubjects(rows: readonly AgreementRow[]): number {
  return rows.filter((row) => row.status === 'NOT_ENOUGH_REVIEWERS').length;
}

/**
 * The pairs that can enter an annotation-agreement summary.
 *
 * A subject is eligible only when a defensible value exists: reviewers unanimous, or an adjudication
 * that named a label. Unresolved and genuinely-ambiguous subjects are excluded from the rate and
 * counted separately — excluding them is not the same as hiding them, because the row still carries
 * every reviewer label and the reason.
 */
export function annotatableRows(rows: readonly AgreementRow[]): AgreementRow[] {
  return rows.filter((row) => {
    if (row.status === 'UNANIMOUS') {
      return true;
    }
    return row.status === 'RESOLVED_BY_ADJUDICATION' && row.adjudicatedLabel !== null;
  });
}

/**
 * Annotation agreement, per dimension.
 *
 * A subject counts only when a defensible value exists for it: reviewers unanimous, or an adjudication
 * that named both the subject and the settled label. Everything else is excluded from the rate **and
 * counted in the open**, which is the difference between an honest subtotal and a flattering one. The
 * v0.3 harness took the alphabetically first reviewer label as a "consensus" and folded those pairs
 * into the same accuracy figure as deterministic software output; there is no such step here.
 */
export function annotationSummaries(
  rows: readonly AgreementRow[],
  dimensions: readonly BenchmarkDimension[],
): AnnotationSummary[] {
  return dimensions.map((dimension) => {
    const scoped = rows.filter((row) => row.dimension === dimension);
    const withGold = scoped.filter((row) => row.goldLabel !== null);
    const singleReviewer = scoped.filter((row) => row.status === 'NOT_ENOUGH_REVIEWERS').length;
    const unresolved = scoped.filter((row) => row.status === 'UNRESOLVED').length;
    const ambiguous = scoped.filter((row) => row.status === 'GENUINELY_AMBIGUOUS').length;
    const adjudicatedNoLabel = scoped.filter(
      (row) => row.status === 'RESOLVED_BY_ADJUDICATION' && row.adjudicatedLabel === null,
    ).length;
    const scorable = withGold.filter(
      (row) =>
        row.status === 'UNANIMOUS' ||
        (row.status === 'RESOLVED_BY_ADJUDICATION' && row.adjudicatedLabel !== null),
    );
    const settledValue = (row: AgreementRow): string =>
      row.status === 'RESOLVED_BY_ADJUDICATION'
        ? (row.adjudicatedLabel ?? '')
        : (row.labels[0] ?? '');
    const agreeing = scorable.filter((row) => settledValue(row) === row.goldLabel).length;
    return {
      dimension,
      subjects: scoped.length,
      scorable: scorable.length,
      agreeingWithGold: agreeing,
      agreementRate: scorable.length === 0 ? null : agreeing / scorable.length,
      excludedUnresolved: unresolved,
      excludedAmbiguous: ambiguous,
      excludedSingleReviewer: singleReviewer,
      excludedNoGoldLabel: scoped.length - withGold.length,
      excludedAdjudicatedWithoutLabel: adjudicatedNoLabel,
      note: 'Human annotation agreement over subjects with a defensible settled value. Not a software measure and not evaluator accuracy: reviewer identity is operator-asserted, and an excluded subject is counted here rather than dropped.',
    };
  });
}

export function dimensionLabel(dimension: BenchmarkDimension): string {
  return BENCHMARK_DIMENSION_LABELS[dimension];
}
