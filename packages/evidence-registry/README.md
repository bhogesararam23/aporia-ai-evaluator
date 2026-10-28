# Evidence Registry

**Status: Implemented for local v0.1 in `src/persistence`.**

SQLite persistence and repositories store project-owned sources, evidence excerpts, typed relationships, claims/revisions/propositions, assessments, query sets, runs, observations, citations, local HTML snapshots, reports, and audit events.

Implemented controls include:

- forward-only, checksummed migrations and foreign keys;
- project-scoped repository access;
- append-only revisions, evidence/source rows, assessments, audits, and report snapshots;
- one-way supersession for evidence relationships and runs/reports;
- only one active evidence relationship per evidence/proposition pair;
- approved query-set and finalized-run immutability;
- project deletion cascade and local export;
- no plan, invoice, subscription, or commercial state in evaluator records.

Source URLs are locators, not proof of truth or independence. User-supplied and self-published sources are distinguished from independent sources; duplicates do not create corroboration. See [Local schema](../../docs/technical/LOCAL_SCHEMA.md) and [Known limitations](../../docs/KNOWN_LIMITATIONS.md).
