import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../../errors.ts';
import { appendAuditEvent } from '../audit.ts';
import { withTransaction } from '../db.ts';
import { newId } from '../ids.ts';
import { jsonValue, numberValue, nullableStringValue, stringValue, type Row } from '../rows.ts';
import type { WriteContext } from './context.ts';

export interface ReportInput {
  readonly reportNumber: number;
  readonly title: string;
  readonly generatedAt: string;
  readonly snapshotVersion: string;
  readonly methodologyVersion: string;
  readonly metricsVersion: string;
  readonly evidenceRuleVersion: string;
  readonly snapshot: unknown;
}

export interface ReportRecord {
  readonly id: string;
  readonly projectId: string;
  readonly reportNumber: number;
  readonly title: string;
  readonly generatedAt: string;
  readonly snapshotVersion: string;
  readonly methodologyVersion: string;
  readonly metricsVersion: string;
  readonly evidenceRuleVersion: string;
  readonly snapshot: unknown;
  readonly supersededByReportId: string | null;
  readonly createdAt: string;
}

export interface ReportSummary {
  readonly id: string;
  readonly reportNumber: number;
  readonly title: string;
  readonly generatedAt: string;
  readonly snapshotVersion: string;
  readonly methodologyVersion: string;
  readonly metricsVersion: string;
  readonly supersededByReportId: string | null;
  readonly createdAt: string;
}

function mapReport(row: Row): ReportRecord {
  return {
    id: stringValue(row, 'id'),
    projectId: stringValue(row, 'project_id'),
    reportNumber: numberValue(row, 'report_number'),
    title: stringValue(row, 'title'),
    generatedAt: stringValue(row, 'generated_at'),
    snapshotVersion: stringValue(row, 'snapshot_version'),
    methodologyVersion: stringValue(row, 'methodology_version'),
    metricsVersion: stringValue(row, 'metrics_version'),
    evidenceRuleVersion: stringValue(row, 'evidence_rule_version'),
    snapshot: jsonValue<unknown>(row, 'snapshot_json'),
    supersededByReportId: nullableStringValue(row, 'superseded_by_report_id'),
    createdAt: stringValue(row, 'created_at'),
  };
}

export function nextReportNumber(db: DatabaseSync, projectId: string): number {
  const row = db
    .prepare('SELECT MAX(report_number) AS max_number FROM reports WHERE project_id = ?')
    .get(projectId);
  const maxNumber =
    row === undefined || row['max_number'] === null ? 0 : numberValue(row, 'max_number');
  return maxNumber + 1;
}

export function getReport(
  db: DatabaseSync,
  projectId: string,
  reportId: string,
): ReportRecord | null {
  const row = db
    .prepare('SELECT * FROM reports WHERE project_id = ? AND id = ?')
    .get(projectId, reportId);
  return row === undefined ? null : mapReport(row);
}

export function getReportOrThrow(
  db: DatabaseSync,
  projectId: string,
  reportId: string,
): ReportRecord {
  const report = getReport(db, projectId, reportId);
  if (report === null) {
    throw new AppError('NOT_FOUND', 'Report not found.');
  }
  return report;
}

export function getLatestReport(db: DatabaseSync, projectId: string): ReportRecord | null {
  const row = db
    .prepare(
      `SELECT * FROM reports
       WHERE project_id = ?
       ORDER BY report_number DESC
       LIMIT 1`,
    )
    .get(projectId);
  return row === undefined ? null : mapReport(row);
}

export function listReports(db: DatabaseSync, projectId: string): ReportSummary[] {
  return db
    .prepare(
      `SELECT id, report_number, title, generated_at, snapshot_version, methodology_version,
         metrics_version, superseded_by_report_id, created_at
       FROM reports
       WHERE project_id = ?
       ORDER BY report_number DESC`,
    )
    .all(projectId)
    .map((row) => ({
      id: stringValue(row, 'id'),
      reportNumber: numberValue(row, 'report_number'),
      title: stringValue(row, 'title'),
      generatedAt: stringValue(row, 'generated_at'),
      snapshotVersion: stringValue(row, 'snapshot_version'),
      methodologyVersion: stringValue(row, 'methodology_version'),
      metricsVersion: stringValue(row, 'metrics_version'),
      supersededByReportId: nullableStringValue(row, 'superseded_by_report_id'),
      createdAt: stringValue(row, 'created_at'),
    }));
}

export function createReport(
  db: DatabaseSync,
  projectId: string,
  input: ReportInput,
  context: WriteContext,
): ReportRecord {
  return withTransaction(db, () => {
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (project === undefined) {
      throw new AppError('NOT_FOUND', 'Project not found.');
    }
    const expectedNumber = nextReportNumber(db, projectId);
    if (input.reportNumber !== expectedNumber) {
      throw new AppError(
        'CONFLICT',
        `Report numbers must be sequential. The next report number is ${expectedNumber}.`,
      );
    }
    const id = newId('rep');
    db.prepare(
      `INSERT INTO reports
        (id, project_id, report_number, title, generated_at, snapshot_version,
         methodology_version, metrics_version, evidence_rule_version, snapshot_json,
         superseded_by_report_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      id,
      projectId,
      input.reportNumber,
      input.title,
      input.generatedAt,
      input.snapshotVersion,
      input.methodologyVersion,
      input.metricsVersion,
      input.evidenceRuleVersion,
      JSON.stringify(input.snapshot),
      context.at,
    );
    db.prepare(
      `UPDATE reports
       SET superseded_by_report_id = ?
       WHERE project_id = ? AND superseded_by_report_id IS NULL AND id <> ?`,
    ).run(id, projectId, id);
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'report.generated',
      entityType: 'report',
      entityId: id,
      details: { reportNumber: input.reportNumber, title: input.title },
      at: context.at,
    });
    return getReportOrThrow(db, projectId, id);
  });
}
