import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { getFinding } from '../../src/persistence/repositories/findings.ts';
import {
  approveQuerySet,
  insertAnswerClaim,
  insertClaimWithProposition,
  insertCitation,
  insertObservation,
  insertObservationAssessment,
  insertProject,
  insertQuery,
  insertQuerySet,
  insertRun,
  insertWebsiteAudit,
  TEST_TIME,
} from '../helpers/db.ts';
import {
  csrfFrom,
  getPage,
  locationOf,
  pathOf,
  postForm,
  startTestServer,
  type TestServer,
} from '../helpers/http.ts';

const DRAFT: Record<string, string> = {
  title: 'The answer omits the funding body',
  observedIssue:
    'Both captured answers describe the project and its author but never the organisation that funded it.',
  supportingEvidence: 'Two captured answers recorded under the same configuration omit the funder.',
  cause: 'MODEL_MISREAD_OR_OMISSION',
  severity: 'MEDIUM',
  severityRationale: 'A reader asking about funding gets no signal from either answer.',
  recommendedAction: 'State the funding relationship plainly on the project page.',
  ownerLabel: 'ram-local',
  // datetime-local text, exactly as the browser sends it.
  firstObservedAt: '2026-10-20T10:00:00',
  lastObservedAt: '2026-10-28T10:00:00',
};

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as Record<string, unknown>;
  return Number(row['n']);
}

function findingIdOf(path: string): string {
  return path.split('/').pop() ?? '';
}

/**
 * Markup collapsed to single spaces.
 *
 * The renderer breaks long attribute lists across lines, so a test that wants to prove an option is
 * offered has to read the element rather than guess where a line was wrapped.
 */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** One project with the records a finding can be raised against, plus the findings page cookie. */
async function seeded(): Promise<TestServer> {
  const server = await startTestServer();
  insertProject(server.db, { id: 'prj_1' });
  insertProject(server.db, { id: 'prj_2' });
  insertClaimWithProposition(server.db, { projectId: 'prj_1' });
  insertQuerySet(server.db, { projectId: 'prj_1' });
  insertQuery(server.db);
  approveQuerySet(server.db);
  insertRun(server.db, { projectId: 'prj_1', id: 'run_base' });
  insertObservation(server.db, { runId: 'run_base', id: 'obs_base', queryId: 'qry_1' });
  insertAnswerClaim(server.db, { observationId: 'obs_base', quoteText: 'created by Ram' });
  insertCitation(server.db, { observationId: 'obs_base' });
  insertWebsiteAudit(server.db, { label: 'Project home page' });
  return server;
}

async function raised(server: TestServer): Promise<{ cookie: string; path: string; id: string }> {
  const form = await getPage(server, '/projects/prj_1/findings/new');
  const created = await postForm(
    server,
    '/projects/prj_1/findings',
    form.cookie,
    csrfFrom(form.text),
    DRAFT,
  );
  assert.equal(created.status, 303);
  const location = pathOf(locationOf(created));
  return { cookie: form.cookie, path: location, id: findingIdOf(location) };
}

test('the findings list is an honest empty state, reachable from the project nav', async (t) => {
  const server = await startTestServer();
  t.after(() => server.close());
  insertProject(server.db, { id: 'prj_1' });
  const page = await getPage(server, '/projects/prj_1/findings');
  assert.match(page.text, /No findings tracked/);
  assert.match(page.text, /does not invent findings from sample data/);
  assert.match(page.text, /aria-current="page">Findings</);
  assert.match(page.text, /href="\/projects\/prj_1\/findings\/new"/);
});

