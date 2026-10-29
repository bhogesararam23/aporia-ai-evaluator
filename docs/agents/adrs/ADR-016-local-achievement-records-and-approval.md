# ADR-016: Store Local Achievement Records With Immutable Revisions and Explicit Approval

- Status: Proposed
- Date: 2026-10-30
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-002, ADR-006, ADR-009, ADR-013, ADR-015

## Context

Product requirement FR-011 asks for a human-readable achievement page and machine-readable metadata, and the trust model distinguishes owner-published, evidence-reviewed, and independently corroborated states. Local v0.1 deliberately stopped before any achievement record. The v0.2 milestone adds the structured record, preview, and downloadable HTML/JSON-LD **without** publishing to any website, calling any remote service, or implying publication occurred.

The record must join claims, contributor roles, dates, project details, and supplied evidence; preserve unresolved contradictions and self-declared versus evidence-supported states; and keep revision history. It must not present a self-declared role or claim as independently verified, and it must not let a generated file drift away from the structured data it was generated from.

## Decision

1. An achievement record belongs to one project. It has an append-only sequence of immutable revisions and a current revision. Creating or editing achievement content creates a new revision; old revisions remain readable. A revision snapshots the project name, description, and URL it displayed, plus the claim text and evidence summaries it used, so a later project or claim edit cannot silently change a historical revision.
2. Each revision stores:
   - a title, summary, display project details, and optional start/end dates;
   - linked claims, each with the claim id, the claim revision id used, a text snapshot, the recorded evidence status, the human assessment status if one exists, and a flag for whether any active evidence relationship was recorded;
   - contributors, each with a name, a controlled role, a contribution statement, and a support state: `SELF_DECLARED`, `EVIDENCE_LINKED` (with an evidence note), or `DISPUTED`. These states are reviewer records, not identity verification or ownership proof;
   - links to project sources and evidence items used by the record, with a note on what each supports;
   - unresolved contradictions derived at creation from linked claims whose recorded relationships include both support and contradiction, or whose human state is `CONFLICTING_EVIDENCE` or `DISPUTED`.
3. A revision is content-hashed (SHA-256 over its canonical JSON representation). Approval is a separate append-only row referencing the revision id, operator, timestamp, note, and the approved content hash. Only one approval exists per revision. A new revision is unapproved until explicitly approved; the record's publication-ready status is derived from the current revision's approval.
4. The local HTML preview is always available and is labeled as a draft or approved record. Downloadable HTML and JSON-LD are produced only from an approved current revision. The export generator:
   - builds both visible content and JSON-LD from one structured view;
   - escapes all user content in HTML and escapes `<` in the JSON-LD script payload to prevent script breakout;
   - checks that the JSON-LD title, description, project name, contributor names, and dates appear in the visible content; refuses to emit if the consistency check fails;
   - includes the evidence states, self-declared labels, unresolved contradictions, and a statement that the record is owner-supplied and not independently verified.
5. No route writes a file to a website, fetches a URL, submits a sitemap, or publishes. Download is a local browser action and is audited. Publication is a future milestone requiring a new ADR, destination control, rollback, and correction workflow.
6. Project counts and project export include achievement records. Project deletion cascades them. Audit events are written in the same transaction as revision and approval rows.
7. The JSON-LD uses schema.org `CreativeWork` with name/headline, description, dates, project `about`, contributors represented as roles, and evidence links. It does not claim `sameAs` verification, independent corroboration, or a published URL.

## Alternatives considered

1. **Store the record as one JSON blob with no revision table.** Rejected: revision history, approval binding, and per-claim/contributor validation would be opaque and hard to test.
2. **Render live from the current project and claims.** Rejected: a later claim edit would change a historical achievement record, violating reproducibility.
3. **Publish the page directly.** Rejected for v0.2: no destination control, rollback, or owner approval workflow exists; publication is explicitly outside the milestone.
4. **Let the operator mark a contributor as "verified".** Rejected: identity and contribution verification are separate future capabilities; the record may state self-declared or evidence-linked, not verified.
5. **Generate JSON-LD without a visible-content check.** Rejected: FR-013 requires consistency, and structured data that does not match visible content is a trust defect.

## Consequences and trade-offs

- Achievement content is duplicated in revisions and snapshots. This is the price of an auditable revision history.
- A new revision must be re-approved; approval never carries forward silently.
- The first version supports one record per project with multiple revisions; multiple simultaneous achievement records per project are not prohibited by the schema, but the UI may start with a list. The schema leaves room for more than one.
- Contributor roles are a controlled vocabulary; teams can be represented, and sole credit is an explicit role/statement rather than an inference.
- The export cannot guarantee how a search engine or AI system treats the file. The record says so.

## Tests and validation required

- Creating a revision writes immutable child rows and an audit event in one transaction; a forced audit failure rolls back all rows.
- Editing creates a new revision; the previous revision and its approval remain unchanged.
- A claim snapshot does not change after the source claim receives a new revision.
- Unresolved support+contradiction is present in the preview and export; a resolved/absent contradiction is not invented.
- Approval requires an explicit confirmation, binds to the revision hash, rejects a mismatched hash, and cannot be duplicated.
- HTML export escapes titles, summaries, contributor names, roles, and evidence notes; JSON-LD cannot break out of its script element.
- The consistency validator rejects a generated document whose visible title/name/date does not match the JSON-LD.
- An unapproved revision cannot be exported as publication-ready; the preview remains available.
- Cross-project claim, source, or evidence ids are rejected.
- Project export and deletion include achievement records.
