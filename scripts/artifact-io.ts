/**
 * Atomic, refuse-by-default publication of benchmark artifacts (v0.8).
 *
 * Every artifact this tool writes is something a later run verifies: a report, a release manifest, a canonical
 * case, a blinded packet, a corpus snapshot. Before v0.8 they were written with plain `writeFileSync`, which
 * truncates the destination *before* writing it. A probe proved the consequence twice over — a pre-existing
 * report and a pre-existing release manifest were both destroyed with no warning, and an interruption in the
 * middle of a large one would have left a partial file at the exact path the next verification reads.
 *
 * Two rules follow from that, and both are the owner's decision recorded in ADR-028:
 *
 * 1. **Never overwrite silently.** An existing target is refused, naming the digest it holds, until the
 *    operator asks for `--overwrite` — at which point the replaced digest is reported rather than hidden.
 * 2. **Never leave a half-written artifact.** Each file is written beside its target and renamed over it
 *    (atomic on Windows, Linux and macOS), and a directory batch stages everything first so a failure partway
 *    through is rolled back instead of left as a corpus that silently lost a file.
 *
 * All filesystem access stays in `scripts/`; `src/benchmark/**` remains pure.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

import { contentHash, sha256Hex } from '../src/benchmark/hashing.ts';
import { unsafeIdReason } from '../src/benchmark/naming.ts';
import type { StagedFile } from '../src/benchmark/batch.ts';

export type ArtifactWriteKind = 'exists' | 'name' | 'target' | 'contents' | 'io';

export class ArtifactWriteError extends Error {
  readonly kind: ArtifactWriteKind;
  readonly path: string;
  /** The digest of what was already there, when there was something. Never a guess. */
  readonly existingSha256: string | null;

  constructor(
    kind: ArtifactWriteKind,
    path: string,
    message: string,
    existingSha256: string | null = null,
  ) {
    super(message);
    this.name = 'ArtifactWriteError';
    this.kind = kind;
    this.path = path;
    this.existingSha256 = existingSha256;
  }
}

export interface PublishOptions {
  readonly overwrite?: boolean;
}

/** What a single-file publish did. `replacedSha256` is the bytes-as-read identity of what it displaced. */
export interface PublishResult {
  readonly written: boolean;
  readonly replacedSha256: string | null;
}

/** What a directory publish did. `skipped` counts targets already holding exactly the planned bytes. */
export interface DirectoryPublishResult {
  readonly published: number;
  readonly skipped: number;
}

/** The digest of a file that exists, or `null` when it does not or cannot be read. */
function digestOf(path: string): string | null {
  try {
    if (!lstatSync(path).isFile()) {
      return null;
    }
    return sha256Hex(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write `text` beside `target` and rename over it.
 *
 * `renameSync` replaces atomically on all three supported platforms, so a reader either sees the old file or
 * the new one — never the truncated middle a direct write can produce.
 */
function writeThenRename(target: string, text: string): void {
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, text, 'utf8');
  renameSync(temporary, target);
}

/**
 * Publish one artifact file.
 *
 * A name that cannot be a file name is refused rather than sanitised: renaming `a/b` to something safe would
 * publish an artifact under a name no manifest or receipt lists, and the next verification would compare
 * digests of files nobody asked for.
 */
export function publishFile(
  target: string,
  text: string,
  options: PublishOptions = {},
): PublishResult {
  const name = basename(target);
  const nameProblem = unsafeIdReason(name);
  if (nameProblem !== null) {
    throw new ArtifactWriteError('name', target, `Refusing to write "${name}": ${nameProblem}.`);
  }
  const existed = existsSync(target);
  const existingSha256 = existed ? digestOf(target) : null;
  if (existed && options.overwrite !== true) {
    throw new ArtifactWriteError(
      'exists',
      target,
      `${target} already exists` +
        (existingSha256 === null
          ? '. Refusing to replace whatever is there.'
          : ` (sha256 ${existingSha256}). Refusing to overwrite an artifact it may already have been verified against — pass --overwrite to replace it deliberately.`),
      existingSha256,
    );
  }
  try {
    writeThenRename(target, text);
  } catch (error) {
    try {
      rmSync(`${target}.tmp`, { force: true });
    } catch {
      // A temp file we could not remove is not worth a second error; the refusal below is the report.
    }
    throw new ArtifactWriteError(
      'target',
      target,
      `The artifact could not be published to ${target}: ${(error as Error).message}. Check the directory exists and is writable.`,
    );
  }
  return { written: true, replacedSha256: existingSha256 };
}

function cleanStaging(staging: string): void {
  try {
    rmSync(staging, { recursive: true, force: true });
  } catch {
    // Leaving staging behind is reported by the caller's refusal; it must not mask the original failure.
  }
}

/**
 * The digest a `StagedFile` carries: `contentHash` of its text, exactly as `renderStagedCorpus` computes it.
 * A planned digest and an on-disk digest must be produced by the same function or every comparison below would
 * be false. The separate `sha256Hex` identities in this module report *bytes as read* to an operator and to a
 * run receipt, which is a different question from "are these the planned bytes".
 */
function plannedHash(text: string): string {
  return contentHash(text);
}

/** What was at a target path before this batch touched it. Roll back depends on this being exact. */
type PriorState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'file'; readonly contents: string }
  | { readonly kind: 'not-a-file' };

function priorState(path: string): PriorState {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile()) {
      // Something the operator put there that this tool must not destroy: a rollback leaves it alone and never
      // tries to `rmSync` it, because treating "existed but unreadable" as "absent" would delete a directory.
      return { kind: 'not-a-file' };
    }
    return { kind: 'file', contents: readFileSync(path, 'utf8') };
  } catch {
    return { kind: 'absent' };
  }
}

