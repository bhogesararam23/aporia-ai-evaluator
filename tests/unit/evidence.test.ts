import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deriveEvidenceStatus,
  resolvePropositionConclusion,
  type EvidenceRelationshipRecord,
  type RecordedPropositionAssessment,
} from '../../src/core/evidence.ts';
import type {
  EvidenceRelation,
  PropositionStatus,
  SourceIndependence,
  SourceType,
} from '../../src/core/vocabulary.ts';

function relationship(
  id: string,
  relation: EvidenceRelation,
  sourceId = 'source-1',
  sourceType: SourceType = 'PRIMARY_ARTIFACT',
  independence: SourceIndependence = 'INDEPENDENT',
): EvidenceRelationshipRecord {
  return { id, relation, sourceId, sourceType, independence };
}

function humanAssessment(
  version: number,
  label: PropositionStatus,
  overrides: Partial<RecordedPropositionAssessment> = {},
): RecordedPropositionAssessment {
  return {
    id: `assessment-${version}`,
    version,
    label,
    rationale: `Human rationale ${version}.`,
    method: 'HUMAN',
    reviewer: 'Ram',
    createdAt: '2026-10-28T12:00:00.000Z',
    ...overrides,
  };
}

test('empty evidence is explicitly not assessed', () => {
  const derived = deriveEvidenceStatus([]);
  assert.equal(derived.status, 'NOT_ASSESSED');
  assert.equal(derived.ruleVersion, 'evidence-aggregation-v1');
  assert.equal(derived.sourceCount, 0);
  assert.equal(derived.counts.SUPPORTS, 0);
  assert.match(derived.notes[0] ?? '', /No evidence relationships/);
});

test('supporting evidence yields supported within scope', () => {
  const derived = deriveEvidenceStatus([
    relationship('r1', 'SUPPORTS', 's1'),
    relationship('r2', 'SUPPORTS', 's2'),
  ]);
  assert.equal(derived.status, 'SUPPORTED_WITHIN_SCOPE');
  assert.equal(derived.counts.SUPPORTS, 2);
  assert.equal(derived.sourceCount, 2);
  assert.equal(derived.supportingSourceCount, 2);
  assert.equal(
    derived.notes.some((note) => /Duplicate/.test(note)),
    false,
  );
});

test('contradictory evidence alone yields contradicted', () => {
  const derived = deriveEvidenceStatus([relationship('r1', 'CONTRADICTS')]);
  assert.equal(derived.status, 'CONTRADICTED');
  assert.match(derived.rationale, /contradicting/);
});

test('support and contradiction coexist as conflicting evidence', () => {
  const derived = deriveEvidenceStatus([
    relationship('r1', 'SUPPORTS', 's1'),
    relationship('r2', 'CONTRADICTS', 's2'),
  ]);
  assert.equal(derived.status, 'CONFLICTING_EVIDENCE');
  assert.equal(derived.counts.SUPPORTS, 1);
  assert.equal(derived.counts.CONTRADICTS, 1);
  assert.ok(derived.notes.some((note) => /conflict remains unresolved/.test(note)));
});

test('qualifying evidence narrows support to partially supported', () => {
  const supportingPlusQualifier = deriveEvidenceStatus([
    relationship('r1', 'SUPPORTS', 's1'),
    relationship('r2', 'QUALIFIES', 's2'),
  ]);
  assert.equal(supportingPlusQualifier.status, 'PARTIALLY_SUPPORTED');

  const qualifierOnly = deriveEvidenceStatus([relationship('r1', 'QUALIFIES', 's1')]);
  assert.equal(qualifierOnly.status, 'PARTIALLY_SUPPORTED');
});

test('contextual and non-addressing evidence is insufficient', () => {
  const derived = deriveEvidenceStatus([
    relationship('r1', 'CONTEXTUALIZES'),
    relationship('r2', 'DOES_NOT_ADDRESS'),
  ]);
  assert.equal(derived.status, 'INSUFFICIENT_EVIDENCE');
  assert.ok(derived.notes.some((note) => /did not contribute/.test(note)));
});

