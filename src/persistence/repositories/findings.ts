import type { DatabaseSync } from 'node:sqlite';
import {
  isFindingTransition,
  isMeasurementOnlyStatus,
  requiresClosureRationale,
  statusAllowedForOutcome,
  type ComparisonOutcome,
  type FindingCause,
  type FindingReferenceType,
  type FindingSeverity,
  type FindingStatus,
} from '../../core/findings.ts';
import {
  CAUSAL_BOUNDARY,
  claimComparisonNote,
  comparabilityReasons,
  compareMetrics,
  COMPARISON_METRICS,
  COMPARISON_RULE_VERSION,
  FOCUS_METRICS,
  isFocusMetric,
  outcomeFromComparison,
  type FocusMetric,
  type MetricComparisonRow,
  type MetricSnapshotInput,
} from '../../core/runComparison.ts';
import type { AnswerClaimInput } from '../../core/claimMetrics.ts';
import {
  computeRunMetrics,
  narrowAssessmentInput,
  type ObservationInput,
  type QueryInput,
} from '../../core/metrics.ts';
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
import { getRunOrThrow } from './runs.ts';
import { listAnswerClaimsForObservation, currentClaimLabels } from './answerClaims.ts';

export interface FindingInput {
  readonly title: string;
  readonly observedIssue: string;
  readonly supportingEvidence: string;
  readonly cause: FindingCause;
  readonly severity: FindingSeverity;
  readonly severityRationale: string;
  readonly recommendedAction: string;
  readonly ownerLabel: string;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly reportSuggestionKey?: string;
  readonly references: readonly FindingReferenceInput[];
}

export interface FindingReferenceInput {
  readonly type: FindingReferenceType;
  readonly id: string;
}

export interface FindingUpdateRecord {
  readonly id: string;
  readonly sequence: number;
  readonly previousStatus: FindingStatus | null;
  readonly newStatus: FindingStatus | null;
  readonly note: string;
  readonly comparisonId: string | null;
  readonly actor: string;
  readonly createdAt: string;
}

export interface FindingReferenceRecord extends Partial<Record<FindingReferenceType, string>> {
  readonly id: string;
  readonly type: FindingReferenceType;
  readonly targetId: string;
  readonly createdAt: string;
}

export interface ComparisonRecord {
  readonly id: string;
  readonly findingId: string | null;
  readonly baseRunId: string;
  readonly laterRunId: string;
  readonly comparable: boolean;
  readonly outcome: ComparisonOutcome;
  readonly reasons: readonly string[];
  readonly deltas: readonly MetricComparisonRow[];
  readonly statementNote: string | null;
  /**
   * The single metric ADR-021 says decides the outcome. Null on rows written before v0.4: those were
   * produced under the earlier comparability rule and never stored their focus metric, and a reader has
   * to be able to tell old semantics from no semantics.
   */
  readonly focusMetric: string | null;
  readonly focusLabel: string | null;
  readonly ruleVersion: string | null;
  readonly baseMetricsVersion: string | null;
  readonly laterMetricsVersion: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
}

export interface FindingRecord {
  readonly id: string;
  readonly projectId: string;
  readonly referenceNumber: number;
  readonly reference: string;
  readonly title: string;
  readonly observedIssue: string;
  readonly supportingEvidence: string;
  readonly cause: FindingCause;
  readonly severity: FindingSeverity;
  readonly severityRationale: string;
  readonly recommendedAction: string;
  readonly ownerLabel: string;
  readonly status: FindingStatus;
  readonly statusRationale: string | null;
  readonly reportSuggestionKey: string | null;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly references: readonly FindingReferenceRecord[];
  readonly updates: readonly FindingUpdateRecord[];
  readonly comparisons: readonly ComparisonRecord[];
}

const REFERENCE_COLUMNS: Record<FindingReferenceType, string> = {
  claim: 'claim_id',
  proposition: 'proposition_id',
  query: 'query_id',
  run: 'run_id',
  observation: 'observation_id',
  answer_claim: 'answer_claim_id',
  citation: 'citation_id',
  website_audit: 'website_audit_id',
  report_suggestion: 'report_suggestion_key',
};

function mapUpdate(row: Row): FindingUpdateRecord {
  return {
    id: stringValue(row, 'id'),
    sequence: numberValue(row, 'sequence'),
    previousStatus:
      row['previous_status'] === null
        ? null
        : (stringValue(row, 'previous_status') as FindingStatus),
    newStatus:
      row['new_status'] === null ? null : (stringValue(row, 'new_status') as FindingStatus),
    note: stringValue(row, 'note'),
    comparisonId: nullableStringValue(row, 'comparison_id'),
    actor: stringValue(row, 'actor'),
    createdAt: stringValue(row, 'created_at'),
  };
}

