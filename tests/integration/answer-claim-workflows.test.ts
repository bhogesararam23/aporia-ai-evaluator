import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createAnswerClaim,
  getAnswerClaim,
  getAnswerClaimWorkspace,
} from '../../src/persistence/repositories/answerClaims.ts';
import { createClaim, addProposition } from '../../src/persistence/repositories/claims.ts';
import { createProject } from '../../src/persistence/repositories/projects.ts';
import {
  addQuery,
  approveQuerySet,
  createQuerySet,
} from '../../src/persistence/repositories/querySets.ts';
import {
  addObservation,
  addCitation,
  createRun,
  finalizeRun,
} from '../../src/persistence/repositories/runs.ts';
import {
  cookieFrom,
  csrfFrom,
  getPage,
  locationOf,
  pathOf,
  postForm,
  startTestServer,
} from '../helpers/http.ts';

const context = { actor: 'Ram', at: '2026-10-28T12:00:00.000Z' };
const QUOTE = 'made by Ram';
const ANSWER = `The artifact exists and was ${QUOTE}.`;

async function seeded(): Promise<{
  server: Awaited<ReturnType<typeof startTestServer>>;
  projectId: string;
  runId: string;
  observationId: string;
  propositionId: string;
  citationId: string;
  close: () => Promise<void>;
}> {
  const server = await startTestServer();
  const project = createProject(
    server.db,
    {
      name: 'Claim workflow',
      description: undefined,
      primaryDomain: undefined,
      targetEntity: { name: 'Aporia', type: 'PROJECT_ARTIFACT' },
    },
    context,
  );
  const claim = createClaim(
    server.db,
    project.project.id,
    {
      text: 'The artifact contains feature F.',
      sourceUrl: undefined,
      intendedMeaning: undefined,
      timeScope: undefined,
      locale: 'en',
    },
    context,
  );
  const proposition = addProposition(
    server.db,
    project.project.id,
    claim.claim.id,
    {
      text: 'The artifact contains feature F.',
      subject: undefined,
      predicate: undefined,
      objectValue: undefined,
      conditions: undefined,
      timeInterval: undefined,
      units: undefined,
      evidenceRequirements: 'A release artifact.',
      expectedAnswerCriterion: undefined,
      ambiguityNotes: undefined,
    },
    context,
  );
  const querySet = createQuerySet(
    server.db,
    project.project.id,
    { name: 'Core', description: undefined, locale: 'en' },
    context,
  );
  const query = addQuery(
    server.db,
    project.project.id,
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
    project.project.id,
    querySet.set.id,
    { reviewer: 'Ram', note: undefined },
    context,
  );
  const run = createRun(
    server.db,
    project.project.id,
    querySet.set.id,
    {
      name: 'Manual',
      providerLabel: 'Example assistant',
      modelLabel: undefined,
      interfaceLabel: 'Consumer interface',
      groundingMode: 'UNKNOWN',
      locale: 'en',
      region: undefined,
      captureFrom: '2026-10-28T10:00:00.000Z',
      captureTo: '2026-10-28T11:00:00.000Z',
      conditions: 'Manual capture.',
      notes: undefined,
    },
    context,
  );
  const observation = addObservation(
    server.db,
    project.project.id,
    run.run.id,
    {
      queryId: query.id,
      status: 'COMPLETED',
      capturedAt: '2026-10-28T10:30:00.000Z',
      answerText: ANSWER,
      errorNote: undefined,
      citationCapture: 'CAPTURED',
      contextNotes: undefined,
    },
    context,
  );
  const citation = addCitation(
    server.db,
    project.project.id,
    run.run.id,
    observation.id,
    {
      url: 'https://example.com/artifact',
      title: 'Artifact',
      snippet: undefined,
      targetOwned: true,
    },
    context,
  );
  return {
    server,
    projectId: project.project.id,
    runId: run.run.id,
    observationId: observation.id,
    propositionId: proposition.id,
    citationId: citation.id,
    close: () => server.close(),
  };
}

function workspacePath(fixture: {
  projectId: string;
  runId: string;
  observationId: string;
}): string {
  return `/projects/${fixture.projectId}/runs/${fixture.runId}/observations/${fixture.observationId}/claims`;
}

