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

/** The deepest nesting the canonicaliser will traverse; see `canonicalise` for why there is a bound. */
export const MAX_CANONICAL_DEPTH = 64;

/** Thrown when a value is nested past the depth the canonicaliser will traverse. */
export class DepthExceededError extends Error {
  readonly limit: number;

  constructor(limit: number) {
    super(`Content is nested deeper than ${String(limit)} levels and cannot be canonicalised.`);
    this.name = 'DepthExceededError';
    this.limit = limit;
  }
}

/**
 * Recursively sort object keys so a hash depends on content, not on serialisation order.
 *
 * Ordering is by UTF-16 code unit, **not** `localeCompare`. A locale-aware comparison is what an ICU build
 * does, and two machines — or the same machine under a different `LANG` — can order the same key set
 * differently. Hashes are the basis of release reproducibility, so an ordering that varies with the execution
 * environment would let one corpus yield two manifests. Code-unit ordering is defined by the string itself and
 * is identical on Windows, Linux and macOS.
 *
 * No real artifact nests more than a handful of levels, but `contentHash` is also called on operator- and
 * attacker-supplied JSON, so the traversal is bounded: without a limit a deeply nested document would exhaust
 * the call stack and surface as a `RangeError` in the middle of a run — the one failure mode a validator or CLI
 * is supposed to turn into a stated refusal. It throws a named error rather than substituting a placeholder,
 * because collapsing two different deep subtrees to one marker would make them hash identically, and a hash
 * that can collide is worse than a hash that refuses.
 */
export function canonicalise(value: unknown, depth = 0): unknown {
  if (depth > MAX_CANONICAL_DEPTH) {
    throw new DepthExceededError(MAX_CANONICAL_DEPTH);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalise(entry, depth + 1));
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([left], [right]) => (left === right ? 0 : left < right ? -1 : 1))
      .map(([key, inner]) => [key, canonicalise(inner, depth + 1)]);
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

/**
 * SHA-256 of exact text, as read.
 *
 * `contentHash` answers "is this the same content, however it happened to be serialised?". This answers the
 * different question a run receipt needs: "are these the same bytes?" — so a manifest or a report file that
 * was edited after the fact is caught even when its content still parses. Both are integrity checks over
 * recorded material, and neither authenticates a reviewer, proves material is genuine, or supports an
 * accuracy claim.
 */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Whether a value nests deeper than `limit`, checked without building anything.
 *
 * Lets a validator refuse an over-deep document cheaply, before hashing or serialisation, and with a stated
 * reason instead of an exception from the middle of a walk.
 */
export function nestsDeeperThan(value: unknown, limit: number, depth = 0): boolean {
  if (depth > limit) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => nestsDeeperThan(entry, limit, depth + 1));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some((entry) => nestsDeeperThan(entry, limit, depth + 1));
  }
  return false;
}

/** True when a value is a lowercase SHA-256 hex digest, as every hash in this repository is written. */
export function isContentHash(value: unknown): value is string {
  return typeof value === 'string' && CONTENT_HASH_PATTERN.test(value);
}
