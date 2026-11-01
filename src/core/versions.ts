export const METHODOLOGY_VERSION = 'methodology-2026-10-28';
export const EVIDENCE_RULE_VERSION = 'evidence-aggregation-v1';
export const METRICS_VERSION = 'metrics-v3';
/** Historical versions retained for interpreting stored report snapshots (ADR-019). */
export const METRICS_VERSION_V1 = 'metrics-v1';
export const METRICS_VERSION_V2 = 'metrics-v2';
/** Every metrics version this build knows how to render. A stored snapshot is never recomputed. */
export const KNOWN_METRICS_VERSIONS = [
  METRICS_VERSION_V1,
  METRICS_VERSION_V2,
  METRICS_VERSION,
] as const;
export const DECOMPOSITION_VERSION = 'manual-decomposition-v1';
export const OBSERVATION_SCHEMA_VERSION = 'manual-observation-v1';
