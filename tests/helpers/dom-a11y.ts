/**
 * Structural accessibility checks shared by the page-walking tests.
 *
 * These assertions exist because the v0.2 audit found a form component emitting `aria-describedby`
 * that pointed at an id the page never rendered — invisible to a sighted reviewer, and silently dropping
 * the help text or validation message for a screen-reader user. The check lives here so a new page-state
 * test cannot re-implement it weaker.
 */
import { parse, type DefaultTreeAdapterTypes } from 'parse5';

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;

export function elements(root: Node): Element[] {
  const found: Element[] = [];
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) continue;
    if ('tagName' in node) found.push(node);
    if ('childNodes' in node) {
      for (const child of node.childNodes) stack.push(child);
    }
  }
  return found;
}

export function attrs(element: Element): Map<string, string> {
  return new Map(element.attrs.map((attr) => [attr.name.toLowerCase(), attr.value]));
}

export function accessibilityViolations(html: string): string[] {
  const document = parse(html);
  const all = elements(document);
  const labels = new Map<string, Element>();
  for (const label of all.filter((element) => element.tagName === 'label')) {
    const forId = attrs(label).get('for');
    if (forId !== undefined) labels.set(forId, label);
  }
  const violations: string[] = [];
  const htmlElement = all.find((element) => element.tagName === 'html');
  if (htmlElement === undefined || (attrs(htmlElement).get('lang') ?? '').length === 0) {
    violations.push('html[lang] is missing');
  }
  if (!all.some((element) => element.tagName === 'main')) {
    violations.push('main landmark is missing');
  }
  const h1s = all.filter((element) => element.tagName === 'h1');
  if (h1s.length !== 1) violations.push(`expected exactly one h1, found ${String(h1s.length)}`);
  for (const element of all) {
    const attributes = attrs(element);
    if (attributes.has('style')) violations.push(`inline style on <${element.tagName}>`);
    if ([...attributes.keys()].some((name) => name.startsWith('on'))) {
      violations.push(`event handler attribute on <${element.tagName}>`);
    }
    if (element.tagName === 'script') violations.push('script element present');
  }
  for (const control of all.filter((element) =>
    ['input', 'select', 'textarea'].includes(element.tagName),
  )) {
    const attributes = attrs(control);
    if (attributes.get('type') === 'hidden') continue;
    const id = attributes.get('id');
    const hasLabel =
      (id !== undefined && labels.has(id)) ||
      (control.parentNode !== null &&
        control.parentNode !== undefined &&
        'tagName' in control.parentNode &&
        control.parentNode.tagName === 'label') ||
      (attributes.get('aria-label') ?? '').length > 0 ||
      (attributes.get('aria-labelledby') ?? '').length > 0;
    if (!hasLabel) violations.push(`unlabelled <${control.tagName}> ${id ?? '(no id)'}`);
  }
  for (const table of all.filter((element) => element.tagName === 'table')) {
    if (!elements(table).some((element) => element.tagName === 'caption')) {
      violations.push('table without caption');
    }
  }
  // A description reference that points at nothing is invisible to a screen reader, so a help text or
  // a validation message attached this way is silently lost. Every referenced id must exist.
  const existing = new Set<string>(
    all.map((element) => attrs(element).get('id')).filter((id): id is string => id !== undefined),
  );
  for (const element of all) {
    const referenced = (attrs(element).get('aria-describedby') ?? '')
      .split(/\s+/)
      .filter((token) => token.length > 0);
    for (const id of referenced) {
      if (!existing.has(id)) {
        violations.push(`aria-describedby on <${element.tagName}> points at missing #${id}`);
      }
    }
  }
  for (const button of all.filter((element) => element.tagName === 'button')) {
    const stack: Node[] = [button];
    let text = '';
    while (stack.length > 0) {
      const node = stack.pop();
      if (node === undefined) continue;
      if (node.nodeName === '#text' && 'value' in node) {
        text += node.value;
      }
      if ('childNodes' in node) {
        for (const child of node.childNodes) stack.push(child);
      }
    }
    if (text.trim().length === 0 && (attrs(button).get('aria-label') ?? '').length === 0) {
      violations.push('button without accessible name');
    }
  }
  // A link is navigable by keyboard and read out by name; an anchor with no text and no label is a
  // silent dead drop for a screen-reader or keyboard user, the same class of defect as an unnamed
  // button. Apply the same rule to every <a href>.
  for (const link of all.filter((element) => element.tagName === 'a')) {
    const attributes = attrs(link);
    if (!attributes.has('href')) continue;
    const name =
      textOf(link).trim() ||
      (attributes.get('aria-label') ?? '').trim() ||
      (attributes.get('aria-labelledby') ?? '').trim() ||
      (attributes.get('title') ?? '').trim();
    if (name.length === 0) violations.push('link without accessible name');
  }
  // A positive tabindex rewires the natural focus order and is a keyboard-navigation anti-pattern WCAG
  // discourages. Programmatic focus targets use tabindex="-1", which stays allowed.
  for (const element of all) {
    const value = attrs(element).get('tabindex');
    if (value !== undefined && Number.parseInt(value, 10) > 0) {
      violations.push(`positive tabindex on <${element.tagName}> (disrupts keyboard order)`);
    }
  }
  // Duplicate ids break every reference mechanism at once: a <label for>, an aria-describedby or an
  // anchor fragment resolves to one arbitrary element, so a second control sharing the id silently
  // loses its label or help text. ids must be unique within a page.
  const idCounts = new Map<string, number>();
  for (const element of all) {
    const id = attrs(element).get('id');
    if (id !== undefined) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      violations.push(`duplicate id #${id} used ${String(count)} times`);
    }
  }
  // A labelled control's <label for> target must be an existing element; a dangling reference is the
  // silent-loss defect these guards exist to catch, and is only detectable once ids are unique.
  const existingIds = new Set(idCounts.keys());
  for (const label of all.filter((element) => element.tagName === 'label')) {
    const forId = attrs(label).get('for');
    if (forId !== undefined && !existingIds.has(forId)) {
      violations.push(`label[for] points at missing #${forId}`);
    }
  }
  return violations;
}

