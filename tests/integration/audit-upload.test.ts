import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  csrfFrom,
  getPage,
  locationOf,
  pathOf,
  postForm,
  startTestServer,
  type TestServer,
} from '../helpers/http.ts';

async function createProject(server: TestServer): Promise<{ cookie: string; path: string }> {
  const form = await getPage(server, '/projects/new');
  const created = await postForm(server, '/projects', form.cookie, csrfFrom(form.text), {
    name: 'Upload project',
  });
  assert.equal(created.status, 303);
  return { cookie: form.cookie, path: pathOf(locationOf(created)) };
}

async function upload(
  server: TestServer,
  project: { cookie: string; path: string },
  filename: string,
  html: string,
  includePaste = false,
): Promise<Response> {
  const form = await getPage(server, `${project.path}/audits/new`, project.cookie);
  const data = new FormData();
  data.set('_csrf', csrfFrom(form.text));
  data.set('label', `Uploaded ${filename}`);
  if (includePaste) {
    data.set('html', '<html><head><title>Also pasted</title></head><body></body></html>');
  }
  data.set('htmlFile', new Blob([html], { type: 'text/html' }), filename);
  return fetch(`${server.url}${project.path}/audits`, {
    method: 'POST',
    headers: { cookie: project.cookie, origin: server.url },
    body: data,
    redirect: 'manual',
  });
}

test('accepts an uploaded HTML file and stores a local snapshot', async () => {
  const server = await startTestServer();
  try {
    const project = await createProject(server);
    const response = await upload(
      server,
      project,
      'page.html',
      '<!doctype html><html lang="en"><head><title>Uploaded page</title></head><body><h1>Uploaded page</h1></body></html>',
    );
    assert.equal(response.status, 303);
    const detail = await getPage(server, pathOf(locationOf(response)), project.cookie);
    assert.equal(detail.response.status, 200);
    assert.match(detail.text, /Uploaded page/);
    assert.match(detail.text, /Uploaded page\.html/);
    assert.match(detail.text, /Local HTML audit/);
    assert.match(detail.text, /HTTP status/);
  } finally {
    await server.close();
  }
});

test('rejects non-HTML file extensions and mixed input', async () => {
  const server = await startTestServer();
  try {
    const project = await createProject(server);
    const textFile = await upload(server, project, 'notes.txt', 'plain text');
    assert.equal(textFile.status, 422);
    assert.match(await textFile.text(), /Upload an \.html or \.htm file/);

    const mixed = await upload(server, project, 'page.html', '<html><body>x</body></html>', true);
    assert.equal(mixed.status, 422);
    assert.match(await mixed.text(), /either pasted HTML or a file/);
  } finally {
    await server.close();
  }
});
