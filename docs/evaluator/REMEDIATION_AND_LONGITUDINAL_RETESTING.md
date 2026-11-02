# Remediation and Longitudinal Retesting

## Purpose

Turn evaluation findings into evidence-linked actions and measure subsequent outcomes without promising that a third-party AI system will crawl, index, remember, recommend, or cite the subject.

## What local core v0.4 implements

A finding is persisted with its severity and rationale, cause, recommended action, owner label, first and
last observation, an append-only status history, and typed pointers to the claim, proposition, query, run,
observation, answer statement, citation or local audit it concerns. Legal status transitions are enforced
by SQLite trigger, a closure requires a written rationale, and per-project numbering is monotonic.

A retest comparison is computed, never accepted. `POST …/retest/record` carries only the earlier run, the
later run and the single focus metric, and the repository recomputes the comparison from the two persisted
finalized runs inside the same write transaction, so no derived value — outcome, comparability, reasons or
deltas — travels through a caller-supplied object. The comparison row stores the focus metric and its
label, both runs' metric versions, and the comparability rule version that produced the verdict
(`comparison-rule-v2`, which also compares recorded conditions; `comparison-rule-v1` rows keep their
original meaning). A measured status — improved, unchanged, regressed, unable to verify — is written only
when the cited comparison belongs to this project, belongs to this finding, and carries that outcome; four
triggers enforce it, and the citation is stored in the history row so a later reader can check the status
against the measurement behind it.

Two limits remain, and they are the point of the wording in the UI rather than a caveat bolted on:
a comparison is an association between two captures, and conditions outside Aporia's view (the provider's
own behaviour, the passage of time, a different account state) may have moved the number. Nothing here
establishes that a change caused anything, and no finding record implies that a fix was deployed.

## Finding record

Each finding should include a stable ID, affected claim/query, observed result, evidence and provenance, confidence/limitations, severity rationale, recommended action, owner, status, and first/last observed timestamps. Separate a factual error from missing visibility, source-access failure, ambiguous intent, and attribution error.

## Remediation workflow

1. Confirm the finding is reproducible and the cited evidence supports it.
2. Classify the cause: missing/unclear first-party content, weak independent corroboration, ambiguous entity identity, stale source, unsupported claim, provider limitation, or measurement defect.
3. Recommend proportionate action. Do not advise manufacturing endorsements, fake reviews, misleading schema, keyword stuffing, or fabricated credentials.
4. Record the owner-approved change and the affected public source.
5. Retest with the same versioned query set and comparable provider/configuration where possible.
6. Report what changed, what did not, and what remains unobservable.

## Longitudinal comparability

Store run ID, query-set version, scoring version, provider/model when known, run timestamp, configuration, source snapshot or references, and failure/coverage metadata. Distinguish comparable runs from runs affected by provider/model changes, query changes, missing data, or altered retrieval conditions.

Report deltas by metric and query, sample size, coverage, and uncertainty. A before/after association does not establish causation. Avoid a single blended score that hides adverse changes or missing coverage.

## Status and safeguards

Use states such as open, accepted, in progress, awaiting external change, retest scheduled, improved, unchanged, regressed, and unable to verify. “Unable to verify” is not “fixed.” Preserve historical results and correction records; never overwrite a prior run to make progress appear better.
