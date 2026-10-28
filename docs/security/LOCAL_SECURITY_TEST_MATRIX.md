# Local Security Control and Test Matrix (v0.1)

- Status: Implemented for the local single-operator scope
- Date: 2026-10-29
- Scope: loopback application with no accounts, remote API, provider credentials, or public publishing
- Not a penetration test, audit, compliance certification, or production security review

| Control | Implementation | Automated evidence | Residual limitation |
|---|---|---|---|
| Loopback binding | `APORIA_HOST` accepts only `127.0.0.1`/`::1`; startup rejects others | `tests/unit/config.test.ts` | No TLS or remote deployment path |
| Host header validation | Parses and compares hostname/port; rejects foreign hosts | `tests/unit/security.test.ts`, `tests/integration/http-app.test.ts` | DNS rebinding beyond Host checks is not a local threat model |
| CSRF | HMAC synchronizer token tied to HttpOnly, SameSite=Strict session cookie; constant-time comparison | `security.test.ts`, `http-app.test.ts`, `http-security.test.ts` | Session secret is process-ephemeral; restart invalidates forms |
| Origin check | Rejects explicit cross-origin; accepts absent/opaque `null` with mandatory CSRF | `security.test.ts` | Opaque origins cannot be compared; token remains the control |
| Security headers | Restrictive CSP, nosniff, frame denial, no-referrer, permissions restrictions, COOP/CORP, noindex | `http-app.test.ts`, `http-security.test.ts` | Not a substitute for an HTTP proxy/TLS deployment review |
| HTML escaping | Auto-escaping template helper; all dynamic values escaped unless built from trusted view fragments | `views.test.ts`, project/claim/report workflow tests | Accessibility/DOM correctness still needs browser review |
| Safe URLs | HTTP(S) only, no embedded credentials; external links use `noopener noreferrer nofollow` | `validation.test.ts`, `views.test.ts`, citation HTTP test | Stored citation content is not fetched or independently verified |
| Request body limits | Overall body cap and bounded URL-encoded/multipart parsing | `body.test.ts`, `http-app.test.ts`, `audit-upload.test.ts` | Local denial-of-service is not fully mitigated |
| Multipart limits | One file, file-size, field, part, and total-byte limits; sanitized basename | `body.test.ts`, `audit-upload.test.ts` | No antivirus/content scanning; parser is third-party |
| HTML upload validation | `.html`/`.htm` extension, UTF-8 validation, NUL rejection, byte cap | `audit-upload.test.ts`, `website.test.ts` | File extension is not proof of safe content; parser is used on untrusted text |
| Raw HTML handling | Uploaded HTML stored as data and never inserted into responses | Audit tests and report renderer | Project export intentionally contains the snapshot; protect exported files |
| SQL safety | Parameterized values; fixed internal table names; no user-controlled paths | Repository/schema tests | No formal database security audit |
| Cross-project scoping | Project ID checks in routes/repositories; cross-project tests | Repository and HTTP tests | Local operator can read the whole database directly |
| No external network | Source scan forbids fetch/provider clients; no APIs/keys | `tests/unit/no-network.test.ts`, `boundaries.test.ts` | A future adapter requires a new network security review |
| URL fetching/SSRF | No URL fetch exists | No-network test and architecture boundary | Local HTML only; no remote audit capability |
| CSV injection | Leading `=`, `+`, `-`, `@`, tab, CR protectively prefixed | `reporting-csv.test.ts` | Spreadsheet behavior varies by application |
| Secret/log hygiene | No secrets required; logger redacts sensitive keys; no request bodies/cookies logged | `logger.test.ts` | Host/OS access can read local data and logs |
| Project deletion | Explicit typed-name confirmation; cascade disclosed | `project-workflows.test.ts`, schema tests | Backup copies/exports are outside control |
| Audit trail | Append-only local events for mutations and exports | Audit/schema and workflow tests | Not tamper-evident against filesystem access; deletion removes events |

## Not tested

- Authentication, authorization, multi-tenancy, roles, tenant isolation, or account recovery.
- Remote network exposure, TLS termination, reverse proxies, WAFs, rate limits, or DDoS.
- Secrets management or provider credentials (none exist).
- Antivirus/malware scanning, PDF or office document parsers (not supported).
- Screen-reader, mobile, Safari, Firefox, macOS, Linux, or load testing.
- Penetration testing, fuzzing, formal threat modeling, or compliance review.

See [Security and Privacy](SECURITY_PRIVACY.md), ADR-012, [Known Limitations](../KNOWN_LIMITATIONS.md), and [Testing](../TESTING.md).
