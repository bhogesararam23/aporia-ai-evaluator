import type { DatabaseSync } from 'node:sqlite';
import type { EntityInput, ProjectInput, ProjectUpdateInput } from '../../core/inputs.ts';
import type { EntityType, IdentityStatus } from '../../core/vocabulary.ts';
import { AppError } from '../../errors.ts';
import { appendAuditEvent } from '../audit.ts';
import { withTransaction } from '../db.ts';
import { newId } from '../ids.ts';
import { jsonValue, numberValue, nullableStringValue, stringValue, type Row } from '../rows.ts';
import type { WriteContext } from './context.ts';

export interface EntityRecord {
  readonly id: string;
  readonly projectId: string;
  readonly type: EntityType;
  readonly canonicalName: string;
  readonly alternateNames: readonly string[];
  readonly publicUrls: readonly string[];
  readonly identityStatus: IdentityStatus;
  readonly identityMethod: string | null;
  readonly identityScope: string | null;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly primaryDomain: string | null;
  readonly targetEntityId: string | null;
  readonly visibility: 'LOCAL_ONLY';
  readonly lifecycle: 'ACTIVE' | 'ARCHIVED';
  readonly ownerLabel: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectCounts {
  readonly claims: number;
  readonly sources: number;
  readonly evidence: number;
  readonly runs: number;
  readonly audits: number;
  readonly reports: number;
  readonly achievements: number;
}

export interface ProjectDetail {
  readonly project: ProjectRecord;
  readonly targetEntity: EntityRecord | null;
  readonly entities: readonly EntityRecord[];
  readonly counts: ProjectCounts;
}

export interface ProjectSummary extends ProjectRecord {
  readonly targetEntityName: string | null;
  readonly counts: ProjectCounts;
}

function mapProject(row: Row): ProjectRecord {
  return {
    id: stringValue(row, 'id'),
    name: stringValue(row, 'name'),
    description: nullableStringValue(row, 'description'),
    primaryDomain: nullableStringValue(row, 'primary_domain'),
    targetEntityId: nullableStringValue(row, 'target_entity_id'),
    visibility: 'LOCAL_ONLY',
    lifecycle: stringValue(row, 'lifecycle') as ProjectRecord['lifecycle'],
    ownerLabel: stringValue(row, 'owner_label'),
    createdAt: stringValue(row, 'created_at'),
    updatedAt: stringValue(row, 'updated_at'),
  };
}

function mapEntity(row: Row): EntityRecord {
  return {
    id: stringValue(row, 'id'),
    projectId: stringValue(row, 'project_id'),
    type: stringValue(row, 'type') as EntityType,
    canonicalName: stringValue(row, 'canonical_name'),
    alternateNames: jsonValue<string[]>(row, 'alternate_names_json'),
    publicUrls: jsonValue<string[]>(row, 'public_urls_json'),
    identityStatus: stringValue(row, 'identity_status') as IdentityStatus,
    identityMethod: nullableStringValue(row, 'identity_method'),
    identityScope: nullableStringValue(row, 'identity_scope'),
    notes: nullableStringValue(row, 'notes'),
    createdAt: stringValue(row, 'created_at'),
    updatedAt: stringValue(row, 'updated_at'),
  };
}

function entityRow(db: DatabaseSync, projectId: string, entityId: string): Row | undefined {
  return db
    .prepare('SELECT * FROM entities WHERE project_id = ? AND id = ?')
    .get(projectId, entityId);
}

function insertEntity(
  db: DatabaseSync,
  projectId: string,
  input: EntityInput,
  at: string,
): EntityRecord {
  const id = newId('ent');
  db.prepare(
    `INSERT INTO entities
      (id, project_id, type, canonical_name, alternate_names_json, public_urls_json,
       identity_status, identity_method, identity_scope, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    input.type,
    input.canonicalName,
    JSON.stringify(input.alternateNames),
    JSON.stringify(input.publicUrls),
    input.identityStatus,
    input.identityMethod ?? null,
    input.identityScope ?? null,
    input.notes ?? null,
    at,
    at,
  );
  const row = entityRow(db, projectId, id);
  if (row === undefined) {
    throw new AppError('INTERNAL_ERROR', 'The entity could not be read after creation.');
  }
  return mapEntity(row);
}

function countForProject(db: DatabaseSync, table: string, projectId: string): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id = ?`)
    .get(projectId);
  return row === undefined ? 0 : numberValue(row, 'count');
}

function countsForProject(db: DatabaseSync, projectId: string): ProjectCounts {
  return {
    claims: countForProject(db, 'claims', projectId),
    sources: countForProject(db, 'sources', projectId),
    evidence: countForProject(db, 'evidence_items', projectId),
    runs: countForProject(db, 'runs', projectId),
    audits: countForProject(db, 'website_audits', projectId),
    reports: countForProject(db, 'reports', projectId),
    achievements: countForProject(db, 'achievements', projectId),
  };
}

export function listProjects(db: DatabaseSync): ProjectSummary[] {
  return db
    .prepare(
      `SELECT p.*, e.canonical_name AS target_entity_name,
        (SELECT COUNT(*) FROM claims c WHERE c.project_id = p.id) AS claim_count,
        (SELECT COUNT(*) FROM sources s WHERE s.project_id = p.id) AS source_count,
        (SELECT COUNT(*) FROM evidence_items ev WHERE ev.project_id = p.id) AS evidence_count,
        (SELECT COUNT(*) FROM runs r WHERE r.project_id = p.id) AS run_count,
        (SELECT COUNT(*) FROM website_audits wa WHERE wa.project_id = p.id) AS audit_count,
        (SELECT COUNT(*) FROM reports rp WHERE rp.project_id = p.id) AS report_count,
        (SELECT COUNT(*) FROM achievements a WHERE a.project_id = p.id) AS achievement_count
       FROM projects p
       LEFT JOIN entities e ON e.id = p.target_entity_id
       ORDER BY p.updated_at DESC, p.name ASC`,
    )
    .all()
    .map((row) => ({
      ...mapProject(row),
      targetEntityName: nullableStringValue(row, 'target_entity_name'),
      counts: {
        claims: numberValue(row, 'claim_count'),
        sources: numberValue(row, 'source_count'),
        evidence: numberValue(row, 'evidence_count'),
        runs: numberValue(row, 'run_count'),
        audits: numberValue(row, 'audit_count'),
        reports: numberValue(row, 'report_count'),
        achievements: numberValue(row, 'achievement_count'),
      },
    }));
}

export function getProject(db: DatabaseSync, projectId: string): ProjectDetail | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (row === undefined) {
    return null;
  }
  const project = mapProject(row);
  const entityRows = db
    .prepare('SELECT * FROM entities WHERE project_id = ? ORDER BY canonical_name, created_at')
    .all(projectId);
  const entities = entityRows.map(mapEntity);
  const targetEntity =
    project.targetEntityId === null
      ? null
      : (entities.find((entity) => entity.id === project.targetEntityId) ?? null);
  return {
    project,
    targetEntity,
    entities,
    counts: countsForProject(db, projectId),
  };
}

