import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  canonicalAchievementRevision,
  claimSupportState,
  summarizeClaimEvidenceStatus,
  type AchievementClaimSnapshot,
  type AchievementClaimSupportState,
  type AchievementContradictionSnapshot,
  type AchievementContributorSnapshot,
  type AchievementContributorSupportState,
  type AchievementEvidenceSnapshot,
  type AchievementRevisionInput,
  type AchievementRevisionSnapshot,
} from '../../core/achievements.ts';
import { deriveEvidenceStatus, type EvidenceRelationshipRecord } from '../../core/evidence.ts';
import type { AttributionRole, PropositionStatus } from '../../core/vocabulary.ts';
import { AppError } from '../../errors.ts';
import { appendAuditEvent } from '../audit.ts';
import { withTransaction } from '../db.ts';
import { newId } from '../ids.ts';
import { jsonValue, nullableStringValue, numberValue, stringValue, type Row } from '../rows.ts';
import type { WriteContext } from './context.ts';
import { getClaimOrThrow } from './claims.ts';

export interface AchievementApprovalRecord {
  readonly id: string;
  readonly revisionId: string;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly note: string;
  readonly contentHash: string;
  readonly createdAt: string;
}

export interface AchievementClaimRecord extends AchievementClaimSnapshot {
  readonly id: string;
}

export interface AchievementContributorRecord extends AchievementContributorSnapshot {
  readonly id: string;
}

export interface AchievementEvidenceRecord extends AchievementEvidenceSnapshot {
  readonly id: string;
}

export interface AchievementRevisionRecord {
  readonly id: string;
  readonly achievementId: string;
  readonly revisionNumber: number;
  readonly title: string;
  readonly summary: string;
  readonly projectName: string;
  readonly projectDescription: string | null;
  readonly projectUrl: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly unresolvedContradictions: readonly AchievementContradictionSnapshot[];
  readonly contentHash: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly claims: readonly AchievementClaimRecord[];
  readonly contributors: readonly AchievementContributorRecord[];
  readonly evidence: readonly AchievementEvidenceRecord[];
  readonly approval: AchievementApprovalRecord | null;
}

export interface AchievementRecord {
  readonly id: string;
  readonly projectId: string;
  readonly currentRevisionId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly currentRevision: AchievementRevisionRecord | null;
  readonly revisions: readonly AchievementRevisionRecord[];
  readonly publicationReady: boolean;
}

