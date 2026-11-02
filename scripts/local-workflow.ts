/**
 * `npm run verify:workflow` — drive the real local application through the v0.4 workflow (§6).
 *
 * Why this is a committed script and not a session note: v0.3 recorded 13 of 19 manual steps and left
 * six unresolved because the driver had guessed field names. A guessed field submits nothing, and a
 * silently skipped step reads as a pass. So every submission here is built from the form the running
 * application actually served — its action, its method, its field names, its choices and its default
 * values — and a value the served page does not offer is reported as a failure of that step, never
 * quietly dropped.
 *
 * It starts a server on a loopback port against a fresh temporary data directory, enters records by
 * hand through the real forms, and uses no provider, no network access, and no fixture data inside
 * the application. The synthetic sentences are the text an operator would type, because that is what
 * they are. Step 17 is the only place a temporary corpus file is written, and it stays outside the
 * application.
 *
 * Step names carry the §6 numbers so the session report maps one-to-one onto the brief.
 * Exit code is zero only when every step passed and none was left unrun.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const STARTUP_TIMEOUT_MS = 60_000;
const OPERATOR = 'workflow-operator';

interface Step {
  readonly name: string;
  status: 'passed' | 'failed' | 'not-run';
  detail: string;
}

const steps: Step[] = [];

function step(name: string): Step {
  const entry: Step = { name, status: 'not-run', detail: '' };
  steps.push(entry);
  return entry;
}

function pass(entry: Step, detail: string): void {
  entry.status = 'passed';
  entry.detail = detail;
  console.log(`  ok    ${entry.name}\n          ${detail}`);
}

function fail(entry: Step, detail: string): never {
  entry.status = 'failed';
  entry.detail = detail;
  console.log(`  FAIL  ${entry.name}\n          ${detail}`);
  throw new Error(`${entry.name}: ${detail}`);
}

/**
 * Request-level trace, off unless `APORIA_WORKFLOW_DEBUG=1`.
 *
 * A verification run that fails with only a step name is not diagnosable, and the application's own
 * answer for a mismatched route is a 404 page that says nothing about which form was meant.
 */
const DEBUG = process.env['APORIA_WORKFLOW_DEBUG'] === '1';

function trace(message: string): void {
  if (DEBUG) {
    console.error(message);
  }
}

// ---------------------------------------------------------------------------
// Reading the served HTML, so nothing about a form is assumed.
// ---------------------------------------------------------------------------

interface Page {
  readonly status: number;
  readonly html: string;
}

interface Submission extends Page {
  readonly location: string;
}

interface FormField {
  readonly name: string;
  readonly kind: string;
  readonly required: boolean;
  readonly options: readonly string[];
  /** What a browser would send if the operator touched nothing: hidden value, selected option, or textarea content. */
  readonly defaultValue: string | null;
}

interface ParsedForm {
  readonly action: string;
  readonly method: string;
  readonly fields: readonly FormField[];
  readonly marker: string;
}

/**
 * Which form on a page is meant.
 *
 * Pages carry several forms that share an action suffix — one statement-void form per statement, one
 * assessment form per dimension — so a bare substring is not always unique. `hasField` and `hidden`
 * select on the form's own markup rather than on a location the script maintains.
 */
interface FormSelector {
  readonly contains: string;
  /** The action must end this way. A link form ends `/propositions`; its correction form ends `/supersede`. */
  readonly ends?: string;
  readonly hasField?: string;
  readonly hidden?: { readonly name: string; readonly value: string };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function attribute(attributes: string, name: string): string | undefined {
  const matched = new RegExp(`${name}="([^"]*)"`, 'i').exec(attributes)?.[1];
  return matched === undefined ? undefined : decodeEntities(matched);
}

function parseForm(body: string, action: string, method: string, marker: string): ParsedForm {
  const fields: FormField[] = [];
  for (const tag of body.matchAll(/<(input|select|textarea)\b([\s\S]*?)>/gi)) {
    const kind = (tag[1] ?? 'input').toLowerCase();
    const attributes = tag[2] ?? '';
    const name = attribute(attributes, 'name');
    if (name === undefined) {
      continue;
    }
    const type = (attribute(attributes, 'type') ?? kind).toLowerCase();
    if (kind === 'select') {
      const closing = new RegExp(`</select\\s*>`, 'i').exec(body.slice(Number(tag.index ?? 0)));
      const inner = body.slice(
        Number(tag.index ?? 0) + tag[0].length,
        closing === null ? body.length : Number(tag.index ?? 0) + Number(closing.index),
      );
      const options = [...inner.matchAll(/<option\b[\s\S]*?value="([^"]*)"/gi)].map((option) =>
        decodeEntities(option[1] ?? ''),
      );
      const selected = /<option\b[\s\S]*?value="([^"]*)"[\s\S]*?\bselected\b/i.exec(inner)?.[1];
      fields.push({
        name,
        kind: 'select',
        required: /\brequired\b/i.test(attributes),
        options,
        defaultValue: selected === undefined ? null : decodeEntities(selected),
      });
      continue;
    }
    if (kind === 'textarea') {
      const closing = new RegExp('</textarea>', 'i').exec(body.slice(Number(tag.index ?? 0)));
      const inner = body.slice(
        Number(tag.index ?? 0) + tag[0].length,
        closing === null ? body.length : Number(tag.index ?? 0) + Number(closing.index),
      );
      const text = decodeEntities(inner)
        .replace(/<[^>]*>/g, '')
        .trim();
      fields.push({
        name,
        kind: 'textarea',
        required: /\brequired\b/i.test(attributes),
        options: [],
        defaultValue: text.length === 0 ? null : text,
      });
      continue;
    }
    if (type === 'checkbox') {
      // A browser sends nothing at all for an unchecked box.
      const checked = /\bchecked\b/i.test(attributes);
      fields.push({
        name,
        kind: 'checkbox',
        required: /\brequired\b/i.test(attributes),
        options: [],
        defaultValue: checked ? (attribute(attributes, 'value') ?? 'on') : null,
      });
      continue;
    }
    fields.push({
      name,
      kind: type,
      required: /\brequired\b/i.test(attributes),
      options: [],
      defaultValue: attribute(attributes, 'value') ?? '',
    });
  }
  return { action, method, fields, marker };
}

function allForms(html: string): ParsedForm[] {
  const parsed: ParsedForm[] = [];
  for (const form of html.matchAll(/<form\b([\s\S]*?)>([\s\S]*?)<\/form>/gi)) {
    const attributes = form[1] ?? '';
    const action = attribute(attributes, 'action') ?? '';
    const method = (attribute(attributes, 'method') ?? 'get').toLowerCase();
    parsed.push(parseForm(form[2] ?? '', action, method, action));
  }
  return parsed;
}

function describeForm(form: ParsedForm): string {
  const fields = form.fields
    .map((field) =>
      field.options.length === 0
        ? `${field.name} (${field.kind}${field.required ? ', required' : ''})`
        : `${field.name} (${field.kind}${field.required ? ', required' : ''}: ${field.options.slice(0, 8).join('|')})`,
    )
    .join(', ');
  return `${form.method.toUpperCase()} ${form.action} — ${fields === '' ? 'no fields' : fields}`;
}

function describeForms(html: string): string {
  const forms = allForms(html);
  if (forms.length === 0) {
    return 'this page carries no form at all';
  }
  return `forms on this page: ${forms.map(describeForm).join(' | ')}`;
}

