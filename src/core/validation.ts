export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
}

export interface ValidationSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export interface ValidationFailure {
  readonly ok: false;
  readonly issues: readonly ValidationIssue[];
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export function valid<T>(value: T): ValidationSuccess<T> {
  return { ok: true, value };
}

export function invalid(field: string, message: string): ValidationFailure {
  return { ok: false, issues: [{ field, message }] };
}

export function invalidMany(issues: readonly ValidationIssue[]): ValidationFailure {
  return { ok: false, issues };
}

export function issuesOf(...results: readonly ValidationResult<unknown>[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const result of results) {
    if (!result.ok) {
      issues.push(...result.issues);
    }
  }
  return issues;
}

// Control characters other than newline, carriage return, and tab are rejected.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export interface TextOptions {
  min?: number;
  max: number;
  multiline?: boolean;
  trim?: boolean;
}

export function requiredText(
  value: unknown,
  field: string,
  options: TextOptions,
): ValidationResult<string> {
  const { min = 1, max, multiline = false, trim = true } = options;
  if (typeof value !== 'string') {
    return invalid(field, 'A text value is required.');
  }
  const text = trim ? value.trim() : value;
  if (text.length < min) {
    return invalid(
      field,
      min === 1 ? 'This field is required.' : `Enter at least ${min} characters.`,
    );
  }
  if (text.length > max) {
    return invalid(field, `Use ${max} characters or fewer.`);
  }
  if (CONTROL_CHARACTERS.test(text)) {
    return invalid(field, 'Control characters are not allowed.');
  }
  if (!multiline && /[\r\n]/.test(text)) {
    return invalid(field, 'Line breaks are not allowed in this field.');
  }
  return valid(text);
}

export function optionalText(
  value: unknown,
  field: string,
  options: Omit<TextOptions, 'min'>,
): ValidationResult<string | undefined> {
  if (value === undefined || value === null) {
    return valid(undefined);
  }
  if (typeof value !== 'string') {
    return invalid(field, 'A text value is required.');
  }
  if (value.trim().length === 0) {
    return valid(undefined);
  }
  return requiredText(value, field, { ...options, min: 1 });
}

export function enumValue<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): ValidationResult<T> {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    return invalid(field, `Choose one of: ${allowed.join(', ')}.`);
  }
  return valid(value as T);
}

export function checkbox(value: unknown): boolean {
  return value === 'on' || value === 'true' || value === '1';
}

export function httpUrl(value: unknown, field: string): ValidationResult<string> {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0) {
    return invalid(field, 'A URL is required.');
  }
  if (text.length > 2048) {
    return invalid(field, 'Use a URL of 2048 characters or fewer.');
  }
  if (CONTROL_CHARACTERS.test(text) || /\s/.test(text)) {
    return invalid(field, 'The URL contains invalid characters.');
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return invalid(field, 'Enter a complete, valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return invalid(field, 'Only HTTP and HTTPS URLs are allowed.');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return invalid(field, 'URLs containing credentials are not allowed.');
  }
  if (parsed.hostname.length === 0) {
    return invalid(field, 'The URL must include a hostname.');
  }
  return valid(parsed.toString());
}

export function optionalHttpUrl(
  value: unknown,
  field: string,
): ValidationResult<string | undefined> {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return valid(undefined);
  }
  return httpUrl(value, field);
}

export function optionalDateOnly(
  value: unknown,
  field: string,
): ValidationResult<string | undefined> {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return valid(undefined);
  }
  return dateOnly(value, field);
}

const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isoDateTime(value: unknown, field: string): ValidationResult<string> {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalid(field, 'A timestamp is required.');
  }
  const text = value.trim();
  if (!ISO_DATE_TIME.test(text)) {
    return invalid(
      field,
      'Use an ISO 8601 timestamp with a timezone, for example 2026-10-28T12:00:00Z.',
    );
  }
  const calendarDate = dateOnly(text.slice(0, 10), field);
  if (!calendarDate.ok) {
    return invalid(field, 'The timestamp contains a date that does not exist.');
  }
  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) {
    return invalid(field, 'The timestamp is not a valid date and time.');
  }
  return valid(new Date(timestamp).toISOString());
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function dateOnly(value: unknown, field: string): ValidationResult<string> {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) {
    return invalid(field, 'Use a date in YYYY-MM-DD format.');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return invalid(field, 'The date does not exist.');
  }
  return valid(value);
}

const LOCALE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function localeTag(value: unknown, field: string): ValidationResult<string> {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0) {
    return invalid(field, 'A language tag is required.');
  }
  if (text.length > 35 || !LOCALE_TAG.test(text)) {
    return invalid(field, 'Use a language tag such as en, en-GB, or zh-Hant.');
  }
  return valid(text);
}

export function integerInRange(
  value: unknown,
  field: string,
  min: number,
  max: number,
): ValidationResult<number> {
  const text =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!/^-?\d+$/.test(text)) {
    return invalid(field, `Enter a whole number between ${min} and ${max}.`);
  }
  const number = Number.parseInt(text, 10);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    return invalid(field, `Enter a whole number between ${min} and ${max}.`);
  }
  return valid(number);
}

export function jsonObject(
  value: string,
  field: string,
): ValidationResult<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return invalid(field, 'The value is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return invalid(field, 'The value must be a JSON object.');
  }
  return valid(parsed as Record<string, unknown>);
}
