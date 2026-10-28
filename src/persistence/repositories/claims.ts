import type { DatabaseSync } from 'node:sqlite';
import type { ClaimRevisionInput, PropositionInput } from '../../core/inputs.ts';
import {
  canAddProposition,
  canTransitionClaim,
  claimStatusAfterPropositionAdded,
} from '../../core/lifecycle.ts';
import { DECOMPOSITION_VERSION } from '../../core/versions.ts';
import type { ClaimStatus } from '../../core/vocabulary.ts';
import { AppError } from '../../errors.ts';
import { appendAuditEvent } from '../audit.ts';
import { withTransaction } from '../db.ts';
import { newId } from '../ids.ts';
import { numberValue, nullableStringValue, stringValue, type Row } from '../rows.ts';
import type { WriteContext } from './context.ts';

export interface ClaimRevisionRecord {
  readonly id: string;
  readonly claimId: string;
  readonly revisionNumber: number;
  readonly text: string;
  readonly sourceUrl: string | null;
  readonly intendedMeaning: string | null;
  readonly timeScope: string | null;
  readonly locale: string;
  readonly decompositionVersion: string;
  readonly note: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface PropositionRecord {
  readonly id: string;
  readonly claimRevisionId: string;
  readonly ordinal: number;
  readonly text: string;
  readonly subject: string | null;
  readonly predicate: string | null;
  readonly objectValue: string | null;
  readonly conditions: string | null;
  readonly timeInterval: string | null;
  readonly units: string | null;
  readonly evidenceRequirements: string;
  readonly expectedAnswerCriterion: string | null;
  readonly ambiguityNotes: string | null;
  readonly decompositionVersion: string;
  readonly createdAt: string;
}

export interface ClaimRecord {
  readonly id: string;
  readonly projectId: string;
  readonly status: ClaimStatus;
  readonly currentRevisionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClaimDetail {
  readonly claim: ClaimRecord;
  readonly currentRevision: ClaimRevisionRecord | null;
  readonly revisions: readonly ClaimRevisionRecord[];
  readonly propositions: readonly PropositionRecord[];
}

export interface ClaimSummary {
  readonly id: string;
  readonly status: ClaimStatus;
  readonly currentRevisionNumber: number | null;
  readonly currentText: string | null;
  readonly propositionCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function mapClaim(row: Row): ClaimRecord {
  return {
    id: stringValue(row, 'id'),
    projectId: stringValue(row, 'project_id'),
    status: stringValue(row, 'status') as ClaimStatus,
    currentRevisionId: nullableStringValue(row, 'current_revision_id'),
    createdAt: stringValue(row, 'created_at'),
    updatedAt: stringValue(row, 'updated_at'),
  };
}

function mapRevision(row: Row): ClaimRevisionRecord {
  return {
    id: stringValue(row, 'id'),
    claimId: stringValue(row, 'claim_id'),
    revisionNumber: numberValue(row, 'revision_number'),
    text: stringValue(row, 'text'),
    sourceUrl: nullableStringValue(row, 'source_url'),
    intendedMeaning: nullableStringValue(row, 'intended_meaning'),
    timeScope: nullableStringValue(row, 'time_scope'),
    locale: stringValue(row, 'locale'),
    decompositionVersion: stringValue(row, 'decomposition_version'),
    note: nullableStringValue(row, 'note'),
    createdBy: stringValue(row, 'created_by'),
    createdAt: stringValue(row, 'created_at'),
  };
}

function mapProposition(row: Row): PropositionRecord {
  return {
    id: stringValue(row, 'id'),
    claimRevisionId: stringValue(row, 'claim_revision_id'),
    ordinal: numberValue(row, 'ordinal'),
    text: stringValue(row, 'text'),
    subject: nullableStringValue(row, 'subject'),
    predicate: nullableStringValue(row, 'predicate'),
    objectValue: nullableStringValue(row, 'object_value'),
    conditions: nullableStringValue(row, 'conditions'),
    timeInterval: nullableStringValue(row, 'time_interval'),
    units: nullableStringValue(row, 'units'),
    evidenceRequirements: stringValue(row, 'evidence_requirements'),
    expectedAnswerCriterion: nullableStringValue(row, 'expected_answer_criterion'),
    ambiguityNotes: nullableStringValue(row, 'ambiguity_notes'),
    decompositionVersion: stringValue(row, 'decomposition_version'),
    createdAt: stringValue(row, 'created_at'),
  };
}

function claimRow(db: DatabaseSync, projectId: string, claimId: string): Row | undefined {
  return db.prepare('SELECT * FROM claims WHERE project_id = ? AND id = ?').get(projectId, claimId);
}

function claimOrThrow(db: DatabaseSync, projectId: string, claimId: string): ClaimRecord {
  const row = claimRow(db, projectId, claimId);
  if (row === undefined) {
    throw new AppError('NOT_FOUND', 'Claim not found.');
  }
  return mapClaim(row);
}

function revisionRow(db: DatabaseSync, revisionId: string): Row | undefined {
  return db.prepare('SELECT * FROM claim_revisions WHERE id = ?').get(revisionId);
}

export function getClaim(db: DatabaseSync, projectId: string, claimId: string): ClaimDetail | null {
  const row = claimRow(db, projectId, claimId);
  if (row === undefined) {
    return null;
  }
  const claim = mapClaim(row);
  const revisions = db
    .prepare('SELECT * FROM claim_revisions WHERE claim_id = ? ORDER BY revision_number ASC')
    .all(claim.id)
    .map(mapRevision);
  const currentRevision =
    claim.currentRevisionId === null
      ? null
      : (revisions.find((revision) => revision.id === claim.currentRevisionId) ?? null);
  const propositions =
    currentRevision === null
      ? []
      : db
          .prepare('SELECT * FROM propositions WHERE claim_revision_id = ? ORDER BY ordinal ASC')
          .all(currentRevision.id)
          .map(mapProposition);
  return { claim, currentRevision, revisions, propositions };
}

export function getClaimOrThrow(db: DatabaseSync, projectId: string, claimId: string): ClaimDetail {
  const claim = getClaim(db, projectId, claimId);
  if (claim === null) {
    throw new AppError('NOT_FOUND', 'Claim not found.');
  }
  return claim;
}

export function listClaims(db: DatabaseSync, projectId: string): ClaimSummary[] {
  return db
    .prepare(
      `SELECT c.id, c.status, c.created_at, c.updated_at,
         r.revision_number, r.text,
         (SELECT COUNT(*) FROM propositions p WHERE p.claim_revision_id = c.current_revision_id)
           AS proposition_count
       FROM claims c
       LEFT JOIN claim_revisions r ON r.id = c.current_revision_id
       WHERE c.project_id = ?
       ORDER BY c.updated_at DESC, c.created_at DESC`,
    )
    .all(projectId)
    .map((row) => ({
      id: stringValue(row, 'id'),
      status: stringValue(row, 'status') as ClaimStatus,
      currentRevisionNumber:
        row['revision_number'] === null ? null : numberValue(row, 'revision_number'),
      currentText: nullableStringValue(row, 'text'),
      propositionCount: numberValue(row, 'proposition_count'),
      createdAt: stringValue(row, 'created_at'),
      updatedAt: stringValue(row, 'updated_at'),
    }));
}

function insertRevision(
  db: DatabaseSync,
  claimId: string,
  revisionNumber: number,
  input: ClaimRevisionInput,
  context: WriteContext,
): string {
  const revisionId = newId('rev');
  db.prepare(
    `INSERT INTO claim_revisions
      (id, claim_id, revision_number, text, source_url, intended_meaning, time_scope,
       locale, decomposition_version, note, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).run(
    revisionId,
    claimId,
    revisionNumber,
    input.text,
    input.sourceUrl ?? null,
    input.intendedMeaning ?? null,
    input.timeScope ?? null,
    input.locale,
    DECOMPOSITION_VERSION,
    context.actor,
    context.at,
  );
  return revisionId;
}

export function createClaim(
  db: DatabaseSync,
  projectId: string,
  input: ClaimRevisionInput,
  context: WriteContext,
): ClaimDetail {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (project === undefined) {
    throw new AppError('NOT_FOUND', 'Project not found.');
  }
  const claimId = newId('clm');
  withTransaction(db, () => {
    db.prepare(
      `INSERT INTO claims (id, project_id, status, current_revision_id, created_at, updated_at)
       VALUES (?, ?, 'SUBMITTED', NULL, ?, ?)`,
    ).run(claimId, projectId, context.at, context.at);
    const revisionId = insertRevision(db, claimId, 1, input, context);
    db.prepare('UPDATE claims SET current_revision_id = ? WHERE id = ?').run(revisionId, claimId);
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'claim.created',
      entityType: 'claim',
      entityId: claimId,
      details: { revisionNumber: 1, locale: input.locale },
      at: context.at,
    });
  });
  return getClaimOrThrow(db, projectId, claimId);
}

export function addClaimRevision(
  db: DatabaseSync,
  projectId: string,
  claimId: string,
  input: ClaimRevisionInput,
  context: WriteContext,
): ClaimDetail {
  claimOrThrow(db, projectId, claimId);
  withTransaction(db, () => {
    const maxRow = db
      .prepare('SELECT MAX(revision_number) AS max_number FROM claim_revisions WHERE claim_id = ?')
      .get(claimId);
    const maxNumber =
      maxRow === undefined || maxRow['max_number'] === null ? 0 : numberValue(maxRow, 'max_number');
    const revisionNumber = maxNumber + 1;
    const revisionId = insertRevision(db, claimId, revisionNumber, input, context);
    db.prepare(
      `UPDATE claims
       SET current_revision_id = ?, status = 'SUBMITTED', updated_at = ?
       WHERE project_id = ? AND id = ?`,
    ).run(revisionId, context.at, projectId, claimId);
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'claim.revision_created',
      entityType: 'claim',
      entityId: claimId,
      details: { revisionNumber },
      at: context.at,
    });
  });
  return getClaimOrThrow(db, projectId, claimId);
}

export function addProposition(
  db: DatabaseSync,
  projectId: string,
  claimId: string,
  input: PropositionInput,
  context: WriteContext,
): PropositionRecord {
  return withTransaction(db, () => {
    const claim = claimOrThrow(db, projectId, claimId);
    if (!canAddProposition(claim.status)) {
      throw new AppError(
        'CONFLICT',
        'Propositions cannot be added after review has started. Create a new claim revision instead.',
      );
    }
    if (claim.currentRevisionId === null) {
      throw new AppError('CONFLICT', 'The claim has no current revision.');
    }
    const maxRow = db
      .prepare('SELECT MAX(ordinal) AS max_ordinal FROM propositions WHERE claim_revision_id = ?')
      .get(claim.currentRevisionId);
    const maxOrdinal =
      maxRow === undefined || maxRow['max_ordinal'] === null
        ? 0
        : numberValue(maxRow, 'max_ordinal');
    const propositionId = newId('prp');
    db.prepare(
      `INSERT INTO propositions
        (id, claim_revision_id, ordinal, text, subject, predicate, object_value, conditions,
         time_interval, units, evidence_requirements, expected_answer_criterion,
         ambiguity_notes, decomposition_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      propositionId,
      claim.currentRevisionId,
      maxOrdinal + 1,
      input.text,
      input.subject ?? null,
      input.predicate ?? null,
      input.objectValue ?? null,
      input.conditions ?? null,
      input.timeInterval ?? null,
      input.units ?? null,
      input.evidenceRequirements,
      input.expectedAnswerCriterion ?? null,
      input.ambiguityNotes ?? null,
      DECOMPOSITION_VERSION,
      context.at,
    );
    if (claim.status === 'SUBMITTED') {
      db.prepare('UPDATE claims SET status = ?, updated_at = ? WHERE id = ?').run(
        claimStatusAfterPropositionAdded(claim.status),
        context.at,
        claimId,
      );
    } else {
      db.prepare('UPDATE claims SET updated_at = ? WHERE id = ?').run(context.at, claimId);
    }
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'claim.proposition_added',
      entityType: 'claim',
      entityId: claimId,
      details: { propositionId, ordinal: maxOrdinal + 1 },
      at: context.at,
    });
    const row = db.prepare('SELECT * FROM propositions WHERE id = ?').get(propositionId);
    if (row === undefined) {
      throw new AppError('INTERNAL_ERROR', 'The proposition could not be read after creation.');
    }
    return mapProposition(row);
  });
}

