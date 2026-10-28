# Website-Only Evaluation Scope

## Intended scope

A website-only workflow evaluates what can be observed from an explicitly authorized public website and the configured test systems. It is not a full reputation audit and cannot establish what every AI system knows about a subject.

## In scope

- Public page accessibility and crawl-relevant technical signals within configured limits.
- Page structure, metadata, canonicalization, robots directives, sitemap discovery, and internal linking where observable.
- Whether selected claims are clearly stated and supported by inspectable first-party evidence.
- A declared query set against selected AI/search systems, with run conditions and failures recorded.
- Evidence-linked findings, limitations, and suggested remediation.

## Out of scope unless separately approved and implemented

- Guaranteeing indexing, model training, persistent memory, recommendation, or citation.
- Treating first-party statements as independent verification.
- Inferring reputation or truth from mention volume, search rank, or sentiment alone.
- Crawling private/authenticated areas or bypassing access controls.
- Claiming comprehensive coverage of the web, all languages, all regions, or every provider.
- Publishing personal data or contested claims without appropriate safeguards and correction paths.

## Required disclosure

Show what URLs, query families, providers, and time window were actually tested; what was skipped or unavailable; and which conclusions rely only on first-party sources. Keep technical discoverability distinct from observed AI visibility and answer correctness.

## Decisions required before broad implementation

Define crawl limits and SSRF protections, authorization checks, retention/deletion, provider selection, test costs, report sharing controls, and the boundary between website-only evaluation and external-reputation research. Material boundary changes require an owner decision and, where architectural, an ADR.
