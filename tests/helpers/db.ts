import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../src/persistence/db.ts';
import { loadMigrations, runMigrations } from '../../src/persistence/migrate.ts';

export const TEST_TIME = '2026-10-28T12:00:00.000Z';
export const TEST_ACTOR = 'Ram';
const MIGRATIONS = join(import.meta.dirname, '../../src/persistence/migrations');

export function createTestDatabase(): DatabaseSync {
  const db = openDatabase(':memory:');
  runMigrations(db, loadMigrations(MIGRATIONS));
  return db;
}

export function insertProject(
  db: DatabaseSync,
  options: { id?: string; name?: string; createdAt?: string } = {},
): string {
  const id = options.id ?? 'prj_1';
  const at = options.createdAt ?? TEST_TIME;
  db.prepare(
    `INSERT INTO projects
      (id, name, description, primary_domain, target_entity_id, visibility, lifecycle,
       owner_label, created_at, updated_at)
     VALUES (?, ?, NULL, NULL, NULL, 'LOCAL_ONLY', 'ACTIVE', ?, ?, ?)`,
  ).run(id, options.name ?? 'Aporia', TEST_ACTOR, at, at);
  return id;
}

export function insertEntity(
  db: DatabaseSync,
  options: { id?: string; projectId?: string; name?: string } = {},
): string {
  const id = options.id ?? 'ent_1';
  db.prepare(
    `INSERT INTO entities
      (id, project_id, type, canonical_name, alternate_names_json, public_urls_json,
       identity_status, identity_method, identity_scope, notes, created_at, updated_at)
     VALUES (?, ?, 'PERSON', ?, '[]', '[]', 'SELF_DECLARED', NULL, NULL, NULL, ?, ?)`,
  ).run(id, options.projectId ?? 'prj_1', options.name ?? 'Ram', TEST_TIME, TEST_TIME);
  return id;
}

export function insertClaimWithProposition(
  db: DatabaseSync,
  options: {
    projectId?: string;
    claimId?: string;
    revisionId?: string;
    propositionId?: string;
    status?: 'DECOMPOSED' | 'UNDER_REVIEW' | 'ASSESSED' | 'DISPUTED';
  } = {},
): { claimId: string; revisionId: string; propositionId: string } {
  const projectId = options.projectId ?? 'prj_1';
  const claimId = options.claimId ?? 'clm_1';
  const revisionId = options.revisionId ?? 'rev_1';
  const propositionId = options.propositionId ?? 'prp_1';
  db.prepare(
    `INSERT INTO claims (id, project_id, status, current_revision_id, created_at, updated_at)
     VALUES (?, ?, 'SUBMITTED', NULL, ?, ?)`,
  ).run(claimId, projectId, TEST_TIME, TEST_TIME);
  db.prepare(
    `INSERT INTO claim_revisions
      (id, claim_id, revision_number, text, source_url, intended_meaning, time_scope,
       locale, decomposition_version, note, created_by, created_at)
     VALUES (?, ?, 1, ?, NULL, NULL, NULL, 'en', 'manual-decomposition-v1', NULL, ?, ?)`,
  ).run(
    revisionId,
    claimId,
    'The repository contains the described feature.',
    TEST_ACTOR,
    TEST_TIME,
  );
  db.prepare('UPDATE claims SET current_revision_id = ? WHERE id = ?').run(revisionId, claimId);
  db.prepare(
    `INSERT INTO propositions
      (id, claim_revision_id, ordinal, text, subject, predicate, object_value, conditions,
       time_interval, units, evidence_requirements, expected_answer_criterion,
       ambiguity_notes, decomposition_version, created_at)
     VALUES (?, ?, 1, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL,
       'manual-decomposition-v1', ?)`,
  ).run(
    propositionId,
    revisionId,
    'The repository contains feature F.',
    'Release tag and test log.',
    TEST_TIME,
  );

  const status = options.status ?? 'UNDER_REVIEW';
  if (status !== 'DECOMPOSED') {
    db.prepare('UPDATE claims SET status = ? WHERE id = ?').run('DECOMPOSED', claimId);
    if (status === 'UNDER_REVIEW') {
      db.prepare('UPDATE claims SET status = ? WHERE id = ?').run('UNDER_REVIEW', claimId);
    } else if (status === 'ASSESSED') {
      db.prepare('UPDATE claims SET status = ? WHERE id = ?').run('UNDER_REVIEW', claimId);
      db.prepare('UPDATE claims SET status = ? WHERE id = ?').run('ASSESSED', claimId);
    } else if (status === 'DISPUTED') {
      db.prepare('UPDATE claims SET status = ? WHERE id = ?').run('UNDER_REVIEW', claimId);
      db.prepare('UPDATE claims SET status = ? WHERE id = ?').run('DISPUTED', claimId);
    }
  }
  return { claimId, revisionId, propositionId };
}

