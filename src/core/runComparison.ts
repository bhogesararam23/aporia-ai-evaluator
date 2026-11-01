/**
 * Longitudinal run comparability (ADR-021).
 *
 * This is the only place that decides whether two evaluation runs may be compared. The report and the
 * retest workflow both read it, because two implementations of the same rule would eventually
 * disagree and one of them would start calling an incomparable pair a trend.
 */

export interface ComparableConfiguration {
  readonly querySetId: string;
  readonly providerLabel: string;
  readonly modelLabel: string | null;
  readonly interfaceLabel: string;
  readonly groundingMode: string;
  readonly locale: string;
  readonly region: string | null;
}

/**
 * Each broken condition is returned as its own sentence rather than a boolean, because "not
 * comparable" is only useful to an operator if it says which condition changed and what was recorded.
 *
 * The pair is passed by name, not by position. Every sentence reads "X then, Y now", so two
 * positional arguments of the same type would let a caller swap the chronology and print a true
 * statement about the wrong direction of time.
 */
export interface ConfigurationComparison {
  readonly prior: ComparableConfiguration;
  readonly current: ComparableConfiguration;
}

export function comparabilityReasons({ prior, current }: ConfigurationComparison): string[] {
  const reasons: string[] = [];
  if (prior.querySetId !== current.querySetId) {
    reasons.push('The runs used different query-set versions, so they asked different questions.');
  }
  if (prior.providerLabel !== current.providerLabel) {
    reasons.push(
      `The provider label differs: "${prior.providerLabel}" then, "${current.providerLabel}" now.`,
    );
  }
  if (prior.modelLabel !== current.modelLabel) {
    reasons.push(
      `The model or version label differs: "${prior.modelLabel ?? 'not recorded'}" then, "${current.modelLabel ?? 'not recorded'}" now.`,
    );
  }
  if (prior.interfaceLabel !== current.interfaceLabel) {
    reasons.push(
      `The interface label differs: "${prior.interfaceLabel}" then, "${current.interfaceLabel}" now.`,
    );
  }
  if (prior.groundingMode !== current.groundingMode) {
    reasons.push(
      `The search or grounding mode differs: ${prior.groundingMode} then, ${current.groundingMode} now.`,
    );
  }
  if (prior.locale !== current.locale) {
    reasons.push(`The locale differs: ${prior.locale} then, ${current.locale} now.`);
  }
  if (prior.region !== current.region) {
    reasons.push(
      `The region differs: ${prior.region ?? 'not recorded'} then, ${current.region ?? 'not recorded'} now.`,
    );
  }
  return reasons;
}

export function isComparable(pair: ConfigurationComparison): boolean {
  return comparabilityReasons(pair).length === 0;
}

/**
 * Why a statement-level delta must not be read as a trend.
 *
 * A change in how thoroughly a reviewer decomposed the answers looks identical to a change in the
 * answers unless it is called out, so a claim-level comparison is only offered when both sides
 * decomposed a matching proportion of their eligible answers.
 */
export function claimComparisonNote(input: {
  readonly priorObservations: number;
  readonly priorDecomposed: number;
  readonly currentObservations: number;
  readonly currentDecomposed: number;
}): string | null {
  if (input.priorDecomposed === 0 || input.currentDecomposed === 0) {
    return 'Statement-level metrics are not compared: one side has no recorded answer statements, so any difference would describe the decomposition, not the answer.';
  }
  const priorRate = input.priorDecomposed / Math.max(input.priorObservations, 1);
  const currentRate = input.currentDecomposed / Math.max(input.currentObservations, 1);
  if (priorRate === currentRate) {
    return null;
  }
  return `Statement-level metrics are reported but not compared as a trend: ${String(input.priorDecomposed)} of ${String(input.priorObservations)} eligible answer(s) were decomposed earlier versus ${String(input.currentDecomposed)} of ${String(input.currentObservations)} now.`;
}

/**
 * The single sentence every comparison carries. A before/after pair is an association; the conditions
 * that could have changed sit outside this tool's view, and no website edit is proven to have moved
 * an answer.
 */
export const CAUSAL_BOUNDARY =
  'A difference between two captured observations is an association, not a cause. Provider, model, interface, retrieval, prompt-interpretation and environmental conditions may have changed between the captures, and Aporia observed none of them. Nothing here can show that a website change made an AI answer better or worse.';

/** Outcome vocabulary for a retest comparison. */
export type ComparisonDirection = 'IMPROVED' | 'UNCHANGED' | 'REGRESSED';

/**
 * Whether a larger value of a metric is good, bad, or not a verdict at all.
 *
 * A contradiction rate and an omission rate improve by falling. Comparing them with the same
 * assumption as a mention rate would tell an operator that a worse answer had got better. A
 * decomposition coverage is not an answer property either: it records how much review was done.
 */
export type MetricPolarity = 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER' | 'CONTEXT';

const LOWER_IS_BETTER_METRICS: readonly string[] = [
  'answer_statement_contradiction_rate',
  'answer_statement_unsupported_rate',
  'relevant_omission_rate',
];

const CONTEXT_METRICS: readonly string[] = ['answer_decomposition_coverage'];

export function polarityOf(metricId: string): MetricPolarity {
  if (CONTEXT_METRICS.includes(metricId)) {
    return 'CONTEXT';
  }
  if (LOWER_IS_BETTER_METRICS.includes(metricId)) {
    return 'LOWER_IS_BETTER';
  }
  return 'HIGHER_IS_BETTER';
}

