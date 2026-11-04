/**
 * Review provenance primitives (ADR-027): reviewer identity, the declared roster, the provenance a merged
 * label carries, the hash that binds an adjudication to one disagreement, and the single rule that decides
 * whether an adjudication still settles.
 *
 * This module is pure and offline — it reads parsed case data and returns plain values. It never reaches a
 * network, a database or a clock, and it never invents a reviewer, a timestamp, a rationale or a permission.
 *
 * It deliberately does **not** import `review.ts`: `review.ts` depends on this module, so importing back
 * would create a cycle. Everything that needs a packet hash is handed one by its caller.
 *
 * The honesty boundary for the whole file: reviewer names are operator-asserted. Canonicalising them
 * collapses spelling variants; it cannot prove two distinct names are two distinct humans, and no output
 * derived here may claim independence, authentication or verified identity.
 */
import type {
  AnnotationSubmission,
  BenchmarkAdjudication,
  BenchmarkCase,
  BenchmarkDimension,
  BenchmarkReviewerLabel,
  SubmissionAnnotation,
} from './types.ts';
import { contentHash } from './hashing.ts';

/**
 * Canonical form of an operator-asserted reviewer name.
 *
 * Case is folded and whitespace runs collapse to a single space, so `SAM`, `sam ` and `Sam` are one identity
 * rather than three reviewers. This matters because a subject needs two *distinct* reviewer identities before
 * a shared label may be called agreement: without canonicalisation a single person relabelling themselves
 * with a different capitalisation manufactures a consensus the reviewers never had.
 *
 * `toLowerCase` is used rather than `toLocaleLowerCase` because a locale-dependent fold would make the same
 * corpus produce different agreement figures on two machines.
 *
 * A blank name has no identity and returns `''`, so an empty reviewer can never match a real one. The
 * parameter is `unknown` deliberately: this is fed straight from parsed JSON in several paths, and a
 * wrong-typed name must read as *no identity* rather than throw.
 */
export function reviewerIdentity(name: unknown): string {
  if (typeof name !== 'string') {
    return '';
  }
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** True when two names, as recorded, denote the same canonical reviewer identity. */
export function isSameReviewer(left: unknown, right: unknown): boolean {
  const canonical = reviewerIdentity(left);
  return canonical.length > 0 && canonical === reviewerIdentity(right);
}

/**
 * The minimum a roster question needs: who the case declares, and who actually labelled.
 *
 * A full `BenchmarkCase` cannot be assumed here. A case carrying a label from an undeclared reviewer is
 * refused by the corpus validator, so a roster report built only on validated cases would never see the one
 * problem it exists to surface. Working from this structural view lets a report describe a broken case
 * without pretending it is scoreable.
 */
export interface RosterView {
  readonly provenance: { readonly reviewedBy: readonly string[] };
  readonly reviewerLabels: readonly { readonly reviewer: unknown }[];
}

/**
 * Any entry that names a reviewer, which is all a roster comparison needs.
 *
 * Deliberately looser than `reviewerLabelsOf`: a roster report is built from a parsed file that may be
 * invalid as a case (that is the point of reporting it) and may legitimately carry only the reviewer name.
 * Requiring the full label shape here would silently report "nobody labelled this case" for exactly the
 * broken file the report exists to catch.
 */
function rosterNames(view: RosterView): readonly string[] {
  return asArray<unknown>(view.reviewerLabels)
    .map((entry) =>
      typeof entry === 'object' && entry !== null
        ? (entry as Record<string, unknown>)['reviewer']
        : undefined,
    )
    .filter((name): name is string => typeof name === 'string');
}

export function rosterNamesOf(view: RosterView): readonly string[] {
  return rosterNames(view);
}

/**
 * Tolerant readers for case fields a caller may have parsed straight out of a half-written file.
 *
 * `BenchmarkCase` declares these arrays as present, and the corpus validator enforces that. But
 * `mergeSubmission`, `disagreementReport`, `auditCorpus`, the batch planner and the release builder are
 * exported functions that a caller can hand parsed JSON directly, and a `TypeError` there replaces an
 * auditable refusal with a stack trace. Reading through these helpers means a broken file yields an empty
 * list — reported as *nothing recorded* — rather than a crash or a fabricated value.
 */
function asArray<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function hasDimensionAndSubject(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && 'dimension' in value && 'subjectId' in value
  );
}

/** The reviewer labels actually recorded, ignoring malformed entries. */
export function reviewerLabelsOf(view: RosterView): readonly BenchmarkReviewerLabel[] {
  return asArray<unknown>(view.reviewerLabels)
    .filter(isLabelShape)
    .map((label) => label as BenchmarkReviewerLabel);
}

/** A label entry has to be an object carrying all five contract fields as strings. */
function isLabelShape(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record['reviewer'] === 'string' &&
    typeof record['dimension'] === 'string' &&
    typeof record['label'] === 'string' &&
    typeof record['subjectId'] === 'string'
  );
}

