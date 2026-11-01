import {
  BENCHMARK_CASE_VERSION,
  BENCHMARK_DIMENSIONS,
  BENCHMARK_STRATA,
  type BenchmarkCase,
  type BenchmarkCaseIssue,
  type BenchmarkCorpusValidation,
  type BenchmarkStratum,
} from './types.ts';

/** Bounds a hostile or careless corpus file can be forced to respect at load time. */
export const BENCHMARK_LIMITS = {
  maxCases: 5000,
  maxCaseBytes: 262_144,
  maxCorpusBytes: 8_388_608,
  maxIdLength: 120,
  maxTextLength: 8000,
  maxPropositions: 200,
  maxStatements: 500,
  maxCitations: 200,
  maxExpected: 400,
  maxReviewers: 40,
} as const;

const STRATUM_SET = new Set<string>(BENCHMARK_STRATA);
const DIMENSION_SET = new Set<string>(BENCHMARK_DIMENSIONS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function textIssue(
  issues: BenchmarkCaseIssue[],
  caseId: string,
  field: string,
  value: unknown,
  maxLength: number,
  required: boolean,
): void {
  if (typeof value !== 'string') {
    issues.push({ caseId, field, message: 'Must be a string.' });
    return;
  }
  if (value.trim().length === 0) {
    if (required) {
      issues.push({ caseId, field, message: 'Must not be empty.' });
    }
    return;
  }
  if (value.length > maxLength) {
    issues.push({ caseId, field, message: `Must be ${maxLength} characters or fewer.` });
  }
}

function boundedInteger(
  issues: BenchmarkCaseIssue[],
  caseId: string,
  field: string,
  value: unknown,
  max: number,
): void {
  if (!isList(value)) {
    issues.push({ caseId, field, message: 'Must be an array.' });
    return;
  }
  if (value.length > max) {
    issues.push({ caseId, field, message: `Must hold ${max} items or fewer.` });
  }
}

function uniqueIds(
  issues: BenchmarkCaseIssue[],
  caseId: string,
  field: string,
  entries: readonly { readonly id: unknown }[],
): Set<string> {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (typeof entry.id !== 'string') {
      issues.push({ caseId, field: `${field}.id`, message: 'Must be a string.' });
      continue;
    }
    if (seen.has(entry.id)) {
      issues.push({ caseId, field, message: `Duplicate identifier "${entry.id}".` });
    }
    seen.add(entry.id);
  }
  return seen;
}

/**
 * Validate one parsed case. Every check is independent so a single run reports the full set of
 * problems: a partially valid case must never be scored, because a missing rationale changes what a
 * number means.
 */
