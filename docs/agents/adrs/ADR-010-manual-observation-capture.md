# ADR-010: Use Manually Captured Observations as the Only v0.1 Answer Source

- Status: Proposed
- Date: 2026-10-28
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-003, ADR-004, ADR-005, ADR-007, ADR-008

## Context

The product ultimately evaluates answers returned by AI/search providers through supported integrations. This milestone explicitly forbids external APIs, AI providers, scraping, and fake provider integrations. The evaluator must still be useful with genuine user-supplied material and must not fabricate answers or present mock data as results.

Provider behavior is also an observation of one configuration at one time, not a timeless property. The data model requires preserved prompts, raw answers, citation metadata where available, locale, model identifiers, and timestamps.

## Decision

1. v0.1 supports **manual observation capture only**. The operator copies or imports an answer they actually observed from a named system and records the exact prompt, raw answer, capture time, interface, model label if displayed, grounding/search mode if known, locale/region, citations shown, and notes.
2. Provider names are free-text labels supplied by the operator. The UI and reports label every observation as `MANUAL CAPTURE — NOT AN INTEGRATED PROVIDER TEST` and state that Aporia did not call the system.
3. An evaluation run is a bounded manual-capture campaign referencing one approved, versioned query set and one declared provider/model/interface/mode/locale/region configuration. Runs follow `OPEN → FINALIZED` or `OPEN → CANCELLED`. Only `OPEN` runs accept observations; `FINALIZED` runs are immutable and reportable.
4. Observation statuses distinguish `COMPLETED`, `REFUSAL`, `NO_ANSWER`, `ERROR`, `BLOCKED`, `TIMEOUT`, and `UNAVAILABLE`. Only `COMPLETED` observations are eligible for answer-presence, fidelity, citation, and attribution denominators. Other statuses are reported as coverage/exclusion reasons and never converted into negative factual findings or “not mentioned” outcomes.
5. Citation capture explicitly distinguishes `CAPTURED`, `NOT_SHOWN`, and `UNKNOWN`. Citation-dependent metrics exclude observations whose interface did not expose citations; absence of an annotation is not treated as proof that no source was used.
6. All four observation dimensions (presence, fidelity, citation support, attribution) are explicit human assessments with controlled labels, rationale, reviewer label, and append-only versions. Unassessed dimensions remain `UNKNOWN` and are excluded from denominators with a recorded reason.
7. Query sets must be approved before use. Approval freezes the query text and metadata; a new version is created by cloning, never by editing an approved set in place.
8. Observation JSON import is validated as untrusted input. Validation is atomic: any invalid row rejects the entire import. Imported records are still manual captures and carry the same labeling.
9. No adapter interface will be implemented until a supported provider access route, terms review, capability declaration, fixtures, and live validation exist. The provider-contract directory remains a documented boundary, not a working integration.

## Alternatives considered

1. **Mock or stub provider adapters.** Rejected explicitly: fake integrations would violate the milestone and AGENTS.md rule 7.
2. **Scraping consumer chat interfaces.** Rejected: unstable, potentially terms-violating, and outside the milestone.
3. **Calling a provider “manually” from a server-side helper.** Rejected: still an external integration without capability review or credentials.
4. **Free-text notes without structured observation fields.** Rejected because it prevents separate metrics, exclusions, and reproducibility.
5. **Using one provider label shared across models and interfaces.** Rejected because it would misrepresent test conditions and comparability.

## Consequences and trade-offs

- The product is useful now for documenting real observed answers, but it cannot generate answers or automate tests.
- Results reflect the operator’s collection discipline. Reports must disclose manual capture, sample construction, and missing citation metadata.
- Run finalization creates a stable audit boundary; correcting a finalized capture requires a new run, preserving history.
- The metric layer is designed to accept future normalized provider observations, but no such adapter exists in v0.1.

## Security, privacy, safety, and evaluator-validity implications

- Raw answers may contain personal or sensitive content. They are stored locally and included in project exports; reports must be reviewed before sharing. Local deletion controls remove project data.
- Manual capture avoids sending prompts or evidence to third parties, reducing external data-transfer risk.
- No claim of provider coverage or capability is made. A provider label in a run does not mean Aporia supports that provider.
- The metrics are descriptive of the captured sample. They must not be described as universal probabilities, provider rankings, or model-quality claims.
- Refusals and abstentions are behaviorally distinct and must not be scored as factual denials.

## Implementation and migration plan

1. Schema for query sets, queries, runs, observations, and citations with immutability triggers.
2. Manual entry forms and atomic JSON import with strict validation.
3. Observation assessment versioning and exclusion-aware metrics.
4. Run finalization and report integration.
5. UI copy and report labels that make manual capture unmistakable.

## Tests and validation required

- Tests that error/timeout/blocked/refusal observations never enter mention or fidelity denominators as negatives.
- Tests that unknown citation metadata is excluded and reported.
- Tests that finalized runs reject new or modified observations.
- Tests that approved query sets cannot be edited and version cloning preserves query text.
- Import tests for valid, malformed, partial, and duplicate rows, proving atomic rejection.
- Report regression cases for manual-capture disclosure and unassessed dimensions.
