import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateAnswerClaimAssessmentInput,
  validateAnswerClaimDraftInput,
  validateClaimCitationLinkInput,
  validateClaimPropositionLinkInput,
} from '../../src/core/answerClaimInputs.ts';
import { AppError } from '../../src/errors.ts';
import { closeDatabase } from '../../src/persistence/db.ts';
import { listAuditEvents } from '../../src/persistence/audit.ts';
import {
  claimAttributionLabel,
  claimFidelityLabel,
  createAnswerClaim,
  currentClaimLabels,
  getAnswerClaim,
  getAnswerClaimWorkspace,
  linkAnswerClaimCitation,
  linkAnswerClaimProposition,
  recordAnswerClaimAssessment,
  reviseAnswerClaim,
  supersedeAnswerClaimCitation,
  supersedeAnswerClaimProposition,
  voidAnswerClaim,
  type AnswerClaimRecord,
} from '../../src/persistence/repositories/answerClaims.ts';
import {
  approveQuerySet,
  createTestDatabase,
  insertCitation,
  insertClaimWithProposition,
  insertObservation,
  insertProject,
  insertQuery,
  insertQuerySet,
  insertRun,
  TEST_ACTOR,
  TEST_TIME,
} from '../helpers/db.ts';

const context = { actor: TEST_ACTOR, at: TEST_TIME };
const ANSWER = 'Project A was created by Ram and launched in 2021.';

function setup(): ReturnType<typeof createTestDatabase> {
  const db = createTestDatabase();
  insertProject(db, { id: 'prj_1' });
  insertProject(db, { id: 'prj_2' });
  insertClaimWithProposition(db, {
    projectId: 'prj_1',
    claimId: 'clm_1',
    revisionId: 'rev_1',
    propositionId: 'prp_1',
  });
  insertClaimWithProposition(db, {
    projectId: 'prj_2',
    claimId: 'clm_2',
    revisionId: 'rev_2',
    propositionId: 'prp_2',
  });
  insertQuerySet(db, { projectId: 'prj_1' });
  insertQuery(db);
  approveQuerySet(db);
  insertRun(db, { projectId: 'prj_1' });
  insertObservation(db, { answerText: ANSWER });
  insertCitation(db, { observationId: 'obs_1' });
  return db;
}

function draftOf(overrides: Record<string, unknown> = {}) {
  const relevance = (overrides['relevance'] ?? 'ADDRESSES') as string;
  // A recorded omission is the reviewer's own words, so it can never be located in the answer.
  const defaults =
    relevance === 'OMISSION'
      ? { quoteText: 'The funding body was never named.', offsetBasis: 'NOT_ESTABLISHED' }
      : { quoteText: 'created by Ram', offsetBasis: 'EXACT_MATCH' };
  const result = validateAnswerClaimDraftInput(
    { relevance: 'ADDRESSES', ...defaults, ...overrides },
    ANSWER,
  );
  if (!result.ok) {
    throw new Error(`fixture draft invalid: ${JSON.stringify(result.issues)}`);
  }
  return result.value;
}

function propositionLinkOf(overrides: Record<string, unknown> = {}) {
  const result = validateClaimPropositionLinkInput({
    propositionId: 'prp_1',
    relation: 'SUPPORTS_TARGET',
    rationale: 'The answer states what the proposition asserts.',
    reviewer: TEST_ACTOR,
    ...overrides,
  });
  if (!result.ok) {
    throw new Error(`fixture link invalid: ${JSON.stringify(result.issues)}`);
  }
  return result.value;
}

function citationLinkOf(overrides: Record<string, unknown> = {}) {
  const result = validateClaimCitationLinkInput({
    citationId: 'cit_1',
    support: 'SUPPORTS',
    rationale: 'The cited page states the same fact.',
    reviewer: TEST_ACTOR,
    ...overrides,
  });
  if (!result.ok) {
    throw new Error(`fixture citation invalid: ${JSON.stringify(result.issues)}`);
  }
  return result.value;
}

function assessmentOf(overrides: Record<string, unknown> = {}) {
  const result = validateAnswerClaimAssessmentInput({
    dimension: 'FIDELITY',
    label: 'ACCURATE',
    rationale: 'Matches the recorded release artifact.',
    reviewer: TEST_ACTOR,
    ...overrides,
  });
  if (!result.ok) {
    throw new Error(`fixture assessment invalid: ${JSON.stringify(result.issues)}`);
  }
  return result.value;
}

