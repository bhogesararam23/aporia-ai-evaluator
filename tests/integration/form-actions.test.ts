/**
 * Every form the application renders must post to a route the application serves.
 *
 * The v0.4 audit found the statement workspace's per-statement forms posting to
 * `/claims/{id}/{id}/propositions`, because a path helper already included the statement id. The route is
 * real, the markup is real, and the repository functions are covered elsewhere — but no existing test
 * posted through the action the page actually rendered, so an operator clicking the button got a 404
 * while the suite stayed green. A workflow that cannot be completed in the browser is not implemented,
 * whatever the persistence layer is capable of.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addProposition, createClaim } from '../../src/persistence/repositories/claims.ts';
import { createSource, recordEvidence } from '../../src/persistence/repositories/evidence.ts';
import { createProject } from '../../src/persistence/repositories/projects.ts';
import {
  addQuery,
  approveQuerySet,
  createQuerySet,
} from '../../src/persistence/repositories/querySets.ts';
import { addCitation, addObservation, createRun } from '../../src/persistence/repositories/runs.ts';
import type { RouteDefinition } from '../../src/app/http/types.ts';
import { routes } from '../../src/app/routes/index.ts';
import { cookieFrom, csrfFrom, getPage, postForm, startTestServer } from '../helpers/http.ts';

const context = { actor: 'Ram', at: '2026-11-02T12:00:00.000Z' };
const ANSWER = 'The artifact exists and was made by Ram in 2021.';
const QUOTE = 'made by Ram in 2021';

interface RenderedForm {
  readonly method: string;
  readonly action: string;
  readonly fields: readonly string[];
}

/** The forms as a browser sees them: the action as written, the method as written, the field names. */
function formsIn(html: string, pagePath: string): RenderedForm[] {
  const forms: RenderedForm[] = [];
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attributes = match[1] ?? '';
    const body = match[2] ?? '';
    const written = /action="([^"]*)"/i.exec(attributes)?.[1] ?? '';
    forms.push({
      method: (/method="([^"]*)"/i.exec(attributes)?.[1] ?? 'get').toLowerCase(),
      action: (written.length === 0 ? pagePath : written).replace(/&amp;/g, '&'),
      fields: [...body.matchAll(/name="([^"]+)"/gi)].map((field) => field[1] ?? ''),
    });
  }
  return forms;
}

function servedBy(definition: RouteDefinition, method: string, action: string): boolean {
  if (definition.method.toLowerCase() !== method) {
    return false;
  }
  const path = action.split('?')[0] ?? action;
  const expected = definition.path.split('/').filter((part) => part.length > 0);
  const actual = path.split('/').filter((part) => part.length > 0);
  if (expected.length !== actual.length) {
    return false;
  }
  return expected.every((part, index) => part.startsWith(':') || part === actual[index]);
}

function unservedForms(html: string, pagePath: string): string[] {
  return formsIn(html, pagePath)
    .filter((form) => !routes.some((route) => servedBy(route, form.method, form.action)))
    .map((form) => `${form.method.toUpperCase()} ${form.action}`);
}

