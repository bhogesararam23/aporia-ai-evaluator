import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeDatabase } from '../../src/persistence/db.ts';
import { createEntity, createProject } from '../../src/persistence/repositories/projects.ts';
import {
  addProposition,
  createClaim,
  transitionClaim,
} from '../../src/persistence/repositories/claims.ts';
import { createSource, recordEvidence } from '../../src/persistence/repositories/evidence.ts';
import {
  addQuery,
  approveQuerySet,
  createQuerySet,
} from '../../src/persistence/repositories/querySets.ts';
import {
  addCitation,
  addObservation,
  createRun,
  finalizeRun,
  recordObservationAssessment,
} from '../../src/persistence/repositories/runs.ts';
import { createWebsiteAudit } from '../../src/persistence/repositories/websiteAudits.ts';
import { getReport } from '../../src/persistence/repositories/reports.ts';
import { exportProject, generateReport } from '../../src/app/reportingService.ts';
import type { WriteContext } from '../../src/persistence/repositories/context.ts';
import { createTestDatabase, TEST_TIME } from '../helpers/db.ts';

const CONTEXT: WriteContext = { actor: 'Ram', at: '2026-10-10T10:00:00.000Z' };

type TestDb = ReturnType<typeof createTestDatabase>;

function buildProject(db: TestDb): {
  projectId: string;
  claimId: string;
  propositionId: string;
  sourceId: string;
  runId: string;
} {
  const detail = createProject(
    db,
    {
      name: 'Aporia evidence project',
      description: 'A real user-supplied project.',
      primaryDomain: 'https://aporia.example/',
      targetEntity: { name: 'Aporia', type: 'PROJECT_ARTIFACT' },
    },
    CONTEXT,
  );
  const projectId = detail.project.id;
  createEntity(
    db,
    projectId,
    {
      type: 'PERSON',
      canonicalName: 'Ram',
      alternateNames: [],
      publicUrls: [],
      identityStatus: 'SELF_DECLARED',
      identityMethod: 'Operator declaration.',
      identityScope: 'Local record.',
      notes: undefined,
    },
    CONTEXT,
  );
  const claim = createClaim(
    db,
    projectId,
    {
      text: 'The repository contains feature F in release 1.0.',
      sourceUrl: undefined,
      intendedMeaning: undefined,
      timeScope: 'Release 1.0',
      locale: 'en',
    },
    CONTEXT,
  );
  const proposition = addProposition(
    db,
    projectId,
    claim.claim.id,
    {
      text: 'The repository contains feature F.',
      subject: 'repository',
      predicate: 'contains',
      objectValue: 'feature F',
      conditions: undefined,
      timeInterval: 'Release 1.0',
      units: undefined,
      evidenceRequirements: 'Release tag and test log.',
      expectedAnswerCriterion: 'Names feature F.',
      ambiguityNotes: undefined,
    },
    CONTEXT,
  );
  transitionClaim(db, projectId, claim.claim.id, 'UNDER_REVIEW', CONTEXT);
  const source = createSource(
    db,
    projectId,
    {
      title: 'Release archive',
      canonicalUri: 'https://example.com/release',
      publisher: undefined,
      author: undefined,
      sourceType: 'PRIMARY_ARTIFACT',
      accessRoute: 'MANUAL_ENTRY',
      retrievedAt: TEST_TIME,
      publicationDate: '2026-10-01',
      language: 'en',
      independence: 'INDEPENDENT',
      notes: undefined,
    },
    CONTEXT,
  );
  recordEvidence(
    db,
    projectId,
    source.id,
    proposition.id,
    {
      locator: 'README section 1',
      excerpt: 'Feature F is implemented.',
      extractionMethod: 'PASTED_TEXT',
      extractedAt: TEST_TIME,
      relation: 'SUPPORTS',
      rationale: 'The release archive states the feature exists.',
      reviewer: 'Ram',
    },
    CONTEXT,
  );
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
      branded: true,
      expectedElements: 'Aporia and its feature.',
      inclusionRationale: 'Baseline.',
    },
    CONTEXT,
  );
  approveQuerySet(db, projectId, set.set.id, { reviewer: 'Ram', note: 'Reviewed.' }, CONTEXT);
  const run = createRun(
    db,
    projectId,
    set.set.id,
    {
      name: 'Manual baseline',
      providerLabel: 'Example assistant',
      modelLabel: 'unknown',
      interfaceLabel: 'Consumer interface',
      groundingMode: 'SEARCH_GROUNDED',
      locale: 'en',
      region: undefined,
      captureFrom: '2026-10-09T10:00:00.000Z',
      captureTo: '2026-10-09T11:00:00.000Z',
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
      queryId: query.id,
      status: 'COMPLETED',
      capturedAt: '2026-10-09T10:30:00.000Z',
      answerText: 'Aporia contains feature F.',
      errorNote: undefined,
      citationCapture: 'CAPTURED',
      contextNotes: undefined,
    },
    CONTEXT,
  );
  addCitation(
    db,
    projectId,
    run.run.id,
    observation.id,
    {
      url: 'https://example.com/release',
      title: 'Release archive',
      snippet: 'Feature F is implemented.',
      targetOwned: true,
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
  createWebsiteAudit(
    db,
    projectId,
    {
      label: 'Homepage snapshot',
      inputMethod: 'PASTED',
      inputFilename: null,
      contentHash: 'c'.repeat(64),
      byteLength: 256,
      htmlSnapshot:
        '<html lang="en"><head><title>Aporia</title></head><body><h1>Aporia</h1></body></html>',
      auditedAt: '2026-10-09T12:00:00.000Z',
      methodologyVersion: 'local-html-audit-v1',
      findings: [
        {
          code: 'meta_robots_noindex',
          severity: 'BLOCKING',
          category: 'INDEXABILITY',
          title: 'Noindex declared',
          observation: 'meta robots includes noindex.',
          rationale: 'Compliant crawlers should not index.',
          recommendation: 'Remove noindex if public discovery is intended.',
          locator: 'head > meta[name="robots"]',
        },
      ],
      unavailableChecks: [
        {
          code: 'HTTP_REACHABILITY',
          label: 'Page reachability',
          reason: 'Network access is disabled in local v0.1.',
        },
      ],
      metadata: { title: 'Aporia' },
    },
    CONTEXT,
  );
  return {
    projectId,
    claimId: claim.claim.id,
    propositionId: proposition.id,
    sourceId: source.id,
    runId: run.run.id,
  };
}

test('generates a report from persisted claims, evidence, runs, and audits', () => {
  const db = createTestDatabase();
  try {
    const built = buildProject(db);
    assert.notEqual(built.sourceId, '');
    const generated = generateReport(db, built.projectId, undefined, CONTEXT);
    assert.equal(generated.report.reportNumber, 1);
    assert.match(generated.report.title, /evaluation report 2026-10-10/);
    assert.equal(generated.snapshot.claims.length, 1);
    assert.equal(generated.snapshot.claims[0]?.propositions[0]?.evidence.length, 1);
    assert.equal(
      generated.snapshot.claims[0]?.propositions[0]?.primaryConclusion.status,
      'SUPPORTED_WITHIN_SCOPE',
    );
    assert.equal(generated.snapshot.runs.length, 1);
    assert.equal(generated.snapshot.runs[0]?.metrics.mentionRate.value, 1);
    assert.equal(generated.snapshot.websiteAudits.length, 1);
    assert.equal(generated.snapshot.websiteAudits[0]?.findings[0]?.severity, 'BLOCKING');
    assert.equal(generated.snapshot.unavailableChecks.length, 1);
    assert.equal(
      generated.snapshot.remediation.some((item) => item.relatedType === 'website_audit'),
      true,
    );
    assert.equal(generated.snapshot.audit.eventCount > 0, true);
    assert.deepEqual(generated.report.snapshot, generated.snapshot);
    const stored = getReport(db, built.projectId, generated.report.id);
    assert.deepEqual(stored?.snapshot, generated.snapshot);
  } finally {
    closeDatabase(db);
  }
});

test('later reports do not mutate earlier snapshots', () => {
  const db = createTestDatabase();
  try {
    const built = buildProject(db);
    const first = generateReport(db, built.projectId, 'Baseline', CONTEXT);
    const secondSource = createSource(
      db,
      built.projectId,
      {
        title: 'Second source',
        canonicalUri: undefined,
        publisher: undefined,
        author: undefined,
        sourceType: 'SELF_PUBLISHED',
        accessRoute: 'MANUAL_ENTRY',
        retrievedAt: TEST_TIME,
        publicationDate: undefined,
        language: 'en',
        independence: 'SELF_PUBLISHED',
        notes: undefined,
      },
      CONTEXT,
    );
    recordEvidence(
      db,
      built.projectId,
      secondSource.id,
      built.propositionId,
      {
        locator: 'Appendix',
        excerpt: 'Feature F is mentioned again.',
        extractionMethod: 'PASTED_TEXT',
        extractedAt: TEST_TIME,
        relation: 'CONTEXTUALIZES',
        rationale: 'Adds context.',
        reviewer: 'Ram',
      },
      CONTEXT,
    );
    const second = generateReport(db, built.projectId, 'Follow-up', {
      actor: 'Ram',
      at: '2026-10-11T10:00:00.000Z',
    });
    assert.equal(second.report.reportNumber, 2);
    const firstStored = getReport(db, built.projectId, first.report.id);
    assert.deepEqual(firstStored?.snapshot, first.snapshot);
    const firstSnapshot = firstStored?.snapshot as typeof first.snapshot;
    assert.equal(firstSnapshot.coverage.sources, 1);
    assert.equal(second.snapshot.coverage.sources, 2);
    assert.equal(second.report.supersededByReportId, null);
  } finally {
    closeDatabase(db);
  }
});

test('empty projects generate honest reports with unavailable metrics', () => {
  const db = createTestDatabase();
  try {
    const detail = createProject(
      db,
      {
        name: 'Empty project',
        description: undefined,
        primaryDomain: undefined,
        targetEntity: null,
      },
      CONTEXT,
    );
    const generated = generateReport(db, detail.project.id, undefined, CONTEXT);
    assert.deepEqual(generated.snapshot.claims, []);
    assert.deepEqual(generated.snapshot.runs, []);
    assert.equal(generated.snapshot.coverage.finalizedRuns, 0);
    assert.ok(generated.snapshot.limitations.some((item) => /No finalized manual/.test(item)));
    assert.ok(generated.snapshot.remediation.some((item) => item.id === 'claims.none'));
    assert.ok(generated.snapshot.remediation.some((item) => item.id === 'runs.none'));
  } finally {
    closeDatabase(db);
  }
});

test('project export contains persisted sources, runs, audits, and reports', () => {
  const db = createTestDatabase();
  try {
    const built = buildProject(db);
    generateReport(db, built.projectId, undefined, CONTEXT);
    const exported = exportProject(db, built.projectId, CONTEXT.at);
    assert.equal(exported['schemaVersion'], 'project-export-v1');
    assert.equal((exported['sources'] as unknown[]).length, 1);
    assert.equal((exported['runs'] as unknown[]).length, 1);
    assert.equal((exported['websiteAudits'] as unknown[]).length, 1);
    assert.equal((exported['reports'] as unknown[]).length, 1);
    assert.equal((exported['auditEventCount'] as number) > 0, true);
    const claims = exported['claims'] as Array<{ propositions: unknown[] }>;
    assert.equal(claims[0]?.propositions.length, 1);
  } finally {
    closeDatabase(db);
  }
});

test('provider failures are reported as exclusions, not negative answers', () => {
  const db = createTestDatabase();
  try {
    const project = createProject(
      db,
      {
        name: 'Failure project',
        description: undefined,
        primaryDomain: undefined,
        targetEntity: null,
      },
      CONTEXT,
    );
    const set = createQuerySet(
      db,
      project.project.id,
      { name: 'Failure set', description: undefined, locale: 'en' },
      CONTEXT,
    );
    const query = addQuery(
      db,
      project.project.id,
      set.set.id,
      {
        text: 'What is the artifact?',
        intent: 'DESCRIPTION',
        locale: undefined,
        region: undefined,
        branded: false,
        expectedElements: 'The artifact.',
        inclusionRationale: 'Baseline.',
      },
      CONTEXT,
    );
    approveQuerySet(
      db,
      project.project.id,
      set.set.id,
      { reviewer: 'Ram', note: undefined },
      CONTEXT,
    );
    const run = createRun(
      db,
      project.project.id,
      set.set.id,
      {
        name: 'Error-only run',
        providerLabel: 'Example assistant',
        modelLabel: undefined,
        interfaceLabel: 'Consumer interface',
        groundingMode: 'UNKNOWN',
        locale: 'en',
        region: undefined,
        captureFrom: '2026-10-28T10:00:00.000Z',
        captureTo: '2026-10-28T11:00:00.000Z',
        conditions: 'Manual capture attempt.',
        notes: undefined,
      },
      CONTEXT,
    );
    addObservation(
      db,
      project.project.id,
      run.run.id,
      {
        queryId: query.id,
        status: 'ERROR',
        capturedAt: '2026-10-28T10:30:00.000Z',
        answerText: undefined,
        errorNote: 'The interface returned a server error.',
        citationCapture: 'UNKNOWN',
        contextNotes: undefined,
      },
      CONTEXT,
    );
    finalizeRun(db, project.project.id, run.run.id, CONTEXT);
    const generated = generateReport(db, project.project.id, 'Failure report', CONTEXT);
    const runView = generated.snapshot.runs[0];
    assert.ok(runView);
    assert.equal(runView.metrics.mentionRate.denominator, 0);
    assert.equal(runView.metrics.mentionRate.value, null);
    assert.equal(
      runView.metrics.mentionRate.exclusions.some(
        (exclusion) => exclusion.reason === 'PROVIDER_ERROR',
      ),
      true,
    );
    assert.equal(runView.observations[0]?.status, 'ERROR');
    assert.equal(runView.observations[0]?.statusEligibility, 'EXCLUDED');
    assert.ok(generated.snapshot.limitations.some((item) => /denominators are empty/.test(item)));
    assert.equal(
      generated.snapshot.remediation.some((item) =>
        /missing observation assessments/.test(item.action),
      ),
      true,
    );
  } finally {
    closeDatabase(db);
  }
});
