-- Local core v0.4: retest provenance (ADR-021 as amended by ADR-024).
--
-- A measured finding status is a claim that a specific retest showed a specific movement. Under v0.3
-- the lifecycle checked that *some* acceptable comparison existed for the finding while writing whatever
-- `comparisonId` the caller supplied into the history row, so a valid comparison elsewhere could justify
-- an update citing an unrelated one. The chosen focus metric — the single value ADR-021 says decides the
-- outcome — survived only inside an audit-event detail that nothing read back.
--
-- This migration records the decision durably on the comparison row, binds a transition's citation to
-- the comparison that actually justifies it, and stamps which comparability rule produced the verdict.
-- Applied migrations are never edited, so everything here is additive and every constraint lands on new
-- writes only.

-- ---------------------------------------------------------------------------
-- The decision, on the row that carries the outcome
-- ---------------------------------------------------------------------------

ALTER TABLE retest_comparisons ADD COLUMN focus_metric TEXT;
ALTER TABLE retest_comparisons ADD COLUMN focus_label TEXT;
ALTER TABLE retest_comparisons ADD COLUMN rule_version TEXT;
ALTER TABLE retest_comparisons ADD COLUMN base_metrics_version TEXT;
ALTER TABLE retest_comparisons ADD COLUMN later_metrics_version TEXT;

-- Rows written before v0.4 keep NULL in all five columns, and NULL is meaningful: it says the row was
-- produced under `comparison-rule-v1`, whose condition list did not include the recorded capture
-- conditions, and that its deciding metric was never stored. A reader must be able to tell "old
-- semantics" from "no semantics", so those rows are not backfilled with values they never had.

CREATE TRIGGER retest_comparisons_v04_requires_provenance
BEFORE INSERT ON retest_comparisons
WHEN NEW.focus_metric IS NULL
  OR length(NEW.focus_metric) < 1
  OR length(NEW.focus_metric) > 120
  OR NEW.rule_version IS NULL
  OR NEW.rule_version NOT IN ('comparison-rule-v1', 'comparison-rule-v2')
BEGIN
  SELECT RAISE(ABORT, 'a retest comparison must record the focus metric and the comparability rule that produced it');
END;

-- The stored outcome has to be reachable from the stored focus metric. A row may not claim IMPROVED
-- while recording a metric whose row in `deltas_json` says otherwise, which is what makes the record
-- self-supporting rather than a caption attached to a number.
--
-- It stays silent when `focus_metric` is absent, because that is the other trigger's finding, and its
-- message names the missing provenance. SQLite fires same-table BEFORE INSERT triggers in name order,
-- so an unconditional check here would report a "metric not measured" error for a row that recorded no
-- metric at all.
CREATE TRIGGER retest_comparisons_focus_metric_in_deltas
BEFORE INSERT ON retest_comparisons
WHEN NEW.focus_metric IS NOT NULL
  AND NEW.outcome NOT IN ('NOT_COMPARABLE', 'UNABLE_TO_VERIFY')
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(NEW.deltas_json) AS row
    WHERE json_extract(row.value, '$.metricId') = NEW.focus_metric
  )
BEGIN
  SELECT RAISE(ABORT, 'the focus metric must be one the comparison actually measured');
END;

-- ---------------------------------------------------------------------------
-- A status transition is bound to the comparison it cites
-- ---------------------------------------------------------------------------

-- Every measured status names the comparison that justifies it, in the project, on this finding, with
-- the outcome the status claims. The v0.3 trigger only required *a* comparison somewhere on the finding;
-- this one requires the cited row to be the justification.
CREATE TRIGGER finding_updates_comparison_same_project
BEFORE INSERT ON finding_updates
WHEN NEW.comparison_id IS NOT NULL
  AND (SELECT project_id FROM retest_comparisons WHERE id = NEW.comparison_id) IS NOT NEW.project_id
BEGIN
  SELECT RAISE(ABORT, 'a transition may only cite a comparison from its own project');
END;

CREATE TRIGGER finding_updates_comparison_same_finding
BEFORE INSERT ON finding_updates
WHEN NEW.comparison_id IS NOT NULL
  AND (SELECT finding_id FROM retest_comparisons WHERE id = NEW.comparison_id) IS NOT NEW.finding_id
BEGIN
  SELECT RAISE(ABORT, 'a transition may only cite a comparison raised against the same finding');
END;

CREATE TRIGGER finding_updates_comparison_outcome_matches
BEFORE INSERT ON finding_updates
WHEN NEW.comparison_id IS NOT NULL
  AND NEW.new_status IN ('IMPROVED', 'UNCHANGED', 'REGRESSED')
  AND (SELECT outcome FROM retest_comparisons WHERE id = NEW.comparison_id) <> NEW.new_status
BEGIN
  SELECT RAISE(ABORT, 'the cited comparison must carry the outcome the transition claims');
END;

CREATE TRIGGER finding_updates_unable_requires_cited_comparison
BEFORE INSERT ON finding_updates
WHEN NEW.new_status = 'UNABLE_TO_VERIFY'
  AND (NEW.comparison_id IS NULL
    OR (SELECT outcome FROM retest_comparisons WHERE id = NEW.comparison_id) NOT IN ('UNABLE_TO_VERIFY', 'NOT_COMPARABLE'))
BEGIN
  SELECT RAISE(ABORT, 'unable to verify requires citing the comparison that could not verify it');
END;

CREATE TRIGGER finding_updates_measured_requires_cited_comparison
BEFORE INSERT ON finding_updates
WHEN NEW.new_status IN ('IMPROVED', 'UNCHANGED', 'REGRESSED')
  AND NEW.comparison_id IS NULL
BEGIN
  SELECT RAISE(ABORT, 'a measured status must cite the comparison that measured it');
END;
