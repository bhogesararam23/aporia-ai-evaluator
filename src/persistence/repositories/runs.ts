import type { DatabaseSync } from 'node:sqlite';
import type {
  CitationDraftInput,
  ObservationAssessmentDraftInput,
  ObservationDraftInput,
  ReasonInput,
  RunInput,
} from '../../core/inputs.ts';
import type {
  AssessmentDimension,
  AttributionRole,
  CitationCaptureState,
  GroundingMode,
  ObservationStatus,
  QueryIntent,
  RunStatus,
} from '../../core/vocabulary.ts';
import { AppError } from '../../errors.ts';
import { appendAuditEvent } from '../audit.ts';
import { withTransaction } from '../db.ts';
import { newId } from '../ids.ts';
import {
  booleanValue,
  jsonValue,
  numberValue,
  nullableStringValue,
  stringValue,
  type Row,
} from '../rows.ts';
import type { WriteContext } from './context.ts';
import { getQuerySetOrThrow, type QuerySetDetail } from './querySets.ts';

export interface RunRecord {
  readonly id: string;
  readonly projectId: string;
  readonly querySetId: string;
  readonly querySetName: string;
  readonly querySetVersion: number;
  readonly name: string;
  readonly providerLabel: string;
  readonly modelLabel: string | null;
  readonly interfaceLabel: string;
  readonly groundingMode: GroundingMode;
  readonly locale: string;
  readonly region: string | null;
  readonly captureFrom: string;
  readonly captureTo: string;
  readonly conditions: string;
  readonly notes: string | null;
  readonly status: RunStatus;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly finalizedAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelReason: string | null;
}

export interface CitationRecord {
  readonly id: string;
  readonly observationId: string;
  readonly position: number;
  readonly url: string;
  readonly title: string | null;
  readonly snippet: string | null;
  readonly targetOwned: boolean;
  readonly voidedAt: string | null;
  readonly voidReason: string | null;
  readonly createdAt: string;
}

export interface ObservationAssessmentRecord {
  readonly id: string;
  readonly projectId: string;
  readonly observationId: string;
  readonly dimension: AssessmentDimension;
  readonly version: number;
  readonly label: string;
  readonly rationale: string;
  readonly reviewer: string;
  readonly attributionRole: AttributionRole | null;
  readonly details: Record<string, unknown>;
  readonly createdAt: string;
}

export interface ObservationRecord {
  readonly id: string;
  readonly runId: string;
  readonly queryId: string;
  readonly queryOrdinal: number;
  readonly queryTextSnapshot: string;
  readonly queryIntentSnapshot: QueryIntent;
  readonly status: ObservationStatus;
  readonly capturedAt: string;
  readonly answerText: string | null;
  readonly errorNote: string | null;
  readonly citationCapture: CitationCaptureState;
  readonly contextNotes: string | null;
  readonly voidedAt: string | null;
  readonly voidReason: string | null;
  readonly createdAt: string;
  readonly citations: readonly CitationRecord[];
  readonly assessments: readonly ObservationAssessmentRecord[];
}

export interface RunDetail {
  readonly run: RunRecord;
  readonly querySet: QuerySetDetail;
  readonly observations: readonly ObservationRecord[];
}

export interface RunSummary {
  readonly id: string;
  readonly name: string;
  readonly status: RunStatus;
  readonly providerLabel: string;
  readonly modelLabel: string | null;
  readonly querySetName: string;
  readonly querySetVersion: number;
  readonly observationCount: number;
  readonly createdAt: string;
  readonly finalizedAt: string | null;
}

function mapRun(row: Row): RunRecord {
  return {
    id: stringValue(row, 'id'),
    projectId: stringValue(row, 'project_id'),
    querySetId: stringValue(row, 'query_set_id'),
    querySetName: stringValue(row, 'query_set_name'),
    querySetVersion: numberValue(row, 'query_set_version'),
    name: stringValue(row, 'name'),
    providerLabel: stringValue(row, 'provider_label'),
    modelLabel: nullableStringValue(row, 'model_label'),
    interfaceLabel: stringValue(row, 'interface_label'),
    groundingMode: stringValue(row, 'grounding_mode') as GroundingMode,
    locale: stringValue(row, 'locale'),
    region: nullableStringValue(row, 'region'),
    captureFrom: stringValue(row, 'capture_from'),
    captureTo: stringValue(row, 'capture_to'),
    conditions: stringValue(row, 'conditions'),
    notes: nullableStringValue(row, 'notes'),
    status: stringValue(row, 'status') as RunStatus,
    createdBy: stringValue(row, 'created_by'),
    createdAt: stringValue(row, 'created_at'),
    finalizedAt: nullableStringValue(row, 'finalized_at'),
    cancelledAt: nullableStringValue(row, 'cancelled_at'),
    cancelReason: nullableStringValue(row, 'cancel_reason'),
  };
}

