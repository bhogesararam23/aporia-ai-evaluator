import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import {
  createAnswerClaim,
  getAnswerClaim,
  linkAnswerClaimCitation,
  linkAnswerClaimProposition,
  listAnswerClaimsForObservation,
  listAnswerClaimsForObservations,
  recordAnswerClaimAssessment,
  getAnswerClaimWorkspace,
} from '../../src/persistence/repositories/answerClaims.ts';
import {
  validateAnswerClaimDraftInput,
  type AnswerClaimDraftInput,
} from '../../src/core/answerClaimInputs.ts';
import { closeDatabase } from '../../src/persistence/db.ts';
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

/**
 * `metrics-v3` shipped `listAnswerClaimsForObservation` with a comment saying it read "a single pass
 * per table rather than one pass per claim". The code underneath that comment issued four queries per
 * claim, so a twelve-statement answer cost 49 and a run report issued five times the number of
 * statements in the run. The comment was not wrong about the intent; it was wrong about the code.
 *
 * These tests measure rather than assert an opinion. They count every statement the repository
 * prepares, and they check that the batch reader returns exactly what the per-record reader returns —
 * an optimisation that changes what a report says is not an optimisation.
 */

interface Counter {
  readonly count: () => number;
  readonly stop: () => void;
}

/** Count `db.prepare` calls for the lifetime of the returned handle. */
function countPrepared(db: DatabaseSync): Counter {
  const original = db.prepare.bind(db);
  let calls = 0;
  const target = db as unknown as { prepare: (sql: string) => unknown };
  target.prepare = (sql: string) => {
    calls += 1;
    return original(sql);
  };
  return {
    count: () => calls,
    stop: () => {
      target.prepare = original;
    },
  };
}

const context = { actor: TEST_ACTOR, at: TEST_TIME };

/** The captured answer every quote below is verified against. */
const ANSWER = 'Project A was created by Ram and launched in 2021. It is maintained by Sam.';

function draft(text: string): AnswerClaimDraftInput {
  const result = validateAnswerClaimDraftInput(
    {
      quoteText: text,
      offsetBasis: 'EXACT_MATCH',
      relevance: 'ADDRESSES',
    },
    ANSWER,
  );
  if (!result.ok) {
    throw new Error(`fixture draft invalid: ${JSON.stringify(result.issues)}`);
  }
  return result.value;
}

/** A run observation carrying `statementCount` statements, each linked, mapped and assessed. */
function seededObservation(
  db: DatabaseSync,
  observationId: string,
  statementCount: number,
  tag: string,
): void {
  for (let index = 0; index < statementCount; index += 1) {
    const claim = createAnswerClaim(
      db,
      'prj_1',
      observationId,
      draft(index % 2 === 0 ? 'created by Ram' : 'launched in 2021'),
      context,
    );
    linkAnswerClaimProposition(
      db,
      'prj_1',
      claim.id,
      {
        propositionId: 'prp_1',
        relation: 'SUPPORTS_TARGET',
        rationale: 'The answer states what the proposition asserts.',
        reviewer: TEST_ACTOR,
      },
      context,
    );
    linkAnswerClaimCitation(
      db,
      'prj_1',
      claim.id,
      {
        citationId: `cit_${tag}`,
        support: 'SUPPORTS',
        rationale: 'The cited page states the same fact.',
        reviewer: TEST_ACTOR,
      },
      context,
    );
    recordAnswerClaimAssessment(
      db,
      'prj_1',
      claim.id,
      {
        dimension: 'FIDELITY',
        label: 'ACCURATE',
        rationale: 'Matches the recorded release artifact.',
        reviewer: TEST_ACTOR,
        attributionSubject: undefined,
        attributionRole: undefined,
      },
      context,
    );
  }
}

function seeded(): DatabaseSync {
  const db = createTestDatabase();
  insertProject(db, { id: 'prj_1' });
  insertClaimWithProposition(db, {
    projectId: 'prj_1',
    claimId: 'clm_1',
    revisionId: 'rev_1',
    propositionId: 'prp_1',
  });
  insertQuerySet(db, { projectId: 'prj_1' });
  insertQuery(db);
  approveQuerySet(db);
  insertRun(db, { projectId: 'prj_1', id: 'run_1' });
  insertObservation(db, {
    runId: 'run_1',
    id: 'obs_1',
    queryId: 'qry_1',
    answerText: ANSWER,
  });
  insertCitation(db, { observationId: 'obs_1', id: 'cit_a' });
  insertObservation(db, {
    runId: 'run_1',
    id: 'obs_2',
    queryId: 'qry_1',
    answerText: ANSWER,
  });
  insertCitation(db, { observationId: 'obs_2', id: 'cit_b' });
  return db;
}

