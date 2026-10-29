import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { AchievementRevisionInput } from '../../src/core/achievements.ts';
import {
  approveAchievement,
  createAchievement,
  createAchievementRevision,
} from '../../src/persistence/repositories/achievements.ts';
import type { WriteContext } from '../../src/persistence/repositories/context.ts';
import {
  createTestDatabase,
  insertClaimWithProposition,
  insertEvidenceWithRelation,
  insertProject,
  insertSource,
} from '../helpers/db.ts';

const CONTEXT: WriteContext = { actor: 'Ram', at: '2026-10-30T12:00:00.000Z' };

function input(title = 'A recorded achievement'): AchievementRevisionInput {
  return {
    title,
    summary: 'A record whose snapshots must not change in place.',
    projectName: 'Aporia',
    projectDescription: undefined,
    projectUrl: undefined,
    startDate: '2026-01-01',
    endDate: '2026-02-01',
    claimIds: ['clm_1'],
    contributors: [
      {
        name: 'Ram',
        role: 'AUTHOR',
        contribution: 'Built the project.',
        supportState: 'EVIDENCE_LINKED',
        evidenceNote: 'Release archive.',
      },
    ],
    sourceIds: ['src_1'],
    evidenceIds: ['evd_1'],
  };
}

function seed(db: DatabaseSync): void {
  insertProject(db);
  insertClaimWithProposition(db);
  insertSource(db);
  insertEvidenceWithRelation(db);
}

test('revision snapshots reject in-place updates', () => {
  const db = createTestDatabase();
  seed(db);
  createAchievement(db, 'prj_1', input(), CONTEXT);

  assert.throws(
    () => db.prepare("UPDATE achievement_revisions SET title = 'Rewritten'").run(),
    /immutable/,
  );
  assert.throws(
    () => db.prepare("UPDATE achievement_claims SET claim_text = 'Rewritten'").run(),
    /immutable/,
  );
  assert.throws(
    () => db.prepare("UPDATE achievement_contributors SET name = 'Someone else'").run(),
    /immutable/,
  );
  assert.throws(
    () => db.prepare("UPDATE achievement_evidence SET source_title = 'Rewritten'").run(),
    /immutable/,
  );
});

test('a recorded approval cannot be rewritten', () => {
  const db = createTestDatabase();
  seed(db);
  const achievement = createAchievement(db, 'prj_1', input(), CONTEXT);
  approveAchievement(
    db,
    'prj_1',
    achievement.id,
    { confirmation: 'A recorded achievement', note: 'Reviewed the record.' },
    CONTEXT,
  );

  assert.throws(
    () => db.prepare("UPDATE achievement_approvals SET note = 'Approved without review'").run(),
    /immutable/,
  );
});

test('an achievement cannot point at another achievement revision', () => {
  const db = createTestDatabase();
  seed(db);
  insertProject(db, { id: 'prj_2', name: 'Other project' });
  insertClaimWithProposition(db, {
    projectId: 'prj_2',
    claimId: 'clm_2',
    revisionId: 'rev_2',
    propositionId: 'prp_2',
  });
  insertSource(db, { id: 'src_2', projectId: 'prj_2' });
  insertEvidenceWithRelation(db, {
    projectId: 'prj_2',
    sourceId: 'src_2',
    propositionId: 'prp_2',
    evidenceId: 'evd_2',
    relationshipId: 'rel_2',
  });
  const first = createAchievement(db, 'prj_1', input(), CONTEXT);
  const second = createAchievement(
    db,
    'prj_2',
    {
      ...input('Another achievement'),
      claimIds: ['clm_2'],
      sourceIds: ['src_2'],
      evidenceIds: ['evd_2'],
    },
    CONTEXT,
  );

  assert.throws(
    () =>
      db
        .prepare('UPDATE achievements SET current_revision_id = ? WHERE id = ?')
        .run(second.currentRevisionId, first.id),
    /must belong to the achievement/,
  );
});

test('project ownership and creation time are immutable', () => {
  const db = createTestDatabase();
  seed(db);
  insertProject(db, { id: 'prj_2', name: 'Other project' });
  const achievement = createAchievement(db, 'prj_1', input(), CONTEXT);

  assert.throws(
    () =>
      db
        .prepare('UPDATE achievements SET project_id = ? WHERE id = ?')
        .run('prj_2', achievement.id),
    /immutable/,
  );
  assert.throws(
    () =>
      db
        .prepare('UPDATE achievements SET created_at = ? WHERE id = ?')
        .run('2020-01-01T00:00:00.000Z', achievement.id),
    /immutable/,
  );
});

test('an approval must match the hash and be for the current revision', () => {
  const db = createTestDatabase();
  seed(db);
  const achievement = createAchievement(db, 'prj_1', input(), CONTEXT);
  const revision = achievement.currentRevision;
  assert.ok(revision);

  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO achievement_approvals
            (id, revision_id, approved_by, approved_at, note, content_hash, created_at)
           VALUES ('aap_wrong', ?, 'Ram', ?, 'Reviewed.', ?, ?)`,
        )
        .run(revision.id, CONTEXT.at, '0'.repeat(64), CONTEXT.at),
    /hash does not match/,
  );

  createAchievementRevision(db, 'prj_1', achievement.id, input('A revised achievement'), CONTEXT);
  const historical = db
    .prepare('SELECT content_hash FROM achievement_revisions WHERE id = ?')
    .get(revision.id)?.['content_hash'];
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO achievement_approvals
            (id, revision_id, approved_by, approved_at, note, content_hash, created_at)
           VALUES ('aap_historical', ?, 'Ram', ?, 'Reviewed.', ?, ?)`,
        )
        .run(revision.id, CONTEXT.at, String(historical), CONTEXT.at),
    /only the current achievement revision/,
  );
});
