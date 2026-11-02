import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import { generateReport } from '../../src/app/reportingService.ts';
import type { ClaimLevelMetrics } from '../../src/core/claimMetrics.ts';
import type { MetricResult } from '../../src/core/metricsCommon.ts';
import { closeDatabase, openDatabase } from '../../src/persistence/db.ts';
import { loadMigrations, runMigrations } from '../../src/persistence/migrate.ts';
import { previewRetestComparison } from '../../src/persistence/repositories/findings.ts';
import {
  approveQuerySet,
  insertAnswerClaim,
  insertClaimCitationLink,
  insertClaimPropositionLink,
  insertClaimWithProposition,
  insertCitation,
  insertObservation,
  insertObservationAssessment,
  insertProject,
  insertQuery,
  insertQuerySet,
  insertRun,
  TEST_ACTOR,
  TEST_TIME,
} from '../helpers/db.ts';

/** The real migration directory, so this fixture can stop halfway through it. */
const MIGRATIONS = join(import.meta.dirname, '../../src/persistence/migrations');

/**
 * One finalized run must produce one answer.
 *
 * The report path and the retest path assemble claim-level inputs separately, in two different
 * modules, and did so in `metrics-v3` with two independent filters over voided statements. That is how
 * a run comes to read one way in a report and another way in a retest comparison of the same data.
 *
 * This test walks both paths over a run built to contain every exclusion `metrics-v4` distinguishes —
 * a scored statement, a label that contradicts its relevance, a voided statement, a mapping to a
 * citation that was voided afterwards, and an unrelated statement carrying an omission link — and
 * requires the two to agree on each figure, to the unit.
 */

const CLAIM_METRIC_IDS: Readonly<Record<string, keyof ClaimLevelMetrics>> = {
  answer_decomposition_coverage: 'decompositionCoverage',
  answer_statement_fidelity_rate: 'claimFidelityRate',
  answer_statement_contradiction_rate: 'claimContradictionRate',
  answer_statement_unsupported_rate: 'claimUnsupportedRate',
  answer_statement_citation_support_rate: 'claimCitationSupportRate',
  answer_statement_attribution_rate: 'claimAttributionRate',
  relevant_omission_rate: 'relevantOmissionRate',
};

function finalize(db: DatabaseSync, runId: string): void {
  db.prepare('UPDATE runs SET status = ?, finalized_at = ? WHERE id = ?').run(
    'FINALIZED',
    TEST_TIME,
    runId,
  );
}

/**
 * One observation carrying all five exclusion shapes.
 *
 * `tail` distinguishes the two runs so the figures are not produced by one row set counted twice.
 */
