import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import { test } from 'node:test';
import {
  buildReleaseManifest,
  caseContentHash,
  compareReleases,
  corpusHash,
  releaseGates,
  releaseId,
  RELEASE_ALGORITHM,
  verifyRelease,
} from '../../src/benchmark/release.ts';
import { normaliseCase } from '../../src/benchmark/authoring.ts';
import {
  adjudicationTemplate,
  applyAdjudication,
  type PendingAdjudication,
} from '../../src/benchmark/review.ts';
import {
  BENCHMARK_RELEASE_MANIFEST_VERSION,
  type BenchmarkCase,
} from '../../src/benchmark/types.ts';
import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';

/**
 * Reproducible corpus releases (ADR-027).
 *
 * Three properties hold this together, and each is tested as a hard requirement rather than assumed:
 *
 * 1. Determinism independent of the environment — no timestamp, absolute path, machine identity or execution
 *    order may reach a manifest, or the same corpus would freeze into two different releases.
 * 2. Change detection at case granularity, so a release can say *which* case moved.
 * 3. The honesty boundary: gates describe integrity, provenance and completeness; `accuracyClaimable` is the
 *    literal `false`, and a fully-passing release is never an accuracy claim.
 */

function twoReviewers(id: string, dana: string, erin: string): BenchmarkCase {
  return fixtureCase({
    id,
    reviewedBy: ['dana', 'erin'],
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', dana),
      labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', erin),
    ],
  });
}

function corpus(): BenchmarkCase[] {
  return [
    twoReviewers('case-a', 'SUPPORTED_WITHIN_SCOPE', 'SUPPORTED_WITHIN_SCOPE'),
    twoReviewers('case-b', 'SUPPORTED_WITHIN_SCOPE', 'SUPPORTED_WITHIN_SCOPE'),
  ];
}

test('a case hash is stable across key order, spacing and re-parsing', () => {
  const benchmarkCase = twoReviewers('case-a', 'SUPPORTED_WITHIN_SCOPE', 'SUPPORTED_WITHIN_SCOPE');
  const first = caseContentHash(benchmarkCase);
  const reparsed = JSON.parse(normaliseCase(benchmarkCase)) as BenchmarkCase;
  assert.equal(caseContentHash(reparsed), first);
  // Reordering the labels array is a real content change and must show as one.
  const reordered: BenchmarkCase = {
    ...benchmarkCase,
    reviewerLabels: [...benchmarkCase.reviewerLabels].reverse(),
  };
  assert.notEqual(caseContentHash(reordered), first);
});

test('one edited sentence changes exactly that case and the corpus hash', () => {
  const before = corpus();
  const after = corpus().map((entry) =>
    entry.id === 'case-b' ? { ...entry, title: 'A single edited sentence in one case.' } : entry,
  );
  const beforeManifest = buildReleaseManifest(before);
  const afterManifest = buildReleaseManifest(after);
  const beforeB = beforeManifest.cases.find((entry) => entry.caseId === 'case-b');
  const afterB = afterManifest.cases.find((entry) => entry.caseId === 'case-b');
  assert.notEqual(beforeB?.contentHash, afterB?.contentHash);
  assert.equal(
    beforeManifest.cases.find((entry) => entry.caseId === 'case-a')?.contentHash,
    afterManifest.cases.find((entry) => entry.caseId === 'case-a')?.contentHash,
    'the untouched case is unchanged',
  );
  assert.notEqual(beforeManifest.corpusHash, afterManifest.corpusHash);
});

test('the corpus hash is independent of input ordering', () => {
  const one = corpus();
  const two = [...one].reverse();
  assert.equal(buildReleaseManifest(one).corpusHash, buildReleaseManifest(two).corpusHash);
  assert.equal(
    corpusHash([{ caseId: 'a', contentHash: 'x' }]),
    corpusHash([{ caseId: 'a', contentHash: 'x' }]),
  );
});

test('the release id derives from content and never from a clock, path or hostname', () => {
  const realNow = Date.now;
  const realCwd = process.cwd;
  const machine = hostname();
  try {
    // A frozen clock and a different working directory must change nothing: a release that varied with when
    // or where it was taken could not be re-derived by anyone else.
    Date.now = () => 1_700_000_000_000;
    process.cwd = () => 'C:\\Users\\someone\\else\\projects\\other';
    const first = JSON.stringify(buildReleaseManifest(corpus()));
    Date.now = () => 1_900_000_000_000;
    process.cwd = () => '/home/anyone/wherever';
    const second = JSON.stringify(buildReleaseManifest(corpus()));
    assert.equal(
      first,
      second,
      'the same corpus produced a different manifest under a different environment',
    );
    assert.doesNotMatch(
      first,
      /1700000000000|1900000000000/,
      'no wall-clock value leaked into the manifest',
    );
    assert.doesNotMatch(first, /someone|anyone|Users|home/, 'no path or machine identity leaked');
    if (machine.length > 3) {
      assert.ok(
        !first.includes(machine),
        'the machine hostname must not appear in a release document',
      );
    }
  } finally {
    Date.now = realNow;
    process.cwd = realCwd;
  }
});

