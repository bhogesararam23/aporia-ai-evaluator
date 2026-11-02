import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../../src/errors.ts';
import { closeDatabase } from '../../src/persistence/db.ts';
import {
  createAnswerClaim,
  linkAnswerClaimCitation,
  linkAnswerClaimProposition,
  recordAnswerClaimAssessment,
  reviseAnswerClaim,
  supersedeAnswerClaimCitation,
  supersedeAnswerClaimProposition,
  voidAnswerClaim,
} from '../../src/persistence/repositories/answerClaims.ts';
import {
  addFindingReference,
  createFinding,
  getFinding,
  previewRetestComparison,
  recordRetestComparison,
  removeFindingReference,
  transitionFinding,
  updateFindingDetails,
  type FindingInput,
} from '../../src/persistence/repositories/findings.ts';
import { voidCitation } from '../../src/persistence/repositories/runs.ts';
import { validateAnswerClaimDraftInput } from '../../src/core/answerClaimInputs.ts';
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
 * Every write that touches more than one row must fail as one unit.
 *
 * The audit event is part of the record, not a log line beside it: a status change with no history row
 * is a claim without evidence, and a row written without an audit event is an edit nobody can account
 * for. Forcing the audit insert to fail is how each path is shown to be *inside* its transaction,
 * which a passing happy path cannot demonstrate.
 *
 * The list covers the writes `metrics-v4` and ADR-024 changed or added, and the citation void, whose
 * failure must leave an existing statement-to-citation mapping intact rather than half updated.
 */

const context = { actor: TEST_ACTOR, at: TEST_TIME };
const ANSWER = 'Project A was created by Ram and launched in 2021. It is maintained by Sam.';

function forceAuditFailure(db: DatabaseSync, action: string): void {
  db.exec(`
    CREATE TRIGGER fail_audit_${action.replaceAll(/[^a-z]/gi, '_')}
    BEFORE INSERT ON audit_events
    WHEN NEW.action = '${action}'
    BEGIN
      SELECT RAISE(ABORT, 'forced audit failure');
    END;
  `);
}

function rowsIn(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as Record<string, unknown>;
  return Number(row['n']);
}

function draft(relevance = 'ADDRESSES') {
  const result = validateAnswerClaimDraftInput(
    { quoteText: 'created by Ram', offsetBasis: 'EXACT_MATCH', relevance },
    ANSWER,
  );
  if (!result.ok) {
    throw new Error(`fixture draft invalid: ${JSON.stringify(result.issues)}`);
  }
  return result.value;
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
  insertRun(db, { projectId: 'prj_1', id: 'run_base' });
  insertObservation(db, { runId: 'run_base', id: 'obs_1', queryId: 'qry_1', answerText: ANSWER });
  insertCitation(db, { observationId: 'obs_1', id: 'cit_1' });
  insertRun(db, { projectId: 'prj_1', id: 'run_later' });
  insertObservation(db, {
    runId: 'run_later',
    id: 'obs_2',
    queryId: 'qry_1',
    answerText: ANSWER,
  });
  return db;
}

/**
 * Finalizing is a one-way step the repository enforces, so the cases that compare runs do it
 * themselves. Leaving the seeded runs open is what lets the statement-write cases write at all.
 */
function finalizeRuns(db: DatabaseSync): void {
  for (const run of ['run_base', 'run_later']) {
    db.prepare('UPDATE runs SET status = ?, finalized_at = ? WHERE id = ?').run(
      'FINALIZED',
      TEST_TIME,
      run,
    );
  }
}

function findingInput(overrides: Partial<FindingInput> = {}): FindingInput {
  return {
    title: 'The answer omits the funding body',
    observedIssue: 'Both captured answers describe the project and never the funder.',
    supportingEvidence: 'Two captured answers recorded under the same configuration omit it.',
    cause: 'MODEL_MISREAD_OR_OMISSION',
    severity: 'MEDIUM',
    severityRationale: 'A reader asking about funding gets no signal from either answer.',
    recommendedAction: 'State the funding relationship plainly on the project page.',
    ownerLabel: 'ram-local',
    firstObservedAt: TEST_TIME,
    lastObservedAt: TEST_TIME,
    references: [],
    ...overrides,
  };
}

/** Scratch space a case can fill during setup and read back during the write. */
interface Fixture {
  claimId: string;
  linkId: string;
  findingId: string;
}

function emptyFixture(): Fixture {
  return { claimId: '', linkId: '', findingId: '' };
}

interface WritePath {
  readonly label: string;
  readonly action: string;
  readonly tables: readonly string[];
  readonly setup: (db: DatabaseSync, fixture: Fixture) => void;
  readonly write: (db: DatabaseSync, fixture: Fixture) => unknown;
}