/**
 * Decide a comparison outcome from one metric's before and after values.
 *
 * `null` means a side had no eligible unit, which is not a zero and cannot be ranked. Any metric that
 * cannot be ranked turns the whole outcome to `UNABLE_TO_VERIFY` rather than being ignored, so a
 * missing measurement never masquerades as an improvement.
 */
export function directionFor(
  prior: number | null,
  current: number | null,
  higherIsBetter = true,
): ComparisonDirection | 'UNABLE_TO_VERIFY' {
  if (prior === null || current === null) {
    return 'UNABLE_TO_VERIFY';
  }
  if (prior === current) {
    return 'UNCHANGED';
  }
  const improved = higherIsBetter ? current > prior : current < prior;
  return improved ? 'IMPROVED' : 'REGRESSED';
}

/**
 * Direction for a stored row, including the case where ranking would be a lie.
 *
 * `NOT_A_VERDICT` is the honest reading of a context metric moving: the difference is real, and it
 * describes the review rather than the answer.
 */
export type RowDirection = ComparisonDirection | 'UNABLE_TO_VERIFY' | 'NOT_A_VERDICT';

export function rowDirection(
  prior: number | null,
  current: number | null,
  metricId: string,
): RowDirection {
  const polarity = polarityOf(metricId);
  if (polarity === 'CONTEXT') {
    return 'NOT_A_VERDICT';
  }
  return directionFor(prior, current, polarity === 'HIGHER_IS_BETTER');
}

export interface MetricComparisonRow {
  readonly metricId: string;
  readonly label: string;
  readonly unit: string;
  readonly polarity: MetricPolarity;
  readonly prior: number | null;
  readonly current: number | null;
  readonly priorNumerator: number | null;
  readonly priorDenominator: number;
  readonly currentNumerator: number | null;
  readonly currentDenominator: number;
  readonly delta: number | null;
  readonly direction: RowDirection;
}

/**
 * Compare two runs metric by metric. Only named metrics are considered, and the set is fixed here so
 * a new metric cannot silently widen what a stored comparison claims to have measured.
 */
export function compareMetrics(
  prior: Readonly<Record<string, MetricSnapshotInput>>,
  current: Readonly<Record<string, MetricSnapshotInput>>,
  metricIds: readonly string[],
): MetricComparisonRow[] {
  const rows: MetricComparisonRow[] = [];
  for (const metricId of metricIds) {
    const before = prior[metricId];
    const after = current[metricId];
    if (before === undefined || after === undefined) {
      continue;
    }
    rows.push({
      metricId,
      label: after.label,
      unit: after.unit,
      polarity: polarityOf(metricId),
      prior: before.value,
      current: after.value,
      priorNumerator: before.numerator,
      priorDenominator: before.denominator,
      currentNumerator: after.numerator,
      currentDenominator: after.denominator,
      delta: before.value === null || after.value === null ? null : after.value - before.value,
      direction: rowDirection(before.value, after.value, metricId),
    });
  }
  return rows;
}

export interface MetricSnapshotInput {
  readonly label: string;
  readonly unit: string;
  readonly value: number | null;
  readonly numerator: number | null;
  readonly denominator: number;
}

/**
 * Collapse compared rows into one finding outcome.
 *
 * The chosen metric is the one the finding was about, so a single named measure decides the status.
 * An unavailable comparison, or a pair that could not be ranked, becomes `UNABLE_TO_VERIFY`.
 */
export function outcomeFromComparison(
  comparable: boolean,
  rows: readonly MetricComparisonRow[],
  focusMetricId: string,
): 'IMPROVED' | 'UNCHANGED' | 'REGRESSED' | 'UNABLE_TO_VERIFY' | 'NOT_COMPARABLE' {
  if (!comparable) {
    return 'NOT_COMPARABLE';
  }
  const focus = rows.find((row) => row.metricId === focusMetricId);
  // A context metric carries no verdict, and a metric one side never produced carries no measurement.
  // Neither may read as an improvement.
  if (focus === undefined || focus.direction === 'NOT_A_VERDICT') {
    return 'UNABLE_TO_VERIFY';
  }
  return focus.direction;
}

/**
 * Metric identifiers a retest may be centred on. Kept small and explicit on purpose.
 *
 * `answer_decomposition_coverage` is deliberately absent: it measures how much of the answer a
 * reviewer broke into statements, so letting a finding be "about" it would read extra review effort
 * as progress on the answer.
 */
export const FOCUS_METRICS = [
  'mention_rate',
  'target_source_citation_rate',
  'any_source_citation_rate',
  'citation_support_rate',
  'claim_fidelity_rate',
  'attribution_correctness_rate',
  'observed_answer_coverage',
  'answer_statement_fidelity_rate',
  'answer_statement_contradiction_rate',
  'answer_statement_unsupported_rate',
  'answer_statement_citation_support_rate',
  'answer_statement_attribution_rate',
  'relevant_omission_rate',
] as const;
export type FocusMetric = (typeof FOCUS_METRICS)[number];

/** Every metric a stored comparison carries, focusable or not. */
export const COMPARISON_METRICS = [...FOCUS_METRICS, 'answer_decomposition_coverage'] as const;

export function isFocusMetric(value: string): value is FocusMetric {
  return (FOCUS_METRICS as readonly string[]).includes(value);
}

export function focusMetricLabel(
  metric: FocusMetric,
  labels: Readonly<Record<string, string>>,
): string {
  return labels[metric] ?? metric;
}
