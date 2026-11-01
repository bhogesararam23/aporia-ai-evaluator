-- Local core v0.3: tracked remediation findings and longitudinal retesting (ADR-021).
--
-- A finding is an evaluation problem somebody has agreed to track. The two rules this schema exists
-- to make impossible are: marking a finding "improved" without a stored measurement, and reaching
-- across a project boundary through a polymorphic reference.

CREATE TABLE remediation_findings (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reference_number INTEGER NOT NULL CHECK (reference_number > 0),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 300),
  observed_issue TEXT NOT NULL CHECK (length(observed_issue) BETWEEN 3 AND 8000),
  supporting_evidence TEXT NOT NULL CHECK (length(supporting_evidence) BETWEEN 3 AND 8000),
  cause TEXT NOT NULL CHECK (cause IN (
    'MISSING_OR_UNCLEAR_FIRST_PARTY_CONTENT', 'WEAK_INDEPENDENT_CORROBORATION',
    'AMBIGUOUS_ENTITY_IDENTITY', 'STALE_SOURCE', 'UNSUPPORTED_CLAIM',
    'MODEL_MISREAD_OR_OMISSION', 'WRONG_ATTRIBUTION', 'CITATION_DOES_NOT_SUPPORT',
    'MEASUREMENT_DEFECT', 'PROVIDER_OR_INTERFACE_LIMITATION',
    'CAPTURE_OR_METADATA_UNAVAILABLE', 'OTHER'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('HIGH', 'MEDIUM', 'LOW')),
  severity_rationale TEXT NOT NULL CHECK (length(severity_rationale) BETWEEN 3 AND 4000),
  recommended_action TEXT NOT NULL CHECK (length(recommended_action) BETWEEN 3 AND 4000),
  owner_label TEXT NOT NULL CHECK (length(owner_label) BETWEEN 1 AND 80),
  status TEXT NOT NULL CHECK (status IN (
    'OPEN', 'ACCEPTED', 'IN_PROGRESS', 'AWAITING_EXTERNAL_CHANGE', 'RETEST_REQUIRED',
    'IMPROVED', 'UNCHANGED', 'REGRESSED', 'UNABLE_TO_VERIFY', 'CLOSED_WITH_RATIONALE',
    'WONT_FIX'
  )),
  status_rationale TEXT CHECK (status_rationale IS NULL OR length(status_rationale) BETWEEN 3 AND 4000),
  report_suggestion_key TEXT,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  lifecycle_version TEXT NOT NULL DEFAULT 'finding-lifecycle-v1' CHECK (length(lifecycle_version) BETWEEN 1 AND 80),
  created_by TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, reference_number)
) STRICT;

CREATE INDEX remediation_findings_project_idx ON remediation_findings(project_id, status);

