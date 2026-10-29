import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  insertClaimWithProposition,
  insertEvidenceWithRelation,
  insertProject,
  insertSource,
} from '../helpers/db.ts';
import {
  csrfFrom,
  getPage,
  locationOf,
  postForm,
  startTestServer,
  type TestServer,
} from '../helpers/http.ts';

function seed(server: TestServer): void {
  insertProject(server.db);
  insertClaimWithProposition(server.db);
  insertSource(server.db, { canonicalUri: 'https://example.com/release' });
  insertEvidenceWithRelation(server.db);
}

function fields(title = 'A documented achievement'): Record<string, string> {
  return {
    title,
    summary: 'A concise record of the work and its recorded evidence.',
    projectName: 'Aporia',
    projectDescription: 'The local evidence evaluator.',
    projectUrl: 'https://example.com/project',
    startDate: '2026-01-01',
    endDate: '2026-02-01',
    claim_clm_1: 'on',
    contributorLines: 'Ram | AUTHOR | Built the project. | EVIDENCE_LINKED | Release notes',
    source_src_1: 'on',
    evidence_evd_1: 'on',
  };
}

async function createDraft(server: TestServer, title?: string) {
  const page = await getPage(server, '/projects/prj_1/achievements/new');
  const response = await postForm(
    server,
    '/projects/prj_1/achievements',
    page.cookie,
    csrfFrom(page.text),
    fields(title),
  );
  assert.equal(response.status, 303, await response.text());
  const location = locationOf(response);
  const match = /\/achievements\/(ach_[^?]+)/.exec(location);
  assert.ok(match?.[1], location);
  return { id: match[1], cookie: page.cookie, location };
}

async function approve(server: TestServer, id: string, cookie: string, title: string) {
  const detail = await getPage(server, `/projects/prj_1/achievements/${id}`, cookie);
  const response = await postForm(
    server,
    `/projects/prj_1/achievements/${id}/approve`,
    cookie,
    csrfFrom(detail.text),
    { note: 'Reviewed the claims, roles and evidence links.', confirmation: title },
  );
  assert.equal(response.status, 303, await response.text());
}

