import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  CLAIM_PROPOSITION_RELATIONS,
  CLAIM_RELEVANCES,
  type ClaimPropositionRelation,
  type ClaimRelevance,
} from '../../src/core/answerClaims.ts';
import {
  permittedAttributionLabels,
  permittedCitationSupportLabels,
  permittedFidelityLabels,
  permittedPropositionRelations,
} from '../../src/core/claimEligibility.ts';
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
  insertRun,
} from '../helpers/db.ts';

/**
 * The trigger bodies in `010_evaluator_integrity.sql` restate the same tables that
 * `src/core/claimEligibility.ts` defines, because SQLite cannot import TypeScript. Restating a rule
 * in two languages is only safe while something compares them, so this file does two things: it reads
 * the migration's own arms and checks them against the source of truth, and it writes rows straight
 * through the schema to prove the database really refuses what the code refuses.
 *
 * A raw insert is how a restored database, a hand-edited file, or a future script reaches these
 * tables. The form and the repository are both bypassed here on purpose.
 */

const MIGRATION_FILE = join(
  import.meta.dirname,
  '../../src/persistence/migrations/010_evaluator_integrity.sql',
);

interface ParsedTrigger {
  /** relevance → the values that relevance permits, read out of the SQL. */
  readonly arms: Map<string, string[]>;
  /** What the `ELSE` branch allows, or `[]` when the trigger refuses everything unmatched. */
  readonly otherwise: string[];
}

function parseTrigger(sql: string, trigger: string, column: string): ParsedTrigger {
  const start = sql.indexOf(`CREATE TRIGGER ${trigger}`);
  assert.notEqual(start, -1, `${trigger} is missing from the migration`);
  const begin = sql.indexOf('BEGIN', start);
  assert.notEqual(begin, -1, `${trigger} has no BEGIN block`);
  const body = sql.slice(start, begin);

  const arms = new Map<string, string[]>();
  const armPattern = new RegExp(
    `WHEN\\s+'([A-Z_]+)'\\s+THEN\\s+NEW\\.${column}\\s+(?:IN\\s*\\(([^)]*)\\)|=\\s*'([A-Z_]+)')`,
    'g',
  );
  for (const match of body.matchAll(armPattern)) {
    const relevance = match[1] as string;
    const listed = match[2];
    const single = match[3];
    const values =
      listed !== undefined
        ? listed
            .split(',')
            .map((part) => part.trim().replace(/^'|'$/g, ''))
            .filter((part) => part.length > 0)
        : [single as string];
    arms.set(relevance, values);
  }

  const otherwise: string[] = [];
  const elseMatch = new RegExp(`ELSE\\s+NEW\\.${column}\\s+IN\\s*\\(([^)]*)\\)`).exec(body);
  if (elseMatch?.[1] !== undefined) {
    for (const part of elseMatch[1].split(',')) {
      const value = part.trim().replace(/^'|'$/g, '');
      if (value.length > 0) {
        otherwise.push(value);
      }
    }
  }
  return { arms, otherwise };
}

function setup(): DatabaseSync {
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
  insertRun(db, { projectId: 'prj_1' });
  insertObservation(db, { runId: 'run_1', queryId: 'qry_1' });
  insertCitation(db, { observationId: 'obs_1' });
  return db;
}

/**
 * A statement whose revision carries the relevance under test.
 *
 * An omission cannot be a located quotation — the answer did not say it — so that one relevance is
 * recorded the way the schema requires, and each statement gets its own ordinal because a run
 * observation holds them all.
 */
function claimWithRelevance(db: DatabaseSync, relevance: string, ordinal = 1): string {
  const suffix = relevance.toLowerCase();
  const { revisionId } = insertAnswerClaim(db, {
    id: `acs_${suffix}`,
    revisionId: `acr_${suffix}`,
    ordinal,
    relevance,
    offsetBasis: relevance === 'OMISSION' ? 'NOT_ESTABLISHED' : 'EXACT_MATCH',
  });
  return revisionId;
}

test('the fidelity trigger restates the TypeScript table exactly', () => {
  const parsed = parseTrigger(
    readFileSync(MIGRATION_FILE, 'utf8'),
    'answer_claim_assessments_fidelity_matches_relevance',
    'label',
  );
  // Every relevance gets its own arm here, so a value added to the vocabulary cannot inherit a
  // default it was never reviewed against.
  assert.deepEqual(
    [...parsed.arms.keys()].sort(),
    [...CLAIM_RELEVANCES].sort(),
    'the fidelity trigger must name every relevance',
  );
  for (const relevance of CLAIM_RELEVANCES) {
    assert.deepEqual(
      [...(parsed.arms.get(relevance) ?? [])].sort(),
      [...permittedFidelityLabels(relevance)].sort(),
      `${relevance} fidelity labels`,
    );
  }
});

