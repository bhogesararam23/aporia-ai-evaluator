import {
  FINDING_CAUSES,
  FINDING_REFERENCE_TYPES,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  type FindingCause,
  type FindingReferenceType,
  type FindingSeverity,
  type FindingStatus,
} from './findings.ts';
import {
  enumValue,
  invalidMany,
  isoDateTime,
  optionalText,
  requiredText,
  valid,
  type ValidationIssue,
  type ValidationResult,
} from './validation.ts';
import type { RawFields } from './inputs.ts';

// The bounds mirror the `remediation_findings` CHECK constraints. Duplicating them here is
// deliberate: an operator should get a named field error on the form, not a raw constraint message
// from the database, and the schema keeps enforcing them for every other writer.
const TITLE = { min: 3, max: 300 };
const LONG_TEXT = { min: 3, max: 8000, multiline: true };
const RATIONALE = { min: 3, max: 4000, multiline: true };
const SHORT_TEXT = { min: 1, max: 80 };

interface Collector {
  readonly issues: ValidationIssue[];
  read<T>(result: ValidationResult<T>): T;
}

function collector(): Collector {
  const issues: ValidationIssue[] = [];
  return {
    issues,
    read<T>(result: ValidationResult<T>): T {
      if (result.ok) {
        return result.value;
      }
      issues.push(...result.issues);
      return undefined as T;
    },
  };
}

export interface FindingDraftInput {
  readonly title: string;
  readonly observedIssue: string;
  readonly supportingEvidence: string;
  readonly cause: FindingCause;
  readonly severity: FindingSeverity;
  readonly severityRationale: string;
  readonly recommendedAction: string;
  readonly ownerLabel: string;
  readonly firstObservedAt: string;
  readonly lastObservedAt: string;
  readonly reportSuggestionKey: string | undefined;
}

/**
 * Validate a new finding as it arrives from the form.
 *
 * `lastObservedAt` must not precede `firstObservedAt`: a finding whose observed window runs backwards
 * would read as a fabricated trend, and no downstream comparison can repair the ordering.
 */
export function validateFindingDraftInput(
  raw: RawFields,
): ValidationResult<FindingDraftInput & { readonly references: readonly [] }> {
  const scope = collector();
  const title = scope.read(requiredText(raw['title'], 'title', TITLE));
  const observedIssue = scope.read(requiredText(raw['observedIssue'], 'observedIssue', LONG_TEXT));
  const supportingEvidence = scope.read(
    requiredText(raw['supportingEvidence'], 'supportingEvidence', LONG_TEXT),
  );
  const cause = scope.read(enumValue(raw['cause'], 'cause', FINDING_CAUSES));
  const severity = scope.read(enumValue(raw['severity'], 'severity', FINDING_SEVERITIES));
  const severityRationale = scope.read(
    requiredText(raw['severityRationale'], 'severityRationale', RATIONALE),
  );
  const recommendedAction = scope.read(
    requiredText(raw['recommendedAction'], 'recommendedAction', RATIONALE),
  );
  const ownerLabel = scope.read(requiredText(raw['ownerLabel'], 'ownerLabel', SHORT_TEXT));
  const firstObservedAt = scope.read(isoDateTime(raw['firstObservedAt'], 'firstObservedAt'));
  const lastObservedAt = scope.read(isoDateTime(raw['lastObservedAt'], 'lastObservedAt'));
  const reportSuggestionKey = scope.read(
    optionalText(raw['reportSuggestionKey'], 'reportSuggestionKey', { max: 120 }),
  );
  if (scope.issues.length === 0 && Date.parse(lastObservedAt) < Date.parse(firstObservedAt)) {
    scope.issues.push({
      field: 'lastObservedAt',
      message: 'The last observation cannot come before the first one.',
    });
  }
  if (scope.issues.length > 0) {
    return invalidMany(scope.issues);
  }
  return valid({
    title,
    observedIssue,
    supportingEvidence,
    cause,
    severity,
    severityRationale,
    recommendedAction,
    ownerLabel,
    firstObservedAt,
    lastObservedAt,
    reportSuggestionKey,
    references: [],
  });
}

export interface FindingTransitionInput {
  readonly status: FindingStatus;
  readonly note: string;
  readonly rationale: string | undefined;
  readonly comparisonId: string | undefined;
}

/**
 * Validate a status change.
 *
 * The rationale is optional here because the lifecycle, not the form, decides when one is owed; the
 * repository still refuses a closure without it. Keeping the field optional in this validator means
 * the operator sees the specific lifecycle message rather than a blank-field error.
 */
