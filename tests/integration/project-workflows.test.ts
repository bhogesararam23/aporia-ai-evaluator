import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listEntities } from '../../src/persistence/repositories/projects.ts';
import {
  csrfFrom,
  getPage,
  locationOf,
  pathOf,
  postForm,
  startTestServer,
} from '../helpers/http.ts';

test('creates a project through an accessible form and escapes unsafe names', async () => {
  const server = await startTestServer();
  try {
    const form = await getPage(server, '/projects/new');
    assert.equal(form.response.status, 200);
    assert.match(form.text, /name="name"/);
    assert.match(form.text, /name="_csrf"/);
    const token = csrfFrom(form.text);

    const created = await postForm(server, '/projects', form.cookie, token, {
      name: '<script>alert(1)</script> Project',
      description: 'A real project description.',
      primaryDomain: 'https://aporia.example/',
      targetEntityName: 'Aporia',
      targetEntityType: 'PROJECT_ARTIFACT',
    });
    assert.equal(created.status, 303);
    const location = locationOf(created);
    assert.match(location, /^\/projects\/prj_/);

    const overview = await getPage(server, location, form.cookie);
    assert.equal(overview.response.status, 200);
    assert.match(overview.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt; Project/);
    assert.equal(overview.text.includes('<script>alert(1)</script> Project'), false);
    assert.match(overview.text, /No claims yet/);
    assert.match(overview.text, /Local only/);
  } finally {
    await server.close();
  }
});

test('shows validation errors and preserves submitted values', async () => {
  const server = await startTestServer();
  try {
    const form = await getPage(server, '/projects/new');
    const token = csrfFrom(form.text);
    const response = await postForm(server, '/projects', form.cookie, token, {
      name: '',
      description: 'Keep this description after failure.',
      primaryDomain: 'javascript:alert(1)',
    });
    assert.equal(response.status, 422);
    const text = await response.text();
    assert.match(text, /Check the form/);
    assert.match(text, /This field is required/);
    assert.match(text, /Keep this description after failure/);
    assert.match(text, /Only HTTP and HTTPS URLs are allowed/);
  } finally {
    await server.close();
  }
});

test('adds entities, changes the target, and records identity scope', async () => {
  const server = await startTestServer();
  try {
    const newProject = await getPage(server, '/projects/new');
    const projectToken = csrfFrom(newProject.text);
    const created = await postForm(server, '/projects', newProject.cookie, projectToken, {
      name: 'Entity project',
    });
    const projectLocation = pathOf(locationOf(created));
    const projectId = projectLocation.split('/')[2] ?? '';

    const entitiesPage = await getPage(server, `${projectLocation}/entities`, newProject.cookie);
    const entityToken = csrfFrom(entitiesPage.text);
    const entityResponse = await postForm(
      server,
      `/projects/${projectId}/entities`,
      newProject.cookie,
      entityToken,
      {
        type: 'PERSON',
        canonicalName: 'Ram Bhogesara',
        alternateNames: 'Ram\nR. B.',
        publicUrls: 'https://example.com/ram',
        identityStatus: 'SELF_DECLARED',
        identityMethod: 'Operator declaration; no independent verification.',
        identityScope: 'This local project only.',
        notes: 'A real person record entered by the operator.',
      },
    );
    assert.equal(entityResponse.status, 303);
    const entities = await getPage(server, `${projectLocation}/entities`, newProject.cookie);
    assert.match(entities.text, /Ram Bhogesara/);
    assert.match(entities.text, /Self-declared by operator/);
    assert.match(entities.text, /Operator declaration; no independent verification/);
    assert.match(entities.text, /Current target/);
  } finally {
    await server.close();
  }
});

test('exports project JSON and confirms destructive deletion', async () => {
  const server = await startTestServer();
  try {
    const newProject = await getPage(server, '/projects/new');
    const token = csrfFrom(newProject.text);
    const created = await postForm(server, '/projects', newProject.cookie, token, {
      name: 'Exportable project',
      description: 'Real data.',
    });
    const projectLocation = pathOf(locationOf(created));
    const projectId = projectLocation.split('/')[2] ?? '';

    const exported = await fetch(`${server.url}/projects/${projectId}/export.json`, {
      headers: { cookie: newProject.cookie },
    });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-type') ?? '', /application\/json/);
    assert.match(exported.headers.get('content-disposition') ?? '', /attachment/);
    const data = (await exported.json()) as Record<string, unknown>;
    assert.equal(data['schemaVersion'], 'project-export-v1');
    assert.equal((data['project'] as Record<string, unknown>)['name'], 'Exportable project');
    const activity = await getPage(server, `${projectLocation}/activity`, newProject.cookie);
    assert.match(activity.text, /project.exported/);

    const deletePage = await getPage(server, `${projectLocation}/delete`, newProject.cookie);
    const deleteToken = csrfFrom(deletePage.text);
    const wrong = await postForm(
      server,
      `${projectLocation}/delete`,
      newProject.cookie,
      deleteToken,
      {
        confirmation: 'Wrong name',
      },
    );
    assert.equal(wrong.status, 422);
    const wrongText = await wrong.text();
    assert.match(wrongText, /did not match/);
    assert.match(wrongText, /Wrong name/);

    const deleted = await postForm(
      server,
      `${projectLocation}/delete`,
      newProject.cookie,
      deleteToken,
      {
        confirmation: 'Exportable project',
      },
    );
    assert.equal(deleted.status, 303);
    assert.equal(locationOf(deleted), '/?notice=project-deleted');
    const home = await getPage(server, '/', newProject.cookie);
    assert.match(home.text, /No projects yet/);
    assert.equal(home.text.includes('Exportable project'), false);
  } finally {
    await server.close();
  }
});

