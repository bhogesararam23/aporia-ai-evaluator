export interface Html {
  readonly value: string;
}

const HTML_MARKER = Symbol('aporia-html');

function isHtml(value: unknown): value is Html {
  return typeof value === 'object' && value !== null && HTML_MARKER in value;
}

function makeHtml(value: string): Html {
  return { value, [HTML_MARKER]: true } as Html;
}

export function raw(value: string): Html {
  return makeHtml(value);
}

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === false) {
    return '';
  }
  if (isHtml(value)) {
    return value.value;
  }
  if (Array.isArray(value)) {
    return value.map(renderValue).join('');
  }
  return escapeHtml(value);
}

export function html(strings: TemplateStringsArray, ...values: readonly unknown[]): Html {
  let output = '';
  for (let index = 0; index < strings.length; index += 1) {
    output += strings[index] ?? '';
    if (index < values.length) {
      output += renderValue(values[index]);
    }
  }
  return makeHtml(output);
}

export function safeHref(url: string | null | undefined): string | null {
  if (url === null || url === undefined || url.trim().length === 0) {
    return null;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (parsed.username !== '' || parsed.password !== '') {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function externalLink(label: unknown, url: string | null | undefined): Html {
  const href = safeHref(url);
  if (href === null) {
    return html`<span class="unlinked">${label}</span>`;
  }
  return html`<a href="${href}" rel="noopener noreferrer nofollow" target="_blank">${label}</a>`;
}
