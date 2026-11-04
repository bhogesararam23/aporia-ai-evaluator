/**
 * Local benchmark case-authoring, normalisation and provenance workflows (ADR-020).
 *
 * These functions exist so a reviewer can prepare, canonicalise and inspect real cases locally
 * without a network and without the harness ever inventing content. The governing honesty rule is
 * that the tool must not be able to fabricate a scoreable case: a scaffold carries a distinct
 * template version and no gold labels, so `validate.ts` refuses it and it cannot enter a scored
 * corpus; provenance is reported as the operator's own assertion, never as verified independence.
 *
 * Pure and dependency-free, like the rest of `src/benchmark`: nothing here reads the application
 * database or reaches the network.
 */
import type { BenchmarkCase, BenchmarkStratum } from './types.ts';
import { disagreementPairs, validateBenchmarkCase } from './validate.ts';

/** A scaffold is not a case version; the validator refuses it, which is the point. */
export const TEMPLATE_VERSION = 'benchmark-case-template';

/** A skeleton for one stratum: structure only, no gold labels, no reviewer, not authorised. */
export function scaffoldTemplate(stratum: BenchmarkStratum): BenchmarkCase {
  return {
    version: TEMPLATE_VERSION,
    id: 'REPLACE-with-a-stable-case-id',
    stratum,
    title: 'REVIEWER: a one-line summary of what this case tests',
    provenance: {
      origin: 'REVIEWER: where this material came from (a real capture, not invented)',
      authorizedForStorage: false,
      reviewedBy: [],
      reviewedAt: '',
      unverified: [],
      limitation: 'REVIEWER: what this case cannot establish.',
    },
    input: {
      claimText: '',
      propositions: [{ id: 'p1', text: '', evidence: [] }],
      answerText: null,
      citationCapture: 'UNKNOWN',
      citations: [],
      statements: [],
      providerLabel: '',
      locale: 'en',
    },
    // Deliberately empty: the reviewer supplies the gold labels from material they actually reviewed.
    expected: [],
    reviewerLabels: [],
    adjudications: [],
    limitations: [],
  };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, inner]) => [key, sortKeys(inner)]);
    return Object.fromEntries(entries);
  }
  return value;
}

/**
 * Canonical, deterministic serialisation of one case: keys sorted at every level, no `undefined`
 * keys, two-space indent, trailing newline. Normalising before storing makes a corpus diffable and
 * makes "the same case twice" produce identical bytes, which is what an import/export round-trip needs.
 */
export function normaliseCase(benchmarkCase: BenchmarkCase): string {
  return `${JSON.stringify(sortKeys(benchmarkCase), null, 2)}\n`;
}

export interface CaseProvenanceSummary {
  readonly id: string;
  readonly reviewers: readonly string[];
  readonly reviewerLabelCount: number;
  readonly disagreements: number;
  readonly adjudicatedDisagreements: number;
  readonly unresolvedDisagreements: number;
  readonly adjudicationCount: number;
  readonly unverified: readonly string[];
  readonly authorizedForStorage: boolean;
  readonly reviewedAt: string;
  readonly canEnterScoredCorpus: boolean;
  readonly reviewerIdentityNote: string;
}

/**
 * What a human claimed about this case, reported without upgrading a claim into a fact.
 *
 * Disagreement is counted, never averaged: a split becomes "adjudicated" only when a scoped
 * adjudication names the same dimension and subject, exactly as the scorer treats it. `canEnterScored
 * Corpus` runs the real validator, so a scaffold or a half-filled case is reported as unable to score.
 */
export function caseProvenanceSummary(benchmarkCase: BenchmarkCase): CaseProvenanceSummary {
  const reviewers = [...new Set(benchmarkCase.provenance.reviewedBy)].sort();
  const disagreements = disagreementPairs(benchmarkCase);
  const adjudicationKeys = new Set(
    (benchmarkCase.adjudications ?? []).map(
      (adjudication) => `${adjudication.dimension}/${adjudication.subjectId}`,
    ),
  );
  const adjudicated = disagreements.filter((disagreement) =>
    adjudicationKeys.has(`${disagreement.dimension}/${disagreement.subjectId}`),
  ).length;
  return {
    id: benchmarkCase.id,
    reviewers,
    reviewerLabelCount: (benchmarkCase.reviewerLabels ?? []).length,
    disagreements: disagreements.length,
    adjudicatedDisagreements: adjudicated,
    unresolvedDisagreements: disagreements.length - adjudicated,
    adjudicationCount: (benchmarkCase.adjudications ?? []).length,
    unverified: benchmarkCase.provenance.unverified,
    authorizedForStorage: benchmarkCase.provenance.authorizedForStorage === true,
    reviewedAt: benchmarkCase.provenance.reviewedAt,
    canEnterScoredCorpus: validateBenchmarkCase(benchmarkCase, 0).length === 0,
    reviewerIdentityNote:
      'Reviewer identifiers are operator-asserted; local core has no authentication, so agreement between labels is not proof of independent review.',
  };
}
