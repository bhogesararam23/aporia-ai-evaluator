import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CLAIM_ATTRIBUTION_LABELS,
  CLAIM_CITATION_SUPPORT_LABELS,
  CLAIM_FIDELITY_LABELS,
  CLAIM_PROPOSITION_RELATIONS,
  CLAIM_RELEVANCES,
  type ClaimRelevance,
} from '../../src/core/answerClaims.ts';
import {
  attributionEligibility,
  citationSupportEligibility,
  engagesTarget,
  fidelityEligibility,
  isKnownRelevance,
  omissionEligibility,
  permittedAttributionLabels,
  permittedCitationSupportLabels,
  permittedFidelityLabels,
  permittedPropositionRelations,
} from '../../src/core/claimEligibility.ts';
import { EXCLUSION_REASONS, EXCLUSION_DESCRIPTIONS } from '../../src/core/metricsCommon.ts';

/**
 * The eligibility contract is the thing that decides whether a recorded statement can be scored, so
 * these tests are written against the vocabulary rather than against a fixture. Anything that holds
 * for every relevance must not depend on one example being picked well.
 */

const DEFINITIVE_FIDELITY = ['ACCURATE', 'PARTIALLY_ACCURATE', 'CONTRADICTED', 'UNSUPPORTED'];
const ASSERTING: readonly ClaimRelevance[] = [
  'ADDRESSES',
  'PARTIALLY_ADDRESSES',
  'QUALIFIES',
  'CONTRADICTS',
];
const NON_ASSERTING = CLAIM_RELEVANCES.filter((value) => !ASSERTING.includes(value));

test('every relevance has a permitted set on every axis and each set is inside its vocabulary', () => {
  for (const relevance of CLAIM_RELEVANCES) {
    assert.ok(permittedFidelityLabels(relevance).length > 0, relevance);
    assert.ok(permittedAttributionLabels(relevance).length > 0, relevance);
    assert.ok(permittedCitationSupportLabels(relevance).length > 0, relevance);
    assert.ok(permittedPropositionRelations(relevance).length > 0, relevance);
    for (const label of permittedFidelityLabels(relevance)) {
      assert.ok(CLAIM_FIDELITY_LABELS.includes(label), `${relevance}: ${label}`);
    }
    for (const label of permittedAttributionLabels(relevance)) {
      assert.ok(CLAIM_ATTRIBUTION_LABELS.includes(label), `${relevance}: ${label}`);
    }
    for (const label of permittedCitationSupportLabels(relevance)) {
      assert.ok(CLAIM_CITATION_SUPPORT_LABELS.includes(label), `${relevance}: ${label}`);
    }
    for (const relation of permittedPropositionRelations(relevance)) {
      assert.ok(CLAIM_PROPOSITION_RELATIONS.includes(relation), `${relevance}: ${relation}`);
    }
  }
});

test('a non-asserting relevance never permits a definitive fidelity label', () => {
  for (const relevance of NON_ASSERTING) {
    for (const label of DEFINITIVE_FIDELITY) {
      assert.equal(
        permittedFidelityLabels(relevance).includes(label as never),
        false,
        `${relevance} must not permit ${label}`,
      );
    }
  }
});

test('every asserting relevance reaches every definitive fidelity label', () => {
  for (const relevance of ASSERTING) {
    for (const label of DEFINITIVE_FIDELITY) {
      assert.ok(
        permittedFidelityLabels(relevance).includes(label as never),
        `${relevance} should permit ${label}`,
      );
    }
  }
});

test('only an asserting statement can credit a contribution', () => {
  for (const relevance of CLAIM_RELEVANCES) {
    const permitted = permittedAttributionLabels(relevance);
    if (ASSERTING.includes(relevance)) {
      assert.ok(permitted.includes('CORRECT'), relevance);
    } else {
      assert.deepEqual(permitted, ['NOT_ADDRESSED', 'NOT_ASSESSABLE'], relevance);
    }
  }
});

test('a consistent label that asserts no verdict still stays outside the denominator', () => {
  // NOT_ASSESSABLE is reachable from ADDRESSES, so the consistency check alone would let an
  // unjudged statement into the fidelity denominator and pull the rate down.
  const fidelity = fidelityEligibility({
    relevance: 'ADDRESSES',
    fidelityLabel: 'NOT_ASSESSABLE',
    voided: false,
  });
  assert.equal(fidelity.eligible, false);
  assert.equal(fidelity.reason, 'CLAIM_NOT_ASSESSABLE');

  const notAddressed = attributionEligibility({
    relevance: 'ADDRESSES',
    attributionLabel: 'NOT_ADDRESSED',
    voided: false,
  });
  assert.equal(notAddressed.eligible, false);
  assert.equal(notAddressed.reason, 'CLAIM_ATTRIBUTION_NOT_ADDRESSED');

  // The scorable case, stated next to the one above so the two cannot be confused.
  assert.equal(
    fidelityEligibility({ relevance: 'ADDRESSES', fidelityLabel: 'ACCURATE', voided: false })
      .eligible,
    true,
  );
  assert.equal(
    attributionEligibility({
      relevance: 'ADDRESSES',
      attributionLabel: 'WRONG_ROLE',
      voided: false,
    }).eligible,
    true,
  );
});