function mapCitation(row: Row): CitationRecord {
  return {
    id: stringValue(row, 'id'),
    observationId: stringValue(row, 'observation_id'),
    position: numberValue(row, 'position'),
    url: stringValue(row, 'url'),
    title: nullableStringValue(row, 'title'),
    snippet: nullableStringValue(row, 'snippet'),
    targetOwned: booleanValue(row, 'target_owned'),
    voidedAt: nullableStringValue(row, 'voided_at'),
    voidReason: nullableStringValue(row, 'void_reason'),
    createdAt: stringValue(row, 'created_at'),
  };
}

function mapAssessment(row: Row): ObservationAssessmentRecord {
  return {
    id: stringValue(row, 'id'),
    projectId: stringValue(row, 'project_id'),
    observationId: stringValue(row, 'observation_id'),
    dimension: stringValue(row, 'dimension') as AssessmentDimension,
    version: numberValue(row, 'version'),
    label: stringValue(row, 'label'),
    rationale: stringValue(row, 'rationale'),
    reviewer: stringValue(row, 'reviewer'),
    attributionRole: nullableStringValue(row, 'attribution_role') as AttributionRole | null,
    details: jsonValue<Record<string, unknown>>(row, 'details_json'),
    createdAt: stringValue(row, 'created_at'),
  };
}

function mapObservation(
  row: Row,
  citations: CitationRecord[],
  assessments: ObservationAssessmentRecord[],
): ObservationRecord {
  return {
    id: stringValue(row, 'id'),
    runId: stringValue(row, 'run_id'),
    queryId: stringValue(row, 'query_id'),
    queryOrdinal: numberValue(row, 'query_ordinal'),
    queryTextSnapshot: stringValue(row, 'query_text_snapshot'),
    queryIntentSnapshot: stringValue(row, 'query_intent_snapshot') as QueryIntent,
    status: stringValue(row, 'status') as ObservationStatus,
    capturedAt: stringValue(row, 'captured_at'),
    answerText: nullableStringValue(row, 'answer_text'),
    errorNote: nullableStringValue(row, 'error_note'),
    citationCapture: stringValue(row, 'citation_capture') as CitationCaptureState,
    contextNotes: nullableStringValue(row, 'context_notes'),
    voidedAt: nullableStringValue(row, 'voided_at'),
    voidReason: nullableStringValue(row, 'void_reason'),
    createdAt: stringValue(row, 'created_at'),
    citations,
    assessments,
  };
}

function runRow(db: DatabaseSync, projectId: string, runId: string): Row | undefined {
  return db.prepare('SELECT * FROM runs WHERE project_id = ? AND id = ?').get(projectId, runId);
}

function getRunOrThrowRow(db: DatabaseSync, projectId: string, runId: string): RunRecord {
  const row = runRow(db, projectId, runId);
  if (row === undefined) {
    throw new AppError('NOT_FOUND', 'Evaluation run not found.');
  }
  return mapRun(row);
}

function requireOpen(run: RunRecord): void {
  if (run.status !== 'OPEN') {
    throw new AppError('CONFLICT', `The run is ${run.status.toLowerCase()} and cannot be changed.`);
  }
}

export function createRun(
  db: DatabaseSync,
  projectId: string,
  querySetId: string,
  input: RunInput,
  context: WriteContext,
): RunDetail {
  return withTransaction(db, () => {
    const querySet = getQuerySetOrThrow(db, projectId, querySetId);
    if (querySet.set.status !== 'APPROVED') {
      throw new AppError('CONFLICT', 'Runs require an approved query set.');
    }
    const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
    if (project === undefined) {
      throw new AppError('NOT_FOUND', 'Project not found.');
    }
    const id = newId('run');
    db.prepare(
      `INSERT INTO runs
        (id, project_id, query_set_id, query_set_name, query_set_version, name,
         provider_label, model_label, interface_label, grounding_mode, locale, region,
         capture_from, capture_to, conditions, notes, status, created_by, created_at,
         finalized_at, cancelled_at, cancel_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, NULL, NULL, NULL)`,
    ).run(
      id,
      projectId,
      querySetId,
      querySet.set.name,
      querySet.set.version,
      input.name,
      input.providerLabel,
      input.modelLabel ?? null,
      input.interfaceLabel,
      input.groundingMode,
      input.locale,
      input.region ?? null,
      input.captureFrom,
      input.captureTo,
      input.conditions,
      input.notes ?? null,
      context.actor,
      context.at,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'run.created',
      entityType: 'run',
      entityId: id,
      details: {
        querySetId,
        querySetVersion: querySet.set.version,
        providerLabel: input.providerLabel,
        groundingMode: input.groundingMode,
      },
      at: context.at,
    });
    return getRunOrThrow(db, projectId, id);
  });
}

