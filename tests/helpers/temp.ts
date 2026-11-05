/**
 * A throwaway directory for filesystem tests, removed whatever the test asserts.
 *
 * `tests/integration/benchmark-cli.test.ts` grew its own; the v0.8 corpus-I/O, publication and lifecycle
 * tests all need the same thing, and three copies of a cleanup helper is how a leaked temporary directory
 * gets forgotten in the suite that needs it least.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface ScratchDirectory {
  readonly path: string;
  readonly remove: () => void;
}

export function scratchDirectory(prefix = 'aporia-scratch-'): ScratchDirectory {
  const path = mkdtempSync(join(tmpdir(), prefix));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}
