import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveEvidenceStatus, type EvidenceRelationshipRecord } from '../../src/core/evidence.ts';
import {
  EVIDENCE_RULE_VERSION,
  EVIDENCE_RULE_VERSION_V2,
  KNOWN_EVIDENCE_RULE_VERSIONS,
} from '../../src/core/versions.ts';
import type {
  EvidenceRelation,
  SourceIndependence,
  SourceType,
} from '../../src/core/vocabulary.ts';

function relationship(
  id: string,
  relation: EvidenceRelation,
  sourceId = 'source-1',
  sourceType: SourceType = 'INDEPENDENT_SOURCE',
  independence: SourceIndependence = 'INDEPENDENT',
): EvidenceRelationshipRecord {
  return { id, relation, sourceId, sourceType, independence };
}

/**
 * ADR-025: `evidence-aggregation-v1` counts distinct `sourceId` values among supporting relationships
 * and consults independence only to caveat self-published material. Two records the reviewer marked
 * `RELATED` (the same underlying story syndicated by two publishers) therefore read as two independent
 * corroborating sources. `evidence-aggregation-v2` counts corroboration by underlying source with
 * independence as the gate: a `RELATED` supporting record never adds a corroborating source, while the
 * status precedence is deliberately unchanged. These tests are written to fail against `v1`.
 */

test('the application default rule version stays evidence-aggregation-v1 (owner-gated)', () => {
  assert.equal(EVIDENCE_RULE_VERSION, 'evidence-aggregation-v1');
  assert.equal(EVIDENCE_RULE_VERSION_V2, 'evidence-aggregation-v2');
  assert.deepEqual(
    [...KNOWN_EVIDENCE_RULE_VERSIONS],
    ['evidence-aggregation-v1', 'evidence-aggregation-v2'],
  );
  // Calling with no version must be byte-identical to calling with v1: nothing about the default moves.
  const relatedPair = [
    relationship('r1', 'SUPPORTS', 's1', 'INDEPENDENT_SOURCE', 'INDEPENDENT'),
    relationship('r2', 'SUPPORTS', 's2', 'INDEPENDENT_SOURCE', 'RELATED'),
  ];
  const defaulted = deriveEvidenceStatus(relatedPair);
  const explicitV1 = deriveEvidenceStatus(relatedPair, 'evidence-aggregation-v1');
  assert.deepEqual(defaulted, explicitV1);
  assert.equal(defaulted.ruleVersion, 'evidence-aggregation-v1');
});

test('v1 counts a related/syndicated copy as a second corroborating source', () => {
  const derived = deriveEvidenceStatus(
    [
      relationship('r1', 'SUPPORTS', 's1', 'INDEPENDENT_SOURCE', 'INDEPENDENT'),
      relationship('r2', 'SUPPORTS', 's2', 'INDEPENDENT_SOURCE', 'RELATED'),
    ],
    'evidence-aggregation-v1',
  );
  // This is the defect: the reviewer said the second record is related, yet it still corroborates.
  assert.equal(derived.supportingSourceCount, 2);
});

test('v2 does not let a related/syndicated copy add a corroborating source', () => {
  const derived = deriveEvidenceStatus(
    [
      relationship('r1', 'SUPPORTS', 's1', 'INDEPENDENT_SOURCE', 'INDEPENDENT'),
      relationship('r2', 'SUPPORTS', 's2', 'INDEPENDENT_SOURCE', 'RELATED'),
    ],
    EVIDENCE_RULE_VERSION_V2,
  );
  assert.equal(derived.ruleVersion, EVIDENCE_RULE_VERSION_V2);
  assert.equal(derived.status, 'SUPPORTED_WITHIN_SCOPE');
  assert.equal(derived.counts.SUPPORTS, 2);
  assert.equal(derived.supportingSourceCount, 1);
  assert.equal(derived.apparentCorroboratingSourceCount, 2);
  assert.ok(
    derived.notes.some((note) => /related or syndicated/i.test(note)),
    'the collapse of a related record must be disclosed, not silent',
  );
});

test('v2 collapses two copies of one underlying source to a single corroborating source', () => {
  // Same sourceId recorded twice is already one source under v1; v2 must preserve that.
  const v1 = deriveEvidenceStatus(
    [
      relationship('r1', 'SUPPORTS', 'same', 'INDEPENDENT_SOURCE', 'INDEPENDENT'),
      relationship('r2', 'SUPPORTS', 'same', 'INDEPENDENT_SOURCE', 'INDEPENDENT'),
    ],
    'evidence-aggregation-v1',
  );
  const v2 = deriveEvidenceStatus(
    [
      relationship('r1', 'SUPPORTS', 'same', 'INDEPENDENT_SOURCE', 'INDEPENDENT'),
      relationship('r2', 'SUPPORTS', 'same', 'INDEPENDENT_SOURCE', 'INDEPENDENT'),
    ],
    EVIDENCE_RULE_VERSION_V2,
  );
  assert.equal(v1.supportingSourceCount, 1);
  assert.equal(v2.supportingSourceCount, 1);
});

