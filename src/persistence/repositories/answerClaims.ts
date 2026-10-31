import type { DatabaseSync } from 'node:sqlite';
import type {
  AnswerClaimAssessmentInput,
  AnswerClaimDraftInput,
  ClaimCitationLinkInput,
  ClaimPropositionLinkInput,
} from '../../core/answerClaimInputs.ts';
import type {
  AnswerOffsetBasis,
  AnswerStatementKind,
  ClaimAttributionLabel,
  ClaimCitationSupportLabel,
  ClaimDimension,
  ClaimFidelityLabel,
  ClaimPropositionRelation,
  ClaimRelevance,
} from '../../core/answerClaims.ts';
import {
  ANSWER_CLAIM_VERSIONS,
  isClaimAttributionLabel,
  isClaimFidelityLabel,
} from '../../core/answerClaims.ts';
import { AppError } from '../../errors.ts';
import { appendAuditEvent } from '../audit.ts';
import { withTransaction } from '../db.ts';
import { newId } from '../ids.ts';
import {
  booleanValue,
  jsonValue,
  nullableStringValue,
  numberValue,
  stringValue,
  type Row,
} from '../rows.ts';
import type { WriteContext } from './context.ts';

export interface ClaimPropositionLinkRecord {
  readonly id: string;
  readonly claimRevisionId: string;
  readonly propositionId: string;
  readonly relation: ClaimPropositionRelation;
  readonly rationale: string;
  readonly reviewer: string;
  readonly createdAt: string;
  readonly supersededBy: string | null;
  readonly supersededAt: string | null;
}

export interface ClaimCitationLinkRecord {
  readonly id: string;
  readonly claimRevisionId: string;
  readonly citationId: string;
  readonly support: ClaimCitationSupportLabel;
  readonly rationale: string;
  readonly reviewer: string;
  readonly createdAt: string;
  readonly supersededBy: string | null;
  readonly supersededAt: string | null;
}

