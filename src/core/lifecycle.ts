import {
  CLAIM_TRANSITIONS,
  RUN_TRANSITIONS,
  type ClaimStatus,
  type RunStatus,
} from './vocabulary.ts';

export function canTransitionClaim(from: ClaimStatus, to: ClaimStatus): boolean {
  return CLAIM_TRANSITIONS[from].includes(to);
}

export function canAddProposition(status: ClaimStatus): boolean {
  return status === 'SUBMITTED' || status === 'DECOMPOSED';
}

export function claimStatusAfterPropositionAdded(status: ClaimStatus): ClaimStatus {
  return status === 'SUBMITTED' ? 'DECOMPOSED' : status;
}

export function canRecordPropositionAssessment(status: ClaimStatus): boolean {
  return status === 'UNDER_REVIEW' || status === 'ASSESSED' || status === 'DISPUTED';
}

export function canTransitionRun(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

export function isRunOpen(status: RunStatus): boolean {
  return status === 'OPEN';
}

export function isRunFinal(status: RunStatus): boolean {
  return status === 'FINALIZED' || status === 'CANCELLED';
}
