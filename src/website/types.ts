export const WEBSITE_AUDIT_VERSION = 'local-html-audit-v1';

export const FINDING_SEVERITIES = [
  'BLOCKING',
  'LIKELY_DISCOVERABILITY_ISSUE',
  'EVIDENCE_CLARITY',
  'HOUSEKEEPING',
  'INFORMATIONAL',
] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const FINDING_SEVERITY_LABELS: Record<FindingSeverity, string> = {
  BLOCKING: 'Blocking',
  LIKELY_DISCOVERABILITY_ISSUE: 'Likely discoverability issue',
  EVIDENCE_CLARITY: 'Evidence or clarity issue',
  HOUSEKEEPING: 'Housekeeping',
  INFORMATIONAL: 'Informational',
};

export const FINDING_CATEGORIES = [
  'ACCESS',
  'INDEXABILITY',
  'METADATA',
  'STRUCTURED_DATA',
  'CONTENT',
  'LINKS',
  'ACCESSIBILITY',
  'AUTHORSHIP',
  'DATES',
  'NETWORK',
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export interface WebsiteFinding {
  readonly code: string;
  readonly severity: FindingSeverity;
  readonly category: FindingCategory;
  readonly title: string;
  readonly observation: string;
  readonly rationale: string;
  readonly recommendation: string;
  readonly locator: string;
}

export interface UnavailableCheck {
  readonly code: string;
  readonly label: string;
  readonly reason: string;
}

export interface WebsiteMetadata {
  readonly title: string | null;
  readonly description: string | null;
  readonly lang: string | null;
  readonly viewport: string | null;
  readonly metaRobots: string | null;
  readonly canonicalUrl: string | null;
  readonly canonicalCount: number;
  readonly sitemapLink: string | null;
  readonly h1Count: number;
  readonly h1Texts: readonly string[];
  readonly h2Count: number;
  readonly hasMain: boolean;
  readonly hasArticle: boolean;
  readonly jsonLdBlockCount: number;
  readonly jsonLdValidCount: number;
  readonly authorSignals: readonly string[];
  readonly dateSignals: readonly string[];
  readonly linkCount: number;
  readonly relativeLinkCount: number;
  readonly httpLinkCount: number;
  readonly mailtoLinkCount: number;
  readonly otherLinkCount: number;
  readonly unsafeSchemeLinkCount: number;
  readonly imageCount: number;
  readonly imagesMissingAlt: number;
  readonly imagesWithEmptyAlt: number;
  readonly visibleTextLength: number;
  readonly scriptCount: number;
}

export interface ParseIssue {
  readonly code: string;
  readonly line: number;
  readonly column: number;
}

export interface WebsiteAnalysis {
  readonly version: string;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly metadata: WebsiteMetadata;
  readonly findings: readonly WebsiteFinding[];
  readonly unavailableChecks: readonly UnavailableCheck[];
  readonly parseIssues: readonly ParseIssue[];
}

export type WebsiteAnalysisErrorCode = 'EMPTY' | 'TOO_LARGE' | 'BINARY' | 'INVALID_ENCODING';

export class WebsiteAnalysisError extends Error {
  readonly code: WebsiteAnalysisErrorCode;

  constructor(code: WebsiteAnalysisErrorCode, message: string) {
    super(message);
    this.name = 'WebsiteAnalysisError';
    this.code = code;
  }
}

export const NETWORK_DEPENDENT_CHECKS: readonly UnavailableCheck[] = [
  {
    code: 'HTTP_REACHABILITY',
    label: 'Page reachability and HTTP status',
    reason: 'Network access is disabled in local v0.1; this check was not performed.',
  },
  {
    code: 'ROBOTS_TXT',
    label: 'robots.txt retrieval and named-user-agent rules',
    reason: 'Network access is disabled in local v0.1; this check was not performed.',
  },
  {
    code: 'SITEMAP_RETRIEVAL',
    label: 'Sitemap retrieval and inclusion',
    reason: 'Network access is disabled in local v0.1; this check was not performed.',
  },
  {
    code: 'CANONICALIZATION',
    label: 'Live redirects and canonicalization',
    reason: 'Network access is disabled in local v0.1; this check was not performed.',
  },
  {
    code: 'TLS',
    label: 'TLS and transport security',
    reason: 'Network access is disabled in local v0.1; this check was not performed.',
  },
  {
    code: 'INDEX_STATUS',
    label: 'Search or provider index status',
    reason: 'Network access is disabled in local v0.1; no provider index was queried.',
  },
  {
    code: 'CACHE_STATUS',
    label: 'Provider caching or model memory',
    reason:
      'No external provider is integrated in local v0.1; no cache or memory state was observed.',
  },
  {
    code: 'LINK_HEALTH',
    label: 'Outbound evidence link health',
    reason: 'Network access is disabled in local v0.1; links were not requested.',
  },
  {
    code: 'CRAWLER_ACCESS',
    label: 'Live crawler access for named user agents',
    reason: 'No crawler request was made; only in-document directives were inspected.',
  },
  {
    code: 'RENDERED_CONTENT',
    label: 'Browser-rendered content and client-side routes',
    reason: 'Scripts were not executed; only the supplied HTML bytes were inspected.',
  },
  {
    code: 'PROVIDER_CITATION',
    label: 'Provider citations, rankings, or recommendations',
    reason:
      'No external provider is integrated in local v0.1; no citation or ranking was observed.',
  },
];