/** The concatenated text content of a subtree, used to decide whether a control has an accessible name. */
function textOf(element: Element): string {
  const stack: Node[] = [element];
  let text = '';
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) continue;
    if (node.nodeName === '#text' && 'value' in node) text += node.value;
    if ('childNodes' in node) {
      for (const child of node.childNodes) stack.push(child);
    }
  }
  return text;
}

/**
 * A rejected submission has to announce itself, not just colour a border.
 *
 * The control must point at its error text and mark itself invalid, and the summary must be a live
 * alert region; without all three, a keyboard or screen-reader user is redirected to a page that looks
 * the same as the one they left.
 */
export function errorAnnouncementProblems(html: string): string[] {
  const all = elements(parse(html));
  const problems: string[] = [];
  const errorParagraphs = all.filter((element) =>
    (attrs(element).get('class') ?? '').split(/\s+/).includes('field-error'),
  );
  if (errorParagraphs.length === 0) {
    problems.push('a rejected submission rendered no field error at all');
  }
  for (const error of errorParagraphs) {
    const errorId = attrs(error).get('id');
    if (errorId === undefined) {
      problems.push('a field error has no id, so no control can reference it');
      continue;
    }
    const referencedBy = all.filter((element) =>
      (attrs(element).get('aria-describedby') ?? '').split(/\s+/).includes(errorId),
    );
    if (referencedBy.length === 0) {
      problems.push(`#${errorId} is not referenced by any aria-describedby`);
    }
    if (!referencedBy.some((element) => attrs(element).get('aria-invalid') === 'true')) {
      problems.push(`the control described by #${errorId} is not marked aria-invalid`);
    }
  }
  const summary = all.find((element) =>
    (attrs(element).get('class') ?? '').split(/\s+/).includes('error-summary'),
  );
  if (summary === undefined) {
    problems.push('a rejected submission carried no error summary');
  } else {
    if (attrs(summary).get('role') !== 'alert') {
      problems.push('the error summary is not role="alert", so it is not announced');
    }
    if (attrs(summary).get('tabindex') !== '-1') {
      problems.push(
        'the error summary cannot receive focus, so a keyboard user is not moved to it',
      );
    }
  }
  return problems;
}