export interface AnswerClaimRevisionRecord {
  readonly id: string;
  readonly revision: number;
  readonly quoteText: string;
  readonly statementKind: AnswerStatementKind;
  readonly offsetBasis: AnswerOffsetBasis;
  readonly startOffset: number | null;
  readonly endOffset: number | null;
  readonly relevance: ClaimRelevance;
  readonly paraphrase: string | null;
  readonly note: string | null;
  readonly supersedesRevisionId: string | null;
  readonly decompositionVersion: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface AnswerClaimAssessmentRecord {
  readonly id: string;
  readonly claimRevisionId: string;
  readonly dimension: ClaimDimension;
  readonly version: number;
  readonly label: string;
  readonly rationale: string;
  readonly reviewer: string;
  readonly attributionSubject: string | null;
  readonly attributionRole: string | null;
  readonly details: Record<string, unknown>;
  readonly createdAt: string;
}

export interface AnswerClaimRecord {
  readonly id: string;
  readonly projectId: string;
  readonly observationId: string;
  readonly ordinal: number;
  readonly currentRevisionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly voidedAt: string | null;
  readonly voidReason: string | null;
  readonly currentRevision: AnswerClaimRevisionRecord | null;
  readonly revisions: readonly AnswerClaimRevisionRecord[];
  readonly propositionLinks: readonly ClaimPropositionLinkRecord[];
  readonly citationLinks: readonly ClaimCitationLinkRecord[];
  readonly assessments: readonly AnswerClaimAssessmentRecord[];
}

/**
 * Everything one observation's claim-level workspace needs: the untouched captured answer, the
 * statements drawn from it, the propositions and citations available to link, and the project's
 * current claim revisions. The operator should never have to leave this view to finish a review.
 */
export interface AnswerClaimWorkspace {
  readonly observationId: string;
  readonly runId: string;
  readonly runStatus: string;
  readonly queryTextSnapshot: string;
  readonly answerText: string | null;
  readonly citationCapture: string;
  readonly voidedAt: string | null;
  readonly claims: readonly AnswerClaimRecord[];
  readonly citations: readonly {
    readonly id: string;
    readonly position: number;
    readonly url: string;
    readonly title: string | null;
    readonly targetOwned: boolean;
    readonly voided: boolean;
  }[];
  readonly propositions: readonly {
    readonly id: string;
    readonly claimId: string;
    readonly claimCreatedAt: string;
    readonly ordinal: number;
    readonly text: string;
  }[];
}

function mapRevision(row: Row): AnswerClaimRevisionRecord {
  return {
    id: stringValue(row, 'id'),
    revision: numberValue(row, 'revision'),
    quoteText: stringValue(row, 'quote_text'),
    statementKind: stringValue(row, 'statement_kind') as AnswerStatementKind,
    offsetBasis: stringValue(row, 'offset_basis') as AnswerOffsetBasis,
    startOffset: row['start_offset'] === null ? null : numberValue(row, 'start_offset'),
    endOffset: row['end_offset'] === null ? null : numberValue(row, 'end_offset'),
    relevance: stringValue(row, 'relevance') as ClaimRelevance,
    paraphrase: nullableStringValue(row, 'paraphrase'),
    note: nullableStringValue(row, 'note'),
    supersedesRevisionId: nullableStringValue(row, 'supersedes_revision_id'),
    decompositionVersion: stringValue(row, 'decomposition_version'),
    createdBy: stringValue(row, 'created_by'),
    createdAt: stringValue(row, 'created_at'),
  };
}

function mapPropositionLink(row: Row): ClaimPropositionLinkRecord {
  return {
    id: stringValue(row, 'id'),
    claimRevisionId: stringValue(row, 'claim_revision_id'),
    propositionId: stringValue(row, 'proposition_id'),
    relation: stringValue(row, 'relation') as ClaimPropositionRelation,
    rationale: stringValue(row, 'rationale'),
    reviewer: stringValue(row, 'reviewer'),
    createdAt: stringValue(row, 'created_at'),
    supersededBy: nullableStringValue(row, 'superseded_by'),
    supersededAt: nullableStringValue(row, 'superseded_at'),
  };
}

function mapCitationLink(row: Row): ClaimCitationLinkRecord {
  return {
    id: stringValue(row, 'id'),
    claimRevisionId: stringValue(row, 'claim_revision_id'),
    citationId: stringValue(row, 'citation_id'),
    support: stringValue(row, 'support') as ClaimCitationSupportLabel,
    rationale: stringValue(row, 'rationale'),
    reviewer: stringValue(row, 'reviewer'),
    createdAt: stringValue(row, 'created_at'),
    supersededBy: nullableStringValue(row, 'superseded_by'),
    supersededAt: nullableStringValue(row, 'superseded_at'),
  };
}

function mapAssessment(row: Row): AnswerClaimAssessmentRecord {
  return {
    id: stringValue(row, 'id'),
    claimRevisionId: stringValue(row, 'claim_revision_id'),
    dimension: stringValue(row, 'dimension') as ClaimDimension,
    version: numberValue(row, 'version'),
    label: stringValue(row, 'label'),
    rationale: stringValue(row, 'rationale'),
    reviewer: stringValue(row, 'reviewer'),
    attributionSubject: nullableStringValue(row, 'attribution_subject'),
    attributionRole: nullableStringValue(row, 'attribution_role'),
    details: jsonValue<Record<string, unknown>>(row, 'details_json'),
    createdAt: stringValue(row, 'created_at'),
  };
}

function claimRow(db: DatabaseSync, projectId: string, claimId: string): Row | undefined {
  return db
    .prepare('SELECT * FROM answer_claims WHERE project_id = ? AND id = ?')
    .get(projectId, claimId);
}

function revisionsFor(db: DatabaseSync, claimId: string): AnswerClaimRevisionRecord[] {
  return db
    .prepare('SELECT * FROM answer_claim_revisions WHERE claim_id = ? ORDER BY revision ASC')
    .all(claimId)
    .map(mapRevision);
}

function propositionLinksFor(db: DatabaseSync, claimId: string): ClaimPropositionLinkRecord[] {
  return db
    .prepare(
      `SELECT link.* FROM answer_claim_propositions link
       JOIN answer_claim_revisions revision ON revision.id = link.claim_revision_id
       WHERE revision.claim_id = ?
       ORDER BY link.created_at ASC, link.rowid ASC`,
    )
    .all(claimId)
    .map(mapPropositionLink);
}

function citationLinksFor(db: DatabaseSync, claimId: string): ClaimCitationLinkRecord[] {
  return db
    .prepare(
      `SELECT link.* FROM answer_claim_citations link
       JOIN answer_claim_revisions revision ON revision.id = link.claim_revision_id
       WHERE revision.claim_id = ?
       ORDER BY link.created_at ASC, link.rowid ASC`,
    )
    .all(claimId)
    .map(mapCitationLink);
}

function assessmentsFor(db: DatabaseSync, claimId: string): AnswerClaimAssessmentRecord[] {
  return db
    .prepare(
      `SELECT * FROM answer_claim_assessments
       WHERE claim_id = ?
       ORDER BY dimension ASC, version ASC`,
    )
    .all(claimId)
    .map(mapAssessment);
}

function assembleClaim(db: DatabaseSync, row: Row): AnswerClaimRecord {
  const claimId = stringValue(row, 'id');
  const revisions = revisionsFor(db, claimId);
  const currentRevisionId = nullableStringValue(row, 'current_revision_id');
  return {
    id: claimId,
    projectId: stringValue(row, 'project_id'),
    observationId: stringValue(row, 'observation_id'),
    ordinal: numberValue(row, 'ordinal'),
    currentRevisionId,
    createdAt: stringValue(row, 'created_at'),
    updatedAt: stringValue(row, 'updated_at'),
    voidedAt: nullableStringValue(row, 'voided_at'),
    voidReason: nullableStringValue(row, 'void_reason'),
    currentRevision:
      revisions.find((revision) => revision.id === currentRevisionId) ?? revisions.at(-1) ?? null,
    revisions,
    propositionLinks: propositionLinksFor(db, claimId),
    citationLinks: citationLinksFor(db, claimId),
    assessments: assessmentsFor(db, claimId),
  };
}

/**
 * Read the claim rows for one observation in a single pass per table rather than one pass per claim,
 * because a long answer can hold a dozen statements and the workspace page would otherwise issue
 * dozens of identical queries.
 */
function claimsForObservation(db: DatabaseSync, observationId: string): AnswerClaimRecord[] {
  const rows = db
    .prepare('SELECT * FROM answer_claims WHERE observation_id = ? ORDER BY ordinal ASC')
    .all(observationId);
  return rows.map((row) => assembleClaim(db, row));
}

export function getAnswerClaim(
  db: DatabaseSync,
  projectId: string,
  claimId: string,
): AnswerClaimRecord | null {
  const row = claimRow(db, projectId, claimId);
  return row === undefined ? null : assembleClaim(db, row);
}

export function getAnswerClaimOrThrow(
  db: DatabaseSync,
  projectId: string,
  claimId: string,
): AnswerClaimRecord {
  const claim = getAnswerClaim(db, projectId, claimId);
  if (claim === null) {
    throw new AppError('NOT_FOUND', 'Answer claim not found.');
  }
  return claim;
}

/** The propositions available to an operator: every proposition of the project's current revisions. */
function projectPropositions(
  db: DatabaseSync,
  projectId: string,
): AnswerClaimWorkspace['propositions'] {
  return db
    .prepare(
      `SELECT p.id, p.ordinal, p.text, c.id AS claim_id, c.created_at
       FROM propositions p
       JOIN claim_revisions r ON r.id = p.claim_revision_id
       JOIN claims c ON c.id = r.claim_id
       WHERE c.project_id = ? AND c.current_revision_id = r.id
       ORDER BY c.created_at ASC, c.rowid ASC, p.ordinal ASC`,
    )
    .all(projectId)
    .map((row) => ({
      id: stringValue(row, 'id'),
      claimId: stringValue(row, 'claim_id'),
      claimCreatedAt: stringValue(row, 'created_at'),
      ordinal: numberValue(row, 'ordinal'),
      text: stringValue(row, 'text'),
    }));
}

export function getAnswerClaimWorkspace(
  db: DatabaseSync,
  projectId: string,
  observationId: string,
): AnswerClaimWorkspace {
  const row = db
    .prepare(
      `SELECT o.id, o.run_id, o.query_text_snapshot, o.answer_text, o.citation_capture,
         o.voided_at, r.status
       FROM observations o
       JOIN runs r ON r.id = o.run_id
       WHERE o.id = ? AND r.project_id = ?`,
    )
    .get(observationId, projectId);
  if (row === undefined) {
    throw new AppError('NOT_FOUND', 'Observation not found.');
  }
  const citations = db
    .prepare(
      `SELECT id, position, url, title, target_owned, voided_at
       FROM citations
       WHERE observation_id = ?
       ORDER BY position ASC`,
    )
    .all(observationId)
    .map((citationRow) => ({
      id: stringValue(citationRow, 'id'),
      position: numberValue(citationRow, 'position'),
      url: stringValue(citationRow, 'url'),
      title: nullableStringValue(citationRow, 'title'),
      targetOwned: booleanValue(citationRow, 'target_owned'),
      voided: nullableStringValue(citationRow, 'voided_at') !== null,
    }));
  return {
    observationId: stringValue(row, 'id'),
    runId: stringValue(row, 'run_id'),
    runStatus: stringValue(row, 'status'),
    queryTextSnapshot: stringValue(row, 'query_text_snapshot'),
    answerText: nullableStringValue(row, 'answer_text'),
    citationCapture: stringValue(row, 'citation_capture'),
    voidedAt: nullableStringValue(row, 'voided_at'),
    claims: claimsForObservation(db, observationId),
    citations,
    propositions: projectPropositions(db, projectId),
  };
}

function requireWritableRun(db: DatabaseSync, observationId: string): void {
  const row = db
    .prepare(
      `SELECT r.status, o.answer_text, o.voided_at
       FROM observations o
       JOIN runs r ON r.id = o.run_id
       WHERE o.id = ?`,
    )
    .get(observationId) as Row | undefined;
  if (row === undefined) {
    throw new AppError('NOT_FOUND', 'Observation not found.');
  }
  if (stringValue(row, 'status') !== 'OPEN') {
    throw new AppError(
      'CONFLICT',
      'The run is finalized or cancelled, so its answer cannot be re-decomposed. Generate a new report instead.',
    );
  }
  if (nullableStringValue(row, 'answer_text') === null) {
    throw new AppError('CONFLICT', 'This observation holds no captured answer text to quote.');
  }
  if (nullableStringValue(row, 'voided_at') !== null) {
    throw new AppError('CONFLICT', 'The observation was voided, so no statements may be added.');
  }
}

function nextOrdinal(db: DatabaseSync, observationId: string): number {
  const row = db
    .prepare(
      'SELECT COALESCE(MAX(ordinal), 0) AS highest FROM answer_claims WHERE observation_id = ?',
    )
    .get(observationId) as Row;
  return numberValue(row, 'highest') + 1;
}

function insertRevision(
  db: DatabaseSync,
  input: {
    id: string;
    projectId: string;
    claimId: string;
    revision: number;
    draft: AnswerClaimDraftInput;
    supersedesRevisionId: string | null;
    actor: string;
    at: string;
  },
): void {
  db.prepare(
    `INSERT INTO answer_claim_revisions
      (id, project_id, claim_id, revision, quote_text, statement_kind, offset_basis,
       start_offset, end_offset, relevance, paraphrase, note, supersedes_revision_id,
       decomposition_version, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.projectId,
    input.claimId,
    input.revision,
    input.draft.quoteText,
    input.draft.statementKind,
    input.draft.offsetBasis,
    input.draft.startOffset,
    input.draft.endOffset,
    input.draft.relevance,
    input.draft.paraphrase ?? null,
    input.draft.note ?? null,
    input.supersedesRevisionId,
    ANSWER_CLAIM_VERSIONS.decomposition,
    input.actor,
    input.at,
  );
}

export function createAnswerClaim(
  db: DatabaseSync,
  projectId: string,
  observationId: string,
  draft: AnswerClaimDraftInput,
  context: WriteContext,
): AnswerClaimRecord {
  return withTransaction(db, () => {
    requireWritableRun(db, observationId);
    const claimId = newId('acs');
    const revisionId = newId('acr');
    db.prepare(
      `INSERT INTO answer_claims
        (id, project_id, observation_id, ordinal, current_revision_id, created_at, updated_at,
         voided_at, void_reason)
       VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, NULL)`,
    ).run(
      claimId,
      projectId,
      observationId,
      nextOrdinal(db, observationId),
      context.at,
      context.at,
    );
    insertRevision(db, {
      id: revisionId,
      projectId,
      claimId,
      revision: 1,
      draft,
      supersedesRevisionId: null,
      actor: context.actor,
      at: context.at,
    });
    db.prepare('UPDATE answer_claims SET current_revision_id = ? WHERE id = ?').run(
      revisionId,
      claimId,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'answer-claim.created',
      entityType: 'answer_claim',
      entityId: claimId,
      details: {
        observationId,
        revision: 1,
        relevance: draft.relevance,
        statementKind: draft.statementKind,
        offsetBasis: draft.offsetBasis,
      },
      at: context.at,
    });
    return getAnswerClaimOrThrow(db, projectId, claimId);
  });
}

/**
 * Correct a statement by appending a revision. The prior revision keeps its own links and
 * assessments, so a later reader can see what was believed before the correction.
 */
export function reviseAnswerClaim(
  db: DatabaseSync,
  projectId: string,
  claimId: string,
  draft: AnswerClaimDraftInput,
  context: WriteContext,
): AnswerClaimRecord {
  return withTransaction(db, () => {
    const claim = getAnswerClaimOrThrow(db, projectId, claimId);
    const observationId = claim.observationId;
    requireWritableRun(db, observationId);
    if (claim.voidedAt !== null) {
      throw new AppError('CONFLICT', 'This statement was voided, so it cannot be revised.');
    }
    const previous = claim.currentRevision;
    const revisionNumber = (previous?.revision ?? 0) + 1;
    const revisionId = newId('acr');
    insertRevision(db, {
      id: revisionId,
      projectId,
      claimId,
      revision: revisionNumber,
      draft,
      supersedesRevisionId: previous?.id ?? null,
      actor: context.actor,
      at: context.at,
    });
    db.prepare('UPDATE answer_claims SET current_revision_id = ?, updated_at = ? WHERE id = ?').run(
      revisionId,
      context.at,
      claimId,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'answer-claim.revised',
      entityType: 'answer_claim',
      entityId: claimId,
      details: {
        revision: revisionNumber,
        supersedesRevisionId: previous?.id ?? null,
        relevance: draft.relevance,
      },
      at: context.at,
    });
    return getAnswerClaimOrThrow(db, projectId, claimId);
  });
}

export function voidAnswerClaim(
  db: DatabaseSync,
  projectId: string,
  claimId: string,
  reason: string,
  context: WriteContext,
): AnswerClaimRecord {
  return withTransaction(db, () => {
    const claim = getAnswerClaimOrThrow(db, projectId, claimId);
    requireWritableRun(db, claim.observationId);
    if (claim.voidedAt !== null) {
      throw new AppError('CONFLICT', 'This statement has already been voided.');
    }
    db.prepare(
      'UPDATE answer_claims SET voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?',
    ).run(context.at, reason, context.at, claimId);
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'answer-claim.voided',
      entityType: 'answer_claim',
      entityId: claimId,
      details: { reason },
      at: context.at,
    });
    return getAnswerClaimOrThrow(db, projectId, claimId);
  });
}

function currentRevisionId(db: DatabaseSync, projectId: string, claimId: string): string {
  const claim = getAnswerClaimOrThrow(db, projectId, claimId);
  if (claim.currentRevisionId === null) {
    throw new AppError('CONFLICT', 'The statement has no recorded revision to link.');
  }
  if (claim.voidedAt !== null) {
    throw new AppError('CONFLICT', 'This statement was voided, so it cannot be linked.');
  }
  return claim.currentRevisionId;
}

export function linkAnswerClaimProposition(
  db: DatabaseSync,
  projectId: string,
  claimId: string,
  input: ClaimPropositionLinkInput,
  context: WriteContext,
): AnswerClaimRecord {
  return withTransaction(db, () => {
    const claim = getAnswerClaimOrThrow(db, projectId, claimId);
    requireWritableRun(db, claim.observationId);
    const revisionId = currentRevisionId(db, projectId, claimId);
    const existing = claim.propositionLinks.find(
      (link) => link.propositionId === input.propositionId && link.supersededBy === null,
    );
    if (existing !== undefined) {
      throw new AppError(
        'CONFLICT',
        'That statement is already linked to this proposition. Record a corrected relationship instead.',
      );
    }
    const id = newId('acp');
    db.prepare(
      `INSERT INTO answer_claim_propositions
        (id, project_id, claim_revision_id, proposition_id, relation, rationale, reviewer,
         created_at, superseded_by, superseded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).run(
      id,
      projectId,
      revisionId,
      input.propositionId,
      input.relation,
      input.rationale,
      input.reviewer,
      context.at,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'answer-claim.proposition-linked',
      entityType: 'answer_claim',
      entityId: claimId,
      details: { propositionId: input.propositionId, relation: input.relation },
      at: context.at,
    });
    return getAnswerClaimOrThrow(db, projectId, claimId);
  });
}

