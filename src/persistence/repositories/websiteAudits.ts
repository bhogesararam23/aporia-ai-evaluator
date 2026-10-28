import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../../errors.ts';
import { appendAuditEvent } from '../audit.ts';
import { newId } from '../ids.ts';
import { jsonValue, numberValue, nullableStringValue, stringValue, type Row } from '../rows.ts';
import type { WriteContext } from './context.ts';

export interface WebsiteAuditInput {
  readonly label: string;
  readonly inputMethod: 'PASTED' | 'UPLOADED';
  readonly inputFilename: string | null;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly htmlSnapshot: string;
  readonly auditedAt: string;
  readonly methodologyVersion: string;
  readonly findings: readonly unknown[];
  readonly unavailableChecks: readonly unknown[];
  readonly metadata: Record<string, unknown>;
}

export interface WebsiteAuditRecord {
  readonly id: string;
  readonly projectId: string;
  readonly label: string;
  readonly inputMethod: 'PASTED' | 'UPLOADED';
  readonly inputFilename: string | null;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly htmlSnapshot: string;
  readonly auditedAt: string;
  readonly methodologyVersion: string;
  readonly findings: readonly unknown[];
  readonly unavailableChecks: readonly unknown[];
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
}

export interface WebsiteAuditSummary {
  readonly id: string;
  readonly label: string;
  readonly inputMethod: 'PASTED' | 'UPLOADED';
  readonly inputFilename: string | null;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly auditedAt: string;
  readonly methodologyVersion: string;
  readonly findingCount: number;
  readonly unavailableCheckCount: number;
  readonly createdAt: string;
}

function mapAudit(row: Row): WebsiteAuditRecord {
  return {
    id: stringValue(row, 'id'),
    projectId: stringValue(row, 'project_id'),
    label: stringValue(row, 'label'),
    inputMethod: stringValue(row, 'input_method') as WebsiteAuditRecord['inputMethod'],
    inputFilename: nullableStringValue(row, 'input_filename'),
    contentHash: stringValue(row, 'content_hash'),
    byteLength: numberValue(row, 'byte_length'),
    htmlSnapshot: stringValue(row, 'html_snapshot'),
    auditedAt: stringValue(row, 'audited_at'),
    methodologyVersion: stringValue(row, 'methodology_version'),
    findings: jsonValue<unknown[]>(row, 'findings_json'),
    unavailableChecks: jsonValue<unknown[]>(row, 'unavailable_checks_json'),
    metadata: jsonValue<Record<string, unknown>>(row, 'metadata_json'),
    createdAt: stringValue(row, 'created_at'),
  };
}

export function createWebsiteAudit(
  db: DatabaseSync,
  projectId: string,
  input: WebsiteAuditInput,
  context: WriteContext,
): WebsiteAuditRecord {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (project === undefined) {
    throw new AppError('NOT_FOUND', 'Project not found.');
  }
  const id = newId('wsa');
  db.prepare(
    `INSERT INTO website_audits
      (id, project_id, label, input_method, input_filename, content_hash, byte_length,
       html_snapshot, audited_at, methodology_version, findings_json,
       unavailable_checks_json, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    projectId,
    input.label,
    input.inputMethod,
    input.inputFilename,
    input.contentHash,
    input.byteLength,
    input.htmlSnapshot,
    input.auditedAt,
    input.methodologyVersion,
    JSON.stringify(input.findings),
    JSON.stringify(input.unavailableChecks),
    JSON.stringify(input.metadata),
    context.at,
  );
  appendAuditEvent(db, {
    projectId,
    actor: context.actor,
    action: 'website_audit.created',
    entityType: 'website_audit',
    entityId: id,
    details: {
      label: input.label,
      inputMethod: input.inputMethod,
      contentHash: input.contentHash,
      findingCount: input.findings.length,
    },
    at: context.at,
  });
  return getWebsiteAuditOrThrow(db, projectId, id);
}

export function listWebsiteAudits(db: DatabaseSync, projectId: string): WebsiteAuditSummary[] {
  return db
    .prepare(
      `SELECT id, label, input_method, input_filename, content_hash, byte_length, audited_at,
         methodology_version, created_at,
         json_array_length(findings_json) AS finding_count,
         json_array_length(unavailable_checks_json) AS unavailable_count
       FROM website_audits
       WHERE project_id = ?
       ORDER BY audited_at DESC, rowid DESC`,
    )
    .all(projectId)
    .map((row) => ({
      id: stringValue(row, 'id'),
      label: stringValue(row, 'label'),
      inputMethod: stringValue(row, 'input_method') as WebsiteAuditSummary['inputMethod'],
      inputFilename: nullableStringValue(row, 'input_filename'),
      contentHash: stringValue(row, 'content_hash'),
      byteLength: numberValue(row, 'byte_length'),
      auditedAt: stringValue(row, 'audited_at'),
      methodologyVersion: stringValue(row, 'methodology_version'),
      findingCount: numberValue(row, 'finding_count'),
      unavailableCheckCount: numberValue(row, 'unavailable_count'),
      createdAt: stringValue(row, 'created_at'),
    }));
}

export function getWebsiteAudit(
  db: DatabaseSync,
  projectId: string,
  auditId: string,
): WebsiteAuditRecord | null {
  const row = db
    .prepare('SELECT * FROM website_audits WHERE project_id = ? AND id = ?')
    .get(projectId, auditId);
  return row === undefined ? null : mapAudit(row);
}

export function getWebsiteAuditOrThrow(
  db: DatabaseSync,
  projectId: string,
  auditId: string,
): WebsiteAuditRecord {
  const audit = getWebsiteAudit(db, projectId, auditId);
  if (audit === null) {
    throw new AppError('NOT_FOUND', 'Website audit not found.');
  }
  return audit;
}
