import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { DatabaseSync } from 'node:sqlite';
import { closeDatabase, openDatabase } from '../../src/persistence/db.ts';
import { loadMigrations, runMigrations } from '../../src/persistence/migrate.ts';
import { createBackup, restoreBackup, verifyBackup } from '../../src/persistence/backup.ts';
import { renderReport } from '../../src/app/views/report.ts';
import { buildReportSnapshot } from '../../src/reporting/snapshot.ts';
import { baseInput } from '../helpers/reporting.ts';
import type { ReportSnapshot } from '../../src/reporting/types.ts';
import {
  approveQuerySet,
  insertAnswerClaim,
  insertCitation,
  insertClaimWithProposition,
  insertObservation,
  insertProject,
  insertQuery,
  insertQuerySet,
  insertRun,
  TEST_ACTOR,
  TEST_TIME,
} from '../helpers/db.ts';

/**
 * A v0.3 database, populated and then upgraded, then backed up and restored.
 *
 * Migrations are usually tested against an empty schema, which proves nothing about the case that
 * matters: a person's real data crossing the boundary where the rules changed. v0.4 added constraints
 * that existing rows would violate — an assessment whose label contradicts its relevance, a comparison
 * with no focus metric — and the correct behaviour is to leave those rows readable and stop new ones,
 * not to repair or delete history.
 *
 * Every step here runs against a file-backed database in a temporary directory, because backup and
 * restore operate on files and an in-memory database would test a path the product does not have.
 */

const MIGRATIONS = join(import.meta.dirname, '../../src/persistence/migrations');
const V03_MIGRATION_COUNT = 9;

function tempDir(): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'aporia-upgrade-'));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Build a database exactly as v0.3 left it: nine migrations, then rows written under v0.3 rules.
 *
 * The inconsistent assessment and the focus-less comparison are the two shapes v0.4 refuses. They
 * exist here on purpose, inserted while the constraints did not.
 */
function seedV03(path: string): void {
  const db = openDatabase(path);
  try {
    const all = loadMigrations(MIGRATIONS);
    assert.equal(
      all.length,
      V03_MIGRATION_COUNT + 2,
      'the release adds two migrations to v0.3 set',
    );
    runMigrations(db, all.slice(0, V03_MIGRATION_COUNT));

    insertProject(db, { id: 'prj_1' });
    insertClaimWithProposition(db, {
      projectId: 'prj_1',
      claimId: 'clm_1',
      revisionId: 'rev_1',
      propositionId: 'prp_1',
    });
    insertQuerySet(db, { projectId: 'prj_1' });
    insertQuery(db);
    approveQuerySet(db);
    insertRun(db, { projectId: 'prj_1', id: 'run_1' });
    insertObservation(db, { runId: 'run_1', id: 'obs_1', queryId: 'qry_1' });
    insertCitation(db, { observationId: 'obs_1', id: 'cit_1' });

    // A refusal carrying an accurate fidelity label: legal in v0.3, refused by migration 010.
    insertAnswerClaim(db, {
      id: 'acs_1',
      revisionId: 'acr_1',
      observationId: 'obs_1',
      relevance: 'REFUSAL',
    });
    db.prepare(
      `INSERT INTO answer_claim_assessments
        (id, project_id, claim_id, claim_revision_id, dimension, version, label, rationale,
         reviewer, attribution_subject, attribution_role, details_json, created_at)
       VALUES ('aca_legacy', 'prj_1', 'acs_1', 'acr_1', 'FIDELITY', 1, 'ACCURATE', ?, ?, NULL, NULL, '{}', ?)`,
    ).run('Stored before the eligibility contract existed.', TEST_ACTOR, TEST_TIME);

    // A comparison with no focus metric, which v0.4 requires on every new row.
    insertRun(db, { projectId: 'prj_1', id: 'run_2' });
    insertObservation(db, { runId: 'run_2', id: 'obs_2', queryId: 'qry_1' });
    db.prepare('UPDATE runs SET status = ?, finalized_at = ? WHERE id = ?').run(
      'FINALIZED',
      TEST_TIME,
      'run_1',
    );
    db.prepare('UPDATE runs SET status = ?, finalized_at = ? WHERE id = ?').run(
      'FINALIZED',
      TEST_TIME,
      'run_2',
    );
    db.prepare(
      `INSERT INTO retest_comparisons
        (id, project_id, finding_id, base_run_id, later_run_id, comparable, outcome, reasons_json,
         deltas_json, created_by, created_at)
       VALUES ('rtc_legacy', 'prj_1', NULL, 'run_1', 'run_2', 1, 'UNCHANGED', '[]',
        '[{"metricId":"mention_rate","label":"Mention rate","unit":"observations","polarity":"HIGHER_IS_BETTER","prior":1,"current":1,"priorNumerator":1,"priorDenominator":1,"currentNumerator":1,"currentDenominator":1,"delta":0,"direction":"NO_CHANGE"}]',
        ?, ?)`,
    ).run(TEST_ACTOR, TEST_TIME);

    // A stored report snapshot under the version that produced it, which the upgrade must not touch.
    // Written with a raw insert rather than the helper, because the helper stamps a metrics version
    // and this row has to carry the one a v0.3 build really wrote.
    db.prepare(
      `INSERT INTO reports
        (id, project_id, report_number, title, generated_at, snapshot_version,
         methodology_version, metrics_version, evidence_rule_version, snapshot_json,
         superseded_by_report_id, created_at)
       VALUES ('rep_v3', 'prj_1', 1, ?, ?, 'report-snapshot-v1', 'methodology-2026-10-28',
        'metrics-v3', 'evidence-aggregation-v1', ?, NULL, ?)`,
    ).run(
      'A report written under v0.3',
      TEST_TIME,
      // A complete snapshot of the shape v0.3 wrote, built through the report builder and then
      // stamped back to the v3 versions. A hand-written stub would not exercise the renderer.
      JSON.stringify(v3Snapshot()),
      TEST_TIME,
    );
  } finally {
    closeDatabase(db);
  }
}

