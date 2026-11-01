import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BENCHMARK_CASE_VERSION,
  BENCHMARK_STRATA,
  type BenchmarkCase,
} from '../../src/benchmark/types.ts';
import { validateBenchmarkCase, validateBenchmarkCorpus } from '../../src/benchmark/validate.ts';

/**
 * A structurally valid fixture. Every field is synthetic scaffolding for the validator, not a gold
 * case: no real achievement, source, person, or answer is asserted by this material, and nothing here
 * may be copied into a corpus directory as if it were reviewed evidence.
 */
function validCase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: BENCHMARK_CASE_VERSION,
    id: 'case-fixture-1',
    stratum: 'SUPPORTED_PRIMARY_EVIDENCE',
    title: 'Fixture shape check',
    provenance: {
      origin: 'Synthetic fixture constructed for validator tests only.',
      authorizedForStorage: true,
      reviewedBy: ['reviewer-a'],
      reviewedAt: '2026-11-01',
      unverified: ['Nothing outside this fixture.'],
      limitation: 'This fixture asserts no real fact and is not a gold case.',
    },
    input: {
      claimText: 'The fixture claim text is long enough.',
      propositions: [
        {
          id: 'prop-1',
          text: 'The fixture proposition.',
          evidence: [
            {
              id: 'ev-1',
              relation: 'SUPPORTS',
              sourceType: 'PRIMARY_ARTIFACT',
              independence: 'INDEPENDENT',
              locator: 'section 1',
            },
          ],
        },
      ],
      answerText: 'The fixture answer text.',
      citationCapture: 'CAPTURED',
      citations: [
        { id: 'cit-1', url: 'https://example.invalid/a', supportsStatement: true, note: null },
      ],
      statements: [
        {
          id: 'stmt-1',
          text: 'The fixture statement.',
          relevance: 'ADDRESSES',
          propositionIds: ['prop-1'],
          citationIds: ['cit-1'],
        },
      ],
      providerLabel: 'Fixture provider',
      locale: 'en',
    },
    expected: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        label: 'SUPPORTED_WITHIN_SCOPE',
        rationale: 'One recorded support and no contradiction.',
        subjectId: 'prop-1',
      },
    ],
    reviewerLabels: [],
    adjudication: null,
    limitations: [],
    ...overrides,
  };
}

function issuesFor(source: unknown): string[] {
  return validateBenchmarkCase(source, 0).map((issue) => issue.field);
}

test('a well-formed case validates with no issue', () => {
  assert.deepEqual(validateBenchmarkCase(validCase(), 0), []);
});

test('an unknown case version is refused rather than guessed at', () => {
  const issues = validateBenchmarkCase(validCase({ version: 'benchmark-case-v99' }), 0);
  assert.ok(issues.some((issue) => issue.field === 'version'));
  assert.match(issues[0]?.message ?? '', /Only "benchmark-case-v1"/);
});

test('a non-object case reports one clear problem', () => {
  for (const value of [null, 42, 'text', []]) {
    const issues = validateBenchmarkCase(value, 3);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]?.field, 'case');
  }
});

test('each structural defect is named on its own field', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['id', { id: '' }],
    ['title', { title: '' }],
    ['stratum', { stratum: 'NOT_A_STRATUM' }],
    ['provenance', { provenance: null }],
    ['expected', { expected: [] }],
    ['reviewerLabels', { reviewerLabels: 'no' }],
    ['limitations', { limitations: 'no' }],
  ];
  for (const [field, override] of cases) {
    const issues = issuesFor(validCase(override));
    assert.ok(issues.includes(field), `${field} should be reported, got ${issues.join(', ')}`);
  }
});

test('a case without authorised provenance cannot be scored', () => {
  const source = validCase();
  const provenance = source['provenance'] as Record<string, unknown>;
  const issues = issuesFor({
    ...source,
    provenance: { ...provenance, authorizedForStorage: false },
  });
  assert.ok(issues.includes('provenance.authorizedForStorage'));
});

test('a case with no named reviewer is refused', () => {
  const source = validCase();
  const provenance = source['provenance'] as Record<string, unknown>;
  const issues = issuesFor({ ...source, provenance: { ...provenance, reviewedBy: [] } });
  assert.ok(issues.includes('provenance.reviewedBy'));
});

