import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  approveQuerySet,
  createTestDatabase,
  insertAnswerClaim,
  insertClaimAssessment,
  insertClaimCitationLink,
  insertClaimPropositionLink,
  insertCitation,
  insertClaimWithProposition,
  insertObservation,
  insertProject,
  insertQuery,
  insertQuerySet,
  insertAnswerClaimRevision,
  insertRun,
} from '../helpers/db.ts';

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as Record<string, unknown>;
  return Number(row['n']);
}

function setup(options: { runStatus?: 'OPEN' | 'FINALIZED' | 'CANCELLED' } = {}): DatabaseSync {
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
  insertQuerySet(db, { id: 'qst_2', projectId: 'prj_2', name: 'Other set' });
  insertQuery(db, { id: 'qry_2', querySetId: 'qst_2' });
  approveQuerySet(db, { querySetId: 'qst_2' });
  insertRun(db, { projectId: 'prj_1', status: options.runStatus ?? 'OPEN' });
  insertObservation(db, { runId: 'run_1', queryId: 'qry_1' });
  insertCitation(db, { observationId: 'obs_1' });
  return db;
}

test('a verbatim quote with a correct range is stored', () => {
  const db = setup();
  try {
    const { claimId, revisionId } = insertAnswerClaim(db, { quoteText: 'created by Ram' });
    assert.equal(claimId, 'acs_1');
    const row = db
      .prepare(
        'SELECT quote_text, start_offset, end_offset FROM answer_claim_revisions WHERE id = ?',
      )
      .get(revisionId) as Record<string, unknown>;
    assert.equal(row['quote_text'], 'created by Ram');
    assert.equal(typeof row['start_offset'], 'number');
  } finally {
    db.close();
  }
});

test('the database refuses a quote that does not sit at its recorded range', () => {
  const db = setup();
  try {
    assert.throws(
      () =>
        insertAnswerClaim(db, {
          quoteText: 'Project A was created by Ram.',
          startOffset: 3,
          endOffset: 14,
        }),
      /exact-match quote must equal the text at its recorded range/,
    );
  } finally {
    db.close();
  }
});

test('a range that extends past the captured answer is refused', () => {
  const db = setup();
  try {
    assert.throws(
      () =>
        insertAnswerClaim(db, {
          offsetBasis: 'NORMALIZED_MATCH',
          quoteText: 'anything at all',
          startOffset: 0,
          endOffset: 9999,
        }),
      /extends past the captured answer/,
    );
  } finally {
    db.close();
  }
});

test('an unestablished basis must not store offsets, and a located basis must', () => {
  const db = setup();
  try {
    assert.throws(
      () =>
        insertAnswerClaim(db, {
          id: 'acs_1',
          revisionId: 'acr_1',
          offsetBasis: 'NOT_ESTABLISHED',
          quoteText: 'a paraphrase',
          startOffset: 0,
          endOffset: 5,
        }),
      /CHECK constraint failed/,
    );
    // A located basis with no stored range is refused. The table CHECK and the quote trigger both
    // cover it; the trigger fires first, and either refusal is the guarantee being asserted here.
    assert.throws(
      () =>
        insertAnswerClaim(db, {
          id: 'acs_2',
          revisionId: 'acr_2',
          ordinal: 2,
          offsetBasis: 'EXACT_MATCH',
          quoteText: 'Project A was created by Ram.',
          startOffset: null,
          endOffset: null,
        }),
      /CHECK constraint failed|exact-match quote must equal the text at its recorded range/,
    );
    insertAnswerClaim(db, {
      id: 'acs_3',
      revisionId: 'acr_3',
      ordinal: 3,
      offsetBasis: 'NOT_ESTABLISHED',
      quoteText: 'a paraphrase',
    });
  } finally {
    db.close();
  }
});

test('code-point offsets let a quoted answer containing an emoji be re-derived in SQL', () => {
  const db = createTestDatabase();
  try {
    insertProject(db);
    insertQuerySet(db);
    insertQuery(db, { text: 'What shipped?' });
    approveQuerySet(db);
    insertRun(db);
    insertObservation(db, { answerText: '\u{1F389} shipped the parser \u{1F389}' });
    // Two emoji are four UTF-16 code units but two code points each side.
    insertAnswerClaim(db, { quoteText: 'shipped the parser', startOffset: 2, endOffset: 20 });
    assert.throws(
      () =>
        insertAnswerClaim(db, {
          id: 'acs_2',
          ordinal: 2,
          quoteText: 'shipped the parser',
          startOffset: 1,
          endOffset: 19,
        }),
      /exact-match quote must equal the text at its recorded range/,
    );
  } finally {
    db.close();
  }
});

