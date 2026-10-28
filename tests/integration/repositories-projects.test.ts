import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listAuditEvents } from '../../src/persistence/audit.ts';
import { closeDatabase } from '../../src/persistence/db.ts';
import {
  createEntity,
  createProject,
  deleteProject,
  getEntity,
  getProject,
  getProjectOrThrow,
  listEntities,
  listProjects,
  setTargetEntity,
  updateEntity,
} from '../../src/persistence/repositories/projects.ts';
import type { WriteContext } from '../../src/persistence/repositories/context.ts';
import { createTestDatabase, TEST_TIME } from '../helpers/db.ts';

const CONTEXT: WriteContext = { actor: 'Ram', at: TEST_TIME };

test('creates a project with a self-declared target entity and audit trail', () => {
  const db = createTestDatabase();
  try {
    const detail = createProject(
      db,
      {
        name: 'Aporia',
        description: 'Evidence-first evaluation.',
        primaryDomain: 'https://aporia.example/',
        targetEntity: { name: 'Aporia project', type: 'PROJECT_ARTIFACT' },
      },
      CONTEXT,
    );
    assert.match(detail.project.id, /^prj_/);
    assert.equal(detail.project.name, 'Aporia');
    assert.equal(detail.project.targetEntityId, detail.targetEntity?.id);
    assert.equal(detail.targetEntity?.identityStatus, 'SELF_DECLARED');
    assert.match(detail.targetEntity?.identityMethod ?? '', /no independent verification/);
    assert.deepEqual(detail.entities, detail.targetEntity === null ? [] : [detail.targetEntity]);
    assert.deepEqual(detail.counts, {
      claims: 0,
      sources: 0,
      evidence: 0,
      runs: 0,
      audits: 0,
      reports: 0,
    });
    assert.deepEqual(
      listAuditEvents(db, detail.project.id).map((event) => event.action),
      ['project.target_entity_set', 'entity.created', 'project.created'],
    );
  } finally {
    closeDatabase(db);
  }
});

test('creates a project without a target entity', () => {
  const db = createTestDatabase();
  try {
    const detail = createProject(
      db,
      {
        name: 'Empty project',
        description: undefined,
        primaryDomain: undefined,
        targetEntity: null,
      },
      CONTEXT,
    );
    assert.equal(detail.targetEntity, null);
    assert.deepEqual(detail.entities, []);
    assert.equal(detail.project.description, null);
  } finally {
    closeDatabase(db);
  }
});

test('lists projects with honest zero counts and target names', () => {
  const db = createTestDatabase();
  try {
    const withEntity = createProject(
      db,
      {
        name: 'With entity',
        description: undefined,
        primaryDomain: undefined,
        targetEntity: { name: 'Ram', type: 'PERSON' },
      },
      CONTEXT,
    );
    createProject(
      db,
      {
        name: 'No entity',
        description: undefined,
        primaryDomain: undefined,
        targetEntity: null,
      },
      CONTEXT,
    );
    const projects = listProjects(db);
    assert.equal(projects.length, 2);
    const entityProject = projects.find((project) => project.id === withEntity.project.id);
    assert.equal(entityProject?.targetEntityName, 'Ram');
    assert.deepEqual(entityProject?.counts, {
      claims: 0,
      sources: 0,
      evidence: 0,
      runs: 0,
      audits: 0,
      reports: 0,
    });
    const emptyProject = projects.find((project) => project.name === 'No entity');
    assert.equal(emptyProject?.targetEntityName, null);
  } finally {
    closeDatabase(db);
  }
});

test('entities are scoped to their project and can become the target', () => {
  const db = createTestDatabase();
  try {
    const first = createProject(
      db,
      {
        name: 'First',
        description: undefined,
        primaryDomain: undefined,
        targetEntity: null,
      },
      CONTEXT,
    );
    const second = createProject(
      db,
      {
        name: 'Second',
        description: undefined,
        primaryDomain: undefined,
        targetEntity: null,
      },
      CONTEXT,
    );
    const entity = createEntity(
      db,
      first.project.id,
      {
        type: 'PERSON',
        canonicalName: 'Ram Bhogesara',
        alternateNames: ['Ram'],
        publicUrls: ['https://example.com/'],
        identityStatus: 'UNVERIFIED',
        identityMethod: undefined,
        identityScope: undefined,
        notes: 'Local record.',
      },
      CONTEXT,
    );
    assert.match(entity.id, /^ent_/);
    assert.deepEqual(entity.alternateNames, ['Ram']);
    assert.equal(getEntity(db, first.project.id, entity.id)?.canonicalName, 'Ram Bhogesara');
    assert.equal(getEntity(db, second.project.id, entity.id), null);
    assert.throws(
      () => setTargetEntity(db, second.project.id, entity.id, CONTEXT),
      /Entity not found/,
    );
    setTargetEntity(db, first.project.id, entity.id, CONTEXT);
    const refreshed = getProjectOrThrow(db, first.project.id);
    assert.equal(refreshed.project.targetEntityId, entity.id);
    assert.equal(refreshed.targetEntity?.id, entity.id);
    assert.deepEqual(
      listEntities(db, first.project.id).map((item) => item.id),
      [entity.id],
    );
  } finally {
    closeDatabase(db);
  }
});

test('entity updates preserve an audit record of identity changes', () => {
  const db = createTestDatabase();
  try {
    const detail = createProject(
      db,
      {
        name: 'Identity',
        description: undefined,
        primaryDomain: undefined,
        targetEntity: null,
      },
      CONTEXT,
    );
    const entity = createEntity(
      db,
      detail.project.id,
      {
        type: 'PERSON',
        canonicalName: 'Ram',
        alternateNames: [],
        publicUrls: [],
        identityStatus: 'UNVERIFIED',
        identityMethod: undefined,
        identityScope: undefined,
        notes: undefined,
      },
      CONTEXT,
    );
    updateEntity(
      db,
      detail.project.id,
      entity.id,
      {
        type: 'PERSON',
        canonicalName: 'Ram Bhogesara',
        alternateNames: ['R. B.'],
        publicUrls: ['https://example.com/'],
        identityStatus: 'SELF_DECLARED',
        identityMethod: 'Operator declaration.',
        identityScope: 'This local project only.',
        notes: undefined,
      },
      { actor: 'Ram', at: '2026-10-28T13:00:00.000Z' },
    );
    const updated = getEntity(db, detail.project.id, entity.id);
    assert.equal(updated?.canonicalName, 'Ram Bhogesara');
    assert.equal(updated?.identityStatus, 'SELF_DECLARED');
    const events = listAuditEvents(db, detail.project.id);
    assert.equal(events[0]?.action, 'entity.updated');
    assert.deepEqual(events[0]?.details, {
      previousIdentityStatus: 'UNVERIFIED',
      identityStatus: 'SELF_DECLARED',
    });
  } finally {
    closeDatabase(db);
  }
});

test('missing projects and deletion behave predictably', () => {
  const db = createTestDatabase();
  try {
    assert.equal(getProject(db, 'prj_missing'), null);
    assert.throws(() => getProjectOrThrow(db, 'prj_missing'), /Project not found/);
    const detail = createProject(
      db,
      {
        name: 'To delete',
        description: undefined,
        primaryDomain: undefined,
        targetEntity: null,
      },
      CONTEXT,
    );
    assert.equal(deleteProject(db, detail.project.id), 'To delete');
    assert.equal(getProject(db, detail.project.id), null);
    assert.throws(() => deleteProject(db, detail.project.id), /Project not found/);
  } finally {
    closeDatabase(db);
  }
});
