CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  description TEXT,
  primary_domain TEXT,
  target_entity_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
  visibility TEXT NOT NULL DEFAULT 'LOCAL_ONLY' CHECK (visibility = 'LOCAL_ONLY'),
  lifecycle TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (lifecycle IN ('ACTIVE', 'ARCHIVED')),
  owner_label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN (
    'PERSON', 'ORGANIZATION', 'PRODUCT', 'REPOSITORY', 'PUBLICATION', 'PROJECT_ARTIFACT', 'OTHER'
  )),
  canonical_name TEXT NOT NULL CHECK (length(canonical_name) BETWEEN 1 AND 200),
  alternate_names_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(alternate_names_json)),
  public_urls_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(public_urls_json)),
  identity_status TEXT NOT NULL CHECK (identity_status IN ('UNVERIFIED', 'SELF_DECLARED')),
  identity_method TEXT,
  identity_scope TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX entities_project_idx ON entities(project_id, canonical_name);

CREATE TRIGGER projects_target_entity_same_project_insert
BEFORE INSERT ON projects
WHEN NEW.target_entity_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM entities WHERE id = NEW.target_entity_id AND project_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'target entity must belong to the project');
END;

CREATE TRIGGER projects_target_entity_same_project_update
BEFORE UPDATE OF target_entity_id ON projects
WHEN NEW.target_entity_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM entities WHERE id = NEW.target_entity_id AND project_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'target entity must belong to the project');
END;

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 80),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 100),
  entity_type TEXT NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 50),
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX audit_events_project_time_idx
  ON audit_events(project_id, created_at DESC, id DESC);

CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;
