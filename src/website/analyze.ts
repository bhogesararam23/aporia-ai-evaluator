import { createHash } from 'node:crypto';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import {
  NETWORK_DEPENDENT_CHECKS,
  WEBSITE_AUDIT_VERSION,
  WebsiteAnalysisError,
  type FindingCategory,
  type FindingSeverity,
  type ParseIssue,
  type WebsiteAnalysis,
  type WebsiteFinding,
  type WebsiteMetadata,
} from './types.ts';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type Document = DefaultTreeAdapterTypes.Document;

const DEFAULT_MAX_BYTES = 1_000_000;
const MAX_PARSE_ISSUES = 20;
const MAX_SIGNALS = 20;

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}

function walk(root: Node, visit: (node: Node) => void): void {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    visit(node);
    if ('childNodes' in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
        const child = node.childNodes[index];
        if (child !== undefined) {
          stack.push(child);
        }
      }
    }
  }
}

function findAll(root: Node, predicate: (element: Element) => boolean): Element[] {
  const matches: Element[] = [];
  walk(root, (node) => {
    if (isElement(node) && predicate(node)) {
      matches.push(node);
    }
  });
  return matches;
}

function findFirst(root: Node, predicate: (element: Element) => boolean): Element | null {
  let match: Element | null = null;
  walk(root, (node) => {
    if (match === null && isElement(node) && predicate(node)) {
      match = node;
    }
  });
  return match;
}

function byTag(tagName: string) {
  return (element: Element): boolean => element.tagName === tagName;
}

function attribute(element: Element, name: string): string | null {
  const found = element.attrs.find((attr) => attr.name.toLowerCase() === name.toLowerCase());
  return found === undefined ? null : found.value;
}

function relTokens(element: Element): string[] {
  return (attribute(element, 'rel') ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

const SKIPPED_TEXT_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg']);

function textOf(root: Node, skipTags: ReadonlySet<string> = SKIPPED_TEXT_TAGS): string {
  const parts: string[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    if (isElement(node) && skipTags.has(node.tagName)) {
      continue;
    }
    if (node.nodeName === '#text' && 'value' in node) {
      parts.push(node.value);
      continue;
    }
    if ('childNodes' in node) {
      for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
        const child = node.childNodes[index];
        if (child !== undefined) {
          stack.push(child);
        }
      }
    }
  }
  return parts.join(' ');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function metaContent(head: Node, key: 'name' | 'property', value: string): string | null {
  const element = findFirst(
    head,
    (candidate) =>
      candidate.tagName === 'meta' &&
      (attribute(candidate, key) ?? '').toLowerCase() === value.toLowerCase(),
  );
  const content = element === null ? null : attribute(element, 'content');
  return content === null ? null : normalizeWhitespace(content);
}

function uniqueLimited(values: readonly string[], max = MAX_SIGNALS): string[] {
  const unique: string[] = [];
  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    if (normalized.length > 0 && !unique.includes(normalized)) {
      unique.push(truncate(normalized, 300));
      if (unique.length >= max) {
        break;
      }
    }
  }
  return unique;
}

function validAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname.length > 0 &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

interface JsonLdSummary {
  blockCount: number;
  validCount: number;
  invalidCount: number;
  names: { label: string; value: string }[];
  authorSignals: string[];
  dateSignals: string[];
}

function collectJsonLd(document: Document): JsonLdSummary {
  const summary: JsonLdSummary = {
    blockCount: 0,
    validCount: 0,
    invalidCount: 0,
    names: [],
    authorSignals: [],
    dateSignals: [],
  };
  const scripts = findAll(
    document,
    (element) =>
      element.tagName === 'script' &&
      (attribute(element, 'type') ?? '').trim().toLowerCase() === 'application/ld+json',
  );
  summary.blockCount = scripts.length;
  for (const script of scripts) {
    const raw = textOf(script, new Set()).trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      summary.invalidCount += 1;
      continue;
    }
    summary.validCount += 1;
    const nodes: Record<string, unknown>[] = [];
    const visitNode = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) {
          visitNode(item);
        }
        return;
      }
      if (typeof value !== 'object' || value === null) {
        return;
      }
      const record = value as Record<string, unknown>;
      nodes.push(record);
      if ('@graph' in record) {
        visitNode(record['@graph']);
      }
    };
    visitNode(parsed);
    for (const node of nodes) {
      for (const key of ['name', 'headline']) {
        const value = node[key];
        if (typeof value === 'string' && value.trim().length > 0) {
          summary.names.push({ label: key, value: normalizeWhitespace(value) });
        }
      }
      for (const key of ['author', 'creator', 'publisher']) {
        const value = node[key];
        if (typeof value === 'string') {
          summary.authorSignals.push(value);
        } else if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === 'string') {
              summary.authorSignals.push(item);
            } else if (typeof item === 'object' && item !== null) {
              const name = (item as Record<string, unknown>)['name'];
              if (typeof name === 'string') {
                summary.authorSignals.push(name);
              }
            }
          }
        } else if (typeof value === 'object' && value !== null) {
          const name = (value as Record<string, unknown>)['name'];
          if (typeof name === 'string') {
            summary.authorSignals.push(name);
          }
        }
      }
      for (const key of ['datePublished', 'dateModified']) {
        const value = node[key];
        if (typeof value === 'string' && value.trim().length > 0) {
          summary.dateSignals.push(value);
        }
      }
    }
  }
  return summary;
}