/**
 * Record a different relationship for the same statement and proposition. The prior link is pointed
 * at the new row inside the same transaction, which is what the deferred forward reference and the
 * partial unique index require.
 */
export function supersedeAnswerClaimProposition(
  db: DatabaseSync,
  projectId: string,
  linkId: string,
  input: ClaimPropositionLinkInput,
  context: WriteContext,
): AnswerClaimRecord {
  return withTransaction(db, () => {
    const priorRow = db
      .prepare('SELECT * FROM answer_claim_propositions WHERE id = ? AND project_id = ?')
      .get(linkId, projectId);
    if (priorRow === undefined) {
      throw new AppError('NOT_FOUND', 'Statement-proposition link not found.');
    }
    const prior = mapPropositionLink(priorRow);
    if (prior.supersededBy !== null) {
      throw new AppError('CONFLICT', 'That link has already been superseded.');
    }
    const claimRow = db
      .prepare(
        `SELECT revision.claim_id FROM answer_claim_revisions revision
         WHERE revision.id = ?`,
      )
      .get(prior.claimRevisionId) as Row | undefined;
    if (claimRow === undefined) {
      throw new AppError('NOT_FOUND', 'Answer claim revision not found.');
    }
    const claimId = stringValue(claimRow, 'claim_id');
    const claim = getAnswerClaimOrThrow(db, projectId, claimId);
    requireWritableRun(db, claim.observationId);
    if (claim.currentRevisionId !== prior.claimRevisionId) {
      throw new AppError(
        'CONFLICT',
        'Only the current revision of a statement can be corrected. The statement was revised; start a new link.',
      );
    }
    const replacementId = newId('acp');
    db.prepare(
      'UPDATE answer_claim_propositions SET superseded_by = ?, superseded_at = ? WHERE id = ?',
    ).run(replacementId, context.at, linkId);
    db.prepare(
      `INSERT INTO answer_claim_propositions
        (id, project_id, claim_revision_id, proposition_id, relation, rationale, reviewer,
         created_at, superseded_by, superseded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).run(
      replacementId,
      projectId,
      prior.claimRevisionId,
      prior.propositionId,
      input.relation,
      input.rationale,
      input.reviewer,
      context.at,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'answer-claim.proposition-superseded',
      entityType: 'answer_claim',
      entityId: claimId,
      details: {
        priorLinkId: linkId,
        propositionId: prior.propositionId,
        priorRelation: prior.relation,
        relation: input.relation,
      },
      at: context.at,
    });
    return getAnswerClaimOrThrow(db, projectId, claimId);
  });
}

export function linkAnswerClaimCitation(
  db: DatabaseSync,
  projectId: string,
  claimId: string,
  input: ClaimCitationLinkInput,
  context: WriteContext,
): AnswerClaimRecord {
  return withTransaction(db, () => {
    const claim = getAnswerClaimOrThrow(db, projectId, claimId);
    requireWritableRun(db, claim.observationId);
    const revisionId = currentRevisionId(db, projectId, claimId);
    const citation = db
      .prepare('SELECT observation_id, voided_at FROM citations WHERE id = ?')
      .get(input.citationId) as Row | undefined;
    if (citation === undefined) {
      throw new AppError('NOT_FOUND', 'Citation not found.');
    }
    if (stringValue(citation, 'observation_id') !== claim.observationId) {
      throw new AppError(
        'CONFLICT',
        'That citation belongs to a different answer, so it cannot support this statement.',
      );
    }
    if (nullableStringValue(citation, 'voided_at') !== null) {
      throw new AppError(
        'CONFLICT',
        'The citation was voided; record the support as metadata missing instead.',
      );
    }
    if (
      claim.citationLinks.some(
        (link) => link.citationId === input.citationId && link.supersededBy === null,
      )
    ) {
      throw new AppError(
        'CONFLICT',
        'That statement already maps to this citation. Record a corrected support assessment instead.',
      );
    }
    db.prepare(
      `INSERT INTO answer_claim_citations
        (id, project_id, claim_revision_id, citation_id, support, rationale, reviewer,
         created_at, superseded_by, superseded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).run(
      newId('acc'),
      projectId,
      revisionId,
      input.citationId,
      input.support,
      input.rationale,
      input.reviewer,
      context.at,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'answer-claim.citation-linked',
      entityType: 'answer_claim',
      entityId: claimId,
      details: { citationId: input.citationId, support: input.support },
      at: context.at,
    });
    return getAnswerClaimOrThrow(db, projectId, claimId);
  });
}