const writePaths: readonly WritePath[] = [
  {
    label: 'creating a statement',
    action: 'answer-claim.created',
    tables: ['answer_claims', 'answer_claim_revisions'],
    setup: () => {},
    write: (db) => createAnswerClaim(db, 'prj_1', 'obs_1', draft(), context),
  },
  {
    label: 'revising a statement',
    action: 'answer-claim.revised',
    tables: ['answer_claim_revisions'],
    setup: (db, fixture) => {
      fixture.claimId = createAnswerClaim(db, 'prj_1', 'obs_1', draft(), context).id;
    },
    write: (db, fixture) =>
      reviseAnswerClaim(db, 'prj_1', fixture.claimId, draft('PARTIALLY_ADDRESSES'), context),
  },
  {
    label: 'voiding a statement',
    action: 'answer-claim.voided',
    tables: ['answer_claims'],
    setup: (db, fixture) => {
      fixture.claimId = createAnswerClaim(db, 'prj_1', 'obs_1', draft(), context).id;
    },
    write: (db, fixture) =>
      voidAnswerClaim(db, 'prj_1', fixture.claimId, 'Recorded twice by mistake.', context),
  },
  {
    label: 'linking a statement to a proposition',
    action: 'answer-claim.proposition-linked',
    tables: ['answer_claim_propositions'],
    setup: (db, fixture) => {
      fixture.claimId = createAnswerClaim(db, 'prj_1', 'obs_1', draft(), context).id;
    },
    write: (db, fixture) =>
      linkAnswerClaimProposition(
        db,
        'prj_1',
        fixture.claimId,
        {
          propositionId: 'prp_1',
          relation: 'SUPPORTS_TARGET',
          rationale: 'The answer states what the proposition asserts.',
          reviewer: TEST_ACTOR,
        },
        context,
      ),
  },
  {
    label: 'superseding a proposition link',
    action: 'answer-claim.proposition-superseded',
    tables: ['answer_claim_propositions'],
    setup: (db, fixture) => {
      const claim = createAnswerClaim(db, 'prj_1', 'obs_1', draft(), context);
      const linked = linkAnswerClaimProposition(
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
      fixture.linkId = linked.propositionLinks[0]?.id ?? '';
    },
    write: (db, fixture) =>
      supersedeAnswerClaimProposition(
        db,
        'prj_1',
        fixture.linkId,
        {
          propositionId: 'prp_1',
          relation: 'QUALIFIES_TARGET',
          rationale: 'The answer states it only for one release.',
          reviewer: TEST_ACTOR,
        },
        context,
      ),
  },
  {
    label: 'mapping a statement to a citation',
    action: 'answer-claim.citation-linked',
    tables: ['answer_claim_citations'],
    setup: (db, fixture) => {
      fixture.claimId = createAnswerClaim(db, 'prj_1', 'obs_1', draft(), context).id;
    },
    write: (db, fixture) =>
      linkAnswerClaimCitation(
        db,
        'prj_1',
        fixture.claimId,
        {
          citationId: 'cit_1',
          support: 'SUPPORTS',
          rationale: 'The cited page states the same fact.',
          reviewer: TEST_ACTOR,
        },
        context,
      ),
  },
  {
    label: 'superseding a citation mapping',
    action: 'answer-claim.citation-superseded',
    tables: ['answer_claim_citations'],
    setup: (db, fixture) => {
      const claim = createAnswerClaim(db, 'prj_1', 'obs_1', draft(), context);
      const mapped = linkAnswerClaimCitation(
        db,
        'prj_1',
        claim.id,
        {
          citationId: 'cit_1',
          support: 'SUPPORTS',
          rationale: 'The cited page states the same fact.',
          reviewer: TEST_ACTOR,
        },
        context,
      );
      fixture.linkId = mapped.citationLinks[0]?.id ?? '';
    },
    write: (db, fixture) =>
      supersedeAnswerClaimCitation(
        db,
        'prj_1',
        fixture.linkId,
        {
          citationId: 'cit_1',
          support: 'PARTIALLY_SUPPORTS',
          rationale: 'The cited page covers only the launch year.',
          reviewer: TEST_ACTOR,
        },
        context,
      ),
  },
  {
    label: 'recording a claim assessment',
    action: 'answer-claim.assessed',
    tables: ['answer_claim_assessments'],
    setup: (db, fixture) => {
      fixture.claimId = createAnswerClaim(db, 'prj_1', 'obs_1', draft(), context).id;
    },
    write: (db, fixture) =>
      recordAnswerClaimAssessment(
        db,
        'prj_1',
        fixture.claimId,
        {
          dimension: 'FIDELITY',
          label: 'ACCURATE',
          rationale: 'Matches the recorded release artifact.',
          reviewer: TEST_ACTOR,
          attributionSubject: undefined,
          attributionRole: undefined,
        },
        context,
      ),
  },
  {
    label: 'creating a finding',
    action: 'finding.created',
    tables: ['remediation_findings', 'finding_updates'],
    setup: () => {},
    write: (db) => createFinding(db, 'prj_1', findingInput(), context),
  },
  {
    label: 'transitioning a finding',
    action: 'finding.transitioned',
    tables: ['finding_updates'],
    setup: (db, fixture) => {
      fixture.findingId = createFinding(db, 'prj_1', findingInput(), context).id;
    },
    write: (db, fixture) =>
      transitionFinding(
        db,
        'prj_1',
        fixture.findingId,
        { status: 'ACCEPTED', note: 'Confirmed against the record.' },
        context,
      ),
  },
  {
    label: 'amending severity or cause',
    action: 'finding.updated',
    tables: ['finding_updates'],
    setup: (db, fixture) => {
      fixture.findingId = createFinding(db, 'prj_1', findingInput(), context).id;
    },
    write: (db, fixture) =>
      updateFindingDetails(
        db,
        'prj_1',
        fixture.findingId,
        { severity: 'HIGH', cause: 'MODEL_MISREAD_OR_OMISSION', note: 'Raised after review.' },
        context,
      ),
  },
  {
    label: 'adding a finding reference',
    action: 'finding.referenced',
    tables: ['finding_references'],
    setup: (db, fixture) => {
      fixture.findingId = createFinding(db, 'prj_1', findingInput(), context).id;
    },
    write: (db, fixture) =>
      addFindingReference(db, 'prj_1', fixture.findingId, { type: 'claim', id: 'clm_1' }, context),
  },
  {
    label: 'removing a finding reference',
    action: 'finding.reference-removed',
    tables: ['finding_references'],
    setup: (db, fixture) => {
      const id = createFinding(db, 'prj_1', findingInput(), context).id;
      addFindingReference(db, 'prj_1', id, { type: 'claim', id: 'clm_1' }, context);
      fixture.findingId = id;
      fixture.linkId = getFinding(db, 'prj_1', id)?.references[0]?.id ?? '';
    },
    write: (db, fixture) =>
      removeFindingReference(db, 'prj_1', fixture.findingId, fixture.linkId, context),
  },
  {
    label: 'recording a retest comparison',
    action: 'finding.comparison-recorded',
    tables: ['retest_comparisons'],
    setup: (db, fixture) => {
      fixture.findingId = moveToRetestRequired(db);
    },
    write: (db, fixture) =>
      recordRetestComparison(
        db,
        'prj_1',
        fixture.findingId,
        { baseRunId: 'run_base', laterRunId: 'run_later', focusMetric: 'mention_rate' },
        context,
      ),
  },
  {
    label: 'voiding a citation a statement maps to',
    action: 'citation.voided',
    tables: ['citations', 'answer_claim_citations'],
    setup: (db, fixture) => {
      const claim = createAnswerClaim(db, 'prj_1', 'obs_1', draft(), context);
      linkAnswerClaimCitation(
        db,
        'prj_1',
        claim.id,
        {
          citationId: 'cit_1',
          support: 'SUPPORTS',
          rationale: 'The cited page states the same fact.',
          reviewer: TEST_ACTOR,
        },
        context,
      );
      fixture.claimId = claim.id;
    },
    write: (db) =>
      voidCitation(
        db,
        'prj_1',
        'run_base',
        'obs_1',
        'cit_1',
        { reason: 'The cited page was retracted.', reviewer: TEST_ACTOR },
        context,
      ),
  },
];

function moveToRetestRequired(db: DatabaseSync): string {
  finalizeRuns(db);
  const id = createFinding(db, 'prj_1', findingInput(), context).id;
  transitionFinding(db, 'prj_1', id, { status: 'ACCEPTED', note: 'Accepted.' }, context);
  transitionFinding(db, 'prj_1', id, { status: 'RETEST_REQUIRED', note: 'Retest.' }, context);
  return id;
}

test('every multi-row write rolls back completely when its audit event fails', () => {
  for (const path of writePaths) {
    const db = seeded();
    try {
      const fixture = emptyFixture();
      path.setup(db, fixture);
      const before = path.tables.map((table) => rowsIn(db, table));
      const auditBefore = rowsIn(db, 'audit_events');
      forceAuditFailure(db, path.action);

      assert.throws(
        () => path.write(db, fixture),
        (error: unknown) =>
          (error instanceof Error && /forced audit failure/.test(error.message)) ||
          (error instanceof AppError && error.code === 'CONFLICT'),
        path.label,
      );

      const after = path.tables.map((table) => rowsIn(db, table));
      assert.deepEqual(after, before, `${path.label} left a partial write behind`);
      assert.equal(
        rowsIn(db, 'audit_events'),
        auditBefore,
        `${path.label} wrote an audit event despite the failure`,
      );
    } finally {
      closeDatabase(db);
    }
  }
});

test('the forced failure really is the audit insert, not a write that never began', () => {
  // Without this, a case could "pass" because the repository refused for an unrelated reason before
  // reaching its own audit call. Every path must have written its primary row in the setup phase or
  // be a create that the trigger is the only thing standing between it and the table.
  const db = seeded();
  try {
    const fixture = emptyFixture();
    const claim = createAnswerClaim(db, 'prj_1', 'obs_1', draft(), context);
    fixture.claimId = claim.id;
    assert.ok(claim.currentRevisionId);
    assert.equal(rowsIn(db, 'answer_claim_revisions'), 1);
    // The same write, one statement, succeeds when no trigger blocks the audit row.
    recordAnswerClaimAssessment(
      db,
      'prj_1',
      fixture.claimId,
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
    assert.equal(rowsIn(db, 'answer_claim_assessments'), 1);
    forceAuditFailure(db, 'answer-claim.assessed');
    const before = rowsIn(db, 'answer_claim_assessments');
    assert.throws(
      () =>
        recordAnswerClaimAssessment(
          db,
          'prj_1',
          fixture.claimId,
          {
            dimension: 'ATTRIBUTION',
            label: 'CORRECT',
            rationale: 'Names the right maintainer.',
            reviewer: TEST_ACTOR,
            attributionSubject: 'Sam',
            attributionRole: undefined,
          },
          context,
        ),
      /forced audit failure/,
    );
    assert.equal(rowsIn(db, 'answer_claim_assessments'), before);
  } finally {
    closeDatabase(db);
  }
});

test('a stored comparison is undisturbed by a later write that fails', () => {
  const db = seeded();
  try {
    const id = moveToRetestRequired(db);
    recordRetestComparison(
      db,
      'prj_1',
      id,
      { baseRunId: 'run_base', laterRunId: 'run_later', focusMetric: 'mention_rate' },
      context,
    );
    const stored = getFinding(db, 'prj_1', id);
    assert.equal(stored?.comparisons.length, 1);
    const comparison = stored?.comparisons[0];
    const cited = comparison?.id ?? '';
    assert.equal(comparison?.focusMetric, 'mention_rate');
    // The status has to be the one this pair of runs actually produced, or the new citation rule
    // refuses the transition for a different reason than the one under test.
    const statusForOutcome =
      comparison?.outcome === 'NOT_COMPARABLE' ? 'UNABLE_TO_VERIFY' : comparison?.outcome;
    assert.ok(statusForOutcome);

    forceAuditFailure(db, 'finding.transitioned');
    assert.throws(
      () =>
        transitionFinding(
          db,
          'prj_1',
          id,
          {
            status: statusForOutcome ?? 'UNCHANGED',
            note: 'Would cite the comparison.',
            comparisonId: cited,
          },
          context,
        ),
      /forced audit failure/,
    );
    assert.equal(rowsIn(db, 'retest_comparisons'), 1);
    assert.equal(getFinding(db, 'prj_1', id)?.status, 'RETEST_REQUIRED');
    assert.equal(
      getFinding(db, 'prj_1', id)?.comparisons[0]?.focusMetric,
      'mention_rate',
      'the stored provenance survived the failed transition',
    );
  } finally {
    closeDatabase(db);
  }
});

test('what is stored is what the comparison code computed, not what a caller asserted', () => {
  const db = seeded();
  try {
    const id = moveToRetestRequired(db);
    const preview = previewRetestComparison(db, 'prj_1', 'run_base', 'run_later', 'mention_rate');
    recordRetestComparison(
      db,
      'prj_1',
      id,
      { baseRunId: 'run_base', laterRunId: 'run_later', focusMetric: 'mention_rate' },
      context,
    );
    const stored = getFinding(db, 'prj_1', id)?.comparisons[0];
    assert.equal(stored?.outcome, preview.outcome, 'the stored verdict is the computed one');
    assert.equal(stored?.comparable, preview.comparable);
    assert.deepEqual(
      stored?.deltas.map((row) => [row.metricId, row.prior, row.current]),
      preview.deltas.map((row) => [row.metricId, row.prior, row.current]),
      'the stored numbers are the recomputed numbers',
    );
    assert.equal(stored?.baseRunId, 'run_base');
    assert.equal(stored?.laterRunId, 'run_later');
    assert.equal(stored?.ruleVersion, 'comparison-rule-v2');
  } finally {
    closeDatabase(db);
  }
});
