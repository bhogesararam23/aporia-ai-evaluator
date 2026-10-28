import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newId } from '../../src/persistence/ids.ts';
import {
  booleanValue,
  jsonValue,
  nullableStringValue,
  numberValue,
  sqlBoolean,
  stringValue,
} from '../../src/persistence/rows.ts';

test('generates prefixed unique identifiers', () => {
  const first = newId('prj');
  const second = newId('prj');
  assert.match(first, /^prj_[0-9a-f-]{36}$/);
  assert.notEqual(first, second);
  assert.throws(() => newId('project'), /Invalid identifier prefix/);
  assert.throws(() => newId('P'), /Invalid identifier prefix/);
});

test('row helpers read typed values and fail loudly on schema drift', () => {
  const row = {
    name: 'Aporia',
    optional: null,
    count: 3,
    flag: 1,
    payload: '{"a":1}',
  };
  assert.equal(stringValue(row, 'name'), 'Aporia');
  assert.equal(nullableStringValue(row, 'optional'), null);
  assert.equal(numberValue(row, 'count'), 3);
  assert.equal(booleanValue(row, 'flag'), true);
  assert.deepEqual(jsonValue(row, 'payload'), { a: 1 });
  assert.equal(sqlBoolean(true), 1);
  assert.equal(sqlBoolean(false), 0);

  assert.throws(() => stringValue(row, 'count'), /Expected string/);
  assert.throws(() => numberValue(row, 'name'), /Expected numeric/);
  assert.throws(() => nullableStringValue(row, 'count'), /Expected nullable string/);
});
