import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError, isAppError, toPublicError } from '../../src/errors.ts';

test('maps app error codes to stable statuses', () => {
  const cases: Array<[ConstructorParameters<typeof AppError>[0], number]> = [
    ['INVALID_INPUT', 400],
    ['NOT_FOUND', 404],
    ['CONFLICT', 409],
    ['FORBIDDEN', 403],
    ['METHOD_NOT_ALLOWED', 405],
    ['PAYLOAD_TOO_LARGE', 413],
    ['UNSUPPORTED_MEDIA_TYPE', 415],
    ['UNSAFE_URL', 400],
    ['INTERNAL_ERROR', 500],
  ];
  for (const [code, status] of cases) {
    const error = new AppError(code);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    assert.ok(error.publicMessage.length > 0);
  }
});

test('custom public messages are preserved', () => {
  const error = new AppError('INVALID_INPUT', 'Project name is required.');
  assert.equal(error.message, 'Project name is required.');
  assert.equal(error.publicMessage, 'Project name is required.');
});

test('unknown errors do not leak internal messages', () => {
  const publicError = toPublicError(new Error('database password is hunter2'));
  assert.deepEqual(publicError, {
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.',
    status: 500,
  });
});

test('identified app errors are detected and returned safely', () => {
  const error = new AppError('NOT_FOUND', 'No such project.');
  assert.equal(isAppError(error), true);
  assert.deepEqual(toPublicError(error), {
    code: 'NOT_FOUND',
    message: 'No such project.',
    status: 404,
  });
  assert.equal(isAppError(new Error('x')), false);
});
