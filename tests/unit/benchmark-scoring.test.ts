import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agreementRows,
  annotationSummaries,
  regressionRows,
  scoreByDimension,
  scoreDimension,
  type ScoredPair,
} from '../../src/benchmark/scoring.ts';
import {
  HUMAN_JUDGEMENT_DIMENSIONS,
  produceDeterministicLabels,
  regressionResults,
} from '../../src/benchmark/regression.ts';
import { BENCHMARK_DIMENSIONS, type BenchmarkCase } from '../../src/benchmark/types.ts';

function pair(
  expected: string,
  predicted: string,
  dimension: BenchmarkCase['expected'][number]['dimension'] = 'EVIDENCE_SUPPORT',
  subjectId = 'prop-1',
): ScoredPair {
  return {
    caseId: 'case-1',
    dimension,
    subjectId,
    expected,
    predicted,
    component: 'evidence-aggregation-v1',
  };
}

test('accuracy counts exact matches and reports the scored pair count', () => {
  const score = scoreDimension([
    pair('SUPPORTED_WITHIN_SCOPE', 'SUPPORTED_WITHIN_SCOPE'),
    pair('SUPPORTED_WITHIN_SCOPE', 'CONTRADICTED'),
    pair('CONTRADICTED', 'CONTRADICTED'),
    pair('INSUFFICIENT_EVIDENCE', 'INSUFFICIENT_EVIDENCE'),
  ]);
  assert.equal(score.scored, 4);
  assert.equal(score.correct, 3);
  assert.equal(score.accuracy, 0.75);
});

test('an empty dimension produces null, never zero', () => {
  const score = scoreDimension([]);
  assert.equal(score.accuracy, null);
  assert.equal(score.macroF1, null);
  assert.match(score.macroF1Reason ?? '', /No scored pair/);
});

test('per-label precision excludes predictions that never appeared', () => {
  const score = scoreDimension([
    pair('SUPPORTED_WITHIN_SCOPE', 'SUPPORTED_WITHIN_SCOPE'),
    pair('CONTRADICTED', 'SUPPORTED_WITHIN_SCOPE'),
    pair('CONTRADICTED', 'CONTRADICTED'),
  ]);
  const byLabel = new Map(score.labels.map((row) => [row.label, row]));
  const supported = byLabel.get('SUPPORTED_WITHIN_SCOPE');
  assert.equal(supported?.support, 1);
  assert.equal(supported?.predicted, 2);
  assert.equal(supported?.truePositive, 1);
  assert.equal(supported?.precision, 0.5);
  assert.equal(supported?.recall, 1);
  const contradicted = byLabel.get('CONTRADICTED');
  assert.equal(contradicted?.precision, 1);
  assert.equal(contradicted?.recall, 0.5);
});

test('a label never produced and never expected is absent, and one produced in error scores zero', () => {
  const score = scoreDimension([
    pair('SUPPORTED_WITHIN_SCOPE', 'SUPPORTED_WITHIN_SCOPE'),
    pair('SUPPORTED_WITHIN_SCOPE', 'UNAVAILABLE'),
  ]);
  const unavailable = score.labels.find((row) => row.label === 'UNAVAILABLE');
  // Predicted once with no gold example: that is a false positive, so precision really is 0.
  assert.equal(unavailable?.support, 0);
  assert.equal(unavailable?.predicted, 1);
  assert.equal(unavailable?.precision, 0);
  // Recall over an empty class is undefined, not zero: there was nothing to find.
  assert.equal(unavailable?.recall, null);
  assert.equal(unavailable?.f1, null);
});

test('a class never predicted has null precision but a real recall of zero', () => {
  const score = scoreDimension([
    pair('CONTRADICTED', 'SUPPORTED_WITHIN_SCOPE'),
    pair('SUPPORTED_WITHIN_SCOPE', 'SUPPORTED_WITHIN_SCOPE'),
  ]);
  const contradicted = score.labels.find((row) => row.label === 'CONTRADICTED');
  assert.equal(contradicted?.support, 1);
  assert.equal(contradicted?.predicted, 0);
  assert.equal(contradicted?.precision, null);
  assert.equal(contradicted?.recall, 0);
});

test('macro-F1 is withheld when a class has no gold example', () => {
  const score = scoreDimension([
    pair('SUPPORTED_WITHIN_SCOPE', 'SUPPORTED_WITHIN_SCOPE'),
    pair('SUPPORTED_WITHIN_SCOPE', 'UNAVAILABLE'),
  ]);
  assert.equal(score.macroF1, null);
  assert.match(score.macroF1Reason ?? '', /no gold example/);
});