export interface AchievementSummary {
  readonly id: string;
  readonly projectId: string;
  readonly currentRevisionId: string | null;
  readonly currentTitle: string | null;
  readonly currentRevisionNumber: number | null;
  readonly publicationReady: boolean;
  readonly claimCount: number;
  readonly contributorCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AchievementApprovalInput {
  readonly confirmation: string;
  readonly note: string;
}

function hashSnapshot(snapshot: AchievementRevisionSnapshot): string {
  return createHash('sha256').update(canonicalAchievementRevision(snapshot), 'utf8').digest('hex');
}

function mapApproval(row: Row): AchievementApprovalRecord {
  return {
    id: stringValue(row, 'id'),
    revisionId: stringValue(row, 'revision_id'),
    approvedBy: stringValue(row, 'approved_by'),
    approvedAt: stringValue(row, 'approved_at'),
    note: stringValue(row, 'note'),
    contentHash: stringValue(row, 'content_hash'),
    createdAt: stringValue(row, 'created_at'),
  };
}

function approvalFor(db: DatabaseSync, revisionId: string): AchievementApprovalRecord | null {
  const row = db
    .prepare('SELECT * FROM achievement_approvals WHERE revision_id = ?')
    .get(revisionId);
  return row === undefined ? null : mapApproval(row);
}

function claimRows(db: DatabaseSync, revisionId: string): Row[] {
  return db
    .prepare('SELECT * FROM achievement_claims WHERE revision_id = ? ORDER BY ordinal ASC')
    .all(revisionId);
}

function contributorRows(db: DatabaseSync, revisionId: string): Row[] {
  return db
    .prepare('SELECT * FROM achievement_contributors WHERE revision_id = ? ORDER BY ordinal ASC')
    .all(revisionId);
}

function evidenceRows(db: DatabaseSync, revisionId: string): Row[] {
  return db
    .prepare('SELECT * FROM achievement_evidence WHERE revision_id = ? ORDER BY ordinal ASC')
    .all(revisionId);
}

function mapClaimRecord(row: Row): AchievementClaimRecord {
  return {
    id: stringValue(row, 'id'),
    claimId: nullableStringValue(row, 'claim_id'),
    claimRevisionId: nullableStringValue(row, 'claim_revision_id'),
    ordinal: numberValue(row, 'ordinal'),
    claimText: stringValue(row, 'claim_text'),
    evidenceStatus: stringValue(row, 'evidence_status') as PropositionStatus,
    supportState: stringValue(row, 'support_state') as AchievementClaimSupportState,
    humanAssessmentStatus: nullableStringValue(
      row,
      'human_assessment_status',
    ) as PropositionStatus | null,
    evidenceRelationshipCount: numberValue(row, 'evidence_relationship_count'),
    note: nullableStringValue(row, 'note'),
  };
}

function mapContributorRecord(row: Row): AchievementContributorRecord {
  return {
    id: stringValue(row, 'id'),
    ordinal: numberValue(row, 'ordinal'),
    name: stringValue(row, 'name'),
    role: stringValue(row, 'role') as AttributionRole,
    contribution: stringValue(row, 'contribution'),
    supportState: stringValue(row, 'support_state') as AchievementContributorSupportState,
    evidenceNote: nullableStringValue(row, 'evidence_note'),
  };
}

function mapEvidenceRecord(row: Row): AchievementEvidenceRecord {
  return {
    id: stringValue(row, 'id'),
    ordinal: numberValue(row, 'ordinal'),
    sourceId: stringValue(row, 'source_id'),
    evidenceId: nullableStringValue(row, 'evidence_id'),
    sourceTitle: stringValue(row, 'source_title'),
    sourceUrl: nullableStringValue(row, 'source_url'),
    evidenceLocator: nullableStringValue(row, 'evidence_locator'),
    evidenceExcerptDigest: nullableStringValue(row, 'evidence_excerpt_digest'),
    note: nullableStringValue(row, 'note'),
  };
}

function mapRevision(db: DatabaseSync, row: Row): AchievementRevisionRecord {
  const id = stringValue(row, 'id');
  const claims = claimRows(db, id).map(mapClaimRecord);
  const contributors = contributorRows(db, id).map(mapContributorRecord);
  const evidence = evidenceRows(db, id).map(mapEvidenceRecord);
  const approval = approvalFor(db, id);
  return {
    id,
    achievementId: stringValue(row, 'achievement_id'),
    revisionNumber: numberValue(row, 'revision_number'),
    title: stringValue(row, 'title'),
    summary: stringValue(row, 'summary'),
    projectName: stringValue(row, 'project_name'),
    projectDescription: nullableStringValue(row, 'project_description'),
    projectUrl: nullableStringValue(row, 'project_url'),
    startDate: nullableStringValue(row, 'start_date'),
    endDate: nullableStringValue(row, 'end_date'),
    unresolvedContradictions: jsonValue<AchievementContradictionSnapshot[]>(
      row,
      'unresolved_contradictions_json',
    ),
    contentHash: stringValue(row, 'content_hash'),
    createdBy: stringValue(row, 'created_by'),
    createdAt: stringValue(row, 'created_at'),
    claims,
    contributors,
    evidence,
    approval,
  };
}

function getAchievementRow(
  db: DatabaseSync,
  projectId: string,
  achievementId: string,
): Row | undefined {
  return db
    .prepare('SELECT * FROM achievements WHERE project_id = ? AND id = ?')
    .get(projectId, achievementId);
}

function getAchievementOrThrowRow(db: DatabaseSync, projectId: string, achievementId: string): Row {
  const row = getAchievementRow(db, projectId, achievementId);
  if (row === undefined) {
    throw new AppError('NOT_FOUND', 'Achievement record not found.');
  }
  return row;
}

export function getAchievement(
  db: DatabaseSync,
  projectId: string,
  achievementId: string,
): AchievementRecord | null {
  const row = getAchievementRow(db, projectId, achievementId);
  if (row === undefined) {
    return null;
  }
  const revisions = db
    .prepare(
      'SELECT * FROM achievement_revisions WHERE achievement_id = ? ORDER BY revision_number ASC',
    )
    .all(achievementId)
    .map((revision) => mapRevision(db, revision));
  const currentRevisionId = nullableStringValue(row, 'current_revision_id');
  const currentRevision =
    currentRevisionId === null
      ? null
      : (revisions.find((revision) => revision.id === currentRevisionId) ?? null);
  return {
    id: stringValue(row, 'id'),
    projectId: stringValue(row, 'project_id'),
    currentRevisionId,
    createdAt: stringValue(row, 'created_at'),
    updatedAt: stringValue(row, 'updated_at'),
    currentRevision,
    revisions,
    publicationReady: currentRevision?.approval !== null && currentRevision !== null,
  };
}

export function getAchievementOrThrow(
  db: DatabaseSync,
  projectId: string,
  achievementId: string,
): AchievementRecord {
  const achievement = getAchievement(db, projectId, achievementId);
  if (achievement === null) {
    throw new AppError('NOT_FOUND', 'Achievement record not found.');
  }
  return achievement;
}

export function listAchievements(db: DatabaseSync, projectId: string): AchievementSummary[] {
  return db
    .prepare(
      `SELECT a.id, a.project_id, a.current_revision_id, a.created_at, a.updated_at,
        r.title AS current_title,
        r.revision_number AS current_revision_number,
        ap.id AS approval_id,
        (SELECT COUNT(*) FROM achievement_claims ac
           JOIN achievement_revisions ar ON ar.id = ac.revision_id
           WHERE ar.achievement_id = a.id
             AND ar.id = a.current_revision_id) AS claim_count,
        (SELECT COUNT(*) FROM achievement_contributors acon
           JOIN achievement_revisions ar ON ar.id = acon.revision_id
           WHERE ar.achievement_id = a.id
             AND ar.id = a.current_revision_id) AS contributor_count
       FROM achievements a
       LEFT JOIN achievement_revisions r ON r.id = a.current_revision_id
       LEFT JOIN achievement_approvals ap ON ap.revision_id = a.current_revision_id
       WHERE a.project_id = ?
       ORDER BY a.updated_at DESC, a.id DESC`,
    )
    .all(projectId)
    .map((row) => ({
      id: stringValue(row, 'id'),
      projectId: stringValue(row, 'project_id'),
      currentRevisionId: nullableStringValue(row, 'current_revision_id'),
      currentTitle: nullableStringValue(row, 'current_title'),
      currentRevisionNumber:
        row['current_revision_number'] === null
          ? null
          : numberValue(row, 'current_revision_number'),
      publicationReady: row['approval_id'] !== null,
      claimCount: numberValue(row, 'claim_count'),
      contributorCount: numberValue(row, 'contributor_count'),
      createdAt: stringValue(row, 'created_at'),
      updatedAt: stringValue(row, 'updated_at'),
    }));
}

interface ClaimEvaluation {
  readonly snapshot: AchievementClaimSnapshot;
  readonly unresolved: AchievementContradictionSnapshot | null;
}

function evaluateClaim(
  db: DatabaseSync,
  projectId: string,
  claimId: string,
  ordinal: number,
): ClaimEvaluation {
  const claim = getClaimOrThrow(db, projectId, claimId);
  if (claim.currentRevision === null) {
    throw new AppError('CONFLICT', 'A selected claim has no current revision.');
  }
  const statuses: PropositionStatus[] = [];
  const humanStatuses: PropositionStatus[] = [];
  let relationshipCount = 0;
  for (const proposition of claim.propositions) {
    const relationships = db
      .prepare(
        `SELECT r.id, r.relation, s.id AS source_id, s.source_type, s.independence
         FROM evidence_relationships r
         JOIN evidence_items e ON e.id = r.evidence_id
         JOIN sources s ON s.id = e.source_id
         WHERE r.proposition_id = ? AND r.superseded_by IS NULL`,
      )
      .all(proposition.id)
      .map((row): EvidenceRelationshipRecord => ({
        id: stringValue(row, 'id'),
        relation: stringValue(row, 'relation') as EvidenceRelationshipRecord['relation'],
        sourceId: stringValue(row, 'source_id'),
        sourceType: stringValue(row, 'source_type') as EvidenceRelationshipRecord['sourceType'],
        independence: stringValue(
          row,
          'independence',
        ) as EvidenceRelationshipRecord['independence'],
      }));
    relationshipCount += relationships.length;
    const derived = deriveEvidenceStatus(relationships);
    statuses.push(derived.status);
    const latestHuman = db
      .prepare(
        `SELECT label FROM proposition_assessments
         WHERE proposition_id = ?
         ORDER BY version DESC
         LIMIT 1`,
      )
      .get(proposition.id);
    if (latestHuman !== undefined) {
      humanStatuses.push(stringValue(latestHuman, 'label') as PropositionStatus);
    }
  }
  const evidenceStatus = summarizeClaimEvidenceStatus(statuses);
  const humanAssessmentStatus =
    humanStatuses.length === 0 ? null : summarizeClaimEvidenceStatus(humanStatuses);
  const supportState = claimSupportState(evidenceStatus, humanAssessmentStatus);
  const unresolved =
    supportState === 'UNRESOLVED' || claim.claim.status === 'DISPUTED'
      ? {
          claimId,
          claimText: claim.currentRevision.text,
          reason:
            claim.claim.status === 'DISPUTED'
              ? 'The claim is marked disputed; the attribution or evidence remains contested.'
              : 'Recorded support and contradiction coexist for this claim; the conflict remains unresolved.',
        }
      : null;
  return {
    snapshot: {
      claimId,
      claimRevisionId: claim.currentRevision.id,
      ordinal,
      claimText: claim.currentRevision.text,
      evidenceStatus,
      supportState,
      humanAssessmentStatus,
      evidenceRelationshipCount: relationshipCount,
      note: null,
    },
    unresolved,
  };
}

function sourceRow(
  db: DatabaseSync,
  projectId: string,
  sourceId: string,
): { readonly title: string; readonly url: string | null } {
  const row = db
    .prepare('SELECT title, canonical_uri FROM sources WHERE project_id = ? AND id = ?')
    .get(projectId, sourceId);
  if (row === undefined) {
    throw new AppError('NOT_FOUND', 'A selected source does not belong to this project.');
  }
  return {
    title: stringValue(row, 'title'),
    url: nullableStringValue(row, 'canonical_uri'),
  };
}

function evidenceRow(
  db: DatabaseSync,
  projectId: string,
  evidenceId: string,
): {
  readonly sourceId: string;
  readonly locator: string;
  readonly digest: string;
} {
  const row = db
    .prepare(
      'SELECT source_id, locator, excerpt_digest FROM evidence_items WHERE project_id = ? AND id = ?',
    )
    .get(projectId, evidenceId);
  if (row === undefined) {
    throw new AppError('NOT_FOUND', 'A selected evidence item does not belong to this project.');
  }
  return {
    sourceId: stringValue(row, 'source_id'),
    locator: stringValue(row, 'locator'),
    digest: stringValue(row, 'excerpt_digest'),
  };
}

function buildSnapshot(
  db: DatabaseSync,
  projectId: string,
  input: AchievementRevisionInput,
): AchievementRevisionSnapshot {
  const claimIds = [...input.claimIds].sort();
  const claims: AchievementClaimSnapshot[] = [];
  const unresolved: AchievementContradictionSnapshot[] = [];
  for (const [index, claimId] of claimIds.entries()) {
    const evaluated = evaluateClaim(db, projectId, claimId, index + 1);
    claims.push(evaluated.snapshot);
    if (evaluated.unresolved !== null) {
      unresolved.push(evaluated.unresolved);
    }
  }

  const contributorSnapshots: AchievementContributorSnapshot[] = input.contributors.map(
    (contributor, index) => ({
      ordinal: index + 1,
      name: contributor.name,
      role: contributor.role,
      contribution: contributor.contribution,
      supportState: contributor.supportState,
      evidenceNote: contributor.evidenceNote ?? null,
    }),
  );

  // Every evidence item implies its source. The union keeps the record complete even when the
  // operator selected an excerpt without also checking the source row.
  const sourceIds = new Set(input.sourceIds);
  const selectedEvidence = [...new Set(input.evidenceIds)].sort();
  for (const evidenceId of selectedEvidence) {
    sourceIds.add(evidenceRow(db, projectId, evidenceId).sourceId);
  }
  const sortedSources = [...sourceIds].sort();
  const evidenceSnapshots: AchievementEvidenceSnapshot[] = [];
  let ordinal = 1;
  for (const sourceId of sortedSources) {
    const source = sourceRow(db, projectId, sourceId);
    evidenceSnapshots.push({
      ordinal,
      sourceId,
      evidenceId: null,
      sourceTitle: source.title,
      sourceUrl: source.url,
      evidenceLocator: null,
      evidenceExcerptDigest: null,
      note: null,
    });
    ordinal += 1;
  }
  for (const evidenceId of selectedEvidence) {
    const evidence = evidenceRow(db, projectId, evidenceId);
    const source = sourceRow(db, projectId, evidence.sourceId);
    evidenceSnapshots.push({
      ordinal,
      sourceId: evidence.sourceId,
      evidenceId,
      sourceTitle: source.title,
      sourceUrl: source.url,
      evidenceLocator: evidence.locator,
      evidenceExcerptDigest: evidence.digest,
      note: null,
    });
    ordinal += 1;
  }

  return {
    title: input.title,
    summary: input.summary,
    projectName: input.projectName,
    projectDescription: input.projectDescription ?? null,
    projectUrl: input.projectUrl ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    claims,
    contributors: contributorSnapshots,
    evidence: evidenceSnapshots,
    unresolvedContradictions: unresolved,
  };
}

function insertRevision(
  db: DatabaseSync,
  achievementId: string,
  revisionNumber: number,
  snapshot: AchievementRevisionSnapshot,
  context: WriteContext,
): string {
  const revisionId = newId('arv');
  const contentHash = hashSnapshot(snapshot);
  db.prepare(
    `INSERT INTO achievement_revisions
      (id, achievement_id, revision_number, title, summary, project_name, project_description,
       project_url, start_date, end_date, unresolved_contradictions_json, content_hash,
       created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    revisionId,
    achievementId,
    revisionNumber,
    snapshot.title,
    snapshot.summary,
    snapshot.projectName,
    snapshot.projectDescription,
    snapshot.projectUrl,
    snapshot.startDate,
    snapshot.endDate,
    JSON.stringify(snapshot.unresolvedContradictions),
    contentHash,
    context.actor,
    context.at,
  );
  for (const claim of snapshot.claims) {
    db.prepare(
      `INSERT INTO achievement_claims
        (id, revision_id, claim_id, claim_revision_id, ordinal, claim_text, evidence_status,
         support_state, human_assessment_status, evidence_relationship_count, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId('acl'),
      revisionId,
      claim.claimId,
      claim.claimRevisionId,
      claim.ordinal,
      claim.claimText,
      claim.evidenceStatus,
      claim.supportState,
      claim.humanAssessmentStatus,
      claim.evidenceRelationshipCount,
      claim.note,
    );
  }
  for (const contributor of snapshot.contributors) {
    db.prepare(
      `INSERT INTO achievement_contributors
        (id, revision_id, ordinal, name, role, contribution, support_state, evidence_note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId('acn'),
      revisionId,
      contributor.ordinal,
      contributor.name,
      contributor.role,
      contributor.contribution,
      contributor.supportState,
      contributor.evidenceNote,
    );
  }
  for (const evidence of snapshot.evidence) {
    db.prepare(
      `INSERT INTO achievement_evidence
        (id, revision_id, source_id, evidence_id, ordinal, source_title, source_url,
         evidence_locator, evidence_excerpt_digest, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId('aev'),
      revisionId,
      evidence.sourceId,
      evidence.evidenceId,
      evidence.ordinal,
      evidence.sourceTitle,
      evidence.sourceUrl,
      evidence.evidenceLocator,
      evidence.evidenceExcerptDigest,
      evidence.note,
    );
  }
  return revisionId;
}

export function createAchievement(
  db: DatabaseSync,
  projectId: string,
  input: AchievementRevisionInput,
  context: WriteContext,
): AchievementRecord {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (project === undefined) {
    throw new AppError('NOT_FOUND', 'Project not found.');
  }
  return withTransaction(db, () => {
    const achievementId = newId('ach');
    db.prepare(
      `INSERT INTO achievements (id, project_id, current_revision_id, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?)`,
    ).run(achievementId, projectId, context.at, context.at);
    const snapshot = buildSnapshot(db, projectId, input);
    const revisionId = insertRevision(db, achievementId, 1, snapshot, context);
    db.prepare('UPDATE achievements SET current_revision_id = ?, updated_at = ? WHERE id = ?').run(
      revisionId,
      context.at,
      achievementId,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'achievement.created',
      entityType: 'achievement',
      entityId: achievementId,
      details: {
        revisionId,
        revisionNumber: 1,
        claimCount: snapshot.claims.length,
        contributorCount: snapshot.contributors.length,
      },
      at: context.at,
    });
    return getAchievementOrThrow(db, projectId, achievementId);
  });
}

export function createAchievementRevision(
  db: DatabaseSync,
  projectId: string,
  achievementId: string,
  input: AchievementRevisionInput,
  context: WriteContext,
): AchievementRecord {
  return withTransaction(db, () => {
    getAchievementOrThrowRow(db, projectId, achievementId);
    const maxRow = db
      .prepare(
        'SELECT MAX(revision_number) AS max_number FROM achievement_revisions WHERE achievement_id = ?',
      )
      .get(achievementId);
    const next =
      (maxRow === undefined || maxRow['max_number'] === null
        ? 0
        : numberValue(maxRow, 'max_number')) + 1;
    const snapshot = buildSnapshot(db, projectId, input);
    const revisionId = insertRevision(db, achievementId, next, snapshot, context);
    db.prepare(
      'UPDATE achievements SET current_revision_id = ?, updated_at = ? WHERE project_id = ? AND id = ?',
    ).run(revisionId, context.at, projectId, achievementId);
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'achievement.revision_created',
      entityType: 'achievement',
      entityId: achievementId,
      details: { revisionId, revisionNumber: next, contentHash: hashSnapshot(snapshot) },
      at: context.at,
    });
    return getAchievementOrThrow(db, projectId, achievementId);
  });
}

