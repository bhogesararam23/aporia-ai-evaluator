import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import {
  approveAchievement,
  createAchievement,
  createAchievementRevision,
  exportAchievements,
  getAchievement,
  listAchievements,
} from '../../src/persistence/repositories/achievements.ts';
import { addClaimRevision } from '../../src/persistence/repositories/claims.ts';
import { deleteProject } from '../../src/persistence/repositories/projects.ts';
import type { WriteContext } from '../../src/persistence/repositories/context.ts';
import {
  createTestDatabase,
  insertClaimWithProposition,
  insertEvidenceWithRelation,
  insertProject,
  insertSource,
} from '../helpers/db.ts';
import type { AchievementRevisionInput } from '../../src/core/achievements.ts';

const CONTEXT: WriteContext = { actor: 'Ram', at: '2026-10-30T11:00:00.000Z' };

function achievementInput(
  overrides: Partial<AchievementRevisionInput> = {},
): AchievementRevisionInput {
  return {
    title: 'A documented local achievement',
    summary: 'A concise record of the work and its recorded evidence.',
    projectName: 'Aporia',
    projectDescription: 'The local evidence evaluator.',
    projectUrl: 'https://example.com/aporia',
    startDate: '2026-01-01',
    endDate: '2026-02-01',
    claimIds: ['clm_1'],
    contributors: [
      {
        name: 'Ram',
        role: 'AUTHOR',
        contribution: 'Designed and implemented the project.',
        supportState: 'EVIDENCE_LINKED',
        evidenceNote: 'Release archive and test log.',
      },
    ],
    sourceIds: ['src_1'],
    evidenceIds: ['evd_1'],
    ...overrides,
  };
}

function forceAuditFailure(db: DatabaseSync, action: string): void {
  db.exec(`
    CREATE TRIGGER fail_achievement_audit_${action.replaceAll('.', '_')}
    BEFORE INSERT ON audit_events
    WHEN NEW.action = '${action}'
    BEGIN
      SELECT RAISE(ABORT, 'forced achievement audit failure');
    END;
  `);
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
  return row === undefined ? 0 : Number(row['count']);
}

function seedAssessment(db: DatabaseSync): void {
  insertProject(db);
  insertClaimWithProposition(db);
  insertSource(db);
  insertEvidenceWithRelation(db);
}

test('creating an achievement snapshots its claim, evidence and contributor roles', () => {
  const db = createTestDatabase();
  seedAssessment(db);

  const achievement = createAchievement(db, 'prj_1', achievementInput(), CONTEXT);

  assert.equal(achievement.revisions.length, 1);
  assert.equal(achievement.currentRevision?.revisionNumber, 1);
  assert.equal(achievement.currentRevision?.title, 'A documented local achievement');
  const claim = achievement.currentRevision?.claims[0];
  assert.equal(claim?.claimText, 'The repository contains the described feature.');
  assert.equal(claim?.evidenceStatus, 'SUPPORTED_WITHIN_SCOPE');
  assert.equal(claim?.supportState, 'EVIDENCE_RECORDED');
  assert.equal(claim?.evidenceRelationshipCount, 1);
  assert.equal(achievement.currentRevision?.contributors[0]?.role, 'AUTHOR');
  assert.equal(achievement.currentRevision?.contributors[0]?.supportState, 'EVIDENCE_LINKED');
  assert.equal(achievement.currentRevision?.evidence.length, 2);
  assert.equal(achievement.currentRevision?.evidence[1]?.evidenceId, 'evd_1');
  assert.match(achievement.currentRevision?.contentHash ?? '', /^[a-f0-9]{64}$/);
  assert.equal(achievement.publicationReady, false);
  assert.equal(count(db, 'audit_events'), 1);
  assert.equal(listAchievements(db, 'prj_1')[0]?.claimCount, 1);
});