test('unreadable evidence alone is unavailable, not a contradiction', () => {
  const derived = deriveEvidenceStatus([relationship('r1', 'UNAVAILABLE')]);
  assert.equal(derived.status, 'UNAVAILABLE');
  assert.equal(derived.counts.CONTRADICTS, 0);
  assert.ok(derived.notes.some((note) => /could not be inspected/.test(note)));
});

test('unreadable evidence mixed with context remains insufficient', () => {
  const derived = deriveEvidenceStatus([
    relationship('r1', 'UNAVAILABLE'),
    relationship('r2', 'CONTEXTUALIZES'),
  ]);
  assert.equal(derived.status, 'INSUFFICIENT_EVIDENCE');
});

test('duplicate sources are disclosed rather than counted as corroboration', () => {
  const derived = deriveEvidenceStatus([
    relationship('r1', 'SUPPORTS', 'same-source'),
    relationship('r2', 'SUPPORTS', 'same-source'),
  ]);
  assert.equal(derived.status, 'SUPPORTED_WITHIN_SCOPE');
  assert.equal(derived.sourceCount, 1);
  assert.equal(derived.supportingSourceCount, 1);
  assert.ok(derived.notes.some((note) => /distinct source/.test(note)));
});

test('self-published and unknown-independence caveats are explicit', () => {
  const selfPublished = deriveEvidenceStatus([
    relationship('r1', 'SUPPORTS', 's1', 'SELF_PUBLISHED', 'SELF_PUBLISHED'),
  ]);
  assert.ok(selfPublished.notes.some((note) => /self-published/.test(note)));

  const unknown = deriveEvidenceStatus([
    relationship('r1', 'SUPPORTS', 's1', 'PRIMARY_ARTIFACT', 'UNKNOWN'),
  ]);
  assert.ok(unknown.notes.some((note) => /Independence is unknown/.test(note)));
});

test('a qualifying and contradictory record does not hide the contradiction', () => {
  const derived = deriveEvidenceStatus([
    relationship('r1', 'QUALIFIES', 's1'),
    relationship('r2', 'CONTRADICTS', 's2'),
  ]);
  assert.equal(derived.status, 'CONTRADICTED');
  assert.ok(derived.notes.some((note) => /Qualifying evidence/.test(note)));
});

test('no human assessment means the rule conclusion is primary', () => {
  const derived = deriveEvidenceStatus([relationship('r1', 'SUPPORTS')]);
  const conclusion = resolvePropositionConclusion(derived, []);
  assert.equal(conclusion.humanAssessment, null);
  assert.equal(conclusion.primary.method, 'RULE');
  assert.equal(conclusion.primary.status, 'SUPPORTED_WITHIN_SCOPE');
  assert.equal(conclusion.primary.version, 'evidence-aggregation-v1');
  assert.equal(conclusion.disagreement, false);
});

test('the latest human assessment is primary and disagreement is visible', () => {
  const derived = deriveEvidenceStatus([relationship('r1', 'SUPPORTS')]);
  const conclusion = resolvePropositionConclusion(derived, [
    humanAssessment(1, 'INSUFFICIENT_EVIDENCE'),
    humanAssessment(2, 'PARTIALLY_SUPPORTED'),
  ]);
  assert.equal(conclusion.primary.method, 'HUMAN');
  assert.equal(conclusion.primary.status, 'PARTIALLY_SUPPORTED');
  assert.equal(conclusion.primary.reviewer, 'Ram');
  assert.equal(conclusion.primary.version, 'proposition-assessment-v2');
  assert.equal(conclusion.disagreement, true);
  assert.equal(conclusion.humanAssessment?.version, 2);
  assert.equal(conclusion.derived.status, 'SUPPORTED_WITHIN_SCOPE');
});

test('rule assessments are ignored when selecting a human conclusion', () => {
  const derived = deriveEvidenceStatus([]);
  const conclusion = resolvePropositionConclusion(derived, [
    humanAssessment(1, 'NOT_ASSESSED', { method: 'RULE' }),
  ]);
  assert.equal(conclusion.humanAssessment, null);
  assert.equal(conclusion.primary.method, 'RULE');
});
