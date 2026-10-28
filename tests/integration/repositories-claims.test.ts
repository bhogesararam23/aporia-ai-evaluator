import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listAuditEvents } from '../../src/persistence/audit.ts';
import { closeDatabase } from '../../src/persistence/db.ts';
import {
  addClaimRevision,
  addProposition,
  createClaim,
  getClaim,
  getClaimOrThrow,
  getRevision,
  listClaims,
  transitionClaim,
} from '../../src/persistence/repositories/claims.ts';
import { createProject } from '../../src/persistence/repositories/projects.ts';
import type { WriteContext } from '../../src/persistence/repositories/context.ts';
import type { ClaimRevisionInput, PropositionInput } from '../../src/core/inputs.ts';
import { createTestDatabase, TEST_TIME } from '../helpers/db.ts';

const CONTEXT: WriteContext = { actor: 'Ram', at: TEST_TIME };
const LATER: WriteContext = { actor: 'Ram', at: '2026-10-28T13:00:00.000Z' };

function projectId(db: ReturnType<typeof createTestDatabase>): string {
  return createProject(
    db,
    {
      name: 'Claims project',
      description: undefined,
      primaryDomain: undefined,
      targetEntity: null,
    },
    CONTEXT,
  ).project.id;
}

const REVISION: ClaimRevisionInput = {
  text: 'The repository contains the described feature.',
  sourceUrl: 'https://example.com/repo',
  intendedMeaning: 'The feature is present in the published release.',
  timeScope: 'Release 1.0',
  locale: 'en',
};

const PROPOSITION: PropositionInput = {
  text: 'The repository contains feature F.',
  subject: 'Repository R',
  predicate: 'contains',
  objectValue: 'feature F',
  conditions: undefined,
  timeInterval: undefined,
  units: undefined,
  evidenceRequirements: 'Release tag and test log.',
  expectedAnswerCriterion: 'Names feature F and repository R.',
  ambiguityNotes: undefined,
};

test('creates claims with immutable revision one and an audit event', () => {
  const db = createTestDatabase();
  try {
    const project = projectId(db);
    const detail = createClaim(db, project, REVISION, CONTEXT);
    assert.match(detail.claim.id, /^clm_/);
    assert.equal(detail.claim.status, 'SUBMITTED');
    assert.equal(detail.currentRevision?.revisionNumber, 1);
    assert.equal(detail.currentRevision?.createdBy, 'Ram');
    assert.equal(detail.currentRevision?.decompositionVersion, 'manual-decomposition-v1');
    assert.deepEqual(detail.propositions, []);
    assert.equal(getClaim(db, project, detail.claim.id)?.currentRevision?.text, REVISION.text);
    assert.equal(listAuditEvents(db, project)[0]?.action, 'claim.created');
  } finally {
    closeDatabase(db);
  }
});

test('adding propositions advances the claim and preserves ordinals', () => {
  const db = createTestDatabase();
  try {
    const project = projectId(db);
    const detail = createClaim(db, project, REVISION, CONTEXT);
    const first = addProposition(db, project, detail.claim.id, PROPOSITION, CONTEXT);
    assert.equal(first.ordinal, 1);
    assert.equal(getClaimOrThrow(db, project, detail.claim.id).claim.status, 'DECOMPOSED');
    const second = addProposition(
      db,
      project,
      detail.claim.id,
      { ...PROPOSITION, text: 'The feature is tested.' },
      CONTEXT,
    );
    assert.equal(second.ordinal, 2);
    const refreshed = getClaimOrThrow(db, project, detail.claim.id);
    assert.deepEqual(
      refreshed.propositions.map((p) => p.ordinal),
      [1, 2],
    );
    assert.equal(listClaims(db, project)[0]?.propositionCount, 2);
    assert.equal(listAuditEvents(db, project)[0]?.action, 'claim.proposition_added');
  } finally {
    closeDatabase(db);
  }
});