function plainText(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What the application said when it refused a submission.
 *
 * A failure that only prints a status code is not evidence, so this lifts the rendered error summary
 * and the per-field messages out of the page, and falls back to the page text when neither is present.
 */
function fieldErrors(html: string): string {
  const summary = [...html.matchAll(/<li><strong>([^<]*)<\/strong>([\s\S]*?)<\/li>/gi)].map(
    (match) => `${plainText(match[1] ?? '').replace(/:$/, '')}: ${plainText(match[2] ?? '')}`,
  );
  const inline = [...html.matchAll(/<p class="field-error"[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => plainText(match[1] ?? ''))
    .filter((message) => message.length > 0);
  const unique = [...new Set([...summary, ...inline])];
  if (unique.length > 0) {
    return unique.join(' / ');
  }
  const text = plainText(html.slice(0, 8000));
  return `the page carried no error markup; its text begins "${text.slice(0, 220)}"`;
}

function selectorText(selector: FormSelector | string): string {
  if (typeof selector === 'string') {
    return selector;
  }
  const parts = [`action contains "${selector.contains}"`];
  if (selector.ends !== undefined) {
    parts.push(`ending "${selector.ends}"`);
  }
  if (selector.hasField !== undefined) {
    parts.push(`has a "${selector.hasField}" field`);
  }
  if (selector.hidden !== undefined) {
    parts.push(`hidden ${selector.hidden.name}="${selector.hidden.value}"`);
  }
  return parts.join(' and ');
}

function matches(form: ParsedForm, selector: FormSelector | string): boolean {
  if (typeof selector === 'string') {
    return form.action.includes(selector);
  }
  if (!form.action.includes(selector.contains)) {
    return false;
  }
  if (selector.ends !== undefined && !form.action.endsWith(selector.ends)) {
    return false;
  }
  if (selector.hasField !== undefined && !form.fields.some((f) => f.name === selector.hasField)) {
    return false;
  }
  if (selector.hidden !== undefined) {
    const field = form.fields.find((candidate) => candidate.name === selector.hidden?.name);
    if (field?.defaultValue !== selector.hidden.value) {
      return false;
    }
  }
  return true;
}

/**
 * Every form on the page that the selector describes.
 *
 * Ordered as served, so `nth` targets are the same ones the operator reads top to bottom.
 */
function findForms(html: string, selector: FormSelector | string): ParsedForm[] {
  return allForms(html).filter((form) => matches(form, selector));
}

function findForm(html: string, selector: FormSelector | string): ParsedForm {
  const forms = findForms(html, selector);
  if (forms.length === 0) {
    throw new Error(`no form where ${selectorText(selector)}. ${describeForms(html)}`);
  }
  return forms[0] as ParsedForm;
}

function nthForm(html: string, selector: FormSelector | string, index: number): ParsedForm {
  const forms = findForms(html, selector);
  const form = forms[index];
  if (form === undefined) {
    throw new Error(
      `expected at least ${String(index + 1)} form(s) where ${selectorText(selector)}; found ${String(
        forms.length,
      )}. ${describeForms(html)}`,
    );
  }
  return form;
}

/** The first real choice offered by a select, for ids only the application knows. */
function firstChoice(html: string, selector: FormSelector | string, field: string): string {
  const target = findForm(html, selector);
  const options = target.fields.find((candidate) => candidate.name === field)?.options ?? [];
  const choice = options.find((option) => option.length > 0);
  if (choice === undefined) {
    throw new Error(
      `the ${describeForm(target)} form offers nothing in "${field}", so this step cannot be completed honestly`,
    );
  }
  return choice;
}

// ---------------------------------------------------------------------------
// The session.
// ---------------------------------------------------------------------------

class Session {
  private cookie = '';
  readonly base: string;

  constructor(base: string) {
    this.base = base;
  }

  private headers(): Record<string, string> {
    return this.cookie === '' ? {} : { cookie: this.cookie };
  }

  private remember(response: Response): void {
    const setCookie = response.headers.get('set-cookie');
    if (setCookie !== null) {
      this.cookie = setCookie.split(';')[0] ?? '';
    }
  }

  async get(path: string): Promise<Page> {
    trace(`GET ${path}`);
    const response = await fetch(`${this.base}${path}`, {
      headers: this.headers(),
      redirect: 'manual',
    });
    this.remember(response);
    const html = await response.text();
    trace(`  → ${String(response.status)} (${String(html.length)} bytes)`);
    return { status: response.status, html };
  }

  async post(path: string, values: Record<string, string>): Promise<Submission> {
    const response = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        ...this.headers(),
      },
      body: new URLSearchParams(values).toString(),
      redirect: 'manual',
    });
    this.remember(response);
    const location = response.headers.get('location') ?? '';
    trace(`  → ${String(response.status)}${location === '' ? '' : ` ${location}`}`);
    return {
      status: response.status,
      html: await response.text(),
      location,
    };
  }

  /**
   * Assemble the body exactly as a browser would: every field the form declares, the operator's
   * values where given, otherwise the field's own default, and nothing that the form does not have.
   */
  private bodyFor(form: ParsedForm, values: Record<string, string>): Record<string, string> {
    const names = new Set(form.fields.map((field) => field.name));
    for (const key of Object.keys(values)) {
      if (!names.has(key)) {
        throw new Error(
          `the ${describeForm(form)} form has no field named "${key}"; the fields it does have are listed in that description`,
        );
      }
    }
    const body: Record<string, string> = {};
    for (const field of form.fields) {
      const supplied = values[field.name];
      if (supplied !== undefined) {
        // A value the served page never offered is the driver guessing, so it stops here rather than
        // posting something the application would reject for a different reason.
        if (field.options.length > 0 && !field.options.includes(supplied)) {
          throw new Error(
            `the ${describeForm(form)} form does not offer "${supplied}" for "${field.name}"`,
          );
        }
        body[field.name] = supplied;
        continue;
      }
      if (field.defaultValue === null) {
        if (field.required) {
          throw new Error(
            `the "${form.marker}" form requires "${field.name}" and the workflow supplies nothing, so this step cannot pass`,
          );
        }
        continue;
      }
      if (field.required && field.defaultValue.trim().length === 0) {
        throw new Error(
          `the "${form.marker}" form requires "${field.name}" but the page offers no default and the workflow supplies nothing`,
        );
      }
      body[field.name] = field.defaultValue;
    }
    return body;
  }

  /** Fill and submit a form the page actually served, then follow the redirect it answers with. */
  async submit(
    source: Page,
    selector: FormSelector | string,
    values: Record<string, string> = {},
    index = 0,
  ): Promise<Submission> {
    const form =
      index === 0 ? findForm(source.html, selector) : nthForm(source.html, selector, index);
    if (form.method !== 'post') {
      throw new Error(`the ${selectorText(selector)} form is a ${form.method.toUpperCase()} form`);
    }
    const body = this.bodyFor(form, values);
    trace(`POST ${form.action} fields: ${Object.keys(body).join(', ')}`);
    const response = await this.post(form.action, body);
    if (response.status === 303 && response.location.length > 0) {
      const landed = await this.get(response.location);
      return { status: response.status, html: landed.html, location: response.location };
    }
    return response;
  }

  /** The same for a get form, which is how the retest preview is reached. */
  async submitGet(
    source: Page,
    selector: FormSelector | string,
    values: Record<string, string>,
  ): Promise<Page> {
    const form = findForm(source.html, selector);
    if (form.method !== 'get') {
      throw new Error(`the ${selectorText(selector)} form is a ${form.method.toUpperCase()} form`);
    }
    const params = new URLSearchParams(this.bodyFor(form, values));
    return await this.get(`${form.action}?${params.toString()}`);
  }

  token(source: Page, selector: FormSelector | string): string {
    const field = findForm(source.html, selector).fields.find((f) => f.name === '_csrf');
    if (field?.defaultValue === null || field?.defaultValue === undefined) {
      throw new Error(`the ${selectorText(selector)} form carries no CSRF token`);
    }
    return field.defaultValue;
  }
}

// ---------------------------------------------------------------------------
// The server and the helper processes.
// ---------------------------------------------------------------------------

async function startServer(dataDir: string, port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['src/server.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      APORIA_DATA_DIR: dataDir,
      APORIA_PORT: String(port),
      APORIA_HOST: '127.0.0.1',
      APORIA_OPERATOR: OPERATOR,
      APORIA_LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    log += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    log += chunk.toString('utf8');
  });
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        const health = (await response.json()) as Record<string, unknown>;
        if (typeof health['version'] === 'string') {
          console.log(`  server up on 127.0.0.1:${port} — health reports ${health['version']}`);
          return child;
        }
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((wait) => setTimeout(wait, 150));
  }
  child.kill('SIGTERM');
  throw new Error(
    `the server did not answer /health on port ${String(port)} within ${String(STARTUP_TIMEOUT_MS)}ms. Output:\n${log}`,
  );
}

function stopServer(child: ChildProcess): Promise<void> {
  return new Promise((done) => {
    child.once('exit', () => done());
    child.kill('SIGTERM');
  });
}

async function freePort(): Promise<number> {
  // Bind, read the assigned port, release it, then hand the number to the server. A fixed port is how
  // a verification run collides with whatever else is listening on the machine — 3000 is Grafana here.
  const { createServer } = await import('node:net');
  return await new Promise((done, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => done(port));
    });
  });
}

function runScript(
  args: readonly string[],
  env: Record<string, string> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, [...args], {
      cwd: ROOT,
      env: { ...process.env, APORIA_OPERATOR: OPERATOR, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('exit', (code) => done({ exitCode: code ?? -1, stdout, stderr }));
  });
}

/**
 * A structurally valid, explicitly synthetic case written to a temporary corpus directory.
 *
 * It is written outside the application's data directory and never inside a database, and it says of
 * itself that it is not a gold case. Its only purpose is to prove the harness runs, refuses to claim
 * accuracy, and names what is missing.
 */
