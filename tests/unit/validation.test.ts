import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkbox,
  dateOnly,
  enumValue,
  httpUrl,
  integerInRange,
  invalid,
  invalidMany,
  isoDateTime,
  issuesOf,
  jsonObject,
  localeTag,
  optionalHttpUrl,
  optionalText,
  requiredText,
  valid,
} from '../../src/core/validation.ts';
import { EVIDENCE_RELATIONS } from '../../src/core/vocabulary.ts';

test('required text trims, enforces length, and rejects control characters', () => {
  assert.deepEqual(requiredText('  Project A  ', 'name', { max: 20 }), valid('Project A'));
  assert.equal(requiredText('   ', 'name', { max: 20 }).ok, false);
  assert.equal(requiredText('x'.repeat(21), 'name', { max: 20 }).ok, false);
  assert.equal(requiredText('bad\u0000value', 'name', { max: 20 }).ok, false);
  assert.equal(requiredText('two\nlines', 'name', { max: 20 }).ok, false);
  assert.deepEqual(
    requiredText('two\nlines', 'notes', { max: 20, multiline: true }),
    valid('two\nlines'),
  );
  assert.deepEqual(requiredText('  raw  ', 'raw', { max: 20, trim: false }), valid('  raw  '));
});

test('optional text returns undefined for blank input', () => {
  assert.deepEqual(optionalText('', 'note', { max: 10 }), valid(undefined));
  assert.deepEqual(optionalText('   ', 'note', { max: 10 }), valid(undefined));
  assert.deepEqual(optionalText(undefined, 'note', { max: 10 }), valid(undefined));
  assert.deepEqual(optionalText('value', 'note', { max: 10 }), valid('value'));
});

test('enum validation is exact and reports allowed values', () => {
  assert.deepEqual(enumValue('SUPPORTS', 'relation', EVIDENCE_RELATIONS), valid('SUPPORTS'));
  const result = enumValue('supports', 'relation', EVIDENCE_RELATIONS);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.issues[0]?.message ?? '', /Choose one of/);
  }
});

test('checkbox only treats explicit true values as checked', () => {
  assert.equal(checkbox('on'), true);
  assert.equal(checkbox('true'), true);
  assert.equal(checkbox('1'), true);
  assert.equal(checkbox(undefined), false);
  assert.equal(checkbox('off'), false);
});

test('HTTP URL validation accepts safe absolute URLs', () => {
  assert.deepEqual(httpUrl('https://example.com/path', 'url'), valid('https://example.com/path'));
  assert.deepEqual(httpUrl('http://example.com', 'url'), valid('http://example.com/'));
  assert.deepEqual(optionalHttpUrl('https://example.com', 'url'), valid('https://example.com/'));
  assert.deepEqual(optionalHttpUrl('', 'url'), valid(undefined));
});

test('HTTP URL validation rejects unsafe schemes, credentials, and malformed input', () => {
  for (const value of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'ftp://example.com/file',
    'https://user:password@example.com/',
    'not a url',
    'https://',
    '',
  ]) {
    assert.equal(httpUrl(value, 'url').ok, false, value);
  }
  assert.equal(httpUrl('https://example.com/\u0000', 'url').ok, false);
  assert.equal(httpUrl(`https://example.com/${'a'.repeat(2048)}`, 'url').ok, false);
});

test('ISO timestamps require a timezone and normalize to UTC', () => {
  assert.deepEqual(
    isoDateTime('2026-10-28T12:00:00Z', 'capturedAt'),
    valid('2026-10-28T12:00:00.000Z'),
  );
  assert.deepEqual(
    isoDateTime('2026-10-28T14:00:00+02:00', 'capturedAt'),
    valid('2026-10-28T12:00:00.000Z'),
  );
  assert.equal(isoDateTime('2026-10-28T12:00', 'capturedAt').ok, false);
  assert.equal(isoDateTime('2026-10-28', 'capturedAt').ok, false);
  assert.equal(isoDateTime('2026-02-30T12:00:00Z', 'capturedAt').ok, false);
});

test('date-only validation rejects impossible dates', () => {
  assert.deepEqual(dateOnly('2026-10-28', 'date'), valid('2026-10-28'));
  assert.equal(dateOnly('2026-02-30', 'date').ok, false);
  assert.equal(dateOnly('28-10-2026', 'date').ok, false);
});

test('locale tags accept common BCP 47 forms', () => {
  assert.deepEqual(localeTag('en', 'locale'), valid('en'));
  assert.deepEqual(localeTag('en-GB', 'locale'), valid('en-GB'));
  assert.deepEqual(localeTag('zh-Hant', 'locale'), valid('zh-Hant'));
  assert.equal(localeTag('english_US', 'locale').ok, false);
  assert.equal(localeTag('', 'locale').ok, false);
});

test('integer range validation rejects fractions and out-of-range values', () => {
  assert.deepEqual(integerInRange('3', 'count', 1, 5), valid(3));
  assert.equal(integerInRange('0', 'count', 1, 5).ok, false);
  assert.equal(integerInRange('2.5', 'count', 1, 5).ok, false);
  assert.equal(integerInRange('x', 'count', 1, 5).ok, false);
});

test('JSON object validation rejects arrays and invalid JSON', () => {
  assert.deepEqual(jsonObject('{"a":1}', 'json'), valid({ a: 1 }));
  assert.equal(jsonObject('[]', 'json').ok, false);
  assert.equal(jsonObject('{', 'json').ok, false);
  assert.equal(jsonObject('null', 'json').ok, false);
});

test('issue aggregation keeps field-specific failures', () => {
  const combined = issuesOf(
    valid('x'),
    invalid('name', 'Required.'),
    invalidMany([{ field: 'url', message: 'Bad.' }]),
  );
  assert.deepEqual(combined, [
    { field: 'name', message: 'Required.' },
    { field: 'url', message: 'Bad.' },
  ]);
});