interface LinkCounts {
  total: number;
  relative: number;
  http: number;
  mailto: number;
  other: number;
  unsafe: number;
}

function classifyLinks(root: Node): LinkCounts {
  const counts: LinkCounts = { total: 0, relative: 0, http: 0, mailto: 0, other: 0, unsafe: 0 };
  for (const link of findAll(root, byTag('a'))) {
    const href = attribute(link, 'href');
    if (href === null) {
      continue;
    }
    const trimmed = href.trim();
    if (trimmed.length === 0) {
      counts.relative += 1;
    } else if (
      /^javascript:/i.test(trimmed) ||
      /^data:/i.test(trimmed) ||
      /^vbscript:/i.test(trimmed)
    ) {
      counts.unsafe += 1;
    } else if (/^https?:/i.test(trimmed) || trimmed.startsWith('//')) {
      counts.http += 1;
    } else if (/^mailto:/i.test(trimmed)) {
      counts.mailto += 1;
    } else if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
      counts.other += 1;
    } else {
      counts.relative += 1;
    }
    counts.total += 1;
  }
  return counts;
}

function finding(
  code: string,
  severity: FindingSeverity,
  category: FindingCategory,
  title: string,
  observation: string,
  rationale: string,
  recommendation: string,
  locator: string,
): WebsiteFinding {
  return { code, severity, category, title, observation, rationale, recommendation, locator };
}

function validateInput(html: string, maxBytes: number): number {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new WebsiteAnalysisError('TOO_LARGE', 'The HTML size limit must be a positive number.');
  }
  const byteLength = Buffer.byteLength(html, 'utf8');
  if (byteLength === 0 || html.trim().length === 0) {
    throw new WebsiteAnalysisError('EMPTY', 'The supplied HTML is empty.');
  }
  if (byteLength > maxBytes) {
    throw new WebsiteAnalysisError(
      'TOO_LARGE',
      `The supplied HTML is ${byteLength} bytes; the limit is ${maxBytes} bytes.`,
    );
  }
  if (html.includes('\u0000')) {
    throw new WebsiteAnalysisError(
      'BINARY',
      'The supplied content contains NUL bytes and is not HTML text.',
    );
  }
  return byteLength;
}

export function decodeHtmlBytes(bytes: Uint8Array, maxBytes = DEFAULT_MAX_BYTES): string {
  if (bytes.byteLength === 0) {
    throw new WebsiteAnalysisError('EMPTY', 'The uploaded file is empty.');
  }
  if (bytes.byteLength > maxBytes) {
    throw new WebsiteAnalysisError(
      'TOO_LARGE',
      `The uploaded file is ${bytes.byteLength} bytes; the limit is ${maxBytes} bytes.`,
    );
  }
  if (bytes.includes(0)) {
    throw new WebsiteAnalysisError(
      'BINARY',
      'The uploaded file contains NUL bytes and is not HTML text.',
    );
  }
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new WebsiteAnalysisError(
      'INVALID_ENCODING',
      'The uploaded file is not valid UTF-8 text.',
    );
  }
  const withoutBom = decoded.startsWith('\uFEFF') ? decoded.slice(1) : decoded;
  if (withoutBom.trim().length === 0) {
    throw new WebsiteAnalysisError('EMPTY', 'The uploaded file contains no text.');
  }
  return withoutBom;
}

