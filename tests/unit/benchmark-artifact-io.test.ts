import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { ArtifactWriteError, publishDirectory, publishFile } from '../../scripts/artifact-io.ts';
import { contentHash, sha256Hex } from '../../src/benchmark/hashing.ts';
import type { StagedFile } from '../../src/benchmark/batch.ts';
import { scratchDirectory } from '../helpers/temp.ts';

/**
 * Publishing an artifact must not destroy one, and must not leave half of one (v0.8).
 *
 * A probe against merged v0.7 pre-created a report file and a release manifest, ran the commands that write
 * them, and both files were gone with no warning — replaced by a plain `writeFileSync`, which truncates before
 * it writes, so an interruption in the middle leaves a partial artifact at the final path. The manifest is the
 * file every later verification trusts, which makes a half-written one the most damaging artifact this tool can
 * produce.
 */

function staged(name: string, contents: string): StagedFile {
  return { name, contents, contentsHash: contentHash(contents) };
}

test('a new file is written atomically and holds exactly the bytes requested', () => {
  const temp = scratchDirectory('aporia-publish-');
  try {
    const target = join(temp.path, 'report.json');
    const text = '{ "hello": "world" }\n';
    const result = publishFile(target, text);
    assert.equal(result.written, true);
    assert.equal(result.replacedSha256, null);
    assert.equal(readFileSync(target, 'utf8'), text);
    // No sibling temp file is left behind to be mistaken for a corpus entry later.
    assert.deepEqual(readdirSync(temp.path), ['report.json']);
  } finally {
    temp.remove();
  }
});

test('an existing target is refused, and the refusal names the digest it would have destroyed', () => {
  const temp = scratchDirectory('aporia-publish-exists-');
  try {
    const target = join(temp.path, 'manifest.json');
    const previous = 'PRE-EXISTING HUMAN NOTES\n';
    writeFileSync(target, previous, 'utf8');
    let thrown: ArtifactWriteError | null = null;
    try {
      publishFile(target, '{"replaced":true}\n');
    } catch (error) {
      thrown = error instanceof ArtifactWriteError ? error : null;
      if (thrown === null) {
        throw error;
      }
    }
    assert.notEqual(thrown, null, 'an existing artifact was overwritten silently');
    assert.equal(thrown?.kind, 'exists');
    assert.equal(thrown?.existingSha256, sha256Hex(previous));
    // The guarantee that actually matters: the file is untouched.
    assert.equal(readFileSync(target, 'utf8'), previous);
  } finally {
    temp.remove();
  }
});

test('an explicit overwrite replaces the file and reports what it replaced', () => {
  const temp = scratchDirectory('aporia-publish-overwrite-');
  try {
    const target = join(temp.path, 'release.json');
    const previous = 'old bytes\n';
    writeFileSync(target, previous, 'utf8');
    const result = publishFile(target, 'new bytes\n', { overwrite: true });
    assert.equal(result.written, true);
    assert.equal(result.replacedSha256, sha256Hex(previous));
    assert.equal(readFileSync(target, 'utf8'), 'new bytes\n');
    assert.equal(existsSync(`${target}.tmp`), false);
  } finally {
    temp.remove();
  }
});

test('a target whose own file name cannot be stored is refused before anything is written', () => {
  // The check is on the basename, not on the directory: an operator who passes an absolute `--out` somewhere
  // else chose that path, and refusing it would be guessing at their intent. What must never happen is a
  // computed name that a supported OS cannot store.
  const temp = scratchDirectory('aporia-publish-name-');
  try {
    for (const bad of ['bad:name.json', 'trailing.', 'spaced tail.json ']) {
      let kind: string | null = null;
      try {
        publishFile(join(temp.path, bad), 'x\n');
      } catch (error) {
        kind = error instanceof ArtifactWriteError ? error.kind : `raw:${String(error)}`;
      }
      assert.equal(kind, 'name', `${JSON.stringify(bad)} should be refused as a name`);
    }
    assert.deepEqual(readdirSync(temp.path), []);
  } finally {
    temp.remove();
  }
});

test('a missing parent directory is a stated refusal, not a bare ENOENT', () => {
  const temp = scratchDirectory('aporia-publish-parent-');
  try {
    let kind: string | null = null;
    try {
      publishFile(join(temp.path, 'never', 'made', 'report.json'), 'x\n');
    } catch (error) {
      kind = error instanceof ArtifactWriteError ? error.kind : `raw:${String(error)}`;
    }
    assert.equal(kind, 'target');
  } finally {
    temp.remove();
  }
});

