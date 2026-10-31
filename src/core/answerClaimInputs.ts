import {
  ANSWER_OFFSET_BASES,
  CLAIM_CITATION_SUPPORT_LABELS,
  CLAIM_PROPOSITION_RELATIONS,
  CLAIM_RELEVANCES,
  isClaimAttributionLabel,
  isClaimFidelityLabel,
  type AnswerOffsetBasis,
  type ClaimCitationSupportLabel,
  type ClaimPropositionRelation,
  type ClaimRelevance,
} from './answerClaims.ts';
import {
  enumValue,
  invalid,
  optionalText,
  requiredText,
  valid,
  type ValidationIssue,
  type ValidationResult,
} from './validation.ts';

export interface AnswerClaimDraftInput {
  readonly quoteText: string;
  readonly offsetBasis: AnswerOffsetBasis;
  readonly startOffset: number | null;
  readonly endOffset: number | null;
  readonly relevance: ClaimRelevance;
  readonly paraphrase: string | undefined;
  readonly note: string | undefined;
}

export interface AnswerClaimOffsetResult {
  readonly startOffset: number | null;
  readonly endOffset: number | null;
}

/**
 * Verify that a recorded quote really comes from the captured answer, and resolve the character
 * range it occupies.
 *
 * Offsets are UTF-16 code-unit indices into the stored `answer_text`, which is what JavaScript
 * `slice` uses. They are only recorded when they can be re-derived from the raw answer, so a
 * paraphrased or edited quote can never carry a precise-looking range that does not describe it.
 */
export function resolveQuoteOffset(
  answerText: string,
  quoteText: string,
  basis: AnswerOffsetBasis,
): ValidationResult<AnswerClaimOffsetResult> {
  if (basis === 'NOT_ESTABLISHED') {
    return valid({ startOffset: null, endOffset: null });
  }
  if (answerText.length === 0) {
    return invalid(
      'quoteText',
      'The captured answer holds no text, so no quote can be located in it.',
    );
  }
  if (basis === 'EXACT_MATCH') {
    const start = answerText.indexOf(quoteText);
    if (start === -1) {
      return invalid(
        'quoteText',
        'The quote is not present verbatim in the captured answer. Choose an exact-match quote from the original text, or record the basis as “not established”.',
      );
    }
    return valid({ startOffset: start, endOffset: start + quoteText.length });
  }
  const located = findNormalizedRange(answerText, quoteText);
  if (located === null) {
    return invalid(
      'quoteText',
      'The quote does not match the captured answer even after normalising whitespace and equivalent characters. Record the basis as “not established”.',
    );
  }
  return valid(located);
}

interface NormalizedText {
  readonly text: string;
  /** One entry per UTF-16 code unit of `text`: the index in the original string it came from. */
  readonly sources: readonly number[];
  /** One entry per UTF-16 code unit of `text`: the exclusive end of that original code point. */
  readonly ends: readonly number[];
}

const WHITESPACE = /\s/;

/**
 * NFKC-normalise the string and collapse every run of whitespace to one space, keeping a map back
 * to the original indices. Deliberately conservative: only whitespace and compatibility-equivalent
 * characters are treated as equivalent, so no word or punctuation change is forgiven.
 *
 * The parallel arrays are indexed by code unit, not by code point, so a normalised character that
 * expands into a surrogate pair cannot desynchronise a range.
 */
function normalizeWithMap(text: string): NormalizedText {
  const units: string[] = [];
  const sources: number[] = [];
  const ends: number[] = [];
  let index = 0;
  for (const character of text) {
    const end = index + character.length;
    const normalized = character.normalize('NFKC');
    if (WHITESPACE.test(normalized)) {
      if (!isTrailingWhitespace(units)) {
        units.push(' ');
        sources.push(index);
        ends.push(end);
      }
    } else {
      for (const codePoint of normalized) {
        for (let offset = 0; offset < codePoint.length; offset += 1) {
          units.push(codePoint[offset] as string);
          sources.push(index);
          ends.push(end);
        }
      }
    }
    index = end;
  }
  let length = units.length;
  while (length > 0 && WHITESPACE.test(units[length - 1] as string)) {
    length -= 1;
  }
  return {
    text: units.slice(0, length).join(''),
    sources: sources.slice(0, length),
    ends: ends.slice(0, length),
  };
}