function addClaim(
  db: ReturnType<typeof createTestDatabase>,
  overrides: Record<string, unknown> = {},
): AnswerClaimRecord {
  return createAnswerClaim(db, 'prj_1', 'obs_1', draftOf(overrides), context);
}

/** Number of claim rows actually present, to prove a refused write left nothing behind. */
function claimRowCount(db: ReturnType<typeof createTestDatabase>): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM answer_claims').get() as Record<
    string,
    unknown
  >;
  return Number(row['n']);
}

test('creating a statement stores the quote at its resolved range', () => {
  const db = setup();
  try {
    const claim = addClaim(db);
    assert.equal(claim.ordinal, 1);
    assert.equal(claim.currentRevision?.quoteText, 'created by Ram');
    assert.equal(claim.currentRevision?.statementKind, 'QUOTED');
    assert.equal(claim.currentRevision?.offsetBasis, 'EXACT_MATCH');
    assert.equal(
      ANSWER.slice(
        claim.currentRevision?.startOffset as number,
        claim.currentRevision?.endOffset as number,
      ),
      'created by Ram',
    );
    assert.equal(claim.revisions.length, 1);
    assert.equal(claim.projectId, 'prj_1');
    assert.equal(claim.observationId, 'obs_1');
  } finally {
    closeDatabase(db);
  }
});

test('statements are ordered by ordinal within one observation', () => {
  const db = setup();
  try {
    addClaim(db, { quoteText: 'created by Ram' });
    addClaim(db, { quoteText: 'and launched in 2021' });
    const workspace = getAnswerClaimWorkspace(db, 'prj_1', 'obs_1');
    assert.deepEqual(
      workspace.claims.map((claim) => claim.ordinal),
      [1, 2],
    );
    assert.deepEqual(
      workspace.claims.map((claim) => claim.currentRevision?.quoteText),
      ['created by Ram', 'and launched in 2021'],
    );
  } finally {
    closeDatabase(db);
  }
});

test('the workspace carries the raw answer, available citations and project propositions', () => {
  const db = setup();
  try {
    addClaim(db);
    const workspace = getAnswerClaimWorkspace(db, 'prj_1', 'obs_1');
    assert.equal(workspace.answerText, ANSWER, 'the captured answer must stay readable');
    assert.equal(workspace.runStatus, 'OPEN');
    assert.deepEqual(
      workspace.citations.map((citation) => citation.id),
      ['cit_1'],
    );
    // Only the project's own current-revision propositions are offered to the operator.
    assert.deepEqual(
      workspace.propositions.map((proposition) => proposition.id),
      ['prp_1'],
    );
  } finally {
    closeDatabase(db);
  }
});

test('reading another project’s observation is refused', () => {
  const db = setup();
  try {
    const claim = addClaim(db);
    assert.throws(
      () => getAnswerClaimWorkspace(db, 'prj_2', 'obs_1'),
      (error: unknown) => error instanceof AppError && error.code === 'NOT_FOUND',
    );
    assert.equal(getAnswerClaim(db, 'prj_2', claim.id), null);
  } finally {
    closeDatabase(db);
  }
});

test('creating a claim from another project’s observation is refused and rolled back', () => {
  const db = setup();
  try {
    assert.throws(
      () => createAnswerClaim(db, 'prj_2', 'obs_1', draftOf(), context),
      /project that owns/,
    );
    assert.equal(claimRowCount(db), 0, 'the failed transaction left an orphan row');
  } finally {
    closeDatabase(db);
  }
});

test('a failed link inside a claim transaction rolls the statement back too', () => {
  const db = setup();
  try {
    const claim = addClaim(db);
    assert.equal(claimRowCount(db), 1);
    assert.throws(
      () =>
        linkAnswerClaimProposition(
          db,
          'prj_1',
          claim.id,
          propositionLinkOf({ propositionId: 'prp_2' }),
          context,
        ),
      /target proposition must belong/,
    );
    assert.equal(claimRowCount(db), 1, 'the prior claim must remain');
    const after = getAnswerClaim(db, 'prj_1', claim.id);
    assert.equal(after?.propositionLinks.length, 0);
    assert.equal(after?.currentRevisionId, claim.currentRevisionId);
  } finally {
    closeDatabase(db);
  }
});