test('a supplied label is recorded as an operator assertion and never enters the release id', () => {
  const plain = buildReleaseManifest(corpus());
  const named = buildReleaseManifest(corpus(), null, 'Q4 hand-reviewed set');
  assert.equal(named.releaseId, plain.releaseId);
  assert.equal(named.label, 'Q4 hand-reviewed set');
  assert.equal(buildReleaseManifest(corpus(), null, '   ').label, null);
});

test('a manifest is deterministic, names its algorithm, and records only bare file names', () => {
  const files = new Map([
    ['case-a', 'C:\\corpus\\deep\\path\\a.json'],
    ['case-b', '/home/op/corpus/b.json'],
  ]);
  const manifest = buildReleaseManifest(corpus(), files, 'named');
  assert.equal(
    JSON.stringify(manifest),
    JSON.stringify(buildReleaseManifest(corpus(), files, 'named')),
  );
  assert.equal(manifest.version, BENCHMARK_RELEASE_MANIFEST_VERSION);
  assert.equal(manifest.algorithm, RELEASE_ALGORITHM);
  assert.match(manifest.releaseId, /^release-[0-9a-f]{12}$/);
  assert.equal(manifest.caseCount, 2);
  assert.deepEqual(
    manifest.cases.map((entry) => entry.file),
    ['a.json', 'b.json'],
    'only basenames appear, so the same corpus hashes the same wherever it lives',
  );
  for (const entry of manifest.cases) {
    assert.doesNotMatch(entry.file, /[\\/]/);
    assert.deepEqual(entry.declaredReviewers, ['dana', 'erin']);
  }
});

test('the manifest states plainly that hashes are integrity checks and accuracy is not claimable', () => {
  const manifest = buildReleaseManifest(corpus());
  assert.equal(manifest.accuracyClaimable, false);
  assert.match(manifest.accuracyReason, /not evidence that|is not a result/i);
  assert.match(manifest.integrityNote, /integrity check/i);
  assert.match(manifest.integrityNote, /do not authenticate a reviewer/i);
  assert.match(manifest.integrityNote, /operator-asserted/i);
});

test('gate failures name the offending cases and each gate can fail alone', () => {
  const cases = corpus();
  const clean = releaseGates(cases, { issues: [] });
  assert.equal(clean.find((gate) => gate.name === 'noDuplicateCaseIds')?.passed, true);

  const base = twoReviewers('case-x', 'SUPPORTED_WITHIN_SCOPE', 'SUPPORTED_WITHIN_SCOPE');
  const unauthorised: BenchmarkCase[] = [
    { ...base, provenance: { ...base.provenance, authorizedForStorage: false } },
  ];
  const gates = releaseGates(unauthorised, { issues: [] });
  assert.equal(gates.find((gate) => gate.name === 'everyCaseAuthorisedForStorage')?.passed, false);
  assert.match(
    gates.find((gate) => gate.name === 'everyCaseAuthorisedForStorage')?.detail ?? '',
    /case-x/,
  );

  const invalid = releaseGates(cases, { issues: [{ caseId: 'case-a', field: 'x', message: 'y' }] });
  assert.equal(invalid.find((gate) => gate.name === 'everyCaseValidates')?.passed, false);

  const duplicates = [
    cases[0] as BenchmarkCase,
    { ...cases[0], reviewerLabels: [] } as BenchmarkCase,
  ];
  const dupGates = releaseGates(duplicates, { issues: [] });
  assert.equal(dupGates.find((gate) => gate.name === 'noDuplicateCaseIds')?.passed, false);

  const narrowedCase = twoReviewers('case-t', 'SUPPORTED_WITHIN_SCOPE', 'SUPPORTED_WITHIN_SCOPE');
  const thin = releaseGates([narrowedCase], {
    issues: [],
  });
  // Two aliases of one reviewer are one reviewer, so the two-reviewer rule cannot be fooled by spelling.
  const aliased = fixtureCase({
    id: 'case-alias',
    reviewedBy: ['dana', 'Dana', 'DANA '],
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('DANA', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
    ],
  });
  const aliasGates = releaseGates([aliased], { issues: [] });
  assert.equal(aliasGates.find((gate) => gate.name === 'twoReviewersPerCase')?.passed, false);
  assert.equal(thin.find((gate) => gate.name === 'twoReviewersPerCase')?.passed, true);
});

