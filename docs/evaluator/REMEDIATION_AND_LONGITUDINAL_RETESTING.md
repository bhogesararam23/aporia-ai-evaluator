# Remediation and Longitudinal Retesting

## Purpose

Turn evaluation findings into evidence-linked actions and measure subsequent outcomes without promising that a third-party AI system will crawl, index, remember, recommend, or cite the subject.

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