function writeSyntheticCorpus(): string {
  const corpus = mkdtempSync(join(tmpdir(), 'aporia-workflow-benchmark-'));
  const synthethic = {
    version: 'benchmark-case-v2',
    id: 'workflow-synthetic',
    stratum: 'SUPPORTED_PRIMARY_EVIDENCE',
    title: 'Synthetic case written by the workflow verifier',
    provenance: {
      origin: 'Constructed for this verification run. Not reviewed material.',
      authorizedForStorage: true,
      reviewedBy: [OPERATOR],
      reviewedAt: '2026-11-02',
      unverified: ['No independent review; this is a framework smoke test.'],
      limitation: 'Synthetic. It is not a gold case and establishes no accuracy.',
    },
    input: {
      claimText: 'A synthetic claim used only to exercise the harness.',
      propositions: [
        {
          id: 'prop-1',
          text: 'A synthetic proposition.',
          evidence: [
            {
              id: 'ev-1',
              sourceId: 'src-1',
              relation: 'SUPPORTS',
              sourceType: 'PRIMARY_ARTIFACT',
              independence: 'INDEPENDENT',
              locator: 'section 1',
            },
          ],
        },
      ],
      answerText: null,
      citationCapture: 'NOT_SHOWN',
      citations: [],
      statements: [],
      providerLabel: 'synthetic',
      locale: 'en',
    },
    expected: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        rationale: 'The synthetic relationship supports the proposition.',
        subjectId: 'prop-1',
      },
    ],
    reviewerLabels: [],
    adjudications: [],
    limitations: [
      'Synthetic fixture only. Nothing here describes a real product, person, or answer.',
    ],
  };
  writeFileSync(join(corpus, 'synthetic-case.json'), JSON.stringify(synthethic, null, 2), 'utf8');
  return corpus;
}

// ---------------------------------------------------------------------------
// Ids read back out of the served pages.
// ---------------------------------------------------------------------------

function idIn(href: string, prefix: string): string {
  const found = new RegExp(`${prefix}_[A-Za-z0-9-]+`).exec(href)?.[0];
  if (found === undefined) {
    throw new Error(`no ${prefix}_ identifier inside "${href}"`);
  }
  return found;
}

/**
 * The outcome the finding's own comparisons panel reports, as a status constant.
 *
 * The driver takes the measured status from what the application displayed rather than assuming the
 * comparison came out a particular way, so a change in the comparison rules shows up here instead of
 * silently selecting a status that no longer matches the measurement.
 */
function outcomeStatusFromFinding(html: string): string {
  const panelStart = html.indexOf('Retest comparisons');
  if (panelStart < 0) {
    throw new Error('the finding page carries no retest comparisons panel');
  }
  const outcome = /<h3>\s*([^<·]+?)\s*·/.exec(html.slice(panelStart))?.[1]?.trim();
  const statuses: Record<string, string> = {
    Improved: 'IMPROVED',
    Unchanged: 'UNCHANGED',
    Regressed: 'REGRESSED',
    'Unable to verify': 'UNABLE_TO_VERIFY',
  };
  if (outcome === undefined || statuses[outcome] === undefined) {
    throw new Error(
      `the comparisons panel did not name a measurable outcome${outcome === undefined ? '' : ` (it said "${outcome}")`}`,
    );
  }
  return statuses[outcome];
}

function requireAccepted(entry: Step, result: Submission, expect: string): void {
  if (result.status !== 303) {
    fail(
      entry,
      `the application rejected the submission (status ${String(result.status)}): ${fieldErrors(result.html)}`,
    );
  }
  if (expect.length > 0 && !result.html.includes(expect)) {
    fail(
      entry,
      `the submission was accepted but the landed page does not show "${expect}", so the record cannot be read back`,
    );
  }
}

/**
 * A submission the application must refuse, made as a hand-built POST rather than through a form.
 *
 * This is how §4's "a client must not be able to submit a fabricated outcome" is exercised: the
 * driver deliberately sends values the page would never have offered together.
 */
async function requireRefused(
  entry: Step,
  session: Session,
  action: string,
  token: string,
  values: Record<string, string>,
  stillTrue: () => Promise<boolean>,
): Promise<void> {
  const result = await session.post(action, { _csrf: token, ...values });
  if (result.status === 303) {
    fail(entry, `a fabricated submission to ${action} was accepted (303 → ${result.location})`);
  }
  if (!(await stillTrue())) {
    fail(
      entry,
      `the fabricated submission to ${action} returned ${String(result.status)} but the stored record changed anyway`,
    );
  }
}

// ---------------------------------------------------------------------------
// Steps 1–21 against one live server.
// ---------------------------------------------------------------------------

interface Workflow {
  readonly projectId: string;
  readonly claimHref: string;
  readonly workspacePath: string;
  readonly firstRunHref: string;
  readonly secondRunHref: string;
  readonly reportHrefs: string[];
  readonly findingHref: string;
}

