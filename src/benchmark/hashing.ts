/**
 * Canonical content hashing for benchmark artifacts (ADR-026, extended in ADR-027).
 *
 * This is a leaf module so the review workflow, the batch planner and the release manifest all hash values
 * identically without importing one another. A hash here is an **integrity check over recorded content**:
 * it detects that a file changed. It authenticates no reviewer, proves no independence, and says nothing
 * about whether the material is genuine.
 *
 * Pure and offline — `node:crypto` only, no clock and no filesystem.
 */
import { createHash } from 'node:crypto';

/**
 * Recursively sort object keys so a hash depends on content, not on serialisation order.
 *
 * Ordering is by UTF-16 code unit, **not** `localeCompare`. A locale-aware comparison is what an ICU build
 * does, and two machines — or the same machine under a different `LANG` — can order the same key set
 * differently. Hashes are the basis of release reproducibility, so an ordering that varies with the
 * execution environment would let one corpus yield two manifests. Code-unit ordering is defined by the
 * string itself and is identical on Windows, Linux and macOS.
 */
export function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
      .map(([key, inner]) => [key, canonicalise(inner)]);
    return Object.fromEntries(entries);
  }
  return value;
}

/** A stable, key-order-independent content hash (SHA-256 hex) of any JSON value. */
export function contentHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalise(value)), 'utf8')
    .digest('hex');
}

/** A content hash is only meaningful if it is compared as produced; this is the canonical shape. */
const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** True when a value is a lowercase SHA-256 hex digest, as every hash in this repository is written. */
export function isContentHash(value: unknown): value is string {
  return typeof value === 'string' && CONTENT_HASH_PATTERN.test(value);
}
