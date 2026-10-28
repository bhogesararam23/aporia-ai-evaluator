import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyzeHtml,
  decodeHtmlBytes,
  NETWORK_DEPENDENT_CHECKS,
  WebsiteAnalysisError,
  WEBSITE_AUDIT_VERSION,
} from '../../src/website/index.ts';

const BASE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Project A — evidence record</title>
  <meta name="description" content="A concise record of Project A and its evidence.">
  <meta name="author" content="Ram">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="https://example.com/project-a">
  <meta property="article:published_time" content="2026-10-01T12:00:00Z">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Project A","author":{"@type":"Person","name":"Ram"},"datePublished":"2026-10-01"}</script>
</head>
<body>
  <main>
    <h1>Project A</h1>
    <p>Project A is an evidence-first evaluation project created by Ram. This page describes its scope and links to the primary release artifact.</p>
    <time datetime="2026-10-01">1 October 2026</time>
    <a href="https://example.com/release">Release artifact</a>
    <img src="screenshot.png" alt="Project A screenshot">
  </main>
</body>
</html>`;

function codes(html: string): string[] {
  return analyzeHtml(html).findings.map((finding) => finding.code);
}

test('extracts metadata and structured data from supplied HTML', () => {
  const analysis = analyzeHtml(BASE_HTML);
  assert.equal(analysis.version, WEBSITE_AUDIT_VERSION);
  assert.equal(analysis.metadata.title, 'Project A — evidence record');
  assert.equal(analysis.metadata.lang, 'en');
  assert.equal(analysis.metadata.canonicalUrl, 'https://example.com/project-a');
  assert.equal(analysis.metadata.h1Count, 1);
  assert.equal(analysis.metadata.hasMain, true);
  assert.equal(analysis.metadata.jsonLdBlockCount, 1);
  assert.equal(analysis.metadata.jsonLdValidCount, 1);
  assert.deepEqual(analysis.metadata.authorSignals, ['Ram']);
  assert.ok(analysis.metadata.dateSignals.some((value) => value.startsWith('2026-10-01')));
  assert.equal(analysis.metadata.scriptCount, 0);
  assert.match(analysis.contentHash, /^[a-f0-9]{64}$/);
  assert.ok(analysis.byteLength > 0);
  assert.equal(codes(BASE_HTML).includes('title_missing'), false);
  assert.equal(codes(BASE_HTML).includes('structured_data_mismatch'), false);
});

test('network-dependent checks are always unavailable, never passed', () => {
  const analysis = analyzeHtml(BASE_HTML);
  assert.deepEqual(
    analysis.unavailableChecks.map((check) => check.code),
    NETWORK_DEPENDENT_CHECKS.map((check) => check.code),
  );
  for (const check of analysis.unavailableChecks) {
    assert.match(check.reason, /not |no |disabled/i);
    assert.notEqual(check.reason.toLowerCase(), 'passed');
  }
  assert.equal(
    analysis.findings.some((finding) => finding.code === 'http_reachable'),
    false,
  );
  assert.equal(
    analysis.findings.some((finding) => finding.code === 'indexed'),
    false,
  );
});

test('detects title, robots, canonical, and heading problems', () => {
  const noIndex = analyzeHtml(
    '<html><head><title>Page</title><meta name="robots" content="noindex, nofollow"></head><body><h1>Page</h1></body></html>',
  );
  assert.ok(
    noIndex.findings.some(
      (finding) => finding.code === 'meta_robots_noindex' && finding.severity === 'BLOCKING',
    ),
  );
  assert.ok(noIndex.findings.some((finding) => finding.code === 'meta_robots_nofollow'));

  const missing = analyzeHtml('<html><body><p>No head signals.</p></body></html>');
  for (const code of [
    'title_missing',
    'canonical_missing',
    'h1_missing',
    'author_signal_missing',
    'date_signal_missing',
    'lang_missing',
  ]) {
    assert.ok(
      missing.findings.some((finding) => finding.code === code),
      code,
    );
  }

  const relative = analyzeHtml(
    '<html lang="en"><head><title>Page</title><link rel="canonical" href="/relative"></head><body><h1>Page</h1></body></html>',
  );
  assert.ok(relative.findings.some((finding) => finding.code === 'canonical_invalid'));

  const multiple = analyzeHtml(
    '<html lang="en"><head><title>Page</title><link rel="canonical" href="https://example.com/a"><link rel="canonical" href="https://example.com/b"></head><body><h1>Page</h1></body></html>',
  );
  assert.ok(multiple.findings.some((finding) => finding.code === 'canonical_multiple'));
  assert.equal(multiple.metadata.canonicalCount, 2);

  const multipleH1 = analyzeHtml(
    '<html lang="en"><head><title>Page</title></head><body><h1>One</h1><h1>Two</h1></body></html>',
  );
  assert.ok(multipleH1.findings.some((finding) => finding.code === 'h1_multiple'));
});

test('validates JSON-LD syntax and visible-content alignment', () => {
  const invalid = analyzeHtml(
    '<html lang="en"><head><title>Page</title><script type="application/ld+json">{not json}</script></head><body><h1>Page</h1></body></html>',
  );
  assert.equal(invalid.metadata.jsonLdBlockCount, 1);
  assert.equal(invalid.metadata.jsonLdValidCount, 0);
  assert.ok(invalid.findings.some((finding) => finding.code === 'structured_data_invalid'));

  const mismatch = analyzeHtml(
    '<html lang="en"><head><title>Page</title><script type="application/ld+json">{"@type":"Thing","name":"Invisible Claim"}</script></head><body><h1>Page</h1><p>Visible content.</p></body></html>',
  );
  const mismatchFinding = mismatch.findings.find(
    (finding) => finding.code === 'structured_data_mismatch',
  );
  assert.ok(mismatchFinding);
  assert.match(mismatchFinding.observation, /Invisible Claim/);
});

test('flags active link schemes, missing alt text, and JavaScript-dependent content', () => {
  const unsafe = analyzeHtml(
    '<html lang="en"><head><title>Page</title></head><body><h1>Page</h1><a href="javascript:alert(1)">Click</a><img src="x.png"></body></html>',
  );
  assert.ok(unsafe.findings.some((finding) => finding.code === 'unsafe_link_schemes'));
  assert.ok(unsafe.findings.some((finding) => finding.code === 'image_alt_missing'));

  const scripted = analyzeHtml(
    '<html lang="en"><head><title>App</title></head><body><div id="root"></div><script>document.getElementById("root").textContent = "rendered";</script></body></html>',
  );
  assert.ok(scripted.findings.some((finding) => finding.code === 'content_may_require_javascript'));
});

test('excludes script, style, and noscript text from visible content', () => {
  const longHidden = 'hidden'.repeat(100);
  const analysis = analyzeHtml(
    `<html lang="en"><head><title>Page</title><style>${longHidden}</style></head><body><h1>Page</h1><p>Visible sentence.</p><script>${longHidden}</script><noscript>${longHidden}</noscript><p>More visible words.</p></body></html>`,
  );
  assert.ok(analysis.metadata.visibleTextLength < 100);
  assert.equal(analysis.metadata.scriptCount, 1);
  assert.ok(analysis.findings.some((finding) => finding.code === 'content_may_require_javascript'));
  assert.equal(JSON.stringify(analysis).includes(longHidden.slice(0, 20)), false);
});

test('input validation rejects empty, oversized, binary, and invalid UTF-8 content', () => {
  assert.throws(
    () => analyzeHtml(''),
    (error: unknown) => error instanceof WebsiteAnalysisError && error.code === 'EMPTY',
  );
  assert.throws(
    () => analyzeHtml('<html></html>', { maxBytes: 5 }),
    (error: unknown) => error instanceof WebsiteAnalysisError && error.code === 'TOO_LARGE',
  );
  assert.throws(
    () => analyzeHtml('<html>\u0000</html>'),
    (error: unknown) => error instanceof WebsiteAnalysisError && error.code === 'BINARY',
  );
  assert.throws(
    () => decodeHtmlBytes(new Uint8Array([0xff, 0xfe, 0xfd])),
    (error: unknown) => error instanceof WebsiteAnalysisError && error.code === 'INVALID_ENCODING',
  );
  assert.throws(
    () => decodeHtmlBytes(new Uint8Array([0x3c, 0x00, 0x3e])),
    (error: unknown) => error instanceof WebsiteAnalysisError && error.code === 'BINARY',
  );
  assert.throws(
    () => decodeHtmlBytes(new Uint8Array()),
    (error: unknown) => error instanceof WebsiteAnalysisError && error.code === 'EMPTY',
  );
});

test('decodes UTF-8 with an optional byte-order mark', () => {
  const bytes = new TextEncoder().encode(
    '\uFEFF<html lang="en"><head><title>Page</title></head><body><h1>Page</h1></body></html>',
  );
  const html = decodeHtmlBytes(bytes);
  assert.equal(html.startsWith('<html'), true);
  assert.equal(analyzeHtml(html).metadata.title, 'Page');
});

test('analysis is deterministic and does not execute active content', () => {
  const first = analyzeHtml(BASE_HTML);
  const second = analyzeHtml(BASE_HTML);
  assert.deepEqual(first, second);

  const malicious = analyzeHtml(
    '<html lang="en"><head><title><script>alert(1)</script></title></head><body><h1>Page</h1><img src=x onerror="alert(2)"></body></html>',
  );
  assert.ok(typeof malicious.metadata.title === 'string');
  assert.equal(JSON.stringify(malicious).includes('"executed"'), false);
});

test('reports parser issues without crashing', () => {
  const analysis = analyzeHtml(
    '<html lang="en"><head><title>Page</title></head><body><h1>Page</h1><div><span>broken</div></body></html>',
  );
  assert.ok(Array.isArray(analysis.parseIssues));
  assert.ok(analysis.findings.length > 0);
});