function mapReferences(row: Row): FindingReferenceRecord[] {
  const found: FindingReferenceRecord[] = [];
  for (const [type, column] of Object.entries(REFERENCE_COLUMNS)) {
    if (type === 'report_suggestion') {
      continue;
    }
    const value = row[column];
    if (typeof value === 'string' && value.length > 0) {
      found.push({
        id: stringValue(row, 'id'),
        type: type as FindingReferenceType,
        targetId: value,
        createdAt: stringValue(row, 'created_at'),
        [type]: value,
      });
    }
  }
  return found;
}

function mapComparison(row: Row): ComparisonRecord {
  return {
    id: stringValue(row, 'id'),
    findingId: nullableStringValue(row, 'finding_id'),
    baseRunId: stringValue(row, 'base_run_id'),
    laterRunId: stringValue(row, 'later_run_id'),
    comparable: booleanValue(row, 'comparable'),
    outcome: stringValue(row, 'outcome') as ComparisonOutcome,
    reasons: jsonValue<readonly string[]>(row, 'reasons_json'),
    deltas: jsonValue<readonly MetricComparisonRow[]>(row, 'deltas_json'),
    statementNote: nullableStringValue(row, 'statement_note'),
    focusMetric: nullableStringValue(row, 'focus_metric'),
    focusLabel: nullableStringValue(row, 'focus_label'),
    ruleVersion: nullableStringValue(row, 'rule_version'),
    baseMetricsVersion: nullableStringValue(row, 'base_metrics_version'),
    laterMetricsVersion: nullableStringValue(row, 'later_metrics_version'),
    createdBy: stringValue(row, 'created_by'),
    createdAt: stringValue(row, 'created_at'),
  };
}

function mapFinding(row: Row): FindingRecord {
  const number = numberValue(row, 'reference_number');
  return {
    id: stringValue(row, 'id'),
    projectId: stringValue(row, 'project_id'),
    referenceNumber: number,
    reference: `F-${String(number).padStart(4, '0')}`,
    title: stringValue(row, 'title'),
    observedIssue: stringValue(row, 'observed_issue'),
    supportingEvidence: stringValue(row, 'supporting_evidence'),
    cause: stringValue(row, 'cause') as FindingCause,
    severity: stringValue(row, 'severity') as FindingSeverity,
    severityRationale: stringValue(row, 'severity_rationale'),
    recommendedAction: stringValue(row, 'recommended_action'),
    ownerLabel: stringValue(row, 'owner_label'),
    status: stringValue(row, 'status') as FindingStatus,
    statusRationale: nullableStringValue(row, 'status_rationale'),
    reportSuggestionKey: nullableStringValue(row, 'report_suggestion_key'),
    firstObservedAt: stringValue(row, 'first_observed_at'),
    lastObservedAt: stringValue(row, 'last_observed_at'),
    createdBy: stringValue(row, 'created_by'),
    createdAt: stringValue(row, 'created_at'),
    updatedAt: stringValue(row, 'updated_at'),
    references: [],
    updates: [],
    comparisons: [],
  };
}

function loadDetail(db: DatabaseSync, finding: FindingRecord): FindingRecord {
  const references = db
    .prepare('SELECT * FROM finding_references WHERE finding_id = ? ORDER BY created_at, rowid')
    .all(finding.id)
    .flatMap(mapReferences);
  const updates = db
    .prepare('SELECT * FROM finding_updates WHERE finding_id = ? ORDER BY sequence ASC')
    .all(finding.id)
    .map(mapUpdate);
  const comparisons = db
    .prepare(
      'SELECT * FROM retest_comparisons WHERE finding_id = ? ORDER BY created_at DESC, rowid DESC',
    )
    .all(finding.id)
    .map(mapComparison);
  return { ...finding, references, updates, comparisons };
}

export function getFinding(
  db: DatabaseSync,
  projectId: string,
  findingId: string,
): FindingRecord | null {
  const row = db
    .prepare('SELECT * FROM remediation_findings WHERE project_id = ? AND id = ?')
    .get(projectId, findingId);
  return row === undefined ? null : loadDetail(db, mapFinding(row));
}

export function getFindingOrThrow(
  db: DatabaseSync,
  projectId: string,
  findingId: string,
): FindingRecord {
  const finding = getFinding(db, projectId, findingId);
  if (finding === null) {
    throw new AppError('NOT_FOUND', 'Remediation finding not found.');
  }
  return finding;
}

export function listFindings(
  db: DatabaseSync,
  projectId: string,
  filter: { readonly status?: FindingStatus } = {},
): FindingRecord[] {
  const rows =
    filter.status === undefined
      ? db
          .prepare(
            'SELECT * FROM remediation_findings WHERE project_id = ? ORDER BY reference_number DESC',
          )
          .all(projectId)
      : db
          .prepare(
            `SELECT * FROM remediation_findings
             WHERE project_id = ? AND status = ?
             ORDER BY reference_number DESC`,
          )
          .all(projectId, filter.status);
  return rows.map((row) => loadDetail(db, mapFinding(row)));
}