test('the attribution trigger restates the TypeScript table exactly', () => {
  const parsed = parseTrigger(
    readFileSync(MIGRATION_FILE, 'utf8'),
    'answer_claim_assessments_attribution_matches_relevance',
    'label',
  );
  for (const [relevance, values] of parsed.arms) {
    assert.deepEqual(
      [...values].sort(),
      [...permittedAttributionLabels(relevance as ClaimRelevance)].sort(),
      `${relevance} attribution labels`,
    );
  }
  // The remaining relevances fall to the ELSE arm, which must equal the non-asserting set.
  for (const relevance of CLAIM_RELEVANCES) {
    if (parsed.arms.has(relevance)) {
      continue;
    }
    assert.deepEqual(
      [...parsed.otherwise].sort(),
      [...permittedAttributionLabels(relevance)].sort(),
      `${relevance} falls to the ELSE arm`,
    );
  }
});

test('the proposition relation trigger restates the TypeScript table exactly', () => {
  const parsed = parseTrigger(
    readFileSync(MIGRATION_FILE, 'utf8'),
    'answer_claim_propositions_relation_matches_relevance',
    'relation',
  );
  assert.deepEqual(
    [...parsed.arms.keys()].sort(),
    [...CLAIM_RELEVANCES].sort(),
    'the relation trigger must name every relevance',
  );
  for (const relevance of CLAIM_RELEVANCES) {
    assert.deepEqual(
      [...(parsed.arms.get(relevance) ?? [])].sort(),
      [...permittedPropositionRelations(relevance)].sort(),
      `${relevance} relations`,
    );
  }
});

test('the citation support trigger restates the TypeScript table exactly', () => {
  const parsed = parseTrigger(
    readFileSync(MIGRATION_FILE, 'utf8'),
    'answer_claim_citations_support_matches_relevance',
    'support',
  );
  for (const [relevance, values] of parsed.arms) {
    assert.deepEqual(
      [...values].sort(),
      [...permittedCitationSupportLabels(relevance as ClaimRelevance)].sort(),
      `${relevance} support labels`,
    );
  }
  for (const relevance of CLAIM_RELEVANCES) {
    if (parsed.arms.has(relevance)) {
      continue;
    }
    assert.deepEqual(
      [...parsed.otherwise].sort(),
      [...permittedCitationSupportLabels(relevance)].sort(),
      `${relevance} falls to the ELSE arm`,
    );
  }
});

test('a refusal cannot be stored as an accurate statement', () => {
  const db = setup();
  try {
    const revisionId = claimWithRelevance(db, 'REFUSAL');
    assert.throws(
      () =>
        insertClaimAssessment(db, {
          claimId: 'acs_refusal',
          claimRevisionId: revisionId,
          label: 'ACCURATE',
        }),
      /contradicts the recorded relevance/,
    );
    assert.throws(
      () =>
        insertClaimAssessment(db, {
          id: 'aca_2',
          claimId: 'acs_refusal',
          claimRevisionId: revisionId,
          label: 'CONTRADICTED',
        }),
      /contradicts the recorded relevance/,
    );
  } finally {
    db.close();
  }
});

test('an abstention cannot be stored as an omission or a refusal', () => {
  const db = setup();
  try {
    const revisionId = claimWithRelevance(db, 'ABSTENTION');
    for (const label of ['OMITTED', 'REFUSED', 'UNAVAILABLE', 'UNSUPPORTED']) {
      assert.throws(
        () =>
          insertClaimAssessment(db, {
            id: `aca_${label.toLowerCase()}`,
            claimId: 'acs_abstention',
            claimRevisionId: revisionId,
            label,
          }),
        /contradicts the recorded relevance/,
        label,
      );
    }
  } finally {
    db.close();
  }
});

test('an addressing statement cannot be stored as an omission', () => {
  const db = setup();
  try {
    const revisionId = claimWithRelevance(db, 'ADDRESSES');
    assert.throws(
      () =>
        insertClaimAssessment(db, {
          claimId: 'acs_addresses',
          claimRevisionId: revisionId,
          label: 'OMITTED',
        }),
      /contradicts the recorded relevance/,
    );
    // An honest unknown stays available on every relevance, including this one.
    insertClaimAssessment(db, {
      claimId: 'acs_addresses',
      claimRevisionId: revisionId,
      label: 'NOT_ASSESSABLE',
      rationale: 'The reviewer could not judge it.',
    });
  } finally {
    db.close();
  }
});

test('an unrelated statement cannot be stored as omitting the target', () => {
  const db = setup();
  try {
    const revisionId = claimWithRelevance(db, 'UNRELATED');
    assert.throws(
      () =>
        insertClaimPropositionLink(db, { claimRevisionId: revisionId, relation: 'OMITS_TARGET' }),
      /contradicts the recorded relevance/,
    );
    insertClaimPropositionLink(db, {
      claimRevisionId: revisionId,
      relation: 'DOES_NOT_ADDRESS_TARGET',
      rationale: 'Recorded for completeness.',
    });
  } finally {
    db.close();
  }
});