export function supersedeAnswerClaimCitation(
  db: DatabaseSync,
  projectId: string,
  linkId: string,
  input: ClaimCitationLinkInput,
  context: WriteContext,
): AnswerClaimRecord {
  return withTransaction(db, () => {
    const priorRow = db
      .prepare('SELECT * FROM answer_claim_citations WHERE id = ? AND project_id = ?')
      .get(linkId, projectId);
    if (priorRow === undefined) {
      throw new AppError('NOT_FOUND', 'Statement-citation mapping not found.');
    }
    const prior = mapCitationLink(priorRow);
    if (prior.supersededBy !== null) {
      throw new AppError('CONFLICT', 'That mapping has already been superseded.');
    }
    const claimRow = db
      .prepare('SELECT claim_id FROM answer_claim_revisions WHERE id = ?')
      .get(prior.claimRevisionId) as Row | undefined;
    if (claimRow === undefined) {
      throw new AppError('NOT_FOUND', 'Answer claim revision not found.');
    }
    const claimId = stringValue(claimRow, 'claim_id');
    const claim = getAnswerClaimOrThrow(db, projectId, claimId);
    requireWritableRun(db, claim.observationId);
    if (claim.currentRevisionId !== prior.claimRevisionId) {
      throw new AppError(
        'CONFLICT',
        'Only the current revision of a statement can be corrected. The statement was revised; start a new mapping.',
      );
    }
    const replacementId = newId('acc');
    db.prepare(
      'UPDATE answer_claim_citations SET superseded_by = ?, superseded_at = ? WHERE id = ?',
    ).run(replacementId, context.at, linkId);
    db.prepare(
      `INSERT INTO answer_claim_citations
        (id, project_id, claim_revision_id, citation_id, support, rationale, reviewer,
         created_at, superseded_by, superseded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    ).run(
      replacementId,
      projectId,
      prior.claimRevisionId,
      prior.citationId,
      input.support,
      input.rationale,
      input.reviewer,
      context.at,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'answer-claim.citation-superseded',
      entityType: 'answer_claim',
      entityId: claimId,
      details: {
        priorLinkId: linkId,
        citationId: prior.citationId,
        priorSupport: prior.support,
        support: input.support,
      },
      at: context.at,
    });
    return getAnswerClaimOrThrow(db, projectId, claimId);
  });
}

/**
 * Append a fidelity or attribution assessment for the current revision. Citation support is not
 * recorded here: it belongs to a claim-to-citation mapping, because one statement can be supported
 * by one citation and contradicted by another.
 */
export function recordAnswerClaimAssessment(
  db: DatabaseSync,
  projectId: string,
  claimId: string,
  input: AnswerClaimAssessmentInput,
  context: WriteContext,
): AnswerClaimRecord {
  return withTransaction(db, () => {
    const claim = getAnswerClaimOrThrow(db, projectId, claimId);
    requireWritableRun(db, claim.observationId);
    const revisionId = currentRevisionId(db, projectId, claimId);
    const highest = claim.assessments
      .filter((assessment) => assessment.dimension === input.dimension)
      .reduce((max, assessment) => Math.max(max, assessment.version), 0);
    // Numbering continues per (revision, dimension), so a second opinion on the same revision is a
    // new version rather than a replacement of the earlier judgement.
    db.prepare(
      `INSERT INTO answer_claim_assessments
        (id, project_id, claim_id, claim_revision_id, dimension, version, label, rationale,
         reviewer, attribution_subject, attribution_role, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
    ).run(
      newId('aca'),
      projectId,
      claimId,
      revisionId,
      input.dimension,
      highest + 1,
      input.label,
      input.rationale,
      input.reviewer,
      input.attributionSubject ?? null,
      input.attributionRole ?? null,
      context.at,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'answer-claim.assessed',
      entityType: 'answer_claim',
      entityId: claimId,
      details: { dimension: input.dimension, label: input.label, version: highest + 1 },
      at: context.at,
    });
    return getAnswerClaimOrThrow(db, projectId, claimId);
  });
}

