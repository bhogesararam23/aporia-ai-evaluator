import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  CitationDraftInput,
  ObservationAssessmentDraftInput,
  ObservationDraftInput,
  RunInput,
} from '../../src/core/inputs.ts';
import { listAuditEvents } from '../../src/persistence/audit.ts';
import { closeDatabase } from '../../src/persistence/db.ts';
import {
  addCitation,
  addObservation,
  cancelRun,
  createRun,
  finalizeRun,
  getRun,
  listRuns,
  recordObservationAssessment,
  voidCitation,
  voidObservation,
} from '../../src/persistence/repositories/runs.ts';
import {
  addQuery,
  approveQuerySet,
  createQuerySet,
} from '../../src/persistence/repositories/querySets.ts';
import { createProject } from '../../src/persistence/repositories/projects.ts';
import type { WriteContext } from '../../src/persistence/repositories/context.ts';
import { createTestDatabase, TEST_TIME } from '../helpers/db.ts';

const CONTEXT: WriteContext = { actor: 'Ram', at: TEST_TIME };
const LATER: WriteContext = { actor: 'Ram', at: '2026-10-28T16:00:00.000Z' };

const RUN_INPUT: RunInput = {
  name: 'Manual baseline',
  providerLabel: 'Example assistant',
  modelLabel: 'unknown-model',
  interfaceLabel: 'Consumer web interface',
  groundingMode: 'SEARCH_GROUNDED',
  locale: 'en',
  region: undefined,
  captureFrom: '2026-10-28T10:00:00.000Z',
  captureTo: '2026-10-28T12:00:00.000Z',
  conditions: 'Manual capture under default settings; no provider integration.',
  notes: undefined,
};

const OBSERVATION: Omit<ObservationDraftInput, 'queryId'> = {
  status: 'COMPLETED',
  capturedAt: TEST_TIME,
  answerText: 'Project A was created by Ram.',
  errorNote: undefined,
  citationCapture: 'CAPTURED',
  contextNotes: 'Default mode; no login customization.',
};

const CITATION: CitationDraftInput = {
  url: 'https://example.com/project-a',
  title: 'Project A',
  snippet: 'Project A was created by Ram.',
  targetOwned: true,
};

const PRESENCE: ObservationAssessmentDraftInput = {
  dimension: 'PRESENCE',
  label: 'MENTIONED',
  rationale: 'The answer names Project A.',
  reviewer: 'Ram',
  attributionRole: undefined,
};

type TestDb = ReturnType<typeof createTestDatabase>;

function setup(
  db: TestDb,
  projectName = 'Run project',
): { projectId: string; queryId: string; setId: string } {
  const projectId = createProject(
    db,
    {
      name: projectName,
      description: undefined,
      primaryDomain: undefined,
      targetEntity: null,
    },
    CONTEXT,
  ).project.id;
  const created = createQuerySet(
    db,
    projectId,
    { name: 'Core', description: undefined, locale: 'en' },
    CONTEXT,
  );
  const query = addQuery(
    db,
    projectId,
    created.set.id,
    {
      text: 'What is Project A?',
      intent: 'IDENTITY',
      locale: undefined,
      region: undefined,
      branded: true,
      expectedElements: 'Project A and its creator.',
      inclusionRationale: 'Baseline.',
    },
    CONTEXT,
  );
  approveQuerySet(db, projectId, created.set.id, { reviewer: 'Ram', note: 'Reviewed.' }, CONTEXT);
  return { projectId, queryId: query.id, setId: created.set.id };
}