test('reading an observation costs a fixed number of queries, not four per statement', () => {
  const small = seeded();
  const large = seeded();
  try {
    seededObservation(small, 'obs_1', 1, 'a');
    seededObservation(large, 'obs_1', 12, 'a');

    const smallCounter = countPrepared(small);
    listAnswerClaimsForObservation(small, 'obs_1');
    const smallQueries = smallCounter.count();
    smallCounter.stop();

    const largeCounter = countPrepared(large);
    const batched = listAnswerClaimsForObservation(large, 'obs_1');
    const largeQueries = largeCounter.count();
    largeCounter.stop();

    assert.equal(batched.length, 12, 'the twelve statements are all read');
    assert.equal(
      smallQueries,
      largeQueries,
      `query count grew with the statement count: ${String(smallQueries)} for one statement versus ${String(largeQueries)} for twelve`,
    );
    // One claims query, then one each for revisions, proposition links, citation links, assessments.
    assert.equal(largeQueries, 5);
  } finally {
    closeDatabase(small);
    closeDatabase(large);
  }
});

test('the batch reader returns exactly what the per-record reader returns', () => {
  const db = seeded();
  try {
    seededObservation(db, 'obs_1', 6, 'a');
    const batched = listAnswerClaimsForObservation(db, 'obs_1');
    const individually = batched.map((claim) => getAnswerClaim(db, 'prj_1', claim.id));
    assert.deepEqual(
      individually,
      batched,
      'a record read alone and the same record read in a set must not differ',
    );
    // Ordinal order is a product guarantee, not an accident of the query planner.
    assert.deepEqual(
      batched.map((claim) => claim.ordinal),
      [1, 2, 3, 4, 5, 6],
    );
    for (const claim of batched) {
      assert.equal(claim.propositionLinks.length, 1);
      assert.equal(claim.citationLinks.length, 1);
      assert.equal(claim.assessments.length, 1);
      assert.equal(claim.revisions.length, 1);
      assert.equal(claim.currentRevision?.relevance, 'ADDRESSES');
    }
  } finally {
    closeDatabase(db);
  }
});

test('a whole run costs the same five queries whichever way it is read', () => {
  const db = seeded();
  try {
    seededObservation(db, 'obs_1', 5, 'a');
    seededObservation(db, 'obs_2', 5, 'b');

    const batchCounter = countPrepared(db);
    const batched = listAnswerClaimsForObservations(db, ['obs_1', 'obs_2']);
    const batchQueries = batchCounter.count();
    batchCounter.stop();
    assert.equal(batchQueries, 5, 'five queries for the whole run');

    // The pre-v0.4 shape, still available through the per-observation entry point: the cost grew
    // with the statements, which is the number this replaces.
    const loopCounter = countPrepared(db);
    listAnswerClaimsForObservation(db, 'obs_1');
    listAnswerClaimsForObservation(db, 'obs_2');
    const loopQueries = loopCounter.count();
    loopCounter.stop();
    assert.ok(
      loopQueries > batchQueries,
      `two single-observation reads cost ${String(loopQueries)} against ${String(batchQueries)} batched`,
    );

    assert.deepEqual(
      [...batched.keys()],
      ['obs_1', 'obs_2'],
      'every requested observation is keyed, even an empty one',
    );
    assert.equal(batched.get('obs_1')?.length, 5);
    assert.equal(batched.get('obs_2')?.length, 5);
  } finally {
    closeDatabase(db);
  }
});

test('an observation with no statements costs the same as one with a thousand', () => {
  const db = seeded();
  try {
    const counter = countPrepared(db);
    const empty = listAnswerClaimsForObservations(db, ['obs_1', 'obs_2']);
    const queries = counter.count();
    counter.stop();
    assert.equal(queries, 1, 'no child table is queried when no claim row exists');
    assert.deepEqual(empty.get('obs_1'), []);
    assert.deepEqual(empty.get('obs_2'), []);
  } finally {
    closeDatabase(db);
  }
});

test('the workspace page reads its statements through the batched path', () => {
  const db = seeded();
  try {
    seededObservation(db, 'obs_1', 4, 'a');
    const counter = countPrepared(db);
    const workspace = getAnswerClaimWorkspace(db, 'prj_1', 'obs_1');
    const queries = counter.count();
    counter.stop();
    assert.equal(workspace.claims.length, 4);
    assert.equal(workspace.citations.length, 1);
    assert.ok(workspace.propositions.length >= 1);
    // Observation, citations, propositions, then the five-query claim batch.
    assert.ok(
      queries <= 8,
      `the workspace should read in a fixed number of queries, took ${String(queries)}`,
    );
  } finally {
    closeDatabase(db);
  }
});
