/**
 * The one rule for an identifier that becomes a file name (v0.8).
 *
 * Every benchmark publication path derives its output name from `case.id`: `normalise` writes
 * `<id>.json`, `packet` writes `<id>.packet.json` and `<id>.submission.json`, a release snapshot copies to
 * `<id>.json`, and a staged batch renames to `<id>.json`. Before v0.8 nothing checked that the identifier
 * could be a file name — a probe confirmed a case with id `../../../../pwned` validated with zero issues,
 * `normalise` exited zero, left its own `--out` directory empty, and wrote a canonical case file several
 * directories above it.
 *
 * This module holds the rule once so the validator and the writers cannot drift into disagreeing about what
 * a valid id is. It states what at least one supported operating system cannot store, and nothing more:
 * refusing more than the filesystem rule would invalidate corpus material that has always been readable,
 * which is a different goal from refusing an escape.
 *
 * Pure and dependency-free: `src/benchmark/validate.ts` imports this, so this must not import that.
 */

/** The longest identifier accepted, mirrored against `BENCHMARK_LIMITS.maxIdLength` in a test. */
export const MAX_ARTIFACT_ID_LENGTH = 120;

/** Characters Windows refuses to store in a name. A path separator is handled separately and first. */
const RESERVED_CHARACTERS = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];

export type ArtifactName =
  { readonly ok: true; readonly name: string } | { readonly ok: false; readonly reason: string };

/**
 * Why an id cannot become a file name, or `null` when it can.
 *
 * Kept separate from `safeArtifactName` so a validator can report the same sentence a writer refuses with —
 * one rule, two enforcement points, no second copy of the wording to go stale.
 */
export function unsafeIdReason(id: unknown): string | null {
  if (typeof id !== 'string') {
    return 'a case id must be a string before it can become a file name';
  }
  if (id.length === 0) {
    return 'a case id is empty, and an empty file name names nothing';
  }
  if (id !== id.trim()) {
    return `"${id}" has leading or trailing whitespace; Windows strips it and the file would not be where it is named`;
  }
  if (id.endsWith('.') || id.endsWith(' ')) {
    return `"${id}" ends in a dot or a space; Windows strips it and the file would not be where it is named`;
  }
  if (/^[.]+$/.test(id)) {
    return `"${id}" is only dots, which a path resolver reads as a directory step, not a file`;
  }
  for (const character of RESERVED_CHARACTERS) {
    if (id.includes(character)) {
      if (character === '/' || character === '\\') {
        return `"${id}" contains a path separator, which would write outside the directory the operator named`;
      }
      return `"${id}" contains "${character}", which cannot appear in a file name on a supported operating system`;
    }
  }
  if (id.startsWith('..')) {
    return `"${id}" begins with a path traversal step`;
  }
  // Control characters are stored differently or not at all, and a name containing one is not a name a reader
  // can type back.
  for (const character of id) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return `"${id}" contains a control character, which cannot reliably be stored as a file name`;
    }
  }
  if (id.length > MAX_ARTIFACT_ID_LENGTH) {
    return `"${id}" is ${String(id.length)} characters, over the ${String(MAX_ARTIFACT_ID_LENGTH)}-character ceiling for an identifier`;
  }
  return null;
}

/**
 * The file name an id produces, or the reason it produces none.
 *
 * A caller that receives `ok: false` must refuse the write. It must not sanitise the id into something else:
 * silently renaming `a/b` to `a_b` would publish a case under a name no release manifest lists, and the
 * operator would verify a corpus against digests that describe files nobody asked for.
 */
export function safeArtifactName(id: unknown, suffix = '.json'): ArtifactName {
  const reason = unsafeIdReason(id);
  if (reason !== null) {
    return { ok: false, reason };
  }
  return { ok: true, name: `${id as string}${suffix}` };
}