export function listRuns(db: DatabaseSync, projectId: string): RunSummary[] {
  return db
    .prepare(
      `SELECT r.id, r.name, r.status, r.provider_label, r.model_label, r.query_set_name,
         r.query_set_version, r.created_at, r.finalized_at,
         (SELECT COUNT(*) FROM observations o WHERE o.run_id = r.id) AS observation_count
       FROM runs r
       WHERE r.project_id = ?
       ORDER BY r.rowid DESC`,
    )
    .all(projectId)
    .map((row) => ({
      id: stringValue(row, 'id'),
      name: stringValue(row, 'name'),
      status: stringValue(row, 'status') as RunStatus,
      providerLabel: stringValue(row, 'provider_label'),
      modelLabel: nullableStringValue(row, 'model_label'),
      querySetName: stringValue(row, 'query_set_name'),
      querySetVersion: numberValue(row, 'query_set_version'),
      observationCount: numberValue(row, 'observation_count'),
      createdAt: stringValue(row, 'created_at'),
      finalizedAt: nullableStringValue(row, 'finalized_at'),
    }));
}

export function getRun(db: DatabaseSync, projectId: string, runId: string): RunDetail | null {
  const row = runRow(db, projectId, runId);
  if (row === undefined) {
    return null;
  }
  const run = mapRun(row);
  const querySet = getQuerySetOrThrow(db, projectId, run.querySetId);
  const observations = db
    .prepare(
      `SELECT * FROM observations
       WHERE run_id = ?
       ORDER BY captured_at ASC, rowid ASC`,
    )
    .all(runId)
    .map((observationRow) => {
      const observationId = stringValue(observationRow, 'id');
      const citations = db
        .prepare('SELECT * FROM citations WHERE observation_id = ? ORDER BY position ASC')
        .all(observationId)
        .map(mapCitation);
      const assessments = db
        .prepare(
          `SELECT * FROM observation_assessments
           WHERE observation_id = ?
           ORDER BY dimension ASC, version ASC`,
        )
        .all(observationId)
        .map(mapAssessment);
      return mapObservation(observationRow, citations, assessments);
    });
  return { run, querySet, observations };
}

export function getRunOrThrow(db: DatabaseSync, projectId: string, runId: string): RunDetail {
  const run = getRun(db, projectId, runId);
  if (run === null) {
    throw new AppError('NOT_FOUND', 'Evaluation run not found.');
  }
  return run;
}

