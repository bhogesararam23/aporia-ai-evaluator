CREATE TABLE achievements (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  current_revision_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX achievements_project_idx ON achievements(project_id, created_at DESC);

CREATE TABLE achievement_revisions (
  id TEXT PRIMARY KEY,
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 4000),
  project_name TEXT NOT NULL CHECK (length(project_name) BETWEEN 1 AND 200),
  project_description TEXT CHECK (
    project_description IS NULL OR length(project_description) <= 4000
  ),
  project_url TEXT,
  start_date TEXT CHECK (
    start_date IS NULL OR start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  end_date TEXT CHECK (
    end_date IS NULL OR end_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  unresolved_contradictions_json TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(unresolved_contradictions_json)),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  created_by TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  CHECK (end_date IS NULL OR start_date IS NULL OR start_date <= end_date),
  UNIQUE(achievement_id, revision_number)
) STRICT;

CREATE INDEX achievement_revisions_achievement_idx
  ON achievement_revisions(achievement_id, revision_number DESC);

CREATE TABLE achievement_claims (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES achievement_revisions(id) ON DELETE CASCADE,
  claim_id TEXT REFERENCES claims(id) ON DELETE SET NULL,
  claim_revision_id TEXT,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  claim_text TEXT NOT NULL CHECK (length(claim_text) BETWEEN 1 AND 5000),
  evidence_status TEXT NOT NULL CHECK (evidence_status IN (
    'SUPPORTED_WITHIN_SCOPE', 'PARTIALLY_SUPPORTED', 'CONTRADICTED',
    'INSUFFICIENT_EVIDENCE', 'CONFLICTING_EVIDENCE', 'NOT_ASSESSED', 'UNAVAILABLE'
  )),
  support_state TEXT NOT NULL CHECK (support_state IN (
    'SELF_DECLARED', 'EVIDENCE_RECORDED', 'CONTRADICTION_RECORDED', 'UNRESOLVED'
  )),
  human_assessment_status TEXT CHECK (
    human_assessment_status IS NULL OR human_assessment_status IN (
      'SUPPORTED_WITHIN_SCOPE', 'PARTIALLY_SUPPORTED', 'CONTRADICTED',
      'INSUFFICIENT_EVIDENCE', 'CONFLICTING_EVIDENCE', 'NOT_ASSESSED', 'UNAVAILABLE'
    )
  ),
  evidence_relationship_count INTEGER NOT NULL DEFAULT 0
    CHECK (evidence_relationship_count >= 0),
  note TEXT,
  UNIQUE(revision_id, ordinal)
) STRICT;

CREATE INDEX achievement_claims_revision_idx ON achievement_claims(revision_id, ordinal);

CREATE TABLE achievement_contributors (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES achievement_revisions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  role TEXT NOT NULL CHECK (role IN (
    'AUTHOR', 'COAUTHOR', 'MAINTAINER', 'CONTRIBUTOR', 'PROJECT_LEAD',
    'ORGANIZATION', 'FUNDER', 'PUBLISHER', 'UNSPECIFIED'
  )),
  contribution TEXT NOT NULL CHECK (length(contribution) BETWEEN 1 AND 2000),
  support_state TEXT NOT NULL CHECK (support_state IN (
    'SELF_DECLARED', 'EVIDENCE_LINKED', 'DISPUTED'
  )),
  evidence_note TEXT CHECK (evidence_note IS NULL OR length(evidence_note) <= 1000),
  UNIQUE(revision_id, ordinal)
) STRICT;

CREATE INDEX achievement_contributors_revision_idx
  ON achievement_contributors(revision_id, ordinal);

CREATE TABLE achievement_evidence (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES achievement_revisions(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  evidence_id TEXT REFERENCES evidence_items(id) ON DELETE SET NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  note TEXT CHECK (note IS NULL OR length(note) <= 2000),
  UNIQUE(revision_id, ordinal)
) STRICT;

CREATE INDEX achievement_evidence_revision_idx ON achievement_evidence(revision_id, ordinal);

CREATE TABLE achievement_approvals (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL UNIQUE REFERENCES achievement_revisions(id) ON DELETE CASCADE,
  approved_by TEXT NOT NULL CHECK (length(approved_by) BETWEEN 1 AND 80),
  approved_at TEXT NOT NULL,
  note TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 2000),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX achievement_approvals_revision_idx ON achievement_approvals(revision_id);

CREATE TRIGGER achievements_current_revision_same_insert
BEFORE INSERT ON achievements
WHEN NEW.current_revision_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM achievement_revisions
    WHERE id = NEW.current_revision_id AND achievement_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'achievement current revision must belong to the achievement');
END;

CREATE TRIGGER achievements_current_revision_same_update
BEFORE UPDATE OF current_revision_id ON achievements
WHEN NEW.current_revision_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM achievement_revisions
    WHERE id = NEW.current_revision_id AND achievement_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'achievement current revision must belong to the achievement');