test('an omitted statement credits nobody, and relevance says so before the label does', () => {
  const decision = attributionEligibility({
    relevance: 'OMISSION',
    attributionLabel: 'NOT_ADDRESSED',
    voided: false,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, 'CLAIM_OMITTED');
});

test('cited material can only support a statement that asserted something', () => {
  for (const relevance of CLAIM_RELEVANCES) {
    const permitted = permittedCitationSupportLabels(relevance);
    const definitive = ['SUPPORTS', 'PARTIALLY_SUPPORTS', 'SUPPORTS_WITH_CONDITIONS'];
    if (ASSERTING.includes(relevance)) {
      for (const label of definitive) {
        assert.ok(permitted.includes(label as never), `${relevance} should permit ${label}`);
      }
    } else {
      for (const label of definitive) {
        assert.equal(permitted.includes(label as never), false, `${relevance}: ${label}`);
      }
    }
    // An unavailable check is always honest, on either side of the line.
    assert.ok(permitted.includes('NOT_ASSESSABLE'), relevance);
    assert.ok(permitted.includes('METADATA_MISSING'), relevance);
  }
});

test('only a partially-addressed or omitted statement can record an omission', () => {
  for (const relevance of CLAIM_RELEVANCES) {
    const permitsOmission = permittedPropositionRelations(relevance).includes('OMITS_TARGET');
    assert.equal(
      permitsOmission,
      relevance === 'PARTIALLY_ADDRESSES' || relevance === 'OMISSION',
      `${relevance} OMITS_TARGET permitted=${String(permitsOmission)}`,
    );
    // "The reviewer could not tell" stays available everywhere, so the table never forces a verdict.
    assert.ok(
      permittedPropositionRelations(relevance).includes('NOT_ASSESSABLE_TARGET'),
      relevance,
    );
  }
});

test('a refusal carrying an accurate label is excluded, and the conflict is named', () => {
  const decision = fidelityEligibility({
    relevance: 'REFUSAL',
    fidelityLabel: 'ACCURATE',
    voided: false,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, 'CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE');
  assert.match(decision.explanation, /refusal/i);
});

test('an omission carrying a contradicted label is excluded rather than scored as false', () => {
  const decision = fidelityEligibility({
    relevance: 'OMISSION',
    fidelityLabel: 'CONTRADICTED',
    voided: false,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, 'CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE');
});

test('an unrelated statement is excluded with a reason that names the relevance', () => {
  const decision = fidelityEligibility({
    relevance: 'UNRELATED',
    fidelityLabel: 'NOT_ADDRESSED',
    voided: false,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, 'CLAIM_UNRELATED');
});

test('abstention gets its own exclusion instead of being filed as a refusal', () => {
  const decision = fidelityEligibility({
    relevance: 'ABSTENTION',
    fidelityLabel: 'NOT_ADDRESSED',
    voided: false,
  });
  assert.equal(decision.reason, 'CLAIM_ABSTENTION');
});

test('a voided statement leaves first, whatever its label claims', () => {
  for (const relevance of CLAIM_RELEVANCES) {
    const decision = fidelityEligibility({
      relevance,
      fidelityLabel: 'ACCURATE',
      voided: true,
    });
    assert.equal(decision.eligible, false, relevance);
    assert.equal(decision.reason, 'CLAIM_VOIDED', relevance);
  }
});

test('a statement with no fidelity assessment is unassessed, not excluded as a non-assertion', () => {
  const asserting = fidelityEligibility({
    relevance: 'ADDRESSES',
    fidelityLabel: undefined,
    voided: false,
  });
  assert.equal(asserting.reason, 'CLAIM_FIDELITY_UNASSESSED');
  const nonAsserting = fidelityEligibility({
    relevance: 'REFUSAL',
    fidelityLabel: undefined,
    voided: false,
  });
  assert.equal(nonAsserting.reason, 'CLAIM_FIDELITY_UNASSESSED');
});

test('a label from the wrong axis is reported as invalid, never trusted', () => {
  const decision = fidelityEligibility({
    relevance: 'ADDRESSES',
    fidelityLabel: 'CORRECT',
    voided: false,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, 'CLAIM_LABEL_INVALID');
});

test('an unknown relevance excludes on every axis rather than guessing', () => {
  assert.equal(isKnownRelevance('BANANA'), false);
  assert.equal(
    fidelityEligibility({ relevance: 'BANANA', fidelityLabel: 'ACCURATE', voided: false }).reason,
    'CLAIM_LABEL_INVALID',
  );
  assert.equal(
    attributionEligibility({
      relevance: 'BANANA',
      attributionLabel: 'CORRECT',
      voided: false,
    }).reason,
    'CLAIM_LABEL_INVALID',
  );
  assert.equal(
    citationSupportEligibility({
      relevance: 'BANANA',
      support: 'SUPPORTS',
      citationVoided: false,
      claimVoided: false,
    }).reason,
    'CLAIM_LABEL_INVALID',
  );
  assert.equal(
    omissionEligibility({
      relevance: 'BANANA',
      relation: 'OMITS_TARGET',
      voided: false,
    }).reason,
    'CLAIM_LABEL_INVALID',
  );
});

test('a mapping to a voided citation supports nothing and says so', () => {
  const decision = citationSupportEligibility({
    relevance: 'ADDRESSES',
    support: 'SUPPORTS',
    citationVoided: true,
    claimVoided: false,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, 'CLAIM_CITATION_VOIDED');
});

test('citation eligibility prefers the statement void over the citation void', () => {
  const decision = citationSupportEligibility({
    relevance: 'ADDRESSES',
    support: 'SUPPORTS',
    citationVoided: true,
    claimVoided: true,
  });
  assert.equal(decision.reason, 'CLAIM_VOIDED');
});

test('a support label on a refusal is excluded as a non-assertion', () => {
  const decision = citationSupportEligibility({
    relevance: 'REFUSAL',
    support: 'SUPPORTS',
    citationVoided: false,
    claimVoided: false,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, 'CLAIM_CITATION_NON_ASSERTING');
});

test('an asserting statement with a definitive support label is inside the denominator', () => {
  for (const support of [
    'SUPPORTS',
    'PARTIALLY_SUPPORTS',
    'SUPPORTS_WITH_CONDITIONS',
    'DOES_NOT_SUPPORT',
  ] as const) {
    const decision = citationSupportEligibility({
      relevance: 'ADDRESSES',
      support,
      citationVoided: false,
      claimVoided: false,
    });
    // Partial support and conditional support enter the denominator and are shown separately; only
    // the numerator rule elsewhere decides whether they read as supported.
    assert.equal(decision.eligible, true, support);
    assert.equal(decision.reason, null, support);
  }
});

test('an unrelated statement cannot manufacture an omission', () => {
  const decision = omissionEligibility({
    relevance: 'UNRELATED',
    relation: 'OMITS_TARGET',
    voided: false,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, 'CLAIM_OMISSION_NON_ENGAGING');
});

test('an inconsistent relation is reported as a conflict rather than silently dropped', () => {
  const decision = omissionEligibility({
    relevance: 'ADDRESSES',
    relation: 'OMITS_TARGET',
    voided: false,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, 'CLAIM_LABEL_CONFLICTS_WITH_RELEVANCE');
});

test('a reviewer-recorded omission is inside the omission measure', () => {
  assert.equal(
    omissionEligibility({ relevance: 'OMISSION', relation: 'OMITS_TARGET', voided: false })
      .eligible,
    true,
  );
  assert.equal(engagesTarget('OMISSION'), true);
  assert.equal(engagesTarget('REFUSAL'), false);
  assert.equal(engagesTarget('DOES_NOT_ADDRESS'), false);
});

test('attribution on a refusing statement is excluded by relevance, not by label', () => {
  const decision = attributionEligibility({
    relevance: 'REFUSAL',
    attributionLabel: 'NOT_ADDRESSED',
    voided: false,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, 'CLAIM_REFUSED');
});

test('every reason the contract can produce is a real, described exclusion', () => {
  const produced = new Set<string>();
  for (const relevance of CLAIM_RELEVANCES) {
    produced.add(String(fidelityEligibility({ relevance, voided: true }).reason));
    for (const label of [...CLAIM_FIDELITY_LABELS, undefined]) {
      produced.add(
        String(fidelityEligibility({ relevance, fidelityLabel: label, voided: false }).reason),
      );
    }
    for (const label of [...CLAIM_ATTRIBUTION_LABELS, undefined]) {
      produced.add(
        String(
          attributionEligibility({ relevance, attributionLabel: label, voided: false }).reason,
        ),
      );
    }
    for (const support of CLAIM_CITATION_SUPPORT_LABELS) {
      produced.add(
        String(
          citationSupportEligibility({
            relevance,
            support,
            citationVoided: false,
            claimVoided: false,
          }).reason,
        ),
      );
      produced.add(
        String(
          citationSupportEligibility({
            relevance,
            support,
            citationVoided: true,
            claimVoided: false,
          }).reason,
        ),
      );
    }
    for (const relation of CLAIM_PROPOSITION_RELATIONS) {
      produced.add(String(omissionEligibility({ relevance, relation, voided: false }).reason));
    }
  }
  for (const relevance of ['BANANA', 'ADDRESSES']) {
    // `null` is the eligible answer; anything else must be a listed reason with a description.
    assert.equal(
      fidelityEligibility({ relevance, fidelityLabel: 'ACCURATE', voided: false }).eligible,
      relevance === 'ADDRESSES',
    );
  }
  for (const reason of produced) {
    if (reason === 'null') {
      continue;
    }
    assert.ok(
      (EXCLUSION_REASONS as readonly string[]).includes(reason),
      `${reason} is not a listed exclusion reason`,
    );
    assert.ok(
      EXCLUSION_DESCRIPTIONS[reason as keyof typeof EXCLUSION_DESCRIPTIONS].length > 20,
      `${reason} needs a reader-facing description`,
    );
  }
});
