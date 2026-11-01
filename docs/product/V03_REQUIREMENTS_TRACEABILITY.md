# Local Core v0.3 Requirements Traceability Matrix

- Status: Working audit record for the v0.3 milestone
- Date: 2026-11-01
- Baseline commit audited: `3fb38f4` (`origin/main`, Local Core v0.2 merged)
- Purpose: map each v0.3 requirement to the code that satisfies it and the test that proves it,
  and record the gaps that this milestone must close.

Every row was checked against the repository as it existed at the baseline commit, not against a
README or roadmap statement. "Absent" means the reviewer searched the source tree and found no
implementation.

## 1. Method used

- Read `AGENTS.md`, `README.md`, `docs/README.md`, `docs/IMPLEMENTATION_STATUS.md`,
  `docs/KNOWN_LIMITATIONS.md`, the product, evaluator, technical, security, and operations
  documents, the ADR index, and the four session reports.
- Read all `src/` modules, all seven migrations, all route and view modules, and all tests.
- Ran `npm run check` (typecheck, lint, format:check, check:boundaries, test) at the baseline.
- Inspected `git status`, `git log --all`, `git branch -vv`, and `git fetch origin --prune`.

## 2. Baseline verification actually performed

| Command | Result at baseline |
| --- | --- |
| `npm run typecheck` | Passed, no output |
| `npm run lint` | Passed, no output |
| `npm run format:check` | Passed |
| `npm run check:boundaries` | `Module boundaries are clean.` |
| `npm test` | 335 tests, 335 pass, 0 fail, 0 skipped |

The local checkout was clean and `main` was 55 commits behind `origin/main`. `origin/main` already
contains the merged v0.2 branch. No uncommitted work existed, so nothing was at risk of being lost.

## 3. Requirement → implementation → test matrix

Requirement identifiers are the v0.3 milestone sections. Each row states the real baseline state.

### 3.1 Claim-level answer evaluation (milestone section 2)

| ID | Requirement | Baseline state | Baseline evidence | v0.3 disposition |
| --- | --- | --- | --- | --- |
| AC-01 | Operator can split an exact captured answer into individual factual statements | **Absent.** `observations.answer_text` is stored whole; nothing decomposes it. | `src/persistence/migrations/004_query_sets_runs.sql` (`observations`), no answer-claim table in any migration | New `answer_claims` + `answer_claim_revisions` model |
| AC-02 | Each statement preserves its exact quote and source observation | **Partial.** The observation preserves the raw answer, but there is no per-statement record. | `observations.answer_text`, `ObservationRecord` in `src/persistence/repositories/runs.ts` | Quote stored per claim revision |
| AC-03 | Location within the original answer where reliable offsets exist | **Absent.** | no offset fields anywhere | Offset recorded only when the quote is verbatim in the raw answer; otherwise explicitly `NOT_ESTABLISHED` |
| AC-04 | Raw observation stays available and immutable | **Implemented / validated.** | `observations_immutable_fields` trigger; `tests/integration/schema-runs.test.ts` | Retained; claim work must not weaken it |
| AC-05 | A corrected statement creates a superseding record, not a silent edit | **Absent** for answer statements (pattern exists for claims and achievements). | `claim_revisions` triggers, `achievement_revisions` triggers | Append-only revision chain |
| AC-06 | Statements may be unrelated, ambiguous, partially relevant, or not assessable | **Absent.** | observation-level `FIDELITY` labels only | Explicit relevance vocabulary including `UNRELATED`, `AMBIGUOUS`, `PARTIALLY_RELEVANT`, `NOT_ASSESSABLE` |
| AC-07 | Link answer claims to project propositions | **Absent.** | `evidence_relationships` link evidence to propositions only | `answer_claim_propositions` link rows |
| AC-08 | One claim → many propositions, many claims → one proposition | **Absent.** | — | Link rows are many-to-many by construction |
| AC-09 | Distinguish omission, denial, refusal, abstention, unsupported assertion, unavailable answer | **Partial.** Observation status distinguishes refusal / no answer / unavailable at whole-answer level; nothing at statement level. | `OBSERVATION_STATUSES`, `tests/unit/vocabulary.test.ts` | Statement-level `answering` relation set |
| AC-10 | Claim-level citation mapping | **Absent.** Citations attach to the observation only. | `citations.observation_id` | `answer_claim_citations` mapping rows |
| AC-11 | Citation support recorded per claim, incl. no-citation / non-supporting / partial / conditional / metadata-missing / shared citation | **Partial.** A single observation-level `CITATION_SUPPORT` label exists. | `observation_assessments`, `src/core/metrics.ts` | Per-mapping support assessment |
| AC-12 | Citation presence is not treated as factual accuracy | **Implemented / validated.** | `citationSupportRate` separate from `claimFidelityRate`; `tests/unit/metrics.test.ts` | Preserved and extended |
| AC-13 | Claim-level attribution with person/role distinctions | **Partial.** Attribution is one label per observation with one optional role. | `observation_assessments.attribution_role` | Per-claim attribution with subject/role distinction and false-sole-credit state |
| AC-14 | Never infer authorship from a name appearing in an answer | **Implemented / validated** as policy + wording | `ATTRIBUTION_ROLE` docs, `tests/unit/vocabulary.test.ts` | Preserved |
| AC-15 | Versioned assessments with reviewer rationale and evidence references | **Implemented** at proposition and observation level | `proposition_assessments`, `observation_assessments` | Same append-only pattern per answer claim |
| AC-16 | Observation-level assessments retained as historical/summary records | **Implemented / validated** | `metrics-v1`/`metrics-v2` snapshot handling, `tests/integration/reporting-service.test.ts` | Must remain; claim level is additive |
| AC-17 | No silent recalculation of `metrics-v1`/`metrics-v2` snapshots | **Implemented / validated.** Reports render only from stored JSON. | `tests/integration/report-immutability.test.ts`, `tests/unit/report-compatibility.test.ts` | Claim-level metrics require a new version |
| AC-18 | Decide and document a new metric version with an ADR | **Missing decision** | `src/core/versions.ts` still `metrics-v2` | ADR-019 + `metrics-v3` |