export function insertSource(
  db: DatabaseSync,
  options: {
    id?: string;
    projectId?: string;
    title?: string;
    sourceType?: string;
    independence?: string;
  } = {},
): string {
  const id = options.id ?? 'src_1';
  db.prepare(
    `INSERT INTO sources
      (id, project_id, title, canonical_uri, publisher, author, source_type, access_route,
       retrieved_at, publication_date, language, independence, notes, access_status, created_at)
     VALUES (?, ?, ?, NULL, NULL, NULL, ?, 'MANUAL_ENTRY', ?, NULL, 'en', ?, NULL,
       'NOT_CHECKED', ?)`,
  ).run(
    id,
    options.projectId ?? 'prj_1',
    options.title ?? 'Release archive',
    options.sourceType ?? 'PRIMARY_ARTIFACT',
    TEST_TIME,
    options.independence ?? 'INDEPENDENT',
    TEST_TIME,
  );
  return id;
}

export function insertEvidenceWithRelation(
  db: DatabaseSync,
  options: {
    evidenceId?: string;
    relationshipId?: string;
    projectId?: string;
    sourceId?: string;
    propositionId?: string;
    relation?: string;
    excerpt?: string;
    rationale?: string;
  } = {},
): { evidenceId: string; relationshipId: string } {
  const evidenceId = options.evidenceId ?? 'evd_1';
  const relationshipId = options.relationshipId ?? 'rel_1';
  const projectId = options.projectId ?? 'prj_1';
  const excerpt = options.excerpt ?? 'The release contains feature F.';
  db.prepare(
    `INSERT INTO evidence_items
      (id, project_id, source_id, locator, excerpt, extraction_method, extracted_at,
       provenance, excerpt_digest, created_at)
     VALUES (?, ?, ?, 'README section 1', ?, 'PASTED_TEXT', ?, 'USER_SUPPLIED', ?, ?)`,
  ).run(
    evidenceId,
    projectId,
    options.sourceId ?? 'src_1',
    excerpt,
    TEST_TIME,
    createHash('sha256').update(excerpt, 'utf8').digest('hex'),
    TEST_TIME,
  );
  db.prepare(
    `INSERT INTO evidence_relationships
      (id, project_id, evidence_id, proposition_id, relation, rationale, reviewer, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'Ram', ?)`,
  ).run(
    relationshipId,
    projectId,
    evidenceId,
    options.propositionId ?? 'prp_1',
    options.relation ?? 'SUPPORTS',
    options.rationale ?? 'The passage directly supports the proposition.',
    TEST_TIME,
  );
  return { evidenceId, relationshipId };
}

export function insertQuerySet(
  db: DatabaseSync,
  options: {
    id?: string;
    projectId?: string;
    name?: string;
    version?: number;
    status?: 'DRAFT' | 'APPROVED';
    supersedesId?: string | null;
  } = {},
): string {
  const id = options.id ?? 'qst_1';
  const status = options.status ?? 'DRAFT';
  db.prepare(
    `INSERT INTO query_sets
      (id, project_id, name, version, status, description, locale, approved_by, approved_at,
       approval_note, supersedes_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, 'en', ?, ?, NULL, ?, ?, ?)`,
  ).run(
    id,
    options.projectId ?? 'prj_1',
    options.name ?? 'Core discovery',
    options.version ?? 1,
    status,
    status === 'APPROVED' ? TEST_ACTOR : null,
    status === 'APPROVED' ? TEST_TIME : null,
    options.supersedesId ?? null,
    TEST_TIME,
    TEST_TIME,
  );
  return id;
}