test('macro-F1 is withheld when only one label exists at all', () => {
  const score = scoreDimension([
    pair('SUPPORTED_WITHIN_SCOPE', 'SUPPORTED_WITHIN_SCOPE'),
    pair('SUPPORTED_WITHIN_SCOPE', 'SUPPORTED_WITHIN_SCOPE'),
  ]);
  assert.equal(score.macroF1, null);
  assert.match(score.macroF1Reason ?? '', /Only one label/);
});

test('macro-F1 is computed when every class has support', () => {
  const score = scoreDimension([
    pair('SUPPORTED_WITHIN_SCOPE', 'SUPPORTED_WITHIN_SCOPE'),
    pair('SUPPORTED_WITHIN_SCOPE', 'CONTRADICTED'),
    pair('CONTRADICTED', 'CONTRADICTED'),
    pair('CONTRADICTED', 'SUPPORTED_WITHIN_SCOPE'),
  ]);
  assert.notEqual(score.macroF1, null);
  assert.equal(score.macroF1 as number, 0.5);
});

test('a confusion matrix appears only with two labels on each axis', () => {
  const suppressed = scoreDimension([
    pair('SUPPORTED_WITHIN_SCOPE', 'SUPPORTED_WITHIN_SCOPE'),
    pair('SUPPORTED_WITHIN_SCOPE', 'SUPPORTED_WITHIN_SCOPE'),
  ]);
  assert.deepEqual(suppressed.confusion, []);
  assert.match(suppressed.confusionSuppressedReason ?? '', /at least two labels/);

  const shown = scoreDimension([
    pair('SUPPORTED_WITHIN_SCOPE', 'CONTRADICTED'),
    pair('CONTRADICTED', 'SUPPORTED_WITHIN_SCOPE'),
    pair('CONTRADICTED', 'CONTRADICTED'),
  ]);
  assert.equal(shown.confusion.length, 3);
  assert.equal(
    shown.confusion.find(
      (cell) => cell.actual === 'SUPPORTED_WITHIN_SCOPE' && cell.predicted === 'CONTRADICTED',
    )?.count,
    1,
  );
});

test('a tiny dimension says so in its notes', () => {
  const score = scoreDimension([pair('A', 'A')]);
  assert.match(score.notes.join(' '), /Only 1 pair/);
  assert.match(score.notes.join(' '), /rare but costly failure/);
});

test('dimensions are scored separately and never merged into one benchmark score', () => {
  const scores = scoreByDimension(
    [
      pair('SUPPORTED_WITHIN_SCOPE', 'SUPPORTED_WITHIN_SCOPE'),
      pair('CORRECT', 'WRONG_ROLE', 'ATTRIBUTION'),
    ],
    BENCHMARK_DIMENSIONS,
  );
  assert.equal(scores.length, 2);
  assert.deepEqual(
    scores.map((score) => score.dimension),
    ['EVIDENCE_SUPPORT', 'ATTRIBUTION'],
  );
  assert.equal(
    scores.reduce((total, score) => total + score.scored, 0),
    2,
  );
});

function caseWith(input: Partial<BenchmarkCase>): BenchmarkCase {
  return {
    version: 'benchmark-case-v2',
    id: 'case-1',
    stratum: 'SUPPORTED_PRIMARY_EVIDENCE',
    title: 'Fixture',
    provenance: {
      origin: 'Synthetic validator fixture.',
      authorizedForStorage: true,
      reviewedBy: ['reviewer-a', 'reviewer-b', 'a', 'b', 'c'],
      reviewedAt: '2026-11-01',
      unverified: [],
      limitation: 'Fixture only.',
    },
    input: {
      claimText: 'Claim text long enough.',
      propositions: [
        {
          id: 'prop-1',
          text: 'Proposition.',
          evidence: [
            {
              id: 'ev-1',
              relation: 'SUPPORTS',
              // Separate from the relationship id, so two excerpts of one source collapse to one
              // source when the deterministic rule counts corroboration.
              sourceId: 'src-1',
              sourceType: 'PRIMARY_ARTIFACT',
              independence: 'INDEPENDENT',
              locator: 'section 1',
            },
          ],
        },
      ],
      answerText: 'Answer.',
      citationCapture: 'CAPTURED',
      citations: [],
      statements: [],
      providerLabel: 'Fixture',
      locale: 'en',
    },
    expected: [],
    reviewerLabels: [],
    adjudications: [],
    limitations: [],
    ...input,
  } as BenchmarkCase;
}