test('an operator raises a finding, links a record by its words, and sees both on the page', async (t) => {
  const server = await seeded();
  t.after(() => server.close());
  const form = await getPage(server, '/projects/prj_1/findings/new');
  // The form explains the labels it asks for, so nobody has to read the schema to use it.
  assert.match(form.text, /Whoever is tracking this, written by you/);
  assert.match(form.text, /Aporia did not observe the provider/);
  assert.match(form.text, /Entered in this computer/);

  const created = await postForm(
    server,
    '/projects/prj_1/findings',
    form.cookie,
    csrfFrom(form.text),
    { ...DRAFT, referenceType: 'answer_claim', referenceId: 'acs_1' },
  );
  assert.equal(created.status, 303);
  const location = locationOf(created);
  assert.match(pathOf(location), /^\/projects\/prj_1\/findings\/fnd_/);
  assert.match(location, /notice=finding-created/);

  const page = await getPage(server, location, form.cookie);
  assert.match(page.text, /Nothing has been accepted, fixed, or measured yet/);
  assert.match(page.text, /F-0001/);
  assert.match(page.text, /created by Ram/, 'the pointer is shown as the statement it points at');
  assert.match(page.text, /A pointer stores only the record/);
  assert.match(page.text, /unable to verify are not offered/);

  const id = findingIdOf(pathOf(location));
  const record = getFinding(server.db, 'prj_1', id);
  assert.equal(record?.status, 'OPEN');
  assert.equal(record?.reference, 'F-0001');
  assert.deepEqual(
    record?.references.map((reference) => reference.targetId),
    ['acs_1'],
  );
  // The typed wall-clock text became one canonical instant, read through the same local-time
  // interpretation the browser would apply. Asserting a fixed UTC string here would make the test
  // depend on the machine's zone.
  assert.equal(record?.firstObservedAt, new Date('2026-10-20T10:00:00').toISOString());
});

test('a refused submission keeps every typed value and names every field problem', async (t) => {
  const server = await seeded();
  t.after(() => server.close());
  const form = await getPage(server, '/projects/prj_1/findings/new');
  const rejected = await postForm(
    server,
    '/projects/prj_1/findings',
    form.cookie,
    csrfFrom(form.text),
    { ...DRAFT, title: 'ab', severityRationale: '', cause: 'NOT_A_CAUSE' },
  );
  assert.equal(rejected.status, 422);
  const text = await rejected.text();
  assert.match(text, /Check the form/);
  assert.match(text, /title:/);
  assert.match(text, /severityRationale:/);
  assert.match(text, /cause:/);
  // The narrative the operator typed is still on the page rather than being thrown away.
  assert.match(text, /Both captured answers describe the project and its author/);
  assert.equal(count(server.db, 'remediation_findings'), 0);
});

test('a half-filled pointer is refused instead of quietly dropped', async (t) => {
  const server = await seeded();
  t.after(() => server.close());
  const form = await getPage(server, '/projects/prj_1/findings/new');
  const rejected = await postForm(
    server,
    '/projects/prj_1/findings',
    form.cookie,
    csrfFrom(form.text),
    { ...DRAFT, referenceType: 'claim', referenceId: '' },
  );
  assert.equal(rejected.status, 422);
  assert.match(await rejected.text(), /referenceId:/);
  assert.equal(count(server.db, 'remediation_findings'), 0);
});

test('a finding cannot be created through the form without the session token', async (t) => {
  const server = await seeded();
  t.after(() => server.close());
  const form = await getPage(server, '/projects/prj_1/findings/new');
  const response = await fetch(`${server.url}/projects/prj_1/findings`, {
    method: 'POST',
    headers: {
      cookie: form.cookie,
      'content-type': 'application/x-www-form-urlencoded',
      origin: server.url,
    },
    body: new URLSearchParams({ ...DRAFT, _csrf: 'wrong-token' }),
    redirect: 'manual',
  });
  assert.equal(response.status, 403);
  assert.equal(count(server.db, 'remediation_findings'), 0);
});

