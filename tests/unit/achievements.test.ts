import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canonicalAchievementRevision,
  claimSupportState,
  parseContributorLines,
  summarizeClaimEvidenceStatus,
  validateAchievementDraft,
  type AchievementRevisionSnapshot,
} from '../../src/core/achievements.ts';

function validDraft() {
  return {
    title: 'A tested local achievement',
    summary: 'A concise record of the work and its recorded evidence.',
    projectName: 'Example project',
    projectDescription: 'The project the achievement belongs to.',
    projectUrl: 'https://example.com/project',
    startDate: '2026-01-01',
    endDate: '2026-02-01',
    claimIds: ['clm_1'],
    contributorLines: 'Ram | AUTHOR | Built and documented the project | SELF_DECLARED |',
    sourceIds: ['src_1'],
    evidenceIds: ['evd_1'],
  } as const;
}

test('a complete achievement draft is validated into structured content', () => {
  const result = validateAchievementDraft(validDraft());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.title, 'A tested local achievement');
  assert.deepEqual(result.value.claimIds, ['clm_1']);
  assert.equal(result.value.contributors.length, 1);
  assert.equal(result.value.contributors[0]?.role, 'AUTHOR');
  assert.equal(result.value.contributors[0]?.supportState, 'SELF_DECLARED');
  assert.equal(result.value.contributors[0]?.evidenceNote, undefined);
});

test('a contributor line needs a known role and support state', () => {
  const result = validateAchievementDraft({
    ...validDraft(),
    contributorLines: 'Ram | OWNER | Did the work | VERIFIED',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  const messages = result.issues.map((issue) => issue.message).join(' ');
  assert.match(messages, /unknown role/);
  assert.match(messages, /unknown support state/);
});

test('a contributor line accepts an optional evidence note', () => {
  const result = parseContributorLines(
    'Ram | MAINTAINER | Maintained releases | EVIDENCE_LINKED | Release notes and test log',
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value[0]?.role, 'MAINTAINER');
  assert.equal(result.value[0]?.supportState, 'EVIDENCE_LINKED');
  assert.equal(result.value[0]?.evidenceNote, 'Release notes and test log');
});

test('a malformed contributor line is rejected by line number', () => {
  const result = parseContributorLines('Ram | AUTHOR | too few fields');
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.issues[0]?.message ?? '', /line 1/);
});

test('the draft requires at least one claim and one contributor', () => {
  const noClaim = validateAchievementDraft({ ...validDraft(), claimIds: [] });
  assert.equal(noClaim.ok, false);
  const noContributor = validateAchievementDraft({ ...validDraft(), contributorLines: '' });
  assert.equal(noContributor.ok, false);
});

test('an end date before the start date is rejected', () => {
  const result = validateAchievementDraft({ ...validDraft(), endDate: '2025-12-01' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.ok(result.issues.some((issue) => issue.field === 'endDate'));
});

test('claim evidence status detects conflict across propositions', () => {
  assert.equal(
    summarizeClaimEvidenceStatus(['SUPPORTED_WITHIN_SCOPE', 'CONTRADICTED']),
    'CONFLICTING_EVIDENCE',
  );
  assert.equal(
    summarizeClaimEvidenceStatus(['SUPPORTED_WITHIN_SCOPE', 'NOT_ASSESSED']),
    'SUPPORTED_WITHIN_SCOPE',
  );
  assert.equal(summarizeClaimEvidenceStatus([]), 'NOT_ASSESSED');
});

test('support state distinguishes recorded support, contradiction and conflict', () => {
  assert.equal(claimSupportState('SUPPORTED_WITHIN_SCOPE', null), 'EVIDENCE_RECORDED');
  assert.equal(claimSupportState('CONTRADICTED', null), 'CONTRADICTION_RECORDED');
  assert.equal(claimSupportState('CONFLICTING_EVIDENCE', null), 'UNRESOLVED');
  assert.equal(claimSupportState('NOT_ASSESSED', 'CONFLICTING_EVIDENCE'), 'UNRESOLVED');
  assert.equal(claimSupportState('NOT_ASSESSED', null), 'SELF_DECLARED');
});

test('the canonical revision normalizes absent values to null and is deterministic', () => {
  const snapshot: AchievementRevisionSnapshot = {
    title: 'Title',
    summary: 'Summary',
    projectName: 'Project',
    projectDescription: null,
    projectUrl: null,
    startDate: null,
    endDate: null,
    claims: [],
    contributors: [],
    evidence: [],
    unresolvedContradictions: [],
  };
  const first = canonicalAchievementRevision(snapshot);
  const second = canonicalAchievementRevision(snapshot);
  assert.equal(first, second);
  const parsed = JSON.parse(first) as Record<string, unknown>;
  assert.equal(parsed['schema'], 'achievement-revision-v1');
  assert.equal(parsed['projectDescription'], null);
  assert.equal(Array.isArray(parsed['claims']), true);
});