export function validateFindingTransitionInput(
  raw: RawFields,
): ValidationResult<FindingTransitionInput> {
  const scope = collector();
  const status = scope.read(enumValue(raw['status'], 'status', FINDING_STATUSES));
  const note = scope.read(requiredText(raw['note'], 'note', RATIONALE));
  const rationale = scope.read(optionalText(raw['rationale'], 'rationale', RATIONALE));
  const comparisonId = scope.read(optionalText(raw['comparisonId'], 'comparisonId', { max: 40 }));
  if (scope.issues.length > 0) {
    return invalidMany(scope.issues);
  }
  return valid({ status, note, rationale, comparisonId });
}

export interface FindingDetailsInput {
  readonly severity: FindingSeverity | undefined;
  readonly cause: FindingCause | undefined;
  readonly recommendedAction: string | undefined;
  readonly ownerLabel: string | undefined;
  readonly lastObservedAt: string | undefined;
  readonly note: string;
}

/** Validate an edit of the non-status fields. At least one field must actually be changing. */
export function validateFindingDetailsInput(raw: RawFields): ValidationResult<FindingDetailsInput> {
  const scope = collector();
  const severity = scope.read(
    raw['severity'] === undefined || String(raw['severity'] ?? '').trim() === ''
      ? valid<FindingSeverity | undefined>(undefined)
      : enumValue(raw['severity'], 'severity', FINDING_SEVERITIES),
  );
  const cause = scope.read(
    raw['cause'] === undefined || String(raw['cause'] ?? '').trim() === ''
      ? valid<FindingCause | undefined>(undefined)
      : enumValue(raw['cause'], 'cause', FINDING_CAUSES),
  );
  const recommendedAction = scope.read(
    optionalText(raw['recommendedAction'], 'recommendedAction', RATIONALE),
  );
  const ownerLabel = scope.read(optionalText(raw['ownerLabel'], 'ownerLabel', SHORT_TEXT));
  const lastObservedAt = scope.read(
    raw['lastObservedAt'] === undefined || String(raw['lastObservedAt'] ?? '').trim() === ''
      ? valid<string | undefined>(undefined)
      : isoDateTime(raw['lastObservedAt'], 'lastObservedAt'),
  );
  const note = scope.read(requiredText(raw['note'], 'note', RATIONALE));
  const changed =
    severity !== undefined ||
    cause !== undefined ||
    recommendedAction !== undefined ||
    ownerLabel !== undefined ||
    lastObservedAt !== undefined;
  if (!changed) {
    scope.issues.push({
      field: 'severity',
      message: 'Change at least one field, or record a progress note on the lifecycle instead.',
    });
  }
  if (scope.issues.length > 0) {
    return invalidMany(scope.issues);
  }
  return valid({ severity, cause, recommendedAction, ownerLabel, lastObservedAt, note });
}

export interface FindingReferenceDraftInput {
  readonly type: FindingReferenceType;
  readonly id: string;
}

/**
 * Validate a typed pointer.
 *
 * The target's existence and project are decided by the database, because only the database can see
 * all eight target tables at once; this validator stops a blank identifier or an invented type from
 * reaching it.
 */
export function validateFindingReferenceInput(
  raw: RawFields,
): ValidationResult<FindingReferenceDraftInput> {
  const scope = collector();
  const type = scope.read(
    enumValue(raw['referenceType'], 'referenceType', FINDING_REFERENCE_TYPES),
  );
  const id = scope.read(requiredText(raw['referenceId'], 'referenceId', { max: 40 }));
  if (scope.issues.length > 0) {
    return invalidMany(scope.issues);
  }
  return valid({ type, id });
}

export interface RetestFocusInput {
  readonly baseRunId: string;
  readonly laterRunId: string;
  readonly focusMetric: string;
}

/** Validate the run pair and metric a retest comparison is about. */
export function validateRetestFocusInput(raw: RawFields): ValidationResult<RetestFocusInput> {
  const scope = collector();
  const baseRunId = scope.read(requiredText(raw['baseRunId'], 'baseRunId', { max: 40 }));
  const laterRunId = scope.read(requiredText(raw['laterRunId'], 'laterRunId', { max: 40 }));
  const focusMetric = scope.read(requiredText(raw['focusMetric'], 'focusMetric', { max: 80 }));
  if (scope.issues.length === 0 && baseRunId === laterRunId) {
    scope.issues.push({
      field: 'laterRunId',
      message: 'Choose a later run; a run cannot be compared with itself.',
    });
  }
  if (scope.issues.length > 0) {
    return invalidMany(scope.issues);
  }
  return valid({ baseRunId, laterRunId, focusMetric });
}