### 3.2 Claim-level interface (milestone section 3)

| ID | Requirement | Baseline state | v0.3 disposition |
| --- | --- | --- | --- |
| UI-01 | Open a captured observation and read the exact original answer | **Implemented** — run detail shows the raw answer | Extend with a claim workspace link |
| UI-02 | Record individual answer claims | **Absent** | New form + list |
| UI-03 | Link claims to propositions | **Absent** | New form, project-scoped option list |
| UI-04 | Map citations to claims | **Absent** | New form |
| UI-05 | Assess fidelity, citation support, attribution per claim | **Absent** | New assessment forms with review history |
| UI-06 | Preserve omissions and unresolved statements | **Absent** | Explicit "no statement recorded / omission" affordance |
| UI-07 | View complete review history | **Partial** at proposition level | Full version history per claim |
| UI-08 | Understand how claims contribute to the report | **Absent** | Report section + in-page explanation |
| UI-09 | No new frontend framework; stay server-rendered | **Implemented** — zero client JS | Preserved |
| UI-10 | Accessible forms, explicit validation errors, keyboard-friendly | **Implemented pattern** | Followed and covered by `tests/integration/accessibility.test.ts` |

### 3.3 Offline benchmark and evaluator validation (milestone section 4)

| ID | Requirement | Baseline state | v0.3 disposition |
| --- | --- | --- | --- |
| BM-01 | Versioned benchmark case format | **Absent** — spec document only | `benchmark-case-v1` JSON contract in `src/benchmark/` |
| BM-02 | Documented annotation rubric | **Absent** — 67-line plan document | New rubric document tied to the vocabulary |
| BM-03 | Human-assigned gold labels | **Absent** | Case format carries gold labels + provenance; no gold content is invented |
| BM-04 | Expected labels for evidence/fidelity/citation/attribution | **Absent** | Four scored dimensions |
| BM-05 | Ambiguous, conflicting, insufficient, unavailable cases | **Absent** | Required strata enforced by the validator |
| BM-06 | Dataset validation | **Absent** | Deterministic validator with structural + semantic checks |
| BM-07 | Repeatable execution command | **Absent** | `npm run benchmark` |
| BM-08 | Per-label breakdowns, confusion matrices | **Absent** | Implemented in the scorer |
| BM-09 | Precision / recall / macro-F1 | **Absent** | Implemented; no confidence intervals without justified samples |
| BM-10 | Reviewer disagreement and adjudication records | **Absent** | Case format carries reviewer labels and adjudication outcome |
| BM-11 | Reproducible report with dataset + methodology versions | **Absent** | Emitted by the runner |
| BM-12 | Separate software regression from methodology failure | **Absent** | Split into `regression` (deterministic rule) vs `methodology` (gold-label agreement) sections |
| BM-13 | Do not fabricate results or claim validated accuracy | **Policy, no artifact** | Report states the case-source limitation explicitly; empty corpus yields "no accuracy claim", not zero |

