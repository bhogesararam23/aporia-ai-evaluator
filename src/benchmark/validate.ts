import { CLAIM_RELEVANCES } from '../core/answerClaims.ts';
import {
  EVIDENCE_RELATIONS,
  PROPOSITION_STATUSES,
  SOURCE_INDEPENDENCE,
  SOURCE_TYPES,
} from '../core/vocabulary.ts';
import { httpUrl } from '../core/validation.ts';
import {
  BENCHMARK_CASE_VERSION,
  BENCHMARK_CASE_VERSION_V1,
  BENCHMARK_DIMENSIONS,
  BENCHMARK_STRATA,
  type BenchmarkCase,
  type BenchmarkCaseIssue,
  type BenchmarkCorpusValidation,
  type BenchmarkDimension,
  type BenchmarkStratum,
} from './types.ts';
import { reviewerIdentity } from './provenance.ts';
import { unsafeIdReason } from './naming.ts';
import { isContentHash, MAX_CANONICAL_DEPTH, nestsDeeperThan } from './hashing.ts';
/**
 * Bounds a hostile or careless corpus file can be forced to respect at load time.
 *
 * These are enforced here, in the validator, not only in the command-line loader. A caller that reads
 * a corpus any other way still gets the same ceiling, which was not true while the byte caps lived
 * only in `scripts/benchmark.ts`.
 *
 * v0.8 names the two ceilings a bounded read actually needs. `maxFiles` replaces the file-count check that
 * used to borrow `maxCases` — a number of files and a number of cases are different quantities, because one
 * file may hold an array of cases. `maxNestingDepth` names the canonicaliser's own bound rather than leaving
 * it implicit, so a loader can refuse an over-deep document with the limit in the message. No existing
 * ceiling is loosened: the commands that had none become as strict as the one that did.
 */
export const BENCHMARK_LIMITS = {
  maxFiles: 5000,
  maxCases: 5000,
  maxCaseBytes: 262_144,
  maxCorpusBytes: 8_388_608,
  maxNestingDepth: MAX_CANONICAL_DEPTH,
  maxIdLength: 120,
  maxTextLength: 8000,
  maxAnswerLength: 100_000,
  maxPropositions: 200,
  maxStatements: 500,
  maxCitations: 200,
  maxExpected: 400,
  maxReviewers: 40,
  maxEvidencePerProposition: 100,
  maxReferencesPerStatement: 200,
  maxLimitations: 50,
  maxUnverified: 50,
  maxAdjudications: 200,
  maxNoteLength: 2000,
} as const;

/**
 * The label vocabulary each scored dimension may use.
 *
 * `EVIDENCE_SUPPORT` is judged on the deterministic evidence status of a proposition; the other three
 * are human judgements on a recorded statement. Binding a dimension to its own vocabulary is what
 * stops an `ANSWER_FIDELITY` gold label of `SUPPORTED` scoring as a clean miss against a value the
 * scorer could never produce.
 */
const DIMENSION_LABELS: Record<BenchmarkDimension, readonly string[]> = {
  EVIDENCE_SUPPORT: PROPOSITION_STATUSES,
  ANSWER_FIDELITY: [
    'ACCURATE',
    'PARTIALLY_ACCURATE',
    'CONTRADICTED',
    'UNSUPPORTED',
    'NOT_ASSESSABLE',
  ],
  CITATION_SUPPORT: ['SUPPORTED', 'PARTIALLY_SUPPORTED', 'NOT_SUPPORTED', 'NOT_ASSESSABLE'],
  ATTRIBUTION: ['CORRECT', 'PARTIALLY_CORRECT', 'INCORRECT', 'NOT_ADDRESSED', 'NOT_ASSESSABLE'],
};

/**
 * The label vocabulary for a scored dimension, exported so the review-merge path validates a
 * submission label against the same list the corpus validator uses, rather than a second copy that
 * could drift.
 */
export function benchmarkDimensionLabels(dimension: BenchmarkDimension): readonly string[] {
  return DIMENSION_LABELS[dimension] ?? [];
}

/**
 * Which object a dimension's label judges.
 *
 * Evidence support is a property of a proposition; fidelity, citation support and attribution are
 * properties of a recorded answer statement. A subject id pointing at the wrong kind of object is a
 * case-authoring error that silently removes the label from every statistic, which is worse than a
 * failure.
 */
const DIMENSION_SUBJECT_KIND: Record<BenchmarkDimension, 'proposition' | 'statement'> = {
  EVIDENCE_SUPPORT: 'proposition',
  ANSWER_FIDELITY: 'statement',
  CITATION_SUPPORT: 'statement',
  ATTRIBUTION: 'statement',
};