export function getProjectOrThrow(db: DatabaseSync, projectId: string): ProjectDetail {
  const project = getProject(db, projectId);
  if (project === null) {
    throw new AppError('NOT_FOUND', 'Project not found.');
  }
  return project;
}

export function createProject(
  db: DatabaseSync,
  input: ProjectInput,
  context: WriteContext,
): ProjectDetail {
  const projectId = newId('prj');
  withTransaction(db, () => {
    db.prepare(
      `INSERT INTO projects
        (id, name, description, primary_domain, target_entity_id, visibility, lifecycle,
         owner_label, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, 'LOCAL_ONLY', 'ACTIVE', ?, ?, ?)`,
    ).run(
      projectId,
      input.name,
      input.description ?? null,
      input.primaryDomain ?? null,
      context.actor,
      context.at,
      context.at,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'project.created',
      entityType: 'project',
      entityId: projectId,
      details: { name: input.name },
      at: context.at,
    });
    if (input.targetEntity !== null) {
      const entity = insertEntity(
        db,
        projectId,
        {
          type: input.targetEntity.type,
          canonicalName: input.targetEntity.name,
          alternateNames: [],
          publicUrls: [],
          identityStatus: 'SELF_DECLARED',
          identityMethod:
            'Entered as the project target by the local operator; no independent verification.',
          identityScope: 'Project target only.',
          notes: undefined,
        },
        context.at,
      );
      db.prepare('UPDATE projects SET target_entity_id = ?, updated_at = ? WHERE id = ?').run(
        entity.id,
        context.at,
        projectId,
      );
      appendAuditEvent(db, {
        projectId,
        actor: context.actor,
        action: 'entity.created',
        entityType: 'entity',
        entityId: entity.id,
        details: { canonicalName: entity.canonicalName, identityStatus: entity.identityStatus },
        at: context.at,
      });
      appendAuditEvent(db, {
        projectId,
        actor: context.actor,
        action: 'project.target_entity_set',
        entityType: 'project',
        entityId: projectId,
        details: { targetEntityId: entity.id },
        at: context.at,
      });
    }
  });
  return getProjectOrThrow(db, projectId);
}

