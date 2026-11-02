-- Local core v0.4: evaluator integrity rules (ADR-023).
--
-- `metrics-v4` decides that a statement's recorded relevance governs whether it asserts anything,
-- and that a label can only describe what was asserted about it. v0.3 stated that rule in comments
-- and enforced none of it: the form accepted a refusal carrying an ACCURATE verdict, the repository
-- stored it, and the metric block scored it as an accurate factual statement.
--
-- These triggers are the outermost gate. Application code can be bypassed by a restored database, a
-- hand-edited file, or a future caller, and a stored row that contradicts its own relevance would
-- then reappear as a number a reader cannot argue with. A trigger cannot be bypassed.
--
-- Each trigger only speaks when the value it is given already belongs to that axis's own vocabulary.
-- Vocabulary membership is owned by the v0.3 column checks and triggers, which produce the clearer
-- message for a label filed on the wrong axis; a BEFORE INSERT trigger that fired first would pre-empt
-- it and hide which rule was broken. What is added here is strictly the pairing against relevance.
--
-- Every list here mirrors `src/core/claimEligibility.ts`. `tests/integration/schema-evaluator-integrity.test.ts`
-- reads this file and compares each arm against the TypeScript table, because a duplicated rule that
-- nobody checks is worse than no rule at all: it looks enforced.

-- ---------------------------------------------------------------------------
-- Fidelity assessments must be reachable from the statement's relevance
-- ---------------------------------------------------------------------------

CREATE TRIGGER answer_claim_assessments_fidelity_matches_relevance
BEFORE INSERT ON answer_claim_assessments
WHEN NEW.dimension = 'FIDELITY' AND NEW.label IN ('ACCURATE', 'PARTIALLY_ACCURATE', 'CONTRADICTED', 'UNSUPPORTED', 'OMITTED', 'REFUSED', 'UNAVAILABLE', 'NOT_ADDRESSED', 'NOT_ASSESSABLE')
  AND NOT (
  CASE (SELECT relevance FROM answer_claim_revisions WHERE id = NEW.claim_revision_id)
    WHEN 'ADDRESSES' THEN NEW.label IN (
      'ACCURATE', 'PARTIALLY_ACCURATE', 'CONTRADICTED', 'UNSUPPORTED', 'NOT_ASSESSABLE')
    WHEN 'PARTIALLY_ADDRESSES' THEN NEW.label IN (
      'ACCURATE', 'PARTIALLY_ACCURATE', 'CONTRADICTED', 'UNSUPPORTED', 'NOT_ASSESSABLE')
    WHEN 'QUALIFIES' THEN NEW.label IN (
      'ACCURATE', 'PARTIALLY_ACCURATE', 'CONTRADICTED', 'UNSUPPORTED', 'NOT_ASSESSABLE')
    WHEN 'CONTRADICTS' THEN NEW.label IN (
      'ACCURATE', 'PARTIALLY_ACCURATE', 'CONTRADICTED', 'UNSUPPORTED', 'NOT_ASSESSABLE')
    WHEN 'DOES_NOT_ADDRESS' THEN NEW.label IN ('NOT_ADDRESSED', 'NOT_ASSESSABLE')
    WHEN 'UNRELATED' THEN NEW.label IN ('NOT_ADDRESSED', 'NOT_ASSESSABLE')
    WHEN 'AMBIGUOUS' THEN NEW.label IN ('NOT_ADDRESSED', 'NOT_ASSESSABLE')
    WHEN 'REFUSAL' THEN NEW.label IN ('REFUSED', 'NOT_ADDRESSED', 'NOT_ASSESSABLE')
    WHEN 'ABSTENTION' THEN NEW.label IN ('NOT_ADDRESSED', 'NOT_ASSESSABLE')
    WHEN 'OMISSION' THEN NEW.label IN ('OMITTED', 'NOT_ADDRESSED', 'NOT_ASSESSABLE')
    WHEN 'UNAVAILABLE' THEN NEW.label IN ('UNAVAILABLE', 'NOT_ADDRESSED', 'NOT_ASSESSABLE')
    WHEN 'NOT_ASSESSABLE' THEN NEW.label = 'NOT_ASSESSABLE'
    ELSE FALSE
  END
)
BEGIN
  SELECT RAISE(ABORT, 'claim fidelity label contradicts the recorded relevance');
END;

-- ---------------------------------------------------------------------------
-- Attribution assessments: credit can only be claimed by an asserting statement
-- ---------------------------------------------------------------------------

