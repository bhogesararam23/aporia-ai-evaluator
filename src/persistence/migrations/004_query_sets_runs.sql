CREATE TABLE query_sets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'APPROVED')),
  description TEXT,
  locale TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  approval_note TEXT,
  supersedes_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, name, version)
) STRICT;

CREATE INDEX query_sets_project_idx ON query_sets(project_id, created_at DESC);

CREATE TABLE queries (
  id TEXT PRIMARY KEY,
  query_set_id TEXT NOT NULL REFERENCES query_sets(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  text TEXT NOT NULL CHECK (length(text) BETWEEN 3 AND 1000),
  intent TEXT NOT NULL CHECK (intent IN (
    'IDENTITY', 'DESCRIPTION', 'FACTUAL_VERIFICATION', 'DISCOVERY', 'SOURCE_SEEKING',
    'COMPARISON', 'ATTRIBUTION', 'TIME_SENSITIVE', 'OTHER'
  )),
  locale TEXT,
  region TEXT,
  branded INTEGER NOT NULL CHECK (branded IN (0, 1)),
  expected_elements TEXT NOT NULL,
  inclusion_rationale TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(query_set_id, ordinal)
) STRICT;

CREATE INDEX queries_set_idx ON queries(query_set_id, ordinal);

CREATE TRIGGER query_sets_locked_after_approval
BEFORE UPDATE ON query_sets
WHEN OLD.status = 'APPROVED'
BEGIN
  SELECT RAISE(ABORT, 'approved query sets are immutable');
END;

CREATE TRIGGER query_sets_valid_transition
BEFORE UPDATE OF status ON query_sets
WHEN NEW.status <> OLD.status AND NOT (OLD.status = 'DRAFT' AND NEW.status = 'APPROVED')
BEGIN
  SELECT RAISE(ABORT, 'invalid query set status transition');
END;

CREATE TRIGGER query_sets_approval_metadata
BEFORE UPDATE OF status ON query_sets
WHEN NEW.status = 'APPROVED'
  AND (NEW.approved_by IS NULL OR NEW.approved_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'approval requires a reviewer and timestamp');
END;

CREATE TRIGGER query_sets_approval_requires_query
BEFORE UPDATE OF status ON query_sets
WHEN NEW.status = 'APPROVED'
  AND NOT EXISTS (SELECT 1 FROM queries WHERE query_set_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'an empty query set cannot be approved');
END;

CREATE TRIGGER queries_no_insert_when_approved
BEFORE INSERT ON queries
WHEN (SELECT status FROM query_sets WHERE id = NEW.query_set_id) = 'APPROVED'
BEGIN
  SELECT RAISE(ABORT, 'approved query sets are immutable');
END;

CREATE TRIGGER queries_no_update_when_approved
BEFORE UPDATE ON queries
WHEN (SELECT status FROM query_sets WHERE id = OLD.query_set_id) = 'APPROVED'
BEGIN
  SELECT RAISE(ABORT, 'approved query sets are immutable');
END;

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  query_set_id TEXT NOT NULL REFERENCES query_sets(id) ON DELETE CASCADE,
  query_set_name TEXT NOT NULL,
  query_set_version INTEGER NOT NULL CHECK (query_set_version > 0),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  provider_label TEXT NOT NULL CHECK (length(provider_label) BETWEEN 1 AND 200),
  model_label TEXT,
  interface_label TEXT NOT NULL CHECK (length(interface_label) BETWEEN 1 AND 200),
  grounding_mode TEXT NOT NULL CHECK (grounding_mode IN (
    'NOT_APPLICABLE', 'NO_SEARCH', 'SEARCH_GROUNDED', 'UNKNOWN'
  )),
  locale TEXT NOT NULL,
  region TEXT,
  capture_from TEXT NOT NULL,
  capture_to TEXT NOT NULL,
  conditions TEXT NOT NULL CHECK (length(conditions) BETWEEN 1 AND 2000),
  notes TEXT,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'FINALIZED', 'CANCELLED')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finalized_at TEXT,
  cancelled_at TEXT,
  cancel_reason TEXT
) STRICT;

CREATE INDEX runs_project_idx ON runs(project_id, created_at DESC);
CREATE INDEX runs_query_set_idx ON runs(query_set_id);