CREATE TABLE finding_references (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL REFERENCES remediation_findings(id) ON DELETE CASCADE,
  claim_id TEXT,
  proposition_id TEXT,
  query_id TEXT,
  run_id TEXT,
  observation_id TEXT,
  answer_claim_id TEXT,
  citation_id TEXT,
  website_audit_id TEXT,
  created_at TEXT NOT NULL,
  -- Exactly one target must be present. Without this, a row with two targets or none would
  -- silently mean something the reader cannot see. A multi-column UNIQUE is deliberately not used
  -- here: SQLite treats NULLs as distinct, so it would appear to forbid duplicates while allowing
  -- every one of them.
  CHECK (
    (claim_id IS NOT NULL) + (proposition_id IS NOT NULL) + (query_id IS NOT NULL)
    + (run_id IS NOT NULL) + (observation_id IS NOT NULL) + (answer_claim_id IS NOT NULL)
    + (citation_id IS NOT NULL) + (website_audit_id IS NOT NULL) = 1
  ),
  FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE,
  FOREIGN KEY (proposition_id) REFERENCES propositions(id) ON DELETE CASCADE,
  FOREIGN KEY (query_id) REFERENCES queries(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
  FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE CASCADE,
  FOREIGN KEY (answer_claim_id) REFERENCES answer_claims(id) ON DELETE CASCADE,
  FOREIGN KEY (citation_id) REFERENCES citations(id) ON DELETE CASCADE,
  FOREIGN KEY (website_audit_id) REFERENCES website_audits(id) ON DELETE CASCADE
) STRICT;

CREATE INDEX finding_references_finding_idx ON finding_references(finding_id);
CREATE INDEX finding_references_project_idx ON finding_references(project_id);

CREATE TABLE retest_comparisons (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  finding_id TEXT REFERENCES remediation_findings(id) ON DELETE SET NULL,
  base_run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  later_run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  base_report_id TEXT REFERENCES reports(id) ON DELETE SET NULL,
  later_report_id TEXT REFERENCES reports(id) ON DELETE SET NULL,
  comparable INTEGER NOT NULL CHECK (comparable IN (0, 1)),
  outcome TEXT NOT NULL CHECK (outcome IN (
    'IMPROVED', 'UNCHANGED', 'REGRESSED', 'UNABLE_TO_VERIFY', 'NOT_COMPARABLE'
  )),
  reasons_json TEXT NOT NULL CHECK (json_valid(reasons_json)),
  deltas_json TEXT NOT NULL CHECK (json_valid(deltas_json)),
  statement_note TEXT CHECK (statement_note IS NULL OR length(statement_note) BETWEEN 3 AND 4000),
  created_by TEXT NOT NULL CHECK (length(created_by) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  CHECK (base_run_id <> later_run_id),
  -- A pair that is not configuration-comparable may never claim a direction.
  CHECK (comparable = 1 OR outcome = 'NOT_COMPARABLE' OR outcome = 'UNABLE_TO_VERIFY')
) STRICT;

CREATE INDEX retest_comparisons_finding_idx ON retest_comparisons(finding_id, created_at DESC);
CREATE INDEX retest_comparisons_project_idx ON retest_comparisons(project_id, created_at DESC);

CREATE TABLE finding_updates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL REFERENCES remediation_findings(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  previous_status TEXT CHECK (previous_status IS NULL OR previous_status IN (
    'OPEN', 'ACCEPTED', 'IN_PROGRESS', 'AWAITING_EXTERNAL_CHANGE', 'RETEST_REQUIRED',
    'IMPROVED', 'UNCHANGED', 'REGRESSED', 'UNABLE_TO_VERIFY', 'CLOSED_WITH_RATIONALE',
    'WONT_FIX'
  )),
  new_status TEXT CHECK (new_status IS NULL OR new_status IN (
    'OPEN', 'ACCEPTED', 'IN_PROGRESS', 'AWAITING_EXTERNAL_CHANGE', 'RETEST_REQUIRED',
    'IMPROVED', 'UNCHANGED', 'REGRESSED', 'UNABLE_TO_VERIFY', 'CLOSED_WITH_RATIONALE',
    'WONT_FIX'
  )),
  note TEXT NOT NULL CHECK (length(note) BETWEEN 3 AND 4000),
  comparison_id TEXT REFERENCES retest_comparisons(id) ON DELETE SET NULL,
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  UNIQUE(finding_id, sequence)
) STRICT;

CREATE INDEX finding_updates_finding_idx ON finding_updates(finding_id, sequence DESC);

-- ---------------------------------------------------------------------------
-- Findings
-- ---------------------------------------------------------------------------

CREATE TRIGGER remediation_findings_new_is_open
BEFORE INSERT ON remediation_findings
WHEN NEW.status <> 'OPEN'
BEGIN
  SELECT RAISE(ABORT, 'a new finding must start OPEN; record the triage as an update');
END;

CREATE TRIGGER remediation_findings_reference_number_unique
BEFORE INSERT ON remediation_findings
WHEN EXISTS (
  SELECT 1 FROM remediation_findings prior
  WHERE prior.project_id = NEW.project_id AND prior.reference_number = NEW.reference_number
)
BEGIN
  SELECT RAISE(ABORT, 'finding reference numbers are unique per project and never reused');
END;

CREATE TRIGGER remediation_findings_transition
BEFORE UPDATE OF status ON remediation_findings
WHEN NEW.status <> OLD.status
  AND NOT (
    (OLD.status = 'OPEN' AND NEW.status IN ('ACCEPTED', 'IN_PROGRESS', 'AWAITING_EXTERNAL_CHANGE', 'WONT_FIX', 'CLOSED_WITH_RATIONALE'))
    OR (OLD.status = 'ACCEPTED' AND NEW.status IN ('IN_PROGRESS', 'AWAITING_EXTERNAL_CHANGE', 'RETEST_REQUIRED', 'WONT_FIX', 'CLOSED_WITH_RATIONALE'))
    OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('AWAITING_EXTERNAL_CHANGE', 'RETEST_REQUIRED', 'WONT_FIX', 'CLOSED_WITH_RATIONALE'))
    OR (OLD.status = 'AWAITING_EXTERNAL_CHANGE' AND NEW.status IN ('IN_PROGRESS', 'RETEST_REQUIRED', 'WONT_FIX', 'CLOSED_WITH_RATIONALE'))
    OR (OLD.status = 'RETEST_REQUIRED' AND NEW.status IN ('IMPROVED', 'UNCHANGED', 'REGRESSED', 'UNABLE_TO_VERIFY', 'CLOSED_WITH_RATIONALE'))
    OR (OLD.status = 'IMPROVED' AND NEW.status IN ('RETEST_REQUIRED', 'CLOSED_WITH_RATIONALE'))
    OR (OLD.status = 'UNCHANGED' AND NEW.status IN ('IN_PROGRESS', 'RETEST_REQUIRED', 'CLOSED_WITH_RATIONALE'))
    OR (OLD.status = 'REGRESSED' AND NEW.status IN ('IN_PROGRESS', 'RETEST_REQUIRED', 'CLOSED_WITH_RATIONALE'))
    OR (OLD.status = 'UNABLE_TO_VERIFY' AND NEW.status IN ('RETEST_REQUIRED', 'IN_PROGRESS', 'WONT_FIX', 'CLOSED_WITH_RATIONALE'))
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid finding status transition');
END;

-- The states that mean "we measured something" require a stored comparison whose outcome agrees.
-- This is the reason a finding cannot be marked improved by hand.
CREATE TRIGGER remediation_findings_measurement_requires_comparison
BEFORE UPDATE OF status ON remediation_findings
WHEN NEW.status IN ('IMPROVED', 'UNCHANGED', 'REGRESSED', 'UNABLE_TO_VERIFY')
  AND NOT EXISTS (
    SELECT 1 FROM retest_comparisons comparison
    WHERE comparison.finding_id = NEW.id
      AND (
        comparison.outcome = NEW.status
        OR (NEW.status = 'UNABLE_TO_VERIFY' AND comparison.outcome = 'NOT_COMPARABLE')
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'a measured finding status requires a stored retest comparison with that outcome');
END;

CREATE TRIGGER remediation_findings_closure_requires_rationale
BEFORE UPDATE OF status ON remediation_findings
WHEN NEW.status IN ('CLOSED_WITH_RATIONALE', 'WONT_FIX')
  AND (NEW.status_rationale IS NULL OR length(NEW.status_rationale) < 3)
BEGIN
  SELECT RAISE(ABORT, 'closing a finding requires a written rationale');
END;

CREATE TRIGGER remediation_findings_immutable_fields
BEFORE UPDATE ON remediation_findings
WHEN NEW.id IS NOT OLD.id
  OR NEW.project_id IS NOT OLD.project_id
  OR NEW.reference_number IS NOT OLD.reference_number
  OR NEW.created_by IS NOT OLD.created_by
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.lifecycle_version IS NOT OLD.lifecycle_version
  OR NEW.first_observed_at IS NOT OLD.first_observed_at
  OR NEW.report_suggestion_key IS NOT OLD.report_suggestion_key
BEGIN
  SELECT RAISE(ABORT, 'finding identity and origin are immutable');
END;

-- A severity or cause must never move without a written reason attached to the same instant. The
-- rule matches on the timestamp only: matching the creator as well would accept any unrelated note
-- the creator happened to leave at that second, and would refuse a legitimate re-triage by a
-- different reviewer.
CREATE TRIGGER remediation_findings_severity_history
BEFORE UPDATE OF severity, cause ON remediation_findings
WHEN (NEW.severity IS NOT OLD.severity OR NEW.cause IS NOT OLD.cause)
  AND NOT EXISTS (
    SELECT 1 FROM finding_updates entry
    WHERE entry.finding_id = NEW.id
      AND entry.created_at = NEW.updated_at
  )
BEGIN
  SELECT RAISE(ABORT, 'changing a finding severity or cause must be recorded as an update first');
END;

-- ---------------------------------------------------------------------------
-- References: every target must belong to the finding's own project
-- ---------------------------------------------------------------------------

-- The trigger only speaks once the row has exactly one target, so the shape rule above stays the
-- one that reports a missing or doubled target. Guarding the scope of a malformed row first would
-- bury the real defect under a project-boundary message.
CREATE TRIGGER finding_references_targets_same_project
BEFORE INSERT ON finding_references
WHEN (NEW.claim_id IS NOT NULL) + (NEW.proposition_id IS NOT NULL) + (NEW.query_id IS NOT NULL)
  + (NEW.run_id IS NOT NULL) + (NEW.observation_id IS NOT NULL) + (NEW.answer_claim_id IS NOT NULL)
  + (NEW.citation_id IS NOT NULL) + (NEW.website_audit_id IS NOT NULL) = 1
  AND NOT (
  COALESCE(
    (SELECT 1 FROM claims c WHERE c.id = NEW.claim_id AND c.project_id = NEW.project_id),
    (SELECT 1 FROM propositions p JOIN claim_revisions r ON r.id = p.claim_revision_id
      JOIN claims c ON c.id = r.claim_id
      WHERE p.id = NEW.proposition_id AND c.project_id = NEW.project_id),
    (SELECT 1 FROM queries q JOIN query_sets s ON s.id = q.query_set_id
      WHERE q.id = NEW.query_id AND s.project_id = NEW.project_id),
    (SELECT 1 FROM runs r WHERE r.id = NEW.run_id AND r.project_id = NEW.project_id),
    (SELECT 1 FROM observations o JOIN runs r ON r.id = o.run_id
      WHERE o.id = NEW.observation_id AND r.project_id = NEW.project_id),
    (SELECT 1 FROM answer_claims a WHERE a.id = NEW.answer_claim_id AND a.project_id = NEW.project_id),
    (SELECT 1 FROM citations ci JOIN observations o ON o.id = ci.observation_id JOIN runs r ON r.id = o.run_id
      WHERE ci.id = NEW.citation_id AND r.project_id = NEW.project_id),
    (SELECT 1 FROM website_audits w WHERE w.id = NEW.website_audit_id AND w.project_id = NEW.project_id),
    0
  ) = 1
)
BEGIN
  SELECT RAISE(ABORT, 'a finding reference must point at a record in the same project');
END;

CREATE TRIGGER finding_references_finding_same_project
BEFORE INSERT ON finding_references
WHEN (SELECT project_id FROM remediation_findings WHERE id = NEW.finding_id) IS NOT NEW.project_id
BEGIN
  SELECT RAISE(ABORT, 'a finding reference must belong to its finding project');
END;

CREATE TRIGGER finding_references_no_update
BEFORE UPDATE ON finding_references
BEGIN
  -- A reference is a pointer rather than a judgement, so removing a wrong one is allowed and
  -- audited; editing it in place would rewrite what a historical finding pointed at.
  SELECT RAISE(ABORT, 'finding references cannot be edited; remove and re-record instead');
END;

-- ---------------------------------------------------------------------------
-- Comparisons
-- ---------------------------------------------------------------------------

CREATE TRIGGER retest_comparisons_runs_same_project
BEFORE INSERT ON retest_comparisons
WHEN (SELECT project_id FROM runs WHERE id = NEW.base_run_id) IS NOT NEW.project_id
  OR (SELECT project_id FROM runs WHERE id = NEW.later_run_id) IS NOT NEW.project_id
BEGIN
  SELECT RAISE(ABORT, 'both runs in a comparison must belong to the project');
END;

CREATE TRIGGER retest_comparisons_finding_same_project
BEFORE INSERT ON retest_comparisons
WHEN NEW.finding_id IS NOT NULL
  AND (SELECT project_id FROM remediation_findings WHERE id = NEW.finding_id) IS NOT NEW.project_id
BEGIN
  SELECT RAISE(ABORT, 'a comparison must reference a finding in the same project');
END;

CREATE TRIGGER retest_comparisons_no_update
BEFORE UPDATE ON retest_comparisons
BEGIN
  SELECT RAISE(ABORT, 'retest comparisons are append-only');
END;

-- ---------------------------------------------------------------------------
-- Update log
-- ---------------------------------------------------------------------------

CREATE TRIGGER finding_updates_sequence_follows
BEFORE INSERT ON finding_updates
WHEN NEW.sequence <> (
  SELECT COALESCE(MAX(sequence), 0) + 1 FROM finding_updates prior WHERE prior.finding_id = NEW.finding_id
)
BEGIN
  SELECT RAISE(ABORT, 'finding updates must be appended in sequence');
END;

CREATE TRIGGER finding_updates_finding_same_project
BEFORE INSERT ON finding_updates
WHEN (SELECT project_id FROM remediation_findings WHERE id = NEW.finding_id) IS NOT NEW.project_id
BEGIN
  SELECT RAISE(ABORT, 'a finding update must belong to its finding project');
END;

CREATE TRIGGER finding_updates_status_pair
BEFORE INSERT ON finding_updates
WHEN (NEW.previous_status IS NULL) <> (NEW.sequence = 1)
BEGIN
  SELECT RAISE(ABORT, 'only the first update may omit a previous status');
END;

CREATE TRIGGER finding_updates_no_update
BEFORE UPDATE ON finding_updates
BEGIN
  SELECT RAISE(ABORT, 'finding updates are append-only');
END;
