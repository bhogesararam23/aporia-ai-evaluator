import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  EvidenceWithRelationInput,
  PropositionAssessmentInput,
  RelationshipChangeInput,
  SourceInput,
} from '../../core/inputs.ts';
import type { EvidenceRelationshipRecord } from '../../core/evidence.ts';
import type {
  EvidenceExtractionMethod,
  EvidenceRelation,
  PropositionStatus,
  SourceAccessRoute,
  SourceIndependence,
  SourceType,
} from '../../core/vocabulary.ts';
import { AppError } from '../../errors.ts';
import { appendAuditEvent } from '../audit.ts';
import { withTransaction } from '../db.ts';
import { newId } from '../ids.ts';
import { numberValue, nullableStringValue, stringValue, type Row } from '../rows.ts';
import type { WriteContext } from './context.ts';

export interface SourceRecord {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly canonicalUri: string | null;
  readonly publisher: string | null;
  readonly author: string | null;
  readonly sourceType: SourceType;
  readonly accessRoute: SourceAccessRoute;
  readonly retrievedAt: string;
  readonly publicationDate: string | null;
  readonly language: string;
  readonly independence: SourceIndependence;
  readonly notes: string | null;
  readonly accessStatus: 'NOT_CHECKED' | 'OBSERVED_AVAILABLE' | 'OBSERVED_UNAVAILABLE';
  readonly createdAt: string;
}

export interface EvidenceRecord {
  readonly id: string;
  readonly projectId: string;
  readonly sourceId: string;
  readonly locator: string;
  readonly excerpt: string;
  readonly extractionMethod: EvidenceExtractionMethod;
  readonly extractedAt: string;
  readonly provenance: 'USER_SUPPLIED';
  readonly excerptDigest: string;
  readonly createdAt: string;
}

export interface RelationshipRecord {
  readonly id: string;
  readonly projectId: string;
  readonly evidenceId: string;
  readonly propositionId: string;
  readonly relation: EvidenceRelation;
  readonly rationale: string;
  readonly reviewer: string;
  readonly createdAt: string;
  readonly supersededBy: string | null;
  readonly supersededAt: string | null;
}

export interface PropositionAssessmentRecord {
  readonly id: string;
  readonly projectId: string;
  readonly propositionId: string;
  readonly version: number;
  readonly label: PropositionStatus;
  readonly rationale: string;
  readonly method: 'HUMAN';
  readonly reviewer: string;
  readonly evidenceSnapshot: readonly string[];
  readonly createdAt: string;
}

export interface PropositionEvidenceRow {
  readonly relationship: RelationshipRecord;
  readonly evidence: EvidenceRecord;
  readonly source: SourceRecord;
}

function mapSource(row: Row, prefix = ''): SourceRecord {
  return {
    id: stringValue(row, `${prefix}id`),
    projectId: stringValue(row, `${prefix}project_id`),
    title: stringValue(row, `${prefix}title`),
    canonicalUri: nullableStringValue(row, `${prefix}canonical_uri`),
    publisher: nullableStringValue(row, `${prefix}publisher`),
    author: nullableStringValue(row, `${prefix}author`),
    sourceType: stringValue(row, `${prefix}source_type`) as SourceType,
    accessRoute: stringValue(row, `${prefix}access_route`) as SourceAccessRoute,
    retrievedAt: stringValue(row, `${prefix}retrieved_at`),
    publicationDate: nullableStringValue(row, `${prefix}publication_date`),
    language: stringValue(row, `${prefix}language`),
    independence: stringValue(row, `${prefix}independence`) as SourceIndependence,
    notes: nullableStringValue(row, `${prefix}notes`),
    accessStatus: stringValue(row, `${prefix}access_status`) as SourceRecord['accessStatus'],
    createdAt: stringValue(row, `${prefix}created_at`),
  };
}

function mapEvidence(row: Row): EvidenceRecord {
  return {
    id: stringValue(row, 'id'),
    projectId: stringValue(row, 'project_id'),
    sourceId: stringValue(row, 'source_id'),
    locator: stringValue(row, 'locator'),
    excerpt: stringValue(row, 'excerpt'),
    extractionMethod: stringValue(row, 'extraction_method') as EvidenceExtractionMethod,
    extractedAt: stringValue(row, 'extracted_at'),
    provenance: 'USER_SUPPLIED',
    excerptDigest: stringValue(row, 'excerpt_digest'),
    createdAt: stringValue(row, 'created_at'),
  };
}

