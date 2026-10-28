# Website Discoverability and Integration Specification

## 1. Purpose and limits

Aporia helps owners present their achievements clearly and makes ordinary technical discoverability problems easier to diagnose. It cannot command an external AI provider to crawl, index, cache, memorize, rank, recommend, or cite a page. Providers control their own search and retrieval systems.

Use precise status language:
- page reachable by Aporia's fetcher;
- crawler allowed/blocked/unknown for a named user agent;
- sitemap found/submitted/unknown;
- indexing signal observed/not observed/unknown using a stated method;
- citation observed in a specified test;
- attribution correct/incorrect/uncertain in a specified test.

Never display “cached by all AI” or “guaranteed to be cited.”

## 2. Website audit checks

For each URL, check as applicable:
- DNS resolution and safe HTTP/HTTPS access;
- status code, redirect chain, and content type;
- title, canonical URL, meta robots, and robots.txt rules for named user agents;
- accessible main text and whether meaningful content requires unsupported client-side rendering;
- sitemap discovery and whether the URL is included;
- internal links from relevant, crawlable pages;
- broken outgoing evidence URLs;
- publication/update dates and version information;
- clear entity name, author, organization, project, and role;
- structured data validity and consistency with visible text;
- duplicate or near-duplicate pages;
- authentication, firewall, CDN challenge, rate limit, or access restrictions;
- mobile/accessibility issues where relevant to meaningful content access.

Classify findings as blocking, likely discoverability issue, evidence/clarity issue, housekeeping, or informational. Explain the actual observation rather than implying every issue directly changes AI behavior.

## 3. Achievement page content

A useful page is a human-readable evidence page, not a machine-only SEO document. It should include:
- descriptive title and stable URL;
- creator(s), organization and contribution roles;
- concise statement of the accomplishment and scope;
- dates, release/version identifiers and conditions;
- primary evidence links;
- relevant methods, benchmarks, caveats, and limitations;
- related project/paper/repository links;
- correction/contact mechanism;
- last-reviewed date and record status.

Avoid vague superlatives, unsupported “first ever” claims, and content written solely to manipulate models. Do not hide substantive information in images or script-only interfaces.

## 4. Structured data

Aporia may generate Schema.org JSON-LD candidates appropriate to visible content, such as Person, Organization, ProfilePage, Article, SoftwareApplication, or other relevant types when they accurately describe the page. Schema.org is a vocabulary, not a truth authority. Use only properties whose meaning is understood and supported by page content. The public page and structured data must agree.

Structured data helps express entities and relationships in a machine-readable way. It does not guarantee indexing, ranking, rich results, AI retrieval, or citations. Provider guidance and eligibility rules differ; do not write provider-specific hacks into the core schema generator.

## 5. Sitemaps and canonical links

Provide a valid sitemap entry for stable public achievement URLs where appropriate. Canonical links should identify the preferred version of substantially duplicate pages; they must not point unrelated pages to a single URL. Sitemaps advertise URLs for discovery but do not guarantee crawl or index. Aporia must not submit to a provider unless the owner has authorized the relevant integration and credentials.

## 6. robots.txt and crawler preferences

Audit the named user-agent rules and explain the scope. Different user agents can have different purposes, and allowing a search crawler is not the same as allowing a training crawler. Respect publisher preferences and applicable provider documentation. Do not automatically modify robots.txt; show proposed changes and their trade-offs, and require owner approval.

## 7. Integration methods

### Copy/paste package
Generate page copy, JSON-LD, sitemap instructions, metadata, and internal-link suggestions. Include a pre-publication validation report.

### CMS plugin
A future plugin may create/update achievement pages, metadata, and sitemaps, but must use least privilege, preview mode, rollback, compatibility tests, and explicit per-record approval. It must not overwrite arbitrary content.

### API/SDK
A future API may accept a schema-validated achievement record and create a draft for a connected website. Require scoped credentials, idempotency, audit events, owner confirmation, and delete/update semantics.

### Git-based integration
For static sites, generate a pull request or patch rather than silently pushing to a protected production branch. The site owner reviews the diff and deploys.

## 8. Discovery and testing workflow

1. Check reachability and relevant robots rules.
2. Confirm the content is public and readable.
3. Validate the canonical URL and internal links.
4. Validate structured-data syntax and visible-content alignment.
5. Ensure owner approval for any modifications.
6. Submit sitemap or recrawl request only through supported methods and with authorization.
7. Wait for provider-reported evidence or run a later, recorded query test; do not invent an immediate indexing status.
8. Re-run visibility tests and compare same-version queries.
9. Report observed effects without asserting causal proof unless the experiment supports it.

## 9. International and Chinese provider support

Keep provider discovery adapters independent. For each Chinese ecosystem, investigate official crawler/user-agent documentation, webmaster tools, robots/sitemap behavior, API access, region constraints, language handling, and citation visibility. If official documentation is missing or the testing route is inaccessible, show “not verified” rather than guessing. Do not infer that one provider's crawler behavior applies to another.

## 10. Legal, ethical, and technical boundaries

Crawl only public/authorized resources; respect rate limits and terms. Do not bypass logins, paywalls, CAPTCHAs, or restrictions. Consider copyright, source licensing, personal data, and right-to-correct concerns. Use server-side fetch safeguards defined in Security and Privacy. Public achievements should have corrections and dispute mechanisms.
