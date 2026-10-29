import { ATTRIBUTION_ROLES, type AttributionRole, type PropositionStatus } from './vocabulary.ts';
import {
  invalid,
  invalidMany,
  optionalDateOnly,
  optionalHttpUrl,
  optionalText,
  requiredText,
  valid,
  type ValidationIssue,
  type ValidationResult,
} from './validation.ts';

export const ACHIEVEMENT_CLAIM_SUPPORT_STATES = [
  'SELF_DECLARED',
  'EVIDENCE_RECORDED',
  'CONTRADICTION_RECORDED',
  'UNRESOLVED',
] as const;
export type AchievementClaimSupportState = (typeof ACHIEVEMENT_CLAIM_SUPPORT_STATES)[number];

export const ACHIEVEMENT_CLAIM_SUPPORT_STATE_LABELS: Record<AchievementClaimSupportState, string> =
  {
    SELF_DECLARED: 'Self-declared; no evidence relationship recorded',
    EVIDENCE_RECORDED: 'Evidence relationships recorded',
    CONTRADICTION_RECORDED: 'Contradiction recorded',
    UNRESOLVED: 'Unresolved support and contradiction',
  };

export const ACHIEVEMENT_CLAIM_SUPPORT_STATE_DESCRIPTIONS: Record<
  AchievementClaimSupportState,
  string
> = {
  SELF_DECLARED:
    'The claim is included because the operator supplied it. No active evidence relationship is recorded for its propositions.',
  EVIDENCE_RECORDED:
    'At least one proposition has recorded supporting or qualifying evidence. This is a reviewer record, not independent verification.',
  CONTRADICTION_RECORDED:
    'At least one proposition has a recorded contradiction and no recorded support.',
  UNRESOLVED:
    'Recorded support and contradiction coexist, or a human assessment records a conflict. The dispute remains unresolved.',
};

export const ACHIEVEMENT_CONTRIBUTOR_SUPPORT_STATES = [
  'SELF_DECLARED',
  'EVIDENCE_LINKED',
  'DISPUTED',
] as const;
export type AchievementContributorSupportState =
  (typeof ACHIEVEMENT_CONTRIBUTOR_SUPPORT_STATES)[number];

export const ACHIEVEMENT_CONTRIBUTOR_SUPPORT_STATE_LABELS: Record<
  AchievementContributorSupportState,
  string
> = {
  SELF_DECLARED: 'Self-declared contribution',
  EVIDENCE_LINKED: 'Evidence note linked',
  DISPUTED: 'Disputed contribution',
};

export const ACHIEVEMENT_CONTRIBUTOR_SUPPORT_STATE_DESCRIPTIONS: Record<
  AchievementContributorSupportState,
  string
> = {
  SELF_DECLARED: 'The operator states this contribution. No evidence link is recorded for it.',
  EVIDENCE_LINKED:
    'The operator recorded a note pointing to evidence. The evidence has not been independently verified by Aporia.',
  DISPUTED: 'The contribution or role is disputed and remains unresolved.',
};

export interface AchievementContributorInput {
  readonly name: string;
  readonly role: AttributionRole;
  readonly contribution: string;
  readonly supportState: AchievementContributorSupportState;
  readonly evidenceNote: string | undefined;
}