test('the statement workspace shows the captured answer and an honest empty state', async () => {
  const fixture = await seeded();
  try {
    const page = await getPage(fixture.server, workspacePath(fixture));
    assert.equal(page.response.status, 200);
    assert.match(page.text, /The captured answer, exactly as recorded/);
    assert.match(page.text, new RegExp(QUOTE.replace(' ', '\\s*')));
    assert.match(page.text, /No statements recorded yet/);
    assert.match(page.text, /never a negative factual verdict/);
    // The operator is never asked to name a database identifier.
    assert.doesNotMatch(page.text, /observation_id|claim_revision_id/);
  } finally {
    await fixture.close();
  }
});

test('an operator can record, link, map and assess a statement end to end', async () => {
  const fixture = await seeded();
  try {
    const page = await getPage(fixture.server, workspacePath(fixture));
    const cookie = cookieFrom(page.response);
    const token = csrfFrom(page.text);

    const created = await postForm(fixture.server, workspacePath(fixture), cookie, token, {
      quoteText: QUOTE,
      statementKind: 'QUOTED',
      offsetBasis: 'EXACT_MATCH',
      relevance: 'ADDRESSES',
      paraphrase: '',
      note: '',
    });
    assert.equal(created.status, 303);
    assert.match(pathOf(locationOf(created)), /\/claims$/);

    let workspace = getAnswerClaimWorkspace(
      fixture.server.db,
      fixture.projectId,
      fixture.observationId,
    );
    assert.equal(workspace.claims.length, 1);
    const claim = workspace.claims[0];
    assert.ok(claim);
    assert.equal(claim.currentRevision?.quoteText, QUOTE);
    assert.equal(
      ANSWER.slice(
        claim.currentRevision?.startOffset as number,
        claim.currentRevision?.endOffset as number,
      ),
      QUOTE,
    );

    const linked = await postForm(
      fixture.server,
      `${workspacePath(fixture)}/${claim.id}/propositions`,
      cookie,
      token,
      {
        propositionId: fixture.propositionId,
        relation: 'SUPPORTS_TARGET',
        rationale: 'The answer asserts what the proposition states.',
        reviewer: 'Ram',
      },
    );
    assert.equal(linked.status, 303);

    const mapped = await postForm(
      fixture.server,
      `${workspacePath(fixture)}/${claim.id}/citations`,
      cookie,
      token,
      {
        citationId: fixture.citationId,
        support: 'SUPPORTS',
        rationale: 'The cited page names the same author.',
        reviewer: 'Ram',
      },
    );
    assert.equal(mapped.status, 303);

    const assessed = await postForm(
      fixture.server,
      `${workspacePath(fixture)}/${claim.id}/assessments`,
      cookie,
      token,
      {
        dimension: 'FIDELITY',
        fidelityLabel: 'ACCURATE',
        attributionLabel: 'NOT_ADDRESSED',
        rationale: 'Matches the recorded artifact.',
        reviewer: 'Ram',
      },
    );
    assert.equal(assessed.status, 303);

    workspace = getAnswerClaimWorkspace(
      fixture.server.db,
      fixture.projectId,
      fixture.observationId,
    );
    const finished = workspace.claims[0] as NonNullable<(typeof workspace.claims)[number]>;
    assert.equal(finished.propositionLinks.length, 1);
    assert.equal(finished.citationLinks.length, 1);
    assert.equal(finished.assessments.length, 1);

    // And the page now shows it all without a reload of live calculation.
    const after = await getPage(fixture.server, workspacePath(fixture), cookie);
    assert.match(after.text, /Statement 1/);
    assert.match(after.text, /Review history/);
    assert.match(after.text, /Asserts the target proposition/);
  } finally {
    await fixture.close();
  }
});

test('a quote that is not in the answer is refused with the submitted text preserved', async () => {
  const fixture = await seeded();
  try {
    const page = await getPage(fixture.server, workspacePath(fixture));
    const cookie = cookieFrom(page.response);
    const token = csrfFrom(page.text);
    const response = await postForm(fixture.server, workspacePath(fixture), cookie, token, {
      quoteText: 'authored by nobody at all',
      statementKind: 'QUOTED',
      offsetBasis: 'EXACT_MATCH',
      relevance: 'ADDRESSES',
      paraphrase: '',
      note: '',
    });
    assert.equal(response.status, 422);
    const text = await response.text();
    assert.match(text, /Check the form/);
    assert.match(text, /not present verbatim|does not match the captured answer/);
    assert.ok(text.includes('authored by nobody at all'), 'the submitted text must be preserved');
    assert.equal(
      getAnswerClaimWorkspace(fixture.server.db, fixture.projectId, fixture.observationId).claims
        .length,
      0,
    );
  } finally {
    await fixture.close();
  }
});