CREATE TRIGGER runs_require_approved_query_set
BEFORE INSERT ON runs
WHEN NOT EXISTS (
  SELECT 1 FROM query_sets
  WHERE id = NEW.query_set_id
    AND project_id = NEW.project_id
    AND status = 'APPROVED'
)
BEGIN
  SELECT RAISE(ABORT, 'runs require an approved query set from the same project');
END;

CREATE TRIGGER runs_immutable_configuration
BEFORE UPDATE ON runs
WHEN NEW.project_id IS NOT OLD.project_id
  OR NEW.query_set_id IS NOT OLD.query_set_id
  OR NEW.query_set_name IS NOT OLD.query_set_name
  OR NEW.query_set_version IS NOT OLD.query_set_version
  OR NEW.name IS NOT OLD.name
  OR NEW.provider_label IS NOT OLD.provider_label
  OR NEW.model_label IS NOT OLD.model_label
  OR NEW.interface_label IS NOT OLD.interface_label
  OR NEW.grounding_mode IS NOT OLD.grounding_mode
  OR NEW.locale IS NOT OLD.locale
  OR NEW.region IS NOT OLD.region
  OR NEW.capture_from IS NOT OLD.capture_from
  OR NEW.capture_to IS NOT OLD.capture_to
  OR NEW.conditions IS NOT OLD.conditions
  OR NEW.notes IS NOT OLD.notes
  OR NEW.created_by IS NOT OLD.created_by
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'run configuration is immutable');
END;

CREATE TRIGGER runs_valid_status_transition
BEFORE UPDATE OF status ON runs
WHEN NEW.status <> OLD.status
  AND NOT (OLD.status = 'OPEN' AND NEW.status IN ('FINALIZED', 'CANCELLED'))
BEGIN
  SELECT RAISE(ABORT, 'invalid run status transition');
END;

CREATE TRIGGER runs_cancellation_reason
BEFORE UPDATE OF status ON runs
WHEN NEW.status = 'CANCELLED'
  AND (NEW.cancel_reason IS NULL OR length(NEW.cancel_reason) < 3)
BEGIN
  SELECT RAISE(ABORT, 'cancellation requires a reason');
END;

CREATE TRIGGER runs_terminal_immutable
BEFORE UPDATE ON runs
WHEN OLD.status IN ('FINALIZED', 'CANCELLED')
BEGIN
  SELECT RAISE(ABORT, 'finalized and cancelled runs are immutable');
END;

CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  query_id TEXT NOT NULL REFERENCES queries(id) ON DELETE CASCADE,
  query_ordinal INTEGER NOT NULL CHECK (query_ordinal > 0),
  query_text_snapshot TEXT NOT NULL CHECK (length(query_text_snapshot) BETWEEN 3 AND 1000),
  query_intent_snapshot TEXT NOT NULL CHECK (query_intent_snapshot IN (
    'IDENTITY', 'DESCRIPTION', 'FACTUAL_VERIFICATION', 'DISCOVERY', 'SOURCE_SEEKING',
    'COMPARISON', 'ATTRIBUTION', 'TIME_SENSITIVE', 'OTHER'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'COMPLETED', 'REFUSAL', 'NO_ANSWER', 'ERROR', 'BLOCKED', 'TIMEOUT', 'UNAVAILABLE'
  )),
  captured_at TEXT NOT NULL,
  answer_text TEXT,
  error_note TEXT,
  citation_capture TEXT NOT NULL CHECK (citation_capture IN ('CAPTURED', 'NOT_SHOWN', 'UNKNOWN')),
  context_notes TEXT,
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  CHECK (
    status IN ('COMPLETED', 'REFUSAL', 'NO_ANSWER')
    OR (error_note IS NOT NULL AND length(error_note) > 0)
  ),
  CHECK (
    status NOT IN ('COMPLETED', 'REFUSAL', 'NO_ANSWER')
    OR answer_text IS NOT NULL
  )
) STRICT;

CREATE INDEX observations_run_idx ON observations(run_id, captured_at);
CREATE INDEX observations_query_idx ON observations(query_id);

CREATE TRIGGER observations_require_open_run
BEFORE INSERT ON observations
WHEN (SELECT status FROM runs WHERE id = NEW.run_id) <> 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'observations may only be added to an open run');
END;

