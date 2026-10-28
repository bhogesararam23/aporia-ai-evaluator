import {
  PROPOSITION_STATUS_LABELS,
  assessmentLabelDisplay,
  type PropositionStatus,
} from '../../core/vocabulary.ts';
import type { ValidationIssue } from '../../core/validation.ts';
import { externalLink, html, type Html } from './html.ts';

export type Values = ReadonlyMap<string, string>;

export function valueOf(values: Values, name: string, fallback = ''): string {
  return values.get(name) ?? fallback;
}

function issueFor(issues: readonly ValidationIssue[], field: string): string | null {
  return issues.find((issue) => issue.field === field)?.message ?? null;
}

function describedBy(id: string, help: string | null, error: string | null): Html {
  const ids = [help === null ? null : `${id}-help`, error === null ? null : `${id}-error`].filter(
    (value): value is string => value !== null,
  );
  return ids.length === 0 ? html`` : html` aria-describedby="${ids.join(' ')}"`;
}

export interface TextFieldOptions {
  name: string;
  label: string;
  value?: string;
  issues?: readonly ValidationIssue[];
  type?: 'text' | 'url' | 'email' | 'password';
  required?: boolean;
  help?: string;
  placeholder?: string;
  autocomplete?: string;
  maxLength?: number;
}

export function textField(options: TextFieldOptions): Html {
  const error = issueFor(options.issues ?? [], options.name);
  const id = `field-${options.name}`;
  return html`
    <div class="field${error === null ? '' : ' field-invalid'}">
      <label for="${id}"
        >${options.label}${options.required ? html` <span class="required">required</span>` : ''}</label
      >
      <input
        id="${id}"
        name="${options.name}"
        type="${options.type ?? 'text'}"
        value="${options.value ?? ''}"
        ${options.required ? html`required` : ''}
        ${options.placeholder === undefined ? '' : html`placeholder="${options.placeholder}"`}
        ${options.autocomplete === undefined ? '' : html`autocomplete="${options.autocomplete}"`}
        ${options.maxLength === undefined ? '' : html`maxlength="${options.maxLength}"`}
        ${describedBy(options.name, options.help ?? null, error)}
        ${error === null ? '' : html`aria-invalid="true"`}
      />
      ${options.help === undefined ? '' : html`<p class="field-help" id="${id}-help">${options.help}</p>`}
      ${error === null ? '' : html`<p class="field-error" id="${id}-error">${error}</p>`}
    </div>
  `;
}

export interface TextareaFieldOptions {
  name: string;
  label: string;
  value?: string;
  issues?: readonly ValidationIssue[];
  required?: boolean;
  help?: string;
  rows?: number;
  maxLength?: number;
}

