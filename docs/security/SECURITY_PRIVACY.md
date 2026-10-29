# Security, Privacy, and Data Governance

## 0. Implemented local-core controls (v0.2)

The local core is a single-user, loopback-only application. It is not the target platform described below, and none of the platform controls should be assumed present.

- `APORIA_HOST` accepts only `127.0.0.1` or `::1`; the server refuses other bindings.
- The process makes no outbound network calls, uses no provider credentials, and has no authentication provider, billing, or remote integration.
- State-changing forms require a session CSRF synchronizer token; requests are checked against the configured host and origin. Responses set a restrictive Content-Security-Policy, nosniff, frame denial, and no-referrer headers.
- User content is escaped in server-rendered HTML. Achievement JSON-LD escapes `<` so user text cannot break out of the script element, and only inactive HTTP(S) URLs become links.
- Achievement approval is bound to the SHA-256 content hash of the current immutable revision. Approval and export events are audited; export is refused until the current revision is approved.
- Backup uses a read-only `VACUUM INTO` snapshot plus a manifest of digest, byte length, schema, migration identities, table counts, and report consistency. Restore validates before touching destination data, creates a safety backup, replaces atomically, and rolls back on failure. Backup files are unencrypted and must be protected by OS permissions.
- There is no user authentication. Anyone who can reach the loopback port can act as the operator; stop the application or restrict OS access when that is not acceptable.

Evidence for these controls, and their residual limits, is tracked in [Local Security Test Matrix](LOCAL_SECURITY_TEST_MATRIX.md).

## 1. Security objectives

Protect account access, project boundaries, private uploads, provider credentials, evidence integrity, report confidentiality, and availability. The platform accepts arbitrary URLs and files; both must be treated as attacker-controlled input. Security controls are requirements, not claims of current implementation.

## 2. Threat model

Threat actors may attempt:
- server-side request forgery through a supplied URL;
- access to cloud metadata services, private networks, localhost, or internal admin endpoints;
- malicious or oversized file uploads, parser exploits, decompression bombs, or malware;
- prompt injection in web pages, PDFs, source code, metadata, or images;
- credential theft through logs, exception messages, repositories, or client-side bundles;
- cross-tenant access to projects, reports, uploads, or stored provider responses;
- quota/cost exhaustion through repeated searches or model calls;
- tampering with achievement records or citations;
- unauthorized publication or attribution changes;
- retention of personal/private data beyond the intended purpose.

## 3. URL fetching and SSRF defense

- Allow only supported schemes, normally HTTP and HTTPS.
- Resolve DNS and block private, loopback, link-local, multicast, reserved, and metadata-service addresses for both IPv4 and IPv6.
- Revalidate resolved destinations at connection time to mitigate DNS rebinding.
- Block redirects to prohibited destinations and revalidate every redirect hop.
- Restrict ports, redirects, response sizes, decompressed sizes, and request duration.
- Use isolated egress, no cloud instance credentials, and no access to internal network routes from crawler workers.
- Do not forward end-user cookies, authorization headers, or internal service credentials to fetched sites.
- Record policy-blocked attempts without leaking sensitive network details.

## 4. Upload safety

Validate actual file type rather than filename alone. Apply size limits, archive expansion limits, content scanning where appropriate, isolated parsers, timeouts, and safe document extraction. Treat extracted text as untrusted. Do not execute uploaded code or macros. Avoid server-side rendering of active content. Store files privately by default with tenant-scoped access and short-lived signed URLs when needed.

## 5. Authentication and authorization

Use a mature identity provider or well-reviewed authentication library. Enforce authorization server-side for every project, source, run, report, upload, and export. Do not rely on hidden UI controls. Apply least privilege, secure sessions, CSRF protections where relevant, rate limits, and multifactor authentication for privileged actions where supported. Public achievement pages are the exception only when the owner explicitly publishes them.

## 6. Secrets and provider credentials

Provider keys live in a secret manager or environment injection service, never in client bundles, repository history, logs, or example configuration with real values. Scope keys to least privilege and rotate them after suspected exposure. Redact tokens and request headers in structured logs. Provider credentials supplied by users require secure storage, access limitation, revocation, and deletion.

## 7. Tenant and storage isolation

Every stored object carries a project/tenant ownership boundary. Database queries and object-storage access enforce it. Add tests proving one tenant cannot read another tenant's uploads, source snapshots, run outputs, or exports. Use separate public/private storage paths and strict cache-control headers for private reports. Public pages must never embed private evidence by accident.

## 8. Data minimization and privacy

Collect only fields needed for a stated purpose. Distinguish public-source data, user-uploaded private evidence, personal identity data, raw model responses, provider request metadata, and telemetry. Provide clear retention, export, correction, and deletion policies before public launch. Do not use private user evidence to improve another user's result or train a model without valid legal basis, explicit notice, and required permission.

## 9. Retention and deletion

Set explicit retention periods by data class. Provide account/project deletion and evidence removal workflows. Deletion should propagate to object storage, search indexes under Aporia's control, derived caches, and backups according to documented backup expiry. Where minimal audit records must be retained for legal or abuse-prevention reasons, document the rationale, scope, and expiration. Do not promise deletion from external providers that Aporia does not control.

## 10. Content integrity

Store immutable run references and content hashes where useful. If source content changes, create a new version. Record when a source was fetched and whether the report relies on current content or a captured snapshot. Prevent public-page updates from silently altering the evidence for a prior report.

## 11. Logging and incident response

Log job IDs, stage statuses, timings, provider identifiers, quota usage, and reason codes. Avoid logging entire uploads, raw private documents, credentials, or unnecessary personal data. Define escalation, containment, notification assessment, remediation, and post-incident review before production. Keep an auditable timeline without exposing secrets.

## 12. Secure development requirements

- Dependency and secret scanning in CI.
- Lockfiles and pinned supported runtime ranges.
- Unit and integration tests for access control and SSRF guardrails.
- Static analysis and type checking where supported.
- Explicit timeouts and maximum response/body sizes.
- Security review for new providers, file parsers, publishing integrations, and outbound network paths.
- No feature marked security-complete without tests or documented evidence.

## 13. Compliance caution

This document is not legal advice and does not establish compliance with any law or standard. Before launch, assess applicable privacy, consumer protection, copyright, database rights, data-transfer, and breach-notification obligations for each operating region and data category.
