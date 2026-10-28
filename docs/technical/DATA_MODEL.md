# Data Model and Lifecycle

## 1. Design rules

A claim, its evidence, a provider answer, a citation, and an attribution judgment are separate entities. Do not compress a full evaluation into an untraceable score. All derived records need provenance, timestamps, version identifiers, and links to input records.

## 2. Principal entities

### Project
A workspace around one product, person, organization, or research effort. Core fields: project identifier, owner identifier, display name, description, primary domain, visibility, creation/update timestamps, and lifecycle state. Workspace ownership is an access-control concept, not proof of real-world accomplishment.

### Entity
A person, organization, product, repository, publication, or named object. Fields include entity identifier/type, canonical name, alternate names, public URLs, identity status, and provenance references. Identity status records method and scope, not universal truth.

### Claim
Original user-provided statement, source URL, submission time, intended meaning, time scope, locale, and status. Editing meaningful wording creates a revision rather than silently overwriting old run inputs.

### Proposition
An atomic, testable interpretation of a claim. Fields include proposition identifier, claim revision, text, subject, predicate, object/value, conditions, time interval, units, evidence requirements, expected answer criterion, and decomposition version. Ambiguity may remain explicit; assumptions must not be invented.

### Achievement
A structured record linking one or more entities and contributor roles to propositions, evidence, dates, and project versions. Statuses distinguish draft, owner-published, evidence-reviewed, corroborated for stated propositions, disputed, superseded, and withdrawn.

### Source
Source descriptor with canonical URI, publisher/author when known, source type, access route, retrieval time, publication/modification dates when available, language, HTTP status, content digest, snapshot reference if retained, and license/access constraints. A URL does not prove independence or reliability.

### Evidence item
A passage, table, artifact, test output, code reference, release, benchmark, or other extract. Fields include evidence identifier, source identifier, locator (quote, selector, line range, commit hash), excerpt or artifact pointer, extraction time/method, and integrity metadata. Retain only as much source content as necessary and lawful.

### Evidence relationship
Typed edge between evidence and proposition: SUPPORTS, CONTRADICTS, QUALIFIES, CONTEXTUALIZES, DUPLICATES, or DOES_NOT_ADDRESS. Include rationale, evaluator version, confidence, and review state. This edge does not alone establish source truth; source quality is assessed separately.

### Query set
Versioned prompts with intended user intent, language, region, branded/non-branded flag, expected recognition target, eligibility criteria, and origin. Query-set changes remain separate from provider changes.

### Provider capability
Versioned declaration of supported actions, model identifiers, tools/grounding modes, citation schema, languages/locales, constraints, and validation status. A provider name existing does not mean its integration is functional.

### Evaluation run
Immutable attempt with request configuration, start/end time, evaluator/metric/adapter versions, query-set version, cost estimate/actual cost when known, and terminal status such as COMPLETED, PARTIAL, FAILED, CANCELLED, or UNAVAILABLE.

### Provider observation
Normalized response for a single test: raw response reference, provider/model identifier, prompt, tool/search configuration, timestamp, returned citations, request identifier when permitted, error status, and metadata. It is an observation of a configuration, not a universal property of a model.

### Assessment
Versioned judgment on a proposition or answer claim: label, rationale, evidence references, uncertainty, method (rule/model/human), reviewer when applicable, and audit history.

### Citation
Source reference returned by a provider, including URL, title/snippet, position/context when available, and mapping to claim(s) it may support. Citation presence does not prove that it supports the statement.

### Attribution result
Evaluation of whether an answer correctly identifies creator, project, contributor role, organization, and source. Identity, contribution, existence, and quality are distinct dimensions.

### Report snapshot
Immutable rendering inputs plus template version, generation time, run IDs, warnings, metrics, methodology versions, and export format.

### Review event
Human correction, dispute, adjudication, or approval with actor, timestamp, prior/new state, rationale, and evidence. High-impact findings must not be silently erased.

## 3. Relationships

- A project contains claims, entities, achievement records, and runs.
- A claim revision decomposes into proposition versions.
- A proposition links to multiple evidence items; support and contradiction can coexist.
- A run contains query executions and provider observations.
- An observation contains citations.
- An assessment references the exact observation and evidence version used.
- An attribution result references the creator/contributor and accomplishment being evaluated.
- A report references exact runs and methodology versions.
- A review event supersedes a prior assessment without deleting its history.

## 4. Lifecycle

Claims progress through submitted, decomposed, under review, assessed, and optionally disputed states. Runs progress queued, running, and one of completed, partial, failed, cancelled, or unavailable. State transitions are validated and audited.

## 5. Integrity constraints

- Every assessment references a proposition or provider observation.
- Every published evidence-backed verdict has source links or explicitly records an empty evidence set.
- Metrics reference numerator, denominator, exclusions, and formula version.
- Provider errors never become negative mention outcomes.
- Attribution names the role assessed (author, co-author, maintainer, contributor, organization) rather than inferring sole credit.
- Citations retain returned/normalized URL and raw observation where permitted.
- Deletion requests remove personal content while retaining only minimal non-identifying audit data when necessary and lawful.

## 6. Retention and privacy

Define retention by data class: query/configuration metadata, raw responses, fetched page bodies, uploads, public achievement records, account data, secrets, and audit records. Set periods before production. Raw uploads and full page bodies should generally have shorter retention than minimal report metadata. Do not retain content merely because storage is cheap.

## 7. Commercial separation

Core entities must not include plan price, revenue, sales stage, invoice, or subscription tier as evaluator inputs. Commercial services may reference project/run IDs for quota accounting, but evaluator outputs are calculated without commercial state.