test('gate order is fixed, so two machines report the same release in the same sequence', () => {
  assert.deepEqual(
    releaseGates(corpus(), { issues: [] }).map((gate) => gate.name),
    [
      'everyCaseValidates',
      'noDuplicateCaseIds',
      'everyCaseAuthorisedForStorage',
      'everyCaseHasReviewDate',
      'noUndeclaredReviewers',
      'noStaleAdjudications',
      'everySubjectAnnotated',
      'twoReviewersPerCase',
      'noUnresolvedDisagreements',
      'allAdjudicationsBound',
      'strataCovered',
    ],
  );
  const nonBlocking = releaseGates(corpus(), { issues: [] })
    .filter((gate) => !gate.blocking)
    .map((gate) => gate.name);
  assert.deepEqual(nonBlocking, ['allAdjudicationsBound', 'strataCovered']);
});

test('a legacy unbound adjudication fails the provenance-verification gate without blocking a freeze', () => {
  const unbound: BenchmarkCase = {
    ...fixtureCase({
      id: 'case-unbound',
      reviewedBy: ['dana', 'erin'],
      reviewerLabels: [
        labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
        labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      ],
    }),
    adjudications: [
      {
        dimension: 'EVIDENCE_SUPPORT',
        subjectId: 'p1',
        outcome: 'RESOLVED',
        label: 'SUPPORTED_WITHIN_SCOPE',
        reason: 'Filed before bindings existed.',
        adjudicatedBy: 'erin',
      },
    ],
  };
  const gates = releaseGates([unbound], { issues: [] });
  const bound = gates.find((gate) => gate.name === 'allAdjudicationsBound');
  assert.equal(
    bound?.passed,
    false,
    'an unbound record is never silently credited as verified provenance',
  );
  assert.equal(bound?.blocking, false, 'and it is a disclosed limit, not a freeze blocker');
  assert.match(bound?.detail ?? '', /predate binding/i);
  assert.equal(gates.find((gate) => gate.name === 'noStaleAdjudications')?.passed, true);
});

test('a stale adjudication blocks the release because the subject is genuinely unsettled', () => {
  const split = fixtureCase({
    id: 'case-stale',
    reviewedBy: ['dana', 'erin'],
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'PARTIALLY_SUPPORTED'),
    ],
  });
  const entry = adjudicationTemplate(split).adjudications[0];
  assert.ok(entry);
  const decision: PendingAdjudication = {
    caseId: split.id,
    dimension: entry.dimension,
    subjectId: entry.subjectId,
    outcome: 'RESOLVED',
    label: 'SUPPORTED_WITHIN_SCOPE',
    reason: 'The second record restates the first.',
    adjudicatedBy: 'erin',
    disagreementHash: entry.disagreementHash,
    adjudicatedAt: '2026-11-05T12:00:00Z',
  };
  const applied = applyAdjudication(split, decision);
  assert.equal(applied.ok, true);
  if (!applied.ok) {
    return;
  }
  // Applying the decision settles it, so no stale gate yet.
  assert.equal(
    releaseGates([applied.case], { issues: [] }).find((g) => g.name === 'noStaleAdjudications')
      ?.passed,
    true,
  );

  // Then the reviewers move under it.
  const moved: BenchmarkCase = {
    ...applied.case,
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'PARTIALLY_SUPPORTED'),
      labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'CONTRADICTED'),
    ],
  };
  const gates = releaseGates([moved], { issues: [] });
  assert.equal(gates.find((gate) => gate.name === 'noStaleAdjudications')?.passed, false);
  assert.equal(gates.find((gate) => gate.name === 'noStaleAdjudications')?.blocking, true);
  assert.match(
    gates.find((gate) => gate.name === 'noUnresolvedDisagreements')?.detail ?? '',
    /case-stale/,
  );
});

test('verify confirms an untouched corpus and pinpoints a tampered case', () => {
  const cases = corpus();
  const manifest = buildReleaseManifest(cases);
  assert.equal(verifyRelease(manifest, cases).ok, true);

  const tampered = cases.map((entry) =>
    entry.id === 'case-b' ? { ...entry, title: 'Quietly edited after the freeze.' } : entry,
  );
  const result = verifyRelease(manifest, tampered);
  assert.equal(result.ok, false);
  assert.deepEqual(result.changed, ['case-b']);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.unchanged, ['case-a']);
  assert.match(result.note, /cannot tell whether/i);
});

