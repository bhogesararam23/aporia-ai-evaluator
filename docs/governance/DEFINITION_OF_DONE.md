# Definition of Done

Completion means the requested outcome is implemented, validated, documented, and safe within its stated scope. A commit alone does not establish completion.

## Documentation changes

- Scope and intended audience are clear.
- Statements distinguish fact, requirement, assumption, hypothesis, and future work.
- Relative links and ADR links are checked.
- Terms are consistent with the glossary.
- No unsupported provider guarantees or fake validation claims are present.
- Security, privacy, safety, evaluator validity, and operational implications are considered.
- The relevant session report is complete.
- The current status is explicit: proposed, implemented, validated, or blocked.

## Application code changes

- Acceptance criteria are mapped to code/tests.
- Unit tests cover domain logic and edge cases.
- Integration tests cover external boundaries where practical.
- Formatting, lint, type checks, and build checks pass or their failure is recorded.
- Errors/timeouts/cancellation are handled explicitly.
- Secrets and private data are not exposed.
- API and data-model compatibility is considered.
- Logs and metrics support diagnosis without leaking data.
- Documentation and examples match actual behavior.

## Evaluator changes

- Methodology and metric versions are updated when needed.
- Gold/holdout regression cases are included.
- Results distinguish evidence status, visibility, answer fidelity, and attribution.
- Numerator, denominator, exclusions, and unavailable states are tested.
- Confidence/probability language is justified by validation.
- Human review and appeal paths are preserved for consequential outputs.
- Existing reports remain interpretable through version references.

## Provider adapter changes

- Official/source documentation is inspected and linked.
- Supported operation and model/tool identifiers are recorded.
- Request/response fixtures and failure cases are tested.
- Rate limits, retries, budgets, citations, data retention and terms are documented.
- Provider outage does not become a negative evaluator judgment.
- “Last verified” date and known limitations are recorded.

## Website publication changes

- Preview works.
- Owner approval is required for publish/update/delete.
- Structured data matches visible text.
- Canonical URL and sitemap are validated.
- Crawl safety and publisher preferences are respected.
- Rollback and corrections are possible.
- No guarantee of provider caching/indexing/citation is implied.

## Agent session completion

- A session report exists and names paths changed.
- Tests and checks are accurately reported, including not-run items.
- ADRs are indexed sequentially.
- Commit SHA and push status are correct.
- Next steps and owner decisions are listed.

## Work-item and release discipline

- Acceptance criteria link to evidence, tests, or a recorded owner decision.
- Status accurately reflects whether work is proposed, implemented, validated, accepted, or released.
- Applicable [Quality Gates](QUALITY_GATES.md) ran; not-run checks and reasons are recorded.
- Risks, dependencies, migration/compatibility, observability, rollback, and follow-up are addressed proportionately.
- The session/release record names the exact revision and does not claim unverified repository settings or production controls.