test('statement text is escaped and cannot inject markup', async () => {
  const fixture = await seeded();
  try {
    const page = await getPage(fixture.server, workspacePath(fixture));
    const cookie = cookieFrom(page.response);
    const token = csrfFrom(page.text);
    const hostile = 'The script <script>alert(1)</script> "quoted" & <img onerror=x>';
    const start = ANSWER.indexOf('The artifact');
    const response = await postForm(fixture.server, workspacePath(fixture), cookie, token, {
      quoteText: 'The artifact',
      statementKind: 'QUOTED',
      offsetBasis: 'EXACT_MATCH',
      relevance: 'ADDRESSES',
      paraphrase: hostile,
      note: '',
    });
    assert.equal(response.status, 303);
    void start;
    const rendered = await getPage(fixture.server, workspacePath(fixture), cookie);
    assert.ok(!rendered.text.includes('<script>alert(1)</script>'), 'raw script must not appear');
    assert.ok(
      rendered.text.includes('&lt;script&gt;alert(1)&lt;/script&gt;'),
      'text must be escaped',
    );
    assert.ok(!rendered.text.includes('onerror=x>') || rendered.text.includes('&lt;img'));
    const workspace = getAnswerClaimWorkspace(
      fixture.server.db,
      fixture.projectId,
      fixture.observationId,
    );
    assert.equal(workspace.claims[0]?.currentRevision?.paraphrase, hostile);
  } finally {
    await fixture.close();
  }
});

test('POST without a valid CSRF token is refused and writes nothing', async () => {
  const fixture = await seeded();
  try {
    const page = await getPage(fixture.server, workspacePath(fixture));
    const cookie = cookieFrom(page.response);
    const response = await postForm(fixture.server, workspacePath(fixture), cookie, 'wrong', {
      quoteText: QUOTE,
      statementKind: 'QUOTED',
      offsetBasis: 'EXACT_MATCH',
      relevance: 'ADDRESSES',
    });
    assert.ok(response.status === 403 || response.status === 401);
    assert.equal(
      getAnswerClaimWorkspace(fixture.server.db, fixture.projectId, fixture.observationId).claims
        .length,
      0,
    );
  } finally {
    await fixture.close();
  }
});

test('another project’s observation has no reachable workspace', async () => {
  const fixture = await seeded();
  try {
    const other = createProject(
      fixture.server.db,
      { name: 'Other', description: undefined, primaryDomain: undefined, targetEntity: null },
      context,
    );
    const page = await getPage(fixture.server, workspacePath(fixture));
    const cookie = cookieFrom(page.response);
    createAnswerClaim(
      fixture.server.db,
      fixture.projectId,
      fixture.observationId,
      {
        quoteText: QUOTE,
        statementKind: 'QUOTED',
        offsetBasis: 'EXACT_MATCH',
        startOffset: ANSWER.indexOf(QUOTE),
        endOffset: ANSWER.indexOf(QUOTE) + QUOTE.length,
        relevance: 'ADDRESSES',
        paraphrase: undefined,
        note: undefined,
      },
      context,
    );
    const workspace = getAnswerClaimWorkspace(
      fixture.server.db,
      fixture.projectId,
      fixture.observationId,
    );
    const claimId = (workspace.claims[0] as { id: string }).id;
    const foreign = `/projects/${other.project.id}/runs/${fixture.runId}/observations/${fixture.observationId}/claims`;
    const list = await getPage(fixture.server, foreign, cookie);
    assert.equal(list.response.status, 404);
    const revise = await postForm(
      fixture.server,
      `${foreign}/${claimId}/revise`,
      cookie,
      csrfFrom(page.text),
      {
        quoteText: QUOTE,
        offsetBasis: 'EXACT_MATCH',
        relevance: 'ADDRESSES',
      },
    );
    assert.ok(revise.status === 404 || revise.status === 403);
    assert.equal(
      getAnswerClaim(fixture.server.db, fixture.projectId, claimId)?.revisions.length,
      1,
    );
  } finally {
    await fixture.close();
  }
});