test('a recorded omission cannot be stored as a located quotation', () => {
  const db = setup();
  try {
    // The quote here is a real slice at a real range, so the only rule left to refuse it is the one
    // that says an omission is a reviewer description rather than something the answer said.
    assert.throws(
      () =>
        insertAnswerClaim(db, {
          id: 'acs_1',
          revisionId: 'acr_1',
          relevance: 'OMISSION',
          offsetBasis: 'EXACT_MATCH',
          quoteText: 'Project A was created by Ram',
          startOffset: 0,
          endOffset: 28,
        }),
      /CHECK constraint failed/,
    );
    insertAnswerClaim(db, {
      id: 'acs_2',
      revisionId: 'acr_2',
      ordinal: 2,
      relevance: 'OMISSION',
      offsetBasis: 'NOT_ESTABLISHED',
      quoteText: 'The answer never named the co-author.',
    });
  } finally {
    db.close();
  }
});

test('revising a statement keeps the earlier revision and its assessments', () => {
  const db = setup();
  try {
    const first = insertAnswerClaim(db, { quoteText: 'created by Ram' });
    insertClaimAssessment(db, { claimId: first.claimId, claimRevisionId: first.revisionId });
    insertAnswerClaimRevision(db, {
      claimId: first.claimId,
      revisionId: 'acr_2',
      revision: 2,
      quoteText: 'Project A was created by Ram.',
      supersedesRevisionId: first.revisionId,
    });
    const revisions = db
      .prepare('SELECT id, revision, quote_text FROM answer_claim_revisions ORDER BY revision')
      .all() as Record<string, unknown>[];
    assert.equal(revisions.length, 2);
    assert.equal(revisions[0]?.['quote_text'], 'created by Ram');
    assert.equal(revisions[1]?.['quote_text'], 'Project A was created by Ram.');
    const history = db
      .prepare('SELECT version, claim_revision_id FROM answer_claim_assessments ORDER BY version')
      .all() as Record<string, unknown>[];
    assert.equal(history.length, 1);
    assert.equal(history[0]?.['claim_revision_id'], 'acr_1');
  } finally {
    db.close();
  }
});

test('a revision number must follow its predecessor and revisions are append-only', () => {
  const db = setup();
  try {
    insertAnswerClaim(db, { quoteText: 'created by Ram' });
    assert.throws(
      () =>
        insertAnswerClaimRevision(db, {
          claimId: 'acs_1',
          revisionId: 'acr_3',
          revision: 3,
          quoteText: 'created by Ram',
        }),
      /must follow the previous revision number/,
    );
    assert.throws(
      () =>
        db
          .prepare('UPDATE answer_claim_revisions SET quote_text = ? WHERE id = ?')
          .run('rewritten', 'acr_1'),
      /append-only/,
    );
  } finally {
    db.close();
  }
});

test('a revision can only supersede a revision of the same claim', () => {
  const db = setup();
  try {
    insertAnswerClaim(db, { id: 'acs_1', revisionId: 'acr_1' });
    insertAnswerClaim(db, { id: 'acs_9', ordinal: 2, revisionId: 'acr_9' });
    assert.throws(
      () =>
        insertAnswerClaimRevision(db, {
          claimId: 'acs_9',
          revisionId: 'acr_10',
          revision: 2,
          supersedesRevisionId: 'acr_1',
        }),
      /only supersede a revision of the same answer claim/,
    );
  } finally {
    db.close();
  }
});

test('claims require an open run, captured answer text, and an unvoided observation', () => {
  const closed = setup();
  try {
    insertAnswerClaim(closed, { id: 'acs_open' });
    closed
      .prepare('UPDATE runs SET status = ?, finalized_at = ? WHERE id = ?')
      .run('FINALIZED', '2026-10-28T12:00:00.000Z', 'run_1');
    assert.throws(() => insertAnswerClaim(closed, { id: 'acs_closed', ordinal: 2 }), /open run/);
  } finally {
    closed.close();
  }

  const db = setup();
  try {
    insertObservation(db, { id: 'obs_err', status: 'ERROR', queryId: 'qry_1' });
    assert.throws(() => insertAnswerClaim(db, { observationId: 'obs_err' }), /no captured text/);
    insertObservation(db, { id: 'obs_void', queryId: 'qry_1' });
    db.prepare('UPDATE observations SET voided_at = ?, void_reason = ? WHERE id = ?').run(
      '2026-10-28T12:00:00.000Z',
      'Captured twice.',
      'obs_void',
    );
    assert.throws(() => insertAnswerClaim(db, { observationId: 'obs_void' }), /voided observation/);
  } finally {
    db.close();
  }
});

