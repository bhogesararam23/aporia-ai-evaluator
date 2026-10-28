# ADR-002: Use a Claim–Evidence Provenance Model

- Status: Accepted for initial baseline
- Date: 2026-10-28
- Related: ADR-003, ADR-006

## Context

Aporia must explain why it classifies a claim as supported, contradicted, partially supported, or unresolved. Storing only a final answer or score makes it impossible to distinguish source quality, source conflicts, retrieval errors, and evaluator mistakes. Achievements often involve several propositions with different evidence requirements.

## Decision

Represent claims as versioned records decomposed into atomic propositions. Store source records, retrieved evidence items, typed evidence-to-proposition relationships, provider observations, citations, assessments, and reports as distinct entities. Preserve provenance, retrieval time, source locator, evaluator version, review history, and uncertainty. Support and contradiction may coexist. New evidence or corrections create new versions instead of silently rewriting the basis of prior reports.

## Alternatives considered

- One free-text summary and a scalar confidence: rejected because it loses traceability and partial truth.
- A pure knowledge graph with no source snapshots: rejected because source changes would make past conclusions hard to reconstruct.
- Model-generated narrative as the only evidence record: rejected because it conflates reasoning output with source observation.

## Consequences

This increases schema and storage complexity but makes reports auditable, corrections manageable, and benchmark tests possible. Evidence capture must obey source terms, privacy, retention, and copyright constraints. A URL is a source locator, not proof of truth or independence.

## Validation

Tests must verify that every material assessment links to exact proposition and source records, contradictions are retained, duplicates do not inflate corroboration, and provider errors cannot generate factual verdicts.