function nextReferenceNumber(db: DatabaseSync, projectId: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(MAX(reference_number), 0) AS highest FROM remediation_findings WHERE project_id = ?`,
    )
    .get(projectId) as Row;
  return numberValue(row, 'highest') + 1;
}

/**
 * Keep a written note inside the bounds the schema enforces.
 *
 * Notes arrive from a form. Letting a blank or oversized one reach the database would surface a raw
 * CHECK failure to an operator who has no way to read the schema.
 */
function checkedNote(value: string, field: string): string {
  const text = value.trim();
  if (text.length < 3) {
    throw new AppError('INVALID_INPUT', `${field} needs at least 3 characters.`);
  }
  if (text.length > 4000) {
    throw new AppError('INVALID_INPUT', `${field} must be 4000 characters or fewer.`);
  }
  return text;
}

function insertReference(
  db: DatabaseSync,
  projectId: string,
  findingId: string,
  reference: FindingReferenceInput,
  at: string,
): void {
  const column = REFERENCE_COLUMNS[reference.type];
  if (column === 'report_suggestion_key') {
    throw new AppError(
      'INVALID_INPUT',
      'A report suggestion is recorded on the finding itself, not as a reference row.',
    );
  }
  db.prepare(
    `INSERT INTO finding_references (id, project_id, finding_id, ${column}, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(newId('fndr'), projectId, findingId, reference.id, at);
}

export function createFinding(
  db: DatabaseSync,
  projectId: string,
  input: FindingInput,
  context: WriteContext,
): FindingRecord {
  return withTransaction(db, () => {
    const id = newId('fnd');
    const number = nextReferenceNumber(db, projectId);
    db.prepare(
      `INSERT INTO remediation_findings
        (id, project_id, reference_number, title, observed_issue, supporting_evidence, cause,
         severity, severity_rationale, recommended_action, owner_label, status, status_rationale,
         report_suggestion_key, first_observed_at, last_observed_at, lifecycle_version,
         created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', NULL, ?, ?, ?, 'finding-lifecycle-v1', ?, ?, ?)`,
    ).run(
      id,
      projectId,
      number,
      input.title,
      input.observedIssue,
      input.supportingEvidence,
      input.cause,
      input.severity,
      input.severityRationale,
      input.recommendedAction,
      input.ownerLabel,
      input.reportSuggestionKey ?? null,
      input.firstObservedAt,
      input.lastObservedAt,
      context.actor,
      context.at,
      context.at,
    );
    for (const reference of input.references) {
      insertReference(db, projectId, id, reference, context.at);
    }
    db.prepare(
      `INSERT INTO finding_updates
        (id, project_id, finding_id, sequence, previous_status, new_status, note, comparison_id,
         actor, created_at)
       VALUES (?, ?, ?, 1, NULL, 'OPEN', ?, NULL, ?, ?)`,
    ).run(
      newId('fndu'),
      projectId,
      id,
      `Recorded as ${input.severity} and left open.`,
      context.actor,
      context.at,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'finding.created',
      entityType: 'remediation_finding',
      entityId: id,
      details: { referenceNumber: number, severity: input.severity, cause: input.cause },
      at: context.at,
    });
    return getFindingOrThrow(db, projectId, id);
  });
}

/**
 * Move a finding to a new status.
 *
 * A measured status is refused here as well as by the database, so the user-facing reason can name the
 * comparison that is missing rather than surfacing a raw constraint failure.
 */