function seedStatements(db: DatabaseSync, observationId: string, tail: string): void {
  // 1. A scored assertion.
  const scored = insertAnswerClaim(db, {
    id: `acs_scored_${tail}`,
    revisionId: `acr_scored_${tail}`,
    observationId,
    ordinal: 1,
    relevance: 'ADDRESSES',
  });
  db.prepare(
    `INSERT INTO answer_claim_assessments
      (id, project_id, claim_id, claim_revision_id, dimension, version, label, rationale,
       reviewer, attribution_subject, attribution_role, details_json, created_at)
     VALUES (?, 'prj_1', ?, ?, 'FIDELITY', 1, 'ACCURATE', ?, ?, NULL, NULL, '{}', ?)`,
  ).run(
    `aca_scored_${tail}`,
    scored.claimId,
    scored.revisionId,
    'Matches the recorded release artifact.',
    TEST_ACTOR,
    TEST_TIME,
  );
  insertClaimPropositionLink(db, {
    id: `acp_scored_${tail}`,
    claimRevisionId: scored.revisionId,
    propositionId: 'prp_1',
    relation: 'SUPPORTS_TARGET',
  });
  const citation = insertCitation(db, { observationId, id: 'cit_live_' + tail, position: 1 });
  insertClaimCitationLink(db, {
    id: `acc_${tail}`,
    claimRevisionId: scored.revisionId,
    citationId: citation,
    support: 'SUPPORTS',
  });

  // 2. A refusal carrying an ACCURATE label: excluded as a conflict, never scored.
  const conflict = insertAnswerClaim(db, {
    id: `acs_conflict_${tail}`,
    revisionId: `acr_conflict_${tail}`,
    observationId,
    ordinal: 2,
    relevance: 'REFUSAL',
  });
  db.prepare(
    `INSERT INTO answer_claim_assessments
      (id, project_id, claim_id, claim_revision_id, dimension, version, label, rationale,
       reviewer, attribution_subject, attribution_role, details_json, created_at)
     VALUES (?, 'prj_1', ?, ?, 'FIDELITY', 1, 'ACCURATE', ?, ?, NULL, NULL, '{}', ?)`,
  ).run(
    `aca_conflict_${tail}`,
    conflict.claimId,
    conflict.revisionId,
    'Stored before the eligibility contract existed.',
    TEST_ACTOR,
    TEST_TIME,
  );
  // The refusal also carries a citation, which is the shape that let a withdrawn answer look
  // supported: nothing was asserted, so no cited material can support it.
  insertCitation(db, { observationId, id: `cit_refusal_${tail}`, position: 3 });
  insertClaimCitationLink(db, {
    id: `acc_refusal_${tail}`,
    claimRevisionId: conflict.revisionId,
    citationId: `cit_refusal_${tail}`,
    support: 'SUPPORTS',
  });

  // 3. A voided statement, with its reason kept.
  insertAnswerClaim(db, {
    id: `acs_void_${tail}`,
    revisionId: `acr_void_${tail}`,
    observationId,
    ordinal: 3,
    relevance: 'ADDRESSES',
  });
  db.prepare('UPDATE answer_claims SET voided_at = ?, void_reason = ? WHERE id = ?').run(
    TEST_TIME,
    'Recorded twice by mistake.',
    `acs_void_${tail}`,
  );

  // 4. A mapping whose citation was withdrawn afterwards. The mapping stays; it supports nothing.
  const withdrawnCitation = insertCitation(db, {
    observationId,
    id: 'cit_gone_' + tail,
    position: 2,
  });
  const withdrawn = insertAnswerClaim(db, {
    id: `acs_withdrawn_${tail}`,
    revisionId: `acr_withdrawn_${tail}`,
    observationId,
    ordinal: 4,
    relevance: 'ADDRESSES',
  });
  insertClaimCitationLink(db, {
    id: `acc_gone_${tail}`,
    claimRevisionId: withdrawn.revisionId,
    citationId: withdrawnCitation,
    support: 'SUPPORTS',
  });
  db.prepare('UPDATE citations SET voided_at = ?, void_reason = ? WHERE id = ?').run(
    TEST_TIME,
    'The cited page was retracted.',
    withdrawnCitation,
  );

  // 5. An unrelated statement carrying an omission link, which must not create an omission.
  const unrelated = insertAnswerClaim(db, {
    id: `acs_unrelated_${tail}`,
    revisionId: `acr_unrelated_${tail}`,
    observationId,
    ordinal: 5,
    relevance: 'UNRELATED',
    statementKind: 'REVIEWER_DESCRIPTION',
    offsetBasis: 'NOT_ESTABLISHED',
    quoteText: `Unrelated aside ${tail}.`,
    startOffset: null,
    endOffset: null,
  });
  db.prepare(
    `INSERT INTO answer_claim_propositions
      (id, project_id, claim_revision_id, proposition_id, relation, rationale, reviewer,
       created_at, superseded_by, superseded_at)
     VALUES (?, 'prj_1', ?, 'prp_1', 'NOT_ASSESSABLE_TARGET', ?, ?, ?, NULL, NULL)`,
  ).run(
    `acp_unrelated_${tail}`,
    unrelated.revisionId,
    'Filed directly; the pairing rules were added later.',
    TEST_ACTOR,
    TEST_TIME,
  );
}

/**
 * Build a v0.3 database, populate it the way a v0.3 reviewer would have, then upgrade it.
 *
 * The inconsistent row this fixture needs can no longer be written: migration `010` refuses it. That
 * is the point — a database created before the contract exists holds rows the contract would never
 * accept, and upgrading must leave those rows readable rather than deleting or rewriting them. The
 * metric excludes them and names the conflict.
 */
function seededUpgradedDatabase(): DatabaseSync {
  const db = openDatabase(':memory:');
  const all = loadMigrations(MIGRATIONS);
  assert.equal(
    all.length,
    10,
    'this fixture upgrades a v0.3 database, so nine migrations must come first',
  );
  runMigrations(db, all.slice(0, 9));
  populate(db);
  // The upgrade runs against a populated database, which is where a trigger that only fires on new
  // writes could have been expected to rewrite history. It does not.
  runMigrations(db, all);
  return db;
}