test('an omission statement can record the omission it describes', () => {
  const db = setup();
  try {
    const revisionId = claimWithRelevance(db, 'OMISSION');
    insertClaimPropositionLink(db, {
      claimRevisionId: revisionId,
      relation: 'OMITS_TARGET',
      rationale: 'The answer never named the funding body.',
    });
    const row = db
      .prepare('SELECT relation FROM answer_claim_propositions WHERE claim_revision_id = ?')
      .get(revisionId) as Record<string, unknown>;
    assert.equal(row['relation'], 'OMITS_TARGET');
  } finally {
    db.close();
  }
});

test('cited material cannot support a statement that asserts nothing', () => {
  const db = setup();
  try {
    const revisionId = claimWithRelevance(db, 'AMBIGUOUS');
    assert.throws(
      () => insertClaimCitationLink(db, { claimRevisionId: revisionId, support: 'SUPPORTS' }),
      /contradicts the recorded relevance/,
    );
    insertClaimCitationLink(db, {
      claimRevisionId: revisionId,
      support: 'METADATA_MISSING',
      rationale: 'Nothing usable was captured.',
    });
  } finally {
    db.close();
  }
});

test('a voided citation cannot be mapped even by a direct write', () => {
  const db = setup();
  try {
    const revisionId = claimWithRelevance(db, 'ADDRESSES');
    db.prepare('UPDATE citations SET voided_at = ?, void_reason = ? WHERE id = ?').run(
      '2026-11-02T00:00:00.000Z',
      'The cited page was retracted.',
      'cit_1',
    );
    assert.throws(
      () => insertClaimCitationLink(db, { claimRevisionId: revisionId, support: 'SUPPORTS' }),
      /voided citation cannot be mapped/,
    );
  } finally {
    db.close();
  }
});

/**
 * The first permitted value for an axis, with the empty case refused loudly.
 *
 * An empty permitted set would mean the contract makes a pairing unwritable on that axis, which is
 * the `every relation is reachable somewhere` failure mode stated per relevance.
 */
function first<T>(values: readonly T[], context: string): T {
  const value = values[0];
  if (value === undefined) {
    throw new Error(`${context}: the permitted set is empty, so nothing can be stored`);
  }
  return value;
}

test('every consistent pairing the tables allow still stores', () => {
  const db = setup();
  try {
    // One row per relevance on each axis, chosen from the permitted set. If a trigger is stricter
    // than the contract, this is the test that says so.
    for (const relevance of CLAIM_RELEVANCES) {
      const revisionId = claimWithRelevance(db, relevance, CLAIM_RELEVANCES.indexOf(relevance) + 1);
      insertClaimAssessment(db, {
        id: `aca_f_${relevance.toLowerCase()}`,
        claimId: `acs_${relevance.toLowerCase()}`,
        claimRevisionId: revisionId,
        label: first(permittedFidelityLabels(relevance), `${relevance} fidelity`),
      });
      insertClaimAssessment(db, {
        id: `aca_a_${relevance.toLowerCase()}`,
        claimId: `acs_${relevance.toLowerCase()}`,
        claimRevisionId: revisionId,
        dimension: 'ATTRIBUTION',
        label: first(permittedAttributionLabels(relevance), `${relevance} attribution`),
      });
      insertClaimPropositionLink(db, {
        id: `acp_${relevance.toLowerCase()}`,
        claimRevisionId: revisionId,
        relation: first(permittedPropositionRelations(relevance), `${relevance} relation`),
      });
      insertClaimCitationLink(db, {
        id: `acc_${relevance.toLowerCase()}`,
        claimRevisionId: revisionId,
        support: first(permittedCitationSupportLabels(relevance), `${relevance} support`),
      });
    }
    assert.equal(
      CLAIM_RELEVANCES.length,
      new Set(CLAIM_RELEVANCES.map((value) => value.toLowerCase())).size,
      'the fixture keys cannot collide',
    );
    assert.equal(
      Number(
        (
          db.prepare('SELECT COUNT(*) AS n FROM answer_claim_assessments').get() as Record<
            string,
            unknown
          >
        )['n'] ?? 0,
      ),
      CLAIM_RELEVANCES.length * 2,
    );
  } finally {
    db.close();
  }
});

test('the relation vocabulary is fully reachable from at least one relevance', () => {
  // A relation nobody can legitimately record is a dead option in the form, and a required stratum
  // the data format cannot express.
  const reachable = new Set<ClaimPropositionRelation>();
  for (const relevance of CLAIM_RELEVANCES) {
    for (const relation of permittedPropositionRelations(relevance)) {
      reachable.add(relation);
    }
  }
  assert.deepEqual(
    [...CLAIM_PROPOSITION_RELATIONS].sort(),
    [...reachable].sort(),
    'every proposition relation must be recordable somewhere',
  );
});
