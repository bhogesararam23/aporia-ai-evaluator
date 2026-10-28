import type { Html } from '../views/html.ts';

export interface AppResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | Uint8Array;
}

export function htmlResponse(body: Html | string, status = 200): AppResponse {
  return {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: typeof body === 'string' ? body : body.value,
  };
}

export function redirect(location: string, status = 303): AppResponse {
  return {
    status,
    headers: { Location: location, 'Content-Type': 'text/plain; charset=utf-8' },
    body: '',
  };
}

export function redirectWithNotice(location: string, notice: string): AppResponse {
  const separator = location.includes('?') ? '&' : '?';
  return redirect(`${location}${separator}notice=${encodeURIComponent(notice)}`);
}

export function jsonResponse(value: unknown, status = 200, filename?: string): AppResponse {
  return {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(filename === undefined
        ? {}
        : { 'Content-Disposition': `attachment; filename="${filename}"` }),
    },
    body: `${JSON.stringify(value, null, 2)}\n`,
  };
}

export function csvResponse(body: string, filename: string): AppResponse {
  return {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
    body,
  };
}

export function textResponse(body: string, status = 200): AppResponse {
  return {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body,
  };
}

export function emptyResponse(status = 204): AppResponse {
  return { status, headers: {}, body: '' };
}