/**
 * A real report snapshot, restamped to the versions a v0.3 build wrote.
 *
 * The renderer reads the stored JSON as it is, so the point of this fixture is that a v3 artifact
 * still parses and still prints its own figures after the schema moves on.
 */
function v3Snapshot(): Record<string, unknown> {
  const snapshot = structuredClone(buildReportSnapshot(baseInput())) as unknown as {
    templateVersion: string;
    report: { metricsVersion: string; title: string };
    runs: { metrics: { version: string; claimLevel?: Record<string, unknown> } }[];
  };
  snapshot.templateVersion = 'report-template-v3';
  snapshot.report.metricsVersion = 'metrics-v3';
  snapshot.report.title = 'A report written under v0.3';
  for (const run of snapshot.runs) {
    run.metrics.version = 'metrics-v3';
  }
  return snapshot as unknown as Record<string, unknown>;
}

function openUpgraded(path: string): DatabaseSync {
  const db = openDatabase(path);
  runMigrations(db, loadMigrations(MIGRATIONS));
  return db;
}

function appliedVersions(db: DatabaseSync): number[] {
  return (
    db.prepare('SELECT version FROM schema_migrations ORDER BY version ASC').all() as Record<
      string,
      unknown
    >[]
  ).map((row) => Number(row['version']));
}

test('a populated v0.3 database upgrades without rewriting the rows v0.4 would refuse', () => {
  const temp = tempDir();
  try {
    const path = join(temp.path, 'aporia.db');
    seedV03(path);
    const db = openUpgraded(path);
    try {
      assert.deepEqual(
        appliedVersions(db),
        Array.from({ length: V03_MIGRATION_COUNT + 2 }, (_unused, index) => index + 1),
        'every migration is recorded once',
      );

      const legacy = db
        .prepare('SELECT label, dimension FROM answer_claim_assessments WHERE id = ?')
        .get('aca_legacy') as Record<string, unknown>;
      assert.equal(legacy['label'], 'ACCURATE', 'the historical row keeps its own label');
      assert.equal(legacy['dimension'], 'FIDELITY');

      const comparison = db
        .prepare('SELECT focus_metric, rule_version FROM retest_comparisons WHERE id = ?')
        .get('rtc_legacy') as Record<string, unknown>;
      assert.equal(comparison['focus_metric'], null, 'nothing was backfilled into history');
      assert.equal(comparison['rule_version'], null);

      // The same row set is what the metric now reads, so it must be excluded rather than trusted.
      const claimRow = db
        .prepare(
          `SELECT revision.relevance AS relevance, assessment.label AS label
           FROM answer_claims claim
           JOIN answer_claim_revisions revision ON revision.id = claim.current_revision_id
           JOIN answer_claim_assessments assessment ON assessment.claim_id = claim.id
           WHERE claim.id = 'acs_1'`,
        )
        .get() as Record<string, unknown>;
      assert.equal(claimRow['relevance'], 'REFUSAL');
      assert.equal(claimRow['label'], 'ACCURATE');
    } finally {
      closeDatabase(db);
    }
  } finally {
    temp.remove();
  }
});

