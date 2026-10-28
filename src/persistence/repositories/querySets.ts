import type { DatabaseSync } from 'node:sqlite';
import type { QueryDraftInput, QuerySetApprovalInput, QuerySetInput } from '../../core/inputs.ts';
import type { QueryIntent, QuerySetStatus } from '../../core/vocabulary.ts';
import { AppError } from '../../errors.ts';
import { appendAuditEvent } from '../audit.ts';
import { withTransaction } from '../db.ts';
import { newId } from '../ids.ts';
import { booleanValue, numberValue, nullableStringValue, stringValue, type Row } from '../rows.ts';
import type { WriteContext } from './context.ts';

export interface QuerySetRecord {
  readonly id: string;
  readonly projectId: string;
  readonly name: string;
  readonly version: number;
  readonly status: QuerySetStatus;
  readonly description: string | null;
  readonly locale: string;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly approvalNote: string | null;
  readonly supersedesId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface QueryRecord {
  readonly id: string;
  readonly querySetId: string;
  readonly ordinal: number;
  readonly text: string;
  readonly intent: QueryIntent;
  readonly locale: string | null;
  readonly region: string | null;
  readonly branded: boolean;
  readonly expectedElements: string;
  readonly inclusionRationale: string;
  readonly createdAt: string;
}

export interface QuerySetDetail {
  readonly set: QuerySetRecord;
  readonly queries: readonly QueryRecord[];
}

function mapQuerySet(row: Row): QuerySetRecord {
  return {
    id: stringValue(row, 'id'),
    projectId: stringValue(row, 'project_id'),
    name: stringValue(row, 'name'),
    version: numberValue(row, 'version'),
    status: stringValue(row, 'status') as QuerySetStatus,
    description: nullableStringValue(row, 'description'),
    locale: stringValue(row, 'locale'),
    approvedBy: nullableStringValue(row, 'approved_by'),
    approvedAt: nullableStringValue(row, 'approved_at'),
    approvalNote: nullableStringValue(row, 'approval_note'),
    supersedesId: nullableStringValue(row, 'supersedes_id'),
    createdAt: stringValue(row, 'created_at'),
    updatedAt: stringValue(row, 'updated_at'),
  };
}

function mapQuery(row: Row): QueryRecord {
  return {
    id: stringValue(row, 'id'),
    querySetId: stringValue(row, 'query_set_id'),
    ordinal: numberValue(row, 'ordinal'),
    text: stringValue(row, 'text'),
    intent: stringValue(row, 'intent') as QueryIntent,
    locale: nullableStringValue(row, 'locale'),
    region: nullableStringValue(row, 'region'),
    branded: booleanValue(row, 'branded'),
    expectedElements: stringValue(row, 'expected_elements'),
    inclusionRationale: stringValue(row, 'inclusion_rationale'),
    createdAt: stringValue(row, 'created_at'),
  };
}

function setRow(db: DatabaseSync, projectId: string, setId: string): Row | undefined {
  return db
    .prepare('SELECT * FROM query_sets WHERE project_id = ? AND id = ?')
    .get(projectId, setId);
}

function getSetOrThrow(db: DatabaseSync, projectId: string, setId: string): QuerySetRecord {
  const row = setRow(db, projectId, setId);
  if (row === undefined) {
    throw new AppError('NOT_FOUND', 'Query set not found.');
  }
  return mapQuerySet(row);
}

export function getQuerySet(
  db: DatabaseSync,
  projectId: string,
  setId: string,
): QuerySetDetail | null {
  const row = setRow(db, projectId, setId);
  if (row === undefined) {
    return null;
  }
  const queries = db
    .prepare('SELECT * FROM queries WHERE query_set_id = ? ORDER BY ordinal ASC')
    .all(setId)
    .map(mapQuery);
  return { set: mapQuerySet(row), queries };
}

export function getQuerySetOrThrow(
  db: DatabaseSync,
  projectId: string,
  setId: string,
): QuerySetDetail {
  const detail = getQuerySet(db, projectId, setId);
  if (detail === null) {
    throw new AppError('NOT_FOUND', 'Query set not found.');
  }
  return detail;
}

export function listQuerySets(db: DatabaseSync, projectId: string): QuerySetDetail[] {
  return db
    .prepare('SELECT * FROM query_sets WHERE project_id = ? ORDER BY created_at DESC, name ASC')
    .all(projectId)
    .map((row) => {
      const set = mapQuerySet(row);
      const queries = db
        .prepare('SELECT * FROM queries WHERE query_set_id = ? ORDER BY ordinal ASC')
        .all(set.id)
        .map(mapQuery);
      return { set, queries };
    });
}

export function createQuerySet(
  db: DatabaseSync,
  projectId: string,
  input: QuerySetInput,
  context: WriteContext,
): QuerySetDetail {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (project === undefined) {
    throw new AppError('NOT_FOUND', 'Project not found.');
  }
  const duplicate = db
    .prepare('SELECT id FROM query_sets WHERE project_id = ? AND name = ?')
    .get(projectId, input.name);
  if (duplicate !== undefined) {
    throw new AppError(
      'CONFLICT',
      'A query set with that name already exists. Create a new version from the approved set instead.',
    );
  }
  const id = newId('qst');
  db.prepare(
    `INSERT INTO query_sets
      (id, project_id, name, version, status, description, locale, approved_by, approved_at,
       approval_note, supersedes_id, created_at, updated_at)
     VALUES (?, ?, ?, 1, 'DRAFT', ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
  ).run(id, projectId, input.name, input.description ?? null, input.locale, context.at, context.at);
  appendAuditEvent(db, {
    projectId,
    actor: context.actor,
    action: 'query_set.created',
    entityType: 'query_set',
    entityId: id,
    details: { name: input.name, version: 1 },
    at: context.at,
  });
  return getQuerySetOrThrow(db, projectId, id);
}

export function addQuery(
  db: DatabaseSync,
  projectId: string,
  setId: string,
  input: QueryDraftInput,
  context: WriteContext,
): QueryRecord {
  return withTransaction(db, () => {
    const set = getSetOrThrow(db, projectId, setId);
    if (set.status !== 'DRAFT') {
      throw new AppError('CONFLICT', 'Approved query sets are immutable.');
    }
    const maxRow = db
      .prepare('SELECT MAX(ordinal) AS max_ordinal FROM queries WHERE query_set_id = ?')
      .get(setId);
    const ordinal =
      (maxRow === undefined || maxRow['max_ordinal'] === null
        ? 0
        : numberValue(maxRow, 'max_ordinal')) + 1;
    const queryId = newId('qry');
    db.prepare(
      `INSERT INTO queries
        (id, query_set_id, ordinal, text, intent, locale, region, branded,
         expected_elements, inclusion_rationale, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      queryId,
      setId,
      ordinal,
      input.text,
      input.intent,
      input.locale ?? null,
      input.region ?? null,
      input.branded ? 1 : 0,
      input.expectedElements,
      input.inclusionRationale,
      context.at,
    );
    db.prepare('UPDATE query_sets SET updated_at = ? WHERE id = ?').run(context.at, setId);
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'query.added',
      entityType: 'query',
      entityId: queryId,
      details: { querySetId: setId, ordinal, intent: input.intent },
      at: context.at,
    });
    const row = db.prepare('SELECT * FROM queries WHERE id = ?').get(queryId);
    if (row === undefined) {
      throw new AppError('INTERNAL_ERROR', 'The query could not be read after creation.');
    }
    return mapQuery(row);
  });
}

