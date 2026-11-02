/**
 * The portable project record must carry the remediation backlog and its measurements.
 *
 * `project-export-v1` predates findings: it exported claims, sources, runs, audits, reports and
 * achievements, but not `remediation_findings` or the retest comparisons recorded against them, so an
 * operator who exported and then wiped the data directory lost the backlog while the export looked
 * complete. v0.4 added a durable focus metric and a status bound to a specific comparison (§4.1, §4.2),
 * and those are exactly the fields a portable record has to keep — otherwise a restored copy cannot
 * explain why a finding was called improved.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import { closeDatabase } from '../../src/persistence/db.ts';
import { createProject } from '../../src/persistence/repositories/projects.ts';
import {
  addQuery,
  approveQuerySet,
  createQuerySet,
} from '../../src/persistence/repositories/querySets.ts';
import {
  addObservation,
  createRun,
  finalizeRun,
  recordObservationAssessment,
} from '../../src/persistence/repositories/runs.ts';
import {
  createFinding,
  recordRetestComparison,
  transitionFinding,
  type ComparisonRecord,
  type FindingRecord,
} from '../../src/persistence/repositories/findings.ts';
import { exportProject } from '../../src/app/reportingService.ts';
import type { WriteContext } from '../../src/persistence/repositories/context.ts';
import { createTestDatabase, TEST_TIME } from '../helpers/db.ts';

const CONTEXT: WriteContext = { actor: 'Ram', at: TEST_TIME };

function capture(
  db: DatabaseSync,
  projectId: string,
  querySetId: string,
  queryId: string,
  runName: string,
): string {
  const run = createRun(
    db,
    projectId,
    // Both captures use the same approved set, so the comparison is allowed to call them comparable.
    querySetId,
    {
      name: runName,
      providerLabel: 'Example assistant',
      modelLabel: 'unknown',
      interfaceLabel: 'Consumer interface',
      groundingMode: 'SEARCH_GROUNDED',
      locale: 'en',
      region: undefined,
      captureFrom: '2026-11-02T10:00:00.000Z',
      captureTo: '2026-11-02T11:00:00.000Z',
      conditions: 'Manual capture; default settings.',
      notes: undefined,
    },
    CONTEXT,
  );
  const observation = addObservation(
    db,
    projectId,
    run.run.id,
    {
      queryId,
      status: 'COMPLETED',
      capturedAt: '2026-11-02T10:30:00.000Z',
      answerText: 'Aporia contains feature F.',
      errorNote: undefined,
      citationCapture: 'NOT_SHOWN',
      contextNotes: undefined,
    },
    CONTEXT,
  );
  recordObservationAssessment(
    db,
    projectId,
    run.run.id,
    observation.id,
    {
      dimension: 'PRESENCE',
      label: 'MENTIONED',
      rationale: 'The answer names Aporia.',
      reviewer: 'Ram',
      attributionRole: undefined,
    },
    CONTEXT,
  );
  finalizeRun(db, projectId, run.run.id, CONTEXT);
  return run.run.id;
}

test('the project export carries the finding, its cited comparison, and the status that cites it', () => {
  const db = createTestDatabase();
  try {
    const project = createProject(
      db,
      {
        name: 'Exported backlog',
        description: undefined,
        primaryDomain: undefined,
        targetEntity: { name: 'Aporia', type: 'PROJECT_ARTIFACT' },
      },
      CONTEXT,
    );
    const projectId = project.project.id;
    const set = createQuerySet(
      db,
      projectId,
      { name: 'Core discovery', description: undefined, locale: 'en' },
      CONTEXT,
    );
    const query = addQuery(
      db,
      projectId,
      set.set.id,
      {
        text: 'What is Aporia?',
        intent: 'DESCRIPTION',
        locale: undefined,
        region: undefined,
        branded: false,
        expectedElements: 'Aporia and its feature.',
        inclusionRationale: 'Baseline.',
      },
      CONTEXT,
    );
    approveQuerySet(db, projectId, set.set.id, { reviewer: 'Ram', note: undefined }, CONTEXT);
    const baseRunId = capture(db, projectId, set.set.id, query.id, 'First capture');
    const laterRunId = capture(db, projectId, set.set.id, query.id, 'Later capture');

    let finding: FindingRecord = createFinding(
      db,
      projectId,
      {
        title: 'The feature is not mentioned',
        observedIssue: 'The earlier answer omitted the feature name.',
        supportingEvidence: 'One captured answer against the recorded claim.',
        cause: 'MODEL_MISREAD_OR_OMISSION',
        severity: 'MEDIUM',
        severityRationale: 'A reader looking for the feature may miss it entirely.',
        recommendedAction: 'Name the feature in the first sentence.',
        ownerLabel: 'Ram',
        firstObservedAt: '2026-11-02T10:00:00.000Z',
        lastObservedAt: '2026-11-02T11:00:00.000Z',
        references: [],
      },
      CONTEXT,
    );
    for (const status of ['ACCEPTED', 'IN_PROGRESS', 'RETEST_REQUIRED'] as const) {
      finding = transitionFinding(
        db,
        projectId,
        finding.id,
        { status, note: `Moved to ${status} while verifying the export.` },
        CONTEXT,
      );
    }
    finding = recordRetestComparison(
      db,
      projectId,
      finding.id,
      { baseRunId, laterRunId, focusMetric: 'mention_rate' },
      CONTEXT,
    );
    const comparison: ComparisonRecord | undefined = finding.comparisons[0];
    assert.ok(comparison, 'recording the retest stored no comparison');
    assert.equal(comparison.focusMetric, 'mention_rate');
    assert.equal(comparison.baseRunId, baseRunId);
    assert.equal(comparison.laterRunId, laterRunId);
    // A pair that cannot be compared is recorded as unable to verify, which is the only measured
    // status that does not claim movement.
    const measuredStatus =
      comparison.outcome === 'NOT_COMPARABLE' ? 'UNABLE_TO_VERIFY' : comparison.outcome;
    finding = transitionFinding(
      db,
      projectId,
      finding.id,
      {
        status: measuredStatus,
        note: 'Status taken from the comparison above.',
        comparisonId: comparison.id,
      },
      CONTEXT,
    );

    const exported = exportProject(db, projectId, CONTEXT.at);
    assert.equal(exported['schemaVersion'], 'project-export-v2');
    const findings = exported['findings'] as FindingRecord[];
    assert.equal(findings.length, 1, 'the export carries no finding');
    const exportedFinding = findings[0];
    assert.equal(exportedFinding?.id, finding.id);
    assert.equal(exportedFinding?.status, measuredStatus);
    const exportedComparison = exportedFinding?.comparisons[0];
    assert.ok(exportedComparison, 'the export lost the recorded comparison');
    assert.equal(exportedComparison.focusMetric, 'mention_rate');
    assert.equal(exportedComparison.ruleVersion, 'comparison-rule-v2');
    assert.ok(
      exportedComparison.deltas.some(
        (delta) =>
          delta.metricId === 'mention_rate' && delta.prior !== null && delta.current !== null,
      ),
      'the export keeps the comparison but not the figures it was decided on',
    );
    const citedUpdate = exportedFinding?.updates.find(
      (update) => update.comparisonId === exportedComparison.id,
    );
    assert.ok(
      citedUpdate,
      'the exported history does not show which comparison justified the status',
    );
    assert.equal(citedUpdate.newStatus, measuredStatus);

    // The JSON is written for a reader, so it must serialise without throwing.
    const serialised = JSON.stringify(exported);
    assert.match(serialised, /"schemaVersion":"project-export-v2"/);
    assert.match(serialised, /"focusMetric":"mention_rate"/);
  } finally {
    closeDatabase(db);
  }
});