function storedSnapshot(revision: AchievementRevisionRecord): AchievementRevisionSnapshot {
  return {
    title: revision.title,
    summary: revision.summary,
    projectName: revision.projectName,
    projectDescription: revision.projectDescription,
    projectUrl: revision.projectUrl,
    startDate: revision.startDate,
    endDate: revision.endDate,
    claims: revision.claims.map((claim) => ({
      claimId: claim.claimId,
      claimRevisionId: claim.claimRevisionId,
      ordinal: claim.ordinal,
      claimText: claim.claimText,
      evidenceStatus: claim.evidenceStatus,
      supportState: claim.supportState,
      humanAssessmentStatus: claim.humanAssessmentStatus,
      evidenceRelationshipCount: claim.evidenceRelationshipCount,
      note: claim.note,
    })),
    contributors: revision.contributors.map((contributor) => ({
      ordinal: contributor.ordinal,
      name: contributor.name,
      role: contributor.role,
      contribution: contributor.contribution,
      supportState: contributor.supportState,
      evidenceNote: contributor.evidenceNote,
    })),
    evidence: revision.evidence.map((item) => ({
      ordinal: item.ordinal,
      sourceId: item.sourceId,
      evidenceId: item.evidenceId,
      sourceTitle: item.sourceTitle,
      sourceUrl: item.sourceUrl,
      evidenceLocator: item.evidenceLocator,
      evidenceExcerptDigest: item.evidenceExcerptDigest,
      note: item.note,
    })),
    unresolvedContradictions: revision.unresolvedContradictions,
  };
}

