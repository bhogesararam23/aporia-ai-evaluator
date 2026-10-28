import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Router } from '../../src/app/http/router.ts';
import { htmlResponse } from '../../src/app/http/responses.ts';

test('matches static and dynamic routes and decodes parameters', () => {
  const router = new Router();
  const handler = () => htmlResponse('ok');
  router.add({ method: 'GET', path: '/', handler });
  router.add({ method: 'GET', path: '/projects/:projectId/claims/:claimId', handler });
  const root = router.match('GET', '/');
  assert.equal(root?.type, 'match');
  const claim = router.match('GET', '/projects/prj_1/claims/clm%202');
  assert.equal(claim?.type, 'match');
  if (claim?.type === 'match') {
    assert.equal(claim.params['projectId'], 'prj_1');
    assert.equal(claim.params['claimId'], 'clm 2');
  }
});

test('normalizes trailing slashes and reports method mismatches', () => {
  const router = new Router();
  router.add({ method: 'GET', path: '/projects', handler: () => htmlResponse('ok') });
  router.add({ method: 'POST', path: '/projects', handler: () => htmlResponse('ok') });
  assert.equal(router.match('GET', '/projects/')?.type, 'match');
  const result = router.match('DELETE', '/projects');
  assert.equal(result?.type, 'method-not-allowed');
  if (result?.type === 'method-not-allowed') {
    assert.deepEqual([...result.allow].sort(), ['GET', 'POST']);
  }
});

test('returns null for unknown paths and malformed encoding', () => {
  const router = new Router();
  router.add({ method: 'GET', path: '/projects/:id', handler: () => htmlResponse('ok') });
  assert.equal(router.match('GET', '/unknown'), null);
  assert.equal(router.match('GET', '/projects/%E0%A4%A'), null);
  assert.equal(router.match('GET', '/projects/a/b'), null);
});

test('rejects invalid route patterns at registration', () => {
  const router = new Router();
  assert.throws(
    () =>
      router.add({ method: 'GET', path: '/projects//claims', handler: () => htmlResponse('ok') }),
    /Invalid route path/,
  );
});
