/**
 * A withdrawn citation stays on the record, and the record says why.
 *
 * §2.3 requires a voided citation to keep its statement mappings while contributing nothing to the
 * figures, and the operator's reason has to remain readable — otherwise a withdrawal is indistinguishable
 * from a deletion. The run page rendered the reason only while `voidedAt` was still null, so the reason
 * was written and then never shown, and no test caught it because the existing suite voids citations
 * through the repository rather than reading the page back.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addProposition, createClaim } from '../../src/persistence/repositories/claims.ts';
import { createProject } from '../../src/persistence/repositories/projects.ts';
import {
  addQuery,
  approveQuerySet,
  createQuerySet,
} from '../../src/persistence/repositories/querySets.ts';
import {
  addCitation,
  addObservation,
  createRun,
  finalizeRun,
} from '../../src/persistence/repositories/runs.ts';
import {
  createAnswerClaim,
  linkAnswerClaimCitation,
  voidAnswerClaim,
} from '../../src/persistence/repositories/answerClaims.ts';
import { cookieFrom, csrfFrom, getPage, postForm, startTestServer } from '../helpers/http.ts';

const context = { actor: 'Ram', at: '2026-11-02T12:00:00.000Z' };
const ANSWER = 'The artifact exists and was made by Ram in 2021.';
const REASON = 'The announcement page was later taken down.';

async function seeded(): Promise<{
  server: Awaited<ReturnType<typeof startTestServer>>;
  projectId: string;
  runId: string;
  observationId: string;
  propositionId: string;
  citationId: string;
  statementId: string;
  runPath: string;
  workspacePath: string;
  close: () => Promise<void>;
}> {
  const server = await startTestServer();
  try {
    const project = createProject(
      server.db,
      {
        name: 'Withdrawn citation',
        description: undefined,
        primaryDomain: undefined,
        targetEntity: { name: 'Aporia', type: 'PROJECT_ARTIFACT' },
      },
      context,
    );
    const projectId = project.project.id;
    const claim = createClaim(
      server.db,
      projectId,
      {
        text: 'The artifact was made by Ram in 2021.',
        sourceUrl: undefined,
        intendedMeaning: undefined,
        timeScope: undefined,
        locale: 'en',
      },
      context,
    );
    const proposition = addProposition(
      server.db,
      projectId,
      claim.claim.id,
      {
        text: 'The artifact was made by Ram in 2021.',
        subject: undefined,
        predicate: undefined,
        objectValue: undefined,
        conditions: undefined,
        timeInterval: undefined,
        units: undefined,
        evidenceRequirements: 'A dated artifact.',
        expectedAnswerCriterion: undefined,
        ambiguityNotes: undefined,
      },
      context,
    );
    const querySet = createQuerySet(
      server.db,
      projectId,
      { name: 'Core', description: undefined, locale: 'en' },
      context,
    );
    const query = addQuery(
      server.db,
      projectId,
      querySet.set.id,
      {
        text: 'What is Aporia?',
        intent: 'IDENTITY',
        locale: undefined,
        region: undefined,
        branded: false,
        expectedElements: 'The project and its author.',
        inclusionRationale: 'Baseline.',
      },
      context,
    );
    approveQuerySet(
      server.db,
      projectId,
      querySet.set.id,
      { reviewer: 'Ram', note: undefined },
      context,
    );
    const run = createRun(
      server.db,
      projectId,
      querySet.set.id,
      {
        name: 'Manual',
        providerLabel: 'Example assistant',
        modelLabel: undefined,
        interfaceLabel: 'Consumer interface',
        groundingMode: 'UNKNOWN',
        locale: 'en',
        region: undefined,
        captureFrom: '2026-11-02T10:00:00.000Z',
        captureTo: '2026-11-02T11:00:00.000Z',
        conditions: 'Manual capture.',
        notes: undefined,
      },
      context,
    );
    const observation = addObservation(
      server.db,
      projectId,
      run.run.id,
      {
        queryId: query.id,
        status: 'COMPLETED',
        capturedAt: '2026-11-02T10:30:00.000Z',
        answerText: ANSWER,
        errorNote: undefined,
        citationCapture: 'CAPTURED',
        contextNotes: undefined,
      },
      context,
    );
    const citation = addCitation(
      server.db,
      projectId,
      run.run.id,
      observation.id,
      {
        url: 'https://example.invalid/announcement',
        title: 'Announcement',
        snippet: 'Made 2021 by Ram.',
        targetOwned: true,
      },
      context,
    );
    const statement = createAnswerClaim(
      server.db,
      projectId,
      observation.id,
      {
        quoteText: 'made by Ram in 2021',
        statementKind: 'QUOTED',
        offsetBasis: 'EXACT_MATCH',
        startOffset: ANSWER.indexOf('made by Ram in 2021'),
        endOffset: ANSWER.indexOf('made by Ram in 2021') + 'made by Ram in 2021'.length,
        relevance: 'ADDRESSES',
        paraphrase: undefined,
        note: undefined,
      },
      context,
    );
    linkAnswerClaimCitation(
      server.db,
      projectId,
      statement.id,
      {
        citationId: citation.id,
        support: 'SUPPORTS',
        rationale: 'The announcement names the same maker.',
        reviewer: 'Ram',
      },
      context,
    );
    // The run stays open here: the withdrawal form is only offered while the capture can still change,
    // so finalizing happens after the void, through its own form, the way an operator does it.
    return {
      server,
      projectId,
      runId: run.run.id,
      observationId: observation.id,
      propositionId: proposition.id,
      citationId: citation.id,
      statementId: statement.id,
      runPath: `/projects/${projectId}/runs/${run.run.id}`,
      workspacePath: `/projects/${projectId}/runs/${run.run.id}/observations/${observation.id}/claims`,
      close: () => server.close(),
    };
  } catch (error) {
    await server.close();
    throw error;
  }
}

test('voiding a citation through its form leaves the reason and the mapping readable', async () => {
  const fixture = await seeded();
  try {
    const page = await getPage(fixture.server, fixture.runPath);
    const cookie = cookieFrom(page.response);
    const token = csrfFrom(page.text);
    const forms = [...page.text.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)]
      .map((match) => ({
        action: /action="([^"]*)"/i.exec(match[1] ?? '')?.[1] ?? '',
        body: match[2] ?? '',
      }))
      .filter(
        (form) =>
          form.action.includes('/citations/') &&
          form.action.endsWith('/void') &&
          /name="reviewer"/.test(form.body),
      );
    assert.equal(forms.length, 1, 'the run page does not offer exactly one citation void form');
    const form = forms[0];
    assert.ok(form);

    const voided = await postForm(fixture.server, form.action, cookie, token, {
      reason: REASON,
      reviewer: 'Ram',
    });
    assert.equal(voided.status, 303, 'the run refused to withdraw the citation');

    const after = await getPage(fixture.server, fixture.runPath, cookie);
    assert.ok(
      after.text.includes('Void reason: ') && after.text.includes(REASON),
      'the withdrawn citation lost its reason on the page, so a withdrawal cannot be told from a deletion',
    );
    assert.match(after.text, /Voided/, 'the withdrawn citation is not marked as withdrawn');

    const finalizeToken = csrfFrom(after.text);
    const finalized = await postForm(
      fixture.server,
      `${fixture.runPath}/finalize`,
      cookie,
      finalizeToken,
      {},
    );
    assert.equal(finalized.status, 303, 'the run did not finalize after the withdrawal');

    // The mapping survives, and the report says the cited record can support nothing now.
    const workspace = await getPage(
      fixture.server,
      `/projects/${fixture.projectId}/runs/${fixture.runId}/observations/${fixture.observationId}/claims`,
      cookie,
    );
    assert.equal(workspace.response.status, 200);
    assert.match(
      workspace.text,
      /mapping|citation/i,
      'the statement workspace no longer mentions citation mappings at all',
    );
    const reportsPage = await getPage(
      fixture.server,
      `/projects/${fixture.projectId}/reports`,
      cookie,
    );
    const generated = await postForm(
      fixture.server,
      `/projects/${fixture.projectId}/reports`,
      cookie,
      csrfFrom(reportsPage.text),
      { title: 'Withdrawal report' },
    );
    assert.equal(generated.status, 303);
    const reportId = /\/reports\/(rep_[A-Za-z0-9-]+)/.exec(
      (await getPage(fixture.server, `/projects/${fixture.projectId}/reports`, cookie)).text,
    )?.[1];
    assert.ok(reportId, 'no report was generated');
    const report = await getPage(
      fixture.server,
      `/projects/${fixture.projectId}/reports/${reportId}`,
      cookie,
    );
    assert.match(
      report.text,
      /cited record was voided/,
      'the report does not say that the retained mapping supports nothing in the current figures',
    );
  } finally {
    await fixture.close();
  }
});

test('voiding a statement that carries a citation mapping keeps both and removes neither from sight', async () => {
  const fixture = await seeded();
  try {
    voidAnswerClaim(
      fixture.server.db,
      fixture.projectId,
      fixture.statementId,
      'The same sentence was recorded twice while checking the lifecycle.',
      context,
    );
    finalizeRun(fixture.server.db, fixture.projectId, fixture.runId, context);

    const entry = await getPage(fixture.server, fixture.workspacePath);
    const cookie = cookieFrom(entry.response);
    const workspace = await getPage(fixture.server, fixture.workspacePath, cookie);
    assert.equal(workspace.response.status, 200);
    assert.match(
      workspace.text,
      /The same sentence was recorded twice while checking the lifecycle\./,
      'the voided statement lost its reason',
    );
    // §2.3: the mapping is history. It must stay listed against the statement it was made for.
    assert.match(
      workspace.text,
      /Cited material supports the statement/,
      'voiding the statement deleted its citation mapping from the record',
    );

    const reportsPage = await getPage(
      fixture.server,
      `/projects/${fixture.projectId}/reports`,
      cookie,
    );
    const generated = await postForm(
      fixture.server,
      `/projects/${fixture.projectId}/reports`,
      cookie,
      csrfFrom(reportsPage.text),
      { title: 'Void lifecycle report' },
    );
    assert.equal(generated.status, 303);
    const reportId = /\/reports\/(rep_[A-Za-z0-9-]+)/.exec(
      (await getPage(fixture.server, `/projects/${fixture.projectId}/reports`, cookie)).text,
    )?.[1];
    assert.ok(reportId, 'no report was generated');
    const report = await getPage(
      fixture.server,
      `/projects/${fixture.projectId}/reports/${reportId}`,
      cookie,
    );
    assert.match(
      report.text,
      /voided by the reviewer and contribute to/,
      'the report does not say the voided statement was excluded and why',
    );
    // A voided statement is not a failed statement: its rate must not be reported as zero support.
    assert.match(
      report.text,
      /not recorded|No statements were eligible|0 of 0/,
      'the report presents an unreviewed or voided decomposition as a measured result',
    );
  } finally {
    await fixture.close();
  }
});