export function analyzeHtml(html: string, options: { maxBytes?: number } = {}): WebsiteAnalysis {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const byteLength = validateInput(html, maxBytes);
  const parseIssues: ParseIssue[] = [];
  const document = parse(html, {
    onParseError: (error) => {
      if (parseIssues.length < MAX_PARSE_ISSUES) {
        parseIssues.push({
          code: error.code,
          line: error.startLine,
          column: error.startCol,
        });
      }
    },
  });

  const head = findFirst(document, byTag('head'));
  const body = findFirst(document, byTag('body')) ?? document;
  const htmlElement = findFirst(document, byTag('html'));
  const titleElement = findFirst(document, byTag('title'));
  const title =
    titleElement === null
      ? null
      : truncate(normalizeWhitespace(textOf(titleElement, new Set())), 300);
  const description =
    head === null ? null : truncate(metaContent(head, 'name', 'description') ?? '', 500);
  const metaRobots = head === null ? null : metaContent(head, 'name', 'robots');
  const viewport = head === null ? null : metaContent(head, 'name', 'viewport');
  const lang =
    htmlElement === null ? null : normalizeWhitespace(attribute(htmlElement, 'lang') ?? '');
  const canonicalLinks = findAll(
    document,
    (element) => element.tagName === 'link' && relTokens(element).includes('canonical'),
  );
  const canonicalUrl =
    canonicalLinks[0] === undefined ? null : (attribute(canonicalLinks[0], 'href') ?? '').trim();
  const sitemapLinkElement = findFirst(
    document,
    (element) => element.tagName === 'link' && relTokens(element).includes('sitemap'),
  );
  const sitemapLink =
    sitemapLinkElement === null ? null : (attribute(sitemapLinkElement, 'href') ?? '').trim();
  const h1s = findAll(body, byTag('h1'));
  const h2s = findAll(body, byTag('h2'));
  const hasMain = findFirst(body, (element) => element.tagName === 'main') !== null;
  const hasArticle = findFirst(body, (element) => element.tagName === 'article') !== null;
  const jsonLd = collectJsonLd(document);
  const links = classifyLinks(body);
  const images = findAll(body, byTag('img'));
  const imagesMissingAlt = images.filter((image) => attribute(image, 'alt') === null).length;
  const imagesWithEmptyAlt = images.filter((image) => attribute(image, 'alt') === '').length;
  const scriptCount = findAll(
    document,
    (element) =>
      element.tagName === 'script' &&
      (attribute(element, 'type') ?? '').trim().toLowerCase() !== 'application/ld+json',
  ).length;
  const visibleText = normalizeWhitespace(textOf(body));
  const metaAuthor = head === null ? null : metaContent(head, 'name', 'author');
  const relAuthor = findAll(
    document,
    (element) => element.tagName === 'link' && relTokens(element).includes('author'),
  ).map((element) => attribute(element, 'href') ?? '');
  const timeSignals = findAll(body, byTag('time'))
    .map((element) => attribute(element, 'datetime') ?? '')
    .filter((value) => value.length > 0);
  const metaPublished =
    head === null ? null : metaContent(head, 'property', 'article:published_time');
  const metaModified =
    head === null ? null : metaContent(head, 'property', 'article:modified_time');
  const authorSignals = uniqueLimited([
    ...(metaAuthor === null ? [] : [metaAuthor]),
    ...relAuthor,
    ...jsonLd.authorSignals,
  ]);
  const dateSignals = uniqueLimited([
    ...timeSignals,
    ...(metaPublished === null ? [] : [metaPublished]),
    ...(metaModified === null ? [] : [metaModified]),
    ...jsonLd.dateSignals,
  ]);

  const robotsTokens = (metaRobots ?? '')
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((token) => token.length > 0);
  const noindex = robotsTokens.includes('noindex') || robotsTokens.includes('none');
  const nofollow = robotsTokens.includes('nofollow') || robotsTokens.includes('none');

  const findings: WebsiteFinding[] = [];
  if (title === null || title.length === 0) {
    findings.push(
      finding(
        'title_missing',
        'LIKELY_DISCOVERABILITY_ISSUE',
        'METADATA',
        'No document title was found',
        'The supplied HTML has no non-empty <title> element.',
        'A title is a basic human-readable and machine-readable signal. Its absence can make a page harder to identify.',
        'Add a concise, accurate title that names the subject of the page.',
        'head > title',
      ),
    );
  }
  if (description === null || description.length === 0) {
    findings.push(
      finding(
        'meta_description_missing',
        'INFORMATIONAL',
        'METADATA',
        'No meta description was found',
        'The supplied HTML has no non-empty meta description.',
        'A meta description is not guaranteed to be used by any search or AI system, but it can help describe the page consistently.',
        'Add an accurate description of the page subject and scope if one is appropriate.',
        'head > meta[name="description"]',
      ),
    );
  }
  if (noindex) {
    findings.push(
      finding(
        'meta_robots_noindex',
        'BLOCKING',
        'INDEXABILITY',
        'The document declares noindex',
        `The meta robots value is "${metaRobots ?? ''}", which includes noindex/none.`,
        'Compliant crawlers should not index the page when this directive is served. Aporia inspected only the supplied HTML, not live headers or robots.txt.',
        'Remove noindex only if the page is intended to be publicly discoverable and the owner approves that change.',
        'head > meta[name="robots"]',
      ),
    );
  }
  if (nofollow) {
    findings.push(
      finding(
        'meta_robots_nofollow',
        'LIKELY_DISCOVERABILITY_ISSUE',
        'INDEXABILITY',
        'The document declares nofollow',
        `The meta robots value is "${metaRobots ?? ''}", which includes nofollow/none.`,
        'Compliant crawlers may not follow links from this page, which can weaken discovery paths for linked evidence.',
        'Review whether nofollow is intentional for this page and its evidence links.',
        'head > meta[name="robots"]',
      ),
    );
  }
  if (canonicalLinks.length === 0) {
    findings.push(
      finding(
        'canonical_missing',
        'HOUSEKEEPING',
        'METADATA',
        'No canonical link was declared',
        'No link element with rel="canonical" was found in the supplied HTML.',
        'A canonical link can identify the preferred URL when duplicate or variant pages exist. It is not a guarantee of indexing.',
        'If duplicate URL variants exist, declare one absolute canonical URL that matches the visible content.',
        'head > link[rel="canonical"]',
      ),
    );
  } else if (canonicalLinks.length > 1) {
    findings.push(
      finding(
        'canonical_multiple',
        'EVIDENCE_CLARITY',
        'METADATA',
        'Multiple canonical links were declared',
        `${canonicalLinks.length} link elements declare rel="canonical".`,
        'Conflicting canonical declarations make the preferred URL ambiguous.',
        'Keep exactly one canonical link for the page and remove conflicting declarations.',
        'head > link[rel="canonical"]',
      ),
    );
  }
  if (canonicalUrl !== null && canonicalUrl.length > 0 && !validAbsoluteHttpUrl(canonicalUrl)) {
    findings.push(
      finding(
        'canonical_invalid',
        'EVIDENCE_CLARITY',
        'METADATA',
        'The canonical link is not an absolute HTTP(S) URL',
        `The canonical value is "${truncate(canonicalUrl, 300)}".`,
        'Relative or non-HTTP canonical values are ambiguous or unsupported for this purpose.',
        'Use one absolute HTTP or HTTPS URL with no embedded credentials.',
        'head > link[rel="canonical"]',
      ),
    );
  }
  if (sitemapLink !== null && sitemapLink.length > 0 && !validAbsoluteHttpUrl(sitemapLink)) {
    findings.push(
      finding(
        'sitemap_link_invalid',
        'HOUSEKEEPING',
        'METADATA',
        'The sitemap link is not an absolute HTTP(S) URL',
        `The declared sitemap value is "${truncate(sitemapLink, 300)}".`,
        'A sitemap link that is not an absolute HTTP or HTTPS URL cannot be used as declared. Aporia did not retrieve it.',
        'Declare an absolute HTTP or HTTPS sitemap URL or remove the invalid link.',
        'head > link[rel="sitemap"]',
      ),
    );
  }
  if (lang === null || lang.length === 0) {
    findings.push(
      finding(
        'lang_missing',
        'HOUSEKEEPING',
        'ACCESSIBILITY',
        'No document language was declared',
        'The html element has no non-empty lang attribute.',
        'A declared language helps assistive technology, search systems, and readers interpret the page.',
        'Add a valid lang attribute such as "en" or "en-GB" to the html element.',
        'html[lang]',
      ),
    );
  }
  if (viewport === null || viewport.length === 0) {
    findings.push(
      finding(
        'viewport_missing',
        'INFORMATIONAL',
        'ACCESSIBILITY',
        'No viewport metadata was found',
        'No non-empty meta viewport value was found.',
        'Viewport metadata supports readable mobile presentation; it does not by itself affect indexing.',
        'Add appropriate viewport metadata if the page is intended for mobile readers.',
        'head > meta[name="viewport"]',
      ),
    );
  }
  if (h1s.length === 0) {
    findings.push(
      finding(
        'h1_missing',
        'EVIDENCE_CLARITY',
        'CONTENT',
        'No level-one heading was found',
        'The supplied HTML has no <h1> element.',
        'A clear main heading helps readers identify the subject and scope of the page.',
        'Add one descriptive main heading that matches the page content.',
        'body h1',
      ),
    );
  } else if (h1s.length > 1) {
    findings.push(
      finding(
        'h1_multiple',
        'HOUSEKEEPING',
        'CONTENT',
        'Multiple level-one headings were found',
        `${h1s.length} <h1> elements were found.`,
        'Multiple main headings can make the page hierarchy ambiguous, although HTML permits them.',
        'Use one primary heading and subordinate headings where possible.',
        'body h1',
      ),
    );
  }
  if (!hasMain && !hasArticle) {
    findings.push(
      finding(
        'main_region_missing',
        'INFORMATIONAL',
        'CONTENT',
        'No main or article region was found',
        'The supplied HTML has neither a <main> nor an <article> element.',
        'Landmark regions improve structure for readers and assistive technology; they are not a direct indexing signal.',
        'Wrap the primary content in a main or article element if appropriate.',
        'body main, body article',
      ),
    );
  }
  if (jsonLd.blockCount === 0) {
    findings.push(
      finding(
        'structured_data_missing',
        'INFORMATIONAL',
        'STRUCTURED_DATA',
        'No JSON-LD structured data was found',
        'No script element with type="application/ld+json" was found.',
        'Structured data can describe entities and relationships, but it is not proof of truth and does not guarantee indexing or citations.',
        'If accurate structured data would help describe visible content, add a JSON-LD candidate and validate it.',
        'script[type="application/ld+json"]',
      ),
    );
  }
  if (jsonLd.invalidCount > 0) {
    findings.push(
      finding(
        'structured_data_invalid',
        'EVIDENCE_CLARITY',
        'STRUCTURED_DATA',
        'Some JSON-LD blocks are not valid JSON',
        `${jsonLd.invalidCount} of ${jsonLd.blockCount} JSON-LD block(s) failed to parse.`,
        'Invalid structured data cannot be interpreted reliably and may be ignored.',
        'Correct the JSON syntax and validate the structured data before publishing.',
        'script[type="application/ld+json"]',
      ),
    );
  }
  if (jsonLd.names.length > 0 && visibleText.length > 0) {
    const normalizedVisibleText = visibleText.toLowerCase();
    const missingValues = jsonLd.names.filter(
      (entry) => !normalizedVisibleText.includes(normalizeWhitespace(entry.value).toLowerCase()),
    );
    if (missingValues.length > 0) {
      findings.push(
        finding(
          'structured_data_mismatch',
          'EVIDENCE_CLARITY',
          'STRUCTURED_DATA',
          'Structured data values were not found in visible text',
          `${missingValues.length} declared name/headline value(s) were not found in the supplied visible text: ${uniqueLimited(
            missingValues.map((entry) => entry.value),
            5,
          ).join('; ')}.`,
          'Structured data should describe visible page content. A mismatch can misrepresent the page even when the JSON is valid.',
          'Align the structured data with the visible page or correct the page content; do not add claims that the page does not support.',
          'script[type="application/ld+json"]',
        ),
      );
    }
  }
  if (authorSignals.length === 0) {
    findings.push(
      finding(
        'author_signal_missing',
        'EVIDENCE_CLARITY',
        'AUTHORSHIP',
        'No author or publisher signal was found',
        'No meta author, rel=author link, or JSON-LD author/creator/publisher name was found.',
        'Clear authorship and publisher information helps readers and attribution assessments identify who is responsible for the page.',
        'Add accurate author or publisher information that the page visibly supports.',
        'head meta[name="author"], link[rel="author"], JSON-LD author',
      ),
    );
  }
  if (dateSignals.length === 0) {
    findings.push(
      finding(
        'date_signal_missing',
        'EVIDENCE_CLARITY',
        'DATES',
        'No publication or update date signal was found',
        'No time element, article date metadata, or JSON-LD date property was found.',
        'Dates and versions help readers interpret time-sensitive claims and compare later evidence.',
        'Add an accurate publication or update date that matches the visible content.',
        'time[datetime], meta[property="article:published_time"], JSON-LD datePublished',
      ),
    );
  }
  if (links.unsafe > 0) {
    findings.push(
      finding(
        'unsafe_link_schemes',
        'HOUSEKEEPING',
        'LINKS',
        'Unsafe link schemes were found',
        `${links.unsafe} link(s) use javascript:, data:, or vbscript: URLs.`,
        'Active-content link schemes can create security and accessibility risks and are not useful evidence links.',
        'Replace unsafe links with normal HTTP or HTTPS references, or remove them.',
        'body a[href]',
      ),
    );
  }
  if (imagesMissingAlt > 0) {
    findings.push(
      finding(
        'image_alt_missing',
        'HOUSEKEEPING',
        'ACCESSIBILITY',
        'Some images have no alt attribute',
        `${imagesMissingAlt} of ${images.length} image(s) have no alt attribute.`,
        'Alternative text supports readers who cannot see images. Decorative images should use an explicit empty alt.',
        'Add meaningful alt text or an explicit empty alt for decorative images.',
        'body img',
      ),
    );
  }
  if (visibleText.length < 200 && scriptCount > 0) {
    findings.push(
      finding(
        'content_may_require_javascript',
        'LIKELY_DISCOVERABILITY_ISSUE',
        'CONTENT',
        'Meaningful content may depend on JavaScript',
        `The supplied HTML contains ${visibleText.length} characters of visible text and ${scriptCount} script element(s). This is a disclosed heuristic, not a rendering test.`,
        'Systems that inspect HTML without executing scripts may see little content. Some crawlers execute scripts and some do not; Aporia did not run the page.',
        'Ensure the core claim and evidence are present in the initial HTML when possible, without hiding content solely in script-rendered interfaces.',
        'body text, script',
      ),
    );
  }
  if (parseIssues.length > 0) {
    findings.push(
      finding(
        'html_parse_issues',
        'INFORMATIONAL',
        'CONTENT',
        'The HTML parser reported issues',
        `${parseIssues.length} parser issue(s) were recorded; the first is "${parseIssues[0]?.code ?? 'unknown'}".`,
        'The parser recovered from these issues, but malformed markup can cause inconsistent interpretation.',
        'Validate the HTML and fix structural errors where practical.',
        'document',
      ),
    );
  }

  const metadata: WebsiteMetadata = {
    title,
    description: description === null || description.length === 0 ? null : description,
    lang: lang === null || lang.length === 0 ? null : lang,
    viewport,
    metaRobots,
    canonicalUrl: canonicalUrl === null || canonicalUrl.length === 0 ? null : canonicalUrl,
    canonicalCount: canonicalLinks.length,
    sitemapLink: sitemapLink === null || sitemapLink.length === 0 ? null : sitemapLink,
    h1Count: h1s.length,
    h1Texts: uniqueLimited(
      h1s.map((element) => textOf(element)),
      5,
    ),
    h2Count: h2s.length,
    hasMain,
    hasArticle,
    jsonLdBlockCount: jsonLd.blockCount,
    jsonLdValidCount: jsonLd.validCount,
    authorSignals,
    dateSignals,
    linkCount: links.total,
    relativeLinkCount: links.relative,
    httpLinkCount: links.http,
    mailtoLinkCount: links.mailto,
    otherLinkCount: links.other,
    unsafeSchemeLinkCount: links.unsafe,
    imageCount: images.length,
    imagesMissingAlt,
    imagesWithEmptyAlt,
    visibleTextLength: visibleText.length,
    scriptCount,
  };

  return {
    version: WEBSITE_AUDIT_VERSION,
    contentHash: createHash('sha256').update(html, 'utf8').digest('hex'),
    byteLength,
    metadata,
    findings,
    unavailableChecks: NETWORK_DEPENDENT_CHECKS,
    parseIssues,
  };
}
