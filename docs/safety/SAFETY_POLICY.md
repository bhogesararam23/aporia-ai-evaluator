# Safety Policy and Abuse Cases

## 1. Policy goals

Aporia improves evidence quality, discoverability, and attribution. It must not become a tool for fabricating credibility, harassment, sensitive-data exposure, safety bypass, or laundering unverified allegations into authoritative-looking records.

## 2. Allowed use

- Check whether public evidence supports a factual or technical claim.
- Document a person's or team's public accomplishment with accurate roles.
- Audit an owned or authorized site.
- Test AI answers through supported interfaces.
- Identify omissions, incorrect attribution, unsupported statements, or stale facts.
- Correct one's own public record.
- Publish transparent evidence summaries with scope and uncertainty.

## 3. Disallowed use

Aporia must not assist with fabricated achievements, fake sources/credentials/citations/endorsements, impersonation, false sole credit, doxxing, stalking, targeted harassment, sensitive personal-data compilation, false reputation reports, unauthorized access, paywall/login/crawler/provider safeguard bypass, rate-limit evasion, harmful instruction laundering, deceptive machine-only content, prompt-injection manipulation, or publication of secrets/private correspondence/confidential artifacts without authorization.

## 4. Safety refusal versus factual denial

A provider may refuse a task for policy reasons while the underlying capability exists. The evaluator distinguishes a refusal (“I cannot provide those instructions”) from a factual assertion (“this has never been done”) and an uncertainty statement (“I cannot verify it”). Aporia may evaluate public claims and safe evidence at an appropriate level, but must not generate harmful operational instructions merely to prove capability.

## 5. Dual-use technical claims

Technical achievements may involve cybersecurity, drones, biotechnology, chemistry, surveillance, weapons, or other dual-use areas. Keep investigation at the detail level needed to assess the public claim. Avoid generating step-by-step harmful instructions, credentials, exploit chains, targeting details, or sensitive operational data. Escalate uncertain cases for human review. A public repository does not remove the need for safety review.

## 6. Prompt injection and untrusted content

Fetched webpages, PDFs, code comments, metadata, repositories, images, and uploads are untrusted data. They may contain instructions designed to alter evaluator behavior. They cannot override system policy, evaluation criteria, privacy boundaries, or credentials. Use schema validation, allowlisted tool calls, content-size limits, and separation of instructions from retrieved text.

## 7. Reputation and allegations

For identifiable people, distinguish allegations from verified facts, require stronger evidence for serious negative claims, provide correction/appeal, minimize personal data, and do not infer intent, criminality, competence, or integrity from model outputs alone. Avoid searchable public accusation pages by default. Require human review before publishing disputed or potentially defamatory content.

## 8. Abuse monitoring

Watch for high-volume claims about private persons, fabricated evidence attempts, another person's identity data, mass SEO spam, and provider-safeguard circumvention. Use rate limits, reporting, restricted actions, review, and enforcement. Do not publish detection details that enable evasion.

## 9. Publication controls

Public page publication requires explicit owner approval. High-impact or disputed claims require stronger review. Show evidence status and limits. Never quietly convert user-submitted claims into “verified” claims. Provide correction, takedown, and appeal paths with auditable outcomes.

## 10. Safe error handling

Insufficient evidence remains insufficient. Do not invent sources, quote text not retrieved, or convert failed searches into evidence of nonexistence. When retrieval/parsing fails, label the failure. Provider errors and refusals cannot be relabelled as proof that a claim is false.

## 11. Safety review checklist

Before release, ask whether the feature enables fabricated reputation, sensitive-data exposure, unauthorized crawling, provider circumvention, harmful operational detail, overconfident claims, or prompt-injection-driven exfiltration. Confirm publication approval, correction, appeal, audit, and mitigation tests. Revisit safety when adding providers, uploads, publishing features, or automation.