test('a finalized run renders the workspace read-only with no write forms', async () => {
  const fixture = await seeded();
  try {
    createAnswerClaim(
      fixture.server.db,
      fixture.projectId,
      fixture.observationId,
      {
        quoteText: QUOTE,
        statementKind: 'QUOTED',
        offsetBasis: 'EXACT_MATCH',
        startOffset: ANSWER.indexOf(QUOTE),
        endOffset: ANSWER.indexOf(QUOTE) + QUOTE.length,
        relevance: 'ADDRESSES',
        paraphrase: undefined,
        note: undefined,
      },
      context,
    );
    finalizeRun(fixture.server.db, fixture.projectId, fixture.runId, context);
    const page = await getPage(fixture.server, workspacePath(fixture));
    assert.equal(page.response.status, 200);
    assert.match(page.text, /frozen/);
    assert.ok(!page.text.includes('Record statement'), 'no create form when frozen');
    assert.ok(!page.text.includes('Map citation'), 'no mapping form when frozen');
    assert.ok(!page.text.includes('Record assessment'), 'no assessment form when frozen');
    // The recorded statement and its history remain readable.
    assert.match(page.text, /Statement 1/);
  } finally {
    await fixture.close();
  }
});

test('the run overview links to the statement workspace with real progress', async () => {
  const fixture = await seeded();
  try {
    let runPage = await getPage(
      fixture.server,
      `/projects/${fixture.projectId}/runs/${fixture.runId}`,
    );
    assert.match(runPage.text, /Statement-level review/);
    assert.match(runPage.text, /no statements recorded yet/);
    const cookie = cookieFrom(runPage.response);
    const token = csrfFrom(runPage.text);
    await postForm(fixture.server, workspacePath(fixture), cookie, token, {
      quoteText: QUOTE,
      statementKind: 'QUOTED',
      offsetBasis: 'EXACT_MATCH',
      relevance: 'ADDRESSES',
    });
    runPage = await getPage(
      fixture.server,
      `/projects/${fixture.projectId}/runs/${fixture.runId}`,
      cookie,
    );
    assert.match(runPage.text, /0 of 1 statement\(s\) assessed/);
  } finally {
    await fixture.close();
  }
});

test('the workspace separates what was recorded from what was reviewed', async () => {
  const fixture = await seeded();
  try {
    const entry = await getPage(fixture.server, workspacePath(fixture));
    const cookie = cookieFrom(entry.response);
    const token = csrfFrom(entry.text);
    await postForm(fixture.server, workspacePath(fixture), cookie, token, {
      quoteText: QUOTE,
      statementKind: 'QUOTED',
      offsetBasis: 'EXACT_MATCH',
      relevance: 'ADDRESSES',
    });
    let workspace = await getPage(fixture.server, workspacePath(fixture), cookie);
    const firstId = /\/claims\/(acs_[A-Za-z0-9-]+)\/assessments/.exec(workspace.text)?.[1];
    assert.ok(firstId, 'the first statement offers no assessment form');
    await postForm(
      fixture.server,
      `${workspacePath(fixture)}/${firstId}/assessments`,
      cookie,
      csrfFrom(workspace.text),
      {
        dimension: 'FIDELITY',
        fidelityLabel: 'ACCURATE',
        attributionLabel: 'NOT_ADDRESSED',
        rationale: 'The recorded artifact gives the same year.',
        reviewer: 'Ram',
      },
    );
    await postForm(fixture.server, workspacePath(fixture), cookie, csrfFrom(workspace.text), {
      quoteText: 'The artifact exists',
      statementKind: 'QUOTED',
      offsetBasis: 'EXACT_MATCH',
      relevance: 'ADDRESSES',
    });
    workspace = await getPage(fixture.server, workspacePath(fixture), cookie);
    // Fidelity recorded on one of two, attribution on neither, and the note says what those numbers are.
    assert.match(
      workspace.text,
      /fidelity recorded on 1 of 2 live statement\(s\), attribution on 0 of 2/,
      'the workspace does not separate recorded statements from assessed ones',
    );
    assert.match(
      workspace.text,
      /citation mappings that can support: \d+ of \d+/,
      'the workspace does not report which citation mappings can still support anything',
    );
    assert.match(
      workspace.text,
      /not answer results/,
      'the review-progress note reads as an answer result',
    );
    // A voided statement is still readable, and the note says it left the live count.
    await postForm(
      fixture.server,
      `${workspacePath(fixture)}/${firstId}/void`,
      cookie,
      csrfFrom(workspace.text),
      { reason: 'Recorded twice while checking the progress note.' },
    );
    workspace = await getPage(fixture.server, workspacePath(fixture), cookie);
    assert.match(
      workspace.text,
      /fidelity recorded on 0 of 1 live statement\(s\)/,
      'voiding a statement did not remove it from the live review count',
    );
    assert.match(
      workspace.text,
      /1 statement\(s\) on this answer were voided and stay readable/,
      'the note stopped telling the operator that a voided statement is still there',
    );
  } finally {
    await fixture.close();
  }
});
