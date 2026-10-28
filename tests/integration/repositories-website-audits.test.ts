import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listAuditEvents } from '../../src/persistence/audit.ts';
import { closeDatabase } from '../../src/persistence/db.ts';
import {
  createWebsiteAudit,
  getWebsiteAudit,
  getWebsiteAuditOrThrow,
  listWebsiteAudits,
  type WebsiteAuditInput,
} from '../../src/persistence/repositories/websiteAudits.ts';
import { createProject } from '../../src/persistence/repositories/projects.ts';
import type { WriteContext } from '../../src/persistence/repositories/context.ts';
import { createTestDatabase, TEST_TIME } from '../helpers/db.ts';

const CONTEXT: WriteContext = { actor: 'Ram', at: TEST_TIME };

const AUDIT: WebsiteAuditInput = {
  label: 'Homepage snapshot',
  inputMethod: 'PASTED',
  inputFilename: null,
  contentHash: 'a'.repeat(64),
  byteLength: 128,
  htmlSnapshot: '<html><head><title>Example</title></head><body></body></html>',
  auditedAt: TEST_TIME,
  methodologyVersion: 'local-html-audit-v1',
  findings: [{ code: 'title_missing', severity: 'LIKELY_DISCOVERABILITY_ISSUE' }],
  unavailableChecks: [{ code: 'HTTP_REACHABILITY', reason: 'not performed' }],
  metadata: { title: 'Example', scriptCount: 0 },
};

function setupProject(db: ReturnType<typeof createTestDatabase>): string {
  return createProject(
    db,
    {
      name: 'Audit project',
      description: undefined,
      primaryDomain: undefined,
      targetEntity: null,
    },
    CONTEXT,
  ).project.id;
}

test('stores an immutable website audit snapshot with parsed metadata', () => {
  const db = createTestDatabase();
  try {
    const projectId = setupProject(db);
    const audit = createWebsiteAudit(db, projectId, AUDIT, CONTEXT);
    assert.match(audit.id, /^wsa_/);
    assert.equal(audit.htmlSnapshot, AUDIT.htmlSnapshot);
    assert.equal(audit.contentHash, AUDIT.contentHash);
    assert.deepEqual(audit.metadata, AUDIT.metadata);
    assert.equal(getWebsiteAudit(db, projectId, audit.id)?.htmlSnapshot, AUDIT.htmlSnapshot);
    assert.equal(listWebsiteAudits(db, projectId)[0]?.findingCount, 1);
    assert.equal(listWebsiteAudits(db, projectId)[0]?.unavailableCheckCount, 1);
    assert.equal(listAuditEvents(db, projectId)[0]?.action, 'website_audit.created');
    assert.throws(
      () => db.prepare('UPDATE website_audits SET label = ? WHERE id = ?').run('Changed', audit.id),
      /immutable/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('website audits are scoped to their project', () => {
  const db = createTestDatabase();
  try {
    const first = setupProject(db);
    const second = createProject(
      db,
      {
        name: 'Other',
        description: undefined,
        primaryDomain: undefined,
        targetEntity: null,
      },
      CONTEXT,
    ).project.id;
    const audit = createWebsiteAudit(db, first, AUDIT, CONTEXT);
    assert.equal(getWebsiteAudit(db, second, audit.id), null);
    assert.throws(() => getWebsiteAuditOrThrow(db, second, audit.id), /Website audit not found/);
    assert.deepEqual(listWebsiteAudits(db, second), []);
  } finally {
    closeDatabase(db);
  }
});

test('missing projects cannot receive audits', () => {
  const db = createTestDatabase();
  try {
    assert.throws(() => createWebsiteAudit(db, 'prj_missing', AUDIT, CONTEXT), /Project not found/);
  } finally {
    closeDatabase(db);
  }
});
