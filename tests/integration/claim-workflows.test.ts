import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  listPropositionEvidence,
  listSources,
} from '../../src/persistence/repositories/evidence.ts';
import {
  csrfFrom,
  getPage,
  locationOf,
  pathOf,
  postForm,
  startTestServer,
} from '../helpers/http.ts';

async function createProject(
  server: Awaited<ReturnType<typeof startTestServer>>,
): Promise<{ cookie: string; projectPath: string; projectId: string }> {
  const form = await getPage(server, '/projects/new');
  const token = csrfFrom(form.text);
  const created = await postForm(server, '/projects', form.cookie, token, {
    name: 'Claim workflow project',
    description: 'A real project for end-to-end claim testing.',
  });
  assert.equal(created.status, 303);
  const projectPath = pathOf(locationOf(created));
  return {
    cookie: form.cookie,
    projectPath,
    projectId: projectPath.split('/')[2] ?? '',
  };
}

test('records a claim, propositions, conflicting evidence, review, and supersession', async () => {
  const server = await startTestServer();
  try {
    const project = await createProject(server);
    const claimsPage = await getPage(server, `${project.projectPath}/claims/new`, project.cookie);
    const claimToken = csrfFrom(claimsPage.text);
    const claimCreated = await postForm(
      server,
      `${project.projectPath}/claims`,
      project.cookie,
      claimToken,
      {
        text: 'The repository contains feature F in release 1.0.',
        sourceUrl: 'https://example.com/claim',
        intendedMeaning: 'The feature is present in the published release.',
        timeScope: 'Release 1.0',
        locale: 'en',
      },
    );
    assert.equal(claimCreated.status, 303);
    const claimPath = pathOf(locationOf(claimCreated));
    const claimId = claimPath.split('/')[4] ?? '';
    const afterCreate = await getPage(server, claimPath, project.cookie);
    assert.match(afterCreate.text, /Submitted/);
    assert.match(afterCreate.text, /Current revision/);

    const propositionToken = csrfFrom(afterCreate.text);
    const propositionCreated = await postForm(
      server,
      `${claimPath}/propositions`,
      project.cookie,
      propositionToken,
      {
        text: 'The repository contains feature F.',
        subject: 'repository',
        predicate: 'contains',
        objectValue: 'feature F',
        evidenceRequirements: 'Release tag and test log.',
        expectedAnswerCriterion: 'Names feature F in the repository.',
        timeInterval: 'Release 1.0',
      },
    );
    assert.equal(propositionCreated.status, 303);
    const afterProposition = await getPage(server, claimPath, project.cookie);
    assert.match(afterProposition.text, /Decomposed/);
    assert.match(afterProposition.text, /The repository contains feature F\./);
    assert.match(afterProposition.text, /No evidence relationships recorded/);

    const sourcePage = await getPage(server, `${project.projectPath}/sources/new`, project.cookie);
    const sourceToken = csrfFrom(sourcePage.text);
    const sourceCreated = await postForm(
      server,
      `${project.projectPath}/sources`,
      project.cookie,
      sourceToken,
      {
        title: 'Release archive',
        canonicalUri: 'https://example.com/release',
        sourceType: 'PRIMARY_ARTIFACT',
        accessRoute: 'MANUAL_ENTRY',
        retrievedAt: '2026-10-28T12:00:00Z',
        language: 'en',
        independence: 'INDEPENDENT',
      },
    );
    assert.equal(sourceCreated.status, 303);
    const sources = await getPage(server, `${project.projectPath}/sources`, project.cookie);
    assert.match(sources.text, /Release archive/);
    const sourceId = listSources(server.db, project.projectId)[0]?.id;
    assert.ok(sourceId);

    const afterSource = await getPage(server, claimPath, project.cookie);
    const proposition = afterSource.text.match(
      new RegExp(`/claims/${claimId}/propositions/(prp_[0-9a-f-]+)/evidence`),
    );
    const propositionId = proposition?.[1];
    assert.ok(propositionId);
    const evidenceToken = csrfFrom(afterSource.text);
    const evidenceCreated = await postForm(
      server,
      `${claimPath}/propositions/${propositionId}/evidence`,
      project.cookie,
      evidenceToken,
      {
        sourceId,
        locator: 'README section 1',
        excerpt: 'Feature F is implemented and tested.',
        extractionMethod: 'PASTED_TEXT',
        extractedAt: '2026-10-28T12:00:00Z',
        relation: 'SUPPORTS',
        rationale: 'The release archive states the feature exists.',
        reviewer: 'Ram',
      },
    );
    assert.equal(evidenceCreated.status, 303);
    const afterEvidence = await getPage(server, claimPath, project.cookie);
    assert.match(afterEvidence.text, /Feature F is implemented and tested/);
    assert.match(afterEvidence.text, /Supports/);

    const secondSource = await postForm(
      server,
      `${project.projectPath}/sources`,
      project.cookie,
      csrfFrom((await getPage(server, `${project.projectPath}/sources/new`, project.cookie)).text),
      {
        title: 'Independent review',
        sourceType: 'INDEPENDENT_SOURCE',
        accessRoute: 'MANUAL_ENTRY',
        retrievedAt: '2026-10-28T12:00:00Z',
        language: 'en',
        independence: 'INDEPENDENT',
      },
    );
    assert.equal(secondSource.status, 303);
    const secondSourceId = listSources(server.db, project.projectId).find(
      (source) => source.title === 'Independent review',
    )?.id;
    assert.ok(secondSourceId);
    const contradiction = await postForm(
      server,
      `${claimPath}/propositions/${propositionId}/evidence`,
      project.cookie,
      csrfFrom((await getPage(server, claimPath, project.cookie)).text),
      {
        sourceId: secondSourceId,
        locator: 'Paragraph 4',
        excerpt: 'Feature F is absent from release 1.0.',
        extractionMethod: 'PASTED_TEXT',
        extractedAt: '2026-10-28T12:00:00Z',
        relation: 'CONTRADICTS',
        rationale: 'The independent review says the feature is absent.',
        reviewer: 'Ram',
      },
    );
    assert.equal(contradiction.status, 303);
    const afterContradiction = await getPage(server, claimPath, project.cookie);
    assert.match(afterContradiction.text, /Conflicting evidence/);
    assert.match(afterContradiction.text, /Feature F is absent from release 1.0/);

    const reviewToken = csrfFrom(afterContradiction.text);
    const review = await postForm(server, `${claimPath}/status`, project.cookie, reviewToken, {
      to: 'UNDER_REVIEW',
    });
    assert.equal(review.status, 303);
    const afterReview = await getPage(server, claimPath, project.cookie);
    assert.match(afterReview.text, /Under review/);
    assert.match(afterReview.text, /Record a reviewed proposition conclusion/);

    const assessmentToken = csrfFrom(afterReview.text);
    const assessment = await postForm(
      server,
      `${claimPath}/propositions/${propositionId}/assessments`,
      project.cookie,
      assessmentToken,
      {
        label: 'SUPPORTED_WITHIN_SCOPE',
        rationale: 'Primary release artifact supports the proposition; conflict noted separately.',
        reviewer: 'Ram',
      },
    );
    assert.equal(assessment.status, 303);
    const afterAssessment = await getPage(server, claimPath, project.cookie);
    assert.match(
      afterAssessment.text,
      /Reviewed conclusion and the deterministic evidence rule disagree|reviewed conclusion/i,
    );
    assert.match(afterAssessment.text, /Primary release artifact supports/);

    const relationships = listPropositionEvidence(server.db, project.projectId, propositionId);
    const contradictionRelationship = relationships.find(
      (row) => row.relationship.relation === 'CONTRADICTS',
    );
    assert.ok(contradictionRelationship);
    const supersede = await postForm(
      server,
      `${claimPath}/propositions/${propositionId}/relationships/${contradictionRelationship.relationship.id}/supersede`,
      project.cookie,
      csrfFrom((await getPage(server, claimPath, project.cookie)).text),
      {
        relation: 'QUALIFIES',
        rationale: 'The independent source addresses scope rather than contradiction.',
        reviewer: 'Ram',
      },
    );
    assert.equal(supersede.status, 303);
    const afterSupersede = await getPage(server, claimPath, project.cookie);
    assert.match(afterSupersede.text, /Superseded/);
    assert.match(afterSupersede.text, /addresses scope rather than contradiction/);
  } finally {
    await server.close();
  }
});