function mapRelationship(row: Row): RelationshipRecord {
  return {
    id: stringValue(row, 'id'),
    projectId: stringValue(row, 'project_id'),
    evidenceId: stringValue(row, 'evidence_id'),
    propositionId: stringValue(row, 'proposition_id'),
    relation: stringValue(row, 'relation') as EvidenceRelation,
    rationale: stringValue(row, 'rationale'),
    reviewer: stringValue(row, 'reviewer'),
    createdAt: stringValue(row, 'created_at'),
    supersededBy: nullableStringValue(row, 'superseded_by'),
    supersededAt: nullableStringValue(row, 'superseded_at'),
  };
}

function mapPropositionAssessment(row: Row): PropositionAssessmentRecord {
  return {
    id: stringValue(row, 'id'),
    projectId: stringValue(row, 'project_id'),
    propositionId: stringValue(row, 'proposition_id'),
    version: numberValue(row, 'version'),
    label: stringValue(row, 'label') as PropositionStatus,
    rationale: stringValue(row, 'rationale'),
    method: 'HUMAN',
    reviewer: stringValue(row, 'reviewer'),
    evidenceSnapshot: JSON.parse(stringValue(row, 'evidence_snapshot_json')) as string[],
    createdAt: stringValue(row, 'created_at'),
  };
}

function currentPropositionRow(
  db: DatabaseSync,
  projectId: string,
  propositionId: string,
): Row | undefined {
  return db
    .prepare(
      `SELECT p.*, c.status AS claim_status
       FROM propositions p
       JOIN claim_revisions r ON r.id = p.claim_revision_id
       JOIN claims c ON c.id = r.claim_id
       WHERE p.id = ? AND c.project_id = ? AND c.current_revision_id = r.id`,
    )
    .get(propositionId, projectId);
}

export function createSource(
  db: DatabaseSync,
  projectId: string,
  input: SourceInput,
  context: WriteContext,
): SourceRecord {
  const project = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId);
  if (project === undefined) {
    throw new AppError('NOT_FOUND', 'Project not found.');
  }
  const id = newId('src');
  db.prepare(
    `INSERT INTO sources
      (id, project_id, title, canonical_uri, publisher, author, source_type, access_route,
       retrieved_at, publication_date, language, independence, notes, access_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_CHECKED', ?)`,
  ).run(
    id,
    projectId,
    input.title,
    input.canonicalUri ?? null,
    input.publisher ?? null,
    input.author ?? null,
    input.sourceType,
    input.accessRoute,
    input.retrievedAt,
    input.publicationDate ?? null,
    input.language,
    input.independence,
    input.notes ?? null,
    context.at,
  );
  appendAuditEvent(db, {
    projectId,
    actor: context.actor,
    action: 'source.created',
    entityType: 'source',
    entityId: id,
    details: { title: input.title, sourceType: input.sourceType },
    at: context.at,
  });
  return getSourceOrThrow(db, projectId, id);
}

export function listSources(db: DatabaseSync, projectId: string): SourceRecord[] {
  return db
    .prepare('SELECT * FROM sources WHERE project_id = ? ORDER BY created_at DESC, id DESC')
    .all(projectId)
    .map((row) => mapSource(row));
}

export function getSource(
  db: DatabaseSync,
  projectId: string,
  sourceId: string,
): SourceRecord | null {
  const row = db
    .prepare('SELECT * FROM sources WHERE project_id = ? AND id = ?')
    .get(projectId, sourceId);
  return row === undefined ? null : mapSource(row);
}

function getSourceOrThrow(db: DatabaseSync, projectId: string, sourceId: string): SourceRecord {
  const source = getSource(db, projectId, sourceId);
  if (source === null) {
    throw new AppError('NOT_FOUND', 'Source not found.');
  }
  return source;
}

function getEvidence(
  db: DatabaseSync,
  projectId: string,
  evidenceId: string,
): EvidenceRecord | null {
  const row = db
    .prepare('SELECT * FROM evidence_items WHERE project_id = ? AND id = ?')
    .get(projectId, evidenceId);
  return row === undefined ? null : mapEvidence(row);
}