test('a status change is walked through the form and lands in the history', async (t) => {
  const server = await seeded();
  t.after(() => server.close());
  const { cookie, path, id } = await raised(server);
  const detail = await getPage(server, path, cookie);
  const token = csrfFrom(detail.text);
  assert.match(detail.text, /Choose the status to move to/);
  assert.doesNotMatch(flat(detail.text), /<option value="IMPROVED"/);
  assert.match(flat(detail.text), /<option value="ACCEPTED"/);

  const accepted = await postForm(server, `${path}/transition`, cookie, token, {
    status: 'ACCEPTED',
    note: 'Confirmed the omission against both answers.',
  });
  assert.equal(accepted.status, 303);
  const reread = await getPage(server, pathOf(locationOf(accepted)), cookie);
  assert.match(reread.text, /Confirmed the omission against both answers/);
  assert.match(reread.text, /Accepted/);
  assert.equal(getFinding(server.db, 'prj_1', id)?.status, 'ACCEPTED');
  assert.equal(getFinding(server.db, 'prj_1', id)?.updates.length, 2);

  // A forged measured status comes back as a field error on the form that caused it, naming what
  // would unlock it, rather than as an opaque conflict page. Nothing is written either way.
  const forged = await postForm(server, `${path}/transition`, cookie, token, {
    status: 'IMPROVED',
    note: 'It looks better now.',
  });
  assert.equal(forged.status, 422);
  assert.match(await forged.text(), /requires a stored retest comparison that concluded it/);
  assert.equal(getFinding(server.db, 'prj_1', id)?.status, 'ACCEPTED');

  // A closure without a written rationale is refused by the form, not by the database.
  const unclosed = await postForm(server, `${path}/transition`, cookie, token, {
    status: 'CLOSED_WITH_RATIONALE',
    note: 'Done with it.',
  });
  assert.equal(unclosed.status, 422);
  assert.match(await unclosed.text(), /requires a written rationale/);
});

test('a retest needs two finalized runs, then shows what it would record before writing', async (t) => {
  const server = await seeded();
  t.after(() => server.close());
  const { cookie, path, id } = await raised(server);
  const detail = await getPage(server, path, cookie);
  const token = csrfFrom(detail.text);

  const early = await getPage(server, `${path}/retest`, cookie);
  assert.match(early.text, /Two finalized runs are needed/);

  // A genuinely later capture under the same configuration. Assessments go in while each run is
  // still open, because only an open run accepts a new judgement.
  insertRun(server.db, { projectId: 'prj_1', id: 'run_later' });
  insertObservation(server.db, { runId: 'run_later', id: 'obs_later', queryId: 'qry_1' });
  insertObservationAssessment(server.db, { id: 'oasm_base', observationId: 'obs_base' });
  insertObservationAssessment(server.db, { id: 'oasm_later', observationId: 'obs_later' });
  for (const run of ['run_base', 'run_later']) {
    server.db
      .prepare('UPDATE runs SET status = ?, finalized_at = ? WHERE id = ?')
      .run('FINALIZED', TEST_TIME, run);
  }

  const ready = await getPage(server, `${path}/retest`, cookie);
  assert.match(ready.text, /Earlier run/);
  assert.match(ready.text, /Nothing has been compared yet/);

  // A comparison may only be recorded against a finding that is waiting for one, and that rule lives
  // with the write, so the refusal arrives as a conflict rather than as a field error.
  const refused = await postForm(server, `${path}/retest/record`, cookie, token, {
    baseRunId: 'run_base',
    laterRunId: 'run_later',
    focusMetric: 'mention_rate',
  });
  assert.equal(refused.status, 409);
  assert.equal(count(server.db, 'retest_comparisons'), 0);

  for (const step of [
    { status: 'ACCEPTED', note: 'Confirmed the omission.' },
    { status: 'RETEST_REQUIRED', note: 'The page has been updated.' },
  ]) {
    const moved = await postForm(server, `${path}/transition`, cookie, token, step);
    assert.equal(moved.status, 303);
  }

  const preview = await getPage(
    server,
    `${path}/retest?baseRunId=run_base&laterRunId=run_later&focusMetric=mention_rate`,
    cookie,
  );
  assert.equal(preview.response.status, 200);
  assert.match(preview.text, /association, not a cause/);
  assert.match(preview.text, /Every metric both runs produced/);
  assert.match(preview.text, /Record this comparison/);
  // A preview writes nothing: the page can be re-read, shared, and changed without a record.
  assert.equal(count(server.db, 'retest_comparisons'), 0);

  const recorded = await postForm(server, `${path}/retest/record`, cookie, token, {
    baseRunId: 'run_base',
    laterRunId: 'run_later',
    focusMetric: 'mention_rate',
  });
  assert.equal(recorded.status, 303);
  const stored = getFinding(server.db, 'prj_1', id);
  assert.equal(stored?.comparisons.length, 1);
  assert.equal(stored?.comparisons[0]?.outcome, 'UNCHANGED');
  const actions = server.db
    .prepare('SELECT action FROM audit_events WHERE entity_id = ?')
    .all(id)
    .map((row) => String((row as Record<string, unknown>)['action']));
  assert.ok(actions.includes('finding.comparison-recorded'));

  // Only the measured status the stored comparison supports is now offered.
  const after = await getPage(server, path, cookie);
  const afterToken = csrfFrom(after.text);
  assert.match(flat(after.text), /<option value="UNCHANGED"/);
  assert.doesNotMatch(flat(after.text), /<option value="IMPROVED"/);
  assert.doesNotMatch(flat(after.text), /<option value="REGRESSED"/);
  const unchanged = await postForm(server, `${path}/transition`, cookie, afterToken, {
    status: 'UNCHANGED',
    note: 'The later capture says the same thing.',
  });
  assert.equal(unchanged.status, 303);
  assert.equal(getFinding(server.db, 'prj_1', id)?.status, 'UNCHANGED');
});