test('the deterministic rule runs over the frozen input pack', () => {
  const benchmarkCase = caseWith({});
  const produced = produceDeterministicLabels(benchmarkCase);
  assert.equal(produced.get('EVIDENCE_SUPPORT:prop-1'), 'SUPPORTED_WITHIN_SCOPE');
});

test('an added recorded contradiction changes the deterministic result, which is what a regression check sees', () => {
  const benchmarkCase = caseWith({
    input: {
      ...caseWith({}).input,
      propositions: [
        {
          id: 'prop-1',
          text: 'Proposition.',
          evidence: [
            {
              id: 'ev-1',
              relation: 'SUPPORTS',
              sourceType: 'PRIMARY_ARTIFACT',
              independence: 'INDEPENDENT',
              locator: 'section 1',
            },
            {
              id: 'ev-2',
              relation: 'CONTRADICTS',
              sourceType: 'INDEPENDENT_SOURCE',
              independence: 'INDEPENDENT',
              locator: 'section 2',
            },
          ],
        },
      ],
    },
  });
  assert.equal(
    produceDeterministicLabels(benchmarkCase).get('EVIDENCE_SUPPORT:prop-1'),
    'CONFLICTING_EVIDENCE',
  );
});

test('a deliberate mismatch is reported as a regression candidate with its component named', () => {
  const benchmarkCase = caseWith({
    expected: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        label: 'CONTRADICTED',
        rationale: 'Intentionally wrong expectation to exercise the mismatch path.',
        subjectId: 'prop-1',
      },
    ],
  });
  const rows = regressionResults([benchmarkCase]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.matched, false);
  assert.equal(rows[0]?.component, 'evidence-aggregation-v1');
  assert.equal(rows[0]?.produced, 'SUPPORTED_WITHIN_SCOPE');
});

test('human-judgement dimensions never become software regressions', () => {
  // The software makes no fidelity, citation-support, or attribution judgement. A disagreement there
  // is a methodology finding, so it must not appear in the regression section at all.
  const benchmarkCase = caseWith({
    expected: [
      {
        dimension: 'ANSWER_FIDELITY',
        label: 'ACCURATE',
        rationale: 'Reviewer judgement fixture.',
        subjectId: 'stmt-1',
      },
      {
        dimension: 'ATTRIBUTION',
        label: 'CORRECT',
        rationale: 'Reviewer judgement fixture.',
        subjectId: 'stmt-1',
      },
    ],
  });
  assert.deepEqual(regressionResults([benchmarkCase]), []);
  assert.deepEqual(
    [...HUMAN_JUDGEMENT_DIMENSIONS],
    ['ANSWER_FIDELITY', 'CITATION_SUPPORT', 'ATTRIBUTION'],
  );
});

test('a gold label with no produced value is a miss, not a silent skip', () => {
  const benchmarkCase = caseWith({
    expected: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        rationale: 'No such proposition exists in the pack.',
        subjectId: 'prop-missing',
      },
    ],
  });
  const rows = regressionRows([benchmarkCase], produceDeterministicLabels);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.produced, 'NOT_PRODUCED');
  assert.equal(rows[0]?.matched, false);
});

test('a single reviewer is recorded as one opinion, not skipped as agreement', () => {
  const benchmarkCase = caseWith({
    reviewerLabels: [
      {
        reviewer: 'a',
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        subjectId: 'prop-1',
        note: null,
      },
    ],
  });
  const rows = agreementRows([benchmarkCase]);
  // The old rule dropped the row entirely, so a corpus of single opinions reported no disagreement at
  // all. A row now exists and says it cannot support an agreement claim.
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, 'NOT_ENOUGH_REVIEWERS');
  assert.equal(rows[0]?.unanimous, true);
});

test('the same reviewer labelling twice is not two reviewers', () => {
  const rows = agreementRows([
    caseWith({
      reviewerLabels: [
        {
          reviewer: 'a',
          dimension: 'EVIDENCE_SUPPORT',
          label: 'SUPPORTED_WITHIN_SCOPE',
          subjectId: 'prop-1',
          note: null,
        },
        {
          reviewer: 'a',
          dimension: 'EVIDENCE_SUPPORT',
          label: 'CONTRADICTED',
          subjectId: 'prop-1',
          note: null,
        },
      ],
    }),
  ]);
  assert.equal(rows[0]?.status, 'NOT_ENOUGH_REVIEWERS');
  assert.deepEqual(rows[0]?.reviewers, ['a']);
});