export function addObservation(
  db: DatabaseSync,
  projectId: string,
  runId: string,
  input: ObservationDraftInput,
  context: WriteContext,
): ObservationRecord {
  return withTransaction(db, () => {
    const run = getRunOrThrowRow(db, projectId, runId);
    requireOpen(run);
    const query = db
      .prepare(`SELECT q.* FROM queries q WHERE q.id = ? AND q.query_set_id = ?`)
      .get(input.queryId, run.querySetId) as Row | undefined;
    if (query === undefined) {
      throw new AppError('NOT_FOUND', 'Query not found in the run query set.');
    }
    const id = newId('obs');
    db.prepare(
      `INSERT INTO observations
        (id, run_id, query_id, query_ordinal, query_text_snapshot, query_intent_snapshot,
         status, captured_at, answer_text, error_note, citation_capture, context_notes,
         voided_at, void_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    ).run(
      id,
      runId,
      input.queryId,
      numberValue(query, 'ordinal'),
      stringValue(query, 'text'),
      stringValue(query, 'intent'),
      input.status,
      input.capturedAt,
      input.answerText ?? null,
      input.errorNote ?? null,
      input.citationCapture,
      input.contextNotes ?? null,
      context.at,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'observation.created',
      entityType: 'observation',
      entityId: id,
      details: {
        runId,
        queryId: input.queryId,
        status: input.status,
        citationCapture: input.citationCapture,
      },
      at: context.at,
    });
    return getObservationOrThrow(db, projectId, runId, id);
  });
}

function observationRow(
  db: DatabaseSync,
  projectId: string,
  runId: string,
  observationId: string,
): Row | undefined {
  return db
    .prepare(
      `SELECT o.* FROM observations o
       JOIN runs r ON r.id = o.run_id
       WHERE o.id = ? AND o.run_id = ? AND r.project_id = ?`,
    )
    .get(observationId, runId, projectId);
}

function getObservationOrThrow(
  db: DatabaseSync,
  projectId: string,
  runId: string,
  observationId: string,
): ObservationRecord {
  const row = observationRow(db, projectId, runId, observationId);
  if (row === undefined) {
    throw new AppError('NOT_FOUND', 'Observation not found.');
  }
  const citations = db
    .prepare('SELECT * FROM citations WHERE observation_id = ? ORDER BY position ASC')
    .all(observationId)
    .map(mapCitation);
  const assessments = db
    .prepare(
      `SELECT * FROM observation_assessments
       WHERE observation_id = ?
       ORDER BY dimension ASC, version ASC`,
    )
    .all(observationId)
    .map(mapAssessment);
  return mapObservation(row, citations, assessments);
}

export function addCitation(
  db: DatabaseSync,
  projectId: string,
  runId: string,
  observationId: string,
  input: CitationDraftInput,
  context: WriteContext,
): CitationRecord {
  return withTransaction(db, () => {
    const run = getRunOrThrowRow(db, projectId, runId);
    requireOpen(run);
    const observation = observationRow(db, projectId, runId, observationId);
    if (observation === undefined) {
      throw new AppError('NOT_FOUND', 'Observation not found.');
    }
    if (observation['voided_at'] !== null) {
      throw new AppError('CONFLICT', 'Citations cannot be added to a voided observation.');
    }
    const maxRow = db
      .prepare('SELECT MAX(position) AS max_position FROM citations WHERE observation_id = ?')
      .get(observationId);
    const position =
      (maxRow === undefined || maxRow['max_position'] === null
        ? 0
        : numberValue(maxRow, 'max_position')) + 1;
    const id = newId('cit');
    db.prepare(
      `INSERT INTO citations
        (id, observation_id, position, url, title, snippet, target_owned, voided_at,
         void_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    ).run(
      id,
      observationId,
      position,
      input.url,
      input.title ?? null,
      input.snippet ?? null,
      input.targetOwned ? 1 : 0,
      context.at,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'citation.created',
      entityType: 'citation',
      entityId: id,
      details: { runId, observationId, position, targetOwned: input.targetOwned },
      at: context.at,
    });
    const row = db.prepare('SELECT * FROM citations WHERE id = ?').get(id);
    if (row === undefined) {
      throw new AppError('INTERNAL_ERROR', 'The citation could not be read after creation.');
    }
    return mapCitation(row);
  });
}

export function voidObservation(
  db: DatabaseSync,
  projectId: string,
  runId: string,
  observationId: string,
  input: ReasonInput,
  context: WriteContext,
): ObservationRecord {
  return withTransaction(db, () => {
    const run = getRunOrThrowRow(db, projectId, runId);
    requireOpen(run);
    const observation = getObservationOrThrow(db, projectId, runId, observationId);
    if (observation.voidedAt !== null) {
      throw new AppError('CONFLICT', 'That observation has already been voided.');
    }
    db.prepare(
      'UPDATE observations SET voided_at = ?, void_reason = ? WHERE id = ? AND run_id = ?',
    ).run(context.at, input.reason, observationId, runId);
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'observation.voided',
      entityType: 'observation',
      entityId: observationId,
      details: { runId, reason: input.reason, reviewer: input.reviewer },
      at: context.at,
    });
    return getObservationOrThrow(db, projectId, runId, observationId);
  });
}

