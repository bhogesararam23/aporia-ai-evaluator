import assert from 'node:assert/strict';
import { test } from 'node:test';

import { safeArtifactName, unsafeIdReason } from '../../src/benchmark/naming.ts';

/**
 * One rule for the string a case id becomes (v0.8).
 *
 * Every benchmark publication path derives a file name from `case.id`, so an identifier containing a path
 * separator is not a cosmetic oddity: it writes outside the directory the operator named. A probe against
 * merged v0.7 proved it — a case with id `../../../../pwned` validated with zero issues, `normalise` exited
 * zero, left its `--out` empty, and wrote a canonical case file several directories up.
 *
 * The rule is therefore what cannot be a file name on at least one supported OS, and it is shared by the
 * validator and the writer so the two cannot drift into disagreeing about what a valid id is.
 */

function refusal(id: unknown): string | null {
  const result = safeArtifactName(id);
  return result.ok ? null : result.reason;
}

test('an ordinary id becomes itself with the extension', () => {
  const accepted = safeArtifactName('case-2026-11-refusal');
  assert.ok(accepted.ok);
  assert.equal(accepted.name, 'case-2026-11-refusal.json');
});

test('a documented suffix is honoured, because packet and submission names are real', () => {
  const packet = safeArtifactName('case-a', '.packet.json');
  assert.ok(packet.ok);
  assert.equal(packet.name, 'case-a.packet.json');
});

test('a separator-bearing id is refused, and the reason says why', () => {
  for (const id of ['../pwned', '../../pwned', 'a/b', 'a\\b', '/root', '\\\\server\\share']) {
    const reason = refusal(id);
    assert.notEqual(reason, null, `${id} was accepted as a file name`);
    assert.match(reason ?? '', /path|separator/);
  }
});

test('the traversal shapes a resolver would follow are refused', () => {
  assert.notEqual(refusal('.'), null);
  assert.notEqual(refusal('..'), null);
  assert.notEqual(refusal('...'), null);
});

test('characters at least one supported OS cannot store are refused', () => {
  for (const id of ['a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\u0000b', 'a\u001fb']) {
    assert.notEqual(refusal(id), null, `${JSON.stringify(id)} was accepted`);
  }
});

test('a trailing dot or space is refused, because Windows strips it and the file would not be where it is named', () => {
  assert.notEqual(refusal('case-a.'), null);
  assert.notEqual(refusal('case-a '), null);
  assert.notEqual(refusal(' case-a'), null);
});

test('non-strings and blanks are refused rather than coerced', () => {
  for (const id of ['', '   ', 42, null, undefined, {}, []]) {
    assert.notEqual(refusal(id), null, `${String(id)} was accepted`);
  }
});

test('a name too long to be a file name is refused with the length in the reason', () => {
  const long = 'x'.repeat(121);
  const reason = refusal(long);
  assert.notEqual(reason, null);
  assert.match(reason ?? '', /120/);
});

test('ids that are legal and merely unusual still pass', () => {
  // Rejecting more than the filesystem rule would invalidate corpus material that has always been readable.
  for (const id of [
    'case.a.b',
    'CASE_UPPER',
    'ünïcode-câse',
    '1234',
    'a-b_c~d',
    'refusal: not: this',
  ]) {
    if (id.includes(':')) {
      // A colon is refused on Windows, so this one is expected to fail; asserted separately so the test does
      // not hide the rule it is checking.
      assert.notEqual(refusal(id), null);
      continue;
    }
    assert.ok(safeArtifactName(id).ok, `${id} should be a usable file name`);
  }
});

test('unsafeIdReason agrees with safeArtifactName, so a validator can report the same words', () => {
  assert.equal(unsafeIdReason('case-a'), null);
  assert.equal(unsafeIdReason('a/b'), refusal('a/b'));
  assert.notEqual(unsafeIdReason('..'), null);
});