END;

CREATE TRIGGER achievements_identity_immutable
BEFORE UPDATE ON achievements
WHEN NEW.project_id <> OLD.project_id OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'achievement project and creation time are immutable');
END;

CREATE TRIGGER achievement_revisions_no_update
BEFORE UPDATE ON achievement_revisions
BEGIN
  SELECT RAISE(ABORT, 'achievement revisions are immutable');
END;

CREATE TRIGGER achievement_claims_no_update
BEFORE UPDATE ON achievement_claims
BEGIN
  SELECT RAISE(ABORT, 'achievement claims are immutable');
END;

CREATE TRIGGER achievement_contributors_no_update
BEFORE UPDATE ON achievement_contributors
BEGIN
  SELECT RAISE(ABORT, 'achievement contributors are immutable');
END;

CREATE TRIGGER achievement_evidence_no_update
BEFORE UPDATE ON achievement_evidence
BEGIN
  SELECT RAISE(ABORT, 'achievement evidence links are immutable');
END;

CREATE TRIGGER achievement_approvals_no_update
BEFORE UPDATE ON achievement_approvals
BEGIN
  SELECT RAISE(ABORT, 'achievement approvals are immutable');
END;

CREATE TRIGGER achievement_claims_project_match
BEFORE INSERT ON achievement_claims
WHEN NEW.claim_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM claims c
    JOIN achievement_revisions r ON r.id = NEW.revision_id
    JOIN achievements a ON a.id = r.achievement_id
    WHERE c.id = NEW.claim_id AND c.project_id = a.project_id
  )
BEGIN
  SELECT RAISE(ABORT, 'an achievement claim must belong to the same project');
END;

CREATE TRIGGER achievement_claims_revision_match
BEFORE INSERT ON achievement_claims
WHEN NEW.claim_revision_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM claim_revisions r
    WHERE r.id = NEW.claim_revision_id AND r.claim_id = NEW.claim_id
  )
BEGIN
  SELECT RAISE(ABORT, 'the claim revision must belong to the linked claim');
END;

CREATE TRIGGER achievement_evidence_project_match
BEFORE INSERT ON achievement_evidence
WHEN NOT EXISTS (
  SELECT 1
  FROM sources s
  JOIN achievement_revisions r ON r.id = NEW.revision_id
  JOIN achievements a ON a.id = r.achievement_id
  WHERE s.id = NEW.source_id AND s.project_id = a.project_id
)
BEGIN
  SELECT RAISE(ABORT, 'an achievement source must belong to the same project');
END;

CREATE TRIGGER achievement_evidence_item_match
BEFORE INSERT ON achievement_evidence
WHEN NEW.evidence_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM evidence_items e
    JOIN achievement_revisions r ON r.id = NEW.revision_id
    JOIN achievements a ON a.id = r.achievement_id
    WHERE e.id = NEW.evidence_id
      AND e.project_id = a.project_id
      AND e.source_id = NEW.source_id
  )
BEGIN
  SELECT RAISE(ABORT, 'the evidence item must belong to the linked source and project');
END;

CREATE TRIGGER achievement_approvals_current_revision
BEFORE INSERT ON achievement_approvals
WHEN NOT EXISTS (
  SELECT 1
  FROM achievements a
  JOIN achievement_revisions r ON r.achievement_id = a.id
  WHERE r.id = NEW.revision_id AND a.current_revision_id = NEW.revision_id
)
BEGIN
  SELECT RAISE(ABORT, 'only the current achievement revision can be approved');
END;

CREATE TRIGGER achievement_approvals_hash_match
BEFORE INSERT ON achievement_approvals
WHEN NEW.content_hash <> (
  SELECT content_hash FROM achievement_revisions WHERE id = NEW.revision_id
)
BEGIN
  SELECT RAISE(ABORT, 'approval content hash does not match the revision');
END;
