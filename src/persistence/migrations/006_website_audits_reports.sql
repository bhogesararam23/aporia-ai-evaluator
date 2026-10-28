CREATE TABLE website_audits (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 200),
  input_method TEXT NOT NULL CHECK (input_method IN ('PASTED', 'UPLOADED')),
  input_filename TEXT,
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64),
  byte_length INTEGER NOT NULL CHECK (byte_length > 0 AND byte_length <= 5000000),
  html_snapshot TEXT NOT NULL CHECK (length(html_snapshot) <= 5000000),
  audited_at TEXT NOT NULL,
  methodology_version TEXT NOT NULL,
  findings_json TEXT NOT NULL CHECK (json_valid(findings_json)),
  unavailable_checks_json TEXT NOT NULL CHECK (json_valid(unavailable_checks_json)),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX website_audits_project_idx
  ON website_audits(project_id, audited_at DESC);

CREATE TRIGGER website_audits_no_update
BEFORE UPDATE ON website_audits
BEGIN
  SELECT RAISE(ABORT, 'website audits are immutable');
END;

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_number INTEGER NOT NULL CHECK (report_number > 0),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  generated_at TEXT NOT NULL,
  snapshot_version TEXT NOT NULL,
  methodology_version TEXT NOT NULL,
  metrics_version TEXT NOT NULL,
  evidence_rule_version TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  superseded_by_report_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, report_number)
) STRICT;

CREATE INDEX reports_project_idx ON reports(project_id, report_number DESC);

CREATE TRIGGER reports_immutable_snapshot
BEFORE UPDATE ON reports
WHEN NEW.project_id IS NOT OLD.project_id
  OR NEW.report_number IS NOT OLD.report_number
  OR NEW.title IS NOT OLD.title
  OR NEW.generated_at IS NOT OLD.generated_at
  OR NEW.snapshot_version IS NOT OLD.snapshot_version
  OR NEW.methodology_version IS NOT OLD.methodology_version
  OR NEW.metrics_version IS NOT OLD.metrics_version
  OR NEW.evidence_rule_version IS NOT OLD.evidence_rule_version
  OR NEW.snapshot_json IS NOT OLD.snapshot_json
  OR NEW.created_at IS NOT OLD.created_at
  OR OLD.superseded_by_report_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'report snapshots are immutable');
END;

CREATE TRIGGER reports_supersession_same_project
BEFORE UPDATE OF superseded_by_report_id ON reports
WHEN NEW.superseded_by_report_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM reports
    WHERE id = NEW.superseded_by_report_id AND project_id = NEW.project_id
  )
BEGIN
  SELECT RAISE(ABORT, 'superseding report must belong to the project');
END;
