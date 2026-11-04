/**
 * Shared benchmark-case fixtures for the review-workflow tests.
 *
 * Every review test needs a real, validating `benchmark-case-v2` object with one proposition and one
 * statement, so it can be labelled, merged, adjudicated, audited and released. Duplicating that shape across
 * a dozen files is how one file ends up asserting a rule the others quietly violate, so it lives here.
 *
 * These are synthetic fixtures, never corpus material: no claim here was captured from a real system and no
 * label was produced by a real reviewer. A test that needs a reviewer, a timestamp or a rationale supplies
 * one explicitly, so nothing looks more verified than it is.
 */
import {
  BENCHMARK_CASE_VERSION,
  BENCHMARK_CASE_VERSION_V1,
  type BenchmarkCase,
  type BenchmarkEvidenceRecord,
  type BenchmarkReviewerLabel,
  type BenchmarkStratum,
} from '../../src/benchmark/types.ts';

export interface FixtureOptions {
  readonly id?: string;
  readonly stratum?: BenchmarkStratum;
  readonly version?: string;
  readonly reviewedBy?: readonly string[];
  readonly authorizedForStorage?: boolean;
  readonly reviewedAt?: string;
  readonly reviewerLabels?: readonly BenchmarkReviewerLabel[];
  readonly answerText?: string | null;
  readonly syndicated?: boolean;
}

/** The evidence fields a v1 case records; v2 adds `sourceId` on top of exactly this. */
const FIRST_EVIDENCE_BASE = {
  id: 'e1',
  relation: 'SUPPORTS',
  sourceType: 'PRIMARY_ARTIFACT',
  independence: 'INDEPENDENT',
  locator: 'section 1',
} as const;

const SYNDICATED_EVIDENCE_BASE = {
  id: 'e2',
  relation: 'SUPPORTS',
  sourceType: 'NEWS_REPORT',
  independence: 'RELATED',
  locator: 'section 1 (syndicated copy)',
} as const;

const firstEvidence: BenchmarkEvidenceRecord = { ...FIRST_EVIDENCE_BASE, sourceId: 's1' };

/** A `RELATED` copy of the same underlying source: two records, one source. */
const syndicatedEvidence: BenchmarkEvidenceRecord = {
  ...SYNDICATED_EVIDENCE_BASE,
  sourceId: 's1',
};

/**
 * Two `RELATED` records over one underlying source, for the duplicate/syndication stratum.
 *
 * The v1 variants omit `sourceId` entirely rather than setting it to `undefined`: under
 * `exactOptionalPropertyTypes` those are different facts, and a v1 file genuinely has no such property.
 */
function evidence(version: string, syndicated: boolean): BenchmarkEvidenceRecord[] {
  if (version === BENCHMARK_CASE_VERSION_V1) {
    const firstV1: BenchmarkEvidenceRecord = FIRST_EVIDENCE_BASE;
    return syndicated ? [firstV1, SYNDICATED_EVIDENCE_BASE] : [firstV1];
  }
  return syndicated ? [firstEvidence, syndicatedEvidence] : [firstEvidence];
}

/** A minimal case that satisfies the v2 validator: one proposition, one statement, one citation slot. */
export function fixtureCase(options: FixtureOptions = {}): BenchmarkCase {
  const version = options.version ?? BENCHMARK_CASE_VERSION;
  const propositionIds = ['p1'];
  const statementIds = ['st1'];
  return {
    version,
    id: options.id ?? 'case-fixture',
    stratum: options.stratum ?? 'REFUSAL_NOT_A_DENIAL',
    title: 'A refusal that is not a factual denial',
    provenance: {
      origin: 'Synthetic test fixture; no real capture.',
      authorizedForStorage: options.authorizedForStorage ?? true,
      reviewedBy: options.reviewedBy ?? ['dana'],
      reviewedAt: options.reviewedAt ?? '2026-11-05',
      unverified: ['fixture only — establishes no behaviour of any real system'],
      limitation: 'Synthetic fixture. Not evidence about any provider or model.',
    },
    input: {
      claimText: 'The tool announced version 2 on the stated date.',
      propositions: [
        {
          id: propositionIds[0] as string,
          text: 'The announcement was made on the stated date.',
          evidence: evidence(version, options.syndicated === true),
        },
      ],
      answerText: options.answerText ?? 'I cannot confirm that announcement.',
      citationCapture: 'NOT_SHOWN',
      // A v2 case with statements must record the citations the reviewer read, even when none were shown.
      citations: [
        {
          id: 'c1',
          url: 'https://example.invalid/announcement',
          supportsStatement: false,
          note: 'Fixture URL; never fetched.',
        },
      ],
      statements: [
        {
          id: statementIds[0] as string,
          text: 'I cannot confirm that announcement.',
          relevance: 'REFUSAL',
          propositionIds,
          citationIds: [],
        },
      ],
      providerLabel: 'Synthetic Fixture',
      locale: 'en',
    },
    expected: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        rationale: 'The single recorded primary artifact states it.',
        subjectId: 'p1',
      },
      {
        dimension: 'ANSWER_FIDELITY',
        label: 'NOT_ASSESSABLE',
        rationale: 'A refusal asserts nothing to compare against the proposition.',
        subjectId: 'st1',
      },
      {
        dimension: 'CITATION_SUPPORT',
        label: 'NOT_ASSESSABLE',
        rationale: 'The answer cited nothing, so there is no citation to judge.',
        subjectId: 'st1',
      },
      {
        dimension: 'ATTRIBUTION',
        label: 'NOT_ASSESSABLE',
        rationale: 'A refusal attributes nothing, so there is no attribution to check.',
        subjectId: 'st1',
      },
    ],
    reviewerLabels: options.reviewerLabels ?? [],
    adjudications: [],
    limitations: ['Synthetic fixture only.'],
  };
}

/** One reviewer label for a subject, with the v0.7 provenance fields left unset unless supplied. */
export function labelFor(
  reviewer: string,
  dimension: BenchmarkReviewerLabel['dimension'],
  subjectId: string,
  value: string,
  provenance: Partial<BenchmarkReviewerLabel> = {},
): BenchmarkReviewerLabel {
  return { reviewer, dimension, label: value, subjectId, note: null, ...provenance };
}

/** The four subjects the fixture exposes, in packet order. */
export const FIXTURE_SUBJECTS = [
  { dimension: 'EVIDENCE_SUPPORT', subjectId: 'p1' },
  { dimension: 'ANSWER_FIDELITY', subjectId: 'st1' },
  { dimension: 'CITATION_SUPPORT', subjectId: 'st1' },
  { dimension: 'ATTRIBUTION', subjectId: 'st1' },
] as const;
