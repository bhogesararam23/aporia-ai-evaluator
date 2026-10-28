CREATE TABLE proposition_assessments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  proposition_id TEXT NOT NULL REFERENCES propositions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  label TEXT NOT NULL CHECK (label IN (
    'SUPPORTED_WITHIN_SCOPE', 'PARTIALLY_SUPPORTED', 'CONTRADICTED',
    'INSUFFICIENT_EVIDENCE', 'CONFLICTING_EVIDENCE', 'NOT_ASSESSED', 'UNAVAILABLE'
  )),
  rationale TEXT NOT NULL CHECK (length(rationale) BETWEEN 1 AND 4000),
  method TEXT NOT NULL CHECK (method = 'HUMAN'),
  reviewer TEXT NOT NULL CHECK (length(reviewer) BETWEEN 1 AND 80),
  evidence_snapshot_json TEXT NOT NULL CHECK (json_valid(evidence_snapshot_json)),
  created_at TEXT NOT NULL,
  UNIQUE(proposition_id, version)
) STRICT;

CREATE INDEX proposition_assessments_prop_idx
  ON proposition_assessments(proposition_id, version DESC);

CREATE TRIGGER proposition_assessments_project_match
BEFORE INSERT ON proposition_assessments
WHEN (
  SELECT c.project_id
  FROM propositions p
  JOIN claim_revisions r ON r.id = p.claim_revision_id
  JOIN claims c ON c.id = r.claim_id
  WHERE p.id = NEW.proposition_id
) IS NOT NEW.project_id
BEGIN
  SELECT RAISE(ABORT, 'proposition must belong to the project');
END;

CREATE TRIGGER proposition_assessments_require_review_state
BEFORE INSERT ON proposition_assessments
WHEN (
  SELECT c.status
  FROM propositions p
  JOIN claim_revisions r ON r.id = p.claim_revision_id
  JOIN claims c ON c.id = r.claim_id
  WHERE p.id = NEW.proposition_id
) NOT IN ('UNDER_REVIEW', 'ASSESSED', 'DISPUTED')
BEGIN
  SELECT RAISE(ABORT, 'proposition assessments require a claim under review');
END;

CREATE TRIGGER proposition_assessments_no_update
BEFORE UPDATE ON proposition_assessments
BEGIN
  SELECT RAISE(ABORT, 'proposition assessments are append-only');
END;

CREATE TABLE observation_assessments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK (dimension IN (
    'PRESENCE', 'FIDELITY', 'CITATION_SUPPORT', 'ATTRIBUTION'
  )),
  version INTEGER NOT NULL CHECK (version > 0),
  label TEXT NOT NULL,
  rationale TEXT NOT NULL CHECK (length(rationale) BETWEEN 1 AND 4000),
  reviewer TEXT NOT NULL CHECK (length(reviewer) BETWEEN 1 AND 80),
  attribution_role TEXT CHECK (attribution_role IS NULL OR attribution_role IN (
    'AUTHOR', 'COAUTHOR', 'MAINTAINER', 'CONTRIBUTOR', 'PROJECT_LEAD',
    'ORGANIZATION', 'FUNDER', 'PUBLISHER', 'UNSPECIFIED'
  )),
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  created_at TEXT NOT NULL,
  UNIQUE(observation_id, dimension, version)
) STRICT;

CREATE INDEX observation_assessments_obs_idx
  ON observation_assessments(observation_id, dimension, version DESC);

CREATE TRIGGER observation_assessments_project_match
BEFORE INSERT ON observation_assessments
WHEN (
  SELECT r.project_id
  FROM runs r
  JOIN observations o ON o.run_id = r.id
  WHERE o.id = NEW.observation_id
) IS NOT NEW.project_id
BEGIN
  SELECT RAISE(ABORT, 'observation must belong to the project');
END;

CREATE TRIGGER observation_assessments_require_open_run
BEFORE INSERT ON observation_assessments
WHEN (
  SELECT r.status
  FROM runs r
  JOIN observations o ON o.run_id = r.id
  WHERE o.id = NEW.observation_id
) <> 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'observation assessments may only be added to an open run');
END;

CREATE TRIGGER observation_assessments_label_matches_dimension
BEFORE INSERT ON observation_assessments
WHEN
  (NEW.dimension = 'PRESENCE' AND NEW.label NOT IN ('MENTIONED', 'NOT_MENTIONED', 'NOT_ASSESSABLE'))
  OR (NEW.dimension = 'FIDELITY' AND NEW.label NOT IN (
    'ACCURATE', 'PARTIALLY_ACCURATE', 'CONTRADICTED', 'UNSUPPORTED', 'NOT_ASSESSABLE'
  ))
  OR (NEW.dimension = 'CITATION_SUPPORT' AND NEW.label NOT IN (
    'SUPPORTED', 'PARTIALLY_SUPPORTED', 'NOT_SUPPORTED', 'NOT_ASSESSABLE'
  ))
  OR (NEW.dimension = 'ATTRIBUTION' AND NEW.label NOT IN (
    'CORRECT', 'PARTIALLY_CORRECT', 'INCORRECT', 'NOT_ADDRESSED', 'NOT_ASSESSABLE'
  ))
BEGIN
  SELECT RAISE(ABORT, 'assessment label does not match its dimension');
END;

CREATE TRIGGER observation_assessments_role_scope
BEFORE INSERT ON observation_assessments
WHEN NEW.attribution_role IS NOT NULL AND NEW.dimension <> 'ATTRIBUTION'
BEGIN
  SELECT RAISE(ABORT, 'attribution role is only valid for attribution assessments');
END;

CREATE TRIGGER observation_assessments_no_update
BEFORE UPDATE ON observation_assessments
BEGIN
  SELECT RAISE(ABORT, 'observation assessments are append-only');
END;