CREATE TRIGGER answer_claim_assessments_attribution_matches_relevance
BEFORE INSERT ON answer_claim_assessments
WHEN NEW.dimension = 'ATTRIBUTION' AND NEW.label IN ('CORRECT', 'PARTIALLY_CORRECT', 'WRONG_ROLE', 'WRONG_PERSON', 'AMBIGUOUS', 'COLLABORATIVE_PARTIAL', 'FALSE_SOLE_CREDIT', 'UNATTRIBUTED', 'INCORRECT', 'NOT_ADDRESSED', 'NOT_ASSESSABLE')
  AND NOT (
  CASE (SELECT relevance FROM answer_claim_revisions WHERE id = NEW.claim_revision_id)
    WHEN 'ADDRESSES' THEN NEW.label IN (
      'CORRECT', 'PARTIALLY_CORRECT', 'WRONG_ROLE', 'WRONG_PERSON', 'AMBIGUOUS',
      'COLLABORATIVE_PARTIAL', 'FALSE_SOLE_CREDIT', 'UNATTRIBUTED', 'INCORRECT',
      'NOT_ADDRESSED', 'NOT_ASSESSABLE')
    WHEN 'PARTIALLY_ADDRESSES' THEN NEW.label IN (
      'CORRECT', 'PARTIALLY_CORRECT', 'WRONG_ROLE', 'WRONG_PERSON', 'AMBIGUOUS',
      'COLLABORATIVE_PARTIAL', 'FALSE_SOLE_CREDIT', 'UNATTRIBUTED', 'INCORRECT',
      'NOT_ADDRESSED', 'NOT_ASSESSABLE')
    WHEN 'QUALIFIES' THEN NEW.label IN (
      'CORRECT', 'PARTIALLY_CORRECT', 'WRONG_ROLE', 'WRONG_PERSON', 'AMBIGUOUS',
      'COLLABORATIVE_PARTIAL', 'FALSE_SOLE_CREDIT', 'UNATTRIBUTED', 'INCORRECT',
      'NOT_ADDRESSED', 'NOT_ASSESSABLE')
    WHEN 'CONTRADICTS' THEN NEW.label IN (
      'CORRECT', 'PARTIALLY_CORRECT', 'WRONG_ROLE', 'WRONG_PERSON', 'AMBIGUOUS',
      'COLLABORATIVE_PARTIAL', 'FALSE_SOLE_CREDIT', 'UNATTRIBUTED', 'INCORRECT',
      'NOT_ADDRESSED', 'NOT_ASSESSABLE')
    ELSE NEW.label IN ('NOT_ADDRESSED', 'NOT_ASSESSABLE')
  END
)
BEGIN
  SELECT RAISE(ABORT, 'claim attribution label contradicts the recorded relevance');
END;

-- ---------------------------------------------------------------------------
-- Proposition links must be reachable from the statement's relevance
-- ---------------------------------------------------------------------------

-- This is the pair that let an unrelated statement manufacture a relevant omission: the relation row
-- said OMITS_TARGET and nothing compared it with the relevance on the statement. `OMITS_TARGET` is
-- reachable only from PARTIALLY_ADDRESSES and OMISSION, and `NOT_ASSESSABLE_TARGET` stays reachable
-- from everywhere so the reviewer can always record an honest unknown.
CREATE TRIGGER answer_claim_propositions_relation_matches_relevance
BEFORE INSERT ON answer_claim_propositions
WHEN NEW.relation IN ('SUPPORTS_TARGET', 'PARTIALLY_SUPPORTS_TARGET', 'CONTRADICTS_TARGET', 'QUALIFIES_TARGET', 'DOES_NOT_ADDRESS_TARGET', 'AMBIGUOUS_TARGET', 'REFUSES_TARGET', 'ABSTAINS_TARGET', 'OMITS_TARGET', 'NOT_ASSESSABLE_TARGET')
  AND NOT (
  CASE (SELECT relevance FROM answer_claim_revisions WHERE id = NEW.claim_revision_id)
    WHEN 'ADDRESSES' THEN NEW.relation IN (
      'SUPPORTS_TARGET', 'CONTRADICTS_TARGET', 'QUALIFIES_TARGET', 'NOT_ASSESSABLE_TARGET')
    WHEN 'PARTIALLY_ADDRESSES' THEN NEW.relation IN (
      'PARTIALLY_SUPPORTS_TARGET', 'SUPPORTS_TARGET', 'QUALIFIES_TARGET', 'CONTRADICTS_TARGET',
      'OMITS_TARGET', 'NOT_ASSESSABLE_TARGET')
    WHEN 'QUALIFIES' THEN NEW.relation IN (
      'QUALIFIES_TARGET', 'SUPPORTS_TARGET', 'PARTIALLY_SUPPORTS_TARGET', 'NOT_ASSESSABLE_TARGET')
    WHEN 'CONTRADICTS' THEN NEW.relation IN (
      'CONTRADICTS_TARGET', 'QUALIFIES_TARGET', 'NOT_ASSESSABLE_TARGET')
    WHEN 'DOES_NOT_ADDRESS' THEN NEW.relation IN (
      'DOES_NOT_ADDRESS_TARGET', 'NOT_ASSESSABLE_TARGET')
    WHEN 'UNRELATED' THEN NEW.relation IN (
      'DOES_NOT_ADDRESS_TARGET', 'NOT_ASSESSABLE_TARGET')
    WHEN 'AMBIGUOUS' THEN NEW.relation IN (
      'AMBIGUOUS_TARGET', 'DOES_NOT_ADDRESS_TARGET', 'NOT_ASSESSABLE_TARGET')
    WHEN 'REFUSAL' THEN NEW.relation IN (
      'REFUSES_TARGET', 'DOES_NOT_ADDRESS_TARGET', 'NOT_ASSESSABLE_TARGET')
    WHEN 'ABSTENTION' THEN NEW.relation IN (
      'ABSTAINS_TARGET', 'DOES_NOT_ADDRESS_TARGET', 'NOT_ASSESSABLE_TARGET')
    WHEN 'OMISSION' THEN NEW.relation IN (
      'OMITS_TARGET', 'DOES_NOT_ADDRESS_TARGET', 'NOT_ASSESSABLE_TARGET')
    WHEN 'UNAVAILABLE' THEN NEW.relation IN (
      'DOES_NOT_ADDRESS_TARGET', 'NOT_ASSESSABLE_TARGET')
    WHEN 'NOT_ASSESSABLE' THEN NEW.relation IN (
      'NOT_ASSESSABLE_TARGET', 'DOES_NOT_ADDRESS_TARGET')
    ELSE FALSE
  END
)
BEGIN
  SELECT RAISE(ABORT, 'claim proposition relation contradicts the recorded relevance');