test('unanimous reviewers are reported as agreement, with the gold label beside it', () => {
  const benchmarkCase = caseWith({
    expected: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        subjectId: 'prop-1',
        rationale: 'The recorded primary artifact states it.',
      },
    ],
    reviewerLabels: [
      {
        reviewer: 'a',
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        subjectId: 'prop-1',
        note: null,
      },
      {
        reviewer: 'b',
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        subjectId: 'prop-1',
        note: null,
      },
    ],
  });
  const rows = agreementRows([benchmarkCase]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.unanimous, true);
  assert.equal(rows[0]?.status, 'UNANIMOUS');
  assert.equal(rows[0]?.goldLabel, 'SUPPORTED_WITHIN_SCOPE');
});

test('disagreement without adjudication stays UNRESOLVED rather than being averaged', () => {
  const labels = (reviewer: string, label: string) => ({
    reviewer,
    dimension: 'EVIDENCE_SUPPORT' as const,
    label,
    subjectId: 'prop-1',
    note: null,
  });
  const unresolved = agreementRows([
    caseWith({
      reviewerLabels: [labels('a', 'SUPPORTED_WITHIN_SCOPE'), labels('b', 'CONTRADICTED')],
    }),
  ]);
  assert.equal(unresolved[0]?.status, 'UNRESOLVED');
  assert.equal(unresolved[0]?.unanimous, false);

  const ambiguous = agreementRows([
    caseWith({
      reviewerLabels: [labels('a', 'SUPPORTED_WITHIN_SCOPE'), labels('b', 'CONTRADICTED')],
      adjudications: [
        {
          dimension: 'EVIDENCE_SUPPORT',
          subjectId: 'prop-1',
          outcome: 'GENUINELY_AMBIGUOUS',
          label: null,
          reason: 'The recorded locator is too coarse to decide.',
          adjudicatedBy: 'c',
        },
      ],
    }),
  ]);
  assert.equal(ambiguous[0]?.status, 'GENUINELY_AMBIGUOUS');
  assert.equal(ambiguous[0]?.adjudicatedLabel, null);
});

test('a scoped resolved adjudication supplies the settled label, and only for its own subject', () => {
  const labels = (reviewer: string, subjectId: string, a: string, b: string) => [
    { reviewer, dimension: 'EVIDENCE_SUPPORT' as const, label: a, subjectId, note: null },
    {
      reviewer: reviewer === 'a' ? 'b' : 'a',
      dimension: 'EVIDENCE_SUPPORT' as const,
      label: b,
      subjectId,
      note: null,
    },
  ];
  const rows = agreementRows([
    caseWith({
      reviewerLabels: [
        ...labels('a', 'prop-1', 'SUPPORTED_WITHIN_SCOPE', 'CONTRADICTED'),
        ...labels('a', 'prop-2', 'SUPPORTED_WITHIN_SCOPE', 'CONTRADICTED'),
      ],
      adjudications: [
        {
          dimension: 'EVIDENCE_SUPPORT',
          subjectId: 'prop-1',
          outcome: 'RESOLVED',
          label: 'CONTRADICTED',
          reason: 'The artifact postdates the claim, so the support relationship does not hold.',
          adjudicatedBy: 'c',
        },
      ],
    }),
  ]);
  const settled = rows.find((row) => row.subjectId === 'prop-1');
  const other = rows.find((row) => row.subjectId === 'prop-2');
  assert.equal(settled?.status, 'RESOLVED_BY_ADJUDICATION');
  assert.equal(settled?.adjudicatedLabel, 'CONTRADICTED');
  // The point of scoping: a second disagreement in the same case is not settled by the first decision.
  assert.equal(other?.status, 'UNRESOLVED');
});

