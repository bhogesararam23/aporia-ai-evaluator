import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canAddProposition,
  canRecordPropositionAssessment,
  canTransitionClaim,
  canTransitionRun,
  claimStatusAfterPropositionAdded,
  isRunFinal,
  isRunOpen,
} from '../../src/core/lifecycle.ts';

test('claim lifecycle allows review progression and dispute paths', () => {
  assert.equal(canTransitionClaim('SUBMITTED', 'DECOMPOSED'), true);
  assert.equal(canTransitionClaim('DECOMPOSED', 'UNDER_REVIEW'), true);
  assert.equal(canTransitionClaim('UNDER_REVIEW', 'ASSESSED'), true);
  assert.equal(canTransitionClaim('ASSESSED', 'UNDER_REVIEW'), true);
  assert.equal(canTransitionClaim('ASSESSED', 'DISPUTED'), true);
  assert.equal(canTransitionClaim('DISPUTED', 'UNDER_REVIEW'), true);
});

test('claim lifecycle rejects skipping and unsupported transitions', () => {
  assert.equal(canTransitionClaim('SUBMITTED', 'ASSESSED'), false);
  assert.equal(canTransitionClaim('DECOMPOSED', 'ASSESSED'), false);
  assert.equal(canTransitionClaim('ASSESSED', 'SUBMITTED'), false);
  assert.equal(canTransitionClaim('DISPUTED', 'ASSESSED'), false);
});

test('propositions can only be added before review starts', () => {
  assert.equal(canAddProposition('SUBMITTED'), true);
  assert.equal(canAddProposition('DECOMPOSED'), true);
  assert.equal(canAddProposition('UNDER_REVIEW'), false);
  assert.equal(canAddProposition('ASSESSED'), false);
  assert.equal(canAddProposition('DISPUTED'), false);
});

test('adding the first proposition advances the claim to decomposed', () => {
  assert.equal(claimStatusAfterPropositionAdded('SUBMITTED'), 'DECOMPOSED');
  assert.equal(claimStatusAfterPropositionAdded('DECOMPOSED'), 'DECOMPOSED');
});

test('proposition assessments require a review state', () => {
  assert.equal(canRecordPropositionAssessment('SUBMITTED'), false);
  assert.equal(canRecordPropositionAssessment('DECOMPOSED'), false);
  assert.equal(canRecordPropositionAssessment('UNDER_REVIEW'), true);
  assert.equal(canRecordPropositionAssessment('ASSESSED'), true);
  assert.equal(canRecordPropositionAssessment('DISPUTED'), true);
});

test('run lifecycle is open, then final or cancelled', () => {
  assert.equal(canTransitionRun('OPEN', 'FINALIZED'), true);
  assert.equal(canTransitionRun('OPEN', 'CANCELLED'), true);
  assert.equal(canTransitionRun('FINALIZED', 'OPEN'), false);
  assert.equal(canTransitionRun('CANCELLED', 'FINALIZED'), false);
  assert.equal(canTransitionRun('FINALIZED', 'CANCELLED'), false);
});

test('run state predicates distinguish mutable and terminal states', () => {
  assert.equal(isRunOpen('OPEN'), true);
  assert.equal(isRunOpen('FINALIZED'), false);
  assert.equal(isRunFinal('FINALIZED'), true);
  assert.equal(isRunFinal('CANCELLED'), true);
  assert.equal(isRunFinal('OPEN'), false);
});
