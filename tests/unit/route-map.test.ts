import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { routes } from '../../src/app/routes/index.ts';

/**
 * The published route map must be the routes the server actually registers.
 *
 * A stale table is worse than none: an operator reading "POST /projects/:id/findings/:findingId"
 * would build a bookmark, a script, or a support answer around a path that returns 404, and nothing in
 * the test suite would notice. This compares the two lists in both directions, so a route added without
 * a row and a row describing a removed route both fail.
 */
function documentedRoutes(): string[] {
  const markdown = readFileSync(
    join(import.meta.dirname, '../../docs/technical/HTTP_ROUTE_MAP.md'),
    'utf8',
  );
  const found: string[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^\|\s*(GET|POST)\s*\|\s*`([^`]+)`\s*\|/.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) {
      found.push(`${match[1]} ${match[2]}`);
    }
  }
  return found;
}

test('every registered route is documented in the route map', () => {
  const registered = routes.map((route) => `${route.method} ${route.path}`).sort();
  const documented = [...new Set(documentedRoutes())].sort();
  const missing = registered.filter((entry) => !documented.includes(entry));
  assert.deepEqual(
    missing,
    [],
    `${missing.length} route(s) exist in code but are not in HTTP_ROUTE_MAP.md`,
  );
});

test('the route map describes no path the server does not register', () => {
  const registered = new Set(routes.map((route) => `${route.method} ${route.path}`));
  const documented = documentedRoutes();
  const stale = [...new Set(documented)].filter((entry) => !registered.has(entry));
  assert.deepEqual(
    stale,
    [],
    `${stale.length} row(s) in HTTP_ROUTE_MAP.md do not match any registered route`,
  );
  // A row duplicated in the table would let one route hide a typo in another.
  assert.equal(documented.length, new Set(documented).size, 'duplicate rows in the route map');
});

test('path parameters are named consistently along a resource', () => {
  // `/claims/:claimId` and `/claims/:claim_id` would both match, so a naming drift is invisible at
  // runtime and only shows up when someone reads the map next to the code.
  const names = new Set<string>();
  for (const route of routes) {
    for (const segment of route.path.split('/')) {
      if (segment.startsWith(':')) {
        names.add(segment.slice(1));
      }
    }
  }
  const snake = [...names].filter((name) => name.includes('_'));
  assert.deepEqual(snake, [], 'parameter names must be camelCase everywhere');
});