function isTrailingWhitespace(units: readonly string[]): boolean {
  return units.length > 0 && WHITESPACE.test(units[units.length - 1] as string);
}

function findNormalizedRange(
  answerText: string,
  quoteText: string,
): AnswerClaimOffsetResult | null {
  const haystack = normalizeWithMap(answerText);
  const needle = normalizeWithMap(quoteText).text;
  if (needle.length === 0) {
    return null;
  }
  const start = haystack.text.indexOf(needle);
  if (start === -1) {
    return null;
  }
  const startOffset = haystack.sources[start];
  const endOffset = haystack.ends[start + needle.length - 1];
  if (startOffset === undefined || endOffset === undefined) {
    return null;
  }
  const result = { startOffset, endOffset };
  // Re-verify against the original slice. If normalisation shifted the boundaries, the range is not
  // reliable and the caller must record the basis as not established.
  const slice = normalizeWithMap(answerText.slice(startOffset, endOffset)).text;
  return slice === needle ? result : null;
}

function optionalEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): ValidationResult<T | undefined> {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return valid(undefined);
  }
  return enumValue(value, field, allowed);
}

/**
 * Validate the statement a operator records from a captured answer. The raw answer is supplied so
 * that the quote can be checked against it rather than trusted.
 */
export function validateAnswerClaimDraftInput(
  raw: Record<string, unknown>,
  answerText: string,
): ValidationResult<AnswerClaimDraftInput> {
  const issues: ValidationIssue[] = [];
  const read = <T>(result: ValidationResult<T>): T => {
    if (result.ok) {
      return result.value;
    }
    issues.push(...result.issues);
    return undefined as T;
  };

  const quoteText = read(
    requiredText(raw['quoteText'], 'quoteText', { max: 4000, multiline: true, trim: false }),
  );
  if (quoteText !== undefined && quoteText.trim().length === 0) {
    // Trim is disabled so a genuine quote keeps its own spacing for offset matching, which means an
    // all-whitespace quote would otherwise pass as a three-character statement.
    issues.push({ field: 'quoteText', message: 'Enter the statement quoted from the answer.' });
  }
  const relevance = read(enumValue(raw['relevance'], 'relevance', CLAIM_RELEVANCES));
  const basis = read(optionalEnum(raw['offsetBasis'], 'offsetBasis', ANSWER_OFFSET_BASES)) as
    AnswerOffsetBasis | undefined;
  const paraphrase = read(
    optionalText(raw['paraphrase'], 'paraphrase', { max: 2000, multiline: true }),
  );
  const note = read(optionalText(raw['note'], 'note', { max: 2000, multiline: true }));

  // A missing basis is only a safe default when the operator is not claiming a location at all.
  const resolvedBasis: AnswerOffsetBasis = basis ?? 'NOT_ESTABLISHED';
  let startOffset: number | null = null;
  let endOffset: number | null = null;
  if (issues.length === 0) {
    const offset = read(resolveQuoteOffset(answerText, quoteText, resolvedBasis));
    startOffset = offset?.startOffset ?? null;
    endOffset = offset?.endOffset ?? null;
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return valid({
    quoteText,
    offsetBasis: resolvedBasis,
    startOffset,
    endOffset,
    relevance,
    paraphrase,
    note,
  });
}

/**
 * A new statement revision replaces an existing claim's quote. The basis is supplied by the
 * operator because a corrected quote may legitimately no longer be verbatim.
 */
export function validateAnswerClaimRevisionInput(
  raw: Record<string, unknown>,
  answerText: string,
): ValidationResult<AnswerClaimDraftInput> {
  return validateAnswerClaimDraftInput(raw, answerText);
}

export interface ClaimPropositionLinkInput {
  readonly propositionId: string;
  readonly relation: ClaimPropositionRelation;
  readonly rationale: string;
  readonly reviewer: string;
}

export function validateClaimPropositionLinkInput(
  raw: Record<string, unknown>,
): ValidationResult<ClaimPropositionLinkInput> {
  const issues: ValidationIssue[] = [];
  const read = <T>(result: ValidationResult<T>): T => {
    if (result.ok) {
      return result.value;
    }
    issues.push(...result.issues);
    return undefined as T;
  };
  const propositionId = read(requiredText(raw['propositionId'], 'propositionId', { max: 120 }));
  const relation = read(enumValue(raw['relation'], 'relation', CLAIM_PROPOSITION_RELATIONS));
  const rationale = read(
    requiredText(raw['rationale'], 'rationale', { max: 4000, multiline: true }),
  );
  const reviewer = read(requiredText(raw['reviewer'], 'reviewer', { max: 80 }));
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return valid({ propositionId, relation, rationale, reviewer });
}

export interface ClaimCitationLinkInput {
  readonly citationId: string;
  readonly support: ClaimCitationSupportLabel;
  readonly rationale: string;
  readonly reviewer: string;
}

export function validateClaimCitationLinkInput(
  raw: Record<string, unknown>,
): ValidationResult<ClaimCitationLinkInput> {
  const issues: ValidationIssue[] = [];
  const read = <T>(result: ValidationResult<T>): T => {
    if (result.ok) {
      return result.value;
    }
    issues.push(...result.issues);
    return undefined as T;
  };
  const citationId = read(requiredText(raw['citationId'], 'citationId', { max: 120 }));
  const support = read(enumValue(raw['support'], 'support', CLAIM_CITATION_SUPPORT_LABELS));
  const rationale = read(
    requiredText(raw['rationale'], 'rationale', { max: 4000, multiline: true }),
  );
  const reviewer = read(requiredText(raw['reviewer'], 'reviewer', { max: 80 }));
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return valid({ citationId, support, rationale, reviewer });
}

export interface AnswerClaimAssessmentInput {
  readonly dimension: 'FIDELITY' | 'ATTRIBUTION';
  readonly label: string;
  readonly rationale: string;
  readonly reviewer: string;
  readonly attributionSubject: string | undefined;
  readonly attributionRole: string | undefined;
}

/**
 * Citation support is deliberately absent here. It is assessed on the claim-to-citation mapping,
 * because one statement can be supported by one citation and contradicted by another.
 */
export function validateAnswerClaimAssessmentInput(
  raw: Record<string, unknown>,
): ValidationResult<AnswerClaimAssessmentInput> {
  const issues: ValidationIssue[] = [];
  const read = <T>(result: ValidationResult<T>): T => {
    if (result.ok) {
      return result.value;
    }
    issues.push(...result.issues);
    return undefined as T;
  };
  const dimension = read(
    enumValue(raw['dimension'], 'dimension', ['FIDELITY', 'ATTRIBUTION'] as const),
  );
  const rationale = read(
    requiredText(raw['rationale'], 'rationale', { max: 4000, multiline: true }),
  );
  const reviewer = read(requiredText(raw['reviewer'], 'reviewer', { max: 80 }));
  const attributionSubject = read(
    optionalText(raw['attributionSubject'], 'attributionSubject', { max: 200 }),
  );
  const attributionRole = read(
    optionalText(raw['attributionRole'], 'attributionRole', { max: 200 }),
  );

  const label = read(requiredText(raw['label'], 'label', { max: 80 }));
  if (dimension === 'FIDELITY') {
    if (!isClaimFidelityLabel(label)) {
      issues.push({ field: 'label', message: 'The label is not a claim fidelity label.' });
    }
    if (attributionSubject !== undefined || attributionRole !== undefined) {
      issues.push({
        field: 'attributionSubject',
        message: 'Attribution detail belongs on an attribution assessment.',
      });
    }
  } else if (dimension === 'ATTRIBUTION') {
    if (!isClaimAttributionLabel(label)) {
      issues.push({ field: 'label', message: 'The label is not a claim attribution label.' });
    }
    if (label !== 'NOT_ADDRESSED' && attributionSubject === undefined) {
      issues.push({
        field: 'attributionSubject',
        message: 'Name what the answer attributed, or choose “attribution not addressed”.',
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return valid({
    dimension,
    label,
    rationale,
    reviewer,
    attributionSubject,
    attributionRole,
  });
}