export function deleteQuery(
  db: DatabaseSync,
  projectId: string,
  setId: string,
  queryId: string,
  context: WriteContext,
): void {
  withTransaction(db, () => {
    const set = getSetOrThrow(db, projectId, setId);
    if (set.status !== 'DRAFT') {
      throw new AppError('CONFLICT', 'Approved query sets are immutable.');
    }
    const row = db
      .prepare('SELECT id FROM queries WHERE query_set_id = ? AND id = ?')
      .get(setId, queryId);
    if (row === undefined) {
      throw new AppError('NOT_FOUND', 'Query not found.');
    }
    db.prepare('DELETE FROM queries WHERE query_set_id = ? AND id = ?').run(setId, queryId);
    db.prepare('UPDATE query_sets SET updated_at = ? WHERE id = ?').run(context.at, setId);
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'query.removed',
      entityType: 'query',
      entityId: queryId,
      details: { querySetId: setId },
      at: context.at,
    });
  });
}

export function approveQuerySet(
  db: DatabaseSync,
  projectId: string,
  setId: string,
  input: QuerySetApprovalInput,
  context: WriteContext,
): QuerySetDetail {
  return withTransaction(db, () => {
    const set = getSetOrThrow(db, projectId, setId);
    if (set.status === 'APPROVED') {
      throw new AppError('CONFLICT', 'The query set is already approved.');
    }
    const countRow = db
      .prepare('SELECT COUNT(*) AS count FROM queries WHERE query_set_id = ?')
      .get(setId);
    const count = countRow === undefined ? 0 : numberValue(countRow, 'count');
    if (count === 0) {
      throw new AppError('CONFLICT', 'Add at least one query before approving the set.');
    }
    db.prepare(
      `UPDATE query_sets
       SET status = 'APPROVED', approved_by = ?, approved_at = ?, approval_note = ?, updated_at = ?
       WHERE project_id = ? AND id = ?`,
    ).run(input.reviewer, context.at, input.note ?? null, context.at, projectId, setId);
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'query_set.approved',
      entityType: 'query_set',
      entityId: setId,
      details: { version: set.version, reviewer: input.reviewer, queryCount: count },
      at: context.at,
    });
    return getQuerySetOrThrow(db, projectId, setId);
  });
}

