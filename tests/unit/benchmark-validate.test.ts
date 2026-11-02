import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BENCHMARK_CASE_VERSION,
  BENCHMARK_CASE_VERSION_V1,
  BENCHMARK_STRATA,
  type BenchmarkCase,
} from '../../src/benchmark/types.ts';
import {
  BENCHMARK_LIMITS,
  validateBenchmarkCase,
  validateBenchmarkCorpus,
} from '../../src/benchmark/validate.ts';

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
      reviewedBy: ['reviewer-a', 'reviewer-b'],
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
              sourceId: 'src-1',
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
    adjudications: [],
    limitations: [],
    ...overrides,
  };
}

function fieldsFor(source: unknown): string[] {
  return validateBenchmarkCase(source, 0).map((issue) => issue.field);
}

/**
 * Issues are addressed to the element that carries them (`input.citations[cit-9].url`), which is the
 * improvement over a constant field name that could not say *which* of two hundred citations was
 * wrong. Assertions therefore match the suffix.
 */
function hasIssue(fields: string[], suffix: string): boolean {
  return fields.some(
    (field) => field === suffix || field.endsWith(`].${suffix}`) || field.endsWith(suffix),
  );
}

function inputOf(source: Record<string, unknown>): Record<string, unknown> {
  return source['input'] as Record<string, unknown>;
}

function withInput(
  source: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return { ...source, input: { ...inputOf(source), ...overrides } };
}

test('a well-formed case validates with no issue', () => {
  assert.deepEqual(validateBenchmarkCase(validCase(), 0), []);
});

test('an unknown case version is refused rather than guessed at', () => {
  const issues = validateBenchmarkCase(validCase({ version: 'benchmark-case-v99' }), 0);
  assert.ok(issues.some((issue) => issue.field === 'version'));
  assert.match(issues[0]?.message ?? '', /benchmark-case-v2/);
});