test('a new revision preserves the prior revision and claim snapshot', () => {
  const db = createTestDatabase();
  seedAssessment(db);
  const first = createAchievement(db, 'prj_1', achievementInput(), CONTEXT);
  const firstRevision = first.currentRevision;
  assert.ok(firstRevision);

  addClaimRevision(
    db,
    'prj_1',
    'clm_1',
    {
      text: 'The repository contains a substantially revised claim.',
      sourceUrl: undefined,
      intendedMeaning: undefined,
      timeScope: undefined,
      locale: 'en',
    },
    CONTEXT,
  );
  const second = createAchievementRevision(
    db,
    'prj_1',
    first.id,
    achievementInput({ title: 'Second revision of the achievement' }),
    CONTEXT,
  );

  assert.equal(second.revisions.length, 2);
  assert.equal(second.currentRevision?.revisionNumber, 2);
  assert.equal(second.currentRevision?.title, 'Second revision of the achievement');
  assert.equal(second.revisions[0]?.claims[0]?.claimText, firstRevision.claims[0]?.claimText);
  assert.equal(second.publicationReady, false);
  assert.equal(count(db, 'audit_events'), 3);
});

test('approval is explicit, hash-bound and tied to the current revision', () => {
  const db = createTestDatabase();
  seedAssessment(db);
  const achievement = createAchievement(db, 'prj_1', achievementInput(), CONTEXT);
  const revision = achievement.currentRevision;
  assert.ok(revision);

  assert.throws(
    () =>
      approveAchievement(
        db,
        'prj_1',
        achievement.id,
        { confirmation: 'wrong title', note: 'I reviewed this record.' },
        CONTEXT,
      ),
    /confirmation/,
  );
  assert.equal(count(db, 'achievement_approvals'), 0);

  const approved = approveAchievement(
    db,
    'prj_1',
    achievement.id,
    { confirmation: revision.title, note: 'I reviewed this record and its evidence links.' },
    CONTEXT,
  );

  assert.equal(approved.publicationReady, true);
  assert.equal(approved.currentRevision?.approval?.approvedBy, 'Ram');
  assert.equal(approved.currentRevision?.approval?.contentHash, revision.contentHash);
  assert.throws(
    () =>
      approveAchievement(
        db,
        'prj_1',
        achievement.id,
        { confirmation: revision.title, note: 'A second approval.' },
        CONTEXT,
      ),
    /already approved/,
  );
});

test('a revision after approval is unapproved again', () => {
  const db = createTestDatabase();
  seedAssessment(db);
  const achievement = createAchievement(db, 'prj_1', achievementInput(), CONTEXT);
  const revision = achievement.currentRevision;
  assert.ok(revision);
  approveAchievement(
    db,
    'prj_1',
    achievement.id,
    { confirmation: revision.title, note: 'Approved for the local record.' },
    CONTEXT,
  );
  const second = createAchievementRevision(
    db,
    'prj_1',
    achievement.id,
    achievementInput({ title: 'A revised record' }),
    CONTEXT,
  );

  assert.equal(second.publicationReady, false);
  assert.equal(second.currentRevision?.approval, null);
  assert.equal(second.revisions[0]?.approval?.approvedBy, 'Ram');
});

test('unresolved support and contradiction are preserved in the record', () => {
  const db = createTestDatabase();
  insertProject(db);
  insertClaimWithProposition(db);
  insertSource(db, { id: 'src_support' });
  insertSource(db, { id: 'src_contradict' });
  insertEvidenceWithRelation(db, {
    evidenceId: 'evd_support',
    relationshipId: 'rel_support',
    sourceId: 'src_support',
  });
  insertEvidenceWithRelation(db, {
    evidenceId: 'evd_contradict',
    relationshipId: 'rel_contradict',
    sourceId: 'src_contradict',
    relation: 'CONTRADICTS',
  });

  const achievement = createAchievement(
    db,
    'prj_1',
    achievementInput({ sourceIds: ['src_support', 'src_contradict'], evidenceIds: [] }),
    CONTEXT,
  );

  assert.equal(achievement.currentRevision?.claims[0]?.evidenceStatus, 'CONFLICTING_EVIDENCE');
  assert.equal(achievement.currentRevision?.claims[0]?.supportState, 'UNRESOLVED');
  assert.equal(achievement.currentRevision?.unresolvedContradictions.length, 1);
  assert.match(
    achievement.currentRevision?.unresolvedContradictions[0]?.reason ?? '',
    /conflict remains unresolved/,
  );
});

