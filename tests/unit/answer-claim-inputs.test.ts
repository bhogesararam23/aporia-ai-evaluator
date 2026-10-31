import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  codePointLength,
  resolveQuoteOffset,
  sliceCodePoints,
  validateAnswerClaimAssessmentInput,
  validateAnswerClaimDraftInput,
  validateClaimCitationLinkInput,
  validateClaimPropositionLinkInput,
} from '../../src/core/answerClaimInputs.ts';
import { validateAnswerClaimRevisionInput } from '../../src/core/answerClaimInputs.ts';

const ANSWER = 'Aram led the project and authored the parser. The system launched in 2021.';

function range(result: { startOffset: number | null; endOffset: number | null }): string {
  return sliceCodePoints(ANSWER, result.startOffset as number, result.endOffset as number);
}

test('an exact quote resolves to the range it occupies in the captured answer', () => {
  const result = resolveQuoteOffset(ANSWER, 'authored the parser', 'EXACT_MATCH');
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(range(result.value), 'authored the parser');
});

test('a repeated phrase resolves to its first occurrence', () => {
  const result = resolveQuoteOffset('date date', 'date', 'EXACT_MATCH');
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(result.value, { startOffset: 0, endOffset: 4 });
});

test('a quote that is not in the answer is refused as an exact match', () => {
  const result = resolveQuoteOffset(ANSWER, 'Aram founded the company', 'EXACT_MATCH');
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.match(result.issues[0]?.message ?? '', /not present verbatim/);
});

test('whitespace and line breaks do not defeat normalised matching', () => {
  const spread = 'Aram  led\n  the project and more';
  const result = resolveQuoteOffset(spread, 'Aram led the project', 'NORMALIZED_MATCH');
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.startOffset, 0);
  // The mapped range must still describe the original bytes, not the normalised form.
  assert.equal(
    sliceCodePoints(spread, result.value.startOffset as number, result.value.endOffset as number),
    'Aram  led\n  the project',
  );
});

test('normalised matching maps back to original code-point offsets', () => {
  const text = 'The  launch\tdate is 2021.';
  const result = resolveQuoteOffset(text, 'launch date', 'NORMALIZED_MATCH');
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(
    sliceCodePoints(text, result.value.startOffset as number, result.value.endOffset as number),
    'launch\tdate',
  );
});