test('verify detects additions, removals, duplicate ids and contract drift', () => {
  const cases = corpus();
  const manifest = buildReleaseManifest(cases);
  const grown = [
    ...cases,
    twoReviewers('case-c', 'SUPPORTED_WITHIN_SCOPE', 'SUPPORTED_WITHIN_SCOPE'),
  ];
  const addedResult = verifyRelease(manifest, grown);
  assert.deepEqual(addedResult.added, ['case-c']);
  assert.equal(addedResult.ok, false);

  const shrunk = [cases[0] as BenchmarkCase];
  assert.deepEqual(verifyRelease(manifest, shrunk).removed, ['case-b']);

  const duplicated = [
    cases[0] as BenchmarkCase,
    { ...cases[0], title: 'same id' } as BenchmarkCase,
  ];
  const duplicateResult = verifyRelease(manifest, duplicated);
  assert.deepEqual(duplicateResult.duplicateCaseIds, ['case-a']);
  assert.equal(duplicateResult.ok, false, 'two files claiming one id make the digest ambiguous');

  const downgraded = cases.map((entry) =>
    entry.id === 'case-a' ? { ...entry, version: 'benchmark-case-v1' } : entry,
  );
  const drift = verifyRelease(manifest, downgraded);
  assert.equal(drift.changed.length, 1, 'a contract change alters the bytes');
  assert.deepEqual(drift.contractDrift, ['case-a: benchmark-case-v2 → benchmark-case-v1']);
});

test('a release compared with itself shows no change', () => {
  const manifest = buildReleaseManifest(corpus());
  const comparison = compareReleases(manifest, buildReleaseManifest(corpus()));
  assert.equal(comparison.corpusHashChanged, false);
  assert.deepEqual(comparison.added, []);
  assert.deepEqual(comparison.removed, []);
  assert.deepEqual(comparison.changed, []);
  assert.deepEqual(comparison.gatesNewlyFailing, []);
  assert.deepEqual(comparison.gatesNewlyPassing, []);
  assert.match(comparison.note, /not a claim that the later release is better/i);
});

test('a diff reports a new case, an edited case, a removed stratum and an authorisation change', () => {
  const before = buildReleaseManifest(corpus());
  const edited = corpus().map((entry) =>
    entry.id === 'case-a' ? { ...entry, title: 'Reviewed again with new material.' } : entry,
  );
  const third = fixtureCase({
    id: 'case-c',
    stratum: 'CONTRADICTED_BY_CREDIBLE_EVIDENCE',
    reviewedBy: ['dana', 'erin', 'zoe'],
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'CONTRADICTED'),
      labelFor('erin', 'EVIDENCE_SUPPORT', 'p1', 'CONTRADICTED'),
    ],
  });
  const after = buildReleaseManifest([...edited, third]);
  const comparison = compareReleases(before, after);
  assert.equal(comparison.corpusHashChanged, true);
  assert.deepEqual(comparison.changed, ['case-a']);
  assert.deepEqual(comparison.added, ['case-c']);
  assert.deepEqual(comparison.removed, []);
  assert.deepEqual(comparison.rosterAdded, ['case-c::dana', 'case-c::erin', 'case-c::zoe']);
  assert.deepEqual(comparison.rosterRemoved, []);
  // A new case contributes its stratum, and nothing here claims the later set is better.
  assert.deepEqual(comparison.strataAdded, ['CONTRADICTED_BY_CREDIBLE_EVIDENCE']);
  assert.deepEqual(comparison.strataRemoved, []);
  assert.equal(comparison.gatesNewlyFailing.length, 0);
});

test('removing a reviewer authorisation is visible in the diff rather than silent', () => {
  const before = buildReleaseManifest(corpus());
  const narrowed = corpus().map((entry) =>
    entry.id === 'case-a'
      ? { ...entry, provenance: { ...entry.provenance, reviewedBy: ['dana'] } }
      : entry,
  );
  const comparison = compareReleases(before, buildReleaseManifest(narrowed));
  assert.deepEqual(comparison.rosterRemoved, ['case-a::erin']);
  assert.deepEqual(comparison.rosterAdded, []);
  assert.equal(comparison.corpusHashChanged, true, 'an authorisation edit changes the case bytes');
});

test('an empty corpus releases honestly and claims nothing', () => {
  const manifest = buildReleaseManifest([]);
  assert.equal(manifest.caseCount, 0);
  assert.deepEqual(manifest.cases, []);
  assert.equal(manifest.accuracyClaimable, false);
  assert.ok(manifest.strataMissing.length > 0, 'an empty corpus covers nothing, and says so');
  assert.equal(releaseId(manifest.corpusHash), manifest.releaseId);
});

test('releaseId is a stable short prefix of the corpus hash', () => {
  const hash = corpusHash([{ caseId: 'a', contentHash: 'x'.repeat(64) }]);
  assert.equal(releaseId(hash), `release-${hash.slice(0, 12)}`);
  assert.equal(releaseId(hash).length, 'release-'.length + 12);
});