export function transitionFinding(
  db: DatabaseSync,
  projectId: string,
  findingId: string,
  input: {
    readonly status: FindingStatus;
    readonly note: string;
    readonly rationale?: string;
    readonly comparisonId?: string;
  },
  context: WriteContext,
): FindingRecord {
  return withTransaction(db, () => {
    const finding = getFindingOrThrow(db, projectId, findingId);
    if (!isFindingTransition(finding.status, input.status)) {
      throw new AppError(
        'CONFLICT',
        `A finding cannot move directly from ${finding.status} to ${input.status}.`,
      );
    }
    if (requiresClosureRationale(input.status) && (input.rationale ?? '').trim().length < 3) {
      throw new AppError('INVALID_INPUT', 'Closing a finding requires a written rationale.');
    }
    const sequence = finding.updates.reduce((max, update) => Math.max(max, update.sequence), 0) + 1;
    const note = checkedNote(input.note, 'This note');
    const rationale =
      input.rationale === undefined ? null : checkedNote(input.rationale, 'The rationale');
    if (isMeasurementOnlyStatus(input.status)) {
      // The cited comparison is the justification, so it is the thing that gets checked. The v0.3 rule
      // accepted *some* acceptable comparison on the finding while writing whatever id the caller
      // supplied, which let a valid comparison elsewhere stand behind a citation of an unrelated one.
      const cited =
        input.comparisonId === undefined
          ? undefined
          : finding.comparisons.find((comparison) => comparison.id === input.comparisonId);
      if (cited === undefined) {
        if (input.comparisonId === undefined) {
          throw new AppError(
            'CONFLICT',
            `${input.status} must cite the retest comparison that measured it. Record the retest first.`,
          );
        }
        throw new AppError(
          'CONFLICT',
          `"${input.comparisonId}" is not a comparison on this finding in this project, so it cannot justify ${input.status}.`,
        );
      }
      if (!statusAllowedForOutcome(input.status, cited.outcome)) {
        throw new AppError(
          'CONFLICT',
          `The cited comparison recorded ${cited.outcome}, which cannot justify ${input.status}. Choose the status the measurement actually supports.`,
        );
      }
    } else if (input.comparisonId !== undefined) {
      // A citation on any other transition is still a claim about a specific record, and a dangling one
      // is a defect even when the status itself needs no measurement.
      const cited = finding.comparisons.find((comparison) => comparison.id === input.comparisonId);
      if (cited === undefined) {
        throw new AppError(
          'CONFLICT',
          `"${input.comparisonId}" is not a comparison on this finding in this project.`,
        );
      }
    }
    // The history row is written first because the schema refuses a status change that has no entry
    // recorded at the same instant; ordering it the other way round would deadlock the transaction.
    db.prepare(
      `INSERT INTO finding_updates
        (id, project_id, finding_id, sequence, previous_status, new_status, note, comparison_id,
         actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId('fndu'),
      projectId,
      findingId,
      sequence,
      finding.status,
      input.status,
      note,
      input.comparisonId ?? null,
      context.actor,
      context.at,
    );
    db.prepare(
      'UPDATE remediation_findings SET status = ?, status_rationale = ?, updated_at = ? WHERE id = ?',
    ).run(input.status, rationale, context.at, findingId);
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'finding.transitioned',
      entityType: 'remediation_finding',
      entityId: findingId,
      details: { from: finding.status, to: input.status, comparisonId: input.comparisonId ?? null },
      at: context.at,
    });
    return getFindingOrThrow(db, projectId, findingId);
  });
}

export function updateFindingDetails(
  db: DatabaseSync,
  projectId: string,
  findingId: string,
  input: {
    readonly severity?: FindingSeverity;
    readonly cause?: FindingCause;
    readonly recommendedAction?: string;
    readonly ownerLabel?: string;
    readonly lastObservedAt?: string;
    readonly note: string;
  },
  context: WriteContext,
): FindingRecord {
  return withTransaction(db, () => {
    const finding = getFindingOrThrow(db, projectId, findingId);
    const sequence = finding.updates.reduce((max, update) => Math.max(max, update.sequence), 0) + 1;
    const note = checkedNote(input.note, 'This note');
    // The trigger refuses a severity or cause change that has no history entry written at the same
    // instant, so the entry goes in first and the row is amended inside the same transaction.
    db.prepare(
      `INSERT INTO finding_updates
        (id, project_id, finding_id, sequence, previous_status, new_status, note, comparison_id,
         actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).run(
      newId('fndu'),
      projectId,
      findingId,
      sequence,
      finding.status,
      finding.status,
      note,
      context.actor,
      context.at,
    );
    db.prepare(
      'UPDATE remediation_findings SET severity = ?, cause = ?, recommended_action = ?, owner_label = ?, last_observed_at = ?, updated_at = ? WHERE id = ?',
    ).run(
      input.severity ?? finding.severity,
      input.cause ?? finding.cause,
      input.recommendedAction ?? finding.recommendedAction,
      input.ownerLabel ?? finding.ownerLabel,
      input.lastObservedAt ?? finding.lastObservedAt,
      context.at,
      findingId,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'finding.updated',
      entityType: 'remediation_finding',
      entityId: findingId,
      details: { severity: input.severity ?? null, cause: input.cause ?? null },
      at: context.at,
    });
    return getFindingOrThrow(db, projectId, findingId);
  });
}

export function addFindingReference(
  db: DatabaseSync,
  projectId: string,
  findingId: string,
  reference: FindingReferenceInput,
  context: WriteContext,
): FindingRecord {
  return withTransaction(db, () => {
    const finding = getFindingOrThrow(db, projectId, findingId);
    insertReference(db, projectId, finding.id, reference, context.at);
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'finding.referenced',
      entityType: 'remediation_finding',
      entityId: finding.id,
      details: { type: reference.type, targetId: reference.id },
      at: context.at,
    });
    return getFindingOrThrow(db, projectId, finding.id);
  });
}

export function removeFindingReference(
  db: DatabaseSync,
  projectId: string,
  findingId: string,
  referenceId: string,
  context: WriteContext,
): FindingRecord {
  return withTransaction(db, () => {
    const finding = getFindingOrThrow(db, projectId, findingId);
    const row = db
      .prepare('SELECT id FROM finding_references WHERE finding_id = ? AND id = ?')
      .get(finding.id, referenceId);
    if (row === undefined) {
      throw new AppError('NOT_FOUND', 'Finding reference not found.');
    }
    db.prepare('DELETE FROM finding_references WHERE id = ?').run(referenceId);
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'finding.reference-removed',
      entityType: 'remediation_finding',
      entityId: finding.id,
      details: { referenceId },
      at: context.at,
    });
    return getFindingOrThrow(db, projectId, finding.id);
  });
}

