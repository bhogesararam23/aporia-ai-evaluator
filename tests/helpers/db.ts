import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/persistence/db.ts';
import { loadMigrations, runMigrations } from '../../src/persistence/migrate.ts';

export const TEST_TIME = '2026-10-28T12:00:00.000Z';
export const TEST_ACTOR = 'Ram';
const MIGRATIONS = join(import.meta.dirname, '../../src/persistence/migrations');

export function createTestDatabase(): DatabaseSync {
  const db = openDatabase(':memory:');
  runMigrations(db, loadMigrations(MIGRATIONS));
  return db;
}

export function insertProject(
  db: DatabaseSync,
  options: { id?: string; name?: string; createdAt?: string } = {},
): string {
  const id = options.id ?? 'prj_1';
  const at = options.createdAt ?? TEST_TIME;
  db.prepare(
    `INSERT INTO projects
      (id, name, description, primary_domain, target_entity_id, visibility, lifecycle,
       owner_label, created_at, updated_at)
     VALUES (?, ?, NULL, NULL, NULL, 'LOCAL_ONLY', 'ACTIVE', ?, ?, ?)`,
  ).run(id, options.name ?? 'Aporia', TEST_ACTOR, at, at);
  return id;
}

export function insertEntity(
  db: DatabaseSync,
  options: { id?: string; projectId?: string; name?: string } = {},
): string {
  const id = options.id ?? 'ent_1';
  db.prepare(
    `INSERT INTO entities
      (id, project_id, type, canonical_name, alternate_names_json, public_urls_json,
       identity_status, identity_method, identity_scope, notes, created_at, updated_at)
     VALUES (?, ?, 'PERSON', ?, '[]', '[]', 'SELF_DECLARED', NULL, NULL, NULL, ?, ?)`,
  ).run(id, options.projectId ?? 'prj_1', options.name ?? 'Ram', TEST_TIME, TEST_TIME);
  return id;
}

export function insertClaimWithProposition(
  db: DatabaseSync,
  options: {
    projectId?: string;
    claimId?: string;
    revisionId?: string;
    propositionId?: string;
    status?: 'DECOMPOSED' | 'UNDER_REVIEW' | 'ASSESSED' | 'DISPUTED';
  } = {},
): { claimId: string; revisionId: string; propositionId: string } {
  const projectId = options.projectId ?? 'prj_1';
  const claimId = options.claimId ?? 'clm_1';
  const revisionId = options.revisionId ?? 'rev_1';
  const propositionId = options.propositionId ?? 'prp_1';
  db.prepare(
    `INSERT INTO claims (id, project_id, status, current_revision_id, created_at, updated_at)
     VALUES (?, ?, 'SUBMITTED', NULL, ?, ?)`,
  ).run(claimId, projectId, TEST_TIME, TEST_TIME);
  db.prepare(
    `INSERT INTO claim_revisions
      (id, claim_id, revision_number, text, source_url, intended_meaning, time_scope,
       locale, decomposition_version, note, created_by, created_at)
     VALUES (?, ?, 1, ?, NULL, NULL, NULL, 'en', 'manual-decomposition-v1', NULL, ?, ?)`,
  ).run(
    revisionId,
    claimId,
    'The repository contains the described feature.',
    TEST_ACTOR,
    TEST_TIME,
  );
  db.prepare('UPDATE claims SET current_revision_id = ? WHERE id = ?').run(revisionId, claimId);
  db.prepare(
    `INSERT INTO propositions
      (id, claim_revision_id, ordinal, text, subject, predicate, object_value, conditions,
       time_interval, units, evidence_requirements, expected_answer_criterion,
       ambiguity_notes, decomposition_version, created_at)
     VALUES (?, ?, 1, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL,
       'manual-decomposition-v1', ?)`,
  ).run(
    propositionId,
    revisionId,
    'The repository contains feature F.',
    'Release tag and test log.',
    TEST_TIME,
  );

  const status = options.status ?? 'UNDER_REVIEW';
  if (status !== 'DECOMPOSED') {
    db.prepare('UPDATE claims SET status = ? WHERE id = ?').run('DECOMPOSED', claimId);
    if (status === 'UNDER_REVIEW') {
      db.prepare('UPDATE claims SET status = ? WHERE id = ?').run('UNDER_REVIEW', claimId);
    } else if (status === 'ASSESSED') {
      db.prepare('UPDATE claims SET status = ? WHERE id = ?').run('UNDER_REVIEW', claimId);
      db.prepare('UPDATE claims SET status = ? WHERE id = ?').run('ASSESSED', claimId);
    } else if (status === 'DISPUTED') {
      db.prepare('UPDATE claims SET status = ? WHERE id = ?').run('UNDER_REVIEW', claimId);
      db.prepare('UPDATE claims SET status = ? WHERE id = ?').run('DISPUTED', claimId);
    }
  }
  return { claimId, revisionId, propositionId };
}

export function insertSource(
  db: DatabaseSync,
  options: {
    id?: string;
    projectId?: string;
    title?: string;
    sourceType?: string;
    independence?: string;
  } = {},
): string {
  const id = options.id ?? 'src_1';
  db.prepare(
    `INSERT INTO sources
      (id, project_id, title, canonical_uri, publisher, author, source_type, access_route,
       retrieved_at, publication_date, language, independence, notes, access_status, created_at)
     VALUES (?, ?, ?, NULL, NULL, NULL, ?, 'MANUAL_ENTRY', ?, NULL, 'en', ?, NULL,
       'NOT_CHECKED', ?)`,
  ).run(
    id,
    options.projectId ?? 'prj_1',
    options.title ?? 'Release archive',
    options.sourceType ?? 'PRIMARY_ARTIFACT',
    TEST_TIME,
    options.independence ?? 'INDEPENDENT',
    TEST_TIME,
  );
  return id;
}

export function insertEvidenceWithRelation(
  db: DatabaseSync,
  options: {
    evidenceId?: string;
    relationshipId?: string;
    projectId?: string;
    sourceId?: string;
    propositionId?: string;
    relation?: string;
    excerpt?: string;
    rationale?: string;
  } = {},
): { evidenceId: string; relationshipId: string } {
  const evidenceId = options.evidenceId ?? 'evd_1';
  const relationshipId = options.relationshipId ?? 'rel_1';
  const projectId = options.projectId ?? 'prj_1';
  const excerpt = options.excerpt ?? 'The release contains feature F.';
  db.prepare(
    `INSERT INTO evidence_items
      (id, project_id, source_id, locator, excerpt, extraction_method, extracted_at,
       provenance, excerpt_digest, created_at)
     VALUES (?, ?, ?, 'README section 1', ?, 'PASTED_TEXT', ?, 'USER_SUPPLIED', ?, ?)`,
  ).run(
    evidenceId,
    projectId,
    options.sourceId ?? 'src_1',
    excerpt,
    TEST_TIME,
    createHash('sha256').update(excerpt, 'utf8').digest('hex'),
    TEST_TIME,
  );
  db.prepare(
    `INSERT INTO evidence_relationships
      (id, project_id, evidence_id, proposition_id, relation, rationale, reviewer, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'Ram', ?)`,
  ).run(
    relationshipId,
    projectId,
    evidenceId,
    options.propositionId ?? 'prp_1',
    options.relation ?? 'SUPPORTS',
    options.rationale ?? 'The passage directly supports the proposition.',
    TEST_TIME,
  );
  return { evidenceId, relationshipId };
}
