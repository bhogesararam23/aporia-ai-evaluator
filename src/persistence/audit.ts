import type { DatabaseSync } from 'node:sqlite';
import { newId } from './ids.ts';
import { jsonValue, numberValue, stringValue } from './rows.ts';

export interface AuditEvent {
  readonly id: string;
  readonly projectId: string;
  readonly actor: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly details: Record<string, unknown>;
  readonly createdAt: string;
}

export interface AppendAuditInput {
  readonly projectId: string;
  readonly actor: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly details?: Record<string, unknown>;
  readonly at: string;
}

export function appendAuditEvent(db: DatabaseSync, input: AppendAuditInput): string {
  const id = newId('aud');
  db.prepare(
    `INSERT INTO audit_events
      (id, project_id, actor, action, entity_type, entity_id, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.projectId,
    input.actor,
    input.action,
    input.entityType,
    input.entityId,
    JSON.stringify(input.details ?? {}),
    input.at,
  );
  return id;
}

export function listAuditEvents(
  db: DatabaseSync,
  projectId: string,
  options: { limit?: number; offset?: number } = {},
): AuditEvent[] {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);
  return db
    .prepare(
      `SELECT id, project_id, actor, action, entity_type, entity_id, details_json, created_at
       FROM audit_events
       WHERE project_id = ?
       ORDER BY created_at DESC, rowid DESC
       LIMIT ? OFFSET ?`,
    )
    .all(projectId, limit, offset)
    .map((row) => ({
      id: stringValue(row, 'id'),
      projectId: stringValue(row, 'project_id'),
      actor: stringValue(row, 'actor'),
      action: stringValue(row, 'action'),
      entityType: stringValue(row, 'entity_type'),
      entityId: stringValue(row, 'entity_id'),
      details: jsonValue<Record<string, unknown>>(row, 'details_json'),
      createdAt: stringValue(row, 'created_at'),
    }));
}

export function countAuditEvents(db: DatabaseSync, projectId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM audit_events WHERE project_id = ?')
    .get(projectId);
  if (row === undefined) {
    return 0;
  }
  return numberValue(row, 'count');
}
