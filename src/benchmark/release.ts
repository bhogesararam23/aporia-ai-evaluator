/**
 * Reproducible offline corpus releases (ADR-027).
 *
 * A release answers one question precisely: **is this the exact corpus I reviewed, unchanged?** It does that by
 * hashing canonical case bytes, so a reader can detect an addition, a deletion, or one edited sentence — and
 * by naming the provenance and completeness gaps that still remain.
 *
 * What a hash is not, stated here because a release document is the most likely place for the claim to be
 * over-read: it is an integrity check over recorded content. It authenticates no reviewer, proves no
 * independence, and shows no material is genuine. Reviewer names in a case are operator-asserted and this
 * application has no authentication, so a manifest over forged labels is a faithful description of forged
 * labels. And a complete, consistent, fully-gated corpus is *ready*, not accurate: `accuracyClaimable` is the
 * literal `false` and no gate, coverage figure or agreement rate changes it.
 *
 * Pure and offline: no clock, no filesystem, no absolute paths, no hostname, no environment. The same corpus
 * always produces the same manifest bytes, which is what makes a release auditable after the fact.
 */
import type { BenchmarkCase, BenchmarkCorpusValidation, BenchmarkStratum } from './types.ts';
import {
  BENCHMARK_RELEASE_MANIFEST_VERSION,
  BENCHMARK_CASE_VERSION,
  BENCHMARK_STRATA,
} from './types.ts';
import { contentHash } from './hashing.ts';
import { normaliseCase } from './authoring.ts';
import { disagreementReport, rosterGaps } from './review.ts';
import { compareStrings, declaredRoster, labelledIdentitiesOf } from './provenance.ts';

/** The canonicalisation the digests are defined over. Named so a later change cannot be silent. */
export const RELEASE_ALGORITHM = 'sha256-canonical-v1';

/**
 * Hash of one case as it would be written to disk.
 *
 * Canonical first, so key order, spacing and file ordering cannot change the value: two files describing the
 * same case agree, and one edited sentence does not.
 */
export function caseContentHash(benchmarkCase: BenchmarkCase): string {
  return contentHash(normaliseCase(benchmarkCase));
}

/** A digest over the sorted per-case hashes, so the corpus has one comparable identity. */
export function corpusHash(entries: readonly { caseId: string; contentHash: string }[]): string {
  return contentHash(
    [...entries]
      .sort((left, right) => compareStrings(left.caseId, right.caseId))
      .map((entry) => `${entry.caseId}\u0000${entry.contentHash}`),
  );
}

/**
 * A release identity derived from content alone.
 *
 * The same corpus always yields the same id, on any machine at any time. An operator-supplied label is
 * recorded beside it as exactly that — a human name for the release — and never enters the identity, so a
 * re-labelled corpus cannot look like a different one.
 */
export function releaseId(hash: string): string {
  return `release-${hash.slice(0, 12)}`;
}

export interface ReleaseCaseEntry {
  readonly caseId: string;
  /** A bare file name, never a path: an absolute path would make the same corpus hash differently per machine. */
  readonly file: string;
  readonly caseVersion: string;
  readonly stratum: string;
  readonly contentHash: string;
  readonly bytes: number;
  readonly reviewerCount: number;
  /** The reviewers the case declares, canonicalised. A roster edit is an authorisation change and must be visible in a diff. */
  readonly declaredReviewers: readonly string[];
  readonly unresolvedSubjects: number;
  readonly staleAdjudications: number;
  readonly unboundAdjudications: number;
  readonly undeclaredReviewers: readonly string[];
}

export interface ReleaseGate {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
  /** Blocking gates describe corpus integrity and provenance. A non-blocking gate reports a real limit that the corpus can honestly carry. */
  readonly blocking: boolean;
}

export interface ReleaseManifest {
  readonly version: string;
  readonly releaseId: string;
  /** Operator-supplied name for the release. `null` when none was given, and never part of `releaseId`. */
  readonly label: string | null;
  readonly algorithm: string;
  readonly caseContractVersions: readonly string[];
  readonly caseCount: number;
  readonly cases: readonly ReleaseCaseEntry[];
  readonly corpusHash: string;
  readonly gates: readonly ReleaseGate[];
  readonly strataPresent: readonly string[];
  readonly strataMissing: readonly string[];
  readonly accuracyClaimable: false;
  readonly accuracyReason: string;
  readonly integrityNote: string;
}

