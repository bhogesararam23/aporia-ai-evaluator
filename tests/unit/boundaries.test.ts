import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkBoundaries } from '../../scripts/check-boundaries.ts';

test('source modules respect the documented dependency direction', () => {
  assert.deepEqual(checkBoundaries(), []);
});