test('rejects invalid propositions without losing the claim page', async () => {
  const server = await startTestServer();
  try {
    const project = await createProject(server);
    const form = await getPage(server, `${project.projectPath}/claims/new`, project.cookie);
    const claim = await postForm(
      server,
      `${project.projectPath}/claims`,
      project.cookie,
      csrfFrom(form.text),
      {
        text: 'A claim that is long enough to be valid.',
        locale: 'en',
      },
    );
    const claimPath = pathOf(locationOf(claim));
    const page = await getPage(server, claimPath, project.cookie);
    const response = await postForm(
      server,
      `${claimPath}/propositions`,
      project.cookie,
      csrfFrom(page.text),
      {
        text: 'Short.',
        evidenceRequirements: '',
      },
    );
    assert.equal(response.status, 422);
    const text = await response.text();
    assert.match(text, /Check the form/);
    assert.match(text, /Short\./);
    assert.match(text, /Evidence requirements/);
  } finally {
    await server.close();
  }
});

test('disputes a review, then creates a corrected revision', async () => {
  const server = await startTestServer();
  try {
    const project = await createProject(server);
    const newClaim = await getPage(server, `${project.projectPath}/claims/new`, project.cookie);
    const claim = await postForm(
      server,
      `${project.projectPath}/claims`,
      project.cookie,
      csrfFrom(newClaim.text),
      {
        text: 'The artifact contains feature F in the stated release.',
        locale: 'en',
      },
    );
    const claimPath = pathOf(locationOf(claim));
    const page = await getPage(server, claimPath, project.cookie);
    const proposition = await postForm(
      server,
      `${claimPath}/propositions`,
      project.cookie,
      csrfFrom(page.text),
      {
        text: 'The artifact contains feature F.',
        evidenceRequirements: 'A primary artifact.',
      },
    );
    assert.equal(proposition.status, 303);
    const afterProposition = await getPage(server, claimPath, project.cookie);
    const review = await postForm(
      server,
      `${claimPath}/status`,
      project.cookie,
      csrfFrom(afterProposition.text),
      {
        to: 'UNDER_REVIEW',
      },
    );
    assert.equal(review.status, 303);

    const reviewed = await getPage(server, claimPath, project.cookie);
    const missingReason = await postForm(
      server,
      `${claimPath}/status`,
      project.cookie,
      csrfFrom(reviewed.text),
      {
        to: 'DISPUTED',
      },
    );
    assert.equal(missingReason.status, 422);
    assert.match(await missingReason.text(), /dispute reason is required/i);

    const disputed = await postForm(
      server,
      `${claimPath}/status`,
      project.cookie,
      csrfFrom(reviewed.text),
      {
        to: 'DISPUTED',
        reason: 'The source refers to a different release.',
      },
    );
    assert.equal(disputed.status, 303);
    const afterDispute = await getPage(server, claimPath, project.cookie);
    assert.match(afterDispute.text, /Disputed/);

    const revised = await postForm(
      server,
      `${claimPath}/revisions`,
      project.cookie,
      csrfFrom(afterDispute.text),
      {
        text: 'The artifact contains feature F in the corrected release.',
        locale: 'en',
        note: 'Corrected release scope.',
      },
    );
    assert.equal(revised.status, 303);
    const afterRevision = await getPage(server, claimPath, project.cookie);
    assert.match(afterRevision.text, /Submitted/);
    assert.match(afterRevision.text, /v2/);
    assert.match(afterRevision.text, /corrected release/);
  } finally {
    await server.close();
  }
});