test('after the upgrade, a write that violates the new rules is refused and the old row survives', () => {
  const temp = tempDir();
  try {
    const path = join(temp.path, 'aporia.db');
    seedV03(path);
    const db = openUpgraded(path);
    try {
      assert.throws(
        () =>
          db
            .prepare(
              `INSERT INTO answer_claim_assessments
                (id, project_id, claim_id, claim_revision_id, dimension, version, label, rationale,
                 reviewer, attribution_subject, attribution_role, details_json, created_at)
               VALUES ('aca_new', 'prj_1', 'acs_1', 'acr_1', 'FIDELITY', 2, 'ACCURATE', ?, ?, NULL, NULL, '{}', ?)`,
            )
            .run('A refusal cannot be scored as accurate.', TEST_ACTOR, TEST_TIME),
        /claim fidelity label contradicts the recorded relevance/,
      );
      assert.throws(
        () =>
          db
            .prepare(
              `INSERT INTO retest_comparisons
                (id, project_id, finding_id, base_run_id, later_run_id, comparable, outcome,
                 reasons_json, deltas_json, created_by, created_at)
               VALUES ('rtc_new', 'prj_1', NULL, 'run_1', 'run_2', 1, 'UNCHANGED', '[]', '[]', ?, ?)`,
            )
            .run(TEST_ACTOR, TEST_TIME),
        /must record the focus metric and the comparability rule/,
      );
      const assessments = db
        .prepare('SELECT COUNT(*) AS n FROM answer_claim_assessments')
        .get() as Record<string, unknown>;
      assert.equal(
        Number(assessments['n']),
        1,
        'the refused write left nothing behind, and the historical row is still there',
      );
    } finally {
      closeDatabase(db);
    }
  } finally {
    temp.remove();
  }
});

test('a stored metrics-v3 report snapshot survives the upgrade and renders its own figures', () => {
  const temp = tempDir();
  try {
    const path = join(temp.path, 'aporia.db');
    seedV03(path);
    const db = openUpgraded(path);
    try {
      const row = db
        .prepare('SELECT snapshot_json, metrics_version FROM reports ORDER BY report_number ASC')
        .get() as Record<string, unknown>;
      assert.equal(
        row['metrics_version'],
        'metrics-v3',
        'the upgrade left the version stamp alone',
      );
      const stored = JSON.parse(String(row['snapshot_json'])) as ReportSnapshot;
      assert.equal(stored.report.metricsVersion, 'metrics-v3');
      const html = renderReport(stored, { supersededByReportId: null }).value;
      assert.match(html, /A report written under v0\.3/);
      assert.match(html, /metrics-v3/);
      // The statement section of a run with no recorded statements is explained, never zeroed.
      assert.doesNotMatch(html, /NaN|undefined/);
    } finally {
      closeDatabase(db);
    }
  } finally {
    temp.remove();
  }
});

test('the upgraded database backs up, verifies, and restores with its history intact', async () => {
  const temp = tempDir();
  try {
    const path = join(temp.path, 'aporia.db');
    seedV03(path);
    const db = openUpgraded(path);
    closeDatabase(db);
    const before = fileHash(path);

    const backup = await createBackup(path, join(temp.path, 'backup'), {
      now: () => '2026-11-02T10:00:00.000Z',
    });
    assert.equal(backup.manifest.tableCounts.answer_claim_assessments, 1);
    assert.equal(backup.manifest.tableCounts.retest_comparisons, 1);
    assert.equal(backup.manifest.tableCounts.reports, 1);

    const verified = await verifyBackup(join(temp.path, 'backup'));
    assert.equal(verified.manifest.schemaVersion, V03_MIGRATION_COUNT + 2);

    // Restore into a separate, empty data directory: the destination is a different path, which is
    // the supported route, and the upgraded schema travels with it.
    const destination = join(temp.path, 'restored');
    const result = await restoreBackup(
      {
        backupDirectory: join(temp.path, 'backup'),
        dataDir: destination,
        replace: false,
        confirmation: '',
      },
      () => '2026-11-02T11:00:00.000Z',
    );
    assert.equal(result.counts.retest_comparisons, 1);
    const restored = openDatabase(join(destination, 'aporia.db'));
    try {
      assert.deepEqual(appliedVersions(restored), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      assert.equal(
        (
          restored
            .prepare("SELECT label FROM answer_claim_assessments WHERE id = 'aca_legacy'")
            .get() as Record<string, unknown>
        )['label'],
        'ACCURATE',
        'the pre-contract row round-tripped unchanged',
      );
      const legacyComparison = restored
        .prepare("SELECT focus_metric FROM retest_comparisons WHERE id = 'rtc_legacy'")
        .get() as Record<string, unknown>;
      assert.equal(legacyComparison['focus_metric'], null);
      // The restored copy still enforces the new rules: the triggers came across with the schema.
      assert.throws(
        () =>
          restored
            .prepare(
              `INSERT INTO retest_comparisons
                (id, project_id, finding_id, base_run_id, later_run_id, comparable, outcome,
                 reasons_json, deltas_json, created_by, created_at)
               VALUES ('rtc_post', 'prj_1', NULL, 'run_1', 'run_2', 1, 'UNCHANGED', '[]', '[]', ?, ?)`,
            )
            .run(TEST_ACTOR, TEST_TIME),
        /must record the focus metric and the comparability rule/,
      );
    } finally {
      closeDatabase(restored);
    }
    assert.equal(fileHash(path), before, 'backup and restore must not touch the source');
  } finally {
    temp.remove();
  }
});