export interface AchievementRevisionInput {
  readonly title: string;
  readonly summary: string;
  readonly projectName: string;
  readonly projectDescription: string | undefined;
  readonly projectUrl: string | undefined;
  readonly startDate: string | undefined;
  readonly endDate: string | undefined;
  readonly claimIds: readonly string[];
  readonly contributors: readonly AchievementContributorInput[];
  readonly sourceIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface AchievementDraftRaw {
  readonly title: unknown;
  readonly summary: unknown;
  readonly projectName: unknown;
  readonly projectDescription: unknown;
  readonly projectUrl: unknown;
  readonly startDate: unknown;
  readonly endDate: unknown;
  readonly claimIds: readonly string[];
  readonly contributorLines: unknown;
  readonly sourceIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

function idList(
  values: readonly string[],
  field: string,
  minimum: number,
  maximum: number,
): ValidationResult<string[]> {
  if (values.length < minimum) {
    return invalid(field, `Select at least ${minimum}.`);
  }
  if (values.length > maximum) {
    return invalid(field, `Select ${maximum} items or fewer.`);
  }
  const unique = [...new Set(values)];
  if (unique.length !== values.length) {
    return invalid(field, 'The selection contains duplicates.');
  }
  for (const value of unique) {
    if (value.length === 0 || value.length > 100) {
      return invalid(field, 'A selected identifier is not valid.');
    }
  }
  return valid(unique);
}

function parseSupportState(value: string): AchievementContributorSupportState | undefined {
  return ACHIEVEMENT_CONTRIBUTOR_SUPPORT_STATES.find((state) => state === value);
}

function parseRole(value: string): AttributionRole | undefined {
  return ATTRIBUTION_ROLES.find((role) => role === value);
}

/**
 * One contributor per line:
 * `Name | ROLE | Contribution | SELF_DECLARED|EVIDENCE_LINKED|DISPUTED | optional evidence note`.
 * The role and support state are controlled codes; the note is optional.
 */
export function parseContributorLines(
  raw: unknown,
): ValidationResult<AchievementContributorInput[]> {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return invalid('contributorLines', 'Add at least one contributor.');
  }
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return invalid('contributorLines', 'Add at least one contributor.');
  }
  if (lines.length > 20) {
    return invalid('contributorLines', 'Use 20 contributors or fewer.');
  }
  const issues: ValidationIssue[] = [];
  const contributors: AchievementContributorInput[] = [];
  for (const [index, line] of lines.entries()) {
    const parts = line.split('|').map((part) => part.trim());
    if (parts.length < 4 || parts.length > 5) {
      issues.push({
        field: 'contributorLines',
        message: `Contributor line ${index + 1} must have 4 or 5 fields separated by |.`,
      });
      continue;
    }
    const [name, roleText, contribution, supportText, evidenceNote] = parts;
    if (name === undefined || name.length === 0 || name.length > 200) {
      issues.push({
        field: 'contributorLines',
        message: `Contributor line ${index + 1} needs a name of 1 to 200 characters.`,
      });
    }
    if (contribution === undefined || contribution.length === 0 || contribution.length > 2000) {
      issues.push({
        field: 'contributorLines',
        message: `Contributor line ${index + 1} needs a contribution of 1 to 2000 characters.`,
      });
    }
    const role = parseRole(roleText ?? '');
    if (role === undefined) {
      issues.push({
        field: 'contributorLines',
        message: `Contributor line ${index + 1} has an unknown role. Use one of ${ATTRIBUTION_ROLES.join(', ')}.`,
      });
    }
    const supportState = parseSupportState(supportText ?? '');
    if (supportState === undefined) {
      issues.push({
        field: 'contributorLines',
        message: `Contributor line ${index + 1} has an unknown support state. Use one of ${ACHIEVEMENT_CONTRIBUTOR_SUPPORT_STATES.join(', ')}.`,
      });
    }
    if (evidenceNote !== undefined && evidenceNote.length > 1000) {
      issues.push({
        field: 'contributorLines',
        message: `Contributor line ${index + 1} has an evidence note longer than 1000 characters.`,
      });
    }
    if (
      name !== undefined &&
      name.length > 0 &&
      contribution !== undefined &&
      contribution.length > 0 &&
      role !== undefined &&
      supportState !== undefined
    ) {
      contributors.push({
        name,
        role,
        contribution,
        supportState,
        evidenceNote:
          evidenceNote === undefined || evidenceNote.length === 0 ? undefined : evidenceNote,
      });
    }
  }
  if (issues.length > 0) {
    return invalidMany(issues);
  }
  return valid(contributors);
}