test('claims must belong to the project that owns the observation', () => {
  const db = setup();
  try {
    assert.throws(
      () => insertAnswerClaim(db, { projectId: 'prj_2' }),
      /project that owns the observation/,
    );
  } finally {
    db.close();
  }
});

test('two claims cannot share an ordinal inside one observation', () => {
  const db = setup();
  try {
    insertAnswerClaim(db, { id: 'acs_1', ordinal: 1 });
    assert.throws(() => insertAnswerClaim(db, { id: 'acs_2', ordinal: 1 }), /UNIQUE/);
    insertAnswerClaim(db, { id: 'acs_2', revisionId: 'acr_2', ordinal: 2 });
  } finally {
    db.close();
  }
});

test('a current revision from another claim is refused', () => {
  const db = setup();
  try {
    insertAnswerClaim(db, { id: 'acs_1', revisionId: 'acr_1' });
    insertAnswerClaim(db, { id: 'acs_2', revisionId: 'acr_2', ordinal: 2 });
    assert.throws(
      () =>
        db
          .prepare('UPDATE answer_claims SET current_revision_id = ? WHERE id = ?')
          .run('acr_1', 'acs_2'),
      /current revision must belong/,
    );
  } finally {
    db.close();
  }
});

test('claim-to-proposition links refuse another project’s proposition', () => {
  const db = setup();
  try {
    insertAnswerClaim(db);
    assert.throws(
      () => insertClaimPropositionLink(db, { propositionId: 'prp_2' }),
      /target proposition must belong to the same project/,
    );
    insertClaimPropositionLink(db, { propositionId: 'prp_1' });
  } finally {
    db.close();
  }
});

test('a link to another project’s revision is refused by the composite foreign key', () => {
  const db = setup();
  try {
    insertAnswerClaim(db);
    // A prj_2 link may only reference a prj_2 revision, and acr_1 belongs to prj_1.
    assert.throws(
      () => insertClaimPropositionLink(db, { projectId: 'prj_2', propositionId: 'prp_2' }),
      /FOREIGN KEY constraint failed/,
    );
  } finally {
    db.close();
  }
});

test('one active proposition link per statement pair, supersession retains history', () => {
  const db = setup();
  try {
    insertAnswerClaim(db);
    insertClaimPropositionLink(db, { id: 'acp_1', relation: 'SUPPORTS_TARGET' });
    assert.throws(
      () => insertClaimPropositionLink(db, { id: 'acp_2', relation: 'CONTRADICTS_TARGET' }),
      /UNIQUE/,
    );
    // The established supersession order, inside one transaction so the deferred forward
    // reference is not checked before its target row exists.
    db.exec('BEGIN IMMEDIATE');
    db.prepare(
      'UPDATE answer_claim_propositions SET superseded_by = ?, superseded_at = ? WHERE id = ?',
    ).run('acp_2', '2026-10-28T12:00:00.000Z', 'acp_1');
    insertClaimPropositionLink(db, { id: 'acp_2', relation: 'CONTRADICTS_TARGET' });
    db.exec('COMMIT');
    const active = db
      .prepare('SELECT id FROM answer_claim_propositions WHERE superseded_by IS NULL')
      .all() as Record<string, unknown>[];
    assert.deepEqual(
      active.map((row) => row['id']),
      ['acp_2'],
    );
    assert.equal(count(db, 'answer_claim_propositions'), 2);
  } finally {
    db.close();
  }
});

test('a supersession may only point at a link covering the same pair', () => {
  const db = setup();
  try {
    insertAnswerClaim(db, { id: 'acs_1', revisionId: 'acr_1' });
    insertAnswerClaim(db, { id: 'acs_2', revisionId: 'acr_2', ordinal: 2 });
    insertClaimPropositionLink(db, { id: 'acp_1', claimRevisionId: 'acr_1' });
    insertClaimPropositionLink(db, {
      id: 'acp_2',
      claimRevisionId: 'acr_2',
      propositionId: 'prp_1',
    });
    assert.throws(
      () =>
        db
          .prepare('UPDATE answer_claim_propositions SET superseded_by = ? WHERE id = ?')
          .run('acp_2', 'acp_1'),
      /same statement and proposition/,
    );
  } finally {
    db.close();
  }
});