test('a cross-project source or claim is refused', () => {
  const db = createTestDatabase();
  seedAssessment(db);
  insertProject(db, { id: 'prj_2', name: 'Other project' });
  insertSource(db, { id: 'src_other', projectId: 'prj_2' });

  assert.throws(
    () => createAchievement(db, 'prj_1', achievementInput({ sourceIds: ['src_other'] }), CONTEXT),
    /does not belong to this project/,
  );
  assert.equal(count(db, 'achievements'), 0);
});

test('a forced audit failure rolls back the achievement and its revision', () => {
  const db = createTestDatabase();
  seedAssessment(db);
  forceAuditFailure(db, 'achievement.created');

  assert.throws(
    () => createAchievement(db, 'prj_1', achievementInput(), CONTEXT),
    /forced achievement audit failure/,
  );

  assert.equal(count(db, 'achievements'), 0);
  assert.equal(count(db, 'achievement_revisions'), 0);
  assert.equal(count(db, 'achievement_claims'), 0);
  assert.equal(count(db, 'audit_events'), 0);
});

test('project export data includes every achievement revision', () => {
  const db = createTestDatabase();
  seedAssessment(db);
  const achievement = createAchievement(db, 'prj_1', achievementInput(), CONTEXT);
  createAchievementRevision(
    db,
    'prj_1',
    achievement.id,
    achievementInput({ title: 'Exported revision' }),
    CONTEXT,
  );

  const exported = exportAchievements(db, 'prj_1');

  assert.equal(exported.length, 1);
  assert.equal(exported[0]?.revisions.length, 2);
  assert.equal(getAchievement(db, 'prj_1', 'missing'), null);
});

test('a cross-project claim or evidence item is refused', () => {
  const db = createTestDatabase();
  seedAssessment(db);
  insertProject(db, { id: 'prj_2', name: 'Other project' });
  insertClaimWithProposition(db, {
    projectId: 'prj_2',
    claimId: 'clm_other',
    revisionId: 'rev_other',
    propositionId: 'prp_other',
  });
  insertSource(db, { id: 'src_other', projectId: 'prj_2' });
  insertEvidenceWithRelation(db, {
    projectId: 'prj_2',
    sourceId: 'src_other',
    evidenceId: 'evd_other',
    relationshipId: 'rel_other',
    propositionId: 'prp_other',
  });

  assert.throws(
    () => createAchievement(db, 'prj_1', achievementInput({ claimIds: ['clm_other'] }), CONTEXT),
    /Claim not found/,
  );
  assert.throws(
    () =>
      createAchievement(
        db,
        'prj_1',
        achievementInput({ sourceIds: [], evidenceIds: ['evd_other'] }),
        CONTEXT,
      ),
    /evidence item does not belong to this project/,
  );
  assert.equal(count(db, 'achievements'), 0);
});

test('the database refuses an approval whose hash does not match the revision', () => {
  const db = createTestDatabase();
  seedAssessment(db);
  const achievement = createAchievement(db, 'prj_1', achievementInput(), CONTEXT);
  const revision = achievement.currentRevision;
  assert.ok(revision);

  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO achievement_approvals
            (id, revision_id, approved_by, approved_at, note, content_hash, created_at)
           VALUES (?, ?, 'Ram', ?, 'A mismatched approval.', ?, ?)`,
        )
        .run('aap_bad_hash', revision.id, CONTEXT.at, '0'.repeat(64), CONTEXT.at),
    /content hash/,
  );
  assert.equal(count(db, 'achievement_approvals'), 0);
});

test('deleting a project cascades achievement records and approvals', () => {
  const db = createTestDatabase();
  seedAssessment(db);
  const achievement = createAchievement(db, 'prj_1', achievementInput(), CONTEXT);
  const revision = achievement.currentRevision;
  assert.ok(revision);
  approveAchievement(
    db,
    'prj_1',
    achievement.id,
    { confirmation: revision.title, note: 'Approved before deletion.' },
    CONTEXT,
  );

  deleteProject(db, 'prj_1');

  assert.equal(count(db, 'achievements'), 0);
  assert.equal(count(db, 'achievement_revisions'), 0);
  assert.equal(count(db, 'achievement_claims'), 0);
  assert.equal(count(db, 'achievement_contributors'), 0);
  assert.equal(count(db, 'achievement_evidence'), 0);
  assert.equal(count(db, 'achievement_approvals'), 0);
  assert.equal(count(db, 'claims'), 0);
});