export function validateBenchmarkCase(source: unknown, index: number): BenchmarkCaseIssue[] {
  const fallbackId = `case#${String(index)}`;
  const issues: BenchmarkCaseIssue[] = [];
  if (!isRecord(source)) {
    return [{ caseId: fallbackId, field: 'case', message: 'A benchmark case must be an object.' }];
  }
  const caseId =
    typeof source['id'] === 'string' && source['id'].length > 0 ? source['id'] : fallbackId;

  if (source['version'] !== BENCHMARK_CASE_VERSION) {
    issues.push({
      caseId,
      field: 'version',
      message: `Only "${BENCHMARK_CASE_VERSION}" is understood; found ${JSON.stringify(source['version'])}.`,
    });
  }
  textIssue(issues, caseId, 'id', source['id'], BENCHMARK_LIMITS.maxIdLength, true);
  textIssue(issues, caseId, 'title', source['title'], 300, true);

  const stratum = source['stratum'];
  if (typeof stratum !== 'string' || !STRATUM_SET.has(stratum)) {
    issues.push({ caseId, field: 'stratum', message: 'Must be a declared benchmark stratum.' });
  }

  if (!isRecord(source['provenance'])) {
    issues.push({
      caseId,
      field: 'provenance',
      message: 'A case without provenance cannot be scored, only reported as invalid.',
    });
  } else {
    const provenance = source['provenance'];
    textIssue(issues, caseId, 'provenance.origin', provenance['origin'], 1000, true);
    if (provenance['authorizedForStorage'] !== true) {
      issues.push({
        caseId,
        field: 'provenance.authorizedForStorage',
        message:
          'The reviewer must state that the material is authorized to store here. Unverified permission is not permission.',
      });
    }
    textIssue(
      issues,
      caseId,
      'provenance.reviewedBy',
      isList(provenance['reviewedBy']) && typeof provenance['reviewedBy'][0] === 'string'
        ? (provenance['reviewedBy'][0] as string)
        : undefined,
      200,
      true,
    );
    if (!isList(provenance['reviewedBy']) || provenance['reviewedBy'].length === 0) {
      issues.push({
        caseId,
        field: 'provenance.reviewedBy',
        message: 'At least one named reviewer is required.',
      });
    }
    textIssue(issues, caseId, 'provenance.reviewedAt', provenance['reviewedAt'], 40, true);
    textIssue(issues, caseId, 'provenance.limitation', provenance['limitation'], 2000, true);
  }

  if (!isRecord(source['input'])) {
    issues.push({ caseId, field: 'input', message: 'The frozen input pack is required.' });
  } else {
    const input = source['input'];
    textIssue(
      issues,
      caseId,
      'input.claimText',
      input['claimText'],
      BENCHMARK_LIMITS.maxTextLength,
      true,
    );
    textIssue(issues, caseId, 'input.providerLabel', input['providerLabel'], 200, true);
    textIssue(issues, caseId, 'input.locale', input['locale'], 35, true);
    textIssue(issues, caseId, 'input.citationCapture', input['citationCapture'], 40, true);
    if (input['answerText'] !== null && typeof input['answerText'] !== 'string') {
      issues.push({
        caseId,
        field: 'input.answerText',
        message: 'Must be a string or null.',
      });
    }
    if (isList(input['propositions'])) {
      boundedInteger(
        issues,
        caseId,
        'input.propositions',
        input['propositions'],
        BENCHMARK_LIMITS.maxPropositions,
      );
      const ids = uniqueIds(
        issues,
        caseId,
        'input.propositions',
        input['propositions'] as { id: unknown }[],
      );
      for (const proposition of input['propositions'] as Record<string, unknown>[]) {
        if (!isRecord(proposition)) {
          issues.push({
            caseId,
            field: 'input.propositions',
            message: 'Each proposition must be an object.',
          });
          continue;
        }
        textIssue(issues, caseId, 'input.propositions.text', proposition['text'], 2000, true);
        if (!isList(proposition['evidence'])) {
          issues.push({
            caseId,
            field: 'input.propositions.evidence',
            message:
              'A proposition must carry the recorded relationships, which may be an empty list.',
          });
        }
      }
      if (ids.size === 0) {
        issues.push({
          caseId,
          field: 'input.propositions',
          message: 'At least one proposition is required.',
        });
      }
    } else {
      issues.push({ caseId, field: 'input.propositions', message: 'Must be an array.' });
    }
    if (isList(input['statements'])) {
      boundedInteger(
        issues,
        caseId,
        'input.statements',
        input['statements'],
        BENCHMARK_LIMITS.maxStatements,
      );
      const statementIds = uniqueIds(
        issues,
        caseId,
        'input.statements',
        input['statements'] as { id: unknown }[],
      );
      const citationIds = isList(input['citations'])
        ? new Set(
            (input['citations'] as Record<string, unknown>[])
              .map((citation) => citation['id'])
              .filter((id): id is string => typeof id === 'string'),
          )
        : new Set<string>();
      const propositionIds = isList(input['propositions'])
        ? new Set(
            (input['propositions'] as Record<string, unknown>[])
              .map((proposition) => proposition['id'])
              .filter((id): id is string => typeof id === 'string'),
          )
        : new Set<string>();
      for (const statement of input['statements'] as Record<string, unknown>[]) {
        if (!isRecord(statement)) {
          continue;
        }
        textIssue(issues, caseId, 'input.statements.text', statement['text'], 4000, true);
        textIssue(issues, caseId, 'input.statements.relevance', statement['relevance'], 60, true);
        for (const id of Array.isArray(statement['propositionIds'])
          ? statement['propositionIds']
          : []) {
          if (typeof id === 'string' && !propositionIds.has(id)) {
            issues.push({
              caseId,
              field: 'input.statements.propositionIds',
              message: `Statement "${String(statement['id'])}" refers to unknown proposition "${id}".`,
            });
          }
        }
        for (const id of Array.isArray(statement['citationIds']) ? statement['citationIds'] : []) {
          if (typeof id === 'string' && !citationIds.has(id)) {
            issues.push({
              caseId,
              field: 'input.statements.citationIds',
              message: `Statement "${String(statement['id'])}" refers to unknown citation "${id}".`,
            });
          }
        }
      }
      if (statementIds.size === 0 && typeof input['answerText'] === 'string') {
        issues.push({
          caseId,
          field: 'input.statements',
          message:
            'An answer was captured but no statement was decomposed. Use a null answerText for an unavailable answer instead of leaving statements empty.',
        });
      }
    } else {
      issues.push({ caseId, field: 'input.statements', message: 'Must be an array.' });
    }
    if (isList(input['citations'])) {
      boundedInteger(
        issues,
        caseId,
        'input.citations',
        input['citations'],
        BENCHMARK_LIMITS.maxCitations,
      );
      uniqueIds(issues, caseId, 'input.citations', input['citations'] as { id: unknown }[]);
      for (const citation of input['citations'] as Record<string, unknown>[]) {
        if (!isRecord(citation)) {
          continue;
        }
        textIssue(issues, caseId, 'input.citations.url', citation['url'], 2048, true);
        if (typeof citation['supportsStatement'] !== 'boolean') {
          issues.push({
            caseId,
            field: 'input.citations.supportsStatement',
            message: 'The reviewer must record whether the cited material supports the statement.',
          });
        }
      }
    } else {
      issues.push({ caseId, field: 'input.citations', message: 'Must be an array.' });
    }
  }

  if (!isList(source['expected'])) {
    issues.push({ caseId, field: 'expected', message: 'At least one gold label is required.' });
  } else {
    boundedInteger(issues, caseId, 'expected', source['expected'], BENCHMARK_LIMITS.maxExpected);
    if (source['expected'].length === 0) {
      issues.push({ caseId, field: 'expected', message: 'At least one gold label is required.' });
    }
    for (const entry of source['expected'] as Record<string, unknown>[]) {
      if (!isRecord(entry)) {
        issues.push({ caseId, field: 'expected', message: 'Each gold label must be an object.' });
        continue;
      }
      if (typeof entry['dimension'] !== 'string' || !DIMENSION_SET.has(entry['dimension'])) {
        issues.push({
          caseId,
          field: 'expected.dimension',
          message: 'Must be a scored dimension.',
        });
      }
      textIssue(issues, caseId, 'expected.label', entry['label'], 60, true);
      textIssue(issues, caseId, 'expected.subjectId', entry['subjectId'], 120, true);
      textIssue(issues, caseId, 'expected.rationale', entry['rationale'], 4000, true);
    }
  }

  if (!isList(source['reviewerLabels'])) {
    issues.push({ caseId, field: 'reviewerLabels', message: 'Must be an array, possibly empty.' });
  } else {
    boundedInteger(
      issues,
      caseId,
      'reviewerLabels',
      source['reviewerLabels'],
      BENCHMARK_LIMITS.maxReviewers,
    );
    for (const entry of source['reviewerLabels'] as Record<string, unknown>[]) {
      if (!isRecord(entry)) {
        issues.push({
          caseId,
          field: 'reviewerLabels',
          message: 'Each reviewer label must be an object.',
        });
        continue;
      }
      textIssue(issues, caseId, 'reviewerLabels.reviewer', entry['reviewer'], 200, true);
      if (typeof entry['dimension'] !== 'string' || !DIMENSION_SET.has(entry['dimension'])) {
        issues.push({
          caseId,
          field: 'reviewerLabels.dimension',
          message: 'Must be a scored dimension.',
        });
      }
      textIssue(issues, caseId, 'reviewerLabels.label', entry['label'], 60, true);
      textIssue(issues, caseId, 'reviewerLabels.subjectId', entry['subjectId'], 120, true);
    }
  }

  if (source['adjudication'] !== null) {
    if (!isRecord(source['adjudication'])) {
      issues.push({ caseId, field: 'adjudication', message: 'Must be an object or null.' });
    } else {
      const adjudication = source['adjudication'];
      if (
        adjudication['outcome'] !== 'RESOLVED' &&
        adjudication['outcome'] !== 'GENUINELY_AMBIGUOUS'
      ) {
        issues.push({
          caseId,
          field: 'adjudication.outcome',
          message: 'Must be RESOLVED or GENUINELY_AMBIGUOUS.',
        });
      }
      textIssue(issues, caseId, 'adjudication.reason', adjudication['reason'], 4000, true);
      textIssue(
        issues,
        caseId,
        'adjudication.adjudicatedBy',
        adjudication['adjudicatedBy'],
        200,
        true,
      );
    }
  }

  if (!isList(source['limitations'])) {
    issues.push({ caseId, field: 'limitations', message: 'Must be an array, possibly empty.' });
  }

  return issues;
}