export function voidCitation(
  db: DatabaseSync,
  projectId: string,
  runId: string,
  observationId: string,
  citationId: string,
  input: ReasonInput,
  context: WriteContext,
): CitationRecord {
  return withTransaction(db, () => {
    const run = getRunOrThrowRow(db, projectId, runId);
    requireOpen(run);
    const observation = observationRow(db, projectId, runId, observationId);
    if (observation === undefined) {
      throw new AppError('NOT_FOUND', 'Observation not found.');
    }
    const row = db
      .prepare('SELECT * FROM citations WHERE observation_id = ? AND id = ?')
      .get(observationId, citationId);
    if (row === undefined) {
      throw new AppError('NOT_FOUND', 'Citation not found.');
    }
    const citation = mapCitation(row);
    if (citation.voidedAt !== null) {
      throw new AppError('CONFLICT', 'That citation has already been voided.');
    }
    db.prepare(
      'UPDATE citations SET voided_at = ?, void_reason = ? WHERE id = ? AND observation_id = ?',
    ).run(context.at, input.reason, citationId, observationId);
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'citation.voided',
      entityType: 'citation',
      entityId: citationId,
      details: { runId, observationId, reason: input.reason, reviewer: input.reviewer },
      at: context.at,
    });
    const updated = db.prepare('SELECT * FROM citations WHERE id = ?').get(citationId);
    if (updated === undefined) {
      throw new AppError('INTERNAL_ERROR', 'The citation could not be read after update.');
    }
    return mapCitation(updated);
  });
}

export function recordObservationAssessment(
  db: DatabaseSync,
  projectId: string,
  runId: string,
  observationId: string,
  input: ObservationAssessmentDraftInput,
  context: WriteContext,
): ObservationAssessmentRecord {
  return withTransaction(db, () => {
    const run = getRunOrThrowRow(db, projectId, runId);
    requireOpen(run);
    const observation = observationRow(db, projectId, runId, observationId);
    if (observation === undefined) {
      throw new AppError('NOT_FOUND', 'Observation not found.');
    }
    if (stringValue(observation, 'status') !== 'COMPLETED') {
      throw new AppError(
        'CONFLICT',
        'Answer-level assessments require a completed answer. Errors, refusals, and abstentions are reported as coverage states.',
      );
    }
    const maxRow = db
      .prepare(
        `SELECT MAX(version) AS max_version FROM observation_assessments
         WHERE observation_id = ? AND dimension = ?`,
      )
      .get(observationId, input.dimension);
    const version =
      (maxRow === undefined || maxRow['max_version'] === null
        ? 0
        : numberValue(maxRow, 'max_version')) + 1;
    const id = newId('oasm');
    db.prepare(
      `INSERT INTO observation_assessments
        (id, project_id, observation_id, dimension, version, label, rationale, reviewer,
         attribution_role, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      projectId,
      observationId,
      input.dimension,
      version,
      input.label,
      input.rationale,
      input.reviewer,
      input.attributionRole ?? null,
      JSON.stringify(
        input.attributionRole === undefined ? {} : { attributionRole: input.attributionRole },
      ),
      context.at,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'observation.assessment_recorded',
      entityType: 'observation',
      entityId: observationId,
      details: { runId, dimension: input.dimension, version, label: input.label },
      at: context.at,
    });
    const row = db.prepare('SELECT * FROM observation_assessments WHERE id = ?').get(id);
    if (row === undefined) {
      throw new AppError('INTERNAL_ERROR', 'The assessment could not be read after creation.');
    }
    return mapAssessment(row);
  });
}

export function finalizeRun(
  db: DatabaseSync,
  projectId: string,
  runId: string,
  context: WriteContext,
): RunRecord {
  return withTransaction(db, () => {
    const run = getRunOrThrowRow(db, projectId, runId);
    requireOpen(run);
    const countRow = db
      .prepare('SELECT COUNT(*) AS count FROM observations WHERE run_id = ? AND voided_at IS NULL')
      .get(runId);
    const count = countRow === undefined ? 0 : numberValue(countRow, 'count');
    if (count === 0) {
      throw new AppError('CONFLICT', 'Add at least one observation before finalizing the run.');
    }
    db.prepare('UPDATE runs SET status = ?, finalized_at = ? WHERE id = ?').run(
      'FINALIZED',
      context.at,
      runId,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'run.finalized',
      entityType: 'run',
      entityId: runId,
      details: { observationCount: count },
      at: context.at,
    });
    return getRunOrThrowRow(db, projectId, runId);
  });
}

export function cancelRun(
  db: DatabaseSync,
  projectId: string,
  runId: string,
  input: ReasonInput,
  context: WriteContext,
): RunRecord {
  return withTransaction(db, () => {
    const run = getRunOrThrowRow(db, projectId, runId);
    requireOpen(run);
    db.prepare('UPDATE runs SET status = ?, cancelled_at = ?, cancel_reason = ? WHERE id = ?').run(
      'CANCELLED',
      context.at,
      input.reason,
      runId,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'run.cancelled',
      entityType: 'run',
      entityId: runId,
      details: { reason: input.reason, reviewer: input.reviewer },
      at: context.at,
    });
    return getRunOrThrowRow(db, projectId, runId);
  });
}