test('a target that already holds exactly these bytes is neither rewritten nor refused', () => {
  // The distinction is deliberate. An identical file cannot be destroyed, and treating a re-run as an error
  // would train an operator to pass --overwrite reflexively — the very flag that does destroy an artifact. A
  // *different* file is refused, which the tests above cover.
  const temp = scratchDirectory('aporia-publish-idempotent-');
  try {
    const target = join(temp.path, 'release.json');
    const text = '{ "version": "benchmark-release-manifest-v1" }\n';
    publishFile(target, text);
    const second = publishFile(target, text);
    assert.equal(second.written, false, 'an identical file was reported as replaced');
    assert.equal(second.replacedSha256, null);
    assert.equal(readFileSync(target, 'utf8'), text);
  } finally {
    temp.remove();
  }
});

test('a directory batch skips identical targets and refuses one that was edited', () => {
  const temp = scratchDirectory('aporia-publish-skip-');
  try {
    const target = join(temp.path, 'out');
    const files = [staged('a.json', '{ "id": "a" }\n'), staged('b.json', '{ "id": "b" }\n')];
    publishDirectory(target, files);
    // Both files now match, so a re-run publishes nothing and refuses nothing.
    const rerun = publishDirectory(target, files);
    assert.equal(rerun.published, 0);
    assert.equal(rerun.skipped, 2, 'identical files were counted as work rather than as no-op');

    // One edited file is a different statement: overwriting it would lose what the operator wrote, so the
    // whole batch is refused and nothing in it is touched.
    writeFileSync(join(target, 'a.json'), 'HUMAN EDIT\n', 'utf8');
    let kind: string | null = null;
    try {
      publishDirectory(target, files);
    } catch (error) {
      kind = error instanceof ArtifactWriteError ? error.kind : `raw:${String(error)}`;
    }
    assert.equal(kind, 'exists');
    assert.equal(readFileSync(join(target, 'a.json'), 'utf8'), 'HUMAN EDIT\n');
    assert.equal(readFileSync(join(target, 'b.json'), 'utf8'), files[1]?.contents);

    // With explicit leave to replace, exactly the one differing file is written.
    const forced = publishDirectory(target, files, { overwrite: true });
    assert.equal(forced.published, 1);
    assert.equal(forced.skipped, 1);
    assert.equal(readFileSync(join(target, 'a.json'), 'utf8'), files[0]?.contents);
  } finally {
    temp.remove();
  }
});

test('a clean directory publish leaves no staging tree and holds every file', () => {
  const temp = scratchDirectory('aporia-publish-dir-');
  try {
    const target = join(temp.path, 'corpus');
    const files = [staged('a.json', '{ "id": "a" }\n'), staged('b.json', '{ "id": "b" }\n')];
    const result = publishDirectory(target, files);
    assert.equal(result.published, 2);
    assert.equal(result.skipped, 0);
    assert.equal(readFileSync(join(target, 'a.json'), 'utf8'), files[0]?.contents);
    assert.equal(existsSync(`${target}.staging`), false, 'staging survived a clean run');
  } finally {
    temp.remove();
  }
});

test('a directory publish refuses before touching anything when one target already exists', () => {
  const temp = scratchDirectory('aporia-publish-partial-');
  try {
    const target = join(temp.path, 'out');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'b.json'), 'HUMAN EDIT — DO NOT LOSE\n', 'utf8');
    const files = [staged('a.json', '{ "id": "a" }\n'), staged('b.json', '{ "id": "b" }\n')];
    let kind: string | null = null;
    try {
      publishDirectory(target, files);
    } catch (error) {
      kind = error instanceof ArtifactWriteError ? error.kind : `raw:${String(error)}`;
    }
    assert.equal(kind, 'exists');
    // The no-partial-artifact guarantee: `a.json` was never written, and `b.json` is byte-for-byte what it was.
    assert.equal(existsSync(join(target, 'a.json')), false);
    assert.equal(readFileSync(join(target, 'b.json'), 'utf8'), 'HUMAN EDIT — DO NOT LOSE\n');
    assert.equal(existsSync(`${target}.staging`), false, 'a refused batch left staging behind');
  } finally {
    temp.remove();
  }
});

test('a directory publish with explicit overwrite replaces every target', () => {
  const temp = scratchDirectory('aporia-publish-dir-overwrite-');
  try {
    const target = join(temp.path, 'out2');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'a.json'), 'stale\n', 'utf8');
    const files = [staged('a.json', '{ "id": "a" }\n'), staged('b.json', '{ "id": "b" }\n')];
    const result = publishDirectory(target, files, { overwrite: true });
    assert.equal(result.published, 2);
    assert.equal(readFileSync(join(target, 'a.json'), 'utf8'), files[0]?.contents);
  } finally {
    temp.remove();
  }
});

