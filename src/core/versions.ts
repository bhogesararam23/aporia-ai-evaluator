export const METHODOLOGY_VERSION = 'methodology-2026-10-28';
export const EVIDENCE_RULE_VERSION = 'evidence-aggregation-v1';
export const METRICS_VERSION = 'metrics-v4';
/** Historical versions retained for interpreting stored report snapshots (ADR-019, ADR-023). */
export const METRICS_VERSION_V1 = 'metrics-v1';
export const METRICS_VERSION_V2 = 'metrics-v2';
export const METRICS_VERSION_V3 = 'metrics-v3';
/**
 * Every metrics version this build knows how to render. A stored snapshot is never recomputed.
 *
 * `metrics-v4` changed which statements are eligible for a factual denominator, so a v3 snapshot's
 * figures are read as stored rather than recalculated: recalculating them under the new rule would
 * silently rewrite what a previous report claimed.
 */
export const KNOWN_METRICS_VERSIONS = [
  METRICS_VERSION_V1,
  METRICS_VERSION_V2,
  METRICS_VERSION_V3,
  METRICS_VERSION,
] as const;
/** Versions from `metrics-v3` onward carry a statement-level block at all. */
export const CLAIM_LEVEL_METRICS_VERSIONS = [METRICS_VERSION_V3, METRICS_VERSION] as const;
export const DECOMPOSITION_VERSION = 'manual-decomposition-v1';
export const OBSERVATION_SCHEMA_VERSION = 'manual-observation-v1';
