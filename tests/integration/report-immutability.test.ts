import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createClaim,
  addProposition,
  transitionClaim,
} from '../../src/persistence/repositories/claims.ts';
import {
  createSource,
  recordEvidence,
  recordPropositionAssessment,
} from '../../src/persistence/repositories/evidence.ts';
import {
  csrfFrom,
  getPage,
  locationOf,
  pathOf,
  postForm,
  startTestServer,
  type TestServer,
} from '../helpers/http.ts';

async function createProject(
  server: TestServer,
): Promise<{ cookie: string; path: string; id: string }> {
  const form = await getPage(server, '/projects/new');
  const created = await postForm(server, '/projects', form.cookie, csrfFrom(form.text), {
    name: 'Snapshot project',
    description: 'Testing immutable report snapshots.',
  });
  const path = pathOf(locationOf(created));
  return { cookie: form.cookie, path, id: path.split('/')[2] ?? '' };
}

function addEvidence(
  server: TestServer,
  projectId: string,
  propositionId: string,
  title: string,
  excerpt: string,
): void {
  const source = createSource(
    server.db,
    projectId,
    {
      title,
      canonicalUri: undefined,
      publisher: undefined,
      author: undefined,
      sourceType: 'SELF_PUBLISHED',
      accessRoute: 'MANUAL_ENTRY',
      retrievedAt: '2026-10-28T12:00:00.000Z',
      publicationDate: undefined,
      language: 'en',
      independence: 'SELF_PUBLISHED',
      notes: undefined,
    },
    { actor: 'Ram', at: '2026-10-28T12:00:00.000Z' },
  );
  recordEvidence(
    server.db,
    projectId,
    source.id,
    propositionId,
    {
      locator: 'README',
      excerpt,
      extractionMethod: 'PASTED_TEXT',
      extractedAt: '2026-10-28T12:00:00.000Z',
      relation: 'SUPPORTS',
      rationale: 'Recorded in a report snapshot test.',
      reviewer: 'Ram',
    },
    { actor: 'Ram', at: '2026-10-28T12:00:00.000Z' },
  );
}

async function generate(
  server: TestServer,
  project: { cookie: string; path: string },
  title: string,
) {
  const page = await getPage(server, `${project.path}/reports`, project.cookie);
  const response = await postForm(
    server,
    `${project.path}/reports`,
    project.cookie,
    csrfFrom(page.text),
    {
      title,
    },
  );
  assert.equal(response.status, 303);
  return pathOf(locationOf(response));
}

async function reportJson(
  server: TestServer,
  reportPath: string,
  cookie: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${server.url}${reportPath}/export.json`, { headers: { cookie } });
  assert.equal(response.status, 200);
  return (await response.json()) as Record<string, unknown>;
}

test('reports preserve the snapshot after underlying records change', async () => {
  const server = await startTestServer();
  try {
    const project = await createProject(server);
    const claim = createClaim(
      server.db,
      project.id,
      {
        text: 'The artifact <script>alert(1)</script> contains feature F.',
        sourceUrl: undefined,
        intendedMeaning: undefined,
        timeScope: undefined,
        locale: 'en',
      },
      { actor: 'Ram', at: '2026-10-28T12:00:00.000Z' },
    );
    const proposition = addProposition(
      server.db,
      project.id,
      claim.claim.id,
      {
        text: 'The artifact contains feature F.',
        subject: undefined,
        predicate: undefined,
        objectValue: undefined,
        conditions: undefined,
        timeInterval: undefined,
        units: undefined,
        evidenceRequirements: 'A release artifact.',
        expectedAnswerCriterion: undefined,
        ambiguityNotes: undefined,
      },
      { actor: 'Ram', at: '2026-10-28T12:00:00.000Z' },
    );
    transitionClaim(server.db, project.id, claim.claim.id, 'UNDER_REVIEW', {
      actor: 'Ram',
      at: '2026-10-28T12:00:00.000Z',
    });
    addEvidence(server, project.id, proposition.id, 'Primary source', 'Feature F exists.');
    recordPropositionAssessment(
      server.db,
      project.id,
      proposition.id,
      {
        label: 'SUPPORTED_WITHIN_SCOPE',
        rationale: 'The release artifact supports the proposition.',
        reviewer: 'Ram',
      },
      { actor: 'Ram', at: '2026-10-28T12:00:00.000Z' },
    );

    const firstPath = await generate(server, project, 'First snapshot');
    const firstJson = await reportJson(server, firstPath, project.cookie);
    assert.equal((firstJson['claims'] as unknown[]).length, 1);
    assert.equal((firstJson['coverage'] as Record<string, unknown>)['sources'], 1);

    const firstView = await getPage(server, firstPath, project.cookie);
    assert.match(firstView.text, /First snapshot/);
    assert.match(
      firstView.text,
      /The artifact &lt;script&gt;alert\(1\)&lt;\/script&gt; contains feature F/,
    );
    assert.equal(firstView.text.includes('<script>alert(1)</script> contains feature F'), false);
    assert.match(firstView.text, /SUPPORTED_WITHIN_SCOPE|Supported within scope/);
    assert.match(firstView.text, /No finalized manual run/);
    assert.match(firstView.text, /Limitations/);

    addEvidence(
      server,
      project.id,
      proposition.id,
      'Second source',
      'Feature F also appears here.',
    );

    const stillFirst = await reportJson(server, firstPath, project.cookie);
    assert.equal((stillFirst['coverage'] as Record<string, unknown>)['sources'], 1);

    const secondPath = await generate(server, project, 'Second snapshot');
    const secondJson = await reportJson(server, secondPath, project.cookie);
    assert.equal((secondJson['coverage'] as Record<string, unknown>)['sources'], 2);
    assert.notEqual(firstPath, secondPath);

    const firstAfterSecond = await reportJson(server, firstPath, project.cookie);
    assert.equal((firstAfterSecond['coverage'] as Record<string, unknown>)['sources'], 1);
  } finally {
    await server.close();
  }
});