test('a citation can only support a statement from the same observation', () => {
  const db = setup();
  try {
    insertAnswerClaim(db);
    insertObservation(db, { id: 'obs_2', queryId: 'qry_1' });
    insertCitation(db, { id: 'cit_9', observationId: 'obs_2', position: 1 });
    assert.throws(() => insertClaimCitationLink(db, { citationId: 'cit_9' }), /same observation/);
    insertClaimCitationLink(db, { citationId: 'cit_1' });
  } finally {
    db.close();
  }
});

test('several statements may map to one citation, which stays a single record', () => {
  const db = setup();
  try {
    insertAnswerClaim(db, { id: 'acs_1', revisionId: 'acr_1', quoteText: 'created by Ram' });
    insertAnswerClaim(db, {
      id: 'acs_2',
      revisionId: 'acr_2',
      ordinal: 2,
      quoteText: 'Project A was created',
    });
    insertClaimCitationLink(db, { id: 'acc_1', claimRevisionId: 'acr_1' });
    insertClaimCitationLink(db, { id: 'acc_2', claimRevisionId: 'acr_2' });
    // The citation is referenced, never copied: one captured row, two mappings.
    assert.equal(count(db, 'citations'), 1);
    const shared = db
      .prepare('SELECT COUNT(*) AS n FROM answer_claim_citations WHERE citation_id = ?')
      .get('cit_1') as Record<string, unknown>;
    assert.equal(Number(shared['n']), 2);
  } finally {
    db.close();
  }
});

test('citation links only take support labels from the citation axis', () => {
  const db = setup();
  try {
    insertAnswerClaim(db);
    assert.throws(
      () => insertClaimCitationLink(db, { support: 'ACCURATE' }),
      /CHECK constraint failed/,
    );
    insertClaimCitationLink(db, { support: 'SUPPORTS_WITH_CONDITIONS' });
  } finally {
    db.close();
  }
});

test('claim assessments only accept the label set for their dimension', () => {
  const db = setup();
  try {
    insertAnswerClaim(db);
    insertClaimAssessment(db, { dimension: 'FIDELITY', label: 'CONTRADICTED' });
    assert.throws(
      () => insertClaimAssessment(db, { id: 'aca_2', dimension: 'FIDELITY', label: 'INCORRECT' }),
      /label does not match its dimension/,
    );
    assert.throws(
      () => insertClaimAssessment(db, { id: 'aca_2', dimension: 'ATTRIBUTION', label: 'ACCURATE' }),
      /label does not match its dimension/,
    );
    insertClaimAssessment(db, {
      id: 'aca_2',
      dimension: 'ATTRIBUTION',
      version: 1,
      label: 'FALSE_SOLE_CREDIT',
      attributionSubject: 'Ram',
    });
  } finally {
    db.close();
  }
});

test('omission, refusal and unavailability are storable fidelity states', () => {
  const db = setup();
  try {
    // Each gap label is recorded against the relevance that makes it honest. This test used to store
    // all three on one ADDRESSES statement, which is the contradiction `metrics-v4` refuses: a
    // statement that addresses the target did not also omit it.
    const states = [
      { label: 'OMITTED', relevance: 'OMISSION' },
      { label: 'REFUSED', relevance: 'REFUSAL' },
      { label: 'UNAVAILABLE', relevance: 'UNAVAILABLE' },
    ];
    for (const [index, state] of states.entries()) {
      const claimId = `acs_gap_${index + 1}`;
      const revisionId = `acr_gap_${index + 1}`;
      insertAnswerClaim(db, {
        id: claimId,
        revisionId,
        ordinal: index + 1,
        relevance: state.relevance,
        offsetBasis: state.relevance === 'OMISSION' ? 'NOT_ESTABLISHED' : 'EXACT_MATCH',
      });
      insertClaimAssessment(db, {
        id: `aca_gap_${index + 1}`,
        claimId,
        claimRevisionId: revisionId,
        version: 1,
        label: state.label,
      });
    }
    assert.equal(count(db, 'answer_claim_assessments'), 3);
  } finally {
    db.close();
  }
});

test('attribution detail is refused on a fidelity assessment', () => {
  const db = setup();
  try {
    insertAnswerClaim(db);
    assert.throws(
      () => insertClaimAssessment(db, { attributionSubject: 'Ram' }),
      /only valid on an attribution assessment/,
    );
  } finally {
    db.close();
  }
});

