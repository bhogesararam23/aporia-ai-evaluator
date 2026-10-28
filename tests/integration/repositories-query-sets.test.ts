import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueryDraftInput } from '../../src/core/inputs.ts';
import { listAuditEvents } from '../../src/persistence/audit.ts';
import { closeDatabase } from '../../src/persistence/db.ts';
import {
  addQuery,
  approveQuerySet,
  cloneQuerySetVersion,
  createQuerySet,
  deleteQuery,
  getQuerySet,
  getQuerySetOrThrow,
  listQuerySets,
} from '../../src/persistence/repositories/querySets.ts';
import { createProject } from '../../src/persistence/repositories/projects.ts';
import type { WriteContext } from '../../src/persistence/repositories/context.ts';
import { createTestDatabase, TEST_TIME } from '../helpers/db.ts';

const CONTEXT: WriteContext = { actor: 'Ram', at: TEST_TIME };
const LATER: WriteContext = { actor: 'Ram', at: '2026-10-28T15:00:00.000Z' };

const QUERY: QueryDraftInput = {
  text: 'What is Project A?',
  intent: 'IDENTITY',
  locale: undefined,
  region: undefined,
  branded: true,
  expectedElements: 'Project A and its creator.',
  inclusionRationale: 'Baseline identity question.',
};

function setupProject(db: ReturnType<typeof createTestDatabase>): string {
  return createProject(
    db,
    {
      name: 'Query project',
      description: undefined,
      primaryDomain: undefined,
      targetEntity: null,
    },
    CONTEXT,
  ).project.id;
}

test('creates a draft query set and appends numbered queries', () => {
  const db = createTestDatabase();
  try {
    const projectId = setupProject(db);
    const created = createQuerySet(
      db,
      projectId,
      { name: 'Core discovery', description: 'Fixed baseline.', locale: 'en' },
      CONTEXT,
    );
    assert.match(created.set.id, /^qst_/);
    assert.equal(created.set.version, 1);
    assert.equal(created.set.status, 'DRAFT');
    assert.deepEqual(created.queries, []);
    const query = addQuery(db, projectId, created.set.id, QUERY, CONTEXT);
    assert.equal(query.ordinal, 1);
    assert.equal(query.branded, true);
    const second = addQuery(
      db,
      projectId,
      created.set.id,
      { ...QUERY, text: 'Which projects do this?', intent: 'DISCOVERY' },
      CONTEXT,
    );
    assert.equal(second.ordinal, 2);
    assert.equal(getQuerySetOrThrow(db, projectId, created.set.id).queries.length, 2);
    assert.deepEqual(
      listAuditEvents(db, projectId).map((event) => event.action),
      ['query.added', 'query.added', 'query_set.created', 'project.created'],
    );
  } finally {
    closeDatabase(db);
  }
});

test('query set names are unique per project and project scoping is enforced', () => {
  const db = createTestDatabase();
  try {
    const projectId = setupProject(db);
    const other = createProject(
      db,
      {
        name: 'Other',
        description: undefined,
        primaryDomain: undefined,
        targetEntity: null,
      },
      CONTEXT,
    ).project.id;
    const created = createQuerySet(
      db,
      projectId,
      { name: 'Core', description: undefined, locale: 'en' },
      CONTEXT,
    );
    assert.throws(
      () =>
        createQuerySet(
          db,
          projectId,
          { name: 'Core', description: undefined, locale: 'en' },
          CONTEXT,
        ),
      /already exists/,
    );
    assert.equal(getQuerySet(db, other, created.set.id), null);
    assert.throws(() => addQuery(db, other, created.set.id, QUERY, CONTEXT), /Query set not found/);
    const otherSet = createQuerySet(
      db,
      other,
      { name: 'Core', description: undefined, locale: 'en' },
      CONTEXT,
    );
    assert.notEqual(otherSet.set.id, created.set.id);
  } finally {
    closeDatabase(db);
  }
});

test('draft queries can be removed but approved sets are frozen', () => {
  const db = createTestDatabase();
  try {
    const projectId = setupProject(db);
    const created = createQuerySet(
      db,
      projectId,
      { name: 'Core', description: undefined, locale: 'en' },
      CONTEXT,
    );
    const query = addQuery(db, projectId, created.set.id, QUERY, CONTEXT);
    deleteQuery(db, projectId, created.set.id, query.id, LATER);
    assert.equal(getQuerySetOrThrow(db, projectId, created.set.id).queries.length, 0);
    const kept = addQuery(db, projectId, created.set.id, QUERY, LATER);
    assert.equal(kept.ordinal, 1);
    approveQuerySet(db, projectId, created.set.id, { reviewer: 'Ram', note: 'Reviewed.' }, LATER);
    assert.throws(() => addQuery(db, projectId, created.set.id, QUERY, LATER), /immutable/);
    assert.throws(() => deleteQuery(db, projectId, created.set.id, kept.id, LATER), /immutable/);
    assert.throws(
      () =>
        approveQuerySet(db, projectId, created.set.id, { reviewer: 'Ram', note: undefined }, LATER),
      /already approved/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('an empty query set cannot be approved', () => {
  const db = createTestDatabase();
  try {
    const projectId = setupProject(db);
    const created = createQuerySet(
      db,
      projectId,
      { name: 'Empty', description: undefined, locale: 'en' },
      CONTEXT,
    );
    assert.throws(
      () =>
        approveQuerySet(
          db,
          projectId,
          created.set.id,
          { reviewer: 'Ram', note: undefined },
          CONTEXT,
        ),
      /at least one query/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('approved sets can be cloned into a new draft version for retesting', () => {
  const db = createTestDatabase();
  try {
    const projectId = setupProject(db);
    const created = createQuerySet(
      db,
      projectId,
      { name: 'Core', description: 'Fixed set.', locale: 'en' },
      CONTEXT,
    );
    addQuery(db, projectId, created.set.id, QUERY, CONTEXT);
    approveQuerySet(db, projectId, created.set.id, { reviewer: 'Ram', note: 'Approved.' }, LATER);
    const clone = cloneQuerySetVersion(db, projectId, created.set.id, LATER);
    assert.equal(clone.set.version, 2);
    assert.equal(clone.set.status, 'DRAFT');
    assert.equal(clone.set.supersedesId, created.set.id);
    assert.equal(clone.queries.length, 1);
    assert.equal(clone.queries[0]?.text, QUERY.text);
    assert.notEqual(clone.set.id, created.set.id);
    assert.equal(listQuerySets(db, projectId).length, 2);
    assert.equal(listAuditEvents(db, projectId)[0]?.action, 'query_set.version_cloned');
  } finally {
    closeDatabase(db);
  }
});

test('draft sets cannot be cloned for retesting', () => {
  const db = createTestDatabase();
  try {
    const projectId = setupProject(db);
    const created = createQuerySet(
      db,
      projectId,
      { name: 'Core', description: undefined, locale: 'en' },
      CONTEXT,
    );
    assert.throws(
      () => cloneQuerySetVersion(db, projectId, created.set.id, CONTEXT),
      /Only an approved query set/,
    );
  } finally {
    closeDatabase(db);
  }
});