### 3.4 Remediation and longitudinal retesting (milestone section 5)

| ID | Requirement | Baseline state | v0.3 disposition |
| --- | --- | --- | --- |
| RM-01 | Stable finding identifier | **Absent** | `remediation_findings` with a per-project label |
| RM-02 | Project/claim/proposition/query/run/answer-claim references | **Absent** | Typed reference rows |
| RM-03 | Observed issue, evidence, severity + rationale, action, owner, status | **Partial** — report emits transient `RemediationSuggestion` objects that are not persisted | Persisted findings; suggestions remain derivable input |
| RM-04 | Statuses open/accepted/in progress/awaiting/retest/improved/unchanged/regressed/unable/closed | **Absent** | `FINDING_STATUSES` with an explicit transition graph |
| RM-05 | Auditable finding updates | **Absent** | Append-only `finding_updates` |
| RM-06 | Compare a later evaluation with an earlier one, with comparability conditions | **Partial** — `buildComparisons` compares only finalized runs with identical query set + config, inside a report | Standalone retest comparison view + comparison of claim-level metrics |
| RM-07 | Do not claim causation from a website change | **Implemented / validated** — "descriptive, not causal" | Preserved in the new workflow |
| RM-08 | Preserve historical reports and records | **Implemented / validated** | Preserved |
| RM-09 | No scheduled provider calls or remote monitoring | **Implemented** — no network client exists | Preserved |

### 3.5 Reliability, security, privacy, performance (milestone section 6)

| ID | Area | Baseline state | v0.3 action |
| --- | --- | --- | --- |
| SE-01 | Transaction boundaries + audit atomicity | **Implemented / validated** — `audit-atomicity.test.ts` | Extend coverage to claim + finding writes |
| SE-02 | Append-only records, immutable snapshots | **Implemented / validated** | Extend triggers to new tables |
| SE-03 | Migration checksum / compatibility | **Implemented / validated** | New migrations 008/009 covered |
| SE-04 | Cross-project access checks | **Implemented** for existing tables | New triggers must enforce the same rule; add tests |
| SE-05 | Input validation / malformed data | **Implemented** in `src/core/inputs.ts` | New validators + fuzz-style tests |
| SE-06 | Backup manifest + restore failure | **Implemented / validated** | Must include the new tables in counts and verification |
| SE-07 | Backup directory / filesystem safety | **Implemented / validated** | Re-audited |
| SE-08 | Rollback under partial failure | **Implemented / validated** | New multi-table writes tested for rollback |
| SE-09 | CSV escaping / formula injection | **Implemented / validated** | New exports reuse the guard |
| SE-10 | Host / Origin / CSRF / security headers | **Implemented / validated** | New routes inherit the middleware |
| SE-11 | Upload limits and parser cost | **Implemented / validated** | Benchmark file reads must stay bounded |
| SE-12 | Error handling and safe logging | **Implemented / validated** | Preserved |
| SE-13 | Query performance / repeated queries | **Partial** — the run and report paths issue several sequential reads | Measured and reduced where the new workflows make it worse |
| SE-14 | Accessibility of new workflows | Pattern exists | New pages added to the accessibility suite |

## 4. Highest-risk gaps identified

1. **AC-01/AC-07/AC-10 — the entire claim-level layer is missing.** The v0.3 objective cannot be
   met by adjusting existing tables; new entities are required.
2. **AC-17/AC-18 — metric versioning is a correctness risk.** Adding claim-level numbers under
   `metrics-v2` would silently reinterpret stored snapshots. A new version plus a documented
   boundary is mandatory.
3. **BM-01…BM-13 — the benchmark document has no code behind it.** A framework that produces
   numbers without real gold cases risks looking like a validation result when it is not.
4. **RM-03 — `RemediationSuggestion` is computed and thrown away.** The gap between "report
   suggests" and "operator tracks" is the whole feature.
5. **SE-04/SE-06 — new tables must not bypass project isolation or backup verification.** The
   existing trigger style and the backup count manifest are the control points.

## 5. Explicitly not treated as gaps

Provider/search/remote integrations, authentication, accounts, billing, publication, scheduled
monitoring, and encryption at rest remain out of scope for this milestone and stay recorded in
[Known Limitations](../KNOWN_LIMITATIONS.md).