test('v2 leaves the status precedence unchanged; only the corroboration figure moves', () => {
  // Two genuinely distinct independent sources: same status, same count under both rules.
  const independent = [
    relationship('r1', 'SUPPORTS', 's1', 'INDEPENDENT_SOURCE', 'INDEPENDENT'),
    relationship('r2', 'SUPPORTS', 's2', 'INDEPENDENT_SOURCE', 'INDEPENDENT'),
  ];
  assert.equal(
    deriveEvidenceStatus(independent, 'evidence-aggregation-v1').status,
    deriveEvidenceStatus(independent, EVIDENCE_RULE_VERSION_V2).status,
  );
  assert.equal(
    deriveEvidenceStatus(independent, EVIDENCE_RULE_VERSION_V2).supportingSourceCount,
    2,
  );
  // A contradiction still dominates regardless of independence: precedence order is untouched.
  const conflicting = [
    relationship('r1', 'SUPPORTS', 's1', 'INDEPENDENT_SOURCE', 'INDEPENDENT'),
    relationship('r2', 'CONTRADICTS', 's2', 'INDEPENDENT_SOURCE', 'INDEPENDENT'),
  ];
  assert.equal(
    deriveEvidenceStatus(conflicting, 'evidence-aggregation-v1').status,
    'CONFLICTING_EVIDENCE',
  );
  assert.equal(
    deriveEvidenceStatus(conflicting, EVIDENCE_RULE_VERSION_V2).status,
    'CONFLICTING_EVIDENCE',
  );
});

test('v2 gives UNKNOWN independence the caveat, not the benefit of the doubt', () => {
  const derived = deriveEvidenceStatus(
    [
      relationship('r1', 'SUPPORTS', 's1', 'INDEPENDENT_SOURCE', 'UNKNOWN'),
      relationship('r2', 'SUPPORTS', 's2', 'INDEPENDENT_SOURCE', 'UNKNOWN'),
    ],
    EVIDENCE_RULE_VERSION_V2,
  );
  // UNKNOWN is distinct material the reviewer could not classify: it still counts as sources today,
  // but the caveat is attached so the reader is not told this is independent corroboration.
  assert.equal(derived.supportingSourceCount, 2);
  assert.ok(derived.notes.some((note) => /Independence is unknown/i.test(note)));
});

test('v2 records zero independent corroboration when every supporting source is related', () => {
  const derived = deriveEvidenceStatus(
    [
      relationship('r1', 'SUPPORTS', 's1', 'INDEPENDENT_SOURCE', 'RELATED'),
      relationship('r2', 'SUPPORTS', 's2', 'INDEPENDENT_SOURCE', 'RELATED'),
    ],
    EVIDENCE_RULE_VERSION_V2,
  );
  // Still supported by a record, but nothing the reviewer believes is independent corroborates it.
  assert.equal(derived.status, 'SUPPORTED_WITHIN_SCOPE');
  assert.equal(derived.supportingSourceCount, 0);
  assert.equal(derived.apparentCorroboratingSourceCount, 2);
  assert.ok(derived.notes.some((note) => /no independent corroboration/i.test(note)));
});

test('v2 exposes the exact v1 figure so a reader can see the two rules disagree', () => {
  const mixed = [
    relationship('r1', 'SUPPORTS', 's1', 'INDEPENDENT_SOURCE', 'INDEPENDENT'),
    relationship('r2', 'SUPPORTS', 's2', 'INDEPENDENT_SOURCE', 'RELATED'),
    relationship('r3', 'SUPPORTS', 's3', 'INDEPENDENT_SOURCE', 'INDEPENDENT'),
  ];
  const derived = deriveEvidenceStatus(mixed, EVIDENCE_RULE_VERSION_V2);
  // Three records reference three source ids; one is related, so two independent sources corroborate.
  assert.equal(derived.apparentCorroboratingSourceCount, 3);
  assert.equal(derived.supportingSourceCount, 2);
});

test('v2 output carries no optional divergence fields when v1 would not differ', () => {
  // A single independent supporting record: v1 and v2 agree, so v2 adds no divergence fields.
  const derived = deriveEvidenceStatus(
    [relationship('r1', 'SUPPORTS', 's1', 'INDEPENDENT_SOURCE', 'INDEPENDENT')],
    EVIDENCE_RULE_VERSION_V2,
  );
  assert.equal(derived.supportingSourceCount, 1);
  assert.equal(derived.apparentCorroboratingSourceCount, undefined);
  assert.equal(
    derived.notes.some((note) => /would count/i.test(note)),
    false,
  );
});

test('an unrecognised rule version is refused rather than silently falling back', () => {
  assert.throws(
    () =>
      deriveEvidenceStatus(
        [relationship('r1', 'SUPPORTS', 's1')],
        'evidence-aggregation-v99' as never,
      ),
    /rule version/i,
  );
});
