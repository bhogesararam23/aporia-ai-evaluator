import type {
  ReportBuildInput,
  ReportObservationInput,
  ReportRunInput,
} from '../../src/reporting/types.ts';

export const PROJECT = {
  id: 'prj_1',
  name: 'Aporia',
  description: 'Evidence-first project.',
  primaryDomain: 'https://aporia.example/',
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-28T10:00:00.000Z',
};

export const TARGET = {
  id: 'ent_1',
  type: 'PROJECT_ARTIFACT',
  canonicalName: 'Aporia',
  alternateNames: [],
  publicUrls: ['https://aporia.example/'],
  identityStatus: 'SELF_DECLARED',
  identityMethod: 'Operator declaration; no independent verification.',
  identityScope: 'Project target only.',
  notes: null,
};

export const REVISION = {
  id: 'rev_1',
  revisionNumber: 1,
  text: 'The repository contains the described feature.',
  sourceUrl: null,
  intendedMeaning: null,
  timeScope: null,
  locale: 'en',
  decompositionVersion: 'manual-decomposition-v1',
  createdAt: '2026-10-02T10:00:00.000Z',
  createdBy: 'Ram',
};

export const SOURCE_A = {
  id: 'src_1',
  title: 'Release archive',
  canonicalUri: 'https://example.com/release',
  publisher: null,
  author: null,
  sourceType: 'PRIMARY_ARTIFACT' as const,
  independence: 'INDEPENDENT' as const,
  retrievedAt: '2026-10-02T10:00:00.000Z',
  publicationDate: '2026-10-01',
  language: 'en',
  notes: null,
};

export const SOURCE_B = {
  ...SOURCE_A,
  id: 'src_2',
  title: 'Independent review',
  sourceType: 'INDEPENDENT_SOURCE' as const,
};

export function evidenceRow(
  id: string,
  source: typeof SOURCE_A | typeof SOURCE_B,
  relation: 'SUPPORTS' | 'CONTRADICTS',
): ReportBuildInput['claims'][number]['propositions'][number]['evidence'][number] {
  return {
    relationship: {
      id: `rel_${id}`,
      relation,
      rationale: `Rationale for ${relation}.`,
      reviewer: 'Ram',
      createdAt: '2026-10-03T10:00:00.000Z',
      supersededBy: null,
      supersededAt: null,
    },
    evidence: {
      id: `evd_${id}`,
      locator: 'README section 1',
      excerpt: `Excerpt for ${id}.`,
      excerptDigest: 'a'.repeat(64),
      extractedAt: '2026-10-03T10:00:00.000Z',
    },
    source,
  };
}

export function claimInput(): ReportBuildInput['claims'][number] {
  return {
    claim: {
      id: 'clm_1',
      status: 'UNDER_REVIEW',
      currentRevisionId: 'rev_1',
      createdAt: '2026-10-02T10:00:00.000Z',
      updatedAt: '2026-10-04T10:00:00.000Z',
    },
    currentRevision: REVISION,
    revisions: [REVISION],
    propositions: [
      {
        id: 'prp_1',
        ordinal: 1,
        text: 'The repository contains feature F.',
        evidenceRequirements: 'Release tag and test log.',
        expectedAnswerCriterion: null,
        ambiguityNotes: null,
        evidence: [
          evidenceRow('1', SOURCE_A, 'SUPPORTS'),
          evidenceRow('2', SOURCE_B, 'CONTRADICTS'),
        ],
        assessments: [
          {
            id: 'pasm_1',
            version: 1,
            label: 'SUPPORTED_WITHIN_SCOPE',
            rationale: 'The release artifact supports the feature.',
            method: 'HUMAN',
            reviewer: 'Ram',
            evidenceSnapshot: ['rel_1'],
            createdAt: '2026-10-04T10:00:00.000Z',
          },
        ],
      },
      {
        id: 'prp_2',
        ordinal: 2,
        text: 'The feature is tested in release 2.0.',
        evidenceRequirements: 'Test log for release 2.0.',
        expectedAnswerCriterion: null,
        ambiguityNotes: null,
        evidence: [],
        assessments: [],
      },
    ],
  };
}

export const QUERY_SET = {
  id: 'qst_1',
  name: 'Core discovery',
  version: 1,
  status: 'APPROVED' as const,
  description: 'Fixed baseline.',
  locale: 'en',
  approvedBy: 'Ram',
  approvedAt: '2026-10-05T10:00:00.000Z',
  queries: [
    {
      id: 'qry_1',
      ordinal: 1,
      text: 'What is Project A?',
      intent: 'IDENTITY' as const,
      locale: null,
      region: null,
      branded: true,
      expectedElements: 'Project A and its creator.',
      inclusionRationale: 'Baseline identity question.',
    },
    {
      id: 'qry_2',
      ordinal: 2,
      text: 'Who created Project A?',
      intent: 'ATTRIBUTION' as const,
      locale: null,
      region: null,
      branded: true,
      expectedElements: 'Ram and the role.',
      inclusionRationale: 'Attribution baseline.',
    },
  ],
};