// ---------------------------------------------------------------------------
// Reference targets: what a pointer actually points at
// ---------------------------------------------------------------------------

/**
 * The eight types stored as reference rows. `report_suggestion` is excluded because it lives on the
 * finding itself rather than in a pointer to a record that could be deleted.
 */
const REFERENCE_TARGET_TYPES = [
  'claim',
  'proposition',
  'query',
  'run',
  'observation',
  'answer_claim',
  'citation',
  'website_audit',
] as const;
type ReferenceTargetType = (typeof REFERENCE_TARGET_TYPES)[number];

/**
 * One readable description per target type, scoped to a project.
 *
 * Every query is a single indexed select that joins up to the project, ordered most recent first, so
 * an operator picks a record by the words already on screen instead of pasting an identifier. The
 * limit keeps a large project from loading thousands of options into a page; the caller renders the
 * truncation rather than hiding it. Each order ends on the id, because an ordering that ties leaves
 * the pickers shuffling between two renders of the same page.
 */
const TARGET_QUERIES: Record<ReferenceTargetType, string> = {
  claim: `SELECT c.id AS id, COALESCE(r.text, 'A claim with no current revision') AS label
    FROM claims c LEFT JOIN claim_revisions r ON r.id = c.current_revision_id
    WHERE c.project_id = ? ORDER BY c.updated_at DESC, c.id LIMIT ?`,
  proposition: `SELECT p.id AS id, p.text AS label
    FROM propositions p
    JOIN claim_revisions r ON r.id = p.claim_revision_id
    JOIN claims c ON c.id = r.claim_id
    WHERE c.project_id = ? ORDER BY p.created_at DESC, p.rowid DESC LIMIT ?`,
  query: `SELECT q.id AS id, q.text AS label
    FROM queries q JOIN query_sets s ON s.id = q.query_set_id
    WHERE s.project_id = ? ORDER BY q.created_at DESC, q.ordinal, q.id LIMIT ?`,
  run: `SELECT id, name AS label FROM runs
    WHERE project_id = ? ORDER BY created_at DESC, id LIMIT ?`,
  observation: `SELECT o.id AS id, o.query_text_snapshot AS label
    FROM observations o JOIN runs r ON r.id = o.run_id
    WHERE r.project_id = ? ORDER BY o.captured_at DESC, o.rowid LIMIT ?`,
  answer_claim: `SELECT a.id AS id, COALESCE(v.quote_text, 'A statement with no current revision') AS label
    FROM answer_claims a LEFT JOIN answer_claim_revisions v ON v.id = a.current_revision_id
    WHERE a.project_id = ? ORDER BY a.created_at DESC, a.ordinal, a.id LIMIT ?`,
  citation: `SELECT ci.id AS id, COALESCE(NULLIF(ci.title, ''), ci.url) AS label
    FROM citations ci
    JOIN observations o ON o.id = ci.observation_id
    JOIN runs r ON r.id = o.run_id
    WHERE r.project_id = ? ORDER BY ci.created_at DESC, ci.position, ci.id LIMIT ?`,
  website_audit: `SELECT id, label FROM website_audits
    WHERE project_id = ? ORDER BY audited_at DESC, id LIMIT ?`,
};

export interface ReferenceCandidate {
  readonly id: string;
  readonly label: string;
}

export interface ReferenceChoices {
  readonly items: readonly ReferenceCandidate[];
  readonly truncated: boolean;
}

function readableLabel(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length <= 90 ? collapsed : `${collapsed.slice(0, 89)}…`;
}

function choicesFor(
  db: DatabaseSync,
  type: ReferenceTargetType,
  projectId: string,
  limit: number,
): ReferenceChoices {
  const rows = db.prepare(TARGET_QUERIES[type]).all(projectId, limit + 1) as Row[];
  const truncated = rows.length > limit;
  return {
    items: (truncated ? rows.slice(0, limit) : rows).map((row) => ({
      id: stringValue(row, 'id'),
      label: readableLabel(stringValue(row, 'label')),
    })),
    truncated,
  };
}

export type ReferenceChoiceMap = Record<ReferenceTargetType, ReferenceChoices>;

export function listReferenceCandidates(
  db: DatabaseSync,
  projectId: string,
  limit = 50,
): ReferenceChoiceMap {
  const map = {} as ReferenceChoiceMap;
  for (const type of REFERENCE_TARGET_TYPES) {
    map[type] = choicesFor(db, type, projectId, limit);
  }
  return map;
}

/**
 * Readable text for the targets a finding already points at.
 *
 * A reference stores an id, never a copy of the record, so this reads what that id says today. A
 * target that no longer resolves returns null and the caller says so: a finding must not appear to
 * still describe a record that has gone.
 */