/**
 * Validate a parsed corpus and report which required strata are absent. A corpus missing a stratum
 * does not pass: silent under-coverage is how a benchmark becomes decoration.
 */
export function validateBenchmarkCorpus(
  sources: readonly { readonly index: number; readonly value: unknown }[],
): BenchmarkCorpusValidation {
  const cases: BenchmarkCase[] = [];
  const issues: BenchmarkCaseIssue[] = [];
  const ids = new Set<string>();
  for (const entry of sources) {
    const entryIssues = validateBenchmarkCase(entry.value, entry.index);
    issues.push(...entryIssues);
    if (entryIssues.length === 0 && isRecord(entry.value)) {
      const id = String((entry.value as Record<string, unknown>)['id']);
      if (ids.has(id)) {
        issues.push({
          caseId: id,
          field: 'id',
          message: 'Duplicate case identifier in the corpus.',
        });
        continue;
      }
      ids.add(id);
      cases.push(entry.value as unknown as BenchmarkCase);
    }
  }
  const strataPresent = [
    ...new Set(cases.map((benchmarkCase) => benchmarkCase.stratum)),
  ].sort() as BenchmarkStratum[];
  const present = new Set<string>(strataPresent);
  const strataMissing = BENCHMARK_STRATA.filter((stratum) => !present.has(stratum));
  return {
    cases,
    issues,
    strataPresent,
    strataMissing,
    caseCount: cases.length,
  };
}