const INTEGRITY_NOTE =
  'These digests are integrity checks over recorded content: they detect that a case changed. They do not ' +
  'authenticate a reviewer, prove that two reviewer names are two people, or show that any material is ' +
  'genuine. Reviewer identity in a benchmark case is operator-asserted and this application has no ' +
  'authentication.';

const ACCURACY_REASON =
  'A release describes a corpus, not a result. Gates here cover integrity, provenance and completeness; a ' +
  'fully passing release means the corpus is consistent and reviewed as declared, which is not evidence that ' +
  'the evaluator is accurate. Establishing accuracy needs genuinely independent human review and measures ' +
  'this build does not have.';

/** The file name a case is stored under. Callers may pass a map for corpora with a different layout. */
function defaultFileName(benchmarkCase: BenchmarkCase): string {
  return `${benchmarkCase.id}.json`;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareStrings);
}

/**
 * The provenance and completeness gates for a corpus.
 *
 * Each is named, and each says which cases it is complaining about, so a failing release is actionable rather
 * than merely red. Two are deliberately non-blocking: stratum coverage describes an under-populated corpus
 * (the honest state of this project), and `allAdjudicationsBound` records that legacy decisions predate
 * binding — a fact to disclose, not a defect to hide, and never a pass.
 */
export function releaseGates(
  cases: readonly BenchmarkCase[],
  validation: Pick<BenchmarkCorpusValidation, 'issues'> | null = null,
): ReleaseGate[] {
  const ids = cases.map((benchmarkCase) => benchmarkCase.id);
  const duplicateIds = uniqueSorted(ids.filter((id, index) => ids.indexOf(id) !== index));
  const unauthorised = cases
    .filter((benchmarkCase) => benchmarkCase.provenance.authorizedForStorage !== true)
    .map((benchmarkCase) => benchmarkCase.id);
  const noReviewDate = cases
    .filter((benchmarkCase) => benchmarkCase.provenance.reviewedAt.trim() === '')
    .map((benchmarkCase) => benchmarkCase.id);
  const undeclared = cases.filter((benchmarkCase) =>
    rosterGaps(benchmarkCase).some((gap) => gap.kind === 'UNDECLARED'),
  );
  const thin = cases.filter((benchmarkCase) => labelledIdentitiesOf(benchmarkCase).length < 2);
  const reports = cases.map((benchmarkCase) => ({
    benchmarkCase,
    report: disagreementReport(benchmarkCase),
  }));
  const stale = reports.filter((entry) => entry.report.stale > 0);
  const unbound = reports.filter((entry) => entry.report.unbound > 0);
  const unannotated = reports.filter((entry) =>
    entry.report.subjects.some((subject) => subject.status === 'UNANNOTATED'),
  );
  const unresolved = reports.filter((entry) => entry.report.unresolved > 0);
  const present = new Set<BenchmarkStratum>(cases.map((benchmarkCase) => benchmarkCase.stratum));
  const missingStrata = BENCHMARK_STRATA.filter((stratum) => !present.has(stratum));
  const validationIssues = validation?.issues.length ?? 0;

  const nameList = (values: readonly string[], limit = 8): string =>
    values.length === 0
      ? 'none'
      : `${values.slice(0, limit).join(', ')}${values.length > limit ? `, …${String(values.length - limit)} more` : ''}`;

  return [
    {
      name: 'everyCaseValidates',
      passed: validationIssues === 0,
      detail:
        validationIssues === 0
          ? 'Every supplied case passed the corpus validator.'
          : `${String(validationIssues)} validation issue(s) were reported by the corpus validator.`,
      blocking: true,
    },
    {
      name: 'noDuplicateCaseIds',
      passed: duplicateIds.length === 0,
      detail:
        duplicateIds.length === 0
          ? 'Each case id appears once.'
          : `Duplicate case id(s): ${nameList(duplicateIds)}. Two files describing one id make the corpus ambiguous, so no digest can say which was reviewed.`,
      blocking: true,
    },
    {
      name: 'everyCaseAuthorisedForStorage',
      passed: unauthorised.length === 0,
      detail:
        unauthorised.length === 0
          ? 'Every case states that its material is authorised to store here.'
          : `Not authorised: ${nameList(unauthorised)}. Unverified permission is not permission.`,
      blocking: true,
    },
    {
      name: 'everyCaseHasReviewDate',
      passed: noReviewDate.length === 0,
      detail:
        noReviewDate.length === 0
          ? 'Every case records when it was reviewed.'
          : `No review date: ${nameList(noReviewDate)}. A date nobody can read is a date nobody can audit.`,
      blocking: true,
    },
    {
      name: 'noUndeclaredReviewers',
      passed: undeclared.length === 0,
      detail:
        undeclared.length === 0
          ? 'Every reviewer label is credited to a name declared in that case’s provenance.reviewedBy.'
          : `Cases with undeclared reviewers: ${nameList(undeclared.map((entry) => entry.id))}. A merge cannot produce this, so a case file was edited by hand outside the workflow.`,
      blocking: true,
    },
    {
      name: 'noStaleAdjudications',
      passed: stale.length === 0,
      detail:
        stale.length === 0
          ? 'No bound adjudication has drifted from the disagreement it settled.'
          : `Cases with stale decisions: ${nameList(
              stale.map((entry) => entry.benchmarkCase.id),
            )}. A decision whose split has moved settles nothing, so these subjects stay unresolved.`,
      blocking: true,
    },
    {
      name: 'everySubjectAnnotated',
      passed: unannotated.length === 0,
      detail:
        unannotated.length === 0
          ? 'Every subject in every case has at least one reviewer label.'
          : `Cases with unannotated subjects: ${nameList(
              unannotated.map((entry) => entry.benchmarkCase.id),
            )}.`,
      blocking: true,
    },
    {
      name: 'twoReviewersPerCase',
      passed: thin.length === 0,
      detail:
        thin.length === 0
          ? 'Every case has labels from at least two canonical reviewer identities.'
          : `Cases below two reviewers: ${nameList(
              thin.map((benchmarkCase) => benchmarkCase.id),
            )}. One opinion is not agreement, however it is spelled.`,
      blocking: true,
    },
    {
      name: 'noUnresolvedDisagreements',
      passed: unresolved.length === 0,
      detail:
        unresolved.length === 0
          ? 'No case carries a reviewer split without a settling decision.'
          : `Cases with unresolved splits: ${nameList(
              unresolved.map((entry) => entry.benchmarkCase.id),
            )}. These stay unresolved until a human files a bound adjudication; nothing here picks a side.`,
      blocking: true,
    },
    {
      name: 'allAdjudicationsBound',
      passed: unbound.length === 0,
      detail:
        unbound.length === 0
          ? 'Every recorded adjudication names the disagreement it settled.'
          : `Cases with unbound legacy decisions: ${nameList(
              unbound.map((entry) => entry.benchmarkCase.id),
            )}. These records predate binding: they are honoured, and they are not verified provenance. A release is not "provenance-verified" while they stand.`,
      blocking: false,
    },
    {
      name: 'strataCovered',
      passed: missingStrata.length === 0,
      detail:
        missingStrata.length === 0
          ? 'Every required stratum has at least one case.'
          : `Missing strata: ${missingStrata.join(', ')}. Coverage is breadth of testing, not correctness — filling these in would not make the evaluator accurate.`,
      blocking: false,
    },
  ];
}