export function approveAchievement(
  db: DatabaseSync,
  projectId: string,
  achievementId: string,
  input: AchievementApprovalInput,
  context: WriteContext,
): AchievementRecord {
  return withTransaction(db, () => {
    const achievement = getAchievementOrThrow(db, projectId, achievementId);
    const revision = achievement.currentRevision;
    if (revision === null) {
      throw new AppError('CONFLICT', 'The achievement has no current revision to approve.');
    }
    if (revision.approval !== null) {
      throw new AppError('CONFLICT', 'This revision is already approved.');
    }
    if (input.confirmation.trim() !== revision.title) {
      throw new AppError(
        'CONFLICT',
        'The typed confirmation does not match the current revision title.',
      );
    }
    const note = input.note.trim();
    if (note.length < 3 || note.length > 2000) {
      throw new AppError('CONFLICT', 'The approval note must be 3 to 2000 characters.');
    }
    const recomputed = hashSnapshot(storedSnapshot(revision));
    if (recomputed !== revision.contentHash) {
      throw new AppError(
        'CONFLICT',
        'The stored revision does not match its content hash; approval is refused.',
      );
    }
    const approvalId = newId('aap');
    db.prepare(
      `INSERT INTO achievement_approvals
        (id, revision_id, approved_by, approved_at, note, content_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      approvalId,
      revision.id,
      context.actor,
      context.at,
      note,
      revision.contentHash,
      context.at,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'achievement.approved',
      entityType: 'achievement',
      entityId: achievementId,
      details: {
        revisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        contentHash: revision.contentHash,
      },
      at: context.at,
    });
    return getAchievementOrThrow(db, projectId, achievementId);
  });
}

export function exportAchievements(db: DatabaseSync, projectId: string): AchievementRecord[] {
  return listAchievements(db, projectId).map((summary) =>
    getAchievementOrThrow(db, projectId, summary.id),
  );
}
