# ADR-017: Use Validated Local Backup Directories and Guarded Restore

- Status: Proposed
- Date: 2026-10-30
- Decision owners: Project owner (implementation delegated; owner review pending)
- Related: ADR-012, ADR-013

## Context

The v0.1 runbook says to stop the server and copy the SQLite file and sidecars. That is not a workflow: it has no manifest, no integrity check, no schema check, no record-count verification, and no protection against restoring the wrong file over live data. The database contains claims, sources, evidence, assessments, query sets, observations, reports, and audit history; a partial or mismatched restore can silently destroy or misrepresent them. The milestone requires a documented, tested backup and restore for real records, with validation before restore, prevention of partial restores, protection of existing data, and verification of restored counts and report consistency.

## Decision

1. A backup is a local directory containing:
   - `aporia.db`, produced by SQLite `VACUUM INTO` so it is a consistent single-file snapshot even when WAL is in use;
   - `manifest.json` with a backup-format version, application version, creation time, source database path (for provenance), database SHA-256, byte length, last applied migration name/version, expected table names, and exact row counts for every application table;
   - a short human-readable `README.txt` stating what the backup contains and that it is unencrypted local data.
2. Backup creation validates the produced file before writing the manifest: it reopens the backup read-only, runs `PRAGMA integrity_check` and `foreign_key_check`, checks the migration set, counts every application table, parses every stored report snapshot, and verifies that report numbers are unique and sequential per project. It refuses to write a manifest for a failed validation; the invalid directory is left with a `.failed` suffix or removed so it cannot be mistaken for a valid backup.
3. Restore is an offline CLI operation; the server must be stopped. It validates the manifest hash, format version, integrity, foreign keys, migration compatibility, table schema, and row counts before touching the destination. Any missing table, extra row-count mismatch, unreadable snapshot, or hash mismatch aborts with no destination change.
4. The restore command refuses to overwrite a database that contains projects unless the operator passes an explicit `--replace` flag and types the exact backup directory name (or backup id) as confirmation. It always writes a pre-restore safety backup of the existing database before replacing it, and prints that path. Replacing is a single-file atomic rename after the validated file has been copied to a temporary file in the destination directory and synced; the old WAL/SHM sidecars are removed only after the rename. On any failure, the safety backup is restored and the failure is reported.
5. After restore, the command reopens the destination, runs the same validation, and prints the restored table counts, migration version, and report consistency result. It exits non-zero if any verification differs from the manifest.
6. No cloud, remote, encryption, or scheduled backup is introduced. Backups live under the configured data directory by default but can be written to a user-named local directory; the user is responsible for protecting them. A backup may contain sensitive content and is subject to the same local access controls as the database.
7. The workflow is exposed as documented npm scripts (`npm run backup`, `npm run restore`) with help text. The app itself does not restore a database through an HTTP request.

## Alternatives considered

1. **Copy `aporia.db`, `-wal`, and `-shm` while the server runs.** Rejected: a live copy can be inconsistent, and the sidecar set is easy to miss.
2. **Restore through a web form.** Rejected: replacing the live database while the server holds it open is unsafe and creates a remote data-destruction surface. Offline CLI is the honest boundary.
3. **A single archive file with no manifest.** Rejected: no schema or count check, and no way to detect a truncated or wrong-version file.
4. **Restore without an automatic safety backup.** Rejected: an incorrect but validated-looking file could destroy the only copy.
5. **Encrypt backups in this milestone.** Deferred: no key management exists, and a fake encryption claim would be worse than none. The limitation is documented.

## Consequences and trade-offs

- Backups duplicate the whole database and can be large; acceptable for a local single-operator app.
- Restore requires downtime; that is the safe boundary.
- The manifest is not tamper-proof against an attacker who rewrites both the database and manifest. The check detects corruption and accidental mismatch, not malicious replacement. Backups must be stored where an attacker cannot modify both.
- A backup from a newer schema is refused rather than silently migrated; a backup from an older schema is restored only if the migration runner can validate and apply the known forward migrations. The first version refuses an applied-migration mismatch and documents the upgrade path.

## Tests and validation required

- A backup of a populated database contains a consistent snapshot, a manifest with the correct hash and counts, and a report that parses under the stored snapshot schema.
- Backup validation fails for a corrupted database, a missing table, an unexpected count, a hash mismatch, and an unreadable report snapshot; no valid manifest is produced.
- Restore refuses to overwrite a non-empty destination without both explicit flags; the destination is unchanged.
- A forced failure during replace (simulated copy/rename failure) restores the safety backup and leaves the original data readable.
- A successful restore reproduces every table count, the migration version, and report consistency; a deliberately mismatched manifest aborts before replacement.
- The CLI accepts a backup directory and a destination data directory, never contacts the network, and exits non-zero on every refusal with a reason.
- The runbook explains stop-server, backup, restore, verification, and the unencrypted-backup limitation.