test('an unsafe name in a directory batch is refused before any file lands', () => {
  const temp = scratchDirectory('aporia-publish-unsafe-');
  try {
    const target = join(temp.path, 'out3');
    const files = [staged('good.json', '{}\n'), staged('../escaped.json', '{}\n')];
    let kind: string | null = null;
    try {
      publishDirectory(target, files);
    } catch (error) {
      kind = error instanceof ArtifactWriteError ? error.kind : `raw:${String(error)}`;
    }
    assert.equal(kind, 'name');
    assert.equal(existsSync(join(target, 'good.json')), false);
    assert.equal(existsSync(join(temp.path, 'escaped.json')), false);
  } finally {
    temp.remove();
  }
});

test('a publish that fails partway rolls the directory back to what it was', () => {
  const temp = scratchDirectory('aporia-publish-rollback-');
  try {
    const target = join(temp.path, 'out6');
    mkdirSync(target, { recursive: true });
    // A directory sitting where a target file must go: `renameSync` onto it fails on Windows and on POSIX, so
    // this is a deterministic way to break a publish in the middle rather than a simulated one.
    mkdirSync(join(target, 'b.json'));
    writeFileSync(join(target, 'kept.txt'), 'untouched\n', 'utf8');
    const files = [staged('a.json', '{ "id": "a" }\n'), staged('b.json', '{ "id": "b" }\n')];
    let failed = false;
    try {
      publishDirectory(target, files, { overwrite: true });
    } catch (error) {
      failed = true;
      assert.ok(error instanceof ArtifactWriteError, `unexpected error type: ${String(error)}`);
    }
    assert.ok(failed, 'a publish that could not complete reported success');
    // a.json must not survive as an orphan of a batch that did not finish.
    assert.equal(
      existsSync(join(target, 'a.json')),
      false,
      'a rolled-back batch left a partial artifact',
    );
    assert.equal(readFileSync(join(target, 'kept.txt'), 'utf8'), 'untouched\n');
    assert.equal(existsSync(`${target}.staging`), false, 'a failed batch left staging behind');
  } finally {
    temp.remove();
  }
});

test('an existing file replaced by an overwritten batch is restored when the batch fails', () => {
  const temp = scratchDirectory('aporia-publish-restore-');
  try {
    const target = join(temp.path, 'out7');
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'a.json'), 'ORIGINAL A\n', 'utf8');
    writeFileSync(join(target, 'b.json'), 'ORIGINAL B\n', 'utf8');
    // c.json cannot be written: a directory holds its name.
    mkdirSync(join(target, 'c.json'));
    const files = [
      staged('a.json', 'NEW A\n'),
      staged('b.json', 'NEW B\n'),
      staged('c.json', 'NEW C\n'),
    ];
    assert.throws(() => publishDirectory(target, files, { overwrite: true }), ArtifactWriteError);
    assert.equal(readFileSync(join(target, 'a.json'), 'utf8'), 'ORIGINAL A\n');
    assert.equal(readFileSync(join(target, 'b.json'), 'utf8'), 'ORIGINAL B\n');
  } finally {
    temp.remove();
  }
});

test('a staged file whose recorded digest does not match its bytes is refused', () => {
  const temp = scratchDirectory('aporia-publish-hash-');
  try {
    const target = join(temp.path, 'out4');
    const bad: StagedFile = {
      name: 'a.json',
      contents: '{ "id": "a" }\n',
      contentsHash: 'f'.repeat(64),
    };
    let thrown = false;
    try {
      publishDirectory(target, [bad]);
    } catch (error) {
      thrown = error instanceof ArtifactWriteError;
    }
    assert.ok(thrown, 'a staged file was published without checking its own digest');
    assert.equal(existsSync(join(target, 'a.json')), false);
  } finally {
    temp.remove();
  }
});

test('an empty publish removes a stale staging tree left by an earlier interrupted run', () => {
  const temp = scratchDirectory('aporia-publish-stale-');
  try {
    const target = join(temp.path, 'out5');
    mkdirSync(`${target}.staging`, { recursive: true });
    writeFileSync(join(`${target}.staging`, 'orphan.json'), 'leftover\n', 'utf8');
    const result = publishDirectory(target, [staged('a.json', '{}\n')]);
    assert.equal(result.published, 1);
    assert.equal(existsSync(`${target}.staging`), false);
    assert.equal(existsSync(join(`${target}.staging`, 'orphan.json')), false);
    rmSync(target, { recursive: true, force: true });
  } finally {
    temp.remove();
  }
});