test('a draft becomes publication-ready only after explicit approval and exports safely', async () => {
  const server = await startTestServer();
  try {
    seed(server);
    const draft = await createDraft(server);
    const detail = await getPage(server, `/projects/prj_1/achievements/${draft.id}`, draft.cookie);
    assert.match(detail.text, /Draft/);
    assert.match(detail.text, /Evidence relationships recorded/);
    assert.match(detail.text, /Author/);
    assert.match(detail.text, /Release notes/);
    assert.doesNotMatch(detail.text, /export\.html/);

    const refused = await getPage(
      server,
      `/projects/prj_1/achievements/${draft.id}/export.html`,
      draft.cookie,
    );
    assert.equal(refused.response.status, 409);
    assert.match(refused.text, /Approve the current revision/);

    await approve(server, draft.id, draft.cookie, 'A documented achievement');
    const approved = await getPage(
      server,
      `/projects/prj_1/achievements/${draft.id}`,
      draft.cookie,
    );
    assert.match(approved.text, /Approved for local publication/);
    assert.match(approved.text, /export\.html/);

    const html = await getPage(
      server,
      `/projects/prj_1/achievements/${draft.id}/export.html`,
      draft.cookie,
    );
    assert.equal(html.response.status, 200);
    assert.match(html.response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(html.response.headers.get('content-disposition') ?? '', /attachment/);
    assert.match(html.text, /application\/ld\+json/);
    assert.match(html.text, /A documented achievement/);

    const jsonld = await getPage(
      server,
      `/projects/prj_1/achievements/${draft.id}/export.jsonld`,
      draft.cookie,
    );
    assert.equal(jsonld.response.status, 200);
    assert.match(jsonld.response.headers.get('content-type') ?? '', /application\/ld\+json/);
    const parsed = JSON.parse(jsonld.text) as Record<string, unknown>;
    assert.equal(parsed['name'], 'A documented achievement');
    const contributors = parsed['contributor'] as Array<Record<string, unknown>>;
    assert.equal(contributors[0]?.['roleName'], 'Author');
    assert.deepEqual(parsed['citation'], ['https://example.com/release']);

    const actions = server.db
      .prepare('SELECT action FROM audit_events WHERE entity_id = ? ORDER BY rowid ASC')
      .all(draft.id)
      .map((row) => String(row['action']));
    assert.deepEqual(actions, [
      'achievement.created',
      'achievement.approved',
      'achievement.exported',
      'achievement.exported',
    ]);
  } finally {
    await server.close();
  }
});

test('a new revision is a draft again and the old revision is historical', async () => {
  const server = await startTestServer();
  try {
    seed(server);
    const draft = await createDraft(server);
    await approve(server, draft.id, draft.cookie, 'A documented achievement');
    const oldRevision = server.db
      .prepare(
        'SELECT id FROM achievement_revisions WHERE achievement_id = ? ORDER BY revision_number ASC LIMIT 1',
      )
      .get(draft.id)?.['id'];
    assert.ok(typeof oldRevision === 'string');

    const revisionPage = await getPage(
      server,
      `/projects/prj_1/achievements/${draft.id}/revisions/new`,
      draft.cookie,
    );
    const created = await postForm(
      server,
      `/projects/prj_1/achievements/${draft.id}/revisions`,
      draft.cookie,
      csrfFrom(revisionPage.text),
      fields('The revised achievement'),
    );
    assert.equal(created.status, 303, await created.text());

    const detail = await getPage(server, `/projects/prj_1/achievements/${draft.id}`, draft.cookie);
    assert.match(detail.text, /Draft/);
    assert.doesNotMatch(detail.text, /export\.html/);
    const refused = await getPage(
      server,
      `/projects/prj_1/achievements/${draft.id}/export.html`,
      draft.cookie,
    );
    assert.equal(refused.response.status, 409);

    const historical = await getPage(
      server,
      `/projects/prj_1/achievements/${draft.id}/revisions/${oldRevision}`,
      draft.cookie,
    );
    assert.match(historical.text, /historical revision/i);
  } finally {
    await server.close();
  }
});

test('a cross-project source is rejected and no record is written', async () => {
  const server = await startTestServer();
  try {
    seed(server);
    insertProject(server.db, { id: 'prj_2', name: 'Other project' });
    insertSource(server.db, { id: 'src_other', projectId: 'prj_2' });
    const page = await getPage(server, '/projects/prj_1/achievements/new');
    const response = await postForm(
      server,
      '/projects/prj_1/achievements',
      page.cookie,
      csrfFrom(page.text),
      { ...fields(), source_src_1: '', source_src_other: 'on' },
    );

    assert.equal(response.status, 422);
    assert.match(await response.text(), /does not belong to this project/);
    const count = server.db.prepare('SELECT COUNT(*) AS count FROM achievements').get();
    assert.equal(count?.['count'], 0);
  } finally {
    await server.close();
  }
});

test('user content is escaped in the preview page', async () => {
  const server = await startTestServer();
  try {
    seed(server);
    const draft = await createDraft(server, '<script>alert(1)</script>');
    const detail = await getPage(server, `/projects/prj_1/achievements/${draft.id}`, draft.cookie);

    assert.match(detail.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(detail.text, /<script>alert\(1\)<\/script>/);
  } finally {
    await server.close();
  }
});

test('the project export includes achievement records and revisions', async () => {
  const server = await startTestServer();
  try {
    seed(server);
    const draft = await createDraft(server);
    const exported = await getPage(server, '/projects/prj_1/export.json', draft.cookie);
    assert.equal(exported.response.status, 200);
    const data = JSON.parse(exported.text) as Record<string, unknown>;
    const achievements = data['achievements'] as Array<Record<string, unknown>>;
    assert.equal(achievements.length, 1);
    const revisions = achievements[0]?.['revisions'] as unknown[];
    assert.equal(revisions.length, 1);
  } finally {
    await server.close();
  }
});

test('achievement creation requires the session CSRF token', async () => {
  const server = await startTestServer();
  try {
    seed(server);
    const page = await getPage(server, '/projects/prj_1/achievements/new');
    const response = await postForm(
      server,
      '/projects/prj_1/achievements',
      page.cookie,
      csrfFrom(page.text),
      { ...fields(), _csrf: '' },
    );

    assert.equal(response.status, 403);
    const count = server.db.prepare('SELECT COUNT(*) AS count FROM achievements').get();
    assert.equal(count?.['count'], 0);
  } finally {
    await server.close();
  }
});

test('an approved revision cannot be approved twice', async () => {
  const server = await startTestServer();
  try {
    seed(server);
    const draft = await createDraft(server);
    await approve(server, draft.id, draft.cookie, 'A documented achievement');
    const formPage = await getPage(server, '/projects/prj_1/achievements/new', draft.cookie);
    const repeated = await postForm(
      server,
      `/projects/prj_1/achievements/${draft.id}/approve`,
      draft.cookie,
      csrfFrom(formPage.text),
      { note: 'A second approval attempt.', confirmation: 'A documented achievement' },
    );

    assert.equal(repeated.status, 422);
    assert.match(await repeated.text(), /already approved/);
    const approvals = server.db
      .prepare('SELECT COUNT(*) AS count FROM achievement_approvals')
      .get();
    assert.equal(approvals?.['count'], 1);
  } finally {
    await server.close();
  }
});
