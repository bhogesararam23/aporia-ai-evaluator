-- Local core v0.3: claim-level answer evaluation (ADR-018).
--
-- Answer claims are the operator's record of individual factual statements inside one captured AI
-- answer. The raw `observations.answer_text` stays the only copy of the answer and stays immutable.
-- Offsets count Unicode code points, which is what lets a trigger below re-derive a verbatim quote
-- from the stored range.

CREATE TABLE answer_claims (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  current_revision_id TEXT REFERENCES answer_claim_revisions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  voided_at TEXT,
  void_reason TEXT,
  UNIQUE(observation_id, ordinal)
) STRICT;

CREATE INDEX answer_claims_observation_idx ON answer_claims(observation_id, ordinal);
CREATE INDEX answer_claims_project_idx ON answer_claims(project_id, created_at);

CREATE TABLE answer_claim_revisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  claim_id TEXT NOT NULL REFERENCES answer_claims(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  quote_text TEXT NOT NULL CHECK (length(quote_text) BETWEEN 1 AND 4000),
  statement_kind TEXT NOT NULL CHECK (statement_kind IN (
    'QUOTED', 'REVIEWER_DESCRIPTION'
  )),
  offset_basis TEXT NOT NULL CHECK (offset_basis IN (
    'EXACT_MATCH', 'NORMALIZED_MATCH', 'NOT_ESTABLISHED'
  )),
  start_offset INTEGER,
  end_offset INTEGER,
  relevance TEXT NOT NULL CHECK (relevance IN (
    'ADDRESSES', 'PARTIALLY_ADDRESSES', 'QUALIFIES', 'CONTRADICTS', 'DOES_NOT_ADDRESS',
    'AMBIGUOUS', 'UNRELATED', 'REFUSAL', 'ABSTENTION', 'OMISSION', 'UNAVAILABLE',
    'NOT_ASSESSABLE'
  )),
  paraphrase TEXT CHECK (paraphrase IS NULL OR length(paraphrase) BETWEEN 1 AND 2000),
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 2000),
  supersedes_revision_id TEXT REFERENCES answer_claim_revisions(id) ON DELETE SET NULL,
  decomposition_version TEXT NOT NULL CHECK (length(decomposition_version) BETWEEN 1 AND 80),
  created_by TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  UNIQUE(claim_id, revision),
  UNIQUE(id, project_id),
  UNIQUE(id, claim_id),
  CHECK (
    (offset_basis = 'NOT_ESTABLISHED' AND start_offset IS NULL AND end_offset IS NULL)
    OR (
      offset_basis <> 'NOT_ESTABLISHED'
      AND start_offset IS NOT NULL
      AND end_offset IS NOT NULL
      AND start_offset >= 0
      AND end_offset > start_offset
    )
  ),
  -- An omission is something the answer failed to say, so it cannot be a quotation located inside
  -- the answer. Without this rule the field name would let a recorded omission be stored as if the
  -- answer had literally contained that wording.
  CHECK (relevance <> 'OMISSION' OR statement_kind = 'REVIEWER_DESCRIPTION'),
  -- A `QUOTED` revision asserts that the answer really contained these words, so it must carry a
  -- locatable range that the trigger above can re-derive. A `REVIEWER_DESCRIPTION` is the
  -- operator's own words and must never claim a range, so a reader cannot mistake one for the other.
  CHECK (
    (statement_kind = 'QUOTED' AND offset_basis IN ('EXACT_MATCH', 'NORMALIZED_MATCH'))
    OR (statement_kind = 'REVIEWER_DESCRIPTION' AND offset_basis = 'NOT_ESTABLISHED')
  )
) STRICT;

CREATE INDEX answer_claim_revisions_claim_idx
  ON answer_claim_revisions(claim_id, revision DESC);