const CITATION_CAPTURES = ['CAPTURED', 'NOT_SHOWN', 'UNKNOWN'] as const;
const STRATUM_SET = new Set<string>(BENCHMARK_STRATA);
const DIMENSION_SET = new Set<string>(BENCHMARK_DIMENSIONS);
const RELEVANCE_SET = new Set<string>(CLAIM_RELEVANCES);
const RELATION_SET = new Set<string>(EVIDENCE_RELATIONS);
const SOURCE_TYPE_SET = new Set<string>(SOURCE_TYPES);
const INDEPENDENCE_SET = new Set<string>(SOURCE_INDEPENDENCE);
const CAPTURE_SET = new Set<string>(CITATION_CAPTURES);
/** Versions of the case contract this build can read. */
const ACCEPTED_VERSIONS = new Set<string>([BENCHMARK_CASE_VERSION, BENCHMARK_CASE_VERSION_V1]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/** A readable element address, so an issue names the entry it belongs to. */
function at(field: string, id: unknown, fallback: number): string {
  const label = typeof id === 'string' && id.length > 0 ? id : `#${String(fallback)}`;
  return `${field}[${label}]`;
}

class Report {
  readonly issues: BenchmarkCaseIssue[] = [];
  private readonly caseId: string;

  constructor(caseId: string) {
    this.caseId = caseId;
  }

  push(field: string, message: string): void {
    this.issues.push({ caseId: this.caseId, field, message });
  }

  /** A string that must be present, non-blank, and within its ceiling. */
  text(field: string, value: unknown, maxLength: number, required = true): void {
    if (typeof value !== 'string') {
      this.push(field, 'Must be a string.');
      return;
    }
    if (value.trim().length === 0) {
      if (required) {
        this.push(field, 'Must not be empty.');
      }
      return;
    }
    if (value.length > maxLength) {
      this.push(field, `Must be ${String(maxLength)} characters or fewer.`);
    }
  }

  /** A value from a controlled vocabulary. Silently invalid tokens are the bug this closes. */
  enumeration(field: string, value: unknown, allowed: Set<string>, naming: string): void {
    if (typeof value !== 'string') {
      this.push(field, 'Must be a string.');
      return;
    }
    if (!allowed.has(value)) {
      this.push(field, `${naming}: found "${value}".`);
    }
  }

  /** An array whose entries must all be objects, with no silent skip. */
  records(field: string, value: unknown, max: number): Record<string, unknown>[] {
    if (!isList(value)) {
      this.push(field, 'Must be an array.');
      return [];
    }
    if (value.length > max) {
      this.push(field, `Must hold ${String(max)} items or fewer.`);
    }
    const entries: Record<string, unknown>[] = [];
    value.forEach((entry, index) => {
      if (isRecord(entry)) {
        entries.push(entry);
        return;
      }
      this.push(at(field, entry, index), 'Each entry must be an object.');
    });
    return entries;
  }

  /** An array of strings, each bounded. A list of objects is not a list of limitations. */
  strings(field: string, value: unknown, maxLength: number, max: number): string[] {
    if (!isList(value)) {
      this.push(field, 'Must be an array.');
      return [];
    }
    if (value.length > max) {
      this.push(field, `Must hold ${String(max)} items or fewer.`);
    }
    const kept: string[] = [];
    value.forEach((entry, index) => {
      if (typeof entry !== 'string') {
        this.push(`${field}[${String(index)}]`, 'Must be a string.');
        return;
      }
      if (entry.trim().length === 0) {
        this.push(`${field}[${String(index)}]`, 'Must not be empty.');
        return;
      }
      if (entry.length > maxLength) {
        this.push(
          `${field}[${String(index)}]`,
          `Must be ${String(maxLength)} characters or fewer.`,
        );
        return;
      }
      kept.push(entry);
    });
    return kept;
  }

  /** Collect the ids of a list of entries, reporting duplicates rather than collapsing them. */
  ids(field: string, entries: readonly Record<string, unknown>[]): Set<string> {
    const seen = new Set<string>();
    entries.forEach((entry, index) => {
      const id = entry['id'];
      if (typeof id !== 'string' || id.trim().length === 0) {
        this.push(at(field, id, index), 'Requires a non-empty identifier.');
        return;
      }
      if (id.length > BENCHMARK_LIMITS.maxIdLength) {
        this.push(
          at(field, id, index),
          `Identifier must be ${String(BENCHMARK_LIMITS.maxIdLength)} characters or fewer.`,
        );
      }
      if (seen.has(id)) {
        this.push(field, `Duplicate identifier "${id}".`);
      }
      seen.add(id);
    });
    return seen;
  }

  /** A reference list: an array of strings, each of which must resolve to a known id. */
  references(
    field: string,
    value: unknown,
    known: ReadonlySet<string>,
    naming: string,
    ownerLabel: string,
  ): void {
    if (!isList(value)) {
      this.push(field, 'Must be an array of identifiers.');
      return;
    }
    if (value.length > BENCHMARK_LIMITS.maxReferencesPerStatement) {
      this.push(
        field,
        `Must hold ${String(BENCHMARK_LIMITS.maxReferencesPerStatement)} items or fewer.`,
      );
    }
    const seen = new Set<string>();
    value.forEach((entry, index) => {
      if (typeof entry !== 'string') {
        this.push(`${field}[${String(index)}]`, 'Must be an identifier string.');
        return;
      }
      if (seen.has(entry)) {
        this.push(field, `${ownerLabel} refers to "${entry}" more than once.`);
      }
      seen.add(entry);
      if (!known.has(entry)) {
        this.push(field, `${ownerLabel} refers to unknown ${naming} "${entry}".`);
      }
    });
  }
}

/** Every evidence record on one proposition, validated down to its fields. */
function validateEvidence(
  report: Report,
  propositionField: string,
  evidence: unknown,
  requireSourceId: boolean,
): void {
  const field = `${propositionField}.evidence`;
  const entries = report.records(field, evidence, BENCHMARK_LIMITS.maxEvidencePerProposition);
  report.ids(field, entries);
  for (const [index, entry] of entries.entries()) {
    const where = at(field, entry['id'], index);
    report.text(`${where}.relation`, entry['relation'], 60);
    report.enumeration(
      `${where}.relation`,
      entry['relation'],
      RELATION_SET,
      'Must be a recorded evidence relationship',
    );
    report.text(`${where}.sourceType`, entry['sourceType'], 60);
    report.enumeration(
      `${where}.sourceType`,
      entry['sourceType'],
      SOURCE_TYPE_SET,
      'Must be a declared source type',
    );
    report.text(`${where}.independence`, entry['independence'], 40);
    report.enumeration(
      `${where}.independence`,
      entry['independence'],
      INDEPENDENCE_SET,
      'Must be a declared source-independence value',
    );
    report.text(`${where}.locator`, entry['locator'], BENCHMARK_LIMITS.maxNoteLength);
    if (entry['sourceId'] !== undefined) {
      report.text(`${where}.sourceId`, entry['sourceId'], BENCHMARK_LIMITS.maxIdLength);
    } else if (requireSourceId) {
      // v2 separated the relationship from the source it came from. Without it, two excerpts from one
      // press release are two sources, and the duplicate-and-syndication stratum cannot be tested.
      report.push(
        `${where}.sourceId`,
        'Required on a v2 case. Without an underlying source identity, two excerpts from one source look like two independent sources.',
      );
    }
    // canonicalUri is an optional, additive field (ADR-025 §1 rule 1): when present it must be a
    // real http(s) URL, because `evidence-aggregation-v2` collapses records that share it into one
    // underlying source. Absent or null is fine and is how older files read.
    if (entry['canonicalUri'] !== undefined && entry['canonicalUri'] !== null) {
      const url = httpUrl(entry['canonicalUri'], `${where}.canonicalUri`);
      if (!url.ok) {
        for (const issue of url.issues) {
          report.push(issue.field, issue.message);
        }
      }
    }
  }
}

function validateInput(report: Report, input: unknown, caseVersion: string): void {
  if (!isRecord(input)) {
    report.push('input', 'The frozen input pack is required.');
    return;
  }
  report.text('input.claimText', input['claimText'], BENCHMARK_LIMITS.maxTextLength);
  report.text('input.providerLabel', input['providerLabel'], 200);
  report.text('input.locale', input['locale'], 35);
  report.enumeration(
    'input.citationCapture',
    input['citationCapture'],
    CAPTURE_SET,
    'Must be CAPTURED, NOT_SHOWN or UNKNOWN',
  );
  if (input['answerText'] !== null && typeof input['answerText'] !== 'string') {
    report.push('input.answerText', 'Must be a string or null.');
  } else if (typeof input['answerText'] === 'string') {
    if (input['answerText'].length > BENCHMARK_LIMITS.maxAnswerLength) {
      report.push(
        'input.answerText',
        `Must be ${String(BENCHMARK_LIMITS.maxAnswerLength)} characters or fewer.`,
      );
    }
    if (input['answerText'].trim().length === 0) {
      report.push(
        'input.answerText',
        'An empty string is not an unavailable answer. Use null when the answer could not be captured.',
      );
    }
  }

  const propositions = report.records(
    'input.propositions',
    input['propositions'],
    BENCHMARK_LIMITS.maxPropositions,
  );
  const propositionIds = report.ids('input.propositions', propositions);
  const requireSourceId = caseVersion === BENCHMARK_CASE_VERSION;
  for (const [index, proposition] of propositions.entries()) {
    const where = at('input.propositions', proposition['id'], index);
    report.text(`${where}.text`, proposition['text'], 2000);
    validateEvidence(report, where, proposition['evidence'], requireSourceId);
  }
  if (propositionIds.size === 0) {
    report.push('input.propositions', 'At least one proposition is required.');
  }

  const citations = report.records(
    'input.citations',
    input['citations'],
    BENCHMARK_LIMITS.maxCitations,
  );
  const citationIds = report.ids('input.citations', citations);
  for (const [index, citation] of citations.entries()) {
    const where = at('input.citations', citation['id'], index);
    const url = httpUrl(citation['url'], `${where}.url`);
    if (!url.ok) {
      for (const issue of url.issues) {
        report.push(issue.field, issue.message);
      }
    }
    if (typeof citation['supportsStatement'] !== 'boolean') {
      report.push(
        `${where}.supportsStatement`,
        'The reviewer must record whether the cited material supports the statement.',
      );
    }
    if (citation['note'] !== null && citation['note'] !== undefined) {
      report.text(`${where}.note`, citation['note'], BENCHMARK_LIMITS.maxNoteLength);
    }
  }

  const statements = report.records(
    'input.statements',
    input['statements'],
    BENCHMARK_LIMITS.maxStatements,
  );
  const statementIds = report.ids('input.statements', statements);
  for (const [index, statement] of statements.entries()) {
    const where = at('input.statements', statement['id'], index);
    report.text(`${where}.text`, statement['text'], 4000);
    report.enumeration(
      `${where}.relevance`,
      statement['relevance'],
      RELEVANCE_SET,
      'Must be a recorded statement relevance',
    );
    report.references(
      `${where}.propositionIds`,
      statement['propositionIds'],
      propositionIds,
      'proposition',
      `Statement "${String(statement['id'] ?? index)}"`,
    );
    report.references(
      `${where}.citationIds`,
      statement['citationIds'],
      citationIds,
      'citation',
      `Statement "${String(statement['id'] ?? index)}"`,
    );
    if (
      Array.isArray(statement['citationIds']) &&
      statement['citationIds'].length > 0 &&
      input['citationCapture'] !== 'CAPTURED'
    ) {
      report.push(
        `${where}.citationIds`,
        'The case records that citations were not captured, so no statement can refer to one.',
      );
    }
  }
  if (statementIds.size === 0 && typeof input['answerText'] === 'string') {
    report.push(
      'input.statements',
      'An answer was captured but no statement was decomposed. Use a null answerText for an unavailable answer instead of leaving statements empty.',
    );
  }
  // A case that scores nothing is decoration. Every scored dimension needs something to score on.
  if (caseVersion === BENCHMARK_CASE_VERSION && statements.length > 0 && citations.length === 0) {
    report.push(
      'input.citations',
      'A v2 case with statements must record the citations the reviewer read, even if the answer cited nothing — in that case record it in limitations, not by omitting the array.',
    );
  }
}

function validateProvenance(report: Report, provenance: unknown): Set<string> {
  if (!isRecord(provenance)) {
    report.push(
      'provenance',
      'A case without provenance cannot be scored, only reported as invalid.',
    );
    return new Set<string>();
  }
  report.text('provenance.origin', provenance['origin'], 1000);
  if (provenance['authorizedForStorage'] !== true) {
    report.push(
      'provenance.authorizedForStorage',
      'The reviewer must state that the material is authorized to store here. Unverified permission is not permission.',
    );
  }
  const reviewers = report.strings(
    'provenance.reviewedBy',
    provenance['reviewedBy'],
    200,
    BENCHMARK_LIMITS.maxReviewers,
  );
  if (reviewers.length === 0) {
    report.push('provenance.reviewedBy', 'At least one named reviewer is required.');
  }
  // Compared canonically: `Dana` and `dana ` are one person listed twice, not an authorisation record for
  // two reviewers. `mergeSubmission` also stores canonical identities, so this is the only way a case the
  // tool itself produced can validate against its own roster.
  const canonicalReviewers = reviewers.map(reviewerIdentity);
  if (new Set(canonicalReviewers).size !== canonicalReviewers.length) {
    report.push('provenance.reviewedBy', 'A reviewer is listed more than once.');
  }
  report.text('provenance.reviewedAt', provenance['reviewedAt'], 40);
  // A date nobody can read is a date nobody can audit. The field stays a string in the contract,
  // because a reviewer may record only a day, but it must be a real day: `2026-13-99` has the right
  // shape and no calendar meaning.
  if (typeof provenance['reviewedAt'] === 'string' && provenance['reviewedAt'].trim().length > 0) {
    const trimmed = provenance['reviewedAt'].trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})([T ].*)?$/.exec(trimmed);
    if (match === null) {
      report.push(
        'provenance.reviewedAt',
        'Must begin with an ISO-style date (YYYY-MM-DD) so a later reader can tell when review happened.',
      );
    } else {
      const [, year, month, day] = match;
      const stamp = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0));
      const realDay = Number(day);
      const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
      if (
        Number.isNaN(stamp.getTime()) ||
        Number(month) < 1 ||
        Number(month) > 12 ||
        realDay < 1 ||
        realDay > daysInMonth
      ) {
        report.push(
          'provenance.reviewedAt',
          `"${trimmed}" is not a date on the calendar. Record the day the review actually happened.`,
        );
      }
    }
  }
  report.text('provenance.limitation', provenance['limitation'], 2000);
  report.strings(
    'provenance.unverified',
    provenance['unverified'],
    BENCHMARK_LIMITS.maxNoteLength,
    BENCHMARK_LIMITS.maxUnverified,
  );
  return new Set(canonicalReviewers);
}

