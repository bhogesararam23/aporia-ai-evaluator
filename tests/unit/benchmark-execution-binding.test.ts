import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bindRunToRelease,
  releaseManifestProblem,
  type ReleaseBinding,
} from '../../src/benchmark/execution.ts';
import { buildReleaseManifest } from '../../src/benchmark/release.ts';
import { validateBenchmarkCorpus } from '../../src/benchmark/validate.ts';
import { fixtureCase, labelFor } from '../helpers/benchmark-fixtures.ts';
import { BENCHMARK_CASE_VERSION_V1, type BenchmarkCase } from '../../src/benchmark/types.ts';
import { canonicalise, sha256Hex } from '../../src/benchmark/hashing.ts';

/**
 * Release-bound execution (v0.8, spec §4).
 *
 * Before this, `npm run benchmark` had no idea whether the directory it scored was the directory anybody
 * reviewed: `--release` was an unknown argument, and a report carried no reference to a manifest. Binding the
 * run to a release is what makes a report answerable after the fact — and the refusal cases below are the point
 * of the exercise, because a binding that only reports success is decoration.
 */

function corpus(cases: readonly BenchmarkCase[]) {
  return validateBenchmarkCorpus(cases.map((value, index) => ({ index, value: value as unknown })));
}

/** A reviewed two-reviewer case, so the blocking gates can actually pass. */
function reviewedCase(id: string): BenchmarkCase {
  return fixtureCase({
    id,
    reviewedBy: ['dana', 'sam'],
    reviewerLabels: [
      labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('sam', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
      labelFor('dana', 'ANSWER_FIDELITY', 'st1', 'NOT_ASSESSABLE'),
      labelFor('sam', 'ANSWER_FIDELITY', 'st1', 'NOT_ASSESSABLE'),
      labelFor('dana', 'CITATION_SUPPORT', 'st1', 'NOT_ASSESSABLE'),
      labelFor('sam', 'CITATION_SUPPORT', 'st1', 'NOT_ASSESSABLE'),
      labelFor('dana', 'ATTRIBUTION', 'st1', 'NOT_ASSESSABLE'),
      labelFor('sam', 'ATTRIBUTION', 'st1', 'NOT_ASSESSABLE'),
    ],
  });
}

function manifestOf(cases: readonly BenchmarkCase[]): Record<string, unknown> {
  const manifest = buildReleaseManifest(cases, null, 'binding-fixture', corpus(cases));
  return JSON.parse(JSON.stringify(canonicalise(manifest))) as Record<string, unknown>;
}

const MANIFEST_TEXT = '{"caseCount":1}\n';

test('a manifest of another contract version is refused, not scored', () => {
  const stale = {
    ...manifestOf([reviewedCase('case-a')]),
    version: 'benchmark-release-manifest-v0',
  };
  const problem = releaseManifestProblem(stale);
  assert.notEqual(problem, null);
  assert.match(problem ?? '', /benchmark-release-manifest-v1/);
});

test('a manifest that is not a manifest at all is refused by shape', () => {
  const valid = manifestOf([reviewedCase('case-a')]);
  const cases: [string, unknown][] = [
    ['not an object', 'a string'],
    ['an array', []],
    ['no version', { ...valid, version: undefined }],
    ['no cases', { ...valid, cases: 'nope' }],
    ['a case list that disagrees with caseCount', { ...valid, caseCount: 99 }],
    ['a case entry without a digest', { ...valid, cases: [{ caseId: 'x', file: 'x.json' }] }],
    [
      'a corpus hash that is not a digest',
      {
        ...valid,
        corpusHash: 'short',
        cases: (valid['cases'] as unknown[]).map((entry) => ({
          ...(entry as Record<string, unknown>),
          contentHash: 'short',
        })),
      },
    ],
    ['no gates', { ...valid, gates: 'none' }],
  ];
  for (const [label, value] of cases) {
    const problem = releaseManifestProblem(value);
    assert.notEqual(problem, null, `${label} was accepted as a release manifest`);
  }
  assert.equal(releaseManifestProblem(valid), null, 'a real manifest was refused');
});

test('a matching corpus binds cleanly and carries the manifest identity', () => {
  const cases = [reviewedCase('case-a')];
  const manifest = manifestOf(cases);
  const binding = bindRunToRelease({
    manifest,
    cases,
    validation: corpus(cases),
    manifestText: MANIFEST_TEXT,
  });
  assert.equal(binding.ok, true, binding.refused.join('; '));
  assert.deepEqual(binding.refused, []);
  assert.match(binding.releaseId ?? '', /^release-[0-9a-f]{12}$/);
  assert.equal(binding.caseCount, 1);
  // The identity is over the manifest bytes exactly as they were read, so swapping the file is detectable even
  // if the replacement parses to the same structure.
  assert.equal(binding.manifestSha256, sha256Hex(MANIFEST_TEXT));
  assert.equal(binding.manifestLabel, 'binding-fixture');
});

test('every way a corpus can drift from its release is refused, by name', () => {
  const base = [reviewedCase('case-a'), reviewedCase('case-b')];
  const manifest = manifestOf(base);

  const edited = [
    { ...reviewedCase('case-a'), title: 'changed after the freeze' },
    reviewedCase('case-b'),
  ];
  const added = [...base, reviewedCase('case-c')];
  const removed = [reviewedCase('case-a')];
  const drifted = [
    { ...reviewedCase('case-a'), version: BENCHMARK_CASE_VERSION_V1 },
    reviewedCase('case-b'),
  ];

  const refusals: [string, readonly BenchmarkCase[], string][] = [
    ['changed case', edited, 'CHANGED'],
    ['added case', added, 'ADDED'],
    ['removed case', removed, 'REMOVED'],
    ['contract-drifted case', drifted, 'CONTRACT'],
  ];
  for (const [label, cases, prefix] of refusals) {
    const binding = bindRunToRelease({
      manifest,
      cases,
      validation: corpus(cases),
      manifestText: MANIFEST_TEXT,
    });
    assert.equal(binding.ok, false, `${label} was scored against a release it no longer matches`);
    assert.ok(
      binding.refused.some((line) => line.startsWith(prefix)),
      `${label} refused without naming ${prefix}: ${binding.refused.join('; ')}`,
    );
  }
});

test('a duplicate case id is refused even when its bytes match the manifest', () => {
  const single = [reviewedCase('case-a')];
  const manifest = manifestOf(single);
  const duplicated = [reviewedCase('case-a'), reviewedCase('case-a')];
  const binding = bindRunToRelease({
    manifest,
    cases: duplicated,
    validation: corpus(duplicated),
    manifestText: MANIFEST_TEXT,
  });
  assert.equal(binding.ok, false);
  assert.ok(binding.refused.some((line) => line.startsWith('DUPLICATE')));
});

test('an invalid case in the corpus is refused before scoring, not silently dropped', () => {
  const good = [reviewedCase('case-a')];
  const manifest = manifestOf(good);
  const broken = { ...reviewedCase('case-a'), title: '' };
  const cases = [broken as unknown as BenchmarkCase, ...good];
  const binding = bindRunToRelease({
    manifest,
    cases: good,
    validation: corpus(cases),
    manifestText: MANIFEST_TEXT,
  });
  assert.equal(binding.ok, false);
  assert.ok(
    binding.refused.some((line) => line.startsWith('INVALID')),
    `expected an INVALID refusal, got: ${binding.refused.join('; ')}`,
  );
});

test('a blocking gate failure refuses the run', () => {
  // Reviewers split on p1, and the settling decision was written against a different split, so it is STALE:
  // the subject is unresolved and `noStaleAdjudications` blocks. The case still validates and the manifest still
  // matches, which is the point — a corpus can agree with its release byte for byte and still be untrustworthy,
  // and scoring it as if the stale decision settled something would report a number that means nothing.
  const stale = [
    {
      ...fixtureCase({
        id: 'stale-case',
        reviewedBy: ['dana', 'sam'],
        reviewerLabels: [
          labelFor('dana', 'EVIDENCE_SUPPORT', 'p1', 'SUPPORTED_WITHIN_SCOPE'),
          labelFor('sam', 'EVIDENCE_SUPPORT', 'p1', 'INSUFFICIENT_EVIDENCE'),
          labelFor('dana', 'ANSWER_FIDELITY', 'st1', 'NOT_ASSESSABLE'),
          labelFor('sam', 'ANSWER_FIDELITY', 'st1', 'NOT_ASSESSABLE'),
          labelFor('dana', 'CITATION_SUPPORT', 'st1', 'NOT_ASSESSABLE'),
          labelFor('sam', 'CITATION_SUPPORT', 'st1', 'NOT_ASSESSABLE'),
          labelFor('dana', 'ATTRIBUTION', 'st1', 'NOT_ASSESSABLE'),
          labelFor('sam', 'ATTRIBUTION', 'st1', 'NOT_ASSESSABLE'),
        ],
      }),
      adjudications: [
        {
          dimension: 'EVIDENCE_SUPPORT' as const,
          subjectId: 'p1',
          outcome: 'RESOLVED' as const,
          label: 'SUPPORTED_WITHIN_SCOPE',
          reason: 'Written against a split that has since moved.',
          adjudicatedBy: 'dana',
          disagreementHash: 'b'.repeat(64),
        },
      ],
    },
  ];
  const manifest = buildReleaseManifest(stale, null, 'stale', corpus(stale));
  const binding = bindRunToRelease({
    manifest: JSON.parse(JSON.stringify(canonicalise(manifest))),
    cases: stale,
    validation: corpus(stale),
    manifestText: MANIFEST_TEXT,
  });
  assert.equal(binding.ok, false, 'a run passed with a blocking gate failing');
  assert.ok(
    binding.refused.some((line) => line.startsWith('GATE noStaleAdjudications')),
    `expected the stale-adjudication gate to refuse the run, got: ${binding.refused.join('; ')}`,
  );
});

test('a non-blocking gate is disclosed as a warning and never stops the run', () => {
  // Legacy unbound adjudications are the case the owner asked to keep readable: honoured, disclosed, not
  // credited. They must not refuse a run, and they must not be silent either.
  const unbound = [
    {
      ...reviewedCase('legacy-case'),
      adjudications: [
        {
          dimension: 'ANSWER_FIDELITY' as const,
          subjectId: 'st1',
          outcome: 'RESOLVED' as const,
          label: 'ACCURATE',
          reason: 'Settled before bindings existed.',
          adjudicatedBy: 'dana',
        },
      ],
    },
  ];
  const manifest = buildReleaseManifest(unbound, null, 'legacy', corpus(unbound));
  const binding = bindRunToRelease({
    manifest: JSON.parse(JSON.stringify(canonicalise(manifest))),
    cases: unbound,
    validation: corpus(unbound),
    manifestText: MANIFEST_TEXT,
  });
  assert.equal(
    binding.ok,
    true,
    `an unbound decision refused the run: ${binding.refused.join('; ')}`,
  );
  assert.ok(
    binding.warnings.some((line) => line.includes('allAdjudicationsBound')),
    `expected the unbound gate disclosed, got: ${binding.warnings.join('; ')}`,
  );
});

test('a run with no manifest is allowed, and says it is not release-bound', () => {
  const cases = [reviewedCase('case-a')];
  const binding = bindRunToRelease({
    manifest: null,
    cases,
    validation: corpus(cases),
    manifestText: null,
  });
  assert.equal(binding.ok, true);
  assert.equal(binding.releaseId, null, 'an unbound run invented a release id');
  assert.equal(binding.corpusHash, null);
  assert.equal(binding.manifestSha256, null);
  assert.ok(binding.warnings.includes('NOT-RELEASE-BOUND'));
});

test('a malformed manifest supplied with a corpus is refused before any scoring', () => {
  const cases = [reviewedCase('case-a')];
  const binding = bindRunToRelease({
    manifest: { version: 'benchmark-release-manifest-v1' },
    cases,
    validation: corpus(cases),
    manifestText: '{}',
  });
  assert.equal(binding.ok, false);
  assert.ok(binding.refused.some((line) => line.startsWith('MANIFEST')));
});

test('the binding digest is over the manifest bytes as read, not over a repurposed field', () => {
  const cases = [reviewedCase('case-a')];
  const manifest = manifestOf(cases);
  const first = bindRunToRelease({
    manifest,
    cases,
    validation: corpus(cases),
    manifestText: 'a\n',
  });
  const second = bindRunToRelease({
    manifest,
    cases,
    validation: corpus(cases),
    manifestText: 'b\n',
  });
  assert.equal(first.ok, true);
  assert.notEqual(first.manifestSha256, second.manifestSha256);
  assert.match(first.manifestSha256 ?? '', /^[0-9a-f]{64}$/);
  // Full 64-hex: the truncated 16-character digests a v0.7 report carries are left untouched elsewhere.
  assert.equal((first.manifestSha256 ?? '').length, 64);
});

test('an unbound binding still reports what the corpus holds', () => {
  const cases = [reviewedCase('case-a')];
  const binding: ReleaseBinding = bindRunToRelease({
    manifest: null,
    cases,
    validation: corpus(cases),
    manifestText: null,
  });
  assert.equal(binding.caseCount, cases.length);
  assert.equal(binding.manifestLabel, null, 'an unbound run claimed a manifest label');
});