export function transitionClaim(
  db: DatabaseSync,
  projectId: string,
  claimId: string,
  toStatus: ClaimStatus,
  context: WriteContext,
  reason?: string,
): ClaimRecord {
  return withTransaction(db, () => {
    const claim = claimOrThrow(db, projectId, claimId);
    if (claim.status === toStatus) {
      throw new AppError('CONFLICT', `The claim is already ${toStatus.toLowerCase()}.`);
    }
    if (!canTransitionClaim(claim.status, toStatus)) {
      throw new AppError('CONFLICT', `The claim cannot move from ${claim.status} to ${toStatus}.`);
    }
    if (toStatus === 'DISPUTED' && (reason === undefined || reason.trim().length < 3)) {
      throw new AppError('INVALID_INPUT', 'A dispute reason is required.');
    }
    db.prepare('UPDATE claims SET status = ?, updated_at = ? WHERE project_id = ? AND id = ?').run(
      toStatus,
      context.at,
      projectId,
      claimId,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'claim.status_changed',
      entityType: 'claim',
      entityId: claimId,
      details: { from: claim.status, to: toStatus, ...(reason === undefined ? {} : { reason }) },
      at: context.at,
    });
    const row = db.prepare('SELECT * FROM claims WHERE id = ?').get(claimId);
    if (row === undefined) {
      throw new AppError('INTERNAL_ERROR', 'The claim could not be read after update.');
    }
    return mapClaim(row);
  });
}

export function getRevision(
  db: DatabaseSync,
  projectId: string,
  claimId: string,
  revisionId: string,
): ClaimRevisionRecord | null {
  const claim = claimRow(db, projectId, claimId);
  if (claim === undefined) {
    return null;
  }
  const row = revisionRow(db, revisionId);
  if (row === undefined) {
    return null;
  }
  const revision = mapRevision(row);
  return revision.claimId === claimId ? revision : null;
}