function validateExpected(
  report: Report,
  expected: unknown,
  propositionIds: ReadonlySet<string>,
  statementIds: ReadonlySet<string>,
): void {
  const entries = report.records('expected', expected, BENCHMARK_LIMITS.maxExpected);
  if (entries.length === 0) {
    report.push('expected', 'At least one gold label is required.');
  }
  const seen = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const where = at(
      'expected',
      `${String(entry['dimension'] ?? '')}/${String(entry['subjectId'] ?? '')}`,
      index,
    );
    const dimension = entry['dimension'];
    if (typeof dimension !== 'string' || !DIMENSION_SET.has(dimension)) {
      report.push(`${where}.dimension`, 'Must be a scored dimension.');
      continue;
    }
    const asDimension = dimension as BenchmarkDimension;
    report.text(`${where}.rationale`, entry['rationale'], 4000);
    report.text(`${where}.subjectId`, entry['subjectId'], BENCHMARK_LIMITS.maxIdLength);

    const label = entry['label'];
    if (typeof label !== 'string' || !DIMENSION_LABELS[asDimension].includes(label)) {
      report.push(
        `${where}.label`,
        `"${String(label)}" is not a ${asDimension} label. This dimension uses: ${DIMENSION_LABELS[asDimension].join(', ')}.`,
      );
    }

    const subject = entry['subjectId'];
    if (typeof subject === 'string' && subject.length > 0) {
      const known =
        DIMENSION_SUBJECT_KIND[asDimension] === 'proposition' ? propositionIds : statementIds;
      if (!known.has(subject)) {
        report.push(
          `${where}.subjectId`,
          `A ${asDimension} label must judge ${
            DIMENSION_SUBJECT_KIND[asDimension] === 'proposition'
              ? 'a proposition'
              : 'a recorded statement'
          }, and "${subject}" is not one in this case.`,
        );
      }
    }

    const pair = `${dimension}/${String(subject)}`;
    if (seen.has(pair)) {
      report.push(
        'expected',
        `Two gold labels judge the same ${pair}; one of them is guaranteed to count as a miss.`,
      );
    }
    seen.add(pair);
  }
}