/** The adjudications actually recorded, ignoring malformed entries. */
export function adjudicationsOf(benchmarkCase: BenchmarkCase): readonly BenchmarkAdjudication[] {
  return asArray<BenchmarkAdjudication>(benchmarkCase.adjudications).filter(
    (entry) => typeof entry === 'object' && entry !== null,
  );
}

/** The reviewer identities that labelled, from any view; malformed entries are skipped. */
export function labelledIdentitiesOf(view: RosterView): readonly string[] {
  const identities = rosterNames(view)
    .map(reviewerIdentity)
    .filter((identity) => identity.length > 0);
  return [...new Set(identities)].sort(compareStrings);
}

/** The names a case declares as its reviewers; a non-array roster reads as an empty one. */
function declaredNameList(view: RosterView): readonly string[] {
  return asArray<unknown>(view.provenance?.reviewedBy)
    .filter((name): name is string => typeof name === 'string')
    .map(reviewerIdentity)
    .filter((identity) => identity.length > 0);
}

/** Canonical reviewer identities that labelled a case, sorted for determinism. */
export function labelledReviewerIdentities(benchmarkCase: BenchmarkCase): readonly string[] {
  return labelledIdentitiesOf(benchmarkCase);
}

/**
 * Deterministic string ordering by code unit.
 *
 * `localeCompare` is deliberately avoided anywhere a sorted result feeds a hash or a comparison a release
 * depends on: locale-aware collation can order the same strings differently on two machines, which would
 * make one corpus produce two different state hashes and two different manifests.
 */
export function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * The reviewer roster the case itself declares, canonicalised, de-duplicated and sorted.
 *
 * `provenance.reviewedBy` is the only authorisation record the offline workflow has. It is a human statement
 * about who may review this case; nothing here can add to it, and an empty roster means nobody is authorised
 * rather than that anybody is.
 */
export function declaredRoster(view: RosterView): readonly string[] {
  return [...new Set(declaredNameList(view))].sort(compareStrings);
}

/**
 * Whether a canonical reviewer identity is authorised by the case's declared roster.
 *
 * An empty roster authorises nobody: accepting the first submission would be the tool deciding who may
 * review, which is a human authorisation decision this application must not make for the owner.
 */
export function isDeclaredReviewer(view: RosterView, reviewerKey: string): boolean {
  return reviewerKey.length > 0 && declaredRoster(view).includes(reviewerKey);
}

/**
 * One place that decides whether a canonical reviewer identity settled a subject, and whether the decision
 * still binds the disagreement it was written against.
 *
 * `MATCHING` — the record's hash equals the current state hash, so it settles.
 * `STALE` — some record for this subject carries a hash and none matches, so the split moved after the
 *   decision was written. It does **not** settle the subject, and a bound record outranks an unbound one so a
 *   drifted decision cannot be masked by an older entry.
 * `UNBOUND` — only a legacy (v0.6) record exists. It settles as it did before, and is reported as predating
 *   binding: honoured, never presented as verified provenance.
 * `null` — nothing has been adjudicated for this subject.
 */
export type { AdjudicationBinding } from './types.ts';
import type { AdjudicationBinding } from './types.ts';

export interface SettlingAdjudication {
  readonly adjudication: BenchmarkAdjudication | undefined;
  readonly binding: AdjudicationBinding | null;
}

/** The exact reviewer-disagreement state an adjudication binds to. */
export interface DisagreementState {
  readonly packetHash: string;
  readonly dimension: BenchmarkDimension;
  readonly subjectId: string;
  readonly entries: readonly { readonly reviewerKey: string; readonly label: string }[];
}

/**
 * Hash of one subject's disagreement state.
 *
 * It covers the frozen input (through the packet hash), the dimension and subject, and every reviewer label
 * recorded for that subject. So the hash moves when the input is edited, when a reviewer changes or withdraws
 * a label, or when another reviewer joins — which is what lets the application reject an adjudication written
 * against a split that no longer exists, instead of letting it silently settle a different one.
 *
 * How many adjudications already exist is deliberately **not** covered. A decision must keep binding the split
 * it settled, or filing it would instantly make it stale; filing a second decision on the same split is
 * already refused because the first one moves the subject out of `UNRESOLVED`.
 */
export function disagreementStateHash(state: DisagreementState): string {
  return contentHash({
    packetHash: state.packetHash,
    dimension: state.dimension,
    subjectId: state.subjectId,
    entries: [...state.entries]
      .map((entry) => ({ reviewerKey: entry.reviewerKey, label: entry.label }))
      .sort(
        (left, right) =>
          compareStrings(left.reviewerKey, right.reviewerKey) ||
          compareStrings(left.label, right.label),
      ),
  });
}

