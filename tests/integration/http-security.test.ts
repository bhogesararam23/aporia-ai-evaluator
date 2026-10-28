import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'parse5';
import {
  csrfFrom,
  getPage,
  locationOf,
  pathOf,
  postForm,
  startTestServer,
} from '../helpers/http.ts';

async function createProject(
  server: Awaited<ReturnType<typeof startTestServer>>,
): Promise<{ cookie: string; path: string }> {
  const form = await getPage(server, '/projects/new');
  const created = await postForm(server, '/projects', form.cookie, csrfFrom(form.text), {
    name: 'Security project',
  });
  return { cookie: form.cookie, path: pathOf(locationOf(created)) };
}

function postFormsWithoutCsrf(html: string): number {
  const document = parse(html);
  let missing = 0;
  const stack = [...document.childNodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) continue;
    if ('tagName' in node && node.tagName === 'form') {
      const method = node.attrs.find((attr) => attr.name === 'method')?.value.toLowerCase();
      if (method === 'post') {
        const hasToken = node.childNodes.some((child) => {
          if (!('tagName' in child) || child.tagName !== 'input') return false;
          const attrs = new Map(child.attrs.map((attr) => [attr.name, attr.value]));
          return attrs.get('name') === '_csrf' && (attrs.get('value') ?? '').length > 0;
        });
        if (!hasToken) missing += 1;
      }
    }
    if ('childNodes' in node) stack.push(...node.childNodes);
  }
  return missing;
}

test('the database and home page start without seeded records', async () => {
  const server = await startTestServer();
  try {
    const row = server.db.prepare('SELECT COUNT(*) AS count FROM projects').get();
    assert.equal(row?.['count'], 0);
    const home = await getPage(server, '/');
    assert.match(home.text, /No projects yet/);
    assert.match(home.text, /Create your first project/);
  } finally {
    await server.close();
  }
});

test('unknown and traversal-like asset paths are not served', async () => {
  const server = await startTestServer();
  try {
    const css = await fetch(`${server.url}/assets/app.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('cache-control') ?? '', /max-age/);
    for (const path of [
      '/assets/other.css',
      '/assets/..%2F..%2Fsrc%2Fserver.ts',
      '/assets/%2e%2e%2faporia.db',
      '/assets/../package.json',
    ]) {
      const response = await fetch(`${server.url}${path}`, { redirect: 'manual' });
      assert.equal(response.status, 404, path);
    }
  } finally {
    await server.close();
  }
});

test('every POST form renders a synchronizer token', async () => {
  const server = await startTestServer();
  try {
    const project = await createProject(server);
    const paths = [
      '/projects/new',
      `${project.path}/edit`,
      `${project.path}/claims/new`,
      `${project.path}/sources/new`,
      `${project.path}/query-sets/new`,
      `${project.path}/audits/new`,
      `${project.path}/delete`,
    ];
    for (const path of paths) {
      const page = await getPage(server, path, project.cookie);
      assert.equal(page.response.status, 200, path);
      assert.equal(postFormsWithoutCsrf(page.text), 0, path);
    }
  } finally {
    await server.close();
  }
});