export function recordEvidence(
  db: DatabaseSync,
  projectId: string,
  sourceId: string,
  propositionId: string,
  input: EvidenceWithRelationInput,
  context: WriteContext,
): { evidence: EvidenceRecord; relationship: RelationshipRecord } {
  return withTransaction(db, () => {
    const source = getSourceOrThrow(db, projectId, sourceId);
    const proposition = currentPropositionRow(db, projectId, propositionId);
    if (proposition === undefined) {
      throw new AppError('NOT_FOUND', 'Proposition not found in the current revision.');
    }
    const evidenceId = newId('evd');
    const digest = createHash('sha256').update(input.excerpt, 'utf8').digest('hex');
    db.prepare(
      `INSERT INTO evidence_items
        (id, project_id, source_id, locator, excerpt, extraction_method, extracted_at,
         provenance, excerpt_digest, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'USER_SUPPLIED', ?, ?)`,
    ).run(
      evidenceId,
      projectId,
      source.id,
      input.locator,
      input.excerpt,
      input.extractionMethod,
      input.extractedAt,
      digest,
      context.at,
    );
    const relationshipId = newId('rel');
    db.prepare(
      `INSERT INTO evidence_relationships
        (id, project_id, evidence_id, proposition_id, relation, rationale, reviewer, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      relationshipId,
      projectId,
      evidenceId,
      propositionId,
      input.relation,
      input.rationale,
      input.reviewer,
      context.at,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'evidence.created',
      entityType: 'evidence',
      entityId: evidenceId,
      details: { sourceId, propositionId, locator: input.locator, relation: input.relation },
      at: context.at,
    });
    const evidence = getEvidence(db, projectId, evidenceId);
    const relationshipRow = db
      .prepare('SELECT * FROM evidence_relationships WHERE id = ?')
      .get(relationshipId);
    if (evidence === null || relationshipRow === undefined) {
      throw new AppError('INTERNAL_ERROR', 'The evidence could not be read after creation.');
    }
    return { evidence, relationship: mapRelationship(relationshipRow) };
  });
}

export function supersedeRelationship(
  db: DatabaseSync,
  projectId: string,
  relationshipId: string,
  input: RelationshipChangeInput,
  context: WriteContext,
): RelationshipRecord {
  return withTransaction(db, () => {
    const row = db
      .prepare('SELECT * FROM evidence_relationships WHERE project_id = ? AND id = ?')
      .get(projectId, relationshipId);
    if (row === undefined) {
      throw new AppError('NOT_FOUND', 'Evidence relationship not found.');
    }
    const existing = mapRelationship(row);
    if (existing.supersededBy !== null) {
      throw new AppError('CONFLICT', 'That relationship has already been superseded.');
    }
    const newRelationshipId = newId('rel');
    db.prepare(
      'UPDATE evidence_relationships SET superseded_by = ?, superseded_at = ? WHERE id = ?',
    ).run(newRelationshipId, context.at, relationshipId);
    db.prepare(
      `INSERT INTO evidence_relationships
        (id, project_id, evidence_id, proposition_id, relation, rationale, reviewer, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newRelationshipId,
      projectId,
      existing.evidenceId,
      existing.propositionId,
      input.relation,
      input.rationale,
      input.reviewer,
      context.at,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'evidence.relationship_superseded',
      entityType: 'evidence_relationship',
      entityId: relationshipId,
      details: {
        supersededBy: newRelationshipId,
        previousRelation: existing.relation,
        relation: input.relation,
      },
      at: context.at,
    });
    const newRow = db
      .prepare('SELECT * FROM evidence_relationships WHERE id = ?')
      .get(newRelationshipId);
    if (newRow === undefined) {
      throw new AppError('INTERNAL_ERROR', 'The replacement relationship could not be read.');
    }
    return mapRelationship(newRow);
  });
}

export function listPropositionEvidence(
  db: DatabaseSync,
  projectId: string,
  propositionId: string,
): PropositionEvidenceRow[] {
  return db
    .prepare(
      `SELECT
        er.id AS id, er.project_id AS project_id, er.evidence_id AS evidence_id,
        er.proposition_id AS proposition_id, er.relation AS relation, er.rationale AS rationale,
        er.reviewer AS reviewer, er.created_at AS created_at,
        er.superseded_by AS superseded_by, er.superseded_at AS superseded_at,
        e.id AS e_id, e.project_id AS e_project_id, e.source_id AS source_id,
        e.locator AS locator, e.excerpt AS excerpt, e.extraction_method AS extraction_method,
        e.extracted_at AS extracted_at, e.excerpt_digest AS excerpt_digest,
        e.created_at AS e_created_at,
        s.id AS s_id, s.project_id AS s_project_id, s.title AS title,
        s.canonical_uri AS canonical_uri, s.publisher AS publisher, s.author AS author,
        s.source_type AS source_type, s.access_route AS access_route,
        s.retrieved_at AS retrieved_at, s.publication_date AS publication_date,
        s.language AS language, s.independence AS independence, s.notes AS notes,
        s.access_status AS access_status, s.created_at AS s_created_at
       FROM evidence_relationships er
       JOIN evidence_items e ON e.id = er.evidence_id AND e.project_id = er.project_id
       JOIN sources s ON s.id = e.source_id AND s.project_id = e.project_id
       WHERE er.project_id = ? AND er.proposition_id = ?
       ORDER BY (er.superseded_by IS NULL) DESC, er.created_at ASC, er.id ASC`,
    )
    .all(projectId, propositionId)
    .map((row) => ({
      relationship: mapRelationship(row),
      evidence: {
        id: stringValue(row, 'e_id'),
        projectId: stringValue(row, 'e_project_id'),
        sourceId: stringValue(row, 'source_id'),
        locator: stringValue(row, 'locator'),
        excerpt: stringValue(row, 'excerpt'),
        extractionMethod: stringValue(row, 'extraction_method') as EvidenceExtractionMethod,
        extractedAt: stringValue(row, 'extracted_at'),
        provenance: 'USER_SUPPLIED',
        excerptDigest: stringValue(row, 'excerpt_digest'),
        createdAt: stringValue(row, 'e_created_at'),
      },
      source: {
        id: stringValue(row, 's_id'),
        projectId: stringValue(row, 's_project_id'),
        title: stringValue(row, 'title'),
        canonicalUri: nullableStringValue(row, 'canonical_uri'),
        publisher: nullableStringValue(row, 'publisher'),
        author: nullableStringValue(row, 'author'),
        sourceType: stringValue(row, 'source_type') as SourceType,
        accessRoute: stringValue(row, 'access_route') as SourceAccessRoute,
        retrievedAt: stringValue(row, 'retrieved_at'),
        publicationDate: nullableStringValue(row, 'publication_date'),
        language: stringValue(row, 'language'),
        independence: stringValue(row, 'independence') as SourceIndependence,
        notes: nullableStringValue(row, 'notes'),
        accessStatus: stringValue(row, 'access_status') as SourceRecord['accessStatus'],
        createdAt: stringValue(row, 's_created_at'),
      },
    }));
}