export function validateAchievementDraft(
  raw: AchievementDraftRaw,
): ValidationResult<AchievementRevisionInput> {
  const issues: ValidationIssue[] = [];
  const title = requiredText(raw.title, 'title', { max: 200 });
  if (!title.ok) {
    issues.push(...title.issues);
  }
  const summary = requiredText(raw.summary, 'summary', { max: 4000, multiline: true });
  if (!summary.ok) {
    issues.push(...summary.issues);
  }
  const projectName = requiredText(raw.projectName, 'projectName', { max: 200 });
  if (!projectName.ok) {
    issues.push(...projectName.issues);
  }
  const projectDescription = optionalText(raw.projectDescription, 'projectDescription', {
    max: 4000,
    multiline: true,
  });
  if (!projectDescription.ok) {
    issues.push(...projectDescription.issues);
  }
  const projectUrl = optionalHttpUrl(raw.projectUrl, 'projectUrl');
  if (!projectUrl.ok) {
    issues.push(...projectUrl.issues);
  }
  const startDate = optionalDateOnly(raw.startDate, 'startDate');
  if (!startDate.ok) {
    issues.push(...startDate.issues);
  }
  const endDate = optionalDateOnly(raw.endDate, 'endDate');
  if (!endDate.ok) {
    issues.push(...endDate.issues);
  }
  if (startDate.ok && endDate.ok && startDate.value !== undefined && endDate.value !== undefined) {
    if (startDate.value > endDate.value) {
      issues.push({ field: 'endDate', message: 'The end date cannot be before the start date.' });
    }
  }
  const claimIds = idList(raw.claimIds, 'claimIds', 1, 50);
  if (!claimIds.ok) {
    issues.push(...claimIds.issues);
  }
  const sourceIds = idList(raw.sourceIds, 'sourceIds', 0, 50);
  if (!sourceIds.ok) {
    issues.push(...sourceIds.issues);
  }
  const evidenceIds = idList(raw.evidenceIds, 'evidenceIds', 0, 100);
  if (!evidenceIds.ok) {
    issues.push(...evidenceIds.issues);
  }
  const contributors = parseContributorLines(raw.contributorLines);
  if (!contributors.ok) {
    issues.push(...contributors.issues);
  }
  if (issues.length > 0) {
    return invalidMany(issues);
  }
  if (
    !title.ok ||
    !summary.ok ||
    !projectName.ok ||
    !projectDescription.ok ||
    !projectUrl.ok ||
    !startDate.ok ||
    !endDate.ok ||
    !claimIds.ok ||
    !sourceIds.ok ||
    !evidenceIds.ok ||
    !contributors.ok
  ) {
    return invalidMany([{ field: 'form', message: 'The achievement draft is incomplete.' }]);
  }
  return valid({
    title: title.value,
    summary: summary.value,
    projectName: projectName.value,
    projectDescription: projectDescription.value,
    projectUrl: projectUrl.value,
    startDate: startDate.value,
    endDate: endDate.value,
    claimIds: claimIds.value,
    contributors: contributors.value,
    sourceIds: sourceIds.value,
    evidenceIds: evidenceIds.value,
  });
}

const EVIDENCE_STATUS_PRIORITY: readonly PropositionStatus[] = [
  'CONFLICTING_EVIDENCE',
  'CONTRADICTED',
  'SUPPORTED_WITHIN_SCOPE',
  'PARTIALLY_SUPPORTED',
  'UNAVAILABLE',
  'INSUFFICIENT_EVIDENCE',
  'NOT_ASSESSED',
];

/** The most consequential recorded status across a claim's propositions. */
export function summarizeClaimEvidenceStatus(
  statuses: readonly PropositionStatus[],
): PropositionStatus {
  const hasSupport = statuses.some(
    (status) => status === 'SUPPORTED_WITHIN_SCOPE' || status === 'PARTIALLY_SUPPORTED',
  );
  const hasContradiction = statuses.some(
    (status) => status === 'CONTRADICTED' || status === 'CONFLICTING_EVIDENCE',
  );
  if (hasSupport && hasContradiction) {
    return 'CONFLICTING_EVIDENCE';
  }
  for (const status of EVIDENCE_STATUS_PRIORITY) {
    if (statuses.includes(status)) {
      return status;
    }
  }
  return 'NOT_ASSESSED';
}