test('a v1 case still reads, and is told its source identity is unavailable', () => {
  const legacy = withInput(validCase({ version: BENCHMARK_CASE_VERSION_V1 }), {
    propositions: [
      {
        id: 'prop-1',
        text: 'The fixture proposition.',
        // A v1 record carries no sourceId, and the loader substitutes the relationship id. That is
        // read rather than refused, but the duplicate-source stratum cannot be tested with it.
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
  });
  assert.deepEqual(validateBenchmarkCase(legacy, 0), []);
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
    const fields = fieldsFor(validCase(override));
    assert.ok(hasIssue(fields, field), `${field} should be reported, got ${fields.join(', ')}`);
  }
});

test('a case without authorised provenance cannot be scored', () => {
  const source = validCase();
  const provenance = source['provenance'] as Record<string, unknown>;
  const fields = fieldsFor({
    ...source,
    provenance: { ...provenance, authorizedForStorage: false },
  });
  assert.ok(hasIssue(fields, 'provenance.authorizedForStorage'));
});

test('a case with no named reviewer is refused', () => {
  const source = validCase();
  const provenance = source['provenance'] as Record<string, unknown>;
  const fields = fieldsFor({ ...source, provenance: { ...provenance, reviewedBy: [] } });
  assert.ok(hasIssue(fields, 'provenance.reviewedBy'));
});

test('every reviewer entry is checked, not only the first', () => {
  const source = validCase();
  const provenance = source['provenance'] as Record<string, unknown>;
  const fields = fieldsFor({
    ...source,
    provenance: { ...provenance, reviewedBy: ['reviewer-a', 42, {}, null, 'x'.repeat(400)] },
  });
  assert.ok(
    fields.length >= 4,
    `each bad reviewer entry should be reported, got ${fields.join(', ')}`,
  );
});

test('a reviewer date nobody can read is refused', () => {
  const source = validCase();
  const provenance = source['provenance'] as Record<string, unknown>;
  for (const reviewedAt of ['yesterday', '2026-13-99', 'soon']) {
    const fields = fieldsFor({ ...source, provenance: { ...provenance, reviewedAt } });
    assert.ok(
      hasIssue(fields, 'provenance.reviewedAt'),
      `${reviewedAt} must not pass as a review date`,
    );
  }
});

test('the unverified list is validated rather than declared and ignored', () => {
  const source = validCase();
  const provenance = source['provenance'] as Record<string, unknown>;
  const fields = fieldsFor({
    ...source,
    provenance: { ...provenance, unverified: [null, 'ok', 7] },
  });
  assert.ok(hasIssue(fields, 'provenance.unverified[0]'));
  assert.ok(hasIssue(fields, 'provenance.unverified[2]'));
});

test('gold labels without a rationale are refused', () => {
  const fields = fieldsFor(
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
  assert.ok(hasIssue(fields, 'rationale'));
});

test('a gold label on an unknown dimension is refused', () => {
  const fields = fieldsFor(
    validCase({
      expected: [{ dimension: 'VIBES', label: 'GOOD', rationale: 'because', subjectId: 'prop-1' }],
    }),
  );
  assert.ok(hasIssue(fields, 'expected.dimension') || hasIssue(fields, 'dimension'));
});

test('a gold label outside its dimension vocabulary is refused', () => {
  const fields = fieldsFor(
    validCase({
      expected: [
        {
          dimension: 'ATTRIBUTION',
          label: 'YES_VIBES',
          rationale: 'A label from nowhere.',
          subjectId: 'stmt-1',
        },
      ],
    }),
  );
  assert.ok(hasIssue(fields, 'label'), fields.join(', '));
  assert.match(
    validateBenchmarkCase(
      validCase({
        expected: [
          {
            dimension: 'ATTRIBUTION',
            label: 'YES_VIBES',
            rationale: 'A label from nowhere.',
            subjectId: 'stmt-1',
          },
        ],
      }),
      0,
    )[0]?.message ?? '',
    /CORRECT/,
  );
});

test('a gold label must judge the kind of object its dimension describes', () => {
  // Evidence support is a property of a proposition. Fidelity is a property of a statement. A typo
  // that points an evidence label at a statement would otherwise vanish from every statistic.
  const wrongKind = fieldsFor(
    withInput(validCase(), {
      statements: [
        {
          id: 'stmt-1',
          text: 'A statement.',
          relevance: 'ADDRESSES',
          propositionIds: [],
          citationIds: [],
        },
      ],
    }),
  );
  assert.equal(wrongKind.length, 0, 'the baseline still validates');

  const evidenceOnStatement = fieldsFor(
    validCase({
      expected: [
        {
          dimension: 'EVIDENCE_SUPPORT',
          label: 'SUPPORTED_WITHIN_SCOPE',
          rationale: 'Points at a statement, which is the wrong kind of subject.',
          subjectId: 'stmt-1',
        },
      ],
    }),
  );
  assert.ok(hasIssue(evidenceOnStatement, 'subjectId'), evidenceOnStatement.join(', '));

  const fidelityOnProposition = fieldsFor(
    validCase({
      expected: [
        {
          dimension: 'ANSWER_FIDELITY',
          label: 'ACCURATE',
          rationale: 'Points at a proposition instead of a statement.',
          subjectId: 'prop-1',
        },
      ],
    }),
  );
  assert.ok(hasIssue(fidelityOnProposition, 'subjectId'));
});

test('two gold labels on one subject are refused instead of guaranteeing a miss', () => {
  const fields = fieldsFor(
    validCase({
      expected: [
        {
          dimension: 'EVIDENCE_SUPPORT',
          label: 'SUPPORTED_WITHIN_SCOPE',
          rationale: 'First judgement.',
          subjectId: 'prop-1',
        },
        {
          dimension: 'EVIDENCE_SUPPORT',
          label: 'CONTRADICTED',
          rationale: 'Second judgement of the same subject.',
          subjectId: 'prop-1',
        },
      ],
    }),
  );
  assert.ok(hasIssue(fields, 'expected'), fields.join(', '));
});

test('a statement referencing material the case does not contain is refused', () => {
  const source = validCase();
  assert.equal(validateBenchmarkCase(source, 0).length, 0, 'the baseline fixture must be clean');
  const fields = fieldsFor(
    withInput(source, {
      statements: [
        {
          id: 'stmt-1',
          text: 'A statement.',
          relevance: 'ADDRESSES',
          propositionIds: ['prop-missing'],
          citationIds: ['cit-missing'],
        },
      ],
    }),
  );
  assert.ok(hasIssue(fields, 'propositionIds'), fields.join(', '));
  assert.ok(hasIssue(fields, 'citationIds'));
});

test('a statement relevance outside the vocabulary is refused', () => {
  const source = validCase();
  const fields = fieldsFor(
    withInput(source, {
      statements: [
        {
          id: 'stmt-1',
          text: 'A statement.',
          relevance: 'SORT_OF_ADDRESSES',
          propositionIds: ['prop-1'],
          citationIds: ['cit-1'],
        },
      ],
    }),
  );
  assert.ok(hasIssue(fields, 'relevance'), fields.join(', '));
});

test('a citation URL must be an http(s) URL, not a string of some length', () => {
  const source = validCase();
  for (const url of [
    'not a url',
    'javascript:alert(1)',
    'file:///C:/secrets.db',
    'https://user:***@example.invalid/',
  ]) {
    const fields = fieldsFor(
      withInput(source, {
        citations: [{ id: 'cit-1', url, supportsStatement: true, note: null }],
      }),
    );
    assert.ok(hasIssue(fields, 'url'), `${url} must be refused`);
  }
});

test('citations cannot be referenced when the case says none were captured', () => {
  const source = validCase();
  const fields = fieldsFor(
    withInput(source, {
      citationCapture: 'NOT_SHOWN',
      citations: [],
      statements: [
        {
          id: 'stmt-1',
          text: 'A statement.',
          relevance: 'ADDRESSES',
          propositionIds: ['prop-1'],
          citationIds: ['cit-1'],
        },
      ],
    }),
  );
  assert.ok(hasIssue(fields, 'citationIds'), fields.join(', '));
});

test('citationCapture must be one of the three declared states', () => {
  const source = validCase();
  const fields = fieldsFor(withInput(source, { citationCapture: 'BANANA' }));
  assert.ok(hasIssue(fields, 'input.citationCapture'), fields.join(', '));
});

test('an evidence record is validated in full, not treated as a list', () => {
  const source = validCase();
  for (const bad of [
    { ...({} as Record<string, string>) },
    {
      id: 'ev-x',
      relation: 'BANANA',
      sourceId: 'src-1',
      sourceType: 'PRIMARY_ARTIFACT',
      independence: 'INDEPENDENT',
      locator: 'x',
    },
    {
      id: 'ev-x',
      relation: 'SUPPORTS',
      sourceId: 'src-1',
      sourceType: 'NOT_A_TYPE',
      independence: 'INDEPENDENT',
      locator: 'x',
    },
    {
      id: 'ev-x',
      relation: 'SUPPORTS',
      sourceId: 'src-1',
      sourceType: 'PRIMARY_ARTIFACT',
      independence: 'SORT_OF',
      locator: 'x',
    },
  ]) {
    const fields = fieldsFor(
      withInput(source, {
        propositions: [{ id: 'prop-1', text: 'A proposition.', evidence: [bad] }],
      }),
    );
    assert.ok(fields.length > 0, `${JSON.stringify(bad)} must be refused`);
  }
});

test('an evidence record without a locator is refused', () => {
  const source = validCase();
  const fields = fieldsFor(
    withInput(source, {
      propositions: [
        {
          id: 'prop-1',
          text: 'A proposition.',
          evidence: [
            {
              id: 'ev-1',
              relation: 'SUPPORTS',
              sourceId: 'src-1',
              sourceType: 'PRIMARY_ARTIFACT',
              independence: 'INDEPENDENT',
              locator: '  ',
            },
          ],
        },
      ],
    }),
  );
  assert.ok(hasIssue(fields, 'locator'), fields.join(', '));
});

test('duplicate evidence identifiers inside one case are reported', () => {
  const source = validCase();
  const evidence = {
    id: 'ev-1',
    relation: 'SUPPORTS',
    sourceId: 'src-1',
    sourceType: 'PRIMARY_ARTIFACT',
    independence: 'INDEPENDENT',
    locator: 'section 1',
  };
  const fields = fieldsFor(
    withInput(source, {
      propositions: [
        { id: 'prop-1', text: 'A.', evidence: [evidence, evidence] },
        { id: 'prop-2', text: 'B.', evidence: [evidence] },
      ],
    }),
  );
  assert.ok(
    fields.some((field) => /Duplicate identifier/.test(field) || hasIssue(fields, 'evidence')),
    fields.join(', '),
  );
  assert.ok(
    validateBenchmarkCase(
      withInput(source, {
        propositions: [
          { id: 'prop-1', text: 'A.', evidence: [evidence, evidence] },
          { id: 'prop-2', text: 'B.', evidence: [evidence] },
        ],
      }),
      0,
    ).some((issue) => /Duplicate identifier/.test(issue.message)),
    'the duplicate must be named in the message, not only in the field',
  );
});

test('a non-object statement is reported rather than silently skipped', () => {
  const source = validCase();
  const fields = fieldsFor(
    withInput(source, {
      statements: [1, 2, 3],
    }),
  );
  assert.ok(fields.length >= 3, `each bad statement should be reported, got ${fields.join(', ')}`);
});

test('a reference list that is not an array is refused rather than emptied', () => {
  const source = validCase();
  const fields = fieldsFor(
    withInput(source, {
      statements: [
        {
          id: 'stmt-1',
          text: 'A statement.',
          relevance: 'ADDRESSES',
          propositionIds: 'prop-1',
          citationIds: { not: 'a list' },
        },
      ],
    }),
  );
  assert.ok(hasIssue(fields, 'propositionIds'), fields.join(', '));
  assert.ok(hasIssue(fields, 'citationIds'));
});

test('a reviewer label by an undeclared reviewer is refused', () => {
  const source = validCase();
  const fields = fieldsFor(
    validCase({
      reviewerLabels: [
        {
          reviewer: 'somebody-else',
          dimension: 'EVIDENCE_SUPPORT',
          label: 'SUPPORTED_WITHIN_SCOPE',
          subjectId: 'prop-1',
          note: null,
        },
      ],
    }),
  );
  assert.ok(hasIssue(fields, 'reviewer'), fields.join(', '));
  void source;
});

test('limitations must be an array of bounded strings', () => {
  const fields = fieldsFor(
    validCase({ limitations: [null, {}, 'x'.repeat(4000), 'A real limitation.'] }),
  );
  assert.ok(hasIssue(fields, 'limitations[0]'), fields.join(', '));
  assert.ok(hasIssue(fields, 'limitations[1]'));
  assert.ok(hasIssue(fields, 'limitations[2]'));
});

test('an oversized case is refused by the validator, not only by the loader', () => {
  const source = validCase({
    limitations: ['x'.repeat(BENCHMARK_LIMITS.maxNoteLength)],
  });
  const input = inputOf(source);
  const huge = withInput(source, {
    claimText: 'y'.repeat(BENCHMARK_LIMITS.maxCaseBytes),
    statements: [],
    answerText: null,
    citations: [],
  });
  void input;
  const fields = fieldsFor(huge);
  assert.ok(hasIssue(fields, 'case'), fields.join(', '));
});

test('an answer without any decomposed statement is refused', () => {
  const source = validCase();
  const fields = fieldsFor(withInput(source, { statements: [] }));
  assert.ok(hasIssue(fields, 'input.statements'));
  // An unavailable answer is the honest way to have no statements.
  const cleaned = fieldsFor(withInput(source, { answerText: null, statements: [] }));
  assert.equal(
    cleaned.filter((field) => field.endsWith('input.statements')).length,
    0,
    cleaned.join(', '),
  );
});

test('a v2 adjudication must settle a subject the case actually labels', () => {
  const fields = fieldsFor(
    validCase({
      adjudications: [
        {
          dimension: 'EVIDENCE_SUPPORT',
          subjectId: 'prop-missing',
          outcome: 'RESOLVED',
          label: 'SUPPORTED_WITHIN_SCOPE',
          reason: 'Settled against a subject nobody labelled.',
          adjudicatedBy: 'reviewer-b',
        },
      ],
    }),
  );
  assert.ok(hasIssue(fields, 'subjectId'), fields.join(', '));
});

test('a resolved adjudication must name the label it settled on', () => {
  const fields = fieldsFor(
    validCase({
      reviewerLabels: [
        {
          reviewer: 'reviewer-a',
          dimension: 'EVIDENCE_SUPPORT',
          label: 'SUPPORTED_WITHIN_SCOPE',
          subjectId: 'prop-1',
          note: null,
        },
        {
          reviewer: 'reviewer-b',
          dimension: 'EVIDENCE_SUPPORT',
          label: 'CONTRADICTED',
          subjectId: 'prop-1',
          note: null,
        },
      ],
      adjudications: [
        {
          dimension: 'EVIDENCE_SUPPORT',
          subjectId: 'prop-1',
          outcome: 'RESOLVED',
          label: null,
          reason: 'We discussed it.',
          adjudicatedBy: 'reviewer-b',
        },
      ],
    }),
  );
  assert.ok(hasIssue(fields, 'label'), fields.join(', '));
});

test('a genuinely ambiguous adjudication may not smuggle in a label', () => {
  const fields = fieldsFor(
    validCase({
      reviewerLabels: [
        {
          reviewer: 'reviewer-a',
          dimension: 'EVIDENCE_SUPPORT',
          label: 'SUPPORTED_WITHIN_SCOPE',
          subjectId: 'prop-1',
          note: null,
        },
        {
          reviewer: 'reviewer-b',
          dimension: 'EVIDENCE_SUPPORT',
          label: 'CONTRADICTED',
          subjectId: 'prop-1',
          note: null,
        },
      ],
      adjudications: [
        {
          dimension: 'EVIDENCE_SUPPORT',
          subjectId: 'prop-1',
          outcome: 'GENUINELY_AMBIGUOUS',
          label: 'CONTRADICTED',
          reason: 'Ambiguous, but we picked one anyway.',
          adjudicatedBy: 'reviewer-b',
        },
      ],
    }),
  );
  assert.ok(hasIssue(fields, 'label'), fields.join(', '));
});

test('a v2 case may not carry an unscoped adjudication', () => {
  const fields = fieldsFor(
    validCase({
      adjudication: { outcome: 'RESOLVED', reason: 'Old shape.', adjudicatedBy: 'reviewer-b' },
    }),
  );
  assert.ok(hasIssue(fields, 'adjudication'), fields.join(', '));
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

test('the case ceiling counts cases, not files', () => {
  // One file holding an array used to slip past a limit measured in filenames.
  const many = Array.from({ length: 3 }, (_unused, index) =>
    validCase({ id: `bulk-${String(index)}`, stratum: BENCHMARK_STRATA[index] }),
  );
  const corpus = validateBenchmarkCorpus([{ index: 0, value: many }]);
  assert.equal(corpus.caseCount, 3, 'each array element is its own case');
});

test('a parsed case keeps the declared structure the scorer depends on', () => {
  const corpus = validateBenchmarkCorpus([{ index: 0, value: validCase() }]);
  const parsed = corpus.cases[0] as BenchmarkCase;
  assert.equal(parsed.input.propositions.length, 1);
  assert.equal(parsed.expected[0]?.dimension, 'EVIDENCE_SUPPORT');
  assert.equal(parsed.input.propositions[0]?.evidence[0]?.sourceId, 'src-1');
  assert.deepEqual(parsed.adjudications, []);
});