const TARGET_LOOKUPS: Record<ReferenceTargetType, string> = {
  claim: `SELECT COALESCE(r.text, 'A claim with no current revision') AS label
    FROM claims c LEFT JOIN claim_revisions r ON r.id = c.current_revision_id
    WHERE c.project_id = ? AND c.id = ?`,
  proposition: `SELECT p.text AS label
    FROM propositions p
    JOIN claim_revisions r ON r.id = p.claim_revision_id
    JOIN claims c ON c.id = r.claim_id
    WHERE c.project_id = ? AND p.id = ?`,
  query: `SELECT q.text AS label FROM queries q JOIN query_sets s ON s.id = q.query_set_id
    WHERE s.project_id = ? AND q.id = ?`,
  run: 'SELECT name AS label FROM runs WHERE project_id = ? AND id = ?',
  observation: `SELECT o.query_text_snapshot AS label FROM observations o JOIN runs r ON r.id = o.run_id
    WHERE r.project_id = ? AND o.id = ?`,
  answer_claim: `SELECT COALESCE(v.quote_text, 'A statement with no current revision') AS label
    FROM answer_claims a LEFT JOIN answer_claim_revisions v ON v.id = a.current_revision_id
    WHERE a.project_id = ? AND a.id = ?`,
  citation: `SELECT COALESCE(NULLIF(ci.title, ''), ci.url) AS label
    FROM citations ci
    JOIN observations o ON o.id = ci.observation_id
    JOIN runs r ON r.id = o.run_id
    WHERE r.project_id = ? AND ci.id = ?`,
  website_audit: 'SELECT label FROM website_audits WHERE project_id = ? AND id = ?',
};

export function referenceTargetLabels(
  db: DatabaseSync,
  projectId: string,
  references: readonly FindingReferenceRecord[],
): Map<string, string | null> {
  const found = new Map<string, string | null>();
  for (const reference of references) {
    if (!isReferenceTargetType(reference.type)) {
      continue;
    }
    const row = db.prepare(TARGET_LOOKUPS[reference.type]).get(projectId, reference.targetId) as
      Row | undefined;
    found.set(reference.id, row === undefined ? null : readableLabel(stringValue(row, 'label')));
  }
  return found;
}

function isReferenceTargetType(type: FindingReferenceType): type is ReferenceTargetType {
  return (REFERENCE_TARGET_TYPES as readonly string[]).includes(type);
}

// ---------------------------------------------------------------------------
// Retest comparison
// ---------------------------------------------------------------------------

interface MetricBearingRun {
  readonly id: string;
  readonly querySetId: string;
  readonly providerLabel: string;
  readonly modelLabel: string | null;
  readonly interfaceLabel: string;
  readonly groundingMode: string;
  readonly locale: string;
  readonly region: string | null;
  readonly metrics: Readonly<Record<string, MetricSnapshotInput>>;
  readonly observations: number;
  readonly decomposed: number;
  /** The metric definitions these numbers were produced under. */
  readonly metricsVersion: string;
  readonly conditions: string;
}

function claimInputs(
  db: DatabaseSync,
  projectId: string,
  runId: string,
): { claims: AnswerClaimInput[]; observations: number; decomposed: number } {
  const rows = db
    .prepare(
      `SELECT o.id, o.query_id, o.status, o.voided_at, o.citation_capture
       FROM observations o
       JOIN runs r ON r.id = o.run_id
       WHERE o.run_id = ? AND r.project_id = ?
       ORDER BY o.captured_at, o.rowid`,
    )
    .all(runId, projectId) as Row[];
  // One query for the whole run, so a withdrawn citation costs nothing per statement.
  const voidedCitations = new Set(
    (
      db
        .prepare(
          `SELECT id FROM citations
           WHERE voided_at IS NOT NULL
             AND observation_id IN (SELECT id FROM observations WHERE run_id = ?)`,
        )
        .all(runId) as Row[]
    ).map((row) => stringValue(row, 'id')),
  );
  const claims: AnswerClaimInput[] = [];
  let decomposed = 0;
  for (const row of rows) {
    const observationId = stringValue(row, 'id');
    const records = listAnswerClaimsForObservation(db, observationId);
    if (records.some((record) => record.voidedAt === null)) {
      decomposed += 1;
    }
    for (const record of records) {
      const labels = currentClaimLabels(record);
      // A voided statement is passed through rather than filtered out, so it is excluded by the
      // metric with a named reason. This is the same rule the report path applies, and the two must
      // not drift: a retest and a report for one finalized run cannot be allowed to disagree.
      claims.push({
        claimId: record.id,
        observationId,
        revisionId: record.currentRevisionId ?? '',
        relevance: record.currentRevision?.relevance ?? 'NOT_ASSESSABLE',
        voided: record.voidedAt !== null,
        fidelityLabel: labels.FIDELITY,
        attributionLabel: labels.ATTRIBUTION,
        citationMappings: record.citationLinks
          .filter((link) => link.supersededBy === null)
          .map((link) => ({
            citationId: link.citationId,
            support: link.support,
            citationVoided: voidedCitations.has(link.citationId),
          })),
        propositionRelations: record.propositionLinks
          .filter((link) => link.supersededBy === null)
          .map((link) => ({ propositionId: link.propositionId, relation: link.relation })),
      });
    }
  }
  return { claims, observations: rows.length, decomposed };
}