function validateReviewerLabels(
  report: Report,
  labels: unknown,
  namedReviewers: ReadonlySet<string>,
  propositionIds: ReadonlySet<string>,
  statementIds: ReadonlySet<string>,
): void {
  const entries = report.records('reviewerLabels', labels, BENCHMARK_LIMITS.maxReviewers * 40);
  for (const [index, entry] of entries.entries()) {
    const where = at('reviewerLabels', entry['reviewer'], index);
    report.text(`${where}.reviewer`, entry['reviewer'], 200);
    const reviewer = entry['reviewer'];
    if (
      typeof reviewer === 'string' &&
      reviewerIdentity(reviewer).length > 0 &&
      !namedReviewers.has(reviewerIdentity(reviewer))
    ) {
      report.push(
        `${where}.reviewer`,
        `"${reviewer}" is not listed in provenance.reviewedBy. A label is credited to a named reviewer of this case; the application has no authentication, so the name is operator-asserted and must still come from the declared set.`,
      );
    }
    const dimension = entry['dimension'];
    if (typeof dimension !== 'string' || !DIMENSION_SET.has(dimension)) {
      report.push(`${where}.dimension`, 'Must be a scored dimension.');
      continue;
    }
    const asDimension = dimension as BenchmarkDimension;
    report.text(`${where}.subjectId`, entry['subjectId'], BENCHMARK_LIMITS.maxIdLength);
    const label = entry['label'];
    if (typeof label !== 'string' || !DIMENSION_LABELS[asDimension].includes(label)) {
      report.push(
        `${where}.label`,
        `"${String(label)}" is not a ${asDimension} label. This dimension uses: ${DIMENSION_LABELS[asDimension].join(', ')}.`,
      );
    }
    const subject = entry['subjectId'];
    if (typeof subject === 'string' && subject.length > 0) {
      const known =
        DIMENSION_SUBJECT_KIND[asDimension] === 'proposition' ? propositionIds : statementIds;
      if (!known.has(subject)) {
        report.push(
          `${where}.subjectId`,
          `A ${asDimension} label must judge ${
            DIMENSION_SUBJECT_KIND[asDimension] === 'proposition'
              ? 'a proposition'
              : 'a recorded statement'
          }, and "${subject}" is not one in this case.`,
        );
      }
    }
    if (entry['note'] !== null && entry['note'] !== undefined) {
      report.text(`${where}.note`, entry['note'], BENCHMARK_LIMITS.maxNoteLength);
    }
    // v0.7 review provenance. Each field is checked only when it is present, so a case written before v0.7
    // reports no new issue: an absent field means *not recorded*, which is a different fact from a recorded
    // empty or malformed one.
    if (entry['rationale'] !== null && entry['rationale'] !== undefined) {
      report.text(`${where}.rationale`, entry['rationale'], 4000);
    }
    if (entry['submittedAt'] !== null && entry['submittedAt'] !== undefined) {
      // Not required to be an instant: a v1 submission stored the value exactly as the reviewer wrote it,
      // and rejecting it now would make an older merged case unreadable.
      report.text(`${where}.submittedAt`, entry['submittedAt'], 60);
    }
    for (const hashField of ['packetHash', 'submissionHash'] as const) {
      const value = entry[hashField];
      if (value !== null && value !== undefined && !isContentHash(value)) {
        report.push(
          `${where}.${hashField}`,
          `Must be a 64-character lowercase SHA-256 digest. A malformed ${hashField} silently defeats the staleness check it exists to support.`,
        );
      }
    }
  }
}