CREATE TABLE answer_claim_propositions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  claim_revision_id TEXT NOT NULL,
  proposition_id TEXT NOT NULL REFERENCES propositions(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN (
    'SUPPORTS_TARGET', 'PARTIALLY_SUPPORTS_TARGET', 'CONTRADICTS_TARGET', 'QUALIFIES_TARGET',
    'DOES_NOT_ADDRESS_TARGET', 'AMBIGUOUS_TARGET', 'REFUSES_TARGET', 'ABSTAINS_TARGET',
    'OMITS_TARGET', 'NOT_ASSESSABLE_TARGET'
  )),
  rationale TEXT NOT NULL CHECK (length(rationale) BETWEEN 1 AND 4000),
  reviewer TEXT NOT NULL CHECK (length(reviewer) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  superseded_by TEXT REFERENCES answer_claim_propositions(id)
    ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  superseded_at TEXT,
  FOREIGN KEY (claim_revision_id, project_id)
    REFERENCES answer_claim_revisions(id, project_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX answer_claim_propositions_proposition_idx
  ON answer_claim_propositions(proposition_id, relation, created_at);
CREATE INDEX answer_claim_propositions_project_idx
  ON answer_claim_propositions(project_id);

-- One active link per statement/proposition pair; a corrected link supersedes rather than edits.
CREATE UNIQUE INDEX answer_claim_propositions_active_pair
  ON answer_claim_propositions(claim_revision_id, proposition_id)
  WHERE superseded_by IS NULL;

CREATE TABLE answer_claim_citations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  claim_revision_id TEXT NOT NULL,
  citation_id TEXT NOT NULL REFERENCES citations(id) ON DELETE CASCADE,
  support TEXT NOT NULL CHECK (support IN (
    'SUPPORTS', 'PARTIALLY_SUPPORTS', 'SUPPORTS_WITH_CONDITIONS', 'DOES_NOT_SUPPORT',
    'UNCLEAR', 'METADATA_MISSING', 'NOT_ASSESSABLE'
  )),
  rationale TEXT NOT NULL CHECK (length(rationale) BETWEEN 1 AND 4000),
  reviewer TEXT NOT NULL CHECK (length(reviewer) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  superseded_by TEXT REFERENCES answer_claim_citations(id)
    ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  superseded_at TEXT,
  FOREIGN KEY (claim_revision_id, project_id)
    REFERENCES answer_claim_revisions(id, project_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX answer_claim_citations_citation_idx ON answer_claim_citations(citation_id);
CREATE INDEX answer_claim_citations_project_idx ON answer_claim_citations(project_id);

-- One active mapping per statement/citation pair. The same citation may be mapped to several
-- different statements, which is how a shared citation stays visible instead of duplicated.
CREATE UNIQUE INDEX answer_claim_citations_active_pair
  ON answer_claim_citations(claim_revision_id, citation_id)
  WHERE superseded_by IS NULL;

CREATE TABLE answer_claim_assessments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  claim_id TEXT NOT NULL REFERENCES answer_claims(id) ON DELETE CASCADE,
  claim_revision_id TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('FIDELITY', 'ATTRIBUTION')),
  version INTEGER NOT NULL CHECK (version > 0),
  label TEXT NOT NULL,
  rationale TEXT NOT NULL CHECK (length(rationale) BETWEEN 1 AND 4000),
  reviewer TEXT NOT NULL CHECK (length(reviewer) BETWEEN 1 AND 80),
  attribution_subject TEXT
    CHECK (attribution_subject IS NULL OR length(attribution_subject) BETWEEN 1 AND 200),
  attribution_role TEXT
    CHECK (attribution_role IS NULL OR length(attribution_role) BETWEEN 1 AND 200),
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  created_at TEXT NOT NULL,
  UNIQUE(claim_revision_id, dimension, version),
  FOREIGN KEY (claim_revision_id, claim_id)
    REFERENCES answer_claim_revisions(id, claim_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX answer_claim_assessments_claim_idx
  ON answer_claim_assessments(claim_id, dimension, version DESC);

-- ---------------------------------------------------------------------------
-- Answer claim scope and lifecycle
-- ---------------------------------------------------------------------------

CREATE TRIGGER answer_claims_observation_same_project
BEFORE INSERT ON answer_claims
WHEN (
  SELECT r.project_id
  FROM observations o
  JOIN runs r ON r.id = o.run_id
  WHERE o.id = NEW.observation_id
) IS NOT NEW.project_id
BEGIN
  SELECT RAISE(ABORT, 'answer claims must belong to the project that owns the observation');
END;

CREATE TRIGGER answer_claims_require_open_run
BEFORE INSERT ON answer_claims
WHEN (
  SELECT r.status
  FROM observations o
  JOIN runs r ON r.id = o.run_id
  WHERE o.id = NEW.observation_id
) <> 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'answer claims may only be recorded against an observation in an open run');
END;

CREATE TRIGGER answer_claims_require_captured_text
BEFORE INSERT ON answer_claims
WHEN (SELECT answer_text FROM observations WHERE id = NEW.observation_id) IS NULL
BEGIN
  SELECT RAISE(ABORT, 'a statement cannot be quoted from an answer with no captured text');
END;

CREATE TRIGGER answer_claims_require_active_observation
BEFORE INSERT ON answer_claims
WHEN (SELECT voided_at FROM observations WHERE id = NEW.observation_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'answer claims may not be recorded against a voided observation');
END;

CREATE TRIGGER answer_claims_current_revision_same_claim_insert
BEFORE INSERT ON answer_claims
WHEN NEW.current_revision_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM answer_claim_revisions
    WHERE id = NEW.current_revision_id AND claim_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'the current revision must belong to this answer claim');
END;

CREATE TRIGGER answer_claims_current_revision_same_claim_update
BEFORE UPDATE OF current_revision_id ON answer_claims
WHEN NEW.current_revision_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM answer_claim_revisions
    WHERE id = NEW.current_revision_id AND claim_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'the current revision must belong to this answer claim');
END;

CREATE TRIGGER answer_claims_immutable_fields
BEFORE UPDATE ON answer_claims
WHEN NEW.id IS NOT OLD.id
  OR NEW.project_id IS NOT OLD.project_id
  OR NEW.observation_id IS NOT OLD.observation_id
  OR NEW.ordinal IS NOT OLD.ordinal
  OR NEW.created_at IS NOT OLD.created_at
  OR OLD.voided_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'answer claims are immutable except the current revision and one void');
