CREATE TABLE sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  canonical_uri TEXT,
  publisher TEXT,
  author TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'PRIMARY_ARTIFACT', 'REPRODUCIBLE_RESULT', 'INDEPENDENT_SOURCE',
    'SECONDARY_REPORT', 'SELF_PUBLISHED', 'UNATTRIBUTED', 'OTHER'
  )),
  access_route TEXT NOT NULL CHECK (access_route IN (
    'MANUAL_ENTRY', 'PASTED_EXCERPT', 'LOCAL_FILE', 'OTHER'
  )),
  retrieved_at TEXT NOT NULL,
  publication_date TEXT,
  language TEXT NOT NULL,
  independence TEXT NOT NULL CHECK (independence IN (
    'INDEPENDENT', 'SELF_PUBLISHED', 'RELATED', 'UNKNOWN'
  )),
  notes TEXT,
  access_status TEXT NOT NULL DEFAULT 'NOT_CHECKED' CHECK (access_status IN (
    'NOT_CHECKED', 'OBSERVED_AVAILABLE', 'OBSERVED_UNAVAILABLE'
  )),
  created_at TEXT NOT NULL,
  UNIQUE(id, project_id)
) STRICT;

CREATE INDEX sources_project_idx ON sources(project_id, created_at DESC);

CREATE TABLE evidence_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  locator TEXT NOT NULL CHECK (length(locator) BETWEEN 1 AND 500),
  excerpt TEXT NOT NULL CHECK (length(excerpt) BETWEEN 1 AND 20000),
  extraction_method TEXT NOT NULL CHECK (extraction_method IN (
    'MANUAL_ENTRY', 'PASTED_TEXT', 'LOCAL_FILE', 'OTHER'
  )),
  extracted_at TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK (provenance = 'USER_SUPPLIED'),
  excerpt_digest TEXT NOT NULL CHECK (length(excerpt_digest) = 64),
  created_at TEXT NOT NULL,
  UNIQUE(id, project_id),
  FOREIGN KEY (source_id, project_id) REFERENCES sources(id, project_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX evidence_items_project_idx ON evidence_items(project_id, created_at DESC);
CREATE INDEX evidence_items_source_idx ON evidence_items(source_id);

CREATE TABLE evidence_relationships (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL,
  proposition_id TEXT NOT NULL REFERENCES propositions(id) ON DELETE CASCADE,
  relation TEXT NOT NULL CHECK (relation IN (
    'SUPPORTS', 'CONTRADICTS', 'QUALIFIES', 'CONTEXTUALIZES', 'DOES_NOT_ADDRESS', 'UNAVAILABLE'
  )),
  rationale TEXT NOT NULL CHECK (length(rationale) BETWEEN 1 AND 4000),
  reviewer TEXT NOT NULL CHECK (length(reviewer) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  superseded_by TEXT REFERENCES evidence_relationships(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
  superseded_at TEXT,
  FOREIGN KEY (evidence_id, project_id) REFERENCES evidence_items(id, project_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX evidence_relationships_proposition_idx
  ON evidence_relationships(proposition_id, relation, created_at);
CREATE INDEX evidence_relationships_project_idx ON evidence_relationships(project_id);

CREATE UNIQUE INDEX evidence_relationships_active_pair
  ON evidence_relationships(evidence_id, proposition_id)
  WHERE superseded_by IS NULL;

CREATE TRIGGER sources_no_update
BEFORE UPDATE ON sources
BEGIN
  SELECT RAISE(ABORT, 'sources are immutable; create a corrected record');
END;

CREATE TRIGGER evidence_items_no_update
BEFORE UPDATE ON evidence_items
BEGIN
  SELECT RAISE(ABORT, 'evidence items are immutable; create a corrected record');
END;

CREATE TRIGGER evidence_relationships_proposition_same_project
BEFORE INSERT ON evidence_relationships
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

CREATE TRIGGER evidence_relationships_immutable_fields
BEFORE UPDATE ON evidence_relationships
WHEN NEW.evidence_id IS NOT OLD.evidence_id
  OR NEW.proposition_id IS NOT OLD.proposition_id
  OR NEW.project_id IS NOT OLD.project_id
  OR NEW.relation IS NOT OLD.relation
  OR NEW.rationale IS NOT OLD.rationale
  OR NEW.reviewer IS NOT OLD.reviewer
  OR NEW.created_at IS NOT OLD.created_at
  OR OLD.superseded_by IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'evidence relationships are append-only except one supersession');
END;
