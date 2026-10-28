import type { RouteDefinition, RouteHandler } from './types.ts';

interface CompiledRoute {
  readonly method: 'GET' | 'POST';
  readonly segments: readonly string[];
  readonly handler: RouteHandler;
}

export interface RouteMatch {
  readonly type: 'match';
  readonly handler: RouteHandler;
  readonly params: Readonly<Record<string, string>>;
}

export interface MethodNotAllowed {
  readonly type: 'method-not-allowed';
  readonly allow: readonly string[];
}

export type MatchResult = RouteMatch | MethodNotAllowed | null;

function normalizePath(pathname: string): string {
  if (pathname === '/') {
    return '/';
  }
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function splitPath(path: string): string[] | null {
  const normalized = normalizePath(path);
  if (normalized === '/') {
    return [];
  }
  const segments: string[] = [];
  for (const raw of normalized.slice(1).split('/')) {
    if (raw.length === 0) {
      return null;
    }
    try {
      segments.push(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
  return segments;
}

export class Router {
  readonly #routes: CompiledRoute[] = [];

  add(route: RouteDefinition): void {
    const segments = splitPath(route.path);
    if (segments === null) {
      throw new Error(`Invalid route path: ${route.path}`);
    }
    this.#routes.push({ method: route.method, segments, handler: route.handler });
  }

  match(method: string, pathname: string): MatchResult {
    const pathSegments = splitPath(pathname);
    if (pathSegments === null) {
      return null;
    }
    let allowed: string[] = [];
    let pathMatched = false;
    for (const route of this.#routes) {
      if (route.segments.length !== pathSegments.length) {
        continue;
      }
      const params: Record<string, string> = {};
      let matches = true;
      for (let index = 0; index < route.segments.length; index += 1) {
        const pattern = route.segments[index];
        const value = pathSegments[index];
        if (pattern === undefined || value === undefined) {
          matches = false;
          break;
        }
        if (pattern.startsWith(':')) {
          if (value.length === 0) {
            matches = false;
            break;
          }
          params[pattern.slice(1)] = value;
        } else if (pattern !== value) {
          matches = false;
          break;
        }
      }
      if (!matches) {
        continue;
      }
      pathMatched = true;
      if (route.method === method) {
        return { type: 'match', handler: route.handler, params };
      }
      allowed.push(route.method);
    }
    if (!pathMatched) {
      return null;
    }
    allowed = [...new Set(allowed)];
    return { type: 'method-not-allowed', allow: allowed };
  }
}