END;

CREATE TRIGGER answer_claims_void_requires_reason
BEFORE UPDATE ON answer_claims
WHEN NEW.voided_at IS NOT NULL
  AND (NEW.void_reason IS NULL OR length(NEW.void_reason) < 3)
BEGIN
  SELECT RAISE(ABORT, 'voiding an answer claim requires a reason');
END;

CREATE TRIGGER answer_claims_void_only_while_open
BEFORE UPDATE ON answer_claims
WHEN NEW.voided_at IS NOT NULL
  AND (
    SELECT r.status
    FROM observations o
    JOIN runs r ON r.id = o.run_id
    WHERE o.id = NEW.observation_id
  ) <> 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'answer claims can only be voided while the run is open');
END;

-- ---------------------------------------------------------------------------
-- Statement revisions
-- ---------------------------------------------------------------------------

CREATE TRIGGER answer_claim_revisions_project_matches_claim
BEFORE INSERT ON answer_claim_revisions
WHEN (SELECT project_id FROM answer_claims WHERE id = NEW.claim_id) IS NOT NEW.project_id
BEGIN
  SELECT RAISE(ABORT, 'a revision must carry the project of its answer claim');
END;

CREATE TRIGGER answer_claim_revisions_require_open_run
BEFORE INSERT ON answer_claim_revisions
WHEN (
  SELECT r.status
  FROM answer_claims c
  JOIN observations o ON o.id = c.observation_id
  JOIN runs r ON r.id = o.run_id
  WHERE c.id = NEW.claim_id
) <> 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'statement revisions require an open run');
END;