test('a new revision resets status and becomes the current decomposition target', () => {
  const db = createTestDatabase();
  try {
    const project = projectId(db);
    const detail = createClaim(db, project, REVISION, CONTEXT);
    addProposition(db, project, detail.claim.id, PROPOSITION, CONTEXT);
    transitionClaim(db, project, detail.claim.id, 'UNDER_REVIEW', LATER);
    transitionClaim(db, project, detail.claim.id, 'ASSESSED', LATER);

    const revised = addClaimRevision(
      db,
      project,
      detail.claim.id,
      { ...REVISION, text: 'A corrected claim revision with narrower scope.' },
      LATER,
    );
    assert.equal(revised.claim.status, 'SUBMITTED');
    assert.equal(revised.currentRevision?.revisionNumber, 2);
    assert.equal(revised.revisions.length, 2);
    assert.deepEqual(revised.propositions, []);
    assert.equal(revised.revisions[0]?.text, REVISION.text);
    assert.equal(listAuditEvents(db, project)[0]?.action, 'claim.revision_created');
    addProposition(
      db,
      project,
      detail.claim.id,
      { ...PROPOSITION, text: 'The corrected feature exists.' },
      LATER,
    );
    assert.equal(getClaimOrThrow(db, project, detail.claim.id).claim.status, 'DECOMPOSED');
  } finally {
    closeDatabase(db);
  }
});

test('claim status transitions are validated and disputes require a reason', () => {
  const db = createTestDatabase();
  try {
    const project = projectId(db);
    const detail = createClaim(db, project, REVISION, CONTEXT);
    addProposition(db, project, detail.claim.id, PROPOSITION, CONTEXT);
    assert.throws(
      () => transitionClaim(db, project, detail.claim.id, 'ASSESSED', CONTEXT),
      /cannot move from DECOMPOSED to ASSESSED/,
    );
    transitionClaim(db, project, detail.claim.id, 'UNDER_REVIEW', CONTEXT);
    transitionClaim(db, project, detail.claim.id, 'ASSESSED', CONTEXT);
    assert.throws(
      () => transitionClaim(db, project, detail.claim.id, 'DISPUTED', CONTEXT),
      /dispute reason/,
    );
    const disputed = transitionClaim(
      db,
      project,
      detail.claim.id,
      'DISPUTED',
      LATER,
      'A source was misread.',
    );
    assert.equal(disputed.status, 'DISPUTED');
    transitionClaim(db, project, detail.claim.id, 'UNDER_REVIEW', LATER);
    assert.equal(getClaimOrThrow(db, project, detail.claim.id).claim.status, 'UNDER_REVIEW');
  } finally {
    closeDatabase(db);
  }
});

test('propositions are locked once review starts', () => {
  const db = createTestDatabase();
  try {
    const project = projectId(db);
    const detail = createClaim(db, project, REVISION, CONTEXT);
    addProposition(db, project, detail.claim.id, PROPOSITION, CONTEXT);
    transitionClaim(db, project, detail.claim.id, 'UNDER_REVIEW', CONTEXT);
    assert.throws(
      () => addProposition(db, project, detail.claim.id, PROPOSITION, CONTEXT),
      /cannot be added after review/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('claims are scoped to their project and revisions are readable', () => {
  const db = createTestDatabase();
  try {
    const project = createProject(
      db,
      {
        name: 'One',
        description: undefined,
        primaryDomain: undefined,
        targetEntity: null,
      },
      CONTEXT,
    ).project.id;
    const other = createProject(
      db,
      {
        name: 'Two',
        description: undefined,
        primaryDomain: undefined,
        targetEntity: null,
      },
      CONTEXT,
    ).project.id;
    const detail = createClaim(db, project, REVISION, CONTEXT);
    assert.equal(getClaim(db, other, detail.claim.id), null);
    assert.throws(() => getClaimOrThrow(db, other, detail.claim.id), /Claim not found/);
    assert.throws(
      () => addProposition(db, other, detail.claim.id, PROPOSITION, CONTEXT),
      /Claim not found/,
    );
    const revision = detail.currentRevision;
    assert.ok(revision !== null);
    assert.equal(getRevision(db, project, detail.claim.id, revision.id)?.text, REVISION.text);
    assert.equal(getRevision(db, other, detail.claim.id, revision.id), null);
  } finally {
    closeDatabase(db);
  }
});