export function observation(
  id: string,
  queryId: string,
  overrides: Partial<ReportObservationInput> = {},
): ReportObservationInput {
  return {
    id,
    queryId,
    queryOrdinal: queryId === 'qry_1' ? 1 : 2,
    queryTextSnapshot: queryId === 'qry_1' ? 'What is Project A?' : 'Who created Project A?',
    queryIntentSnapshot: queryId === 'qry_1' ? 'IDENTITY' : 'ATTRIBUTION',
    status: 'COMPLETED',
    capturedAt: '2026-10-06T10:00:00.000Z',
    answerText: 'Project A was created by Ram.',
    errorNote: null,
    citationCapture: 'CAPTURED',
    contextNotes: null,
    voidedAt: null,
    voidReason: null,
    citations: [
      {
        id: `cit_${id}`,
        position: 1,
        url: 'https://example.com/project-a',
        title: 'Project A',
        snippet: null,
        targetOwned: true,
        voidedAt: null,
        voidReason: null,
      },
    ],
    assessments: [
      {
        id: `oasm_${id}_p`,
        dimension: 'PRESENCE',
        version: 1,
        label: 'MENTIONED',
        rationale: 'The answer names Project A.',
        reviewer: 'Ram',
        attributionRole: null,
        createdAt: '2026-10-07T10:00:00.000Z',
      },
      {
        id: `oasm_${id}_f`,
        dimension: 'FIDELITY',
        version: 1,
        label: 'ACCURATE',
        rationale: 'The answer matches the evidence.',
        reviewer: 'Ram',
        attributionRole: null,
        createdAt: '2026-10-07T10:00:00.000Z',
      },
      {
        id: `oasm_${id}_c`,
        dimension: 'CITATION_SUPPORT',
        version: 1,
        label: 'SUPPORTED',
        rationale: 'The citation supports the claim.',
        reviewer: 'Ram',
        attributionRole: null,
        createdAt: '2026-10-07T10:00:00.000Z',
      },
      {
        id: `oasm_${id}_a`,
        dimension: 'ATTRIBUTION',
        version: 1,
        label: 'CORRECT',
        rationale: 'Names Ram as creator.',
        reviewer: 'Ram',
        attributionRole: 'AUTHOR',
        createdAt: '2026-10-07T10:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

export function runInput(
  id: string,
  status: 'FINALIZED' | 'OPEN' = 'FINALIZED',
  createdAt = '2026-10-06T10:00:00.000Z',
): ReportRunInput {
  return {
    run: {
      id,
      querySetId: 'qst_1',
      name: `Run ${id}`,
      status,
      providerLabel: 'Example assistant',
      modelLabel: 'unknown-model',
      interfaceLabel: 'Consumer web interface',
      groundingMode: 'SEARCH_GROUNDED',
      locale: 'en',
      region: null,
      captureFrom: '2026-10-06T09:00:00.000Z',
      captureTo: '2026-10-06T11:00:00.000Z',
      conditions: 'Manual capture.',
      notes: null,
      createdBy: 'Ram',
      createdAt,
      finalizedAt: status === 'FINALIZED' ? '2026-10-06T12:00:00.000Z' : null,
      cancelledAt: null,
      cancelReason: null,
    },
    observations: [observation('obs_1', 'qry_1'), observation('obs_2', 'qry_2')],
  };
}

export function baseInput(): ReportBuildInput {
  return {
    reportNumber: 1,
    title: 'Aporia evaluation report',
    generatedAt: '2026-10-28T12:00:00.000Z',
    project: PROJECT,
    targetEntity: TARGET,
    entities: [TARGET],
    claims: [claimInput()],
    querySets: [QUERY_SET],
    runs: [runInput('run_1')],
    websiteAudits: [
      {
        id: 'wsa_1',
        label: 'Homepage snapshot',
        inputMethod: 'PASTED',
        inputFilename: null,
        contentHash: 'b'.repeat(64),
        byteLength: 128,
        auditedAt: '2026-10-08T10:00:00.000Z',
        methodologyVersion: 'local-html-audit-v1',
        findings: [
          {
            code: 'meta_robots_noindex',
            severity: 'BLOCKING',
            category: 'INDEXABILITY',
            title: 'The document declares noindex',
            observation: 'meta robots includes noindex.',
            rationale: 'Compliant crawlers should not index the page.',
            recommendation: 'Remove noindex if public discovery is intended.',
            locator: 'head > meta[name="robots"]',
          },
        ],
        unavailableChecks: [
          {
            code: 'HTTP_REACHABILITY',
            label: 'Page reachability and HTTP status',
            reason: 'Network access is disabled in local v0.1; this check was not performed.',
          },
        ],
        metadata: { title: 'Project A' },
      },
    ],
    audit: { eventCount: 12, lastEventAt: '2026-10-28T11:00:00.000Z' },
  };
}
