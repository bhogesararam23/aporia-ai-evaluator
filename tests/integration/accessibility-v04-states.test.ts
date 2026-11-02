/**
 * Accessibility of the v0.4 states, not just the v0.3 pages.
 *
 * The existing page walk proves the pages are structurally sound when they hold ordinary content. The
 * states v0.4 added are exactly where a screen-reader user gets left out: a quote that contains markup,
 * a reviewer description of an absence, a voided record that must still be readable, six citations on one
 * answer, a rejected submission that must announce itself, and an empty retest page that has to explain
 * why it is empty rather than render a form that cannot work.
 *
 * Nothing here is a substitute for the checks this environment cannot run: no screen reader (NVDA, JAWS,
 * VoiceOver) has traversed these pages, no mobile layout or touch target has been examined, and no browser
 * other than the one reachable on loopback has rendered them. Structural assertions can prove a reference
 * resolves; they cannot prove an announcement is intelligible.
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
  voidCitation,
} from '../../src/persistence/repositories/runs.ts';
import {
  createAnswerClaim,
  linkAnswerClaimCitation,
  recordAnswerClaimAssessment,
  voidAnswerClaim,
} from '../../src/persistence/repositories/answerClaims.ts';
import { createFinding, transitionFinding } from '../../src/persistence/repositories/findings.ts';
import { generateReport } from '../../src/app/reportingService.ts';
import { accessibilityViolations, errorAnnouncementProblems } from '../helpers/dom-a11y.ts';
import { cookieFrom, csrfFrom, getPage, postForm, startTestServer } from '../helpers/http.ts';

const context = { actor: 'Ram', at: '2026-11-02T12:00:00.000Z' };
// Markup inside captured content is the realistic case: an answer that quotes a code sample or pastes a
// snippet. It must reach the page as text, never as an element.
const HOSTILE = '<script>alert(1)</script> and <img src=x onerror=alert(2)>';
const LONG_TAIL = ' '.repeat(60) + 'the maintainer role was recorded without a start date';
const ANSWER = `Project A was created in 2021 by Ram. The answer also contained ${HOSTILE} followed by ${LONG_TAIL}.`;

test('the statement workspace, its voided records and a hostile quote stay accessible', async () => {
  const server = await startTestServer();
  try {
    const project = createProject(
      server.db,
      {
        name: 'v0.4 accessibility states',
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
        text: 'Project A was created in 2021 by Ram.',
        sourceUrl: undefined,
        intendedMeaning: undefined,
        timeScope: undefined,
        locale: 'en',
      },
      context,
    );
    addProposition(
      server.db,
      projectId,
      claim.claim.id,
      {
        text: 'Project A was created in 2021 by Ram.',
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
    const set = createQuerySet(
      server.db,
      projectId,
      { name: 'Core', description: undefined, locale: 'en' },
      context,
    );
    const query = addQuery(
      server.db,
      projectId,
      set.set.id,
      {
        text: 'Who created Project A?',
        intent: 'ATTRIBUTION',
        locale: undefined,
        region: undefined,
        branded: false,
        expectedElements: 'The creator.',
        inclusionRationale: 'The claim asks it.',
      },
      context,
    );
    approveQuerySet(
      server.db,
      projectId,
      set.set.id,
      { reviewer: 'Ram', note: undefined },
      context,
    );
    const run = createRun(
      server.db,
      projectId,
      set.set.id,
      {
        name: 'Many citations',
        providerLabel: 'Manual assistant entry',
        modelLabel: undefined,
        interfaceLabel: 'Consumer interface',
        groundingMode: 'UNKNOWN',
        locale: 'en',
        region: undefined,
        captureFrom: '2026-11-02T10:00:00.000Z',
        captureTo: '2026-11-02T11:00:00.000Z',
        conditions: 'Signed out, no tools.',
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
    const citationIds: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const citation = addCitation(
        server.db,
        projectId,
        run.run.id,
        observation.id,
        {
          url: `https://example.invalid/source-${String(index)}`,
          title: `Recorded source ${String(index)}`,
          snippet: index === 0 ? HOSTILE : undefined,
          targetOwned: index === 0,
        },
        context,
      );
      citationIds.push(citation.id);
    }
    const quote = (fragment: string): { startOffset: number; endOffset: number } => ({
      startOffset: ANSWER.indexOf(fragment),
      endOffset: ANSWER.indexOf(fragment) + fragment.length,
    });
    const asserting = createAnswerClaim(
      server.db,
      projectId,
      observation.id,
      {
        quoteText: 'Project A was created in 2021 by Ram.',
        statementKind: 'QUOTED',
        offsetBasis: 'EXACT_MATCH',
        ...quote('Project A was created in 2021 by Ram.'),
        relevance: 'ADDRESSES',
        paraphrase: undefined,
        note: undefined,
      },
      context,
    );
    const withdrawnQuote = HOSTILE;
    const hostile = createAnswerClaim(
      server.db,
      projectId,
      observation.id,
      {
        quoteText: withdrawnQuote,
        statementKind: 'QUOTED',
        offsetBasis: 'EXACT_MATCH',
        ...quote(withdrawnQuote),
        relevance: 'DOES_NOT_ADDRESS',
        paraphrase: undefined,
        note: 'The answer pasted markup; it is content, not an assertion about the target.',
      },
      context,
    );
    const described = createAnswerClaim(
      server.db,
      projectId,
      observation.id,
      {
        quoteText: 'The answer never says from when Ram has held the role.',
        statementKind: 'REVIEWER_DESCRIPTION',
        offsetBasis: 'NOT_ESTABLISHED',
        startOffset: null,
        endOffset: null,
        relevance: 'OMISSION',
        paraphrase: undefined,
        note: undefined,
      },
      context,
    );
    assert.equal(described.currentRevision?.statementKind, 'REVIEWER_DESCRIPTION');
    assert.equal(described.currentRevision?.startOffset, null);
    voidAnswerClaim(server.db, projectId, hostile.id, 'Recorded twice during this check.', context);
    linkAnswerClaimCitation(
      server.db,
      projectId,
      asserting.id,
      {
        citationId: citationIds[0] as string,
        support: 'SUPPORTS',
        rationale: 'The first record carries the same fact.',
        reviewer: 'Ram',
      },
      context,
    );
    recordAnswerClaimAssessment(
      server.db,
      projectId,
      asserting.id,
      {
        dimension: 'FIDELITY',
        label: 'ACCURATE',
        attributionSubject: undefined,
        attributionRole: undefined,
        rationale: 'The recorded artifact gives the same year.',
        reviewer: 'Ram',
      },
      context,
    );
    voidCitation(
      server.db,
      projectId,
      run.run.id,
      observation.id,
      citationIds[0] as string,
      { reason: 'The record was withdrawn after mapping.', reviewer: 'Ram' },
      context,
    );
    const finding = createFinding(
      server.db,
      projectId,
      {
        title: 'The answer never states the start of the role',
        observedIssue: 'The captured answer omits when the maintenance began.',
        supportingEvidence: 'One captured answer and one reviewer description.',
        cause: 'MODEL_MISREAD_OR_OMISSION',
        severity: 'LOW',
        severityRationale: 'A reader can still identify the maintainer.',
        recommendedAction: 'State the period on the project page.',
        ownerLabel: 'Ram',
        firstObservedAt: '2026-11-02T10:00:00.000Z',
        lastObservedAt: '2026-11-02T11:00:00.000Z',
        references: [],
      },
      context,
    );
    for (const status of ['ACCEPTED', 'IN_PROGRESS', 'RETEST_REQUIRED'] as const) {
      transitionFinding(
        server.db,
        projectId,
        finding.id,
        { status, note: `Moved to ${status} for the accessibility check.` },
        context,
      );
    }

    const entry = await getPage(server, '/');
    const cookie = cookieFrom(entry.response);
    const workspacePath = `/projects/${projectId}/runs/${run.run.id}/observations/${observation.id}/claims`;
    const pages = [
      {
        path: `/projects/${projectId}/runs/${run.run.id}`,
        why: 'six citations and a withdrawn record',
      },
      { path: workspacePath, why: 'voided statement, description, hostile quote, assessment' },
      {
        path: `/projects/${projectId}/findings/${finding.id}`,
        why: 'retest-required finding with no comparison',
      },
    ];
    const failures: string[] = [];
    for (const page of pages) {
      const rendered = await getPage(server, page.path, cookie);
      if (rendered.response.status !== 200) {
        failures.push(`${page.path} returned ${String(rendered.response.status)}`);
        continue;
      }
      for (const violation of accessibilityViolations(rendered.text)) {
        failures.push(`${page.path} (${page.why}): ${violation}`);
      }
      if (page.path === workspacePath) {
        // A quote that contains markup has to arrive as text. accessibilityViolations already refuses a
        // script element; these two assertions say what a reader should actually see instead.
        assert.match(
          rendered.text,
          /&lt;script&gt;/,
          'the markup quote was not rendered as escaped text',
        );
        assert.doesNotMatch(
          rendered.text,
          /<script>alert/,
          'the captured answer reached the page as script',
        );
        assert.match(rendered.text, /onerror=alert\(2\)/, 'the escaped quote lost its content');
        // The reviewer's label must not read as a verified identity.
        assert.match(
          rendered.text,
          /not an authenticated identity|no independent review/,
          'the workspace does not distinguish an entered label from a verified identity',
        );
        // Long content must be readable, not clipped away into nothing.
        assert.match(
          rendered.text,
          /Project A was created in 2021 by Ram\./,
          'the first statement is not readable on the workspace',
        );
        // A reviewer description has to be visibly the reviewer's words, not a quote with no position.
        assert.match(
          rendered.text,
          /The answer never says from when Ram has held the role\./,
          'the reviewer description is not readable on the workspace',
        );
        assert.match(
          rendered.text,
          /Described in the reviewer|’s own words|own words/,
          'the workspace does not label which statements are the reviewer’s own words',
        );
        assert.match(
          rendered.text,
          /No reliable position/,
          'a description with no claimed position is not marked as such',
        );
      }
    }
    assert.deepEqual(failures, []);

    // A rejected submission has to say so where a screen reader and a keyboard user will meet it.
    const token = csrfFrom((await getPage(server, workspacePath, cookie)).text);
    const rejected = await postForm(server, workspacePath, cookie, token, {
      quoteText: 'Project A was launched in 2005 with backing from Acme.',
      statementKind: 'QUOTED',
      offsetBasis: 'EXACT_MATCH',
      relevance: 'ADDRESSES',
      paraphrase: '',
      note: '',
    });
    assert.equal(rejected.status, 422, 'a fabricated quote should be refused');
    const rejectedBody = await rejected.text();
    assert.deepEqual(errorAnnouncementProblems(rejectedBody), []);
    // The typed text is preserved so the operator can correct it rather than re-enter it.
    assert.match(rejectedBody, /backing from Acme/, 'the rejected submission lost what was typed');
    assert.match(
      rejectedBody,
      /Recorded twice during this check/,
      'the rejection page no longer shows the voided statement beside it',
    );

    // Then the capture is frozen, and the two states that only exist afterwards are checked: the retest
    // page with one finalized run, which must explain what is missing instead of offering a comparison
    // that cannot be made, and a report that carries the same hostile quote.
    finalizeRun(server.db, projectId, run.run.id, context);
    const generated = generateReport(server.db, projectId, 'Accessibility report', context);
    const afterFreeze = [
      {
        path: `/projects/${projectId}/findings/${finding.id}/retest`,
        expect: 'Two finalized runs are needed',
        why: 'an empty retest page has to say why it is empty',
      },
      {
        path: `/projects/${projectId}/reports/${generated.report.id}`,
        expect: '&lt;script&gt;alert(1)&lt;/script&gt;',
        why: 'the report renders the captured markup as escaped text',
      },
    ];
    for (const page of afterFreeze) {
      const rendered = await getPage(server, page.path, cookie);
      assert.equal(rendered.response.status, 200, `${page.path} did not render`);
      assert.deepEqual(accessibilityViolations(rendered.text), [], page.path);
      assert.ok(rendered.text.includes(page.expect), `${page.path} (${page.why})`);
    }
  } finally {
    await server.close();
  }
});