test('revising a statement supersedes rather than rewrites history', () => {
  const db = setup();
  try {
    const first = addClaim(db, { quoteText: 'created by Ram' });
    recordAnswerClaimAssessment(db, 'prj_1', first.id, assessmentOf(), context);
    const revised = reviseAnswerClaim(
      db,
      'prj_1',
      first.id,
      draftOf({ quoteText: 'and launched in 2021', relevance: 'PARTIALLY_ADDRESSES' }),
      context,
    );
    assert.equal(revised.revisions.length, 2);
    assert.equal(revised.currentRevision?.quoteText, 'and launched in 2021');
    assert.equal(revised.currentRevision?.supersedesRevisionId, first.currentRevisionId);
    const prior = db
      .prepare('SELECT quote_text, relevance FROM answer_claim_revisions WHERE id = ?')
      .get(first.currentRevisionId as string) as Record<string, unknown>;
    assert.equal(prior['quote_text'], 'created by Ram', 'the original revision is unchanged');
    assert.equal(prior['relevance'], 'ADDRESSES');
    // The earlier assessment judged the superseded revision, so the new revision is unassessed.
    assert.equal(claimFidelityLabel(revised), undefined);
  } finally {
    closeDatabase(db);
  }
});

test('a revision cannot be created against a finalized run', () => {
  const db = setup();
  try {
    const claim = addClaim(db);
    db.prepare('UPDATE runs SET status = ?, finalized_at = ? WHERE id = ?').run(
      'FINALIZED',
      TEST_TIME,
      'run_1',
    );
    assert.throws(
      () =>
        reviseAnswerClaim(
          db,
          'prj_1',
          claim.id,
          draftOf({ quoteText: 'and launched in 2021' }),
          context,
        ),
      (error: unknown) =>
        error instanceof AppError && error.code === 'CONFLICT' && /finalized/.test(error.message),
    );
  } finally {
    closeDatabase(db);
  }
});

test('a fabricated quote is refused before any row is written', () => {
  const db = setup();
  try {
    const result = validateAnswerClaimDraftInput(
      { quoteText: 'created by Ram Jr.', relevance: 'ADDRESSES', offsetBasis: 'EXACT_MATCH' },
      ANSWER,
    );
    assert.equal(result.ok, false);

    // Even a caller that bypasses the validator cannot store it: the schema re-derives the range.
    assert.throws(
      () =>
        createAnswerClaim(
          db,
          'prj_1',
          'obs_1',
          {
            ...draftOf(),
            quoteText: 'created by Ram Jr.',
            statementKind: 'QUOTED',
            offsetBasis: 'EXACT_MATCH',
            startOffset: 0,
            endOffset: 18,
          },
          context,
        ),
      /exact-match quote must equal/,
    );
    assert.equal(claimRowCount(db), 0);
  } finally {
    closeDatabase(db);
  }
});

test('an omission cannot be stored as a located quotation', () => {
  const db = setup();
  try {
    // The validator refuses it...
    const result = validateAnswerClaimDraftInput(
      {
        quoteText: 'Project A was created by Ram',
        relevance: 'OMISSION',
        offsetBasis: 'EXACT_MATCH',
      },
      ANSWER,
    );
    assert.equal(result.ok, false);
    if (result.ok) {
      return;
    }
    assert.ok(result.issues.some((issue) => /omission/i.test(issue.message)));

    // ...and the schema refuses it even if a caller bypasses the validator.
    assert.throws(
      () =>
        createAnswerClaim(
          db,
          'prj_1',
          'obs_1',
          {
            ...draftOf({ quoteText: 'Project A was created by Ram' }),
            relevance: 'OMISSION',
            offsetBasis: 'EXACT_MATCH',
            startOffset: 0,
            endOffset: 28,
          },
          context,
        ),
      /CHECK constraint failed/,
    );
    assert.equal(claimRowCount(db), 0);

    const honest = addClaim(db, {
      quoteText: 'The funding body was never named.',
      relevance: 'OMISSION',
    });
    assert.equal(honest.currentRevision?.statementKind, 'REVIEWER_DESCRIPTION');
    assert.equal(honest.currentRevision?.offsetBasis, 'NOT_ESTABLISHED');
    assert.equal(honest.currentRevision?.startOffset, null);
    const assessed = recordAnswerClaimAssessment(
      db,
      'prj_1',
      honest.id,
      assessmentOf({ label: 'OMITTED', rationale: 'The answer left the funding body unsaid.' }),
      context,
    );
    assert.equal(claimFidelityLabel(assessed), 'OMITTED');
  } finally {
    closeDatabase(db);
  }
});