CREATE TRIGGER answer_claim_revisions_claim_not_voided
BEFORE INSERT ON answer_claim_revisions
WHEN (SELECT voided_at FROM answer_claims WHERE id = NEW.claim_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'a voided answer claim cannot take a new revision');
END;

-- The stored range must really hold the quote. This is the database-side half of the guarantee that
-- a recorded statement is a quotation and not a reconstruction of the answer.
CREATE TRIGGER answer_claim_revisions_exact_quote_at_range
BEFORE INSERT ON answer_claim_revisions
WHEN NEW.offset_basis = 'EXACT_MATCH'
  AND (
    SELECT substr(o.answer_text, NEW.start_offset + 1, NEW.end_offset - NEW.start_offset)
    FROM answer_claims c
    JOIN observations o ON o.id = c.observation_id
    WHERE c.id = NEW.claim_id
  ) IS NOT NEW.quote_text
BEGIN
  SELECT RAISE(ABORT, 'an exact-match quote must equal the text at its recorded range');
END;

CREATE TRIGGER answer_claim_revisions_offset_within_answer
BEFORE INSERT ON answer_claim_revisions
WHEN NEW.end_offset IS NOT NULL
  AND (
    SELECT coalesce(length(o.answer_text), 0)
    FROM answer_claims c
    JOIN observations o ON o.id = c.observation_id
    WHERE c.id = NEW.claim_id
  ) < NEW.end_offset
BEGIN
  SELECT RAISE(ABORT, 'the recorded quote range extends past the captured answer');
END;

CREATE TRIGGER answer_claim_revisions_supersedes_same_claim
BEFORE INSERT ON answer_claim_revisions
WHEN NEW.supersedes_revision_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM answer_claim_revisions prior
    WHERE prior.id = NEW.supersedes_revision_id AND prior.claim_id = NEW.claim_id
  )
BEGIN
  SELECT RAISE(ABORT, 'a revision can only supersede a revision of the same answer claim');
END;

CREATE TRIGGER answer_claim_revisions_supersedes_predecessor
BEFORE INSERT ON answer_claim_revisions
WHEN NEW.revision > 1
  AND NOT EXISTS (
    SELECT 1 FROM answer_claim_revisions prior
    WHERE prior.claim_id = NEW.claim_id AND prior.revision = NEW.revision - 1
  )
BEGIN
  SELECT RAISE(ABORT, 'a revision must follow the previous revision number');
END;

CREATE TRIGGER answer_claim_revisions_no_update
BEFORE UPDATE ON answer_claim_revisions
BEGIN
  SELECT RAISE(ABORT, 'answer claim revisions are append-only');
END;

-- ---------------------------------------------------------------------------
-- Claim-to-proposition links
-- ---------------------------------------------------------------------------

CREATE TRIGGER answer_claim_propositions_proposition_same_project
BEFORE INSERT ON answer_claim_propositions
WHEN (
  SELECT c.project_id
  FROM propositions p
  JOIN claim_revisions cr ON cr.id = p.claim_revision_id
  JOIN claims c ON c.id = cr.claim_id
  WHERE p.id = NEW.proposition_id
) IS NOT NEW.project_id
BEGIN
  SELECT RAISE(ABORT, 'the target proposition must belong to the same project');
END;

CREATE TRIGGER answer_claim_propositions_require_open_run
BEFORE INSERT ON answer_claim_propositions
WHEN (
  SELECT r.status
  FROM answer_claim_revisions ac
  JOIN answer_claims c ON c.id = ac.claim_id
  JOIN observations o ON o.id = c.observation_id
  JOIN runs r ON r.id = o.run_id
  WHERE ac.id = NEW.claim_revision_id
) <> 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'proposition links require an open run');
END;

