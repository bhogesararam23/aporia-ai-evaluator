import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listAuditEvents } from '../../src/persistence/audit.ts';
import { closeDatabase } from '../../src/persistence/db.ts';
import {
  createReport,
  getLatestReport,
  getReport,
  getReportOrThrow,
  listReports,
  nextReportNumber,
  type ReportInput,
} from '../../src/persistence/repositories/reports.ts';
import { createProject } from '../../src/persistence/repositories/projects.ts';
import type { WriteContext } from '../../src/persistence/repositories/context.ts';
import { createTestDatabase, TEST_TIME } from '../helpers/db.ts';

const CONTEXT: WriteContext = { actor: 'Ram', at: TEST_TIME };

function reportInput(number: number, title = `Report ${number}`): ReportInput {
  return {
    reportNumber: number,
    title,
    generatedAt: TEST_TIME,
    snapshotVersion: 'report-snapshot-v1',
    methodologyVersion: 'methodology-2026-10-28',
    metricsVersion: 'metrics-v1',
    evidenceRuleVersion: 'evidence-aggregation-v1',
    snapshot: { schemaVersion: 'report-snapshot-v1', report: { number, title } },
  };
}

function setup(db: ReturnType<typeof createTestDatabase>): string {
  return createProject(
    db,
    {
      name: 'Report project',
      description: undefined,
      primaryDomain: undefined,
      targetEntity: null,
    },
    CONTEXT,
  ).project.id;
}

test('creates sequential immutable reports and supersedes the prior report', () => {
  const db = createTestDatabase();
  try {
    const projectId = setup(db);
    assert.equal(nextReportNumber(db, projectId), 1);
    const first = createReport(db, projectId, reportInput(1), CONTEXT);
    assert.match(first.id, /^rep_/);
    assert.equal(first.reportNumber, 1);
    assert.deepEqual(first.snapshot, reportInput(1).snapshot);
    assert.equal(first.supersededByReportId, null);

    const second = createReport(db, projectId, reportInput(2, 'Report 2'), {
      actor: 'Ram',
      at: '2026-10-28T17:00:00.000Z',
    });
    assert.equal(second.reportNumber, 2);
    assert.equal(getReport(db, projectId, first.id)?.supersededByReportId, second.id);
    assert.equal(getLatestReport(db, projectId)?.id, second.id);
    assert.deepEqual(
      listReports(db, projectId).map((report) => report.reportNumber),
      [2, 1],
    );
    assert.equal(nextReportNumber(db, projectId), 3);
    assert.equal(listAuditEvents(db, projectId)[0]?.action, 'report.generated');
  } finally {
    closeDatabase(db);
  }
});

test('rejects out-of-sequence report numbers', () => {
  const db = createTestDatabase();
  try {
    const projectId = setup(db);
    assert.throws(
      () => createReport(db, projectId, reportInput(2), CONTEXT),
      /next report number is 1/,
    );
    createReport(db, projectId, reportInput(1), CONTEXT);
    assert.throws(
      () => createReport(db, projectId, reportInput(1), CONTEXT),
      /next report number is 2/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('report snapshots are immutable', () => {
  const db = createTestDatabase();
  try {
    const projectId = setup(db);
    const report = createReport(db, projectId, reportInput(1), CONTEXT);
    assert.throws(
      () =>
        db
          .prepare('UPDATE reports SET snapshot_json = ? WHERE id = ?')
          .run('{"changed":true}', report.id),
      /immutable/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('reports are scoped to their project', () => {
  const db = createTestDatabase();
  try {
    const first = setup(db);
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
    const report = createReport(db, first, reportInput(1), CONTEXT);
    assert.equal(getReport(db, second, report.id), null);
    assert.throws(() => getReportOrThrow(db, second, report.id), /Report not found/);
    assert.deepEqual(listReports(db, second), []);
    assert.equal(getLatestReport(db, second), null);
  } finally {
    closeDatabase(db);
  }
});

test('missing projects cannot receive reports', () => {
  const db = createTestDatabase();
  try {
    assert.throws(
      () => createReport(db, 'prj_missing', reportInput(1), CONTEXT),
      /Project not found/,
    );
  } finally {
    closeDatabase(db);
  }
});