export function insertQuery(
  db: DatabaseSync,
  options: {
    id?: string;
    querySetId?: string;
    ordinal?: number;
    text?: string;
    intent?: string;
    branded?: boolean;
  } = {},
): string {
  const id = options.id ?? 'qry_1';
  db.prepare(
    `INSERT INTO queries
      (id, query_set_id, ordinal, text, intent, locale, region, branded,
       expected_elements, inclusion_rationale, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, 'Project A and its creator.', 'Baseline.', ?)`,
  ).run(
    id,
    options.querySetId ?? 'qst_1',
    options.ordinal ?? 1,
    options.text ?? 'What is Project A?',
    options.intent ?? 'IDENTITY',
    options.branded ? 1 : 0,
    TEST_TIME,
  );
  return id;
}

export function approveQuerySet(
  db: DatabaseSync,
  options: { querySetId?: string; reviewer?: string; at?: string } = {},
): void {
  db.prepare(
    `UPDATE query_sets
     SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    options.reviewer ?? TEST_ACTOR,
    options.at ?? TEST_TIME,
    options.at ?? TEST_TIME,
    options.querySetId ?? 'qst_1',
  );
}

export function insertRun(
  db: DatabaseSync,
  options: {
    id?: string;
    projectId?: string;
    querySetId?: string;
    name?: string;
    status?: 'OPEN' | 'FINALIZED' | 'CANCELLED';
  } = {},
): string {
  const id = options.id ?? 'run_1';
  const querySetId = options.querySetId ?? 'qst_1';
  const set = db.prepare('SELECT name, version FROM query_sets WHERE id = ?').get(querySetId) as
    Record<string, unknown> | undefined;
  if (set === undefined) {
    throw new Error('Test helper requires a query set.');
  }
  const status = options.status ?? 'OPEN';
  db.prepare(
    `INSERT INTO runs
      (id, project_id, query_set_id, query_set_name, query_set_version, name,
       provider_label, model_label, interface_label, grounding_mode, locale, region,
       capture_from, capture_to, conditions, notes, status, created_by, created_at,
       finalized_at, cancelled_at, cancel_reason)
     VALUES (?, ?, ?, ?, ?, ?, 'Manual assistant', 'unknown-model', 'Consumer interface',
       'SEARCH_GROUNDED', 'en', NULL, ?, ?, 'Manual capture under default settings.', NULL,
       ?, ?, ?, NULL, NULL, NULL)`,
  ).run(
    id,
    options.projectId ?? 'prj_1',
    querySetId,
    String(set['name']),
    Number(set['version']),
    options.name ?? 'Manual baseline',
    TEST_TIME,
    TEST_TIME,
    status,
    TEST_ACTOR,
    TEST_TIME,
  );
  return id;
}

export function insertObservation(
  db: DatabaseSync,
  options: {
    id?: string;
    runId?: string;
    queryId?: string;
    status?: string;
    answerText?: string;
    errorNote?: string;
    citationCapture?: 'CAPTURED' | 'NOT_SHOWN' | 'UNKNOWN';
  } = {},
): string {
  const id = options.id ?? 'obs_1';
  const queryId = options.queryId ?? 'qry_1';
  const query = db
    .prepare('SELECT ordinal, text, intent FROM queries WHERE id = ?')
    .get(queryId) as Record<string, unknown> | undefined;
  if (query === undefined) {
    throw new Error('Test helper requires a query.');
  }
  const status = options.status ?? 'COMPLETED';
  const requiresAnswer = ['COMPLETED', 'REFUSAL', 'NO_ANSWER'].includes(status);
  db.prepare(
    `INSERT INTO observations
      (id, run_id, query_id, query_ordinal, query_text_snapshot, query_intent_snapshot,
       status, captured_at, answer_text, error_note, citation_capture, context_notes,
       voided_at, void_reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`,
  ).run(
    id,
    options.runId ?? 'run_1',
    queryId,
    Number(query['ordinal']),
    String(query['text']),
    String(query['intent']),
    status,
    TEST_TIME,
    requiresAnswer ? (options.answerText ?? 'Project A was created by Ram.') : null,
    requiresAnswer ? (options.errorNote ?? null) : (options.errorNote ?? 'Capture failed.'),
    options.citationCapture ?? 'CAPTURED',
    TEST_TIME,
  );
  return id;
}

export function insertCitation(
  db: DatabaseSync,
  options: {
    id?: string;
    observationId?: string;
    position?: number;
    url?: string;
    title?: string;
    targetOwned?: boolean;
  } = {},
): string {
  const id = options.id ?? 'cit_1';
  db.prepare(
    `INSERT INTO citations
      (id, observation_id, position, url, title, snippet, target_owned, voided_at,
       void_reason, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?)`,
  ).run(
    id,
    options.observationId ?? 'obs_1',
    options.position ?? 1,
    options.url ?? 'https://example.com/source',
    options.title ?? 'Source',
    options.targetOwned ? 1 : 0,
    TEST_TIME,
  );
  return id;
}

export function insertPropositionAssessment(
  db: DatabaseSync,
  options: {
    id?: string;
    projectId?: string;
    propositionId?: string;
    version?: number;
    label?: string;
    rationale?: string;
    evidenceSnapshot?: readonly string[];
  } = {},
): string {
  const id = options.id ?? 'pasm_1';
  db.prepare(
    `INSERT INTO proposition_assessments
      (id, project_id, proposition_id, version, label, rationale, method, reviewer,
       evidence_snapshot_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'HUMAN', ?, ?, ?)`,
  ).run(
    id,
    options.projectId ?? 'prj_1',
    options.propositionId ?? 'prp_1',
    options.version ?? 1,
    options.label ?? 'SUPPORTED_WITHIN_SCOPE',
    options.rationale ?? 'The release artifact supports the proposition.',
    TEST_ACTOR,
    JSON.stringify(options.evidenceSnapshot ?? ['rel_1']),
    TEST_TIME,
  );
  return id;
}

export function insertObservationAssessment(
  db: DatabaseSync,
  options: {
    id?: string;
    projectId?: string;
    observationId?: string;
    dimension?: string;
    version?: number;
    label?: string;
    rationale?: string;
    attributionRole?: string | null;
  } = {},
): string {
  const id = options.id ?? 'oasm_1';
  db.prepare(
    `INSERT INTO observation_assessments
      (id, project_id, observation_id, dimension, version, label, rationale, reviewer,
       attribution_role, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
  ).run(
    id,
    options.projectId ?? 'prj_1',
    options.observationId ?? 'obs_1',
    options.dimension ?? 'PRESENCE',
    options.version ?? 1,
    options.label ?? 'MENTIONED',
    options.rationale ?? 'The answer names the entity.',
    TEST_ACTOR,
    options.attributionRole ?? null,
    TEST_TIME,
  );
  return id;
}

export function insertWebsiteAudit(
  db: DatabaseSync,
  options: {
    id?: string;
    projectId?: string;
    label?: string;
    inputMethod?: 'PASTED' | 'UPLOADED';
    filename?: string | null;
    html?: string;
  } = {},
): string {
  const id = options.id ?? 'wsa_1';
  const html =
    options.html ?? '<html><head><title>Example</title></head><body><h1>Example</h1></body></html>';
  const hash = createHash('sha256').update(html, 'utf8').digest('hex');
  db.prepare(
    `INSERT INTO website_audits
      (id, project_id, label, input_method, input_filename, content_hash, byte_length,
       html_snapshot, audited_at, methodology_version, findings_json,
       unavailable_checks_json, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local-html-audit-v1', '[]', '[]', '{}', ?)`,
  ).run(
    id,
    options.projectId ?? 'prj_1',
    options.label ?? 'Homepage snapshot',
    options.inputMethod ?? 'PASTED',
    options.filename ?? null,
    hash,
    Buffer.byteLength(html, 'utf8'),
    html,
    TEST_TIME,
    TEST_TIME,
  );
  return id;
}

export function insertReport(
  db: DatabaseSync,
  options: {
    id?: string;
    projectId?: string;
    reportNumber?: number;
    title?: string;
    supersededBy?: string | null;
  } = {},
): string {
  const id = options.id ?? 'rep_1';
  db.prepare(
    `INSERT INTO reports
      (id, project_id, report_number, title, generated_at, snapshot_version,
       methodology_version, metrics_version, evidence_rule_version, snapshot_json,
       superseded_by_report_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'report-snapshot-v1', 'methodology-2026-10-28', 'metrics-v1',
       'evidence-aggregation-v1', '{"schemaVersion":"report-snapshot-v1"}', ?, ?)`,
  ).run(
    id,
    options.projectId ?? 'prj_1',
    options.reportNumber ?? 1,
    options.title ?? 'Evaluation report 1',
    TEST_TIME,
    options.supersededBy ?? null,
    TEST_TIME,
  );
  return id;
}