-- Supersession follows the existing evidence-relationship order of operations: the prior row is
-- pointed at an id that does not exist yet, then the replacement is inserted. Both directions are
-- checked, and only when the counterpart row is present, so the deferred write is not refused.
CREATE TRIGGER answer_claim_propositions_supersede_target_pair
AFTER UPDATE OF superseded_by ON answer_claim_propositions
WHEN NEW.superseded_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM answer_claim_propositions replacement
    WHERE replacement.id = NEW.superseded_by
      AND (
        replacement.claim_revision_id IS NOT NEW.claim_revision_id
        OR replacement.proposition_id IS NOT NEW.proposition_id
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'a replacement link must connect the same statement and proposition');
END;

CREATE TRIGGER answer_claim_propositions_supersede_source_pair
AFTER INSERT ON answer_claim_propositions
WHEN EXISTS (
  SELECT 1 FROM answer_claim_propositions prior
  WHERE prior.superseded_by = NEW.id
    AND (
      prior.claim_revision_id IS NOT NEW.claim_revision_id
      OR prior.proposition_id IS NOT NEW.proposition_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'a replacement link must connect the same statement and proposition');
END;

CREATE TRIGGER answer_claim_propositions_immutable_fields
BEFORE UPDATE ON answer_claim_propositions
WHEN NEW.project_id IS NOT OLD.project_id
  OR NEW.claim_revision_id IS NOT OLD.claim_revision_id
  OR NEW.proposition_id IS NOT OLD.proposition_id
  OR NEW.relation IS NOT OLD.relation
  OR NEW.rationale IS NOT OLD.rationale
  OR NEW.reviewer IS NOT OLD.reviewer
  OR NEW.created_at IS NOT OLD.created_at
  OR OLD.superseded_by IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'claim proposition links are append-only except one supersession');
END;

-- ---------------------------------------------------------------------------
-- Claim-to-citation links
-- ---------------------------------------------------------------------------

-- The citation must be one of the citations captured with the very same answer. A citation from a
-- different observation would make "this citation supports this statement" meaningless.
CREATE TRIGGER answer_claim_citations_same_observation
BEFORE INSERT ON answer_claim_citations
WHEN (
  SELECT c.observation_id
  FROM answer_claim_revisions r
  JOIN answer_claims c ON c.id = r.claim_id
  WHERE r.id = NEW.claim_revision_id
) IS NOT (SELECT observation_id FROM citations WHERE id = NEW.citation_id)
BEGIN
  SELECT RAISE(ABORT, 'a citation can only support a statement from the same observation');
END;

CREATE TRIGGER answer_claim_citations_require_open_run
BEFORE INSERT ON answer_claim_citations
WHEN (
  SELECT r.status
  FROM answer_claim_revisions ac
  JOIN answer_claims c ON c.id = ac.claim_id
  JOIN observations o ON o.id = c.observation_id
  JOIN runs r ON r.id = o.run_id
  WHERE ac.id = NEW.claim_revision_id
) <> 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'citation links require an open run');
END;

CREATE TRIGGER answer_claim_citations_supersede_target_pair
AFTER UPDATE OF superseded_by ON answer_claim_citations
WHEN NEW.superseded_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM answer_claim_citations replacement
    WHERE replacement.id = NEW.superseded_by
      AND (
        replacement.claim_revision_id IS NOT NEW.claim_revision_id
        OR replacement.citation_id IS NOT NEW.citation_id
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'a replacement mapping must connect the same statement and citation');
END;

CREATE TRIGGER answer_claim_citations_supersede_source_pair
AFTER INSERT ON answer_claim_citations
WHEN EXISTS (
  SELECT 1 FROM answer_claim_citations prior
  WHERE prior.superseded_by = NEW.id
    AND (
      prior.claim_revision_id IS NOT NEW.claim_revision_id
      OR prior.citation_id IS NOT NEW.citation_id
    )
)
BEGIN
  SELECT RAISE(ABORT, 'a replacement mapping must connect the same statement and citation');
END;