test('assessments must target the current revision and are append-only', () => {
  const db = setup();
  try {
    insertAnswerClaim(db, { id: 'acs_1', revisionId: 'acr_1' });
    insertAnswerClaim(db, { id: 'acs_2', revisionId: 'acr_2', ordinal: 2 });
    assert.throws(
      () => insertClaimAssessment(db, { claimId: 'acs_2', claimRevisionId: 'acr_1' }),
      /must target the current revision/,
    );
    insertClaimAssessment(db, { claimId: 'acs_1', claimRevisionId: 'acr_1' });
    assert.throws(
      () =>
        db
          .prepare('UPDATE answer_claim_assessments SET label = ? WHERE id = ?')
          .run('UNSUPPORTED', 'aca_1'),
      /append-only/,
    );
  } finally {
    db.close();
  }
});

test('links and assessments require an open run at write time', () => {
  const db = setup();
  try {
    insertAnswerClaim(db);
    insertClaimPropositionLink(db);
    db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('FINALIZED', 'run_1');
    assert.throws(
      () => insertClaimPropositionLink(db, { id: 'acp_2', propositionId: 'prp_1' }),
      /proposition links require an open run/,
    );
    assert.throws(
      () => insertClaimCitationLink(db, { id: 'acc_2' }),
      /citation links require an open run/,
    );
    assert.throws(
      () => insertClaimAssessment(db, { id: 'aca_2' }),
      /only be recorded while the run is open/,
    );
  } finally {
    db.close();
  }
});

test('statement rows are immutable except the current revision and one void', () => {
  const db = setup();
  try {
    insertAnswerClaim(db);
    assert.throws(
      () => db.prepare('UPDATE answer_claims SET ordinal = ? WHERE id = ?').run(5, 'acs_1'),
      /immutable except the current revision/,
    );
    assert.throws(
      () =>
        db
          .prepare('UPDATE answer_claims SET voided_at = ?, void_reason = NULL WHERE id = ?')
          .run('2026-10-28T12:00:00.000Z', 'acs_1'),
      /requires a reason/,
    );
    db.prepare('UPDATE answer_claims SET voided_at = ?, void_reason = ? WHERE id = ?').run(
      '2026-10-28T12:00:00.000Z',
      'Recorded twice.',
      'acs_1',
    );
    assert.throws(
      () =>
        insertAnswerClaimRevision(db, {
          claimId: 'acs_1',
          revisionId: 'acr_2',
          revision: 2,
          supersedesRevisionId: 'acr_1',
        }),
      /voided answer claim cannot take a new revision/,
    );
  } finally {
    db.close();
  }
});

test('voiding an observation is refused while it holds live statements', () => {
  const db = setup();
  try {
    insertAnswerClaim(db);
    assert.throws(
      () =>
        db
          .prepare('UPDATE observations SET voided_at = ?, void_reason = ? WHERE id = ?')
          .run('2026-10-28T12:00:00.000Z', 'Wrong capture.', 'obs_1'),
      /void the answer claims/,
    );
    db.prepare('UPDATE answer_claims SET voided_at = ?, void_reason = ? WHERE id = ?').run(
      '2026-10-28T12:00:00.000Z',
      'Superseded.',
      'acs_1',
    );
    db.prepare('UPDATE observations SET voided_at = ?, void_reason = ? WHERE id = ?').run(
      '2026-10-28T12:00:00.000Z',
      'Wrong capture.',
      'obs_1',
    );
  } finally {
    db.close();
  }
});

test('project deletion removes statements, links and assessments together', () => {
  const db = setup();
  try {
    insertAnswerClaim(db);
    insertClaimPropositionLink(db);
    insertClaimCitationLink(db);
    insertClaimAssessment(db);
    db.prepare('DELETE FROM projects WHERE id = ?').run('prj_1');
    for (const table of [
      'answer_claims',
      'answer_claim_revisions',
      'answer_claim_propositions',
      'answer_claim_citations',
      'answer_claim_assessments',
    ]) {
      const total = count(db, table);
      assert.equal(total, 0, table);
    }
  } finally {
    db.close();
  }
});

test('an empty or oversized quote is refused by the schema limit', () => {
  const db = setup();
  try {
    assert.throws(
      () =>
        insertAnswerClaim(db, {
          id: 'acs_1',
          revisionId: 'acr_1',
          offsetBasis: 'NOT_ESTABLISHED',
          quoteText: '',
        }),
      /CHECK constraint failed/,
    );
    assert.throws(
      () =>
        insertAnswerClaim(db, {
          id: 'acs_2',
          revisionId: 'acr_2',
          ordinal: 2,
          offsetBasis: 'NOT_ESTABLISHED',
          quoteText: 'x'.repeat(4001),
        }),
      /CHECK constraint failed/,
    );
  } finally {
    db.close();
  }
});