test('a non-comparable retest records the reason and offers only unable to verify', async (t) => {
  const server = await seeded();
  t.after(() => server.close());
  const { cookie, path, id } = await raised(server);
  const detail = await getPage(server, path, cookie);
  const token = csrfFrom(detail.text);
  insertRun(server.db, {
    projectId: 'prj_1',
    id: 'run_other',
    providerLabel: 'Different assistant',
  });
  insertObservation(server.db, { runId: 'run_other', id: 'obs_other', queryId: 'qry_1' });
  for (const run of ['run_base', 'run_other']) {
    server.db
      .prepare('UPDATE runs SET status = ?, finalized_at = ? WHERE id = ?')
      .run('FINALIZED', TEST_TIME, run);
  }
  for (const step of [
    { status: 'ACCEPTED', note: 'Confirmed the omission.' },
    { status: 'RETEST_REQUIRED', note: 'The page has been updated.' },
  ]) {
    assert.equal((await postForm(server, `${path}/transition`, cookie, token, step)).status, 303);
  }

  const preview = await getPage(
    server,
    `${path}/retest?baseRunId=run_base&laterRunId=run_other&focusMetric=mention_rate`,
    cookie,
  );
  assert.match(preview.text, /provider label differs/);
  // The recorded values are named in time order, and the quotation marks arrive escaped on a page.
  assert.match(flat(preview.text), /Manual assistant&quot; then, &quot;Different assistant/);
  assert.match(preview.text, /Not comparable/);

  const recorded = await postForm(server, `${path}/retest/record`, cookie, token, {
    baseRunId: 'run_base',
    laterRunId: 'run_other',
    focusMetric: 'mention_rate',
  });
  assert.equal(recorded.status, 303);
  assert.equal(getFinding(server.db, 'prj_1', id)?.comparisons[0]?.outcome, 'NOT_COMPARABLE');

  const after = await getPage(server, path, cookie);
  assert.match(flat(after.text), /<option value="UNABLE_TO_VERIFY"/);
  assert.doesNotMatch(flat(after.text), /<option value="IMPROVED"/);
  const verified = await postForm(server, `${path}/transition`, cookie, csrfFrom(after.text), {
    status: 'UNABLE_TO_VERIFY',
    note: 'The later run used a different provider, so nothing can be claimed.',
  });
  assert.equal(verified.status, 303);
  assert.equal(getFinding(server.db, 'prj_1', id)?.status, 'UNABLE_TO_VERIFY');
});