test('shows the activity log and rejects cross-project route IDs', async () => {
  const server = await startTestServer();
  try {
    const newProject = await getPage(server, '/projects/new');
    const token = csrfFrom(newProject.text);
    const created = await postForm(server, '/projects', newProject.cookie, token, {
      name: 'Activity project',
    });
    const projectLocation = pathOf(locationOf(created));
    const activity = await getPage(server, `${projectLocation}/activity`, newProject.cookie);
    assert.equal(activity.response.status, 200);
    assert.match(activity.text, /project\.created/);
    assert.match(activity.text, /Append-only local audit events/);

    const missing = await fetch(`${server.url}/projects/prj_missing`, {
      headers: { cookie: newProject.cookie },
    });
    assert.equal(missing.status, 404);
  } finally {
    await server.close();
  }
});

test('edits a project profile and records the change', async () => {
  const server = await startTestServer();
  try {
    const form = await getPage(server, '/projects/new');
    const created = await postForm(server, '/projects', form.cookie, csrfFrom(form.text), {
      name: 'Original project name',
    });
    const projectPath = pathOf(locationOf(created));
    const project = { cookie: form.cookie, projectPath };
    const edit = await getPage(server, `${project.projectPath}/edit`, project.cookie);
    assert.equal(edit.response.status, 200);
    const token = csrfFrom(edit.text);
    const updated = await postForm(server, `${project.projectPath}/edit`, project.cookie, token, {
      name: 'Renamed project',
      description: 'Updated by the operator.',
      primaryDomain: 'https://updated.example/',
    });
    assert.equal(updated.status, 303);
    const overview = await getPage(server, project.projectPath, project.cookie);
    assert.match(overview.text, /Renamed project/);
    assert.match(overview.text, /Updated by the operator/);
    const activity = await getPage(server, `${project.projectPath}/activity`, project.cookie);
    assert.match(activity.text, /project\.updated/);

    const invalid = await postForm(server, `${project.projectPath}/edit`, project.cookie, token, {
      name: 'Still valid',
      primaryDomain: 'javascript:alert(1)',
    });
    assert.equal(invalid.status, 422);
    assert.match(await invalid.text(), /Only HTTP and HTTPS URLs are allowed/);
  } finally {
    await server.close();
  }
});

test('edits an entity and can change the project target', async () => {
  const server = await startTestServer();
  try {
    const newProject = await getPage(server, '/projects/new');
    const created = await postForm(
      server,
      '/projects',
      newProject.cookie,
      csrfFrom(newProject.text),
      {
        name: 'Entity edit project',
        targetEntityName: 'First target',
        targetEntityType: 'PERSON',
      },
    );
    const projectPath = pathOf(locationOf(created));
    const projectId = projectPath.split('/')[2] ?? '';

    const entitiesPage = await getPage(server, `${projectPath}/entities`, newProject.cookie);
    const added = await postForm(
      server,
      `${projectPath}/entities`,
      newProject.cookie,
      csrfFrom(entitiesPage.text),
      {
        type: 'ORGANIZATION',
        canonicalName: 'Second entity',
        alternateNames: 'Second',
        identityStatus: 'UNVERIFIED',
      },
    );
    assert.equal(added.status, 303);
    const entityId = listEntities(server.db, projectId).find(
      (entity) => entity.canonicalName === 'Second entity',
    )?.id;
    assert.ok(entityId);

    const editPage = await getPage(
      server,
      `${projectPath}/entities/${entityId}/edit`,
      newProject.cookie,
    );
    const updated = await postForm(
      server,
      `${projectPath}/entities/${entityId}`,
      newProject.cookie,
      csrfFrom(editPage.text),
      {
        type: 'ORGANIZATION',
        canonicalName: 'Corrected entity',
        identityStatus: 'SELF_DECLARED',
        identityMethod: 'Operator declaration; no independent verification.',
      },
    );
    assert.equal(updated.status, 303);
    const afterEdit = await getPage(server, `${projectPath}/entities`, newProject.cookie);
    assert.match(afterEdit.text, /Corrected entity/);
    assert.match(afterEdit.text, /Self-declared by operator/);

    const targetPage = await getPage(server, `${projectPath}/entities`, newProject.cookie);
    const setTarget = await postForm(
      server,
      `${projectPath}/entities/${entityId}/target`,
      newProject.cookie,
      csrfFrom(targetPage.text),
      {},
    );
    assert.equal(setTarget.status, 303);
    const afterTarget = await getPage(server, `${projectPath}/entities`, newProject.cookie);
    assert.match(afterTarget.text, /Current target/);
  } finally {
    await server.close();
  }
});