test('creates an open manual run with a frozen query-set snapshot', () => {
  const db = createTestDatabase();
  try {
    const { projectId, setId } = setup(db);
    const detail = createRun(db, projectId, setId, RUN_INPUT, CONTEXT);
    assert.match(detail.run.id, /^run_/);
    assert.equal(detail.run.status, 'OPEN');
    assert.equal(detail.run.querySetName, 'Core');
    assert.equal(detail.run.querySetVersion, 1);
    assert.equal(detail.run.groundingMode, 'SEARCH_GROUNDED');
    assert.equal(detail.querySet.queries.length, 1);
    assert.deepEqual(detail.observations, []);
    assert.equal(getRun(db, projectId, detail.run.id)?.run.providerLabel, 'Example assistant');
    assert.equal(listRuns(db, projectId)[0]?.observationCount, 0);
    assert.equal(listAuditEvents(db, projectId)[0]?.action, 'run.created');
  } finally {
    closeDatabase(db);
  }
});

test('runs require an approved query set', () => {
  const db = createTestDatabase();
  try {
    const { projectId } = setup(db);
    const draft = createQuerySet(
      db,
      projectId,
      { name: 'Draft', description: undefined, locale: 'en' },
      CONTEXT,
    );
    assert.throws(
      () => createRun(db, projectId, draft.set.id, RUN_INPUT, CONTEXT),
      /approved query set/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('records observations, citations, and versioned assessments', () => {
  const db = createTestDatabase();
  try {
    const { projectId, queryId, setId } = setup(db);
    const created = createRun(db, projectId, setId, RUN_INPUT, CONTEXT);
    const observation = addObservation(
      db,
      projectId,
      created.run.id,
      { ...OBSERVATION, queryId },
      LATER,
    );
    assert.match(observation.id, /^obs_/);
    assert.equal(observation.queryTextSnapshot, 'What is Project A?');
    assert.equal(observation.answerText, OBSERVATION.answerText);
    const citation = addCitation(db, projectId, created.run.id, observation.id, CITATION, LATER);
    assert.equal(citation.targetOwned, true);
    const assessment = recordObservationAssessment(
      db,
      projectId,
      created.run.id,
      observation.id,
      PRESENCE,
      LATER,
    );
    assert.equal(assessment.version, 1);
    recordObservationAssessment(
      db,
      projectId,
      created.run.id,
      observation.id,
      { ...PRESENCE, label: 'NOT_MENTIONED', rationale: 'A second review changed the judgment.' },
      LATER,
    );
    const detail = getRun(db, projectId, created.run.id);
    assert.equal(detail?.observations.length, 1);
    assert.equal(detail?.observations[0]?.answerText, OBSERVATION.answerText);
    assert.equal(detail?.observations[0]?.citations[0]?.url, CITATION.url);
    assert.deepEqual(
      detail?.observations[0]?.assessments.map((item) => [
        item.dimension,
        item.version,
        item.label,
      ]),
      [
        ['PRESENCE', 1, 'MENTIONED'],
        ['PRESENCE', 2, 'NOT_MENTIONED'],
      ],
    );
    assert.equal(listRuns(db, projectId)[0]?.observationCount, 1);
  } finally {
    closeDatabase(db);
  }
});

test('non-completed observations cannot receive answer assessments', () => {
  const db = createTestDatabase();
  try {
    const { projectId, queryId, setId } = setup(db);
    const created = createRun(db, projectId, setId, RUN_INPUT, CONTEXT);
    const errorObservation = addObservation(
      db,
      projectId,
      created.run.id,
      {
        ...OBSERVATION,
        queryId,
        status: 'ERROR',
        answerText: undefined,
        errorNote: 'The interface returned a server error.',
        citationCapture: 'UNKNOWN',
      },
      LATER,
    );
    assert.throws(
      () =>
        recordObservationAssessment(
          db,
          projectId,
          created.run.id,
          errorObservation.id,
          PRESENCE,
          LATER,
        ),
      /require a completed answer/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('observations and citations can be voided once while the run is open', () => {
  const db = createTestDatabase();
  try {
    const { projectId, queryId, setId } = setup(db);
    const created = createRun(db, projectId, setId, RUN_INPUT, CONTEXT);
    const observation = addObservation(
      db,
      projectId,
      created.run.id,
      { ...OBSERVATION, queryId },
      LATER,
    );
    const citation = addCitation(db, projectId, created.run.id, observation.id, CITATION, LATER);
    const voidedCitation = voidCitation(
      db,
      projectId,
      created.run.id,
      observation.id,
      citation.id,
      { reason: 'Wrong source URL.', reviewer: 'Ram' },
      LATER,
    );
    assert.notEqual(voidedCitation.voidedAt, null);
    assert.throws(
      () =>
        voidCitation(
          db,
          projectId,
          created.run.id,
          observation.id,
          citation.id,
          { reason: 'Again.', reviewer: 'Ram' },
          LATER,
        ),
      /already been voided/,
    );
    const voidedObservation = voidObservation(
      db,
      projectId,
      created.run.id,
      observation.id,
      { reason: 'Duplicate capture.', reviewer: 'Ram' },
      LATER,
    );
    assert.notEqual(voidedObservation.voidedAt, null);
    assert.throws(
      () =>
        voidObservation(
          db,
          projectId,
          created.run.id,
          observation.id,
          { reason: 'Again.', reviewer: 'Ram' },
          LATER,
        ),
      /already been voided/,
    );
    assert.throws(
      () => addCitation(db, projectId, created.run.id, observation.id, CITATION, LATER),
      /voided observation/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('finalization requires an observation and freezes the run', () => {
  const db = createTestDatabase();
  try {
    const { projectId, queryId, setId } = setup(db);
    const created = createRun(db, projectId, setId, RUN_INPUT, CONTEXT);
    assert.throws(
      () => finalizeRun(db, projectId, created.run.id, LATER),
      /at least one observation/,
    );
    const observation = addObservation(
      db,
      projectId,
      created.run.id,
      { ...OBSERVATION, queryId },
      LATER,
    );
    const finalized = finalizeRun(db, projectId, created.run.id, LATER);
    assert.equal(finalized.status, 'FINALIZED');
    assert.equal(finalized.finalizedAt, LATER.at);
    assert.throws(
      () => addObservation(db, projectId, created.run.id, { ...OBSERVATION, queryId }, LATER),
      /cannot be changed/,
    );
    assert.throws(
      () => addCitation(db, projectId, created.run.id, observation.id, CITATION, LATER),
      /cannot be changed/,
    );
    assert.throws(
      () =>
        recordObservationAssessment(db, projectId, created.run.id, observation.id, PRESENCE, LATER),
      /cannot be changed/,
    );
    assert.throws(
      () =>
        voidObservation(
          db,
          projectId,
          created.run.id,
          observation.id,
          { reason: 'Too late.', reviewer: 'Ram' },
          LATER,
        ),
      /cannot be changed/,
    );
    assert.equal(listAuditEvents(db, projectId)[0]?.action, 'run.finalized');
  } finally {
    closeDatabase(db);
  }
});

test('cancellation requires a reason and is terminal', () => {
  const db = createTestDatabase();
  try {
    const { projectId, setId } = setup(db);
    const created = createRun(db, projectId, setId, RUN_INPUT, CONTEXT);
    const cancelled = cancelRun(
      db,
      projectId,
      created.run.id,
      { reason: 'Wrong query set.', reviewer: 'Ram' },
      LATER,
    );
    assert.equal(cancelled.status, 'CANCELLED');
    assert.throws(() => finalizeRun(db, projectId, created.run.id, LATER), /cannot be changed/);
  } finally {
    closeDatabase(db);
  }
});

test('runs and observations are scoped to their project', () => {
  const db = createTestDatabase();
  try {
    const first = setup(db, 'First');
    const second = setup(db, 'Second');
    const created = createRun(db, first.projectId, first.setId, RUN_INPUT, CONTEXT);
    assert.equal(getRun(db, second.projectId, created.run.id), null);
    assert.throws(
      () =>
        addObservation(
          db,
          second.projectId,
          created.run.id,
          { ...OBSERVATION, queryId: second.queryId },
          LATER,
        ),
      /Run not found|Evaluation run not found/,
    );
  } finally {
    closeDatabase(db);
  }
});