/**
 * Build the release manifest for a validated corpus.
 *
 * `files` maps a case id to the file it was read from; only the basename is kept, so the manifest does not
 * record where a machine happened to put the corpus.
 */
export function buildReleaseManifest(
  cases: readonly BenchmarkCase[],
  files: ReadonlyMap<string, string> | null = null,
  label: string | null = null,
  validation: Pick<BenchmarkCorpusValidation, 'issues'> | null = null,
): ReleaseManifest {
  const entries: ReleaseCaseEntry[] = cases.map((benchmarkCase) => {
    const report = disagreementReport(benchmarkCase);
    const contents = normaliseCase(benchmarkCase);
    const supplied = files?.get(benchmarkCase.id) ?? defaultFileName(benchmarkCase);
    return {
      caseId: benchmarkCase.id,
      file: supplied.split(/[\\/]/).pop() ?? supplied,
      caseVersion: benchmarkCase.version,
      stratum: benchmarkCase.stratum,
      contentHash: caseContentHash(benchmarkCase),
      bytes: Buffer.byteLength(contents, 'utf8'),
      reviewerCount: labelledIdentitiesOf(benchmarkCase).length,
      declaredReviewers: declaredRoster(benchmarkCase),
      unresolvedSubjects: report.unresolved,
      staleAdjudications: report.stale,
      unboundAdjudications: report.unbound,
      undeclaredReviewers: rosterGaps(benchmarkCase)
        .filter((gap) => gap.kind === 'UNDECLARED')
        .map((gap) => gap.reviewer),
    };
  });
  const ordered = [...entries].sort((left, right) => compareStrings(left.caseId, right.caseId));
  const digest = corpusHash(
    ordered.map((entry) => ({ caseId: entry.caseId, contentHash: entry.contentHash })),
  );
  const present = uniqueSorted(cases.map((benchmarkCase) => benchmarkCase.stratum));
  const missing = BENCHMARK_STRATA.filter((stratum) => !present.includes(stratum));
  return {
    version: BENCHMARK_RELEASE_MANIFEST_VERSION,
    releaseId: releaseId(digest),
    label: label === null || label.trim() === '' ? null : label.trim(),
    algorithm: RELEASE_ALGORITHM,
    caseContractVersions: uniqueSorted(cases.map((benchmarkCase) => benchmarkCase.version)),
    caseCount: ordered.length,
    cases: ordered,
    corpusHash: digest,
    gates: releaseGates(cases, validation),
    strataPresent: present,
    strataMissing: missing,
    accuracyClaimable: false,
    accuracyReason: ACCURACY_REASON,
    integrityNote: INTEGRITY_NOTE,
  };
}