END;

-- ---------------------------------------------------------------------------
-- Citation mappings: an assertion must exist before material can support it
-- ---------------------------------------------------------------------------

-- Cited material supports an assertion. With no assertion there is nothing to support, so a
-- non-asserting statement may only record that the material was unclear, absent, or unassessable.
CREATE TRIGGER answer_claim_citations_support_matches_relevance
BEFORE INSERT ON answer_claim_citations
WHEN NEW.support IN ('SUPPORTS', 'PARTIALLY_SUPPORTS', 'SUPPORTS_WITH_CONDITIONS', 'DOES_NOT_SUPPORT', 'UNCLEAR', 'METADATA_MISSING', 'NOT_ASSESSABLE')
  AND NOT (
  CASE (SELECT relevance FROM answer_claim_revisions WHERE id = NEW.claim_revision_id)
    WHEN 'ADDRESSES' THEN NEW.support IN (
      'SUPPORTS', 'PARTIALLY_SUPPORTS', 'SUPPORTS_WITH_CONDITIONS', 'DOES_NOT_SUPPORT',
      'UNCLEAR', 'METADATA_MISSING', 'NOT_ASSESSABLE')
    WHEN 'PARTIALLY_ADDRESSES' THEN NEW.support IN (
      'SUPPORTS', 'PARTIALLY_SUPPORTS', 'SUPPORTS_WITH_CONDITIONS', 'DOES_NOT_SUPPORT',
      'UNCLEAR', 'METADATA_MISSING', 'NOT_ASSESSABLE')
    WHEN 'QUALIFIES' THEN NEW.support IN (
      'SUPPORTS', 'PARTIALLY_SUPPORTS', 'SUPPORTS_WITH_CONDITIONS', 'DOES_NOT_SUPPORT',
      'UNCLEAR', 'METADATA_MISSING', 'NOT_ASSESSABLE')
    WHEN 'CONTRADICTS' THEN NEW.support IN (
      'SUPPORTS', 'PARTIALLY_SUPPORTS', 'SUPPORTS_WITH_CONDITIONS', 'DOES_NOT_SUPPORT',
      'UNCLEAR', 'METADATA_MISSING', 'NOT_ASSESSABLE')
    ELSE NEW.support IN ('UNCLEAR', 'METADATA_MISSING', 'NOT_ASSESSABLE')
  END
)
BEGIN
  SELECT RAISE(ABORT, 'claim citation support contradicts the recorded relevance');
END;

-- The application already refuses a new mapping to a voided citation. This is the same rule at the
-- outermost layer: a mapping recorded against withdrawn material would look like support in every
-- figure the report produces.
CREATE TRIGGER answer_claim_citations_require_active_citation
BEFORE INSERT ON answer_claim_citations
WHEN (SELECT voided_at FROM citations WHERE id = NEW.citation_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a voided citation cannot be mapped to a statement');
END;