/** The reviewer labels recorded for one subject, reduced to the canonical identity and label only. */
export function subjectLabelEntries(
  benchmarkCase: BenchmarkCase,
  dimension: BenchmarkDimension,
  subjectId: string,
): readonly { readonly reviewerKey: string; readonly label: string }[] {
  const matching = asArray<BenchmarkReviewerLabel>(benchmarkCase.reviewerLabels)
    .filter(
      (label) =>
        typeof label === 'object' &&
        label !== null &&
        label.dimension === dimension &&
        label.subjectId === subjectId,
    )
    .map((label) => ({ reviewerKey: reviewerIdentity(label.reviewer), label: label.label }));
  return matching.sort(
    (left, right) =>
      compareStrings(left.reviewerKey, right.reviewerKey) ||
      compareStrings(left.label, right.label),
  );
}

/** True when a value looks like one reviewer label entry, so callers can skip malformed rows. */
export function isLabelLike(value: unknown): boolean {
  return hasDimensionAndSubject(value) && 'reviewer' in (value as object);
}

/** How many adjudications the case already records for this subject, in stored order. */
export function adjudicationsFor(
  benchmarkCase: BenchmarkCase,
  dimension: BenchmarkDimension,
  subjectId: string,
): readonly BenchmarkAdjudication[] {
  return adjudicationsOf(benchmarkCase).filter(
    (entry) => entry.dimension === dimension && entry.subjectId === subjectId,
  );
}

/**
 * Resolve which adjudication settles one subject, and whether it still binds.
 *
 * Both the disagreement report and the benchmark scorer must use this, or the two would disagree about
 * whether a subject is settled — a split reported as unresolved in one view and resolved in the other is how
 * a stale decision quietly becomes a number.
 *
 * A v1 case's unscoped `adjudication` field is honoured only when the case disagrees on exactly one subject,
 * preserving the v0.6 rule; such a record is unbound by construction.
 */
export function resolveSettlingAdjudication(
  benchmarkCase: BenchmarkCase,
  packetHash: string,
  dimension: BenchmarkDimension,
  subjectId: string,
  disagreementCount: number,
): SettlingAdjudication {
  const records = adjudicationsFor(benchmarkCase, dimension, subjectId);
  if (records.length > 0) {
    const currentHash = disagreementStateHash({
      packetHash,
      dimension,
      subjectId,
      entries: subjectLabelEntries(benchmarkCase, dimension, subjectId),
    });
    const matching = records.filter(
      (record) =>
        typeof record.disagreementHash === 'string' && record.disagreementHash === currentHash,
    );
    if (matching.length > 0) {
      // The last matching record wins: an append-only history keeps earlier attempts visible, and the
      // newest filed decision is the one that reflects the current state.
      return { adjudication: matching[matching.length - 1], binding: 'MATCHING' };
    }
    const bound = records.filter((record) => typeof record.disagreementHash === 'string');
    if (bound.length > 0) {
      return { adjudication: bound[bound.length - 1], binding: 'STALE' };
    }
    return { adjudication: records[records.length - 1], binding: 'UNBOUND' };
  }

  // A v1 unscoped record: still honoured for exactly one disagreement, and always unbound.
  const legacy = benchmarkCase.adjudication;
  if (legacy !== undefined && legacy !== null && disagreementCount === 1) {
    return {
      adjudication: {
        dimension,
        subjectId,
        outcome: legacy.outcome,
        // A v1 record names no settled label, so a resolved v1 adjudication cannot become a gold label.
        label: null,
        reason: legacy.reason,
        adjudicatedBy: legacy.adjudicatedBy,
      },
      binding: 'UNBOUND',
    };
  }
  return { adjudication: undefined, binding: null };
}

/** The provenance a merged reviewer label carries, so nothing the human supplied is lost. */
export interface LabelProvenance {
  readonly reviewerKey: string;
  readonly submittedAt: string;
  readonly packetHash: string;
  readonly submissionHash: string;
}

/**
 * Hash of one submission record exactly as it was parsed.
 *
 * Two labels from one file share this value, so a reader can tell which labels arrived together and can
 * detect that the same submission was imported twice. It is an integrity check on the file, not a signature:
 * it proves nothing about who wrote it.
 */
export function submissionHash(submission: AnnotationSubmission): string {
  return contentHash(submission);
}

/**
 * Build one reviewer label so it keeps the rationale, the human-supplied timestamp and the packet binding.
 *
 * v0.6 validated the rationale and the timestamp, then wrote `note: null` and discarded both. `note` is left
 * `null` here and stays the free-form slot it always was; the rubric rationale is taken from the annotation
 * itself — the one place it exists — so there is no second copy that could disagree. An older case with a
 * hand-written note still reads correctly.
 */
export function reviewerLabelFromAnnotation(
  annotation: SubmissionAnnotation,
  provenance: LabelProvenance,
): BenchmarkReviewerLabel {
  return {
    // Canonicalised here as well as at the call site, so a raw spelling can never reach stored provenance.
    reviewer: reviewerIdentity(provenance.reviewerKey),
    dimension: annotation.dimension,
    label: annotation.label,
    subjectId: annotation.subjectId,
    note: null,
    rationale: annotation.rationale,
    submittedAt: provenance.submittedAt,
    packetHash: provenance.packetHash,
    submissionHash: provenance.submissionHash,
  };
}