export interface ReleaseVerification {
  readonly ok: boolean;
  readonly releaseId: string;
  readonly corpusHash: string;
  readonly manifestCorpusHash: string;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
  readonly unchanged: readonly string[];
  readonly duplicateCaseIds: readonly string[];
  readonly contractDrift: readonly string[];
  readonly gateFailures: readonly string[];
  readonly note: string;
}

/**
 * Compare a corpus against the manifest it was frozen with.
 *
 * `added`, `removed` and `changed` are the whole point: a reviewer can be told exactly which case moved. A
 * duplicate id is a failure even when the bytes agree, because two files claiming one id make the digest
 * ambiguous about which was reviewed.
 */
export function verifyRelease(
  manifest: ReleaseManifest,
  cases: readonly BenchmarkCase[],
): ReleaseVerification {
  const ids = cases.map((benchmarkCase) => benchmarkCase.id);
  const duplicateCaseIds = uniqueSorted(ids.filter((id, index) => ids.indexOf(id) !== index));
  const manifestById = new Map(manifest.cases.map((entry) => [entry.caseId, entry]));
  const currentById = new Map(
    cases.map((benchmarkCase) => [benchmarkCase.id, caseContentHash(benchmarkCase)]),
  );
  const added: string[] = [];
  const changed: string[] = [];
  const unchanged: string[] = [];
  for (const [caseId, hash] of currentById) {
    const recorded = manifestById.get(caseId);
    if (recorded === undefined) {
      added.push(caseId);
    } else if (recorded.contentHash !== hash) {
      changed.push(caseId);
    } else {
      unchanged.push(caseId);
    }
  }
  const removed = manifest.cases
    .filter((entry) => !currentById.has(entry.caseId))
    .map((entry) => entry.caseId);
  const contractDrift = manifest.cases
    .filter((entry) => {
      const current = cases.find((benchmarkCase) => benchmarkCase.id === entry.caseId);
      return current !== undefined && current.version !== entry.caseVersion;
    })
    .map(
      (entry) =>
        `${entry.caseId}: ${entry.caseVersion} → ${
          (cases.find((benchmarkCase) => benchmarkCase.id === entry.caseId) as BenchmarkCase)
            .version
        }`,
    );
  const gateFailures = releaseGates(cases, { issues: [] })
    .filter((gate) => gate.blocking && !gate.passed)
    .map((gate) => gate.name);
  const sortStrings = (values: readonly string[]): readonly string[] =>
    [...values].sort(compareStrings);
  return {
    ok:
      added.length === 0 &&
      removed.length === 0 &&
      changed.length === 0 &&
      duplicateCaseIds.length === 0 &&
      contractDrift.length === 0,
    releaseId: manifest.releaseId,
    corpusHash: corpusHash(
      [...currentById].map(([caseId, contentHashValue]) => ({
        caseId,
        contentHash: contentHashValue,
      })),
    ),
    manifestCorpusHash: manifest.corpusHash,
    added: sortStrings(added),
    removed: sortStrings(removed),
    changed: sortStrings(changed),
    unchanged: sortStrings(unchanged),
    duplicateCaseIds: sortStrings(duplicateCaseIds),
    contractDrift: sortStrings(contractDrift),
    gateFailures: sortStrings(gateFailures),
    note:
      'A verification compares recorded bytes. It cannot tell whether the material or the reviewer names ' +
      'were ever genuine, and a clean verification is not an accuracy claim.',
  };
}