/**
 * Load a run with the metrics it currently produces.
 *
 * Only finalized runs are accepted, matching the report rule that an open or cancelled run cannot
 * contribute metrics. A cancelled run would otherwise let an abandoned capture become a baseline.
 */
function loadRunForComparison(
  db: DatabaseSync,
  projectId: string,
  runId: string,
): MetricBearingRun {
  const detail = getRunOrThrow(db, projectId, runId);
  if (detail.run.status !== 'FINALIZED') {
    throw new AppError(
      'CONFLICT',
      `Only a finalized run can be compared; run ${runId} is ${detail.run.status.toLowerCase()}.`,
    );
  }
  const queries: QueryInput[] = detail.querySet.queries.map((query) => ({
    id: query.id,
    intent: query.intent,
  }));
  const known = new Set(queries.map((query) => query.id));
  const observations: ObservationInput[] = detail.observations
    .filter((observation) => known.has(observation.queryId))
    .map((observation) => ({
      id: observation.id,
      queryId: observation.queryId,
      status: observation.status,
      voided: observation.voidedAt !== null,
      citationCapture: observation.citationCapture,
      citations: observation.citations.map((citation) => ({
        id: citation.id,
        targetOwned: citation.targetOwned,
        voided: citation.voidedAt !== null,
      })),
      assessments: observation.assessments.map((assessment) =>
        narrowAssessmentInput({
          dimension: assessment.dimension,
          version: assessment.version,
          label: assessment.label,
        }),
      ),
    }));
  const claimData = claimInputs(db, projectId, runId);
  const metrics = computeRunMetrics({
    runStatus: detail.run.status,
    queries,
    observations,
    claims: claimData.claims,
  });
  const snapshots: Record<string, MetricSnapshotInput> = {};
  const record = (metric: {
    id: string;
    label: string;
    unit: string;
    value: number | null;
    numerator: number | null;
    denominator: number;
  }): void => {
    snapshots[metric.id] = {
      label: metric.label,
      unit: metric.unit,
      value: metric.value,
      numerator: metric.numerator,
      denominator: metric.denominator,
    };
  };
  record(metrics.mentionRate);
  record(metrics.targetSourceCitationRate);
  record(metrics.anySourceCitationRate);
  record(metrics.citationSupportRate);
  record(metrics.claimFidelityRate);
  record(metrics.attributionCorrectnessRate);
  record(metrics.observedAnswerCoverage);
  if (metrics.claimLevel !== undefined) {
    record(metrics.claimLevel.decompositionCoverage);
    record(metrics.claimLevel.claimFidelityRate);
    record(metrics.claimLevel.claimContradictionRate);
    record(metrics.claimLevel.claimUnsupportedRate);
    record(metrics.claimLevel.claimCitationSupportRate);
    record(metrics.claimLevel.claimAttributionRate);
    record(metrics.claimLevel.relevantOmissionRate);
  }
  return {
    id: detail.run.id,
    querySetId: detail.run.querySetId,
    providerLabel: detail.run.providerLabel,
    modelLabel: detail.run.modelLabel,
    interfaceLabel: detail.run.interfaceLabel,
    groundingMode: detail.run.groundingMode,
    locale: detail.run.locale,
    region: detail.run.region,
    conditions: detail.run.conditions,
    metrics: snapshots,
    observations: claimData.observations,
    decomposed: claimData.decomposed,
    metricsVersion: metrics.version,
  };
}

export interface RetestComparisonPreview {
  readonly baseRunId: string;
  readonly laterRunId: string;
  readonly comparable: boolean;
  readonly reasons: readonly string[];
  readonly deltas: readonly MetricComparisonRow[];
  readonly statementNote: string | null;
  readonly outcome: ComparisonOutcome;
  readonly causalBoundary: string;
  /** The metric this comparison decides on, and the label the report gives it. */
  readonly focusMetric: string;
  readonly focusLabel: string | null;
  /** Which comparability rule produced this verdict. */
  readonly ruleVersion: string;
  readonly baseMetricsVersion: string;
  readonly laterMetricsVersion: string;
}

/**
 * Compare two runs without writing anything, so an operator can see what a retest would conclude and
 * why it may conclude nothing.
 */
