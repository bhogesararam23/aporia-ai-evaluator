# External Reputation and Source Independence

## Purpose

Aporia may need to assess whether public claims about a person, project, or organization are corroborated beyond its own website. This is a research and product specification, not a claim that a reputation-scoring system is implemented.

## Evidence classes

Classify each item before drawing conclusions:

1. **First-party:** subject-controlled website, portfolio, press release, or social account.
2. **Independent primary:** official institution, event organizer, repository maintainer, publisher, or public record with direct knowledge of the claim.
3. **Independent secondary:** editorial coverage, technical analysis, or reporting with identifiable sourcing.
4. **Community/user-generated:** forums, reviews, discussions, and social posts.
5. **Automated/aggregated:** directories, generated profiles, scraped summaries, and search snippets.

Independence is claim-specific. Multiple pages copying one press release are not independent corroboration.

## Evidence record

Store source URL, publisher, publication/update date when available, access timestamp, claim supported, evidence excerpt or locator, source class, independence rationale, confidence/limitations, and correction status. Preserve provenance and minimize retained personal data.

## Research rules

- Verify consequential claims against the closest authoritative source available.
- Separate source credibility, independence, relevance, recency, and direct support; do not collapse them into an opaque score.
- Do not treat search rank, mention count, sentiment, or a model-generated summary as proof.
- Distinguish “no evidence found in this sample” from “the claim is false.”
- Record access failures, stale pages, language/region coverage, and selection bias.
- Provide a correction/dispute route for public claims and keep an auditable change history.
- Respect access restrictions, site terms, privacy, and retention limits.

## Open decisions

Before implementation, decide source taxonomy/versioning, personal-data retention, deduplication rules, minimum evidence for each claim type, confidence calibration, appeal workflow, and whether this is a separate product capability or an optional evaluator input. Record material architecture or scoring decisions in an ADR.