test('a reviewer description never claims a position inside the answer', () => {
  const db = setup();
  try {
    const claim = createAnswerClaim(
      db,
      'prj_1',
      'obs_1',
      draftOf({ quoteText: 'The answer hedges about the date.', offsetBasis: 'NOT_ESTABLISHED' }),
      context,
    );
    assert.equal(claim.currentRevision?.statementKind, 'REVIEWER_DESCRIPTION');
    assert.equal(claim.currentRevision?.startOffset, null);
    // A hand-built draft that calls itself a quote must still be located in the answer.
    assert.throws(
      () =>
        createAnswerClaim(
          db,
          'prj_1',
          'obs_1',
          {
            ...draftOf(),
            quoteText: 'The answer hedges about the date.',
            statementKind: 'QUOTED',
            offsetBasis: 'NOT_ESTABLISHED',
            startOffset: null,
            endOffset: null,
          },
          context,
        ),
      /CHECK constraint failed/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('links record the relationship and refuse a duplicate active pair', () => {
  const db = setup();
  try {
    const claim = addClaim(db);
    const linked = linkAnswerClaimProposition(db, 'prj_1', claim.id, propositionLinkOf(), context);
    assert.equal(linked.propositionLinks.length, 1);
    assert.equal(linked.propositionLinks[0]?.relation, 'SUPPORTS_TARGET');
    assert.throws(
      () => linkAnswerClaimProposition(db, 'prj_1', claim.id, propositionLinkOf(), context),
      (error: unknown) => error instanceof AppError && error.code === 'CONFLICT',
    );
  } finally {
    closeDatabase(db);
  }
});

test('a corrected proposition link keeps the original link readable', () => {
  const db = setup();
  try {
    const claim = addClaim(db);
    const first = linkAnswerClaimProposition(db, 'prj_1', claim.id, propositionLinkOf(), context);
    const linkId = first.propositionLinks[0]?.id as string;
    const updated = supersedeAnswerClaimProposition(
      db,
      'prj_1',
      linkId,
      propositionLinkOf({ relation: 'CONTRADICTS_TARGET' }),
      context,
    );
    const prior = updated.propositionLinks.find((link) => link.id === linkId);
    const replacement = updated.propositionLinks.find((link) => link.supersededBy === null);
    assert.equal(prior?.relation, 'SUPPORTS_TARGET');
    assert.equal(prior?.supersededBy, replacement?.id);
    assert.equal(replacement?.relation, 'CONTRADICTS_TARGET');
    assert.equal(updated.propositionLinks.length, 2);
  } finally {
    closeDatabase(db);
  }
});

test('superseding a link twice is refused', () => {
  const db = setup();
  try {
    const claim = addClaim(db);
    const first = linkAnswerClaimProposition(db, 'prj_1', claim.id, propositionLinkOf(), context);
    const linkId = first.propositionLinks[0]?.id as string;
    supersedeAnswerClaimProposition(
      db,
      'prj_1',
      linkId,
      propositionLinkOf({ relation: 'QUALIFIES_TARGET' }),
      context,
    );
    assert.throws(
      () =>
        supersedeAnswerClaimProposition(
          db,
          'prj_1',
          linkId,
          propositionLinkOf({ relation: 'OMITS_TARGET' }),
          context,
        ),
      /already been superseded/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('one statement may relate to several propositions and several statements to one proposition', () => {
  const db = setup();
  try {
    // prp_2 belongs to prj_2, so create a second proposition inside prj_1 instead.
    insertClaimWithProposition(db, {
      projectId: 'prj_1',
      claimId: 'clm_3',
      revisionId: 'rev_3',
      propositionId: 'prp_3',
    });
    const first = addClaim(db, { quoteText: 'created by Ram' });
    linkAnswerClaimProposition(db, 'prj_1', first.id, propositionLinkOf(), context);
    linkAnswerClaimProposition(
      db,
      'prj_1',
      first.id,
      propositionLinkOf({ propositionId: 'prp_3' }),
      context,
    );
    const second = addClaim(db, { quoteText: 'and launched in 2021' });
    linkAnswerClaimProposition(db, 'prj_1', second.id, propositionLinkOf(), context);

    const workspace = getAnswerClaimWorkspace(db, 'prj_1', 'obs_1');
    assert.equal(workspace.claims[0]?.propositionLinks.length, 2);
    const toPrp1 = workspace.claims.flatMap((claim) =>
      claim.propositionLinks.filter((link) => link.propositionId === 'prp_1'),
    );
    assert.equal(toPrp1.length, 2, 'two statements address the same proposition');
  } finally {
    closeDatabase(db);
  }
});

test('a citation may only be mapped to a statement of its own observation', () => {
  const db = setup();
  try {
    const claim = addClaim(db);
    insertObservation(db, { id: 'obs_2' });
    insertCitation(db, { id: 'cit_2', observationId: 'obs_2' });
    assert.throws(
      () =>
        linkAnswerClaimCitation(
          db,
          'prj_1',
          claim.id,
          citationLinkOf({ citationId: 'cit_2' }),
          context,
        ),
      (error: unknown) => error instanceof AppError && /different answer/.test(error.message),
    );
    const linked = linkAnswerClaimCitation(db, 'prj_1', claim.id, citationLinkOf(), context);
    assert.equal(linked.citationLinks.length, 1);
    assert.equal(linked.citationLinks[0]?.support, 'SUPPORTS');
  } finally {
    closeDatabase(db);
  }
});

test('a voided citation cannot be mapped to a statement', () => {
  const db = setup();
  try {
    const claim = addClaim(db);
    db.prepare('UPDATE citations SET voided_at = ?, void_reason = ? WHERE id = ?').run(
      TEST_TIME,
      'Duplicate capture.',
      'cit_1',
    );
    assert.throws(
      () => linkAnswerClaimCitation(db, 'prj_1', claim.id, citationLinkOf(), context),
      (error: unknown) => error instanceof AppError && /voided/.test(error.message),
    );
    assert.equal(
      getAnswerClaim(db, 'prj_1', claim.id)?.citationLinks.length,
      0,
      'the refused mapping must not be stored',
    );
  } finally {
    closeDatabase(db);
  }
});

test('the same citation mapped to two statements stays one citation', () => {
  const db = setup();
  try {
    const first = addClaim(db, { quoteText: 'created by Ram' });
    const second = addClaim(db, { quoteText: 'and launched in 2021' });
    linkAnswerClaimCitation(db, 'prj_1', first.id, citationLinkOf(), context);
    linkAnswerClaimCitation(db, 'prj_1', second.id, citationLinkOf(), context);
    const workspace = getAnswerClaimWorkspace(db, 'prj_1', 'obs_1');
    assert.equal(workspace.citations.length, 1);
    assert.equal(workspace.claims[0]?.citationLinks.length, 1);
    assert.equal(workspace.claims[1]?.citationLinks.length, 1);
  } finally {
    closeDatabase(db);
  }
});

test('a corrected citation mapping supersedes the earlier judgement', () => {
  const db = setup();
  try {
    const claim = addClaim(db);
    const first = linkAnswerClaimCitation(db, 'prj_1', claim.id, citationLinkOf(), context);
    const linkId = first.citationLinks[0]?.id as string;
    const updated = supersedeAnswerClaimCitation(
      db,
      'prj_1',
      linkId,
      citationLinkOf({ support: 'SUPPORTS_WITH_CONDITIONS' }),
      context,
    );
    assert.equal(updated.citationLinks.length, 2);
    assert.equal(
      updated.citationLinks.find((link) => link.id === linkId)?.supersededBy !== null,
      true,
    );
    assert.equal(
      updated.citationLinks.find((link) => link.supersededBy === null)?.support,
      'SUPPORTS_WITH_CONDITIONS',
    );
  } finally {
    closeDatabase(db);
  }
});

test('assessments version per dimension and never replace an earlier judgement', () => {
  const db = setup();
  try {
    const claim = addClaim(db);
    const first = recordAnswerClaimAssessment(db, 'prj_1', claim.id, assessmentOf(), context);
    assert.equal(claimFidelityLabel(first), 'ACCURATE');
    const second = recordAnswerClaimAssessment(
      db,
      'prj_1',
      claim.id,
      assessmentOf({ label: 'CONTRADICTED', rationale: 'A later read of the release note.' }),
      context,
    );
    assert.equal(claimFidelityLabel(second), 'CONTRADICTED');
    const fidelityVersions = second.assessments.filter((row) => row.dimension === 'FIDELITY');
    assert.deepEqual(
      fidelityVersions.map((row) => [row.version, row.label]),
      [
        [1, 'ACCURATE'],
        [2, 'CONTRADICTED'],
      ],
    );
    // A different dimension is numbered independently.
    const withAttribution = recordAnswerClaimAssessment(
      db,
      'prj_1',
      claim.id,
      assessmentOf({
        dimension: 'ATTRIBUTION',
        label: 'WRONG_ROLE',
        rationale: 'Named as author; the record shows maintainer.',
        attributionSubject: 'Ram',
      }),
      context,
    );
    assert.equal(claimAttributionLabel(withAttribution), 'WRONG_ROLE');
    assert.equal(currentClaimLabels(withAttribution).ATTRIBUTION, 'WRONG_ROLE');
    const attribution = withAttribution.assessments.find((row) => row.dimension === 'ATTRIBUTION');
    assert.equal(attribution?.version, 1);
    assert.equal(attribution?.attributionSubject, 'Ram');
  } finally {
    closeDatabase(db);
  }
});

test('refusal, abstention and contradiction stay distinguishable states', () => {
  const db = setup();
  try {
    addClaim(db, {
      quoteText: 'Project A was created by Ram',
      relevance: 'REFUSAL',
    });
    addClaim(db, { quoteText: 'and launched in 2021', relevance: 'ABSTENTION' });
    addClaim(db, { quoteText: 'created by Ram', relevance: 'CONTRADICTS' });
    const workspace = getAnswerClaimWorkspace(db, 'prj_1', 'obs_1');
    assert.deepEqual(
      workspace.claims.map((claim) => claim.currentRevision?.relevance),
      ['REFUSAL', 'ABSTENTION', 'CONTRADICTS'],
    );
  } finally {
    closeDatabase(db);
  }
});

test('voiding a statement retains it and stops further writes', () => {
  const db = setup();
  try {
    const claim = addClaim(db);
    const voided = voidAnswerClaim(
      db,
      'prj_1',
      claim.id,
      'Recorded the same sentence twice.',
      context,
    );
    assert.equal(voided.voidedAt, TEST_TIME);
    assert.equal(voided.voidReason, 'Recorded the same sentence twice.');
    assert.equal(getAnswerClaimWorkspace(db, 'prj_1', 'obs_1').claims.length, 1);
    assert.throws(() => reviseAnswerClaim(db, 'prj_1', claim.id, draftOf(), context), /voided/);
    assert.throws(
      () => linkAnswerClaimProposition(db, 'prj_1', claim.id, propositionLinkOf(), context),
      /voided/,
    );
    assert.throws(
      () => voidAnswerClaim(db, 'prj_1', claim.id, 'voided again here', context),
      /already been voided/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('a statement cannot be added to an observation with no captured answer', () => {
  const db = setup();
  try {
    insertObservation(db, { id: 'obs_err', status: 'ERROR' });
    assert.throws(
      () => createAnswerClaim(db, 'prj_1', 'obs_err', draftOf(), context),
      /no captured answer text/,
    );
    assert.equal(claimRowCount(db), 0);
  } finally {
    closeDatabase(db);
  }
});

test('every statement write produces exactly one audit event in the same transaction', () => {
  const db = setup();
  try {
    const claim = addClaim(db);
    const linked = linkAnswerClaimProposition(db, 'prj_1', claim.id, propositionLinkOf(), context);
    linkAnswerClaimCitation(db, 'prj_1', claim.id, citationLinkOf(), context);
    recordAnswerClaimAssessment(db, 'prj_1', claim.id, assessmentOf(), context);
    voidAnswerClaim(db, 'prj_1', linked.id, 'Superseded by a better decomposition.', context);
    const actions = listAuditEvents(db, 'prj_1')
      .map((event) => event.action)
      .sort();
    assert.deepEqual(actions, [
      'answer-claim.assessed',
      'answer-claim.citation-linked',
      'answer-claim.created',
      'answer-claim.proposition-linked',
      'answer-claim.voided',
    ]);
  } finally {
    closeDatabase(db);
  }
});