/** The (dimension, subject) pairs whose reviewer labels disagree, and who said what. */
export function disagreementPairs(
  benchmarkCase: BenchmarkCase,
): readonly { dimension: BenchmarkDimension; subjectId: string; labels: readonly string[] }[] {
  const grouped = new Map<
    string,
    { dimension: BenchmarkDimension; subjectId: string; labels: Set<string> }
  >();
  for (const label of benchmarkCase.reviewerLabels ?? []) {
    const key = `${label.dimension}/${label.subjectId}`;
    const entry = grouped.get(key) ?? {
      dimension: label.dimension,
      subjectId: label.subjectId,
      labels: new Set<string>(),
    };
    entry.labels.add(label.label);
    grouped.set(key, entry);
  }
  return [...grouped.values()]
    .filter((entry) => entry.labels.size > 1)
    .map((entry) => ({
      dimension: entry.dimension,
      subjectId: entry.subjectId,
      labels: [...entry.labels].sort(),
    }))
    .sort((left, right) =>
      `${left.dimension}/${left.subjectId}`.localeCompare(`${right.dimension}/${right.subjectId}`),
    );
}

function validateAdjudications(
  report: Report,
  benchmarkCase: Record<string, unknown>,
  caseVersion: string,
  namedReviewers: ReadonlySet<string>,
): void {
  const labelled = new Set<string>();
  for (const entry of [
    ...((benchmarkCase['expected'] as unknown[]) ?? []),
    ...((benchmarkCase['reviewerLabels'] as unknown[]) ?? []),
  ]) {
    if (
      isRecord(entry) &&
      typeof entry['dimension'] === 'string' &&
      typeof entry['subjectId'] === 'string'
    ) {
      labelled.add(`${entry['dimension']}/${entry['subjectId']}`);
    }
  }

  if (caseVersion === BENCHMARK_CASE_VERSION_V1) {
    // A v1 adjudication names no subject. It can be honoured only when at most one disagreement
    // exists; otherwise one decision would silently settle unrelated disputes.
    if (benchmarkCase['adjudication'] === null || benchmarkCase['adjudication'] === undefined) {
      return;
    }
    if (!isRecord(benchmarkCase['adjudication'])) {
      report.push('adjudication', 'Must be an object or null.');
      return;
    }
    const adjudication = benchmarkCase['adjudication'];
    if (
      adjudication['outcome'] !== 'RESOLVED' &&
      adjudication['outcome'] !== 'GENUINELY_AMBIGUOUS'
    ) {
      report.push('adjudication.outcome', 'Must be RESOLVED or GENUINELY_AMBIGUOUS.');
    }
    report.text('adjudication.reason', adjudication['reason'], 4000);
    report.text('adjudication.adjudicatedBy', adjudication['adjudicatedBy'], 200);
    report.push(
      'adjudication',
      'An unscoped adjudication cannot say which subject it settles. On a v2 case, record adjudications per dimension and subject.',
    );
    return;
  }

  if (benchmarkCase['adjudication'] !== undefined && benchmarkCase['adjudication'] !== null) {
    report.push(
      'adjudication',
      'A v2 case uses adjudications, each scoped to a dimension and subject. An unscoped adjudication would mask every disagreement in the case.',
    );
  }
  if (benchmarkCase['adjudications'] === undefined) {
    return;
  }
  const entries = report.records(
    'adjudications',
    benchmarkCase['adjudications'],
    BENCHMARK_LIMITS.maxAdjudications,
  );
  for (const [index, entry] of entries.entries()) {
    const where = at(
      'adjudications',
      `${String(entry['dimension'] ?? '')}/${String(entry['subjectId'] ?? '')}`,
      index,
    );
    const dimension = entry['dimension'];
    if (typeof dimension !== 'string' || !DIMENSION_SET.has(dimension)) {
      report.push(`${where}.dimension`, 'Must be a scored dimension.');
      continue;
    }
    report.text(`${where}.subjectId`, entry['subjectId'], BENCHMARK_LIMITS.maxIdLength);
    if (!labelled.has(`${dimension}/${String(entry['subjectId'])}`)) {
      report.push(
        `${where}.subjectId`,
        'Adjudicates a dimension and subject that neither a gold label nor a reviewer label covers.',
      );
    }
    const outcome = entry['outcome'];
    if (outcome !== 'RESOLVED' && outcome !== 'GENUINELY_AMBIGUOUS') {
      report.push(`${where}.outcome`, 'Must be RESOLVED or GENUINELY_AMBIGUOUS.');
    }
    report.text(`${where}.reason`, entry['reason'], 4000);
    const adjudicatedBy = entry['adjudicatedBy'];
    report.text(`${where}.adjudicatedBy`, adjudicatedBy, 200);
    if (typeof adjudicatedBy === 'string' && !namedReviewers.has(reviewerIdentity(adjudicatedBy))) {
      report.push(
        `${where}.adjudicatedBy`,
        `"${adjudicatedBy}" is not listed in provenance.reviewedBy.`,
      );
    }
    // v0.7 binding. Absent means a v0.6 record: readable, honoured, and reported as unbound by the review
    // workflow rather than rejected here.
    const bindingHash = entry['disagreementHash'];
    if (bindingHash !== null && bindingHash !== undefined && !isContentHash(bindingHash)) {
      report.push(
        `${where}.disagreementHash`,
        'Must be a 64-character lowercase SHA-256 digest of the disagreement this decision settled. A malformed binding can never match, so the subject would read as permanently stale.',
      );
    }
    if (entry['adjudicatedAt'] !== null && entry['adjudicatedAt'] !== undefined) {
      report.text(`${where}.adjudicatedAt`, entry['adjudicatedAt'], 60);
    }
    const label = entry['label'];
    if (outcome === 'RESOLVED') {
      if (
        typeof label !== 'string' ||
        !DIMENSION_LABELS[dimension as BenchmarkDimension].includes(label)
      ) {
        report.push(
          `${where}.label`,
          'A resolved adjudication must record the label it settled on, from this dimension’s vocabulary. A decision that names nothing cannot become a gold label.',
        );
      }
    } else if (outcome === 'GENUINELY_AMBIGUOUS' && label !== null && label !== undefined) {
      report.push(
        `${where}.label`,
        'A genuinely ambiguous adjudication must not carry a label. Choosing one would score an unresolved subject as an ordinary gold verdict.',
      );
    }
  }
}