export function activeRelationshipsForProposition(
  db: DatabaseSync,
  projectId: string,
  propositionId: string,
): EvidenceRelationshipRecord[] {
  return db
    .prepare(
      `SELECT er.id, er.relation, e.source_id, s.source_type, s.independence
       FROM evidence_relationships er
       JOIN evidence_items e ON e.id = er.evidence_id AND e.project_id = er.project_id
       JOIN sources s ON s.id = e.source_id AND s.project_id = e.project_id
       WHERE er.project_id = ? AND er.proposition_id = ? AND er.superseded_by IS NULL
       ORDER BY er.created_at ASC, er.id ASC`,
    )
    .all(projectId, propositionId)
    .map((row) => ({
      id: stringValue(row, 'id'),
      relation: stringValue(row, 'relation') as EvidenceRelation,
      sourceId: stringValue(row, 'source_id'),
      sourceType: stringValue(row, 'source_type') as SourceType,
      independence: stringValue(row, 'independence') as SourceIndependence,
    }));
}

export function recordPropositionAssessment(
  db: DatabaseSync,
  projectId: string,
  propositionId: string,
  input: PropositionAssessmentInput,
  context: WriteContext,
): PropositionAssessmentRecord {
  return withTransaction(db, () => {
    const proposition = currentPropositionRow(db, projectId, propositionId);
    if (proposition === undefined) {
      throw new AppError('NOT_FOUND', 'Proposition not found in the current revision.');
    }
    const claimStatus = stringValue(proposition, 'claim_status');
    if (!['UNDER_REVIEW', 'ASSESSED', 'DISPUTED'].includes(claimStatus)) {
      throw new AppError(
        'CONFLICT',
        'Proposition assessments require the claim to be under review.',
      );
    }
    const active = activeRelationshipsForProposition(db, projectId, propositionId).map(
      (relationship) => relationship.id,
    );
    const maxRow = db
      .prepare(
        'SELECT MAX(version) AS max_version FROM proposition_assessments WHERE proposition_id = ?',
      )
      .get(propositionId);
    const version =
      (maxRow === undefined || maxRow['max_version'] === null
        ? 0
        : numberValue(maxRow, 'max_version')) + 1;
    const id = newId('pasm');
    db.prepare(
      `INSERT INTO proposition_assessments
        (id, project_id, proposition_id, version, label, rationale, method, reviewer,
         evidence_snapshot_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'HUMAN', ?, ?, ?)`,
    ).run(
      id,
      projectId,
      propositionId,
      version,
      input.label,
      input.rationale,
      input.reviewer,
      JSON.stringify(active),
      context.at,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'proposition.assessment_recorded',
      entityType: 'proposition',
      entityId: propositionId,
      details: { assessmentId: id, version, label: input.label },
      at: context.at,
    });
    const row = db.prepare('SELECT * FROM proposition_assessments WHERE id = ?').get(id);
    if (row === undefined) {
      throw new AppError('INTERNAL_ERROR', 'The assessment could not be read after creation.');
    }
    return mapPropositionAssessment(row);
  });
}

export function listPropositionAssessments(
  db: DatabaseSync,
  projectId: string,
  propositionId: string,
): PropositionAssessmentRecord[] {
  return db
    .prepare(
      `SELECT * FROM proposition_assessments
       WHERE project_id = ? AND proposition_id = ?
       ORDER BY version ASC`,
    )
    .all(projectId, propositionId)
    .map(mapPropositionAssessment);
}