export function updateProject(
  db: DatabaseSync,
  projectId: string,
  input: ProjectUpdateInput,
  context: WriteContext,
): ProjectDetail {
  return withTransaction(db, () => {
    const existing = getProjectOrThrow(db, projectId);
    db.prepare(
      'UPDATE projects SET name = ?, description = ?, primary_domain = ?, updated_at = ? WHERE id = ?',
    ).run(
      input.name,
      input.description ?? null,
      input.primaryDomain ?? null,
      context.at,
      projectId,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'project.updated',
      entityType: 'project',
      entityId: projectId,
      details: { previousName: existing.project.name, name: input.name },
      at: context.at,
    });
    return getProjectOrThrow(db, projectId);
  });
}

export function listEntities(db: DatabaseSync, projectId: string): EntityRecord[] {
  getProjectOrThrow(db, projectId);
  return db
    .prepare('SELECT * FROM entities WHERE project_id = ? ORDER BY canonical_name, created_at')
    .all(projectId)
    .map(mapEntity);
}

export function getEntity(
  db: DatabaseSync,
  projectId: string,
  entityId: string,
): EntityRecord | null {
  const row = entityRow(db, projectId, entityId);
  return row === undefined ? null : mapEntity(row);
}

export function createEntity(
  db: DatabaseSync,
  projectId: string,
  input: EntityInput,
  context: WriteContext,
): EntityRecord {
  const project = getProjectOrThrow(db, projectId);
  return withTransaction(db, () => {
    const entity = insertEntity(db, projectId, input, context.at);
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'entity.created',
      entityType: 'entity',
      entityId: entity.id,
      details: { canonicalName: entity.canonicalName, type: entity.type },
      at: context.at,
    });
    if (project.project.targetEntityId === null) {
      db.prepare('UPDATE projects SET target_entity_id = ?, updated_at = ? WHERE id = ?').run(
        entity.id,
        context.at,
        projectId,
      );
      appendAuditEvent(db, {
        projectId,
        actor: context.actor,
        action: 'project.target_entity_set',
        entityType: 'project',
        entityId: projectId,
        details: { targetEntityId: entity.id },
        at: context.at,
      });
    }
    return entity;
  });
}

export function updateEntity(
  db: DatabaseSync,
  projectId: string,
  entityId: string,
  input: EntityInput,
  context: WriteContext,
): EntityRecord {
  return withTransaction(db, () => {
    const existing = getEntity(db, projectId, entityId);
    if (existing === null) {
      throw new AppError('NOT_FOUND', 'Entity not found.');
    }
    db.prepare(
      `UPDATE entities
       SET type = ?, canonical_name = ?, alternate_names_json = ?, public_urls_json = ?,
           identity_status = ?, identity_method = ?, identity_scope = ?, notes = ?, updated_at = ?
       WHERE project_id = ? AND id = ?`,
    ).run(
      input.type,
      input.canonicalName,
      JSON.stringify(input.alternateNames),
      JSON.stringify(input.publicUrls),
      input.identityStatus,
      input.identityMethod ?? null,
      input.identityScope ?? null,
      input.notes ?? null,
      context.at,
      projectId,
      entityId,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'entity.updated',
      entityType: 'entity',
      entityId,
      details: {
        previousIdentityStatus: existing.identityStatus,
        identityStatus: input.identityStatus,
      },
      at: context.at,
    });
    const updated = getEntity(db, projectId, entityId);
    if (updated === null) {
      throw new AppError('INTERNAL_ERROR', 'The entity could not be read after update.');
    }
    return updated;
  });
}

export function setTargetEntity(
  db: DatabaseSync,
  projectId: string,
  entityId: string,
  context: WriteContext,
): void {
  withTransaction(db, () => {
    const entity = getEntity(db, projectId, entityId);
    if (entity === null) {
      throw new AppError('NOT_FOUND', 'Entity not found.');
    }
    db.prepare('UPDATE projects SET target_entity_id = ?, updated_at = ? WHERE id = ?').run(
      entityId,
      context.at,
      projectId,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'project.target_entity_set',
      entityType: 'project',
      entityId: projectId,
      details: { targetEntityId: entityId },
      at: context.at,
    });
  });
}

export function deleteProject(db: DatabaseSync, projectId: string): string {
  const project = getProject(db, projectId);
  if (project === null) {
    throw new AppError('NOT_FOUND', 'Project not found.');
  }
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  return project.project.name;
}
