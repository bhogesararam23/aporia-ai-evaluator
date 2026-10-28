import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listQuerySets, getQuerySet } from '../../src/persistence/repositories/querySets.ts';
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
  name = 'Evaluation project',
): Promise<{ cookie: string; path: string; id: string }> {
  const form = await getPage(server, '/projects/new');
  const created = await postForm(server, '/projects', form.cookie, csrfFrom(form.text), {
    name,
    description: 'A real project used for endpoint tests.',
  });
  assert.equal(created.status, 303);
  const path = pathOf(locationOf(created));
  return { cookie: form.cookie, path, id: path.split('/')[2] ?? '' };
}

async function createApprovedSet(
  server: TestServer,
  project: { cookie: string; path: string; id: string },
): Promise<{ setId: string; queryId: string }> {
  const newSet = await getPage(server, `${project.path}/query-sets/new`, project.cookie);
  const created = await postForm(
    server,
    `${project.path}/query-sets`,
    project.cookie,
    csrfFrom(newSet.text),
    {
      name: 'Core questions',
      description: 'Fixed baseline.',
      locale: 'en',
    },
  );
  assert.equal(created.status, 303);
  const setPath = pathOf(locationOf(created));
  const detail = await getPage(server, setPath, project.cookie);
  const added = await postForm(
    server,
    `${setPath}/queries`,
    project.cookie,
    csrfFrom(detail.text),
    {
      text: 'What is Aporia?',
      intent: 'DESCRIPTION',
      locale: 'en',
      branded: 'on',
      expectedElements: 'Aporia and its feature.',
      inclusionRationale: 'Baseline description.',
    },
  );
  assert.equal(added.status, 303);
  const afterQuery = await getPage(server, setPath, project.cookie);
  const approved = await postForm(
    server,
    `${setPath}/approve`,
    project.cookie,
    csrfFrom(afterQuery.text),
    {
      reviewer: 'Ram',
      note: 'Reviewed and approved for testing.',
    },
  );
  assert.equal(approved.status, 303);
  const set = listQuerySets(server.db, project.id)[0];
  assert.ok(set);
  return { setId: set.set.id, queryId: set.queries[0]?.id ?? '' };
}

async function createRun(
  server: TestServer,
  project: { cookie: string; path: string; id: string },
  setId: string,
): Promise<{ runId: string; path: string }> {
  const newRun = await getPage(server, `${project.path}/runs/new`, project.cookie);
  const created = await postForm(
    server,
    `${project.path}/runs`,
    project.cookie,
    csrfFrom(newRun.text),
    {
      querySetId: setId,
      name: 'Manual baseline',
      providerLabel: 'Example assistant',
      modelLabel: 'unknown',
      interfaceLabel: 'Consumer web interface',
      groundingMode: 'SEARCH_GROUNDED',
      locale: 'en',
      captureFrom: '2026-10-28T10:00:00Z',
      captureTo: '2026-10-28T11:00:00Z',
      conditions: 'Default interface; manual capture only.',
    },
  );
  assert.equal(created.status, 303);
  const path = pathOf(locationOf(created));
  return { runId: path.split('/')[4] ?? '', path };
}

