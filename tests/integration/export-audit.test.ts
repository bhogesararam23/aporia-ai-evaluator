import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getPage, startTestServer } from '../helpers/http.ts';
import { insertProject, insertReport } from '../helpers/db.ts';

function auditCount(db: Parameters<typeof insertProject>[0]): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM audit_events').get();
  return row === undefined ? 0 : Number(row['count']);
}

test('a report export that cannot be generated does not claim an export', async () => {
  const server = await startTestServer();
  try {
    insertProject(server.db);
    insertReport(server.db, { id: 'rep_bad', snapshotJson: '{}' });
    const before = auditCount(server.db);

    const { response } = await getPage(server, '/projects/prj_1/reports/rep_bad/export.json');

    assert.equal(response.status, 500);
    assert.equal(auditCount(server.db), before, 'a failed export wrote an export audit event');
  } finally {
    await server.close();
  }
});

test('a successful report export records exactly one audit event', async () => {
  const server = await startTestServer();
  try {
    insertProject(server.db);
    insertReport(server.db, { id: 'rep_ok' });
    const before = auditCount(server.db);

    const { response } = await getPage(server, '/projects/prj_1/reports/rep_ok/export.json');

    assert.equal(response.status, 200);
    assert.equal(auditCount(server.db), before + 1);
    const event = server.db
      .prepare(
        "SELECT action, entity_type, entity_id FROM audit_events WHERE action = 'report.exported' ORDER BY rowid DESC LIMIT 1",
      )
      .get();
    assert.equal(event?.['action'], 'report.exported');
    assert.equal(event?.['entity_type'], 'report');
    assert.equal(event?.['entity_id'], 'rep_ok');
  } finally {
    await server.close();
  }
});