async function drive(port: number, label: string): Promise<Workflow> {
  const session = new Session(`http://127.0.0.1:${port}`);
  const named = (n: string, name: string): Step => step(`${label} ${n} — ${name}`);
  const answer =
    'Project A was started by Ram back in 2019. Sam took over maintenance later. The project also has a paid tier.';

  // 1. Project and target entity.
  const one = named('01', 'create a project and target entity');
  const newProject = await session.get('/projects/new');
  const project = await session.submit(
    newProject,
    { contains: '/projects', hasField: 'name' },
    {
      name: 'V0.4 Workflow Project',
      description: 'A project entered by hand to verify the local workflow end to end.',
      primaryDomain: 'https://example.invalid/project-a',
    },
  );
  const projectId = /\/projects\/([^/?#]+)/.exec(project.location)?.[1];
  if (projectId === undefined || projectId === 'new') {
    fail(one, `creating the project did not redirect to it (status ${String(project.status)})`);
  }
  const entitiesPage = await session.get(`/projects/${projectId}/entities`);
  const entity = await session.submit(
    entitiesPage,
    { contains: '/entities', hasField: 'canonicalName' },
    {
      type: 'PERSON',
      canonicalName: 'Project A',
      alternateNames: 'project-a',
      publicUrls: 'https://example.invalid/project-a',
      identityStatus: 'SELF_DECLARED',
      identityMethod: 'Name used by the project on its own page, entered by the operator.',
      identityScope: 'The label the project uses for itself.',
      notes: 'Entered during the v0.4 workflow verification.',
    },
  );
  requireAccepted(one, entity, 'Project A');
  // Creating the first entity may already have made it the target. Either route is acceptable, but the
  // driver has to end with a target on record, and it says which path it took.
  const targetForms = findForms(entity.html, { contains: '/target' });
  let targetLanding = entity;
  if (targetForms.length > 0) {
    targetLanding = await session.submit(entity, { contains: '/target' }, {});
    requireAccepted(one, targetLanding, 'Project A');
  }
  if (!targetLanding.html.includes('Current target')) {
    fail(
      one,
      `the entities page shows no current target, so the project has nothing to evaluate against. ${describeForms(targetLanding.html)}`,
    );
  }
  pass(
    one,
    `project ${projectId} created, entity entered by hand with its identity fields, and made the project's target${
      targetForms.length > 0
        ? ' through its own "Set as target" form'
        : ' as the first entity recorded'
    }`,
  );

  // 2. A manually supplied claim.
  const two = named('02', 'record an actual manually supplied claim');
  const claimClaim = await session.get(`/projects/${projectId}/claims/new`);
  const claim = await session.submit(
    claimClaim,
    { contains: '/claims', hasField: 'text' },
    {
      text: 'Project A was created by Ram in 2021 and is maintained by Sam.',
      sourceUrl: 'https://example.invalid/project-a',
      intendedMeaning: 'Who started the project, when, and who keeps it going now.',
      timeScope: 'Founding to the date of capture',
      locale: 'en',
    },
  );
  requireAccepted(two, claim, 'created by Ram in 2021');
  const claimHref = /\/projects\/[^"?#]*\/claims\/clm_[A-Za-z0-9-]+/.exec(claim.location)?.[0];
  if (claimHref === undefined) {
    fail(two, `the claim was accepted but its page is not reachable (${claim.location})`);
  }
  pass(two, `claim stored at revision 1 at ${claimHref}`);

  // 3. Proposition decomposition.
  const three = named('03', 'decompose it into propositions');
  let page = await session.get(claimHref);
  const firstProposition = await session.submit(
    page,
    { contains: '/propositions', hasField: 'evidenceRequirements' },
    {
      text: 'Project A was created in 2021.',
      subject: 'Project A',
      predicate: 'creation year',
      objectValue: '2021',
      conditions: 'Calendar year of the first public release.',
      timeInterval: '2021',
      units: 'Calendar year',
      evidenceRequirements: 'A dated primary artifact, such as a release record.',
      expectedAnswerCriterion: 'The answer gives the founding year.',
      ambiguityNotes: 'Founding versus first public release is not distinguished by the claim.',
    },
  );
  if (firstProposition.status !== 303) {
    fail(three, `the first proposition was rejected: ${fieldErrors(firstProposition.html)}`);
  }
  page = await session.get(claimHref);
  const made = await session.submit(
    page,
    { contains: '/propositions', hasField: 'evidenceRequirements' },
    {
      text: 'Sam maintains Project A.',
      subject: 'Sam',
      predicate: 'maintains',
      objectValue: 'Project A',
      conditions: 'Current maintainer of the project.',
      evidenceRequirements: 'A maintainer record on the project itself.',
      expectedAnswerCriterion: 'The answer names the current maintainer.',
    },
  );
  if (made.status !== 303) {
    fail(three, `the second proposition was rejected: ${fieldErrors(made.html)}`);
  }
  page = await session.get(claimHref);
  if (
    !page.html.includes('Project A was created in 2021') ||
    !page.html.includes('Sam maintains')
  ) {
    fail(three, 'both propositions are not readable on the claim page');
  }
  pass(three, 'two propositions recorded on the claim, each with its evidence requirement');

  // 4. A source and an evidence relationship.
  const four = named('04', 'record a source and an evidence relationship');
  const sourcesPage = await session.get(`/projects/${projectId}/sources/new`);
  const source = await session.submit(
    sourcesPage,
    { contains: '/sources', hasField: 'canonicalUri' },
    {
      title: 'Project A release archive',
      canonicalUri: 'https://example.invalid/project-a/releases/2021',
      publisher: 'Example Invalid',
      author: 'Project A maintainers',
      sourceType: 'PRIMARY_ARTIFACT',
      accessRoute: 'MANUAL_ENTRY',
      publicationDate: '2021-06-01',
      language: 'en',
      independence: 'SELF_PUBLISHED',
      notes: 'Typed from a locally held copy; Aporia fetched nothing.',
    },
  );
  requireAccepted(four, source, 'release archive');
  page = await session.get(claimHref);
  const evidenceSelector: FormSelector = { contains: '/evidence', hasField: 'sourceId' };
  const sourceId = firstChoice(page.html, evidenceSelector, 'sourceId');
  const evidence = await session.submit(page, evidenceSelector, {
    sourceId,
    locator: 'Release archive, entry for the first public release',
    excerpt: 'First public release: 2021.',
    relation: 'SUPPORTS',
    rationale: 'The artifact itself carries the year the proposition asks about.',
    reviewer: OPERATOR,
  });
  if (evidence.status !== 303) {
    fail(four, `the evidence relationship was rejected: ${fieldErrors(evidence.html)}`);
  }
  page = await session.get(claimHref);
  if (!page.html.includes('First public release: 2021')) {
    fail(four, 'the recorded excerpt is not readable on the claim page');
  }
  pass(
    four,
    `source "${sourceId}" is selectable on the claim page and one SUPPORTS relationship is recorded with its stored excerpt`,
  );

  // 5. A human proposition assessment, which the application only offers once review has started.
  const five = named('05', 'record a human proposition assessment');
  const started = await session.submit(
    page,
    { contains: '/status', hidden: { name: 'to', value: 'UNDER_REVIEW' } },
    {},
  );
  if (started.status !== 303) {
    fail(five, `starting review was rejected: ${fieldErrors(started.html)}`);
  }
  page = await session.get(claimHref);
  if (findForms(page.html, { contains: '/assessments', hasField: 'label' }).length === 0) {
    fail(
      five,
      `the claim is under review but no reviewed-conclusion form is offered. ${describeForms(page.html)}`,
    );
  }
  const assessed = await session.submit(
    page,
    { contains: '/assessments', hasField: 'label' },
    {
      label: 'SUPPORTED_WITHIN_SCOPE',
      rationale: 'A dated primary artifact recorded by the operator states the year directly.',
      reviewer: OPERATOR,
    },
  );
  requireAccepted(
    five,
    assessed,
    'A dated primary artifact recorded by the operator states the year directly.',
  );
  pass(
    five,
    'the claim moved to UNDER_REVIEW through its own form, and a reviewed conclusion is stored beside the rule output, not instead of it',
  );

  // 6. A query set, approved and frozen.
  const six = named('06', 'create and approve a query set');
  const setsPage = await session.get(`/projects/${projectId}/query-sets/new`);
  const set = await session.submit(
    setsPage,
    { contains: '/query-sets', hasField: 'name' },
    {
      name: 'Discovery questions',
      description: 'Asked of one assistant by hand, verbatim.',
      locale: 'en',
    },
  );
  const setHref = /\/projects\/[^"?#]*\/query-sets\/qst_[A-Za-z0-9-]+/.exec(set.location)?.[0];
  if (setHref === undefined) {
    fail(six, `the query set was created but its page is not reachable (${set.location})`);
  }
  const detail = await session.get(setHref);
  const query = await session.submit(
    detail,
    { contains: '/queries', hasField: 'text' },
    {
      text: 'Who created Project A and who maintains it now?',
      intent: 'ATTRIBUTION',
      locale: 'en',
      expectedElements: 'The creator, the maintainer.',
      inclusionRationale: 'The claim asks exactly this, so one query is enough.',
    },
  );
  if (query.status !== 303) {
    fail(six, `the query was rejected: ${fieldErrors(query.html)}`);
  }
  const approved = await session.submit(
    await session.get(setHref),
    { contains: '/approve', hasField: 'reviewer' },
    { reviewer: OPERATOR, note: 'Frozen after one verbatim attribution question.' },
  );
  if (approved.status !== 303 || !/APPROVED|Approved|approved/.test(approved.html)) {
    fail(six, `the query set did not reach the approved state: ${fieldErrors(approved.html)}`);
  }
  pass(
    six,
    `query set ${idIn(setHref, 'qst')} holds one query and is approved, so its text is frozen`,
  );

  // 7. A run.
  const seven = named('07', 'create a run');
  const runsPage = await session.get(`/projects/${projectId}/runs/new`);
  const runForm: FormSelector = { contains: '/runs', hasField: 'querySetId' };
  const run = await session.submit(runsPage, runForm, {
    querySetId: firstChoice(runsPage.html, runForm, 'querySetId'),
    name: 'First capture',
    providerLabel: 'Manual assistant entry',
    modelLabel: 'unknown-model',
    interfaceLabel: 'Consumer web interface',
    groundingMode: 'SEARCH_GROUNDED',
    locale: 'en',
    region: '',
    captureFrom: '2026-11-02T09:00',
    captureTo: '2026-11-02T09:30',
    conditions: 'Signed out, no tools, free account plan, English interface.',
    notes: 'Typed from a screenshot taken at the same sitting.',
  });
  const firstRunHref = /\/projects\/[^"?#]*\/runs\/run_[A-Za-z0-9-]+/.exec(run.location)?.[0];
  if (firstRunHref === undefined) {
    fail(seven, `the run was created but its page is not reachable (${run.location})`);
  }
  pass(seven, `run ${idIn(firstRunHref, 'run')} open against the approved query set`);

  // 8. A captured answer.
  const eight = named('08', 'capture a real manually supplied answer');
  const runPage = await session.get(firstRunHref);
  const observation = await session.submit(
    runPage,
    { contains: '/observations', hasField: 'answerText' },
    {
      queryId: firstChoice(
        runPage.html,
        { contains: '/observations', hasField: 'answerText' },
        'queryId',
      ),
      status: 'COMPLETED',
      answerText: answer,
      citationCapture: 'CAPTURED',
      contextNotes: 'Pasted exactly as displayed, including its wording.',
    },
  );
  requireAccepted(eight, observation, 'started by Ram back in 2019');
  const workspacePath = /\/projects\/[^"?#]*\/observations\/obs_[A-Za-z0-9-]+\/claims/.exec(
    observation.html,
  )?.[0];
  if (workspacePath === undefined) {
    fail(eight, 'the run page offers no link into the answer-statement workspace');
  }
  const observationId = idIn(workspacePath, 'obs');
  pass(eight, `observation ${observationId} stores the raw answer text on the run page`);

  // 8b. Observation-level assessments, which is what a mention rate is built from.
  const eightb = named('08b', 'record observation-level assessments');
  const presence = await session.submit(
    await session.get(firstRunHref),
    { contains: '/assessments', hidden: { name: 'dimension', value: 'PRESENCE' } },
    { label: 'MENTIONED', rationale: 'The answer names the project outright.', reviewer: OPERATOR },
  );
  requireAccepted(eightb, presence, 'The answer names the project outright.');
  const fidelity = await session.submit(
    await session.get(firstRunHref),
    { contains: '/assessments', hidden: { name: 'dimension', value: 'FIDELITY' } },
    {
      label: 'PARTIALLY_ACCURATE',
      rationale: 'It mentions the project but gives the wrong founding year.',
      reviewer: OPERATOR,
    },
  );
  requireAccepted(eightb, fidelity, 'It mentions the project but gives the wrong founding year.');
  pass(
    eightb,
    `answer presence and answer fidelity recorded on observation ${observationId}, each with its rationale`,
  );

  // 9. Statements from the exact raw answer.
  const nine = named('09', 'record multiple answer statements from the exact raw answer');
  const workspace = await session.get(workspacePath);
  if (!workspace.html.includes('Project A was started by Ram')) {
    fail(nine, 'the claim workspace does not show the captured answer it decomposes');
  }
  const statementForm: FormSelector = {
    contains: '/claims',
    ends: '/claims',
    hasField: 'statementKind',
  };
  const recorded = await session.submit(workspace, statementForm, {
    quoteText: 'Project A was started by Ram back in 2019.',
    statementKind: 'QUOTED',
    offsetBasis: 'EXACT_MATCH',
    relevance: 'ADDRESSES',
    note: 'Quoted exactly as captured.',
  });
  requireAccepted(nine, recorded, 'Project A was started by Ram back in 2019.');
  const second = await session.submit(recorded, statementForm, {
    quoteText: 'Sam   took over maintenance later.',
    statementKind: 'QUOTED',
    offsetBasis: 'NORMALIZED_MATCH',
    relevance: 'PARTIALLY_ADDRESSES',
    paraphrase: 'Names a maintainer but never says from when.',
    note: 'The capture has single spaces; the whitespace differs only.',
  });
  requireAccepted(nine, second, 'took over maintenance');
  const afterTwo = await session.get(workspacePath);
  const counted = [...afterTwo.html.matchAll(/<h3>\s*Statement /g)].length;
  if (counted !== 2) {
    fail(nine, `the workspace lists ${String(counted)} statements after two submissions, not two`);
  }
  if (!/characters \d+–\d+/.test(afterTwo.html)) {
    fail(
      nine,
      'the verbatim statement carries no stored character range, so its position in the answer is not recorded',
    );
  }
  pass(
    nine,
    'two statements recorded from the captured answer; the workspace lists exactly two, and the verbatim quote shows the character range computed from the raw answer',
  );

  // 10. Quote locations, including a reviewer description and a refused quote.
  const ten = named(
    '10',
    'verify quote locations, normalized matches and reviewer-description states',
  );
  const third = await session.submit(second, statementForm, {
    quoteText: 'The answer never states from when Sam has maintained the project.',
    statementKind: 'REVIEWER_DESCRIPTION',
    offsetBasis: 'NOT_ESTABLISHED',
    relevance: 'OMISSION',
    note: 'The reviewer describes an absence, so no position in the answer is claimed.',
  });
  requireAccepted(ten, third, 'never states from when');
  const wrongKind = await session.submit(await session.get(workspacePath), statementForm, {
    quoteText: 'Project A was started by Ram back in 2019.',
    statementKind: 'REVIEWER_DESCRIPTION',
    offsetBasis: 'EXACT_MATCH',
    relevance: 'ADDRESSES',
    note: 'A description that claims a verbatim position it did not verify.',
  });
  if (wrongKind.status === 303) {
    fail(
      ten,
      'a reviewer description was accepted while claiming an exact-match position, so a paraphrase could masquerade as a quote',
    );
  }
  const wrongKindMessage = fieldErrors(wrongKind.html);
  const fabricated = await session.submit(await session.get(workspacePath), statementForm, {
    quoteText: 'The project launched in 2005 with backing from Acme.',
    statementKind: 'QUOTED',
    offsetBasis: 'EXACT_MATCH',
    relevance: 'ADDRESSES',
  });
  if (fabricated.status === 303) {
    fail(ten, 'a quote that is not in the captured answer was accepted as an exact match');
  }
  const fabricatedMessage = fieldErrors(fabricated.html);
  // A 422 page echoes what was typed, so the real proof is the freshly read workspace.
  const afterRefusals = await session.get(workspacePath);
  if (afterRefusals.html.includes('backing from Acme')) {
    fail(ten, 'the refused quote is present on the re-read workspace, so it was stored after all');
  }
  const statementCount = [...afterRefusals.html.matchAll(/<h3>\s*Statement /g)].length;
  if (statementCount !== 3) {
    fail(
      ten,
      `the workspace holds ${String(statementCount)} statements; exactly 3 were expected, so a refused submission changed the record`,
    );
  }
  pass(
    ten,
    `three statements recorded — verbatim range, normalised range and reviewer description — and both bad submissions were refused with the workspace still holding exactly three statements. Description-claims-a-position: "${wrongKindMessage}". Fabricated quote: "${fabricatedMessage}"`,
  );

  // 11. Statements linked to propositions.
  const eleven = named('11', 'link statements to propositions');
  const linkSelector: FormSelector = {
    contains: '/claims',
    ends: '/propositions',
    hasField: 'propositionId',
  };
  const forLinking = await session.get(workspacePath);
  let linked = await session.submit(forLinking, linkSelector, {
    propositionId: firstChoice(forLinking.html, linkSelector, 'propositionId'),
    relation: 'SUPPORTS_TARGET',
    rationale: 'The first statement asserts the recorded creation fact.',
    reviewer: OPERATOR,
  });
  requireAccepted(eleven, linked, 'Asserts the target proposition');
  linked = await session.submit(
    linked,
    linkSelector,
    {
      propositionId: firstChoice(linked.html, linkSelector, 'propositionId'),
      relation: 'QUALIFIES_TARGET',
      rationale:
        'The second statement names a person without the year, so it qualifies rather than asserts.',
      reviewer: OPERATOR,
    },
    1,
  );
  if (linked.status !== 303) {
    fail(eleven, `the second link was rejected: ${fieldErrors(linked.html)}`);
  }
  const afterLinks = await session.get(workspacePath);
  const linkForms = findForms(afterLinks.html, { contains: '/supersede', hasField: 'relation' });
  if (linkForms.length < 2) {
    fail(
      eleven,
      `only ${String(linkForms.length)} proposition link(s) can be corrected on the workspace, so both links are not readable`,
    );
  }
  pass(
    eleven,
    'two statements linked to propositions; both links are readable and each carries its own correction form',
  );

  // 12. Citations mapped to individual statements.
  const twelve = named('12', 'map citations to individual statements');
  const citation = await session.submit(
    await session.get(firstRunHref),
    { contains: '/citations', hasField: 'url' },
    {
      url: 'https://example.invalid/project-a/announcement',
      title: 'Project A announcement',
      snippet: 'Ram announced Project A.',
      targetOwned: 'on',
    },
  );
  requireAccepted(twelve, citation, 'Project A announcement');
  const workspaceWithCitation = await session.get(workspacePath);
  const mappingForm: FormSelector = {
    contains: '/claims',
    ends: '/citations',
    hasField: 'citationId',
  };
  const mapped = await session.submit(workspaceWithCitation, mappingForm, {
    citationId: firstChoice(workspaceWithCitation.html, mappingForm, 'citationId'),
    support: 'SUPPORTS',
    rationale: 'The announcement names the same creator the statement does.',
    reviewer: OPERATOR,
  });
  requireAccepted(twelve, mapped, 'Cited material supports the statement');
  const unassessable = await session.submit(
    mapped,
    mappingForm,
    {
      citationId: firstChoice(workspaceWithCitation.html, mappingForm, 'citationId'),
      support: 'NOT_ASSESSABLE',
      rationale:
        'The second statement has no captured snippet to compare, so support is unavailable.',
      reviewer: OPERATOR,
    },
    1,
  );
  if (unassessable.status !== 303) {
    fail(twelve, `the second mapping was rejected: ${fieldErrors(unassessable.html)}`);
  }
  pass(
    twelve,
    'one citation recorded on the run and mapped to two statements, one with support and one explicitly not assessable',
  );

  // 13. Fidelity and attribution assessments, and the pairing the contract refuses.
  const thirteen = named('13', 'assess fidelity and attribution');
  const claimAssessments: FormSelector = {
    contains: '/claims',
    ends: '/assessments',
    hasField: 'fidelityLabel',
  };
  const fresh = await session.get(workspacePath);
  const fidelityOnStatement = await session.submit(fresh, claimAssessments, {
    dimension: 'FIDELITY',
    fidelityLabel: 'CONTRADICTED',
    rationale: 'The recorded release archive gives 2021; the statement says 2019.',
    reviewer: OPERATOR,
  });
  requireAccepted(thirteen, fidelityOnStatement, 'Contradicted by the recorded evidence');
  const attributionOnStatement = await session.submit(
    fidelityOnStatement,
    claimAssessments,
    {
      dimension: 'ATTRIBUTION',
      attributionLabel: 'WRONG_ROLE',
      attributionSubject: 'Ram',
      attributionRole: 'Maintainer',
      rationale:
        'The answer names the right person but credits them with maintaining, not creating.',
      reviewer: OPERATOR,
    },
    1,
  );
  requireAccepted(thirteen, attributionOnStatement, 'Right person, wrong contribution role');
  // A refusal filed against a statement that engages the target is not a factual judgement, and the
  // contract says so; the page must refuse it rather than store it.
  const inconsistent = await session.submit(
    await session.get(workspacePath),
    claimAssessments,
    {
      dimension: 'FIDELITY',
      fidelityLabel: 'REFUSED',
      rationale:
        'Filed against the statement that addresses the target, which is the mistake being tested.',
      reviewer: OPERATOR,
    },
    0,
  );
  if (inconsistent.status === 303) {
    fail(
      thirteen,
      'a REFUSED fidelity label was stored against an ADDRESSES statement, which would score an abstention as a factual verdict',
    );
  }
  pass(
    thirteen,
    `fidelity and attribution recorded on statements; the inconsistent pairing was refused (${fieldErrors(inconsistent.html)})`,
  );

  // 14. Correction and voiding.
  const fourteen = named('14', 'exercise statement and citation correction and voiding');
  const beforeVoid = await session.get(workspacePath);
  const superseded = await session.submit(
    beforeVoid,
    { contains: '/supersede', hasField: 'relation' },
    {
      relation: 'QUALIFIES_TARGET',
      rationale: 'On review the statement gives the year only under the release condition.',
      reviewer: OPERATOR,
    },
  );
  requireAccepted(fourteen, superseded, 'superseded');
  const voidForms = findForms(superseded.html, { contains: '/void', hasField: 'reason' });
  if (voidForms.length === 0) {
    fail(
      fourteen,
      `the workspace offers no statement-void form. ${describeForms(superseded.html)}`,
    );
  }
  const voided = await session.submit(
    superseded,
    { contains: '/void', hasField: 'reason' },
    {
      reason: 'Recorded the same sentence twice during this verification.',
    },
  );
  requireAccepted(fourteen, voided, 'Voided');
  const voidedCitation = await session.submit(
    await session.get(firstRunHref),
    { contains: '/citations/', hasField: 'reason' },
    { reason: 'The announcement page was later taken down.', reviewer: OPERATOR },
  );
  if (voidedCitation.status !== 303) {
    fail(
      fourteen,
      `the citation void was rejected: ${fieldErrors(voidedCitation.html)}. ${describeForms(voidedCitation.html)}`,
    );
  }
  const afterVoid = await session.get(workspacePath);
  if (!afterVoid.html.includes('Recorded the same sentence twice')) {
    fail(
      fourteen,
      'the voided statement or its reason is no longer readable, so voiding destroyed history instead of excluding it',
    );
  }
  const runAfterCitationVoid = await session.get(firstRunHref);
  if (!runAfterCitationVoid.html.includes('The announcement page was later taken down')) {
    fail(fourteen, 'the voided citation lost its reason, so the withdrawal cannot be read back');
  }
  pass(
    fourteen,
    `${String(voidForms.length)} statement void forms existed, one link was superseded with the original retained, one statement voided with its reason still readable, and the citation voided while its mappings stay on the page`,
  );

  // 15. Finalize.
  const fifteen = named('15', 'finalize the run');
  const finalized = await session.submit(
    await session.get(firstRunHref),
    { contains: '/finalize' },
    {},
  );
  requireAccepted(fifteen, finalized, 'Finalized');
  pass(fifteen, 'the run is finalized, so its stored figures are frozen');

  // 16. The report and its claim-level metrics.
  const sixteen = named('16', 'generate the report and verify claim-level metrics');
  const reportsPage = await session.get(`/projects/${projectId}/reports`);
  const report = await session.submit(
    reportsPage,
    { contains: '/reports', hasField: 'title' },
    {
      title: 'Workflow verification report',
    },
  );
  const reportHref = /\/projects\/[^"?#]*\/reports\/rep_[A-Za-z0-9-]+/.exec(report.location)?.[0];
  if (reportHref === undefined) {
    fail(sixteen, `the report was generated but not reachable (${report.location})`);
  }
  const rendered = await session.get(reportHref);
  const missing: string[] = [];
  for (const expected of [
    'Statement fidelity rate',
    'Statement citation support rate',
    'Statement attribution rate',
    'Relevant omission rate',
    'Answer decomposition coverage',
    'metrics-v4',
    'Review progress',
    'voided',
  ]) {
    if (!rendered.html.includes(expected)) {
      missing.push(expected);
    }
  }
  if (missing.length > 0) {
    fail(sixteen, `the report does not carry: ${missing.join(', ')}`);
  }
  pass(
    sixteen,
    `report ${idIn(reportHref, 'rep')} renders the claim-level block, the metrics version, the review-progress counts and the voided-statement note`,
  );

  // 17. The offline benchmark, over an isolated temporary corpus only.
  const seventeen = named('17', 'run the offline benchmark with isolated test fixtures only');
  const corpus = writeSyntheticCorpus();
  try {
    const result = await runScript(['scripts/benchmark.ts', '--corpus', corpus]);
    if (result.exitCode !== 1) {
      fail(
        seventeen,
        `a one-case corpus must exit non-zero because its strata are incomplete; it exited ${String(result.exitCode)}. stderr: ${result.stderr.slice(0, 300)}`,
      );
    }
    const combined = `${result.stdout}\n${result.stderr}`;
    const unhonest = ['not a validated accuracy claim', 'Synthetic', 'stratum'].filter(
      (needle) => !combined.includes(needle),
    );
    if (unhonest.length > 0) {
      fail(
        seventeen,
        `the harness output is missing: ${unhonest.join(', ')}. It should refuse an accuracy claim and name the missing strata:\n${combined.slice(0, 500)}`,
      );
    }
    pass(
      seventeen,
      'the harness ran against a temporary synthetic corpus outside the application, named the missing strata, and refused to present an accuracy claim',
    );
  } finally {
    rmSync(corpus, { recursive: true, force: true });
  }

  // 18. A remediation finding, created and updated.
  const eighteen = named('18', 'create and update a remediation finding');
  const findingsPage = await session.get(`/projects/${projectId}/findings/new`);
  const created = await session.submit(
    findingsPage,
    { contains: '/findings', hasField: 'observedIssue' },
    {
      title: 'The answer states the wrong founding year',
      observedIssue:
        'The captured answer says 2019; the recorded release archive says 2021, and the statement was assessed CONTRADICTED.',
      supportingEvidence:
        'One captured answer, one recorded primary artifact, one contradicted statement.',
      cause: 'MODEL_MISREAD_OR_OMISSION',
      severity: 'MEDIUM',
      severityRationale: 'A reader asking when the project started gets the wrong year.',
      recommendedAction: 'State the founding year plainly on the project page.',
      ownerLabel: OPERATOR,
      firstObservedAt: '2026-11-02T09:00',
      lastObservedAt: '2026-11-02T09:30',
    },
  );
  const findingHref = /\/projects\/[^"?#]*\/findings\/fnd_[A-Za-z0-9-]+/.exec(
    created.location,
  )?.[0];
  if (findingHref === undefined) {
    fail(eighteen, `the finding was created but not reachable (${created.location})`);
  }
  let findingPage = await session.get(findingHref);
  const amended = await session.submit(
    findingPage,
    { contains: '/details', hasField: 'severity' },
    {
      severity: 'HIGH',
      cause: '',
      ownerLabel: '',
      recommendedAction: 'Add the founding year to the project page and to the announcement.',
      note: 'Severity raised after review: the wrong year appears in every answer sampled so far.',
    },
  );
  requireAccepted(eighteen, amended, 'Severity raised after review');
  findingPage = await session.get(findingHref);
  for (const status of ['ACCEPTED', 'IN_PROGRESS', 'RETEST_REQUIRED']) {
    const moved = await session.submit(
      findingPage,
      { contains: '/transition', hasField: 'status' },
      {
        status,
        note: `Moved to ${status.toLowerCase()} during the v0.4 workflow verification.`,
      },
    );
    if (moved.status !== 303) {
      fail(eighteen, `the transition to ${status} was rejected: ${fieldErrors(moved.html)}`);
    }
    findingPage = await session.get(findingHref);
  }
  if (!findingPage.html.includes('Retest required')) {
    fail(eighteen, 'the finding did not reach the retest-required state');
  }
  // §4.1: a measured status needs a measurement. The page withholds IMPROVED until a comparison
  // carries that outcome, so this is deliberately a hand-built POST — the fabricated-client case, not
  // something an operator could reach by clicking.
  const transitionSelector: FormSelector = { contains: '/transition', hasField: 'status' };
  await requireRefused(
    eighteen,
    session,
    `${findingHref}/transition`,
    session.token(findingPage, transitionSelector),
    {
      status: 'IMPROVED',
      note: 'Claimed without any stored comparison behind it.',
    },
    async () => {
      const reloaded = await session.get(findingHref);
      return reloaded.html.includes('Retest required');
    },
  );
  const afterRefusal = await session.get(findingHref);
  const statusField = findForms(afterRefusal.html, transitionSelector)[0]?.fields.find(
    (field) => field.name === 'status',
  );
  const withheldImprove = statusField === undefined || !statusField.options.includes('IMPROVED');
  pass(
    eighteen,
    `finding ${idIn(findingHref, 'fnd')} created, amended without changing its status, walked to RETEST_REQUIRED; the page withholds IMPROVED while no comparison exists (${String(withheldImprove)}) and a hand-built IMPROVED transition was refused with the status unchanged`,
  );

  // 19. A later run, a previewed comparison, and a status bound to it.
  const nineteen = named(
    '19',
    'create a later manual run and preview and record a retest comparison',
  );
  const secondRunPage = await session.get(`/projects/${projectId}/runs/new`);
  const secondRunForm: FormSelector = { contains: '/runs', hasField: 'querySetId' };
  const secondRun = await session.submit(secondRunPage, secondRunForm, {
    querySetId: firstChoice(secondRunPage.html, secondRunForm, 'querySetId'),
    name: 'Second capture',
    providerLabel: 'Manual assistant entry',
    modelLabel: 'unknown-model',
    interfaceLabel: 'Consumer web interface',
    groundingMode: 'SEARCH_GROUNDED',
    locale: 'en',
    captureFrom: '2026-11-02T11:00',
    captureTo: '2026-11-02T11:30',
    conditions: 'Signed out, no tools, free account plan, English interface.',
    notes: 'A second hand capture under the same approved query set.',
  });
  const secondRunHref = /\/projects\/[^"?#]*\/runs\/run_[A-Za-z0-9-]+/.exec(
    secondRun.location,
  )?.[0];
  if (secondRunHref === undefined) {
    fail(nineteen, `the second run is not reachable (${secondRun.location})`);
  }
  const secondRunDetail = await session.get(secondRunHref);
  const secondObservation = await session.submit(
    secondRunDetail,
    { contains: '/observations', hasField: 'answerText' },
    {
      queryId: firstChoice(
        secondRunDetail.html,
        { contains: '/observations', hasField: 'answerText' },
        'queryId',
      ),
      status: 'COMPLETED',
      answerText: 'Project A was created by Ram in 2021. Sam is the current maintainer.',
      citationCapture: 'NOT_SHOWN',
      contextNotes: 'Typed from the same interface a week later in the fiction of this run.',
    },
  );
  requireAccepted(nineteen, secondObservation, 'created by Ram in 2021');
  const secondPresence = await session.submit(
    await session.get(secondRunHref),
    { contains: '/assessments', hidden: { name: 'dimension', value: 'PRESENCE' } },
    {
      label: 'MENTIONED',
      rationale: 'The later answer names the project outright.',
      reviewer: OPERATOR,
    },
  );
  requireAccepted(nineteen, secondPresence, 'The later answer names the project outright.');
  const secondFidelity = await session.submit(
    await session.get(secondRunHref),
    { contains: '/assessments', hidden: { name: 'dimension', value: 'FIDELITY' } },
    {
      label: 'ACCURATE',
      rationale: 'The later answer gives the recorded founding year.',
      reviewer: OPERATOR,
    },
  );
  requireAccepted(nineteen, secondFidelity, 'The later answer gives the recorded founding year.');
  const finalizedAgain = await session.submit(
    await session.get(secondRunHref),
    { contains: '/finalize' },
    {},
  );
  if (finalizedAgain.status !== 303) {
    fail(nineteen, `the second run did not finalize: ${fieldErrors(finalizedAgain.html)}`);
  }
  const preview = await session.submitGet(
    await session.get(`${findingHref}/retest`),
    { contains: '/retest', hasField: 'focusMetric' },
    {
      baseRunId: idIn(firstRunHref, 'run'),
      laterRunId: idIn(secondRunHref, 'run'),
      focusMetric: 'mention_rate',
    },
  );
  if (!preview.html.includes('Record this comparison')) {
    fail(
      nineteen,
      `the preview page did not offer the comparison: ${preview.html.includes('Two finalized runs') ? 'it asked for two finalized runs' : fieldErrors(preview.html)}`,
    );
  }
  const recordedComparison = await session.submit(preview, { contains: '/retest/record' }, {});
  requireAccepted(nineteen, recordedComparison, 'Focus metric');
  const findingWithComparison = await session.get(findingHref);
  const expectedStatus = outcomeStatusFromFinding(findingWithComparison.html);
  const transitionForm: FormSelector = { contains: '/transition', hasField: 'comparisonId' };
  const citedComparisonId = firstChoice(findingWithComparison.html, transitionForm, 'comparisonId');
  const cited = await session.submit(findingWithComparison, transitionForm, {
    status: expectedStatus,
    note: 'Recorded from the comparison shown above.',
    comparisonId: citedComparisonId,
  });
  requireAccepted(nineteen, cited, 'Cited comparison');
  const afterCitation = await session.get(findingHref);
  if (!afterCitation.html.includes('Cited comparison')) {
    fail(nineteen, 'the history row does not show which comparison justified the status');
  }
  // §4.1: a status transition must be bound to a comparison that actually carries that outcome, so
  // this posts the pair the page would never have offered together and checks nothing changed.
  const wrongOutcome = expectedStatus === 'IMPROVED' ? 'REGRESSED' : 'IMPROVED';
  await requireRefused(
    nineteen,
    session,
    `${findingHref}/transition`,
    session.token(findingWithComparison, transitionForm),
    {
      status: wrongOutcome,
      note: 'Fabricated during verification: this outcome is not what the cited comparison measured.',
      comparisonId: citedComparisonId,
    },
    async () => {
      const reloaded = await session.get(findingHref);
      return outcomeStatusFromFinding(reloaded.html) === expectedStatus;
    },
  );
  pass(
    nineteen,
    `later run ${idIn(secondRunHref, 'run')} captured and finalized; the preview recomputed the deltas from stored runs; ${expectedStatus} recorded citing ${idIn(citedComparisonId, 'rtc')}; a fabricated ${wrongOutcome} transition citing the same comparison was refused and the outcome is unchanged`,
  );

  // 20. A second report.
  const twenty = named('20', 'generate a second report');
  const reportsAgain = await session.get(`/projects/${projectId}/reports`);
  const secondReport = await session.submit(
    reportsAgain,
    { contains: '/reports', hasField: 'title' },
    {
      title: 'Second workflow report',
    },
  );
  const secondReportHref = /\/projects\/[^"?#]*\/reports\/rep_[A-Za-z0-9-]+/.exec(
    secondReport.location,
  )?.[0];
  if (secondReportHref === undefined) {
    fail(twenty, `the second report is not reachable (${secondReport.location})`);
  }
  const renderedSecond = await session.get(secondReportHref);
  if (!renderedSecond.html.includes('wrong founding year')) {
    fail(twenty, 'the second report does not carry the tracked finding and its comparison');
  }
  // Supersession is shown on the snapshot that was replaced, which is the point: an old report is
  // marked as superseded rather than rewritten.
  const firstAgain = await session.get(reportHref);
  if (!/has been superseded by report/.test(firstAgain.html)) {
    fail(
      twenty,
      'the earlier report does not say it was superseded, so snapshots are not being replaced honestly',
    );
  }
  const reportsList = await session.get(`/projects/${projectId}/reports`);
  const badges = (reportsList.html.match(/Superseded/g) ?? []).length;
  const currentBadges = (reportsList.html.match(/Current/g) ?? []).length;
  if (badges < 1 || currentBadges < 1) {
    fail(
      twenty,
      `the reports list shows ${String(badges)} superseded and ${String(currentBadges)} current badges, which is not one of each`,
    );
  }
  pass(
    twenty,
    `report ${idIn(secondReportHref, 'rep')} generated beside the first; the list marks exactly one current and one superseded, and the older snapshot still renders its own frozen figures with a pointer forward`,
  );

  // 21. Exports.
  const twentyone = named('21', 'export the project and the reports');
  const projectExport = await session.get(`/projects/${projectId}/export.json`);
  if (projectExport.status !== 200) {
    fail(twentyone, `the project export returned ${String(projectExport.status)}`);
  }
  const exported = JSON.parse(projectExport.html) as Record<string, unknown>;
  const missingSections = ['project', 'claims', 'runs', 'findings', 'reports'].filter(
    (section) => exported[section] === undefined,
  );
  if (missingSections.length > 0) {
    fail(twentyone, `the project export has no ${missingSections.join(', ')} section`);
  }
  const exportedFindings = (exported['findings'] ?? []) as Array<Record<string, unknown>>;
  const carriedComparison = exportedFindings.some(
    (entry) => Array.isArray(entry['comparisons']) && entry['comparisons'].length > 0,
  );
  if (!carriedComparison) {
    fail(
      twentyone,
      'the project export carries no retest comparison, so the portable record cannot explain a measured status',
    );
  }
  const reportHrefs = [reportHref, secondReportHref];
  for (const href of reportHrefs) {
    const reportId = idIn(href, 'rep');
    for (const suffix of ['/export.json', '/metrics.csv', '/findings.csv', '/observations.csv']) {
      const file = await session.get(`/projects/${projectId}/reports/${reportId}${suffix}`);
      if (file.status !== 200) {
        fail(twentyone, `${suffix} for ${reportId} returned ${String(file.status)}`);
      }
      if (suffix === '/metrics.csv' && !file.html.includes('answer_statement_fidelity_rate')) {
        fail(twentyone, `the metrics export for ${reportId} carries no claim-level row`);
      }
    }
  }
  pass(
    twentyone,
    'project JSON exports with its sections, and each report offers JSON plus metrics, findings and observations CSVs',
  );

  return {
    projectId,
    claimHref,
    workspacePath,
    firstRunHref,
    secondRunHref,
    reportHrefs,
    findingHref,
  };
}

// ---------------------------------------------------------------------------
// Steps 22–24: back up, verify, restore, restart, and read everything back.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'aporia-workflow-'));
  const port = await freePort();
  let child: ChildProcess | null = null;
  let restoreDir: string | null = null;
  try {
    console.log(`workflow: fresh data directory ${dataDir}`);
    child = await startServer(dataDir, port);
    const workflow = await drive(port, 'pass 1');

    const twentytwo = step(
      'pass 1 22 — back up, verify, and restore into a separate temporary directory',
    );
    const staging = mkdtempSync(join(tmpdir(), 'aporia-workflow-backups-'));
    const backupDir = join(staging, 'workflow-backup');
    restoreDir = mkdtempSync(join(tmpdir(), 'aporia-workflow-restored-'));
    rmSync(restoreDir, { recursive: true, force: true });
    try {
      await stopServer(child);
      child = null;
      const made = await runScript([
        'scripts/backup.ts',
        '--data-dir',
        dataDir,
        '--output',
        backupDir,
      ]);
      if (made.exitCode !== 0) {
        fail(twentytwo, `the backup failed: ${made.stderr.slice(0, 300)}`);
      }
      const created = /Backup created: (.+)/.exec(made.stdout)?.[1]?.trim();
      if (created === undefined || created !== backupDir.replaceAll('\\', '/')) {
        console.log(`        note: the backup reported "${String(created)}"`);
      }
      const verified = await runScript(['scripts/verify-backup.ts', backupDir]);
      if (verified.exitCode !== 0) {
        fail(twentytwo, `verification of the backup failed: ${verified.stderr.slice(0, 300)}`);
      }
      const manifest = JSON.parse(readFileSync(join(backupDir, 'manifest.json'), 'utf8')) as {
        tableCounts?: Record<string, number>;
        schemaVersion?: string;
      };
      const counts = manifest.tableCounts ?? {};
      const absent = [
        'answer_claims',
        'answer_claim_revisions',
        'answer_claim_propositions',
        'answer_claim_citations',
        'retest_comparisons',
        'finding_updates',
      ].filter((table) => counts[table] === undefined || counts[table] === 0);
      if (absent.length > 0) {
        fail(
          twentytwo,
          `the backup manifest records no rows for ${absent.join(', ')}, so the v0.4 tables were not captured`,
        );
      }
      const refused = await runScript(['scripts/restore.ts', backupDir, '--data-dir', dataDir]);
      if (refused.exitCode === 0) {
        fail(
          twentytwo,
          'a restore over a populated data directory succeeded without --replace and --confirm',
        );
      }
      const restored = await runScript(['scripts/restore.ts', backupDir, '--data-dir', restoreDir]);
      if (restored.exitCode !== 0) {
        fail(
          twentytwo,
          `the restore into a fresh directory failed: ${restored.stderr.slice(0, 300)}`,
        );
      }
      pass(
        twentytwo,
        `backed up (schema ${String(manifest.schemaVersion)}, ${String(Object.keys(counts).length)} tables counted, answer claims ${String(counts['answer_claims'])}, comparisons ${String(counts['retest_comparisons'])}), verified, refused a restore over live data without confirmation, and restored into ${restoreDir}`,
      );
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }

    const twentythree = step('pass 1 23 — restart the application using the restored data');
    const port2 = await freePort();
    let child2: ChildProcess | null = null;
    try {
      child2 = await startServer(restoreDir, port2);
      pass(
        twentythree,
        `the server boots on the restored directory and answers /health on port ${String(port2)}`,
      );

      const twentyfour = step(
        'pass 1 24 — inspect the restored statements, reports, findings and comparisons',
      );
      const session = new Session(`http://127.0.0.1:${port2}`);
      const checks: readonly { name: string; path: string; expect: string }[] = [
        {
          name: 'project',
          path: `/projects/${workflow.projectId}`,
          expect: 'V0.4 Workflow Project',
        },
        {
          name: 'claim and propositions',
          path: workflow.claimHref,
          expect: 'created by Ram in 2021',
        },
        {
          name: 'voided statement still readable',
          path: workflow.workspacePath,
          expect: 'Recorded the same sentence twice',
        },
        {
          name: 'first report',
          path: workflow.reportHrefs[0] ?? '',
          expect: 'Statement fidelity rate',
        },
        {
          name: 'second report',
          path: workflow.reportHrefs[1] ?? '',
          expect: 'wrong founding year',
        },
        {
          name: 'finding and its comparison',
          path: workflow.findingHref,
          expect: 'Focus metric',
        },
      ];
      const failedChecks: string[] = [];
      for (const check of checks) {
        const page2 = await session.get(check.path);
        if (page2.status !== 200 || !page2.html.includes(check.expect)) {
          failedChecks.push(
            `${check.name} (${check.path} → ${String(page2.status)}, ${page2.html.includes(check.expect) ? 'present' : `missing "${check.expect}"`})`,
          );
        }
      }
      if (failedChecks.length > 0) {
        fail(twentyfour, `the restored data does not read back: ${failedChecks.join('; ')}`);
      }
      // A restored run must produce exactly the figures the report already froze.
      const reportPage = await session.get(workflow.reportHrefs[1] ?? '');
      if (!reportPage.html.includes('metrics-v4')) {
        fail(
          twentyfour,
          'the restored report no longer states the metrics version it was written under',
        );
      }
      pass(
        twentyfour,
        'the restored project, claim, propositions, voided statement with its reason, both reports, and the finding with its recorded comparison all read back through the running application',
      );
    } finally {
      if (child2 !== null) {
        await stopServer(child2);
      }
    }
  } finally {
    if (child !== null) {
      await stopServer(child);
    }
    rmSync(dataDir, { recursive: true, force: true });
    if (restoreDir !== null) {
      rmSync(restoreDir, { recursive: true, force: true });
    }
  }
}

function summarise(): number {
  const failed = steps.filter((entry) => entry.status === 'failed').length;
  const notRun = steps.filter((entry) => entry.status === 'not-run').length;
  const passed = steps.filter((entry) => entry.status === 'passed').length;
  console.log('');
  console.log(
    `§6 workflow verification: ${String(passed)} passed, ${String(failed)} failed, ${String(notRun)} not run`,
  );
  for (const entry of steps) {
    console.log(`  [${entry.status.toUpperCase()}] ${entry.name}`);
  }
  if (notRun > 0) {
    console.log(
      '  Steps left not-run are unverified, not passed. Fix the driver or the application and run again.',
    );
  }
  return failed === 0 && notRun === 0 ? 0 : 1;
}

main()
  .then(() => {
    process.exitCode = summarise();
  })
  .catch((error: unknown) => {
    console.log(
      `\nworkflow stopped early: ${error instanceof Error ? error.message : String(error)}`,
    );
    summarise();
    process.exitCode = 1;
  });
