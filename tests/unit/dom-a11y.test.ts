import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessibilityViolations, errorAnnouncementProblems } from '../helpers/dom-a11y.ts';

/**
 * Regression coverage for the v0.5 per-form id-scope fix (ADR-independent accessibility defect).
 *
 * The defect: repeated forms on one page (a form per citation, per statement, per proposition) each
 * emitted the same `field-<name>` id, so every `<label for>` and `aria-describedby` but the first
 * resolved to the wrong control. The fix scopes ids per form. These tests pin the checker's behaviour
 * directly on the two shapes it must accept and reject, so a future regression is caught even if the
 * page-walking integration suites change.
 */

const shell = (body: string): string =>
  `<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>t</h1>${body}</main></body></html>`;

test('two forms with distinct scoped ids produce no duplicate-id violation', () => {
  const body = `
    <form>
      <div class="field"><label for="field-aaa-rationale">Rationale</label>
        <textarea id="field-aaa-rationale" name="rationale" aria-describedby="field-aaa-rationale-help"></textarea>
        <p class="field-help" id="field-aaa-rationale-help">Why</p></div>
    </form>
    <form>
      <div class="field"><label for="field-bbb-rationale">Rationale</label>
        <textarea id="field-bbb-rationale" name="rationale" aria-describedby="field-bbb-rationale-help"></textarea>
        <p class="field-help" id="field-bbb-rationale-help">Why</p></div>
    </form>`;
  assert.deepEqual(accessibilityViolations(shell(body)), []);
});

test('two forms sharing one control id are flagged as a duplicate id', () => {
  const body = `
    <form>
      <div class="field"><label for="field-rationale">Rationale</label>
        <textarea id="field-rationale" name="rationale"></textarea></div>
    </form>
    <form>
      <div class="field"><label for="field-rationale">Rationale</label>
        <textarea id="field-rationale" name="rationale"></textarea></div>
    </form>`;
  const violations = accessibilityViolations(shell(body));
  assert.ok(
    violations.some((v) => /duplicate id #field-rationale used 2 times/.test(v)),
    `expected a duplicate-id violation, got ${violations.join(' | ')}`,
  );
});

test('a label whose for target does not exist is flagged', () => {
  const body = `
    <div class="field"><label for="field-missing">Rationale</label>
      <textarea id="field-elsewhere" name="rationale"></textarea></div>`;
  const violations = accessibilityViolations(shell(body));
  assert.ok(
    violations.some((v) => /label\[for\] points at missing #field-missing/.test(v)),
    `expected a dangling-label violation, got ${violations.join(' | ')}`,
  );
});

test('a rejected submission keeps scoped ids unique and announces the error', () => {
  const body = `
    <div class="error-summary" role="alert" tabindex="-1"><p>The form has errors.</p></div>
    <form>
      <div class="field field-invalid"><label for="field-obs1-reason">Void reason</label>
        <textarea id="field-obs1-reason" name="reason" aria-describedby="field-obs1-reason-error" aria-invalid="true"></textarea>
        <p class="field-error" id="field-obs1-reason-error">A reason is required</p></div>
    </form>
    <form>
      <div class="field field-invalid"><label for="field-obs2-reason">Void reason</label>
        <textarea id="field-obs2-reason" name="reason" aria-describedby="field-obs2-reason-error" aria-invalid="true"></textarea>
        <p class="field-error" id="field-obs2-reason-error">A reason is required</p></div>
    </form>`;
  const page = shell(body);
  assert.deepEqual(accessibilityViolations(page), []);
  assert.deepEqual(errorAnnouncementProblems(page), []);
});
