# Product Governance and Business–Evaluator Boundaries

- Status: Initial governance baseline
- Purpose: Keep commercial, growth, account, and packaging decisions from contaminating factual evaluation.

## 1. Current project stage

Aporia is currently a product/evaluator concept and documentation baseline. No commercial model, billing behavior, customer contract, service-level agreement, or production compliance claim is established here. Future pricing or go-to-market planning requires separate decisions and must not be represented as implemented capability.

## 2. Core product promise

Permitted promise: “Aporia helps document claims and achievements with inspectable evidence, audits discoverability, and measures whether supported AI systems recognize and correctly attribute them under defined test conditions.”

Do not promise without direct, independently verifiable provider evidence:
- Aporia gets a site cached by every AI system.
- Aporia guarantees ChatGPT, Gemini, or Chinese AI systems will cite a page.
- Aporia proves a claim true because an AI score is high.
- Aporia makes models memorize a page.
- Aporia automatically verifies every accomplishment.
- Aporia guarantees rankings, reputation, or first-place recommendation.

External performance statements require a measurement protocol, denominator, date range, sample description, and limitations.

## 3. Separation of domains

Future repository code MUST enforce these boundaries:

- **Evaluator domain:** claim decomposition, evidence relationships, source provenance, verdict taxonomy, metric definitions, query sets, evaluation runs, uncertainty, and adjudication.
- **Provider integration domain:** provider clients, normalized request/response mapping, tool capabilities, rates, retries, citation formats, and provider-specific crawl/check interfaces.
- **Application domain:** HTTP endpoints, orchestration, persistence, authentication, user projects, and report delivery.
- **Website publishing domain:** metadata generation, sitemap/canonical guidance, CMS adapters, and preview/approval workflow.
- **Commercial domain (optional future):** subscription plans, billing, invoices, sales, entitlements, quotas, usage charging, and customer lifecycle.
- **Governance domain:** policies, retention rules, human review, compliance registers, and audit logs.

Commercial rules may limit resource consumption or access to a workflow, but MUST NOT change factual verdicts, silently change metric formulas, hide adverse results, or adjust credibility based on payment tier.

## 4. Allowed and forbidden influence

Commercial/application code MAY gate expensive jobs before execution; limit run volume, storage, or concurrency under a disclosed plan; provide collaboration/export features; and collect usage for cost transparency.

It MUST NOT raise or lower claim-support verdicts based on subscription status, mark paid achievements verified without the same standards, silently change query selection to improve visibility, suppress contrary evidence or provider errors, sell citations, or use private customer evidence for another customer's report without explicit permission and valid legal basis.

## 5. Achievement registry governance

A public achievement page has a clear owner, stable URL, provenance, timestamp, correction route, and status. Statuses distinguish draft, owner-published, evidence-reviewed, corroborated for specified propositions, disputed, corrected/superseded, and withdrawn.

“Verified” cannot be a free-floating property for a person. Verification must identify exactly what was checked and the limits.

## 6. Human authority and disputes

The project owner approves product decisions and releases. Agents may propose changes but must not approve their own high-impact policy changes. Disputed authorship, identity, or public claims need a review path. Material changes to evaluator policy or scoring require an ADR, benchmark impact assessment, and human approval.

## 7. Roadmap governance

Prioritize work by user value, evidence reliability, observable outcomes, provider/legal constraints, implementation risk, and operating cost. Do not prioritize a provider merely because it is popular; its access method, stable identifiers, citation metadata, limits, and testability must be established.

## 8. Data boundaries

The initial evaluator core does not need billing or sales data. Future invoices, contracts, and sales notes belong in the commercial/application boundary, not in claim/evidence models. Evaluator jobs should use opaque project references when possible.

## 9. Policy change process

Changes to public claims, pricing promises, verification labels, evidence standards, or provider coverage must be tracked; risk-classified; supported by evidence or research; reviewed against safety, security, and validity; recorded in an ADR if architecture/semantics change; and reflected in docs, tests, and public wording.