/**
 * Latest label per dimension for the current revision, which is what reporting reads.
 *
 * Labels are re-validated against their dimension on the way out. A stored row is normally correct
 * because the schema enforces the pairing, but a hand-edited or restored database should yield an
 * unknown label rather than a value the metrics code would then trust.
 */
export interface CurrentClaimLabels {
  readonly FIDELITY?: ClaimFidelityLabel;
  readonly ATTRIBUTION?: ClaimAttributionLabel;
}

export function currentClaimLabels(claim: AnswerClaimRecord): CurrentClaimLabels {
  const latest = new Map<ClaimDimension, { version: number; label: string }>();
  for (const assessment of claim.assessments) {
    if (assessment.claimRevisionId !== claim.currentRevisionId) {
      continue;
    }
    const current = latest.get(assessment.dimension);
    if (current === undefined || assessment.version > current.version) {
      latest.set(assessment.dimension, {
        version: assessment.version,
        label: assessment.label,
      });
    }
  }
  const result: { FIDELITY?: ClaimFidelityLabel; ATTRIBUTION?: ClaimAttributionLabel } = {};
  const fidelity = latest.get('FIDELITY');
  if (fidelity !== undefined && isClaimFidelityLabel(fidelity.label)) {
    result.FIDELITY = fidelity.label;
  }
  const attribution = latest.get('ATTRIBUTION');
  if (attribution !== undefined && isClaimAttributionLabel(attribution.label)) {
    result.ATTRIBUTION = attribution.label;
  }
  return result;
}

export function claimFidelityLabel(claim: AnswerClaimRecord): ClaimFidelityLabel | undefined {
  return currentClaimLabels(claim).FIDELITY;
}

export function claimAttributionLabel(claim: AnswerClaimRecord): ClaimAttributionLabel | undefined {
  return currentClaimLabels(claim).ATTRIBUTION;
}
