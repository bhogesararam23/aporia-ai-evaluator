# Claim and Attribution Trust Model

## 1. Purpose

Aporia deals with claims about what exists, what was achieved, who did it, and whether AI systems describe it accurately. These are related but distinct judgments. The trust model prevents a strong result on one dimension from being misrepresented as proof of another.

## 2. Trust dimensions

1. **Existence:** Is there evidence that the project, artifact, publication, or event exists?
2. **Capability:** Does the evidence establish that the claimed capability is implemented?
3. **Performance:** Does evidence support the claimed result under specified conditions?
4. **Reproducibility:** Can the result be independently repeated under comparable conditions?
5. **Identity:** Is a profile or account connected to the named person or organization by the stated verification method?
6. **Authorship/contribution:** What role did each person or organization play?
7. **Independent corroboration:** Is evidence confirmed by sources not dependent on the claim-maker?
8. **Discoverability:** Can a specified system find or retrieve the evidence?
9. **AI answer fidelity:** Did a response accurately state the claim?
10. **Attribution fidelity:** Did it identify the right person and role and point to the right source?

Never use one dimension as a proxy for all the others.

## 3. Evidence provenance

For each material source, preserve:
- source URL and canonical form;
- source type, author/publisher, and date when available;
- access route and retrieval timestamp;
- relevant excerpt or artifact locator;
- whether the source was supplied by the user or independently found;
- source's directness to the claim;
- likely conflicts of interest;
- relationship to other sources, including syndication or common origin;
- content hash or immutable snapshot pointer where lawful;
- parser/retrieval limitations.

Aporia must be able to reconstruct why a verdict was reached from the source records available at that time. Dynamic sources may change; clearly mark when only a current version is available.

## 4. Source quality

Source quality is contextual, not a universal fixed rank. Evaluate directness, expertise, provenance, integrity, independence, recency, methodological transparency, reproducibility, and conflicts of interest. A primary source may be authoritative about what its author published but not independent confirmation that the reported result is correct. A repository proves artifacts are published, not automatically that every claim in its README is true.

## 5. Evidence and verdict labels

Use the controlled claim-status labels described in Evaluator Methodology. Every report must state:
- proposition being assessed;
- evidence set and cutoff date;
- support/contradiction relationships;
- unresolved gaps;
- whether a human reviewed the result;
- criteria and evaluator version.

Do not call a person, company, or project “verified” without specifying what property was verified and what did not get verified. Example: “account control was verified using provider X on date Y” is narrower and more honest than “the creator is verified.”

### 5.1 Recorded relationships are not independent verification

Every evidence relation and source-independence value is entered by a human reviewer. Aporia does
not retrieve the source, authenticate the reviewer, verify the source's independence, or score its
credibility. The interface therefore says **recorded** where the record is the basis:

- `CONTRADICTED` is displayed as "Contradiction recorded". It means a reviewer recorded at least one
  contradictory relationship and no supporting relationship; it is not an Aporia finding that the
  proposition is false.
- `SUPPORTED_WITHIN_SCOPE` is displayed as "Support recorded within scope". It summarizes recorded
  supporting relationships within the stated scope; it is not independent corroboration or proof.
- `CONFLICTING_EVIDENCE` is displayed as "Conflicting evidence recorded" and remains unresolved unless
  a human assessment adjudicates it.
- A source marked `INDEPENDENT` is displayed as "Recorded as independent": the reviewer recorded that
  judgment. Aporia did not verify the relationship or the source's credibility. `UNKNOWN` is not
  independent, and neither value is a negative finding about the source.

The derived rule emits a standing caveat with every status. Human proposition assessments remain
separate and are labeled by reviewer and method. No credibility score, source rank, or
"independently verified" badge exists. A primary source may be authoritative about what it published
without independently confirming the truth of that content.

## 6. Identity and authorship

Aporia should distinguish:
- identity verification;
- domain/account control;
- repository control;
- listed author/maintainer status;
- contribution evidenced by commits or artifacts;
- role asserted by the subject;
- role corroborated by an independent source;
- legal ownership or intellectual-property status, which may require evidence beyond online metadata.

Do not infer sole authorship from an account owning a repository. Do not assign an accomplishment to one person where the evidence indicates a team. Support explicit roles such as principal investigator, co-author, maintainer, contributor, implementer, funder, organization, and project lead. Roles can overlap and may change over time.

## 7. Achievement page statuses

Recommended statuses:
- **Draft:** not public and not reviewed.
- **Owner-published:** publicly published by or with authorization from the named owner.
- **Evidence-reviewed:** listed evidence has been inspected against the stated propositions.
- **Corroborated for specified claims:** independent evidence materially supports named propositions.
- **Disputed:** a material challenge remains unresolved.
- **Corrected/superseded:** new evidence or correction changes the record.
- **Withdrawn:** owner or governance process withdrew the record.
- **Unavailable:** the record cannot currently be reached or assessed.

Status labels must never imply a broader guarantee than the underlying review. An owner-published page is not independently verified.

## 8. Attribution in AI responses

For each target answer, assess:
- Did it identify the right project/entity?
- Did it identify the correct person or organization?
- Did it characterize the person's role correctly?
- Does the cited source actually support the attribution?
- Is sole credit incorrectly implied?
- Is there ambiguity or a namesake risk?
- Did the answer distinguish creator, maintainer, publisher, funder, and contributor?

A correct answer may cite a secondary source rather than the target-owned page. Record that separately. Do not manipulate results by counting any mention of the person's name as correct attribution.

## 9. Correction and dispute handling

Every public record requires an accessible correction/dispute mechanism. A complaint creates a review event with submission time, scope, supporting sources, and status. Do not automatically accept the most recent complainant's statement as truth. For disputed attribution:
1. identify the exact statement being challenged;
2. freeze and preserve the prior record state as allowed;
3. request relevant primary and corroborating evidence;
4. avoid exposing private contact or sensitive information;
5. temporarily label the claim disputed when material uncertainty exists;
6. adjudicate under published rules;
7. publish the outcome and rationale proportionate to the original claim;
8. correct downstream pages or caches under Aporia's control and notify relevant parties where appropriate.

## 10. Appeals and human review

Users may appeal a verdict by providing evidence or showing that the evaluator misunderstood scope. Appeals must be reviewed by someone other than the original automated evaluation when practicable for consequential matters. Record conflicts of interest and recusal. Maintain audit logs of state transitions.

## 11. Trust anti-patterns

Prohibited patterns include fabricated citations; self-generated “independent” confirmation; mass duplicate pages to simulate corroboration; fake awards or credentials; false “first ever” claims; undisclosed paid endorsements; hiding material failures; misleading authorship; and treating structured metadata as evidence. Aporia must not generate such material as an optimization tactic.

## 12. Limits

No evidence system can conclusively verify every claim from public sources. Aporia's conclusions apply to the bounded proposition and evidence available as of a stated time. Legal ownership, identity, scientific validity, safety, and real-world performance may require expert, institutional, or independent testing beyond what Aporia can perform.