/**
 * Publish a whole directory of artifacts, all or nothing.
 *
 * Order matters and is the guarantee: every name is checked, every planned digest is re-verified against the
 * bytes about to be written, and the target set is examined for collisions *before* anything is staged. Files
 * are then materialised in a staging directory and renamed into place one by one, and a failure partway
 * through rolls back what already landed — deleting files this batch created and restoring bytes it replaced,
 * while anything that was not a file stays exactly where the operator left it.
 *
 * This is deliberately simpler than the batch journal in `benchmark:case merge`, which serves a different need:
 * a merge commits a corpus of record and must be resumable across runs, while a derived directory (canonical
 * cases, packets, a snapshot) can be rebuilt from its inputs, so all-or-nothing is the right contract for it.
 */
export function publishDirectory(
  target: string,
  files: readonly StagedFile[],
  options: PublishOptions = {},
): DirectoryPublishResult {
  for (const file of files) {
    const nameProblem = unsafeIdReason(file.name);
    if (nameProblem !== null) {
      throw new ArtifactWriteError(
        'name',
        join(target, file.name),
        `Refusing to publish "${file.name}": ${nameProblem}.`,
      );
    }
  }
  for (const file of files) {
    if (contentHash(file.contents) !== file.contentsHash) {
      throw new ArtifactWriteError(
        'contents',
        join(target, file.name),
        `${file.name} does not match the digest recorded for it. Refusing to publish bytes that are not what was planned — a stale or edited staging input is not a corpus.`,
      );
    }
  }
  try {
    mkdirSync(target, { recursive: true });
  } catch (error) {
    throw new ArtifactWriteError(
      'target',
      target,
      `The output directory could not be created: ${target}. ${(error as Error).message}`,
    );
  }

  const prior = new Map<string, PriorState>();
  for (const file of files) {
    const path = join(target, file.name);
    const state = priorState(path);
    prior.set(file.name, state);
    if (state.kind === 'file' && plannedHash(state.contents) === file.contentsHash) {
      continue;
    }
    if (state.kind !== 'absent' && options.overwrite !== true) {
      const existing = state.kind === 'file' ? sha256Hex(state.contents) : null;
      throw new ArtifactWriteError(
        'exists',
        path,
        `${path} already exists` +
          (state.kind === 'not-a-file'
            ? ' and is not a regular file. Refusing to publish over it, and it will not be deleted.'
            : ` (sha256 ${existing}) with different content. Refusing to overwrite a directory of artifacts in one go — pass --overwrite to replace them deliberately.`),
        existing,
      );
    }
  }

  const staging = `${target}.staging`;
  cleanStaging(staging);
  mkdirSync(staging, { recursive: true });
  const touched: string[] = [];
  try {
    for (const file of files) {
      writeFileSync(join(staging, file.name), file.contents, 'utf8');
      const stagedHash = plannedHash(readFileSync(join(staging, file.name), 'utf8'));
      if (stagedHash !== file.contentsHash) {
        throw new ArtifactWriteError(
          'contents',
          join(staging, file.name),
          `${file.name} did not stage to the bytes planned for it (sha256 ${String(stagedHash)}). Nothing was published.`,
        );
      }
    }
    const published: string[] = [];
    for (const file of files) {
      const path = join(target, file.name);
      const state = prior.get(file.name) ?? { kind: 'absent' };
      if (state.kind === 'file' && plannedHash(state.contents) === file.contentsHash) {
        continue;
      }
      if (state.kind === 'not-a-file') {
        throw new ArtifactWriteError(
          'target',
          path,
          `${path} exists and is not a regular file, so it cannot be replaced by a rename.`,
        );
      }
      writeThenRename(path, file.contents);
      touched.push(file.name);
      published.push(file.name);
    }
    cleanStaging(staging);
    return {
      published: published.length,
      skipped: files.length - published.length,
    };
  } catch (error) {
    // Roll back in reverse order: files this batch created are removed, files it replaced get their bytes
    // written back. Anything that was not a file is left alone, and anything that cannot be restored is
    // reported rather than quietly skipped.
    const unrecovered: string[] = [];
    for (const name of [...touched].reverse()) {
      const path = join(target, name);
      const state = prior.get(name) ?? { kind: 'absent' };
      try {
        if (state.kind === 'absent') {
          rmSync(path, { force: true });
        } else if (state.kind === 'file') {
          writeThenRename(path, state.contents);
        }
      } catch {
        unrecovered.push(name);
      }
    }
    cleanStaging(staging);
    const reason = error instanceof Error ? error.message : String(error);
    throw new ArtifactWriteError(
      'io',
      target,
      `The batch to ${target} was refused and rolled back: ${reason}.` +
        (unrecovered.length > 0
          ? ` These files could NOT be restored and need attention: ${unrecovered.join(', ')}.`
          : ' Every file was restored to its previous state.'),
    );
  }
}