/**
 * Validate one parsed case. Every check is independent so a single run reports the full set of
 * problems: a partially valid case must never be scored, because a missing rationale or an
 * out-of-vocabulary label changes what a number means.
 */
export function validateBenchmarkCase(source: unknown, index: number): BenchmarkCaseIssue[] {
  const fallbackId = `case#${String(index)}`;
  if (!isRecord(source)) {
    return [{ caseId: fallbackId, field: 'case', message: 'A benchmark case must be an object.' }];
  }
  if (nestsDeeperThan(source, MAX_CANONICAL_DEPTH)) {
    // Refused here rather than blowing the stack later: a document nested past the canonicaliser's bound
    // cannot be hashed, and a case that cannot be hashed cannot appear in a release manifest.
    return [
      {
        caseId: fallbackId,
        field: 'case',
        message: `The case is nested deeper than ${String(MAX_CANONICAL_DEPTH)} levels, which the canonical hasher will not traverse. Flatten it; do not trim it silently.`,
      },
    ];
  }
  const caseId =
    typeof source['id'] === 'string' && source['id'].length > 0 ? source['id'] : fallbackId;
  const report = new Report(caseId);

  const version = source['version'];
  if (typeof version !== 'string' || !ACCEPTED_VERSIONS.has(version)) {
    report.push(
      'version',
      `Only "${BENCHMARK_CASE_VERSION}" and "${BENCHMARK_CASE_VERSION_V1}" are understood; found ${JSON.stringify(version)}.`,
    );
  }
  const caseVersion = typeof version === 'string' ? version : BENCHMARK_CASE_VERSION;

  report.text('id', source['id'], BENCHMARK_LIMITS.maxIdLength);
  if (typeof source['id'] === 'string') {
    // One rule, shared with the writers (`src/benchmark/naming.ts`): a case id is not only a label, it is the
    // file name every publication path derives from it. Checked here as well as at write time because a case
    // that cannot be published should not be accepted into a corpus and discovered only when something tries
    // to write it out.
    const idProblem = unsafeIdReason(source['id']);
    if (idProblem !== null) {
      report.push('id', `A case id becomes a file name in every publication path. ${idProblem}.`);
    }
  }
  report.text('title', source['title'], 300);
  report.enumeration(
    'stratum',
    source['stratum'],
    STRATUM_SET,
    'Must be a declared benchmark stratum',
  );

  const namedReviewers = validateProvenance(report, source['provenance']);
  const input = isRecord(source['input']) ? source['input'] : undefined;
  validateInput(report, source['input'], caseVersion);

  report.strings(
    'limitations',
    source['limitations'],
    BENCHMARK_LIMITS.maxNoteLength,
    BENCHMARK_LIMITS.maxLimitations,
  );

  if (input !== undefined) {
    const propositionIds = new Set<string>(
      (Array.isArray(input['propositions']) ? (input['propositions'] as unknown[]) : [])
        .filter(isRecord)
        .map((proposition) => proposition['id'])
        .filter((id): id is string => typeof id === 'string'),
    );
    const statementIds = new Set<string>(
      (Array.isArray(input['statements']) ? (input['statements'] as unknown[]) : [])
        .filter(isRecord)
        .map((statement) => statement['id'])
        .filter((id): id is string => typeof id === 'string'),
    );
    validateExpected(report, source['expected'], propositionIds, statementIds);
    validateReviewerLabels(
      report,
      source['reviewerLabels'],
      namedReviewers,
      propositionIds,
      statementIds,
    );
    validateAdjudications(report, source, caseVersion, namedReviewers);
  }

  // The byte ceiling belongs to the case, not to the loader that happened to read it.
  const bytes = Buffer.byteLength(JSON.stringify(source), 'utf8');
  if (bytes > BENCHMARK_LIMITS.maxCaseBytes) {
    report.push(
      'case',
      `Serialises to ${String(bytes)} bytes, over the ${String(BENCHMARK_LIMITS.maxCaseBytes)}-byte ceiling for one case.`,
    );
  }

  return report.issues;
}

