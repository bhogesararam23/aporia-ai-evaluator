import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { analyzeHtml } from '../../src/website/analyze.ts';
import {
  addProposition,
  createClaim,
  transitionClaim,
} from '../../src/persistence/repositories/claims.ts';
import {
  createSource,
  recordEvidence,
  recordPropositionAssessment,
} from '../../src/persistence/repositories/evidence.ts';
import { createEntity, createProject } from '../../src/persistence/repositories/projects.ts';
import {
  addQuery,
  approveQuerySet,
  createQuerySet,
} from '../../src/persistence/repositories/querySets.ts';
import {
  addObservation,
  createRun,
  finalizeRun,
  recordObservationAssessment,
} from '../../src/persistence/repositories/runs.ts';
import { createWebsiteAudit } from '../../src/persistence/repositories/websiteAudits.ts';
import { generateReport } from '../../src/app/reportingService.ts';
import { cookieFrom, getPage, startTestServer } from '../helpers/http.ts';

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;

function elements(root: Node): Element[] {
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

function attrs(element: Element): Map<string, string> {
  return new Map(element.attrs.map((attr) => [attr.name.toLowerCase(), attr.value]));
}

function accessibilityViolations(html: string): string[] {
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
  if (h1s.length !== 1) violations.push(`expected exactly one h1, found ${h1s.length}`);
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
  return violations;
}

test('all workflow pages are labelled, script-free, and structurally accessible', async () => {
  const server = await startTestServer();
  try {
    const context = { actor: 'Ram', at: '2026-10-28T12:00:00.000Z' };
    const project = createProject(
      server.db,
      {
        name: 'Accessibility project',
        description: 'A real test project.',
        primaryDomain: 'https://example.com/',
        targetEntity: { name: 'Aporia', type: 'PROJECT_ARTIFACT' },
      },
      context,
    );
    const entity = createEntity(
      server.db,
      project.project.id,
      {
        type: 'PERSON',
        canonicalName: 'Ram',
        alternateNames: [],
        publicUrls: [],
        identityStatus: 'UNVERIFIED',
        identityMethod: undefined,
        identityScope: undefined,
        notes: undefined,
      },
      context,
    );
    const claim = createClaim(
      server.db,
      project.project.id,
      {
        text: 'The artifact contains feature F.',
        sourceUrl: undefined,
        intendedMeaning: undefined,
        timeScope: undefined,
        locale: 'en',
      },
      context,
    );
    const proposition = addProposition(
      server.db,
      project.project.id,
      claim.claim.id,
      {
        text: 'The artifact contains feature F.',
        subject: undefined,
        predicate: undefined,
        objectValue: undefined,
        conditions: undefined,
        timeInterval: undefined,
        units: undefined,
        evidenceRequirements: 'A primary artifact.',
        expectedAnswerCriterion: undefined,
        ambiguityNotes: undefined,
      },
      context,
    );
    transitionClaim(server.db, project.project.id, claim.claim.id, 'UNDER_REVIEW', context);
    const source = createSource(
      server.db,
      project.project.id,
      {
        title: 'Primary artifact',
        canonicalUri: 'https://example.com/artifact',
        publisher: undefined,
        author: undefined,
        sourceType: 'PRIMARY_ARTIFACT',
        accessRoute: 'MANUAL_ENTRY',
        retrievedAt: '2026-10-28T12:00:00.000Z',
        publicationDate: undefined,
        language: 'en',
        independence: 'INDEPENDENT',
        notes: undefined,
      },
      context,
    );
    recordEvidence(
      server.db,
      project.project.id,
      source.id,
      proposition.id,
      {
        locator: 'README',
        excerpt: 'Feature F exists.',
        extractionMethod: 'PASTED_TEXT',
        extractedAt: '2026-10-28T12:00:00.000Z',
        relation: 'SUPPORTS',
        rationale: 'The artifact states it.',
        reviewer: 'Ram',
      },
      context,
    );
    recordPropositionAssessment(
      server.db,
      project.project.id,
      proposition.id,
      { label: 'SUPPORTED_WITHIN_SCOPE', rationale: 'Supported by the artifact.', reviewer: 'Ram' },
      context,
    );
    const querySet = createQuerySet(
      server.db,
      project.project.id,
      { name: 'Core', description: undefined, locale: 'en' },
      context,
    );
    const query = addQuery(
      server.db,
      project.project.id,
      querySet.set.id,
      {
        text: 'What is the artifact?',
        intent: 'DESCRIPTION',
        locale: undefined,
        region: undefined,
        branded: true,
        expectedElements: 'The artifact.',
        inclusionRationale: 'Baseline.',
      },
      context,
    );
    approveQuerySet(
      server.db,
      project.project.id,
      querySet.set.id,
      { reviewer: 'Ram', note: undefined },
      context,
    );
    const run = createRun(
      server.db,
      project.project.id,
      querySet.set.id,
      {
        name: 'Manual run',
        providerLabel: 'Example assistant',
        modelLabel: undefined,
        interfaceLabel: 'Consumer interface',
        groundingMode: 'UNKNOWN',
        locale: 'en',
        region: undefined,
        captureFrom: '2026-10-28T10:00:00.000Z',
        captureTo: '2026-10-28T11:00:00.000Z',
        conditions: 'Manual capture.',
        notes: undefined,
      },
      context,
    );
    const observation = addObservation(
      server.db,
      project.project.id,
      run.run.id,
      {
        queryId: query.id,
        status: 'COMPLETED',
        capturedAt: '2026-10-28T10:30:00.000Z',
        answerText: 'The artifact exists.',
        errorNote: undefined,
        citationCapture: 'NOT_SHOWN',
        contextNotes: undefined,
      },
      context,
    );
    recordObservationAssessment(
      server.db,
      project.project.id,
      run.run.id,
      observation.id,
      {
        dimension: 'PRESENCE',
        label: 'MENTIONED',
        rationale: 'Named.',
        reviewer: 'Ram',
        attributionRole: undefined,
      },
      context,
    );
    finalizeRun(server.db, project.project.id, run.run.id, context);
    const analysis = analyzeHtml(
      '<html lang="en"><head><title>Artifact</title></head><body><h1>Artifact</h1></body></html>',
    );
    const audit = createWebsiteAudit(
      server.db,
      project.project.id,
      {
        label: 'Artifact page',
        inputMethod: 'PASTED',
        inputFilename: null,
        contentHash: analysis.contentHash,
        byteLength: analysis.byteLength,
        htmlSnapshot:
          '<html lang="en"><head><title>Artifact</title></head><body><h1>Artifact</h1></body></html>',
        auditedAt: context.at,
        methodologyVersion: analysis.version,
        findings: analysis.findings,
        unavailableChecks: analysis.unavailableChecks,
        metadata: analysis.metadata as unknown as Record<string, unknown>,
      },
      context,
    );
    const generated = generateReport(
      server.db,
      project.project.id,
      'Accessibility report',
      context,
    );

    const form = await getPage(server, '/projects/new');
    const cookie = cookieFrom(form.response);
    const pages = [
      '/',
      '/projects/new',
      `/projects/${project.project.id}`,
      `/projects/${project.project.id}/entities`,
      `/projects/${project.project.id}/entities/${entity.id}/edit`,
      `/projects/${project.project.id}/claims`,
      `/projects/${project.project.id}/claims/new`,
      `/projects/${project.project.id}/claims/${claim.claim.id}`,
      `/projects/${project.project.id}/sources`,
      `/projects/${project.project.id}/sources/new`,
      `/projects/${project.project.id}/query-sets`,
      `/projects/${project.project.id}/query-sets/new`,
      `/projects/${project.project.id}/query-sets/${querySet.set.id}`,
      `/projects/${project.project.id}/runs`,
      `/projects/${project.project.id}/runs/new`,
      `/projects/${project.project.id}/runs/${run.run.id}`,
      `/projects/${project.project.id}/audits`,
      `/projects/${project.project.id}/audits/new`,
      `/projects/${project.project.id}/audits/${audit.id}`,
      `/projects/${project.project.id}/reports`,
      `/projects/${project.project.id}/reports/${generated.report.id}`,
      `/projects/${project.project.id}/activity`,
      `/projects/${project.project.id}/delete`,
    ];
    const failures: string[] = [];
    for (const path of pages) {
      const page = await getPage(server, path, cookie);
      assert.equal(page.response.status, 200, path);
      const violations = accessibilityViolations(page.text);
      if (violations.length > 0) failures.push(`${path}: ${violations.join('; ')}`);
    }
    assert.deepEqual(failures, []);
  } finally {
    await server.close();
  }
});
