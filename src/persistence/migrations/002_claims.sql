CREATE TABLE claims (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN (
    'SUBMITTED', 'DECOMPOSED', 'UNDER_REVIEW', 'ASSESSED', 'DISPUTED'
  )),
  current_revision_id TEXT REFERENCES claim_revisions(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE claim_revisions (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 10 AND 5000),
  source_url TEXT,
  intended_meaning TEXT,
  time_scope TEXT,
  locale TEXT NOT NULL,
  decomposition_version TEXT NOT NULL,
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(claim_id, revision_number)
) STRICT;

CREATE TABLE propositions (
  id TEXT PRIMARY KEY,
  claim_revision_id TEXT NOT NULL REFERENCES claim_revisions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  subject TEXT,
  predicate TEXT,
  object_value TEXT,
  conditions TEXT,
  time_interval TEXT,
  units TEXT,
  evidence_requirements TEXT NOT NULL,
  expected_answer_criterion TEXT,
  ambiguity_notes TEXT,
  decomposition_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(claim_revision_id, ordinal)
) STRICT;

CREATE INDEX claims_project_idx ON claims(project_id, created_at DESC);
CREATE INDEX claim_revisions_claim_idx ON claim_revisions(claim_id, revision_number DESC);
CREATE INDEX propositions_revision_idx ON propositions(claim_revision_id, ordinal);

CREATE TRIGGER claim_revisions_no_update
BEFORE UPDATE ON claim_revisions
BEGIN
  SELECT RAISE(ABORT, 'claim revisions are immutable');
END;

CREATE TRIGGER propositions_no_update
BEFORE UPDATE ON propositions
BEGIN
  SELECT RAISE(ABORT, 'propositions are immutable');
END;

CREATE TRIGGER propositions_locked_after_review
BEFORE INSERT ON propositions
WHEN (
  SELECT c.status
  FROM claims c
  JOIN claim_revisions r ON r.claim_id = c.id
  WHERE r.id = NEW.claim_revision_id
) NOT IN ('SUBMITTED', 'DECOMPOSED')
BEGIN
  SELECT RAISE(ABORT, 'propositions are locked after review starts');
END;

CREATE TRIGGER claims_current_revision_same_claim_insert
BEFORE INSERT ON claims
WHEN NEW.current_revision_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM claim_revisions
    WHERE id = NEW.current_revision_id AND claim_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'current revision must belong to the claim');
END;

CREATE TRIGGER claims_current_revision_same_claim_update
BEFORE UPDATE OF current_revision_id ON claims
WHEN NEW.current_revision_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM claim_revisions
    WHERE id = NEW.current_revision_id AND claim_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'current revision must belong to the claim');
END;

CREATE TRIGGER claims_status_transition
BEFORE UPDATE OF status ON claims
WHEN NEW.status <> OLD.status
  AND NOT (
    (OLD.status = 'SUBMITTED' AND NEW.status IN ('DECOMPOSED', 'DISPUTED'))
    OR (OLD.status = 'DECOMPOSED' AND NEW.status IN ('UNDER_REVIEW', 'DISPUTED'))
    OR (OLD.status = 'UNDER_REVIEW' AND NEW.status IN ('ASSESSED', 'DISPUTED'))
    OR (OLD.status = 'ASSESSED' AND NEW.status IN ('UNDER_REVIEW', 'DISPUTED'))
    OR (OLD.status = 'DISPUTED' AND NEW.status = 'UNDER_REVIEW')
  )
  AND NOT (
    NEW.status = 'SUBMITTED'
    AND NEW.current_revision_id IS NOT OLD.current_revision_id
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid claim status transition');
END;