export interface ReleaseComparison {
  readonly beforeReleaseId: string;
  readonly afterReleaseId: string;
  readonly corpusHashChanged: boolean;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
  readonly strataAdded: readonly string[];
  readonly strataRemoved: readonly string[];
  /** Declared reviewer additions, as `caseId::reviewer` pairs. Authorising a reviewer is a visible edit. */
  readonly rosterAdded: readonly string[];
  readonly rosterRemoved: readonly string[];
  readonly gatesNewlyFailing: readonly string[];
  readonly gatesNewlyPassing: readonly string[];
  readonly note: string;
}

/** Every `caseId::reviewer` pair a manifest declares, so a roster edit on one case is a visible change. */
function rosterPairs(manifest: ReleaseManifest): Set<string> {
  const pairs = new Set<string>();
  for (const entry of manifest.cases) {
    for (const reviewer of entry.declaredReviewers) {
      pairs.add(`${entry.caseId}::${reviewer}`);
    }
  }
  return pairs;
}

/**
 * What differs between two releases, and nothing more.
 *
 * The `note` is not decoration. A difference is a difference: without this sentence a diff read between two
 * corpora looks like a claim of improvement, and nothing here measures quality at all.
 */
export function compareReleases(
  before: ReleaseManifest,
  after: ReleaseManifest,
): ReleaseComparison {
  const beforeById = new Map(before.cases.map((entry) => [entry.caseId, entry.contentHash]));
  const afterById = new Map(after.cases.map((entry) => [entry.caseId, entry.contentHash]));
  const added = [...afterById.keys()].filter((id) => !beforeById.has(id));
  const removed = [...beforeById.keys()].filter((id) => !afterById.has(id));
  const changed = [...afterById.keys()].filter(
    (id) => beforeById.has(id) && beforeById.get(id) !== afterById.get(id),
  );
  const strataAdded = after.strataPresent.filter(
    (stratum) => !before.strataPresent.includes(stratum),
  );
  const strataRemoved = before.strataPresent.filter(
    (stratum) => !after.strataPresent.includes(stratum),
  );
  const beforeRoster = rosterPairs(before);
  const afterRoster = rosterPairs(after);
  const gateNames = (manifest: ReleaseManifest, failed: boolean): string[] =>
    manifest.gates.filter((gate) => gate.passed !== failed).map((gate) => gate.name);
  const beforeFailing = gateNames(before, true);
  const afterFailing = gateNames(after, true);
  const sortStrings = (values: readonly string[]): readonly string[] =>
    [...new Set(values)].sort(compareStrings);
  return {
    beforeReleaseId: before.releaseId,
    afterReleaseId: after.releaseId,
    corpusHashChanged: before.corpusHash !== after.corpusHash,
    added: sortStrings(added),
    removed: sortStrings(removed),
    changed: sortStrings(changed),
    strataAdded: sortStrings(strataAdded),
    strataRemoved: sortStrings(strataRemoved),
    rosterAdded: sortStrings([...afterRoster].filter((pair) => !beforeRoster.has(pair))),
    rosterRemoved: sortStrings([...beforeRoster].filter((pair) => !afterRoster.has(pair))),
    gatesNewlyFailing: sortStrings(afterFailing.filter((name) => !beforeFailing.includes(name))),
    gatesNewlyPassing: sortStrings(beforeFailing.filter((name) => !afterFailing.includes(name))),
    note:
      'This lists content differences between two releases. It is not a claim that the later release is ' +
      'better, more accurate, or more trustworthy: a difference and an improvement are different statements. ' +
      'Roster entries are shown as "caseId::reviewer" so an authorisation change on one case is visible.',
  };
}

/** The current case contract version, re-exported so a release reader can see which one it describes. */
export const CURRENT_CASE_CONTRACT = BENCHMARK_CASE_VERSION;