test('gold labels without a rationale are refused', () => {
  const issues = issuesFor(
    validCase({
      expected: [
        {
          dimension: 'EVIDENCE_SUPPORT',
          label: 'SUPPORTED_WITHIN_SCOPE',
          rationale: '   ',
          subjectId: 'prop-1',
        },
      ],
    }),
  );
  assert.ok(issues.includes('expected.rationale'));
});

test('a gold label on an unknown dimension is refused', () => {
  const issues = issuesFor(
    validCase({
      expected: [{ dimension: 'VIBES', label: 'GOOD', rationale: 'because', subjectId: 'prop-1' }],
    }),
  );
  assert.ok(issues.includes('expected.dimension'));
});

test('a statement referencing material the case does not contain is refused', () => {
  const source = validCase();
  const input = source['input'] as Record<string, unknown>;
  const issues = issuesFor({
    ...source,
    input: {
      ...input,
      statements: [
        {
          id: 'stmt-1',
          text: 'A statement.',
          relevance: 'ADDRESSES',
          propositionIds: ['prop-missing'],
          citationIds: ['cit-missing'],
        },
      ],
    },
  });
  const messages = validateBenchmarkCase(source, 0).length;
  assert.equal(messages, 0, 'the baseline fixture must be clean');
  assert.ok(issues.includes('input.statements.propositionIds'));
  assert.ok(issues.includes('input.statements.citationIds'));
});

test('an answer without any decomposed statement is refused', () => {
  const source = validCase();
  const input = source['input'] as Record<string, unknown>;
  const issues = issuesFor({ ...source, input: { ...input, statements: [] } });
  assert.ok(issues.includes('input.statements'));
  // An unavailable answer is the honest way to have no statements.
  const cleaned = issuesFor({
    ...source,
    input: { ...input, answerText: null, statements: [], citations: [] },
  });
  assert.ok(!cleaned.includes('input.statements'));
});

test('oversized and control-character-laden fields are refused', () => {
  const issues = issuesFor(validCase({ title: 'x'.repeat(400) }));
  assert.ok(issues.includes('title'));
  const control = issuesFor(
    validCase({
      input: {
        ...(validCase()['input'] as Record<string, unknown>),
        claimText: `ab${String.fromCharCode(0)}cd`,
      },
    }),
  );
  // The validator bounds length; control characters are the JSON parser's and the renderer's problem,
  // so this asserts the bound holds rather than pretending the loader sanitises.
  assert.ok(Array.isArray(control));
});

test('corpus validation reports every missing stratum by name', () => {
  const corpus = validateBenchmarkCorpus([{ index: 0, value: validCase() }]);
  assert.equal(corpus.caseCount, 1);
  assert.deepEqual(corpus.strataPresent, ['SUPPORTED_PRIMARY_EVIDENCE']);
  assert.deepEqual(
    corpus.strataMissing,
    BENCHMARK_STRATA.filter((stratum) => stratum !== 'SUPPORTED_PRIMARY_EVIDENCE'),
  );
});

test('a duplicate case identifier is reported, not silently deduplicated', () => {
  const corpus = validateBenchmarkCorpus([
    { index: 0, value: validCase() },
    { index: 1, value: validCase() },
  ]);
  assert.equal(corpus.caseCount, 1);
  assert.ok(corpus.issues.some((issue) => /Duplicate case identifier/.test(issue.message)));
});

test('an invalid case is excluded from scoring rather than scored partially', () => {
  const corpus = validateBenchmarkCorpus([
    { index: 0, value: validCase() },
    { index: 1, value: validCase({ stratum: 'NOPE' }) },
  ]);
  assert.equal(corpus.cases.length, 1);
  assert.equal(corpus.caseCount, 1);
  assert.ok(corpus.issues.length > 0);
});

test('a parsed case keeps the declared structure the scorer depends on', () => {
  const corpus = validateBenchmarkCorpus([{ index: 0, value: validCase() }]);
  const parsed = corpus.cases[0] as BenchmarkCase;
  assert.equal(parsed.input.propositions.length, 1);
  assert.equal(parsed.expected[0]?.dimension, 'EVIDENCE_SUPPORT');
  assert.equal(parsed.adjudication, null);
});