function populate(db: DatabaseSync): void {
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
  insertObservation(db, { runId: 'run_base', id: 'obs_base', queryId: 'qry_1' });
  insertObservationAssessment(db, {
    id: 'oasm_base',
    observationId: 'obs_base',
    dimension: 'PRESENCE',
    label: 'MENTIONED',
  });
  seedStatements(db, 'obs_base', 'base');
  finalize(db, 'run_base');

  insertRun(db, { projectId: 'prj_1', id: 'run_later', name: 'Later capture' });
  insertObservation(db, { runId: 'run_later', id: 'obs_later', queryId: 'qry_1' });
  insertObservationAssessment(db, {
    id: 'oasm_later',
    observationId: 'obs_later',
    dimension: 'PRESENCE',
    label: 'MENTIONED',
  });
  seedStatements(db, 'obs_later', 'later');
  finalize(db, 'run_later');
}

test('the report and the retest comparison agree on every claim-level figure', () => {
  const db = seededUpgradedDatabase();
  try {
    const { snapshot } = generateReport(db, 'prj_1', 'Parity check', {
      actor: TEST_ACTOR,
      at: TEST_TIME,
    });
    const reportRun = snapshot.runs.find((run) => run.id === 'run_base');
    assert.notEqual(reportRun, undefined, 'the base run must appear in the report');
    const block = reportRun?.metrics.claimLevel;
    assert.notEqual(block, undefined, 'the base run has statements, so the block must exist');
    if (block === undefined) {
      return;
    }

    const preview = previewRetestComparison(
      db,
      'prj_1',
      'run_base',
      'run_later',
      'answer_statement_fidelity_rate',
    );
    assert.equal(preview.comparable, true, 'the two runs share their recorded configuration');

    const compared = new Set<string>();
    for (const row of preview.deltas) {
      const field = CLAIM_METRIC_IDS[row.metricId];
      if (field === undefined) {
        continue;
      }
      compared.add(row.metricId);
      const reported = block[field] as MetricResult;
      assert.equal(row.priorDenominator, reported.denominator, `${row.metricId} denominator`);
      assert.equal(row.priorNumerator, reported.numerator, `${row.metricId} numerator`);
      assert.equal(row.prior, reported.value, `${row.metricId} value`);
    }
    assert.deepEqual(
      [...compared].sort(),
      Object.keys(CLAIM_METRIC_IDS).sort(),
      'every claim-level metric the report publishes is also carried by the comparison',
    );
  } finally {
    closeDatabase(db);
  }
});

test('a voided statement and a withdrawn citation are excluded identically by both paths', () => {
  const db = seededUpgradedDatabase();
  try {
    const { snapshot } = generateReport(db, 'prj_1', 'Parity check', {
      actor: TEST_ACTOR,
      at: TEST_TIME,
    });
    const block = snapshot.runs.find((run) => run.id === 'run_base')?.metrics.claimLevel;
    assert.notEqual(block, undefined);
    if (block === undefined) {
      return;
    }

    // Four live statements: scored, conflict-refusal, withdrawn-citation, unrelated. The voided one
    // is the fifth row and appears in no denominator.
    assert.equal(block.statementsRecorded, 4);
    assert.equal(block.voidedClaims, 1);
    assert.equal(block.labelConflictClaims, 1);
    assert.equal(block.claimFidelityRate.denominator, 1);
    assert.equal(block.claimCitationSupportRate.denominator, 1);

    const reasonsFor = (metric: MetricResult): Map<string, number> =>
      new Map(metric.exclusions.map((row) => [row.reason, row.count]));

    const fidelity = reasonsFor(block.claimFidelityRate);
    assert.equal(fidelity.get('CLAIM_VOIDED'), 1);
    assert.equal(fidelity.get('CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE'), 1);

    const citations = reasonsFor(block.claimCitationSupportRate);
    assert.equal(citations.get('CLAIM_CITATION_VOIDED'), 1);
    assert.equal(citations.get('CLAIM_CITATION_NON_ASSERTING'), 1);
    assert.equal(
      citations.get('CLAIM_NO_MAPPED_CITATION'),
      undefined,
      'a refusal with no citation is a complete record, not a missing check',
    );

    // The same exclusions have to be what the comparison saw, or the two paths still filter alone.
    const preview = previewRetestComparison(
      db,
      'prj_1',
      'run_base',
      'run_later',
      'answer_statement_fidelity_rate',
    );
    const fidelityRow = preview.deltas.find(
      (row) => row.metricId === 'answer_statement_fidelity_rate',
    );
    assert.notEqual(fidelityRow, undefined);
    assert.equal(fidelityRow?.priorDenominator, 1);
    assert.equal(fidelityRow?.priorNumerator, 1);

    const omissionRow = preview.deltas.find((row) => row.metricId === 'relevant_omission_rate');
    assert.equal(omissionRow?.priorDenominator, 1, 'only the scored assertion relates to prp_1');
    assert.equal(omissionRow?.priorNumerator, 0);
  } finally {
    closeDatabase(db);
  }
});
