import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ClaimRevisionInput, PropositionInput, SourceInput } from '../../src/core/inputs.ts';
import { listAuditEvents } from '../../src/persistence/audit.ts';
import { closeDatabase } from '../../src/persistence/db.ts';
import {
  activeRelationshipsForProposition,
  createSource,
  getSource,
  listPropositionAssessments,
  listPropositionEvidence,
  listSources,
  recordEvidence,
  recordPropositionAssessment,
  supersedeRelationship,
} from '../../src/persistence/repositories/evidence.ts';
import {
  addProposition,
  createClaim,
  transitionClaim,
} from '../../src/persistence/repositories/claims.ts';
import { createProject } from '../../src/persistence/repositories/projects.ts';
import type { WriteContext } from '../../src/persistence/repositories/context.ts';
import { createTestDatabase, TEST_TIME } from '../helpers/db.ts';

const CONTEXT: WriteContext = { actor: 'Ram', at: TEST_TIME };
const LATER: WriteContext = { actor: 'Ram', at: '2026-10-28T14:00:00.000Z' };

const REVISION: ClaimRevisionInput = {
  text: 'The repository contains the described feature.',
  sourceUrl: undefined,
  intendedMeaning: undefined,
  timeScope: undefined,
  locale: 'en',
};

const PROPOSITION: PropositionInput = {
  text: 'The repository contains feature F.',
  subject: undefined,
  predicate: undefined,
  objectValue: undefined,
  conditions: undefined,
  timeInterval: undefined,
  units: undefined,
  evidenceRequirements: 'Release tag and test log.',
  expectedAnswerCriterion: undefined,
  ambiguityNotes: undefined,
};

const SOURCE: SourceInput = {
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
};

const EVIDENCE = {
  locator: 'README section 1',
  excerpt: 'Feature F is implemented and tested.',
  extractionMethod: 'PASTED_TEXT' as const,
  extractedAt: TEST_TIME,
  relation: 'SUPPORTS' as const,
  rationale: 'The passage directly states the proposition.',
  reviewer: 'Ram',
};

function setupClaim(db: ReturnType<typeof createTestDatabase>): {
  projectId: string;
  claimId: string;
  propositionId: string;
} {
  const projectId = createProject(
    db,
    {
      name: 'Evidence project',
      description: undefined,
      primaryDomain: undefined,
      targetEntity: null,
    },
    CONTEXT,
  ).project.id;
  const claim = createClaim(db, projectId, REVISION, CONTEXT);
  const proposition = addProposition(db, projectId, claim.claim.id, PROPOSITION, CONTEXT);
  return { projectId, claimId: claim.claim.id, propositionId: proposition.id };
}

test('records sources and user-supplied evidence with a content digest', () => {
  const db = createTestDatabase();
  try {
    const { projectId, propositionId } = setupClaim(db);
    const source = createSource(db, projectId, SOURCE, CONTEXT);
    assert.match(source.id, /^src_/);
    assert.equal(source.accessStatus, 'NOT_CHECKED');
    const recorded = recordEvidence(db, projectId, source.id, propositionId, EVIDENCE, CONTEXT);
    assert.match(recorded.evidence.id, /^evd_/);
    assert.equal(recorded.evidence.provenance, 'USER_SUPPLIED');
    assert.match(recorded.evidence.excerptDigest, /^[a-f0-9]{64}$/);
    assert.equal(recorded.relationship.relation, 'SUPPORTS');
    assert.equal(listSources(db, projectId).length, 1);
    assert.equal(getSource(db, projectId, source.id)?.title, SOURCE.title);
    assert.deepEqual(
      listAuditEvents(db, projectId).map((event) => event.action),
      [
        'evidence.created',
        'source.created',
        'claim.proposition_added',
        'claim.created',
        'project.created',
      ],
    );
  } finally {
    closeDatabase(db);
  }
});

test('supporting and contradictory evidence remain visible together', () => {
  const db = createTestDatabase();
  try {
    const { projectId, propositionId } = setupClaim(db);
    const primary = createSource(db, projectId, SOURCE, CONTEXT);
    const secondary = createSource(
      db,
      projectId,
      { ...SOURCE, title: 'Independent report', sourceType: 'INDEPENDENT_SOURCE' },
      CONTEXT,
    );
    recordEvidence(db, projectId, primary.id, propositionId, EVIDENCE, CONTEXT);
    recordEvidence(
      db,
      projectId,
      secondary.id,
      propositionId,
      {
        ...EVIDENCE,
        excerpt: 'Feature F is not present in the release.',
        relation: 'CONTRADICTS',
        rationale: 'The independent report says the feature is absent.',
      },
      CONTEXT,
    );
    const rows = listPropositionEvidence(db, projectId, propositionId);
    assert.deepEqual(
      rows.map((row) => row.relationship.relation),
      ['SUPPORTS', 'CONTRADICTS'],
    );
    assert.deepEqual(
      activeRelationshipsForProposition(db, projectId, propositionId).map((row) => row.relation),
      ['SUPPORTS', 'CONTRADICTS'],
    );
  } finally {
    closeDatabase(db);
  }
});

