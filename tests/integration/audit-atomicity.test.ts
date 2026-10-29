import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import { createSource } from '../../src/persistence/repositories/evidence.ts';
import { createQuerySet } from '../../src/persistence/repositories/querySets.ts';
import { createWebsiteAudit } from '../../src/persistence/repositories/websiteAudits.ts';
import type { WriteContext } from '../../src/persistence/repositories/context.ts';
import { createTestDatabase, insertProject, TEST_TIME } from '../helpers/db.ts';

const CONTEXT: WriteContext = { actor: 'Ram', at: '2026-10-30T10:00:00.000Z' };

function forceAuditFailure(db: DatabaseSync, action: string): void {
  db.exec(`
    CREATE TRIGGER fail_audit_${action.replaceAll('.', '_')}
    BEFORE INSERT ON audit_events
    WHEN NEW.action = '${action}'
    BEGIN
      SELECT RAISE(ABORT, 'forced audit failure');
    END;
  `);
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
  return row === undefined ? 0 : Number(row['count']);
}

const SOURCE_INPUT = {
  title: 'Release archive',
  canonicalUri: 'https://example.com/release',
  publisher: undefined,
  author: undefined,
  sourceType: 'PRIMARY_ARTIFACT' as const,
  accessRoute: 'MANUAL_ENTRY' as const,
  retrievedAt: TEST_TIME,
  publicationDate: '2026-10-01',
  language: 'en',
  independence: 'INDEPENDENT' as const,
  notes: undefined,
};

const AUDIT_INPUT = {
  label: 'Homepage snapshot',
  inputMethod: 'PASTED' as const,
  inputFilename: null,
  contentHash: 'a'.repeat(64),
  byteLength: 24,
  htmlSnapshot: '<html><body>x</body></html>',
  auditedAt: TEST_TIME,
  methodologyVersion: 'local-html-audit-v1',
  findings: [],
  unavailableChecks: [],
  metadata: {},
};

test('a source and its audit event roll back together', () => {
  const db = createTestDatabase();
  const projectId = insertProject(db);
  forceAuditFailure(db, 'source.created');

  assert.throws(() => createSource(db, projectId, SOURCE_INPUT, CONTEXT), /forced audit failure/);

  assert.equal(count(db, 'sources'), 0, 'the source row survived a failed audit write');
  assert.equal(count(db, 'audit_events'), 0, 'the failed audit event was recorded');
});

test('a query set and its audit event roll back together', () => {
  const db = createTestDatabase();
  const projectId = insertProject(db);
  forceAuditFailure(db, 'query_set.created');

  assert.throws(
    () =>
      createQuerySet(
        db,
        projectId,
        { name: 'Atomic set', description: undefined, locale: 'en' },
        CONTEXT,
      ),
    /forced audit failure/,
  );

  assert.equal(count(db, 'query_sets'), 0, 'the query set row survived a failed audit write');
  assert.equal(count(db, 'audit_events'), 0);
});

test('a website audit and its audit event roll back together', () => {
  const db = createTestDatabase();
  const projectId = insertProject(db);
  forceAuditFailure(db, 'website_audit.created');

  assert.throws(
    () => createWebsiteAudit(db, projectId, AUDIT_INPUT, CONTEXT),
    /forced audit failure/,
  );

  assert.equal(count(db, 'website_audits'), 0, 'the audit row survived a failed audit write');
  assert.equal(count(db, 'audit_events'), 0);
});

test('successful creation writes exactly one primary row and one audit event', () => {
  const db = createTestDatabase();
  const projectId = insertProject(db);

  createSource(db, projectId, SOURCE_INPUT, CONTEXT);
  createQuerySet(
    db,
    projectId,
    { name: 'Atomic set', description: undefined, locale: 'en' },
    CONTEXT,
  );
  createWebsiteAudit(db, projectId, AUDIT_INPUT, CONTEXT);

  assert.equal(count(db, 'sources'), 1);
  assert.equal(count(db, 'query_sets'), 1);
  assert.equal(count(db, 'website_audits'), 1);
  assert.equal(count(db, 'audit_events'), 3);
});
