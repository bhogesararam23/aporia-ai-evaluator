import {
  ACHIEVEMENT_CLAIM_SUPPORT_STATE_LABELS,
  ACHIEVEMENT_CONTRIBUTOR_SUPPORT_STATE_LABELS,
  type AchievementClaimSnapshot,
  type AchievementContradictionSnapshot,
  type AchievementContributorSnapshot,
  type AchievementEvidenceSnapshot,
} from '../core/achievements.ts';
import { ATTRIBUTION_ROLE_LABELS, PROPOSITION_STATUS_LABELS } from '../core/vocabulary.ts';

export interface AchievementExportInput {
  readonly title: string;
  readonly summary: string;
  readonly projectName: string;
  readonly projectDescription: string | null;
  readonly projectUrl: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly claims: readonly AchievementClaimSnapshot[];
  readonly contributors: readonly AchievementContributorSnapshot[];
  readonly evidence: readonly AchievementEvidenceSnapshot[];
  readonly unresolvedContradictions: readonly AchievementContradictionSnapshot[];
  readonly revisionNumber: number;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly approvalNote: string;
}

export class AchievementExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AchievementExportError';
  }
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeHttpUrl(raw: string | null): string | null {
  if (raw === null || raw.trim().length === 0) {
    return null;
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (parsed.username !== '' || parsed.password !== '') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function link(url: string | null, label: string): string {
  const href = safeHttpUrl(url);
  if (href === null) {
    return `<span>${escapeHtml(label)}</span>`;
  }
  return `<a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow">${escapeHtml(label)}</a>`;
}

function dateText(value: string | null): string {
  return value === null ? 'Not stated' : value;
}

function contributorType(role: string): 'Organization' | 'Person' {
  return role === 'ORGANIZATION' ? 'Organization' : 'Person';
}

export function buildAchievementJsonLd(input: AchievementExportInput): Record<string, unknown> {
  const evidenceUrls = Array.from(
    new Set(
      input.evidence
        .map((item) => safeHttpUrl(item.sourceUrl))
        .filter((url): url is string => url !== null),
    ),
  );
  const projectUrl = safeHttpUrl(input.projectUrl);
  const contributors = input.contributors.map((contributor) => ({
    '@type': 'Role',
    roleName: ATTRIBUTION_ROLE_LABELS[contributor.role],
    description: contributor.contribution,
    contributor: {
      '@type': contributorType(contributor.role),
      name: contributor.name,
    },
  }));
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: input.title,
    headline: input.title,
    description: input.summary,
    dateCreated: input.startDate ?? input.createdAt,
    dateModified: input.createdAt,
    contributor: contributors,
    about: {
      '@type': 'CreativeWork',
      name: input.projectName,
      ...(input.projectDescription === null ? {} : { description: input.projectDescription }),
      ...(projectUrl === null ? {} : { url: projectUrl }),
    },
    citation: evidenceUrls,
    creativeWorkStatus: 'Approved for local publication',
    identifier: `sha256:${input.contentHash}`,
    disambiguatingDescription:
      'Owner-supplied achievement record. Evidence links are reviewer records, not independent verification.',
    additionalProperty: [
      ...input.claims.map((claim, index) => ({
        '@type': 'PropertyValue',
        name: `Claim ${index + 1} evidence state`,
        value: PROPOSITION_STATUS_LABELS[claim.evidenceStatus],
      })),
      ...input.contributors.map((contributor) => ({
        '@type': 'PropertyValue',
        name: `${contributor.name} contribution state`,
        value: ACHIEVEMENT_CONTRIBUTOR_SUPPORT_STATE_LABELS[contributor.supportState],
      })),
      {
        '@type': 'PropertyValue',
        name: 'Revision',
        value: String(input.revisionNumber),
      },
      {
        '@type': 'PropertyValue',
        name: 'Approved by',
        value: input.approvedBy,
      },
      {
        '@type': 'PropertyValue',
        name: 'Approval note',
        value: input.approvalNote,
      },
    ],
  };
}

export function renderAchievementHtml(input: AchievementExportInput): string {
  const jsonLd = buildAchievementJsonLd(input);
  const script = JSON.stringify(jsonLd, null, 2).replaceAll('<', '\\u003c');
  const contributors = input.contributors
    .map(
      (contributor) => `<li>
        <strong>${escapeHtml(contributor.name)}</strong> — ${escapeHtml(ATTRIBUTION_ROLE_LABELS[contributor.role])}.
        ${escapeHtml(contributor.contribution)}
        <span class="state">${escapeHtml(ACHIEVEMENT_CONTRIBUTOR_SUPPORT_STATE_LABELS[contributor.supportState])}</span>
        ${contributor.evidenceNote === null ? '' : `<div class="note">Evidence note: ${escapeHtml(contributor.evidenceNote)}</div>`}
      </li>`,
    )
    .join('');
  const claims = input.claims
    .map(
      (claim) => `<li>
        <p>${escapeHtml(claim.claimText)}</p>
        <dl>
          <dt>Recorded evidence state</dt><dd>${escapeHtml(PROPOSITION_STATUS_LABELS[claim.evidenceStatus])}</dd>
          <dt>Support state</dt><dd>${escapeHtml(ACHIEVEMENT_CLAIM_SUPPORT_STATE_LABELS[claim.supportState])}</dd>
          <dt>Human assessment</dt><dd>${claim.humanAssessmentStatus === null ? 'No human assessment recorded' : escapeHtml(PROPOSITION_STATUS_LABELS[claim.humanAssessmentStatus])}</dd>
          <dt>Relationships recorded</dt><dd>${claim.evidenceRelationshipCount}</dd>
        </dl>
      </li>`,
    )
    .join('');
  const evidence = input.evidence
    .map(
      (item) => `<li>
        ${link(item.sourceUrl, item.sourceTitle)}
        ${item.evidenceLocator === null ? '' : ` — ${escapeHtml(item.evidenceLocator)}`}
        ${item.evidenceExcerptDigest === null ? '' : `<div class="note">Excerpt digest: <code>${escapeHtml(item.evidenceExcerptDigest)}</code></div>`}
        ${item.note === null ? '' : `<div class="note">${escapeHtml(item.note)}</div>`}
      </li>`,
    )
    .join('');
  const contradictions =
    input.unresolvedContradictions.length === 0
      ? '<p>None recorded in this revision.</p>'
      : `<ul>${input.unresolvedContradictions
          .map(
            (contradiction) =>
              `<li><strong>${escapeHtml(contradiction.claimText)}</strong><div class="note">${escapeHtml(contradiction.reason)}</div></li>`,
          )
          .join('')}</ul>`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<script type="application/ld+json">
${script}
</script>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:52rem;margin:0 auto;padding:2rem;color:#1d2430;background:#fff}
h1,h2,h3{line-height:1.2}h2{margin-top:2rem;border-bottom:1px solid #d9dee8;padding-bottom:.25rem}
.status{display:inline-block;padding:.2rem .5rem;border:1px solid #2d6a4f;color:#2d6a4f;border-radius:.3rem;font-size:.85rem}
.summary{font-size:1.1rem}.disclaimer,.note{color:#4a5568;font-size:.9rem}
dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem}dt{font-weight:600}dd{margin:0}
ul{padding-left:1.25rem}li{margin:.6rem 0}.state{display:inline-block;margin-left:.4rem;padding:.1rem .35rem;border:1px solid #8a94a6;border-radius:.25rem;font-size:.8rem}
footer{margin-top:2rem;border-top:1px solid #d9dee8;padding-top:1rem;color:#4a5568;font-size:.85rem}
code{overflow-wrap:anywhere}
</style>
</head>
<body>
<main>
<header>
<p class="status">Approved for local publication · revision ${input.revisionNumber}</p>
<h1>${escapeHtml(input.title)}</h1>
<p class="summary">${escapeHtml(input.summary)}</p>
<p class="disclaimer">Owner-supplied local record. Evidence labels summarize reviewer records; they are not independent verification. This file has not been published by Aporia.</p>
</header>
<section>
<h2>Project</h2>
<h3>${escapeHtml(input.projectName)}</h3>
${input.projectDescription === null ? '' : `<p>${escapeHtml(input.projectDescription)}</p>`}
${input.projectUrl === null ? '' : `<p>${link(input.projectUrl, input.projectUrl)}</p>`}
<p>Start date: ${escapeHtml(dateText(input.startDate))} · End date: ${escapeHtml(dateText(input.endDate))} · Record created: ${escapeHtml(input.createdAt)}</p>
</section>
<section>
<h2>Contributors and roles</h2>
<ul>${contributors}</ul>
</section>
<section>
<h2>Claims and recorded evidence</h2>
<ol>${claims}</ol>
</section>
<section>
<h2>Evidence sources</h2>
<ul>${evidence.length === 0 ? '<li>No source records were linked.</li>' : evidence}</ul>
</section>
<section>
<h2>Unresolved contradictions</h2>
${contradictions}
</section>
<footer>
<p>Revision ${input.revisionNumber} · content hash <code>${escapeHtml(input.contentHash)}</code></p>
<p>Approved by ${escapeHtml(input.approvedBy)} at ${escapeHtml(input.approvedAt)}.</p>
<p>Approval note: ${escapeHtml(input.approvalNote)}</p>
</footer>
</main>
</body>
</html>
`;

  const problems = validateAchievementExport(input, html, jsonLd);
  if (problems.length > 0) {
    throw new AchievementExportError(problems.join(' '));
  }
  return html;
}

export function renderAchievementJsonLd(input: AchievementExportInput): string {
  return `${JSON.stringify(buildAchievementJsonLd(input), null, 2)}\n`;
}

/**
 * The structured data must describe the same values a reader can see. These checks are textual
 * containment after the same escaping used by the HTML renderer; they catch a generator change
 * that adds a JSON-LD field but forgets its visible counterpart, not semantic inaccuracy.
 */
export function validateAchievementExport(
  input: AchievementExportInput,
  html: string,
  jsonLd: Record<string, unknown>,
): string[] {
  const problems: string[] = [];
  const visible = (value: string): boolean => html.includes(escapeHtml(value));
  if (jsonLd['name'] !== input.title || jsonLd['headline'] !== input.title) {
    problems.push('The JSON-LD name/headline does not match the revision title.');
  }
  if (jsonLd['description'] !== input.summary) {
    problems.push('The JSON-LD description does not match the revision summary.');
  }
  if (!visible(input.title)) {
    problems.push('The visible content does not contain the title.');
  }
  if (!visible(input.summary)) {
    problems.push('The visible content does not contain the summary.');
  }
  if (!visible(input.projectName)) {
    problems.push('The visible content does not contain the project name.');
  }
  for (const contributor of input.contributors) {
    if (!visible(contributor.name)) {
      problems.push(`The visible content does not contain contributor ${contributor.name}.`);
    }
    if (!visible(ATTRIBUTION_ROLE_LABELS[contributor.role])) {
      problems.push(`The visible content does not contain role ${contributor.role}.`);
    }
  }
  for (const item of input.evidence) {
    const href = safeHttpUrl(item.sourceUrl);
    if (href !== null && !visible(href)) {
      problems.push(`The visible content does not contain evidence URL ${href}.`);
    }
  }
  if (!visible(String(input.revisionNumber))) {
    problems.push('The visible content does not contain the revision number.');
  }
  if (!visible(input.contentHash)) {
    problems.push('The visible content does not contain the content hash.');
  }
  if (!visible(input.approvedBy) || !visible(input.approvalNote)) {
    problems.push('The visible content does not contain the approval metadata.');
  }
  if (!visible('Approved for local publication')) {
    problems.push('The visible content does not contain the publication status.');
  }
  const created = input.startDate ?? input.createdAt;
  if (!visible(created) || !visible(input.createdAt)) {
    problems.push('The visible content does not contain the dates used in the JSON-LD.');
  }
  return problems;
}