test('a v1 unscoped adjudication is honoured only where it can name one subject', () => {
  const labels = (subjectId: string, a: string, b: string) => [
    { reviewer: 'a', dimension: 'EVIDENCE_SUPPORT' as const, label: a, subjectId, note: null },
    { reviewer: 'b', dimension: 'EVIDENCE_SUPPORT' as const, label: b, subjectId, note: null },
  ];
  const single = agreementRows([
    caseWith({
      version: 'benchmark-case-v1',
      reviewerLabels: labels('prop-1', 'SUPPORTED_WITHIN_SCOPE', 'CONTRADICTED'),
      adjudication: {
        outcome: 'GENUINELY_AMBIGUOUS',
        reason: 'The recorded locator is too coarse.',
        adjudicatedBy: 'c',
      },
    }),
  ]);
  assert.equal(single[0]?.status, 'GENUINELY_AMBIGUOUS');

  const several = agreementRows([
    caseWith({
      version: 'benchmark-case-v1',
      reviewerLabels: [
        ...labels('prop-1', 'SUPPORTED_WITHIN_SCOPE', 'CONTRADICTED'),
        ...labels('prop-2', 'SUPPORTED_WITHIN_SCOPE', 'CONTRADICTED'),
      ],
      adjudication: {
        outcome: 'RESOLVED',
        reason: 'Decided.',
        adjudicatedBy: 'c',
      },
    }),
  ]);
  // One unnamed decision cannot settle two disputes.
  assert.deepEqual(
    several.map((row) => row.status),
    ['UNRESOLVED', 'UNRESOLVED'],
  );
});

test('annotation agreement excludes what it cannot defend and counts it openly', () => {
  const rows = agreementRows([
    caseWith({
      expected: [
        {
          dimension: 'EVIDENCE_SUPPORT',
          label: 'SUPPORTED_WITHIN_SCOPE',
          subjectId: 'prop-1',
          rationale: 'Recorded artifact.',
        },
        {
          dimension: 'EVIDENCE_SUPPORT',
          label: 'CONTRADICTED',
          subjectId: 'prop-2',
          rationale: 'Recorded artifact contradicts.',
        },
      ],
      reviewerLabels: [
        {
          reviewer: 'a',
          dimension: 'EVIDENCE_SUPPORT',
          label: 'SUPPORTED_WITHIN_SCOPE',
          subjectId: 'prop-1',
          note: null,
        },
        {
          reviewer: 'b',
          dimension: 'EVIDENCE_SUPPORT',
          label: 'SUPPORTED_WITHIN_SCOPE',
          subjectId: 'prop-1',
          note: null,
        },
        // A disagreement the reviewers never settled.
        {
          reviewer: 'a',
          dimension: 'EVIDENCE_SUPPORT',
          label: 'CONTRADICTED',
          subjectId: 'prop-2',
          note: null,
        },
        {
          reviewer: 'b',
          dimension: 'EVIDENCE_SUPPORT',
          label: 'SUPPORTED_WITHIN_SCOPE',
          subjectId: 'prop-2',
          note: null,
        },
      ],
    }),
  ]);
  const summaries = annotationSummaries(rows, ['EVIDENCE_SUPPORT']);
  const summary = summaries[0];
  assert.notEqual(summary, undefined);
  assert.equal(summary?.subjects, 2);
  assert.equal(summary?.scorable, 1, 'only the unanimous subject has a defensible value');
  assert.equal(summary?.agreeingWithGold, 1);
  assert.equal(summary?.agreementRate, 1);
  assert.equal(summary?.excludedUnresolved, 1);
  // Nothing was hidden to make the rate look clean: the excluded subject is counted, not erased.
  assert.equal((summary?.subjects ?? 0) - (summary?.scorable ?? 0), summary?.excludedUnresolved);
});

test('no consensus is inferred from a sorted label list', () => {
  // The v0.3 rule took `labels.sort()[0]`, so one dissenting ACCURATE beat two UNSUPPORTED. With no
  // consensus step at all, a majority and an alphabetical ordering cannot be confused.
  const rows = agreementRows([
    caseWith({
      reviewerLabels: [
        {
          reviewer: 'a',
          dimension: 'EVIDENCE_SUPPORT',
          label: 'SUPPORTED_WITHIN_SCOPE',
          subjectId: 'prop-1',
          note: null,
        },
        {
          reviewer: 'b',
          dimension: 'EVIDENCE_SUPPORT',
          label: 'CONTRADICTED',
          subjectId: 'prop-1',
          note: null,
        },
        {
          reviewer: 'c',
          dimension: 'EVIDENCE_SUPPORT',
          label: 'CONTRADICTED',
          subjectId: 'prop-1',
          note: null,
        },
      ],
    }),
  ]);
  assert.equal(rows[0]?.status, 'UNRESOLVED');
  assert.equal(rows[0]?.adjudicatedLabel, null);
});