export function claimSupportState(
  evidenceStatus: PropositionStatus,
  humanAssessmentStatus: PropositionStatus | null,
): AchievementClaimSupportState {
  if (
    evidenceStatus === 'CONFLICTING_EVIDENCE' ||
    humanAssessmentStatus === 'CONFLICTING_EVIDENCE'
  ) {
    return 'UNRESOLVED';
  }
  if (evidenceStatus === 'CONTRADICTED' || humanAssessmentStatus === 'CONTRADICTED') {
    return 'CONTRADICTION_RECORDED';
  }
  if (
    evidenceStatus === 'SUPPORTED_WITHIN_SCOPE' ||
    evidenceStatus === 'PARTIALLY_SUPPORTED' ||
    humanAssessmentStatus === 'SUPPORTED_WITHIN_SCOPE' ||
    humanAssessmentStatus === 'PARTIALLY_SUPPORTED'
  ) {
    return 'EVIDENCE_RECORDED';
  }
  return 'SELF_DECLARED';
}

export interface AchievementClaimSnapshot {
  readonly claimId: string | null;
  readonly claimRevisionId: string | null;
  readonly ordinal: number;
  readonly claimText: string;
  readonly evidenceStatus: PropositionStatus;
  readonly supportState: AchievementClaimSupportState;
  readonly humanAssessmentStatus: PropositionStatus | null;
  readonly evidenceRelationshipCount: number;
  readonly note: string | null;
}

export interface AchievementContributorSnapshot {
  readonly ordinal: number;
  readonly name: string;
  readonly role: AttributionRole;
  readonly contribution: string;
  readonly supportState: AchievementContributorSupportState;
  readonly evidenceNote: string | null;
}

export interface AchievementEvidenceSnapshot {
  readonly ordinal: number;
  readonly sourceId: string;
  readonly evidenceId: string | null;
  readonly sourceTitle: string;
  readonly sourceUrl: string | null;
  readonly evidenceLocator: string | null;
  readonly evidenceExcerptDigest: string | null;
  readonly note: string | null;
}

export interface AchievementContradictionSnapshot {
  readonly claimId: string | null;
  readonly claimText: string;
  readonly reason: string;
}

export interface AchievementRevisionSnapshot {
  readonly title: string;
  readonly summary: string;
  readonly projectName: string;
  readonly projectDescription: string | null;
  readonly projectUrl: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly claims: readonly AchievementClaimSnapshot[];
  readonly contributors: readonly AchievementContributorSnapshot[];
  readonly evidence: readonly AchievementEvidenceSnapshot[];
  readonly unresolvedContradictions: readonly AchievementContradictionSnapshot[];
}

/**
 * The canonical bytes that a revision hash and an approval bind. Field order is fixed and every
 * optional value is normalized to null, so the same content always produces the same string.
 */
export function canonicalAchievementRevision(snapshot: AchievementRevisionSnapshot): string {
  return JSON.stringify({
    schema: 'achievement-revision-v1',
    title: snapshot.title,
    summary: snapshot.summary,
    projectName: snapshot.projectName,
    projectDescription: snapshot.projectDescription,
    projectUrl: snapshot.projectUrl,
    startDate: snapshot.startDate,
    endDate: snapshot.endDate,
    claims: snapshot.claims.map((claim) => ({
      claimId: claim.claimId,
      claimRevisionId: claim.claimRevisionId,
      ordinal: claim.ordinal,
      claimText: claim.claimText,
      evidenceStatus: claim.evidenceStatus,
      supportState: claim.supportState,
      humanAssessmentStatus: claim.humanAssessmentStatus,
      evidenceRelationshipCount: claim.evidenceRelationshipCount,
      note: claim.note,
    })),
    contributors: snapshot.contributors.map((contributor) => ({
      ordinal: contributor.ordinal,
      name: contributor.name,
      role: contributor.role,
      contribution: contributor.contribution,
      supportState: contributor.supportState,
      evidenceNote: contributor.evidenceNote,
    })),
    evidence: snapshot.evidence.map((item) => ({
      ordinal: item.ordinal,
      sourceId: item.sourceId,
      evidenceId: item.evidenceId,
      sourceTitle: item.sourceTitle,
      sourceUrl: item.sourceUrl,
      evidenceLocator: item.evidenceLocator,
      evidenceExcerptDigest: item.evidenceExcerptDigest,
      note: item.note,
    })),
    unresolvedContradictions: snapshot.unresolvedContradictions.map((contradiction) => ({
      claimId: contradiction.claimId,
      claimText: contradiction.claimText,
      reason: contradiction.reason,
    })),
  });
}