export function previewRetestComparison(
  db: DatabaseSync,
  projectId: string,
  baseRunId: string,
  laterRunId: string,
  focusMetric: string,
): RetestComparisonPreview {
  if (baseRunId === laterRunId) {
    throw new AppError('INVALID_INPUT', 'A run cannot be compared with itself.');
  }
  if (!isFocusMetric(focusMetric)) {
    throw new AppError('INVALID_INPUT', 'Choose a metric the retest is about.');
  }
  const prior = loadRunForComparison(db, projectId, baseRunId);
  const current = loadRunForComparison(db, projectId, laterRunId);
  const reasons = comparabilityReasons({ prior, current });
  const comparable = reasons.length === 0;
  const deltas = compareMetrics(prior.metrics, current.metrics, [...COMPARISON_METRICS]);
  const statementNote = claimComparisonNote({
    priorObservations: prior.observations,
    priorDecomposed: prior.decomposed,
    currentObservations: current.observations,
    currentDecomposed: current.decomposed,
  });
  const outcome =
    statementNote !== null && isStatementMetric(focusMetric)
      ? 'UNABLE_TO_VERIFY'
      : outcomeFromComparison(comparable, deltas, focusMetric);
  return {
    baseRunId,
    laterRunId,
    comparable,
    reasons: [...reasons, ...(statementNote === null ? [] : [statementNote])],
    deltas,
    statementNote,
    outcome,
    causalBoundary: CAUSAL_BOUNDARY,
    focusMetric,
    focusLabel: deltas.find((row) => row.metricId === focusMetric)?.label ?? null,
    ruleVersion: COMPARISON_RULE_VERSION,
    baseMetricsVersion: prior.metricsVersion,
    laterMetricsVersion: current.metricsVersion,
  };
}

function isStatementMetric(metric: string): boolean {
  return metric.startsWith('answer_statement_') || metric === 'relevant_omission_rate';
}

/**
 * What a caller may ask a retest to record: which two runs, and which metric the finding was about.
 *
 * Nothing else. `metrics-v3`'s signature took a finished preview object and wrote its `comparable`,
 * `outcome`, `reasons` and `deltas` as given, so the repository stored whatever derived data a caller
 * supplied — a fabricated `IMPROVED` or an invented delta would have passed. The route recomputed
 * honestly, which left the trust boundary in the wrong place: an internal contract nobody enforced, and
 * no test that ever called it with a hand-made preview.
 */
export interface RetestComparisonRequest {
  readonly baseRunId: string;
  readonly laterRunId: string;
  readonly focusMetric: string;
}

export function recordRetestComparison(
  db: DatabaseSync,
  projectId: string,
  findingId: string,
  request: RetestComparisonRequest,
  context: WriteContext,
): FindingRecord {
  return withTransaction(db, () => {
    const finding = getFindingOrThrow(db, projectId, findingId);
    if (finding.status !== 'RETEST_REQUIRED') {
      throw new AppError(
        'CONFLICT',
        'A retest is recorded against a finding that is waiting for one. Move it to “retest required” first.',
      );
    }
    // Recomputed here, inside the same transaction as the write, from the persisted runs. The stored
    // row is therefore the output of the comparison code, not an echo of the request.
    const preview = previewRetestComparison(
      db,
      projectId,
      request.baseRunId,
      request.laterRunId,
      request.focusMetric,
    );
    const id = newId('rtc');
    db.prepare(
      `INSERT INTO retest_comparisons
        (id, project_id, finding_id, base_run_id, later_run_id, base_report_id, later_report_id,
         comparable, outcome, reasons_json, deltas_json, statement_note, focus_metric, focus_label,
         rule_version, base_metrics_version, later_metrics_version, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      projectId,
      findingId,
      preview.baseRunId,
      preview.laterRunId,
      preview.comparable ? 1 : 0,
      preview.outcome,
      JSON.stringify(preview.reasons),
      JSON.stringify(preview.deltas),
      preview.statementNote,
      preview.focusMetric,
      preview.focusLabel,
      preview.ruleVersion,
      preview.baseMetricsVersion,
      preview.laterMetricsVersion,
      context.actor,
      context.at,
    );
    appendAuditEvent(db, {
      projectId,
      actor: context.actor,
      action: 'finding.comparison-recorded',
      // Filed against the finding, so the finding's own audit trail shows every measurement taken for
      // it. The comparison id, the deciding metric and the rule version travel in the details.
      entityType: 'remediation_finding',
      entityId: findingId,
      details: {
        comparisonId: id,
        outcome: preview.outcome,
        focusMetric: preview.focusMetric,
        ruleVersion: preview.ruleVersion,
        comparable: preview.comparable,
      },
      at: context.at,
    });
    return getFindingOrThrow(db, projectId, findingId);
  });
}

export function availableFocusMetrics(
  db: DatabaseSync,
  projectId: string,
  runId: string,
): string[] {
  const run = loadRunForComparison(db, projectId, runId);
  // Only a metric a finding can honestly be about. Decomposition coverage is present in the
  // comparison rows as context, but offering it as a focus would sell review effort as progress.
  const focusable = new Set<string>(FOCUS_METRICS);
  return Object.keys(run.metrics).filter((metricId) => focusable.has(metricId));
}

export type { FocusMetric };