test('superseding a relationship preserves the prior row and changes the active relation', () => {
  const db = createTestDatabase();
  try {
    const { projectId, propositionId } = setupClaim(db);
    const source = createSource(db, projectId, SOURCE, CONTEXT);
    const recorded = recordEvidence(db, projectId, source.id, propositionId, EVIDENCE, CONTEXT);
    const replacement = supersedeRelationship(
      db,
      projectId,
      recorded.relationship.id,
      {
        relation: 'QUALIFIES',
        rationale: 'The feature exists only in the latest release.',
        reviewer: 'Ram',
      },
      LATER,
    );
    assert.notEqual(replacement.id, recorded.relationship.id);
    const rows = listPropositionEvidence(db, projectId, propositionId);
    assert.equal(rows.length, 2);
    const oldRow = rows.find((row) => row.relationship.id === recorded.relationship.id);
    const newRow = rows.find((row) => row.relationship.id === replacement.id);
    assert.equal(oldRow?.relationship.supersededBy, replacement.id);
    assert.equal(newRow?.relationship.relation, 'QUALIFIES');
    assert.equal(newRow?.relationship.supersededBy, null);
    assert.deepEqual(
      activeRelationshipsForProposition(db, projectId, propositionId).map((row) => row.relation),
      ['QUALIFIES'],
    );
    assert.throws(
      () =>
        supersedeRelationship(
          db,
          projectId,
          recorded.relationship.id,
          { relation: 'SUPPORTS', rationale: 'Again.', reviewer: 'Ram' },
          LATER,
        ),
      /already been superseded/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('evidence and assessments are scoped to the project', () => {
  const db = createTestDatabase();
  try {
    const first = setupClaim(db);
    const second = setupClaim(db);
    const source = createSource(db, first.projectId, SOURCE, CONTEXT);
    assert.throws(
      () =>
        recordEvidence(db, second.projectId, source.id, second.propositionId, EVIDENCE, CONTEXT),
      /Source not found/,
    );
    assert.throws(
      () =>
        recordEvidence(
          db,
          second.projectId,
          createSource(db, second.projectId, SOURCE, CONTEXT).id,
          first.propositionId,
          EVIDENCE,
          CONTEXT,
        ),
      /Proposition not found/,
    );
  } finally {
    closeDatabase(db);
  }
});

test('records versioned proposition assessments with an evidence snapshot', () => {
  const db = createTestDatabase();
  try {
    const { projectId, claimId, propositionId } = setupClaim(db);
    const source = createSource(db, projectId, SOURCE, CONTEXT);
    const recorded = recordEvidence(db, projectId, source.id, propositionId, EVIDENCE, CONTEXT);
    transitionClaim(db, projectId, claimId, 'UNDER_REVIEW', LATER);
    const first = recordPropositionAssessment(
      db,
      projectId,
      propositionId,
      {
        label: 'SUPPORTED_WITHIN_SCOPE',
        rationale: 'The release note supports the claim.',
        reviewer: 'Ram',
      },
      LATER,
    );
    assert.equal(first.version, 1);
    assert.deepEqual(first.evidenceSnapshot, [recorded.relationship.id]);
    const second = recordPropositionAssessment(
      db,
      projectId,
      propositionId,
      {
        label: 'PARTIALLY_SUPPORTED',
        rationale: 'Only release 1.0 is supported.',
        reviewer: 'Ram',
      },
      LATER,
    );
    assert.equal(second.version, 2);
    assert.deepEqual(
      listPropositionAssessments(db, projectId, propositionId).map((assessment) => [
        assessment.version,
        assessment.label,
      ]),
      [
        [1, 'SUPPORTED_WITHIN_SCOPE'],
        [2, 'PARTIALLY_SUPPORTED'],
      ],
    );
    const events = listAuditEvents(db, projectId);
    assert.equal(events[0]?.action, 'proposition.assessment_recorded');
  } finally {
    closeDatabase(db);
  }
});

test('assessments require a claim under review', () => {
  const db = createTestDatabase();
  try {
    const { projectId, propositionId } = setupClaim(db);
    assert.throws(
      () =>
        recordPropositionAssessment(
          db,
          projectId,
          propositionId,
          { label: 'NOT_ASSESSED', rationale: 'Not reviewed.', reviewer: 'Ram' },
          CONTEXT,
        ),
      /under review/,
    );
  } finally {
    closeDatabase(db);
  }
});
