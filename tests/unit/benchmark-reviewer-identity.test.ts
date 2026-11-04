import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewerIdentity } from '../../src/benchmark/provenance.ts';

/**
 * Reviewer identity canonicalisation (ADR-027).
 *
 * Reviewer names are operator-asserted — there is no authentication — so the only integrity control the
 * harness has over "two reviewers agreed" is that one person cannot be counted twice by spelling their
 * name differently. Without this, `Sam`, `sam` and `Sam ` become three reviewers and a lone opinion reads
 * as a consensus, which is the failure the two-reviewer rule exists to prevent.
 *
 * Canonicalising collapses alias *spellings*. It cannot prove two genuinely different names are two
 * different humans, and no report here may claim otherwise.
 */

test('surrounding and repeated internal whitespace collapse', () => {
  assert.equal(reviewerIdentity('  dana  '), 'dana');
  assert.equal(reviewerIdentity('dana'), 'dana');
  assert.equal(reviewerIdentity('Dana   Lee'), 'dana lee');
  assert.equal(reviewerIdentity('Dana\tLee'), 'dana lee');
  assert.equal(reviewerIdentity('Dana \n Lee'), 'dana lee');
});

test('case is folded so spelling variants become one identity', () => {
  assert.equal(reviewerIdentity('SAM'), reviewerIdentity('sam'));
  assert.equal(reviewerIdentity('Sam'), reviewerIdentity('  sAm  '));
  assert.equal(reviewerIdentity('REVIEWER-01'), 'reviewer-01');
});

test('the transform is idempotent', () => {
  for (const name of ['Dana Lee', '  SAM  ', 'réviewer deux', 'a  b  c']) {
    const once = reviewerIdentity(name);
    assert.equal(reviewerIdentity(once), once);
  }
});

test('blank and whitespace-only names have no identity, so they cannot impersonate a reviewer', () => {
  assert.equal(reviewerIdentity(''), '');
  assert.equal(reviewerIdentity('   '), '');
  assert.equal(reviewerIdentity('\t\n '), '');
});

test('distinct names stay distinct — this collapses spellings, not people', () => {
  const identities = new Set(['dana', 'erin', 'Dana Lee', 'dana lee'].map(reviewerIdentity));
  // `dana` and `Dana Lee` are different identities; `Dana Lee` and `dana lee` are one.
  assert.equal(identities.size, 3);
  assert.ok(identities.has('dana'));
  assert.ok(identities.has('erin'));
  assert.ok(identities.has('dana lee'));
});

test('non-Latin names survive canonicalisation', () => {
  // Case-folding is Unicode-aware, so an accented alias still collapses to one identity.
  assert.equal(reviewerIdentity('ÉRIK'), reviewerIdentity('érik'));
  assert.equal(reviewerIdentity('レビュー 01'), 'レビュー 01');
});