test('a finding from another project is not reachable, and its text cannot inject markup', async (t) => {
  const server = await seeded();
  t.after(() => server.close());
  const form = await getPage(server, '/projects/prj_1/findings/new');
  const created = await postForm(
    server,
    '/projects/prj_1/findings',
    form.cookie,
    csrfFrom(form.text),
    {
      ...DRAFT,
      title: 'A <script>alert(1)</script> title',
      observedIssue:
        'An <img src=x onerror=alert(1)> issue that must be escaped before it is ever rendered.',
    },
  );
  assert.equal(created.status, 303);
  const path = pathOf(locationOf(created));
  const page = await getPage(server, path, form.cookie);
  // The stored text is raw and the render escapes it. A hostile attribute fragment inside an escaped
  // tag is inert, so the test that matters is structural: no live script, no live img element, and
  // the escaped form present instead.
  assert.doesNotMatch(flat(page.text), /<script>alert/);
  assert.doesNotMatch(flat(page.text), /<img src=x/);
  assert.match(page.text, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(page.text, /&lt;img src=x onerror=alert\(1\)&gt;/);

  const foreignList = await getPage(server, '/projects/prj_2/findings', form.cookie);
  assert.match(foreignList.text, /No findings tracked/);
  const foreign = await getPage(
    server,
    path.replace('/projects/prj_1/', '/projects/prj_2/'),
    form.cookie,
  );
  assert.equal(foreign.response.status, 404);
  assert.match(foreign.text, /not found|No such record/i);
});

test('a generated report carries the tracked finding and its limits', async (t) => {
  const server = await seeded();
  t.after(() => server.close());
  const { cookie, path } = await raised(server);
  const detail = await getPage(server, path, cookie);
  await postForm(server, `${path}/transition`, cookie, csrfFrom(detail.text), {
    status: 'ACCEPTED',
    note: 'Confirmed the omission against both answers.',
  });

  const generated = await postForm(
    server,
    '/projects/prj_1/reports',
    cookie,
    csrfFrom(detail.text),
    { title: 'Findings appear in the report' },
  );
  assert.equal(generated.status, 303);
  const reportPath = pathOf(locationOf(generated));
  const report = await getPage(server, reportPath, cookie);
  assert.match(report.text, /Tracked findings/);
  assert.match(report.text, /F-0001/);
  assert.match(report.text, /The answer omits the funding body/);
  assert.match(report.text, /No retest comparison recorded/);
  // The report says what a finding cannot claim, rather than letting a status read as a verified fix.
  assert.match(report.text, /Owner and actor labels are typed by whoever is using this computer/);
  assert.match(report.text, /identify nobody/);

  const json = await getPage(server, `${reportPath}/export.json`, cookie);
  const snapshot = JSON.parse(json.text) as { findings?: unknown[] };
  assert.equal(snapshot.findings?.length, 1);
});

test('a pointer may be added and removed from the finding page, and both are audited', async (t) => {
  const server = await seeded();
  t.after(() => server.close());
  const { cookie, path, id } = await raised(server);
  const detail = await getPage(server, path, cookie);
  const token = csrfFrom(detail.text);
  assert.match(detail.text, /No record is pointed at yet/);

  // The target list only appears once the kind of record is chosen, because a dependent select
  // without scripting has to ask for the kind first.
  const asked = await getPage(server, `${path}?referenceType=website_audit`, cookie);
  assert.match(asked.text, /Project home page/);

  const linked = await postForm(server, `${path}/references`, cookie, token, {
    referenceType: 'website_audit',
    referenceId: 'wsa_1',
  });
  assert.equal(linked.status, 303);
  const referenceId = getFinding(server.db, 'prj_1', id)?.references[0]?.id;
  assert.ok(referenceId);
  assert.equal(getFinding(server.db, 'prj_1', id)?.references[0]?.targetId, 'wsa_1');

  const removed = await postForm(
    server,
    `${path}/references/${referenceId}/remove`,
    cookie,
    token,
    {},
  );
  assert.equal(removed.status, 303);
  assert.equal(getFinding(server.db, 'prj_1', id)?.references.length, 0);
  const actions = server.db
    .prepare('SELECT action FROM audit_events WHERE entity_id = ? ORDER BY created_at, rowid')
    .all(id)
    .map((row) => String((row as Record<string, unknown>)['action']));
  assert.deepEqual(actions, ['finding.created', 'finding.referenced', 'finding.reference-removed']);
});

test('a pointer to another project record is refused, and the finding is untouched', async (t) => {
  const server = await seeded();
  t.after(() => server.close());
  insertClaimWithProposition(server.db, {
    projectId: 'prj_2',
    claimId: 'clm_other',
    revisionId: 'rev_other',
    propositionId: 'prp_other',
  });
  const { cookie, path, id } = await raised(server);
  const detail = await getPage(server, path, cookie);
  const refused = await postForm(server, `${path}/references`, cookie, csrfFrom(detail.text), {
    referenceType: 'claim',
    referenceId: 'clm_other',
  });
  // The scope rule lives in the database, so a cross-project pointer never becomes a row and the
  // error page names no table or column.
  assert.equal(refused.status, 500);
  assert.equal(getFinding(server.db, 'prj_1', id)?.references.length, 0);
});