export function cloneQuerySetVersion(
  db: DatabaseSync,
  projectId: string,
  setId: string,
  context: WriteContext,
): QuerySetDetail {
  return withTransaction(db, () => {
    const source = getQuerySetOrThrow(db, projectId, setId);
    if (source.set.status !== 'APPROVED') {
      throw new AppError('CONFLICT', 'Only an approved query set can be versioned for retesting.');
    }
    const maxRow = db
      .prepare(
        'SELECT MAX(version) AS max_version FROM query_sets WHERE project_id = ? AND name = ?',
      )
      .get(projectId, source.set.name);
    const version =
      (maxRow === undefined || maxRow['max_version'] === null
        ? 0
        : numberValue(maxRow, 'max_version')) + 1;
    const newSetId = newId('qst');
    db.prepare(
      `INSERT INTO query_sets
        (id, project_id, name, version, status, description, locale, approved_by, approved_at,
         approval_note, supersedes_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'DRAFT', ?, ?, NULL, NULL, NULL, ?, ?, ?)`,
    ).run(
      newSetId,
      projectId,
      source.set.name,
      version,
      source.set.description,
      source.set.locale,
      source.set.id,
      context.at,
      context.at,
    );
    for (const query of source.queries) {
      db.prepare(
        `INSERT INTO queries
          (id, query_set_id, ordinal, text, intent, locale, region, branded,
           expected_elements, inclusion_rationale, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId('qry'),
        newSetId,
        query.ordinal,
        query.text,
        query.intent,
        query.locale,
        query.region,
        query.branded ? 1 : 0,
        query.expectedElements,
        query.inclusionRationale,
        context.at,
      );
    }
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'query_set.version_cloned',
      entityType: 'query_set',
      entityId: newSetId,
      details: { sourceId: source.set.id, version, queryCount: source.queries.length },
      at: context.at,
    });
    return getQuerySetOrThrow(db, projectId, newSetId);
  });
}
