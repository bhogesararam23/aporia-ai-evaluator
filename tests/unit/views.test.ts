import assert from 'node:assert/strict';
import { test } from 'node:test';
import { html, raw, safeHref } from '../../src/app/views/html.ts';
import {
  assessmentBadge,
  checkboxField,
  dateTimeField,
  errorSummary,
  formatDateTime,
  formatPercent,
  propositionStatusBadge,
  selectField,
  textareaField,
  textField,
} from '../../src/app/views/components.ts';
import { layout, noticeMessage, projectNav } from '../../src/app/views/layout.ts';

test('html escapes text and preserves trusted nested markup', () => {
  const inner = html`<strong>${'<script>alert(1)</script>'}</strong>`;
  const page = html`<div title="${'"quoted"'}">${inner} ${'& < >'}</div>`;
  assert.equal(
    page.value,
    '<div title="&quot;quoted&quot;"><strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong> &amp; &lt; &gt;</div>',
  );
});

test('html renders arrays, nulls, and raw trusted values deterministically', () => {
  const page = html`<ul>
      ${[html`<li>${'one'}</li>`, null, html`<li>${'two'}</li>`]}
    </ul>
    ${raw('<span>trusted</span>')}`;
  assert.match(page.value, /<ul>[\s\S]*<li>one<\/li><li>two<\/li>[\s\S]*<\/ul>/);
  assert.match(page.value, /<span>trusted<\/span>/);
});

test('safeHref rejects active content and credentials', () => {
  assert.equal(safeHref('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(safeHref('https://user:pass@example.com/'), null);
  assert.equal(safeHref(''), null);
  assert.equal(safeHref(null), null);
});

test('text fields escape values, errors, and help text', () => {
  const field = textField({
    name: 'name',
    label: 'Name <script>',
    value: '"quoted"',
    issues: [{ field: 'name', message: 'Required <now>' }],
    required: true,
    help: 'Help & guidance',
  });
  assert.match(field.value, /Name &lt;script&gt;/);
  assert.match(field.value, /value="&quot;quoted&quot;"/);
  assert.match(field.value, /aria-invalid="true"/);
  assert.match(field.value, /Required &lt;now&gt;/);
  assert.match(field.value, /Help &amp; guidance/);
  assert.match(field.value, /required/);
});

test('textareas and selects escape submitted values', () => {
  const textarea = textareaField({
    name: 'excerpt',
    label: 'Excerpt',
    value: '</textarea><script>alert(1)</script>',
  });
  assert.match(textarea.value, /&lt;\/textarea&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  const select = selectField({
    name: 'status',
    label: 'Status',
    value: 'a"b',
    options: [
      { value: 'a"b', label: 'A < B' },
      { value: 'c', label: 'C' },
    ],
  });
  assert.match(select.value, /value="a&quot;b"[\s\S]*?selected/);
  assert.match(select.value, /A &lt; B/);
});

test('checkbox and datetime fields preserve input and help', () => {
  const checkbox = checkboxField({ name: 'branded', label: 'Branded', checked: true });
  assert.match(checkbox.value, /checked/);
  const datetime = dateTimeField({
    name: 'capturedAt',
    label: 'Captured at',
    value: '2026-10-28T12:00',
    required: true,
  });
  assert.match(datetime.value, /type="datetime-local"/);
  assert.match(datetime.value, /stored as UTC/);
});

test('error summaries and status badges contain text, not colour alone', () => {
  const summary = errorSummary([{ field: 'url', message: 'Unsafe URL.' }]);
  assert.match(summary.value, /Check the form/);
  assert.match(summary.value, /Unsafe URL\./);
  assert.match(propositionStatusBadge('CONFLICTING_EVIDENCE').value, /Conflicting evidence/);
  assert.match(assessmentBadge('PARTIALLY_SUPPORTED').value, /Partially supported/);
});

test('layout escapes the title and omits unknown notices', () => {
  const page = layout({
    title: '<script>alert(1)</script>',
    body: html`<h1>Body</h1>`,
    notice: 'not-a-real-notice',
    navigation: html`<nav>Nav</nav>`,
  });
  assert.match(page.value, /&lt;script&gt;alert\(1\)&lt;\/script&gt; · Aporia AI Evaluator/);
  assert.equal(page.value.includes('role="status"'), false);
  assert.match(page.value, /<main id="main" class="container" tabindex="-1">/);
  assert.match(page.value, /href="#main"/);
});

test('known notices are human-readable', () => {
  assert.equal(noticeMessage('project-created'), 'Project created.');
  assert.equal(noticeMessage('unknown'), null);
  assert.equal(noticeMessage(null), null);
});

test('project navigation marks the current section', () => {
  const nav = projectNav({ projectId: 'prj_1', current: 'claims' });
  assert.match(nav.value, /href="\/projects\/prj_1\/claims" aria-current="page"/);
  assert.equal((nav.value.match(/aria-current="page"/g) ?? []).length, 1);
});

test('date and percentage formatting is explicit about missing values', () => {
  assert.equal(formatDateTime('2026-10-28T12:34:56.000Z'), '2026-10-28 12:34:56 UTC');
  assert.equal(formatDateTime(null), 'Not recorded');
  assert.equal(formatPercent(0.5), '50.0%');
  assert.equal(formatPercent(null), 'Not available');
});