async function seeded(): Promise<{
  server: Awaited<ReturnType<typeof startTestServer>>;
  projectId: string;
  claimId: string;
  propositionId: string;
  runId: string;
  observationId: string;
  workspacePath: string;
  close: () => Promise<void>;
}> {
  const server = await startTestServer();
  try {
    const project = createProject(
      server.db,
      {
        name: 'Form actions',
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
    const source = createSource(
      server.db,
      projectId,
      {
        title: 'Artifact record',
        canonicalUri: 'https://example.invalid/artifact',
        publisher: undefined,
        author: undefined,
        sourceType: 'PRIMARY_ARTIFACT',
        accessRoute: 'MANUAL_ENTRY',
        retrievedAt: '2026-11-02T10:00:00.000Z',
        publicationDate: undefined,
        language: 'en',
        independence: 'SELF_PUBLISHED',
        notes: undefined,
      },
      context,
    );
    recordEvidence(
      server.db,
      projectId,
      source.id,
      proposition.id,
      {
        locator: 'Section 1',
        excerpt: 'Made 2021 by Ram.',
        extractionMethod: 'PASTED_TEXT',
        extractedAt: '2026-11-02T10:00:00.000Z',
        relation: 'SUPPORTS',
        rationale: 'The artifact carries the year.',
        reviewer: 'Ram',
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
    addCitation(
      server.db,
      projectId,
      run.run.id,
      observation.id,
      {
        url: 'https://example.invalid/artifact',
        title: 'Artifact',
        snippet: 'Made 2021 by Ram.',
        targetOwned: true,
      },
      context,
    );
    const workspacePath = `/projects/${projectId}/runs/${run.run.id}/observations/${observation.id}/claims`;
    // A finding and a report, created through the application's own forms, so their pages exist to walk.
    const entry = await getPage(server, workspacePath);
    const cookie = cookieFrom(entry.response);
    const token = csrfFrom(entry.text);
    const findingCreated = await postForm(
      server,
      `/projects/${projectId}/findings`,
      cookie,
      token,
      {
        title: 'The founding year is stated wrongly',
        observedIssue: 'Answers give 2020 where the artifact says 2021.',
        supportingEvidence: 'One captured answer.',
        cause: 'MODEL_MISREAD_OR_OMISSION',
        severity: 'MEDIUM',
        severityRationale: 'A reader gets the wrong year.',
        recommendedAction: 'State the year on the project page.',
        ownerLabel: 'Ram',
        firstObservedAt: '2026-11-02T10:00:00.000Z',
        lastObservedAt: '2026-11-02T10:00:00.000Z',
        referenceType: 'claim',
        referenceId: claim.claim.id,
      },
    );
    assert.equal(
      findingCreated.status,
      303,
      'the seeded finding could not be created, so the walk is shallow',
    );
    const reportCreated = await postForm(server, `/projects/${projectId}/reports`, cookie, token, {
      title: 'Walk report',
    });
    assert.equal(
      reportCreated.status,
      303,
      'the seeded report could not be generated, so the walk is shallow',
    );
    return {
      server,
      projectId,
      claimId: claim.claim.id,
      propositionId: proposition.id,
      runId: run.run.id,
      observationId: observation.id,
      workspacePath,
      close: () => server.close(),
    };
  } catch (error) {
    // A half-seeded fixture must not keep the process alive, or a broken test reads as a hang.
    await server.close();
    throw error;
  }
}

test('every form action on the reachable pages names a route the application serves', async () => {
  const fixture = await seeded();
  try {
    const pages = [
      '/',
      '/projects/new',
      `/projects/${fixture.projectId}`,
      `/projects/${fixture.projectId}/edit`,
      `/projects/${fixture.projectId}/entities`,
      `/projects/${fixture.projectId}/activity`,
      `/projects/${fixture.projectId}/claims`,
      `/projects/${fixture.projectId}/claims/new`,
      `/projects/${fixture.projectId}/claims/${fixture.claimId}`,
      `/projects/${fixture.projectId}/sources`,
      `/projects/${fixture.projectId}/sources/new`,
      `/projects/${fixture.projectId}/query-sets`,
      `/projects/${fixture.projectId}/query-sets/new`,
      `/projects/${fixture.projectId}/runs`,
      `/projects/${fixture.projectId}/runs/new`,
      `/projects/${fixture.projectId}/runs/${fixture.runId}`,
      fixture.workspacePath,
      `/projects/${fixture.projectId}/findings`,
      `/projects/${fixture.projectId}/findings/new`,
      `/projects/${fixture.projectId}/audits`,
      `/projects/${fixture.projectId}/audits/new`,
      `/projects/${fixture.projectId}/achievements`,
      `/projects/${fixture.projectId}/achievements/new`,
      `/projects/${fixture.projectId}/reports`,
    ];
    const entry = await getPage(fixture.server, '/');
    const cookie = cookieFrom(entry.response);
    const broken: string[] = [];
    let inspected = 0;
    for (const path of pages) {
      const page = await getPage(fixture.server, path, cookie);
      assert.equal(page.response.status, 200, `${path} did not render`);
      inspected += formsIn(page.text, path).length;
      for (const problem of unservedForms(page.text, path)) {
        broken.push(`${path} → ${problem}`);
      }
    }
    // A guard that inspected nothing would read as a pass, so the walk has a floor.
    assert.ok(
      inspected >= 30,
      `only ${String(inspected)} forms were inspected across ${String(pages.length)} pages`,
    );
    assert.deepEqual(broken, []);
  } finally {
    await fixture.close();
  }
});

test('the report, finding and retest pages offer only actions that resolve', async () => {
  const fixture = await seeded();
  try {
    const entry = await getPage(fixture.server, `/projects/${fixture.projectId}/reports`);
    const cookie = cookieFrom(entry.response);
    const reportId = /\/reports\/(rep_[A-Za-z0-9-]+)/.exec(entry.text)?.[1];
    assert.ok(reportId, 'the seeded report is not listed on the reports page');
    const findingId = /\/findings\/(fnd_[A-Za-z0-9-]+)/.exec(
      (await getPage(fixture.server, `/projects/${fixture.projectId}/findings`, cookie)).text,
    )?.[1];
    assert.ok(findingId, 'the seeded finding is not listed on the findings page');
    const paths = [
      `/projects/${fixture.projectId}/reports/${reportId}`,
      `/projects/${fixture.projectId}/findings/${findingId}`,
      `/projects/${fixture.projectId}/findings/${findingId}/retest`,
    ];
    for (const path of paths) {
      const page = await getPage(fixture.server, path, cookie);
      assert.notEqual(page.response.status, 404, `${path} is not a page the application serves`);
      const broken = unservedForms(page.text, path);
      assert.deepEqual(
        broken,
        [],
        `${path} renders actions that lead nowhere: ${broken.join(', ')}`,
      );
    }
  } finally {
    await fixture.close();
  }
});

test('the statement workspace forms post where they say they do, and the application accepts them', async () => {
  const fixture = await seeded();
  try {
    const entry = await getPage(fixture.server, fixture.workspacePath);
    const cookie = cookieFrom(entry.response);
    const token = csrfFrom(entry.text);
    // A statement is created the way an operator does it, so the per-statement forms exist to be read.
    const created = await postForm(fixture.server, fixture.workspacePath, cookie, token, {
      quoteText: QUOTE,
      statementKind: 'QUOTED',
      offsetBasis: 'EXACT_MATCH',
      relevance: 'ADDRESSES',
      paraphrase: '',
      note: '',
    });
    assert.equal(created.status, 303, 'the workspace refused the first statement');

    const page = await getPage(fixture.server, fixture.workspacePath, cookie);
    const forms = formsIn(page.text, fixture.workspacePath);
    const actionFor = (suffix: string): string => {
      const form = forms.find((candidate) => candidate.action.endsWith(suffix));
      assert.ok(
        form,
        `no rendered form posts to a path ending ${suffix}. Actions: ${forms
          .map((candidate) => candidate.action)
          .join(', ')}`,
      );
      return form.action;
    };

    const link = await postForm(fixture.server, actionFor('/propositions'), cookie, token, {
      propositionId: fixture.propositionId,
      relation: 'SUPPORTS_TARGET',
      rationale: 'The answer asserts what the proposition states.',
      reviewer: 'Ram',
    });
    assert.equal(link.status, 303, 'linking a statement to a proposition failed from the page');

    const citationId = /value="(cit_[A-Za-z0-9-]+)"/.exec(page.text)?.[1];
    assert.ok(citationId, 'the workspace offers no citation to map, so mapping cannot be verified');
    const mapping = await postForm(fixture.server, actionFor('/citations'), cookie, token, {
      citationId,
      support: 'SUPPORTS',
      rationale: 'The cited record names the same maker.',
      reviewer: 'Ram',
    });
    assert.equal(mapping.status, 303, 'mapping a citation to a statement failed from the page');

    const assessment = await postForm(fixture.server, actionFor('/assessments'), cookie, token, {
      dimension: 'FIDELITY',
      fidelityLabel: 'ACCURATE',
      attributionLabel: 'NOT_ADDRESSED',
      attributionSubject: '',
      attributionRole: '',
      rationale: 'The recorded artifact states the same year.',
      reviewer: 'Ram',
    });
    assert.equal(assessment.status, 303, 'recording a statement assessment failed from the page');

    // The correction forms only exist once there is a link or a mapping to correct, so the page is
    // read again rather than a URL being assembled by hand.
    const afterLinks = await getPage(fixture.server, fixture.workspacePath, cookie);
    const correctionAction = (suffix: string, fieldName: string): string => {
      const form = formsIn(afterLinks.text, fixture.workspacePath).find(
        (candidate) => candidate.action.endsWith(suffix) && candidate.fields.includes(fieldName),
      );
      assert.ok(
        form,
        `no rendered form ends ${suffix} and carries ${fieldName}. Actions: ${formsIn(
          afterLinks.text,
          fixture.workspacePath,
        )
          .map((candidate) => candidate.action)
          .join(', ')}`,
      );
      return form.action;
    };

    const supersedeLink = await postForm(
      fixture.server,
      correctionAction('/supersede', 'relation'),
      cookie,
      token,
      {
        propositionId: fixture.propositionId,
        relation: 'QUALIFIES_TARGET',
        rationale: 'On review the statement gives the year only under the recorded condition.',
        reviewer: 'Ram',
      },
    );
    assert.equal(
      supersedeLink.status,
      303,
      'correcting a proposition link failed from the page it was rendered on',
    );

    const supersedeMapping = await postForm(
      fixture.server,
      correctionAction('/supersede', 'support'),
      cookie,
      token,
      {
        citationId,
        support: 'SUPPORTS_WITH_CONDITIONS',
        rationale: 'The record supports the year, not the maintenance claim.',
        reviewer: 'Ram',
      },
    );
    assert.equal(
      supersedeMapping.status,
      303,
      'correcting a citation mapping failed from the page it was rendered on',
    );

    const revise = await postForm(fixture.server, actionFor('/revise'), cookie, token, {
      quoteText: QUOTE,
      offsetBasis: 'EXACT_MATCH',
      relevance: 'ADDRESSES',
      paraphrase: '',
      note: 'Checked once more against the capture.',
    });
    assert.equal(revise.status, 303, 'revising a statement failed from the page');

    const voided = await postForm(fixture.server, actionFor('/void'), cookie, token, {
      reason: 'Superseded by the revision just saved.',
    });
    assert.equal(voided.status, 303, 'voiding a statement failed from the page');
  } finally {
    await fixture.close();
  }
});