test('query sets, manual runs, assessments, finalization, and reports work end to end', async () => {
  const server = await startTestServer();
  try {
    const project = await createProject(server);
    const set = await createApprovedSet(server, project);
    assert.equal(getQuerySet(server.db, project.id, set.setId)?.set.status, 'APPROVED');
    assert.ok(set.queryId.length > 0);

    const run = await createRun(server, project, set.setId);
    const runPage = await getPage(server, run.path, project.cookie);
    assert.match(runPage.text, /Manual capture only/);
    assert.match(runPage.text, /No observations yet/);
    assert.equal(runPage.response.status, 200);

    const observation = await postForm(
      server,
      `${run.path}/observations`,
      project.cookie,
      csrfFrom(runPage.text),
      {
        queryId: set.queryId,
        status: 'COMPLETED',
        capturedAt: '2026-10-28T10:30:00Z',
        answerText: 'Aporia is an evaluation project created by Ram.',
        citationCapture: 'CAPTURED',
        contextNotes: 'Default interface.',
      },
    );
    assert.equal(observation.status, 303);
    const afterObservation = await getPage(server, run.path, project.cookie);
    assert.match(afterObservation.text, /Aporia is an evaluation project created by Ram/);
    const observationId = afterObservation.text.match(/observations\/(obs_[0-9a-f-]+)/)?.[1];
    assert.ok(observationId);

    const citation = await postForm(
      server,
      `${run.path}/observations/${observationId}/citations`,
      project.cookie,
      csrfFrom(afterObservation.text),
      {
        url: 'https://example.com/aporia',
        title: 'Aporia project page',
        snippet: 'Project description.',
        targetOwned: 'on',
      },
    );
    assert.equal(citation.status, 303);

    let page = await getPage(server, run.path, project.cookie);
    const token = csrfFrom(page.text);
    for (const assessment of [
      { dimension: 'PRESENCE', label: 'MENTIONED', rationale: 'Names Aporia.' },
      { dimension: 'FIDELITY', label: 'ACCURATE', rationale: 'Matches the available description.' },
      {
        dimension: 'CITATION_SUPPORT',
        label: 'SUPPORTED',
        rationale: 'Citation supports the statement.',
      },
      {
        dimension: 'ATTRIBUTION',
        label: 'CORRECT',
        rationale: 'Attributes the project to Ram.',
        attributionRole: 'AUTHOR',
      },
    ]) {
      const response = await postForm(
        server,
        `${run.path}/observations/${observationId}/assessments`,
        project.cookie,
        token,
        { ...assessment, reviewer: 'Ram' },
      );
      assert.equal(response.status, 303, assessment.dimension);
    }
    page = await getPage(server, run.path, project.cookie);
    assert.match(page.text, /Mention rate/);
    assert.match(page.text, /100\.0%/);
    assert.match(page.text, /Preview only/);
    assert.match(page.text, /Aporia project page/);

    const finalized = await postForm(
      server,
      `${run.path}/finalize`,
      project.cookie,
      csrfFrom(page.text),
      {},
    );
    assert.equal(finalized.status, 303);
    const afterFinalize = await getPage(server, run.path, project.cookie);
    assert.match(afterFinalize.text, /Finalized/);
    assert.equal(afterFinalize.text.includes('Preview only'), false);
    assert.match(afterFinalize.text, /This run is finalized and immutable/);

    const reportPage = await getPage(server, `${project.path}/reports`, project.cookie);
    assert.match(reportPage.text, /Generate a report/);
    const generated = await postForm(
      server,
      `${project.path}/reports`,
      project.cookie,
      csrfFrom(reportPage.text),
      { title: 'Baseline report' },
    );
    assert.equal(generated.status, 303);
    const reportPath = pathOf(locationOf(generated));
    const reportView = await getPage(server, reportPath, project.cookie);
    assert.match(reportView.text, /Baseline report/);
    assert.match(reportView.text, /Manual capture only/);
    assert.match(reportView.text, /Mention rate/);
    assert.match(reportView.text, /Limitations/);
    assert.match(reportView.text, /Download JSON/);

    const reportJson = await fetch(`${server.url}${reportPath}/export.json`, {
      headers: { cookie: project.cookie },
    });
    assert.equal(reportJson.status, 200);
    assert.match(reportJson.headers.get('content-type') ?? '', /application\/json/);
    const snapshot = (await reportJson.json()) as Record<string, unknown>;
    assert.equal((snapshot['runs'] as unknown[]).length, 1);
    assert.equal((snapshot['claims'] as unknown[]).length, 0);

    const metrics = await fetch(`${server.url}${reportPath}/metrics.csv`, {
      headers: { cookie: project.cookie },
    });
    assert.equal(metrics.status, 200);
    assert.match(metrics.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(await metrics.text(), /mention_rate/);

    const findings = await fetch(`${server.url}${reportPath}/findings.csv`, {
      headers: { cookie: project.cookie },
    });
    assert.equal(findings.status, 200);
    assert.match(await findings.text(), /OBSERVATION_ASSESSMENT/);
  } finally {
    await server.close();
  }
});

test('observation import is atomic and rejects invalid rows', async () => {
  const server = await startTestServer();
  try {
    const project = await createProject(server, 'Import project');
    const set = await createApprovedSet(server, project);
    const run = await createRun(server, project, set.setId);
    let page = await getPage(server, run.path, project.cookie);
    const invalid = await postForm(
      server,
      `${run.path}/import`,
      project.cookie,
      csrfFrom(page.text),
      {
        json: JSON.stringify([
          {
            query_ordinal: 1,
            status: 'COMPLETED',
            captured_at: '2026-10-28T12:00:00Z',
            citation_capture: 'CAPTURED',
          },
        ]),
      },
    );
    assert.equal(invalid.status, 422);
    const invalidText = await invalid.text();
    assert.match(invalidText, /answerText|answer/i);
    page = await getPage(server, run.path, project.cookie);
    assert.match(page.text, /No observations yet/);

    const imported = await postForm(
      server,
      `${run.path}/import`,
      project.cookie,
      csrfFrom(page.text),
      {
        json: JSON.stringify([
          {
            query_ordinal: 1,
            status: 'COMPLETED',
            captured_at: '2026-10-28T12:00:00Z',
            answer_text: 'A real imported answer.',
            citation_capture: 'NOT_SHOWN',
            context_notes: 'Imported from a manual capture log.',
            citations: [],
            assessments: [
              {
                dimension: 'PRESENCE',
                label: 'MENTIONED',
                rationale: 'The answer names the entity.',
                reviewer: 'Ram',
                attribution_role: null,
              },
            ],
          },
        ]),
      },
    );
    assert.equal(imported.status, 303);
    const afterImport = await getPage(server, run.path, project.cookie);
    assert.match(afterImport.text, /A real imported answer/);
    assert.match(afterImport.text, /No citations recorded/);
  } finally {
    await server.close();
  }
});

test('local HTML audit is stored, escaped, and reports unavailable network checks', async () => {
  const server = await startTestServer();
  try {
    const project = await createProject(server, 'Audit project');
    const formPage = await getPage(server, `${project.path}/audits/new`, project.cookie);
    const token = csrfFrom(formPage.text);
    const data = new FormData();
    data.set('_csrf', token);
    data.set('label', 'Homepage snapshot');
    data.set(
      'html',
      '<!doctype html><html lang="en"><head><title>Safe title</title><meta name="robots" content="noindex"></head><body><h1>Safe title</h1><script>alert("xss")</script></body></html>',
    );
    const response = await fetch(`${server.url}${project.path}/audits`, {
      method: 'POST',
      headers: {
        cookie: project.cookie,
        origin: server.url,
      },
      body: data,
      redirect: 'manual',
    });
    assert.equal(response.status, 303);
    const auditPath = pathOf(locationOf(response));
    const detail = await getPage(server, auditPath, project.cookie);
    assert.equal(detail.response.status, 200);
    assert.match(detail.text, /Safe title/);
    assert.match(detail.text, /noindex/);
    assert.match(detail.text, /Checks not performed/);
    assert.match(detail.text, /HTTP status/);
    assert.equal(detail.text.includes('<script>alert("xss")</script>'), false);
    assert.match(detail.text, /Raw HTML is stored locally/);
  } finally {
    await server.close();
  }
});