CREATE TRIGGER answer_claim_citations_immutable_fields
BEFORE UPDATE ON answer_claim_citations
WHEN NEW.project_id IS NOT OLD.project_id
  OR NEW.claim_revision_id IS NOT OLD.claim_revision_id
  OR NEW.citation_id IS NOT OLD.citation_id
  OR NEW.support IS NOT OLD.support
  OR NEW.rationale IS NOT OLD.rationale
  OR NEW.reviewer IS NOT OLD.reviewer
  OR NEW.created_at IS NOT OLD.created_at
  OR OLD.superseded_by IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'claim citation links are append-only except one supersession');
END;

-- ---------------------------------------------------------------------------
-- Claim assessments
-- ---------------------------------------------------------------------------

CREATE TRIGGER answer_claim_assessments_project_match
BEFORE INSERT ON answer_claim_assessments
WHEN (SELECT project_id FROM answer_claims WHERE id = NEW.claim_id) IS NOT NEW.project_id
BEGIN
  SELECT RAISE(ABORT, 'the answer claim must belong to the project');
END;

CREATE TRIGGER answer_claim_assessments_require_open_run
BEFORE INSERT ON answer_claim_assessments
WHEN (
  SELECT r.status
  FROM answer_claims c
  JOIN observations o ON o.id = c.observation_id
  JOIN runs r ON r.id = o.run_id
  WHERE c.id = NEW.claim_id
) <> 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'claim assessments may only be recorded while the run is open');
END;

CREATE TRIGGER answer_claim_assessments_require_current_revision
BEFORE INSERT ON answer_claim_assessments
WHEN (SELECT current_revision_id FROM answer_claims WHERE id = NEW.claim_id)
    IS NOT NEW.claim_revision_id
BEGIN
  SELECT RAISE(ABORT, 'claim assessments must target the current revision');
END;

CREATE TRIGGER answer_claim_assessments_label_matches_dimension
BEFORE INSERT ON answer_claim_assessments
WHEN
  (NEW.dimension = 'FIDELITY' AND NEW.label NOT IN (
    'ACCURATE', 'PARTIALLY_ACCURATE', 'CONTRADICTED', 'UNSUPPORTED', 'OMITTED', 'REFUSED',
    'UNAVAILABLE', 'NOT_ADDRESSED', 'NOT_ASSESSABLE'
  ))
  OR (NEW.dimension = 'ATTRIBUTION' AND NEW.label NOT IN (
    'CORRECT', 'PARTIALLY_CORRECT', 'WRONG_ROLE', 'WRONG_PERSON', 'AMBIGUOUS',
    'COLLABORATIVE_PARTIAL', 'FALSE_SOLE_CREDIT', 'UNATTRIBUTED', 'INCORRECT', 'NOT_ADDRESSED',
    'NOT_ASSESSABLE'
  ))
BEGIN
  SELECT RAISE(ABORT, 'claim assessment label does not match its dimension');
END;

CREATE TRIGGER answer_claim_assessments_attribution_detail_scope
BEFORE INSERT ON answer_claim_assessments
WHEN (NEW.attribution_subject IS NOT NULL OR NEW.attribution_role IS NOT NULL)
  AND NEW.dimension <> 'ATTRIBUTION'
BEGIN
  SELECT RAISE(ABORT, 'attribution detail is only valid on an attribution assessment');
END;

CREATE TRIGGER answer_claim_assessments_no_update
BEFORE UPDATE ON answer_claim_assessments
BEGIN
  SELECT RAISE(ABORT, 'claim assessments are append-only');
END;

-- ---------------------------------------------------------------------------
-- Interaction with the existing capture rules
-- ---------------------------------------------------------------------------

-- An observation void removes the answer from scoring. Claim rows survive so the review history is
-- still readable, but voiding first forces the operator to see that statements exist.
CREATE TRIGGER observations_void_requires_claim_void
BEFORE UPDATE OF voided_at ON observations
WHEN NEW.voided_at IS NOT NULL
  AND OLD.voided_at IS NULL
  AND EXISTS (
    SELECT 1 FROM answer_claims
    WHERE observation_id = NEW.id AND voided_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'void the answer claims on this observation before voiding the observation');
END;
