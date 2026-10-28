# Aporia AI Evaluator

**Evidence-first evaluation for claim verification, AI discoverability, and creator attribution.**

Aporia helps a person or organization document a verifiable accomplishment, publish an accessible record of the work, and measure whether supported AI/search systems discover, describe, and correctly attribute it. It also evaluates cases where AI systems omit an achievement or state that something has not been done when evidence suggests otherwise.

Aporia does **not** promise that any provider will crawl, index, retain, recommend, or cite a page. Provider behavior is outside Aporia's control. Its job is to improve evidence quality and accessibility, test observed outcomes, expose uncertainty, and provide reproducible reports.

## Project status

This repository establishes the initial product, architecture, evaluator, trust, safety, operations, and agent-governance specifications. These documents are a design baseline, not proof that all described features are implemented. Implementation status must be tracked separately in issues, milestones, and release notes.

## Start here

- [Documentation index](docs/README.md)
- [Product requirements](docs/product/PRODUCT_REQUIREMENTS.md)
- [System architecture](docs/technical/SYSTEM_ARCHITECTURE.md)
- [Evaluator methodology](docs/evaluator/EVALUATOR_METHODOLOGY.md)
- [Claim and attribution trust model](docs/trust/CLAIM_AND_ATTRIBUTION_TRUST.md)
- [Safety policy](docs/safety/SAFETY_POLICY.md)
- [Security and privacy](docs/security/SECURITY_PRIVACY.md)
- [Agent operating protocol](docs/agents/AGENT_OPERATING_PROTOCOL.md)
- [ADR index](docs/agents/ADR_INDEX.md)

## Core product loop

1. **Collect:** accept a URL, claim, goal, identity information, and optional source artifacts.
2. **Decompose:** express the claim as bounded propositions that can be evaluated separately.
3. **Establish evidence:** discover sources, assess provenance and quality, and record conflicts and unknowns.
4. **Publish accessibly:** help the owner maintain a canonical, human-readable achievement page and machine-readable metadata on a website they control.
5. **Test:** run versioned queries through explicitly supported provider interfaces and record exact test conditions and outputs.
6. **Report:** separate evidence assessment, discoverability observations, AI answer behavior, and creator attribution.
7. **Improve and retest:** recommend evidence-led changes and compare later runs without implying causation without evidence.

## Architectural boundary

The evaluator core determines what was tested, how evidence maps to claims, and how measurements are calculated. Provider adapters translate external systems into normalized observations. The application layer coordinates workflows and persistence. Future commercial features—accounts, plans, billing, subscriptions, sales, or entitlements—must live outside the evaluator core and must not change factual verdicts or metric definitions. See [ADR-007](docs/agents/adrs/ADR-007-separate-evaluator-core-from-commercial-concerns.md).

## Working principles

- Evidence before conclusions.
- Claim-level, not blanket, verification.
- Attribution is separate from whether an accomplishment occurred.
- An observed measurement is not a universal probability.
- No claim that all AI systems are supported unless each integration is implemented and tested.
- No false certainty about crawling, indexing, model memory, caching, or citations.
- Reproducibility, privacy, user control, and correction paths are first-class requirements.
- Agent sessions end with a durable report; architectural decisions use sequential ADRs.

## Documentation status

The documents describe the intended system and controls. Anything requiring validation against a live provider, legal review, security review, or user research is marked as a requirement, hypothesis, or open question. References link to primary documentation and should be rechecked before implementation or release.

## License and governance

No license is declared by this documentation-only baseline. Before publishing implementation code for external reuse, the project owner should choose and add an explicit license. Contributor and agent work must follow [Contributing](docs/governance/CONTRIBUTING.md), [Definition of Done](docs/governance/DEFINITION_OF_DONE.md), and the [agent operating protocol](docs/agents/AGENT_OPERATING_PROTOCOL.md).