test('a changed word is not forgiven by normalisation', () => {
  const result = resolveQuoteOffset(
    ANSWER,
    'Aram led the project and edited the parser',
    'NORMALIZED_MATCH',
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.match(result.issues[0]?.message ?? '', /does not match the captured answer/);
});

test('an unestablished basis stores no offsets', () => {
  const result = resolveQuoteOffset(ANSWER, 'a paraphrase of the whole answer', 'NOT_ESTABLISHED');
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.deepEqual(result.value, { startOffset: null, endOffset: null });
});

test('an empty captured answer cannot locate a quote', () => {
  for (const basis of ['EXACT_MATCH', 'NORMALIZED_MATCH'] as const) {
    const result = resolveQuoteOffset('', 'anything', basis);
    assert.equal(result.ok, false, basis);
  }
});

test('offsets count code points, which is what lets SQLite re-verify a stored range', () => {
  const text = '\u{1F389} shipped the parser \u{1F389}';
  const result = resolveQuoteOffset(text, 'shipped the parser', 'EXACT_MATCH');
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  // Two emoji are four UTF-16 code units but two code points, so the offsets must be code-point
  // offsets for `substr(answer_text, start + 1, end - start)` to return the quote.
  assert.equal(result.value.startOffset, 2);
  assert.equal(result.value.endOffset, 20);
  assert.equal(
    sliceCodePoints(text, result.value.startOffset as number, result.value.endOffset as number),
    'shipped the parser',
  );
  assert.notEqual(codePointLength(text), text.length);
});

test('draft validation resolves the quote and refuses a fabricated one', () => {
  const quote = 'The system launched in 2021.';
  const good = validateAnswerClaimDraftInput(
    { quoteText: quote, relevance: 'ADDRESSES', offsetBasis: 'EXACT_MATCH' },
    ANSWER,
  );
  assert.equal(good.ok, true);
  if (!good.ok) {
    return;
  }
  assert.equal(good.value.startOffset, ANSWER.length - quote.length);

  const bad = validateAnswerClaimDraftInput(
    {
      quoteText: 'The system launched in 2020.',
      relevance: 'CONTRADICTS',
      offsetBasis: 'EXACT_MATCH',
    },
    ANSWER,
  );
  assert.equal(bad.ok, false);
});

test('draft validation defaults to an unestablished basis when none is claimed', () => {
  const result = validateAnswerClaimDraftInput(
    { quoteText: 'a summary in the operator own words', relevance: 'AMBIGUOUS' },
    ANSWER,
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.value.offsetBasis, 'NOT_ESTABLISHED');
  assert.equal(result.value.startOffset, null);
});

test('draft validation aggregates every field problem instead of reporting one', () => {
  const result = validateAnswerClaimDraftInput(
    { quoteText: '', relevance: 'NOT_A_RELATION', offsetBasis: 'MAGIC' },
    ANSWER,
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  const fields = result.issues.map((issue) => issue.field);
  assert.ok(fields.includes('quoteText'));
  assert.ok(fields.includes('relevance'));
  assert.ok(fields.includes('offsetBasis'));
});

test('draft validation rejects oversized, empty, and control-character quotes', () => {
  const oversized = validateAnswerClaimDraftInput(
    { quoteText: 'x'.repeat(4001), relevance: 'ADDRESSES' },
    ANSWER,
  );
  assert.equal(oversized.ok, false);

  const blank = validateAnswerClaimDraftInput({ quoteText: '   ', relevance: 'ADDRESSES' }, ANSWER);
  assert.equal(blank.ok, false);

  const control = validateAnswerClaimDraftInput(
    { quoteText: `Aram${String.fromCharCode(0)}led`, relevance: 'ADDRESSES' },
    `Aram${String.fromCharCode(0)}led`,
  );
  assert.equal(control.ok, false);
});

test('a revision input carries the same quote guarantee as a new claim', () => {
  const good = validateAnswerClaimRevisionInput(
    { quoteText: 'Aram led the project', relevance: 'ADDRESSES', offsetBasis: 'EXACT_MATCH' },
    ANSWER,
  );
  assert.equal(good.ok, true);

  const bad = validateAnswerClaimRevisionInput(
    { quoteText: 'Aram led the team', relevance: 'ADDRESSES', offsetBasis: 'EXACT_MATCH' },
    ANSWER,
  );
  assert.equal(bad.ok, false);
});

test('proposition links require a rationale and a known relation', () => {
  const good = validateClaimPropositionLinkInput({
    propositionId: 'prop_1',
    relation: 'CONTRADICTS_TARGET',
    rationale: 'The answer states 2021; the recorded primary artifact says 2022.',
    reviewer: 'operator-local',
  });
  assert.equal(good.ok, true);

  const noRationale = validateClaimPropositionLinkInput({
    propositionId: 'prop_1',
    relation: 'CONTRADICTS_TARGET',
    reviewer: 'operator-local',
  });
  assert.equal(noRationale.ok, false);

  const unknownRelation = validateClaimPropositionLinkInput({
    propositionId: 'prop_1',
    relation: 'DEFINITELY_RIGHT',
    rationale: 'because',
    reviewer: 'operator-local',
  });
  assert.equal(unknownRelation.ok, false);
});

test('citation links require a support label from the citation axis only', () => {
  const good = validateClaimCitationLinkInput({
    citationId: 'cit_1',
    support: 'SUPPORTS_WITH_CONDITIONS',
    rationale: 'The cited page covers the 2022 release only.',
    reviewer: 'operator-local',
  });
  assert.equal(good.ok, true);

  const borrowed = validateClaimCitationLinkInput({
    citationId: 'cit_1',
    support: 'ACCURATE',
    rationale: 'wrong axis',
    reviewer: 'operator-local',
  });
  assert.equal(borrowed.ok, false);
});

test('claim assessments keep fidelity and attribution on separate axes', () => {
  const fidelity = validateAnswerClaimAssessmentInput({
    dimension: 'FIDELITY',
    label: 'CONTRADICTED',
    rationale: 'Conflicts with the recorded primary artifact.',
    reviewer: 'operator-local',
  });
  assert.equal(fidelity.ok, true);

  const wrongAxis = validateAnswerClaimAssessmentInput({
    dimension: 'FIDELITY',
    label: 'INCORRECT',
    rationale: 'attribution label on the fidelity axis',
    reviewer: 'operator-local',
  });
  assert.equal(wrongAxis.ok, false);

  const citationAxis = validateAnswerClaimAssessmentInput({
    dimension: 'CITATION_SUPPORT',
    label: 'SUPPORTS',
    rationale: 'citation support belongs on the mapping',
    reviewer: 'operator-local',
  });
  assert.equal(citationAxis.ok, false);
});

test('attribution assessments name the subject unless attribution is unaddressed', () => {
  const missingSubject = validateAnswerClaimAssessmentInput({
    dimension: 'ATTRIBUTION',
    label: 'FALSE_SOLE_CREDIT',
    rationale: 'The answer credits one person for work the record shows was shared.',
    reviewer: 'operator-local',
  });
  assert.equal(missingSubject.ok, false);

  const silenceIsFine = validateAnswerClaimAssessmentInput({
    dimension: 'ATTRIBUTION',
    label: 'NOT_ADDRESSED',
    rationale: 'The statement makes no credit claim.',
    reviewer: 'operator-local',
  });
  assert.equal(silenceIsFine.ok, true);

  const withSubject = validateAnswerClaimAssessmentInput({
    dimension: 'ATTRIBUTION',
    label: 'WRONG_ROLE',
    rationale: 'Named as author; the record shows maintainer.',
    reviewer: 'operator-local',
    attributionSubject: 'Aram',
    attributionRole: 'MAINTAINER',
  });
  assert.equal(withSubject.ok, true);
});

test('a fidelity assessment rejects attribution detail', () => {
  const result = validateAnswerClaimAssessmentInput({
    dimension: 'FIDELITY',
    label: 'ACCURATE',
    rationale: 'Matches the recorded release note.',
    reviewer: 'operator-local',
    attributionSubject: 'Aram',
  });
  assert.equal(result.ok, false);
});

test('assessment rationale is required and bounded', () => {
  for (const rationale of [undefined, '', '   ', 'x'.repeat(4001)]) {
    const result = validateAnswerClaimAssessmentInput({
      dimension: 'FIDELITY',
      label: 'ACCURATE',
      rationale,
      reviewer: 'operator-local',
    });
    assert.equal(result.ok, false, `rationale ${JSON.stringify(rationale)}`);
  }
});