CREATE TRIGGER observations_query_in_run_set
BEFORE INSERT ON observations
WHEN NOT EXISTS (
  SELECT 1
  FROM runs r
  JOIN queries q ON q.query_set_id = r.query_set_id
  WHERE r.id = NEW.run_id AND q.id = NEW.query_id
)
BEGIN
  SELECT RAISE(ABORT, 'observation query must belong to the run query set');
END;

CREATE TRIGGER observations_immutable_fields
BEFORE UPDATE ON observations
WHEN NEW.run_id IS NOT OLD.run_id
  OR NEW.query_id IS NOT OLD.query_id
  OR NEW.query_ordinal IS NOT OLD.query_ordinal
  OR NEW.query_text_snapshot IS NOT OLD.query_text_snapshot
  OR NEW.query_intent_snapshot IS NOT OLD.query_intent_snapshot
  OR NEW.status IS NOT OLD.status
  OR NEW.captured_at IS NOT OLD.captured_at
  OR NEW.answer_text IS NOT OLD.answer_text
  OR NEW.error_note IS NOT OLD.error_note
  OR NEW.citation_capture IS NOT OLD.citation_capture
  OR NEW.context_notes IS NOT OLD.context_notes
  OR NEW.created_at IS NOT OLD.created_at
  OR OLD.voided_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'observations are immutable except one void action');
END;

CREATE TRIGGER observations_void_requires_reason
BEFORE UPDATE ON observations
WHEN NEW.voided_at IS NOT NULL
  AND (NEW.void_reason IS NULL OR length(NEW.void_reason) < 3)
BEGIN
  SELECT RAISE(ABORT, 'voiding an observation requires a reason');
END;

CREATE TRIGGER observations_void_only_while_open
BEFORE UPDATE ON observations
WHEN NEW.voided_at IS NOT NULL
  AND (SELECT status FROM runs WHERE id = NEW.run_id) <> 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'observations can only be voided while the run is open');
END;

CREATE TABLE citations (
  id TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position > 0),
  url TEXT NOT NULL CHECK (length(url) BETWEEN 8 AND 2048),
  title TEXT,
  snippet TEXT,
  target_owned INTEGER NOT NULL CHECK (target_owned IN (0, 1)),
  voided_at TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(observation_id, position)
) STRICT;

CREATE INDEX citations_observation_idx ON citations(observation_id, position);

CREATE TRIGGER citations_require_open_run
BEFORE INSERT ON citations
WHEN (
  SELECT r.status
  FROM runs r
  JOIN observations o ON o.run_id = r.id
  WHERE o.id = NEW.observation_id
) <> 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'citations may only be added to an open run');
END;

CREATE TRIGGER citations_immutable_fields
BEFORE UPDATE ON citations
WHEN NEW.observation_id IS NOT OLD.observation_id
  OR NEW.position IS NOT OLD.position
  OR NEW.url IS NOT OLD.url
  OR NEW.title IS NOT OLD.title
  OR NEW.snippet IS NOT OLD.snippet
  OR NEW.target_owned IS NOT OLD.target_owned
  OR NEW.created_at IS NOT OLD.created_at
  OR OLD.voided_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'citations are immutable except one void action');
END;

CREATE TRIGGER citations_void_requires_reason
BEFORE UPDATE ON citations
WHEN NEW.voided_at IS NOT NULL
  AND (NEW.void_reason IS NULL OR length(NEW.void_reason) < 3)
BEGIN
  SELECT RAISE(ABORT, 'voiding a citation requires a reason');
END;

CREATE TRIGGER citations_void_only_while_open
BEFORE UPDATE ON citations
WHEN NEW.voided_at IS NOT NULL
  AND (
    SELECT r.status
    FROM runs r
    JOIN observations o ON o.run_id = r.id
    WHERE o.id = NEW.observation_id
  ) <> 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'citations can only be voided while the run is open');
END;

CREATE TRIGGER runs_finalize_requires_observation
BEFORE UPDATE OF status ON runs
WHEN NEW.status = 'FINALIZED'
  AND NOT EXISTS (
    SELECT 1 FROM observations WHERE run_id = NEW.id AND voided_at IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'a run cannot be finalized without an observation');
END;