/**
 * Validate a parsed corpus and report which required strata are absent. A corpus missing a stratum
 * does not pass: silent under-coverage is how a benchmark becomes decoration.
 *
 * A file may hold one case or an array of them. The array is expanded here, in the layer every caller
 * passes through, because a ceiling counted in *files* let one document carry an unbounded number of
 * cases and a per-file digest could not say which case it described.
 */
export function validateBenchmarkCorpus(
  sources: readonly { readonly index: number; readonly value: unknown }[],
): BenchmarkCorpusValidation {
  const cases: BenchmarkCase[] = [];
  const issues: BenchmarkCaseIssue[] = [];
  const ids = new Set<string>();
  const flattened: { index: number; value: unknown }[] = [];
  for (const entry of sources) {
    if (Array.isArray(entry.value)) {
      for (const item of entry.value) {
        flattened.push({ index: flattened.length, value: item });
      }
    } else {
      flattened.push({ index: flattened.length, value: entry.value });
    }
  }
  if (flattened.length > BENCHMARK_LIMITS.maxCases) {
    issues.push({
      caseId: 'corpus',
      field: 'cases',
      message: `The corpus holds ${String(flattened.length)} cases, over the ceiling of ${String(BENCHMARK_LIMITS.maxCases)}.`,
    });
  }
  let corpusBytes = 0;
  for (const entry of flattened) {
    // Counted per case rather than per file, so one document holding a thousand cases cannot slip
    // past a limit written to bound the corpus.
    corpusBytes += Buffer.byteLength(JSON.stringify(entry.value), 'utf8');
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
  if (corpusBytes > BENCHMARK_LIMITS.maxCorpusBytes) {
    issues.push({
      caseId: 'corpus',
      field: 'corpus',
      message: `The corpus serialises to ${String(corpusBytes)} bytes, over the ceiling of ${String(BENCHMARK_LIMITS.maxCorpusBytes)}.`,
    });
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