export function textareaField(options: TextareaFieldOptions): Html {
  const error = issueFor(options.issues ?? [], options.name);
  const id = `field-${options.name}`;
  return html`
    <div class="field${error === null ? '' : ' field-invalid'}">
      <label for="${id}"
        >${options.label}${options.required ? html` <span class="required">required</span>` : ''}</label
      >
      <textarea
        id="${id}"
        name="${options.name}"
        rows="${options.rows ?? 4}"
        ${options.required ? html`required` : ''}
        ${options.maxLength === undefined ? '' : html`maxlength="${options.maxLength}"`}
        ${describedBy(options.name, options.help ?? null, error)}
        ${error === null ? '' : html`aria-invalid="true"`}
      >
${options.value ?? ''}</textarea>
      ${options.help === undefined ? '' : html`<p class="field-help" id="${id}-help">${options.help}</p>`}
      ${error === null ? '' : html`<p class="field-error" id="${id}-error">${error}</p>`}
    </div>
  `;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldOptions {
  name: string;
  label: string;
  value?: string;
  options: readonly SelectOption[];
  issues?: readonly ValidationIssue[];
  required?: boolean;
  help?: string;
  includeBlank?: string;
}

export function selectField(options: SelectFieldOptions): Html {
  const error = issueFor(options.issues ?? [], options.name);
  const id = `field-${options.name}`;
  return html`
    <div class="field${error === null ? '' : ' field-invalid'}">
      <label for="${id}"
        >${options.label}${options.required ? html` <span class="required">required</span>` : ''}</label
      >
      <select
        id="${id}"
        name="${options.name}"
        ${options.required ? html`required` : ''}
        ${describedBy(options.name, options.help ?? null, error)}
        ${error === null ? '' : html`aria-invalid="true"`}
      >
        ${
          options.includeBlank === undefined
            ? ''
            : html`<option value="">${options.includeBlank}</option>`
        }
        ${options.options.map(
          (option) =>
            html`<option
              value="${option.value}"
              ${option.value === (options.value ?? '') ? html`selected` : ''}
            >
              ${option.label}
            </option>`,
        )}
      </select>
      ${options.help === undefined ? '' : html`<p class="field-help" id="${id}-help">${options.help}</p>`}
      ${error === null ? '' : html`<p class="field-error" id="${id}-error">${error}</p>`}
    </div>
  `;
}

export interface CheckboxFieldOptions {
  name: string;
  label: string;
  checked?: boolean;
  issues?: readonly ValidationIssue[];
  help?: string;
}

export function checkboxField(options: CheckboxFieldOptions): Html {
  const error = issueFor(options.issues ?? [], options.name);
  const id = `field-${options.name}`;
  return html`
    <div class="field field-checkbox${error === null ? '' : ' field-invalid'}">
      <label class="checkbox-label" for="${id}">
        <input
          id="${id}"
          name="${options.name}"
          type="checkbox"
          value="on"
          ${options.checked ? html`checked` : ''}
        />
        <span>${options.label}</span>
      </label>
      ${options.help === undefined ? '' : html`<p class="field-help" id="${id}-help">${options.help}</p>`}
      ${error === null ? '' : html`<p class="field-error" id="${id}-error">${error}</p>`}
    </div>
  `;
}

export function dateTimeField(options: {
  name: string;
  label: string;
  value?: string;
  issues?: readonly ValidationIssue[];
  required?: boolean;
  help?: string;
}): Html {
  const error = issueFor(options.issues ?? [], options.name);
  const id = `field-${options.name}`;
  const helpText = options.help ?? 'Entered in this computer’s local time; stored as UTC.';
  return html`
    <div class="field${error === null ? '' : ' field-invalid'}">
      <label for="${id}"
        >${options.label}${options.required ? html` <span class="required">required</span>` : ''}</label
      >
      <input
        id="${id}"
        name="${options.name}"
        type="datetime-local"
        value="${options.value ?? ''}"
        ${options.required ? html`required` : ''}
        ${describedBy(options.name, helpText, error)}
        ${error === null ? '' : html`aria-invalid="true"`}
      />
      <p class="field-help" id="${id}-help">${helpText}</p>
      ${error === null ? '' : html`<p class="field-error" id="${id}-error">${error}</p>`}
    </div>
  `;
}

export function dateField(options: {
  name: string;
  label: string;
  value?: string;
  issues?: readonly ValidationIssue[];
  help?: string;
}): Html {
  const error = issueFor(options.issues ?? [], options.name);
  const id = `field-${options.name}`;
  return html`
    <div class="field${error === null ? '' : ' field-invalid'}">
      <label for="${id}">${options.label}</label>
      <input
        id="${id}"
        name="${options.name}"
        type="date"
        value="${options.value ?? ''}"
        ${describedBy(options.name, options.help ?? null, error)}
        ${error === null ? '' : html`aria-invalid="true"`}
      />
      ${options.help === undefined ? '' : html`<p class="field-help" id="${id}-help">${options.help}</p>`}
      ${error === null ? '' : html`<p class="field-error" id="${id}-error">${error}</p>`}
    </div>
  `;
}

export function csrfField(token: string): Html {
  return html`<input type="hidden" name="_csrf" value="${token}" />`;
}

export function submitButton(
  label: string,
  tone: 'primary' | 'secondary' | 'danger' = 'primary',
): Html {
  return html`<button class="button button-${tone}" type="submit">${label}</button>`;
}

export function errorSummary(issues: readonly ValidationIssue[]): Html {
  if (issues.length === 0) {
    return html``;
  }
  return html`
    <div class="error-summary" role="alert" tabindex="-1">
      <h2>Check the form</h2>
      <ul>
        ${issues.map((issue) => html`<li><strong>${issue.field}:</strong> ${issue.message}</li>`)}
      </ul>
    </div>
  `;
}

export function pageHeader(title: string, description?: string, actions?: Html): Html {
  return html`
    <header class="page-header">
      <div>
        <h1>${title}</h1>
        ${description === undefined ? '' : html`<p class="lede">${description}</p>`}
      </div>
      ${actions === undefined ? '' : html`<div class="page-actions">${actions}</div>`}
    </header>
  `;
}

export function emptyState(title: string, body: string, action?: Html): Html {
  return html`
    <div class="empty-state">
      <h2>${title}</h2>
      <p>${body}</p>
      ${action === undefined ? '' : action}
    </div>
  `;
}

export function statusBadge(label: string, tone = 'neutral'): Html {
  return html`<span class="badge badge-${tone}">${label}</span>`;
}

export function propositionStatusBadge(status: PropositionStatus): Html {
  const tone =
    status === 'SUPPORTED_WITHIN_SCOPE'
      ? 'good'
      : status === 'CONTRADICTED' || status === 'CONFLICTING_EVIDENCE'
        ? 'bad'
        : status === 'PARTIALLY_SUPPORTED' || status === 'INSUFFICIENT_EVIDENCE'
          ? 'warn'
          : 'neutral';
  return statusBadge(PROPOSITION_STATUS_LABELS[status], tone);
}

export function assessmentBadge(label: string): Html {
  const tone =
    label === 'ACCURATE' || label === 'CORRECT' || label === 'SUPPORTED' || label === 'MENTIONED'
      ? 'good'
      : label === 'CONTRADICTED' || label === 'INCORRECT' || label === 'NOT_SUPPORTED'
        ? 'bad'
        : label === 'NOT_ASSESSABLE' || label === 'NOT_ASSESSED' || label === 'NOT_ADDRESSED'
          ? 'neutral'
          : 'warn';
  return statusBadge(assessmentLabelDisplay(label), tone);
}

export function externalUrl(url: string | null | undefined, fallback = 'No URL recorded'): Html {
  return url === null || url === undefined || url.length === 0
    ? html`<span class="muted">${fallback}</span>`
    : externalLink(url, url);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso.length === 0) {
    return 'Not recorded';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return `${date.toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

export function formatDate(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso.length === 0) {
    return 'Not recorded';
  }
  return iso.slice(0, 10);
}

export function formatPercent(value: number | null): string {
  return value === null ? 'Not available' : `${(value * 100).toFixed(1)}%`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function humanize(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('_', ' ')
    .replace(/^./, (character) => character.toUpperCase());
}

export function definitionRow(term: string, value: Html): Html {
  return html`<div class="definition-row">
    <dt>${term}</dt>
    <dd>${value}</dd>
  </div>`;
}
