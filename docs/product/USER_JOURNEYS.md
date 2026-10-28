# User Journeys and Interaction Requirements

## Journey A — Document and publish an achievement

**Goal:** Make a real accomplishment easier to inspect and attribute.

1. User selects “Create achievement record.”
2. User enters a concise claim, project URL, creator or organization, and intended use.
3. User adds optional primary evidence: repository, release, publication, test log, demonstration, benchmark, or official announcement.
4. Claim decomposition produces atomic propositions and flags terms needing definition, such as “first,” “working,” “state of the art,” “autonomous,” or “successfully.”
5. Source collection retrieves permitted public material and records each source's origin and retrieval time.
6. Evidence assessment marks propositions supported, partially supported, contradicted, or unresolved. Each label links to evidence.
7. User reviews identity and contribution roles. Team accomplishments support multiple contributors and explicit roles.
8. Aporia generates a draft public page, structured-data candidate, canonical URL guidance, and integration instructions.
9. The user reviews visible content and metadata and explicitly approves publication.
10. Aporia checks page reachability and structured-data consistency after publication where authorized.
11. Provider discovery checks are recorded as not checked, attempted, observed, not observed, or unknown—never as a universal cache status.
12. Later AI tests measure recognition and attribution under documented query conditions.

**Failure paths:** If destination control cannot be established, provide an export package instead of writing. If evidence is weak, label the page as a claim, not independently verified. If authorship is disputed, suspend any verification label and show the dispute status.

## Journey B — AI says an achievement is impossible or has never been done

**Goal:** Separate factual error from uncertainty, retrieval failure, ambiguity, and policy refusal.

1. User pastes the exact prompt and response, optionally naming provider and date.
2. User states the disputed proposition and supplies evidence.
3. Aporia records the response as an observation, not proof.
4. The system decomposes the denial. “I cannot help with X” is classified separately from “X is impossible” and “X has not been demonstrated.”
5. Evidence collection searches for supporting and opposing material, prioritizing primary sources and independent corroboration.
6. The report identifies what each artifact establishes. Code may show an implementation exists but not prove deployment or general performance; a demo may show one run but not reproducibility.
7. The verdict states the best-supported conclusion, uncertainty, source conflicts, and whether the prior answer exceeded the evidence.
8. User can create a new versioned test to check whether the updated evidence page is discoverable.
9. Retests are compared only under recorded conditions.

## Journey C — Audit a website for AI discoverability

1. User enters a public URL and confirms authorization for deeper crawling or provider integrations.
2. Aporia safely fetches the page, applies SSRF defenses, and respects access controls and publisher preferences.
3. Audit checks status, accessible content, robots directives, meta robots, canonical URL, sitemap, internal links, link health, structured data, author/entity clarity, date/version clarity, and evidence links.
4. Each finding includes observed fact, affected URL, severity, rationale, confidence, and suggested fix.
5. Findings distinguish “prevents access,” “may impair discovery,” “improves clarity,” and “no direct provider guarantee.”
6. User applies selected changes; Aporia reruns checks and records differences.
7. Provider indexing/citation outcomes are tested only through supported integrations or observable evidence.

## Journey D — Evaluate AI recognition and citation

1. User selects entity, claims, relevant tasks, language/region, providers, and run budget.
2. Aporia generates a versioned query set containing both non-branded discovery questions and entity-specific questions.
3. The user reviews the queries and confirms the expected outcome before the test.
4. Aporia executes each supported adapter and records configuration and errors.
5. Output evaluation separately judges mention, statement fidelity, target-source citation, any-source citation, and attribution.
6. Uncertain or high-impact outputs can be routed for human review.
7. The report shows numerator, denominator, excluded tests, coverage, and uncertainty.
8. User exports the report and may schedule a retest.

## Journey E — Correct or dispute an Aporia result

1. Every material finding has a correction/dispute path.
2. User supplies further evidence or identifies a misclassification.
3. Aporia preserves the original record and creates a review event rather than silently rewriting history.
4. The review process assesses the new evidence.
5. Updated state records reviewer, timestamp, rationale, and links to the prior result.
6. Material changes create a new report version; prior reports remain identifiable as superseded.

## UX requirements

- Distinguish user-supplied and independently discovered evidence.
- Expose tested system, date, query, settings, and denominator.
- Do not make a colored badge the only explanation of a consequential verdict.
- Show raw evidence and outputs whenever permitted.
- Require human approval before publishing or changing public achievement pages.
- Provide an explicit “unknown / unable to test” state.
- Explain why evidence is insufficient instead of displaying only a label.
