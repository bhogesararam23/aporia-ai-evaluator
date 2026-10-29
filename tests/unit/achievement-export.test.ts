import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAchievementJsonLd,
  renderAchievementHtml,
  renderAchievementJsonLd,
  validateAchievementExport,
  type AchievementExportInput,
} from '../../src/reporting/achievement.ts';

function fixture(overrides: Partial<AchievementExportInput> = {}): AchievementExportInput {
  return {
    title: 'Ram <built> "Aporia"',
    summary: 'Evidence & a <script>alert("x")</script> summary.',
    projectName: 'Aporia & Co',
    projectDescription: 'A local project.',
    projectUrl: 'https://example.com/project',
    startDate: '2026-01-01',
    endDate: '2026-02-01',
    claims: [
      {
        claimId: 'clm_1',
        claimRevisionId: 'rev_1',
        ordinal: 1,
        claimText: 'The <project> exists.',
        evidenceStatus: 'SUPPORTED_WITHIN_SCOPE',
        supportState: 'EVIDENCE_RECORDED',
        humanAssessmentStatus: null,
        evidenceRelationshipCount: 1,
        note: null,
      },
    ],
    contributors: [
      {
        ordinal: 1,
        name: 'Ram & <Co>',
        role: 'AUTHOR',
        contribution: 'Built <it>.',
        supportState: 'EVIDENCE_LINKED',
        evidenceNote: 'Release & test log.',
      },
    ],
    evidence: [
      {
        ordinal: 1,
        sourceId: 'src_1',
        evidenceId: 'evd_1',
        sourceTitle: 'Release <1>',
        sourceUrl: 'https://example.com/release',
        evidenceLocator: 'README',
        evidenceExcerptDigest: 'a'.repeat(64),
        note: null,
      },
    ],
    unresolvedContradictions: [
      {
        claimId: 'clm_1',
        claimText: 'The <project> exists.',
        reason: 'Recorded support and contradiction coexist.',
      },
    ],
    revisionNumber: 1,
    contentHash: 'b'.repeat(64),
    createdAt: '2026-10-30T10:00:00.000Z',
    approvedBy: 'Ram',
    approvedAt: '2026-10-30T11:00:00.000Z',
    approvalNote: 'Reviewed & approved.',
    ...overrides,
  };
}

function scriptJson(html: string): { text: string; json: Record<string, unknown> } {
  const match = /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/.exec(html);
  assert.ok(match?.[1], 'expected an embedded JSON-LD script');
  const text = match[1];
  return { text, json: JSON.parse(text) as Record<string, unknown> };
}

test('the HTML export escapes user content and embeds matching JSON-LD', () => {
  const input = fixture();
  const html = renderAchievementHtml(input);
  const { text, json } = scriptJson(html);

  assert.match(html, /Ram &lt;built&gt; &quot;Aporia&quot;/);
  assert.doesNotMatch(html, /<script>alert\("x"\)<\/script>/);
  assert.ok(!text.includes('</script>'), 'the JSON-LD payload can break out of its script element');
  assert.equal(json['name'], input.title);
  assert.equal(json['headline'], input.title);
  assert.equal(json['description'], input.summary);
  assert.equal(json['creativeWorkStatus'], 'Approved for local publication');
  assert.equal(json['identifier'], `sha256:${input.contentHash}`);
  assert.deepEqual(validateAchievementExport(input, html, json), []);
});

test('the JSON-LD download exposes roles, evidence URLs and approval metadata', () => {
  const input = fixture();
  const json = JSON.parse(renderAchievementJsonLd(input)) as Record<string, unknown>;

  const contributors = json['contributor'] as Array<Record<string, unknown>>;
  assert.equal(contributors[0]?.['roleName'], 'Author');
  assert.deepEqual(json['citation'], ['https://example.com/release']);
  const properties = json['additionalProperty'] as Array<Record<string, unknown>>;
  assert.ok(properties.some((property) => property['name'] === 'Approved by'));
  assert.equal(json['@context'], 'https://schema.org');
});

test('the consistency check rejects a visible title that does not match the JSON-LD', () => {
  const input = fixture({ title: 'Unique title' });
  const html = renderAchievementHtml(input);
  const { json } = scriptJson(html);
  const tampered = html.replaceAll('Unique title', 'Another achievement');
  const problems = validateAchievementExport(input, tampered, json);
  assert.ok(
    problems.some((problem) => /title/.test(problem)),
    problems.join(' '),
  );
});

test('the generator refuses an internally inconsistent structured/visible pair', () => {
  const input = fixture();
  const html = renderAchievementHtml(input);
  const json = buildAchievementJsonLd(input);
  const broken = { ...json, name: 'A different name' };
  const problems = validateAchievementExport(input, html, broken);
  assert.ok(
    problems.some((problem) => /name\/headline/.test(problem)),
    problems.join(' '),
  );
});

test('an active URL is shown as text rather than a link and is omitted from citations', () => {
  const input = fixture({ projectUrl: 'javascript:alert(1)' });
  const html = renderAchievementHtml(input);
  const json = JSON.parse(renderAchievementJsonLd(input)) as Record<string, unknown>;

  assert.doesNotMatch(html, /href="javascript:/);
  const about = json['about'] as Record<string, unknown>;
  assert.equal('url' in about, false);

  const unsafeEvidence = fixture({
    evidence: [
      {
        ordinal: 1,
        sourceId: 'src_1',
        evidenceId: 'evd_1',
        sourceTitle: 'Unsafe source',
        sourceUrl: 'javascript:alert(1)',
        evidenceLocator: 'README',
        evidenceExcerptDigest: 'a'.repeat(64),
        note: null,
      },
    ],
  });
  const unsafeHtml = renderAchievementHtml(unsafeEvidence);
  const unsafeJson = JSON.parse(renderAchievementJsonLd(unsafeEvidence)) as Record<string, unknown>;
  assert.doesNotMatch(unsafeHtml, /href="javascript:/);
  assert.deepEqual(unsafeJson['citation'], []);
});
