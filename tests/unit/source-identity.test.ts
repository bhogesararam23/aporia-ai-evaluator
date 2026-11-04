import assert from 'node:assert/strict';
import { test } from 'node:test';
import { underlyingSourceIdentity } from '../../src/core/evidence.ts';

/**
 * ADR-025 §1 rule 1: two evidence records that share an underlying source — the same canonical URI,
 * or (in the benchmark contract) the same recorded source id — must corroborate once, not twice.
 * The identity function is deliberately conservative: it merges only when a full canonical URI can be
 * normalised with confidence, and falls back to the record's own source id otherwise. It never throws
 * on malformed input, because an unparseable string must not be silently merged with anything.
 */

test('identical canonical URIs recorded under different source ids collapse to one identity', () => {
  const a = underlyingSourceIdentity({
    sourceId: 'src_a',
    canonicalUri: 'https://example.com/story',
  });
  const b = underlyingSourceIdentity({
    sourceId: 'src_b',
    canonicalUri: 'https://example.com/story',
  });
  assert.equal(a, b);
});

test('case, default port, fragment, www and trailing slash normalise to one identity', () => {
  const variants = [
    'HTTPS://Example.com:443/story#section',
    'https://www.example.com/story/',
    'https://example.com/story',
  ];
  const keys = variants.map((uri) =>
    underlyingSourceIdentity({ sourceId: 'x', canonicalUri: uri }),
  );
  assert.equal(new Set(keys).size, 1, `expected one identity, got ${keys.join(' | ')}`);
});

test('tracking query parameters are dropped before comparison', () => {
  const clean = underlyingSourceIdentity({ sourceId: 'x', canonicalUri: 'https://example.com/a' });
  const tracked = underlyingSourceIdentity({
    sourceId: 'y',
    canonicalUri: 'https://example.com/a?utm_source=news&fbclid=abc123',
  });
  assert.equal(clean, tracked);
});

test('meaningful query parameters are kept and order does not matter', () => {
  const one = underlyingSourceIdentity({
    sourceId: 'x',
    canonicalUri: 'https://example.com/search?page=2&q=aporia',
  });
  const two = underlyingSourceIdentity({
    sourceId: 'y',
    canonicalUri: 'https://example.com/search?q=aporia&page=2',
  });
  const different = underlyingSourceIdentity({
    sourceId: 'z',
    canonicalUri: 'https://example.com/search?q=aporia&page=3',
  });
  assert.equal(one, two);
  assert.notEqual(one, different);
});

test('distinct paths and case-sensitive paths do not merge', () => {
  const a = underlyingSourceIdentity({ sourceId: 'x', canonicalUri: 'https://example.com/a' });
  const b = underlyingSourceIdentity({ sourceId: 'x', canonicalUri: 'https://example.com/b' });
  const c = underlyingSourceIdentity({ sourceId: 'x', canonicalUri: 'https://example.com/A' });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test('a null, blank or unparseable canonical URI falls back to the source id', () => {
  const nullUri = underlyingSourceIdentity({ sourceId: 'src_a', canonicalUri: null });
  const blankUri = underlyingSourceIdentity({ sourceId: 'src_a', canonicalUri: '   ' });
  const brokenUri = underlyingSourceIdentity({ sourceId: 'src_a', canonicalUri: 'not a uri' });
  const otherId = underlyingSourceIdentity({ sourceId: 'src_b', canonicalUri: null });
  // All three describe the same source record, so they share the id-based identity...
  assert.equal(nullUri, blankUri);
  assert.equal(nullUri, brokenUri);
  // ...and a different source id is a different identity when no canonical URI can normalise.
  assert.notEqual(nullUri, otherId);
});

test('different hosts never merge even when the path matches', () => {
  const syndicated = underlyingSourceIdentity({
    sourceId: 'x',
    canonicalUri: 'https://publisher-one.example/story',
  });
  const original = underlyingSourceIdentity({
    sourceId: 'y',
    canonicalUri: 'https://publisher-two.example/story',
  });
  assert.notEqual(syndicated, original);
});
