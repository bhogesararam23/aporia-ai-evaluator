# Local Operations Runbook

- Scope: local core v0.1 on a single operator workstation
- Status: Implemented, not a production operations plan
- Date: 2026-10-29

This runbook covers starting, inspecting, backing up, and removing local data. It does not cover remote hosting, multi-user access, provider credentials, or public publication.

## 1. Start and stop

```bash
npm ci
npm start                 # http://127.0.0.1:4310
npm run dev               # watch mode
```

Stop with `Ctrl+C` in the terminal. The server handles SIGINT/SIGTERM by closing the HTTP listener and the SQLite connection.

Startup performs configuration validation, opens the SQLite database, applies pending checksummed migrations, and binds only to the configured loopback address. A non-loopback host, invalid port, unwritable data directory, changed applied migration, or missing applied migration aborts startup with a configuration/migration message.

## 2. Configuration

Configuration is read from environment variables. `.env` is optional; `npm start`/`npm run dev` load it when present. No secrets are required for local v0.1.

| Variable | Default | Meaning |
|---|---|---|
| `APORIA_HOST` | `127.0.0.1` | Only `127.0.0.1` or `::1`; remote binding is rejected |
| `APORIA_PORT` | `4310` | Local HTTP port, 1–65535 |
| `APORIA_DATA_DIR` | `./data` | Directory containing `aporia.db` and SQLite sidecar files |
| `APORIA_OPERATOR` | `local-operator` | Audit-actor label for local actions |
| `APORIA_MAX_BODY_BYTES` | `2097152` | Overall form/upload request cap |
| `APORIA_MAX_HTML_BYTES` | `1000000` | Pasted/uploaded HTML cap |
| `APORIA_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error` |

Do not put real secrets in `.env`, source, fixtures, data exports, or reports. v0.1 has no provider credentials.

## 3. Data location and backup

The database is a SQLite file in `APORIA_DATA_DIR`:

- `aporia.db`
- `aporia.db-wal` and `aporia.db-shm` while the server is running and WAL mode is active.

**Backup procedure:** stop the server, then copy the database file and any sidecars into a protected local location. Copying while the server is running can produce an inconsistent snapshot unless a proper SQLite-aware backup tool is used. v0.1 does not implement an automated backup.

**Restore procedure:** stop the server, preserve the current data directory, place the backup in the configured data directory, and start the server. Do not edit migration rows or the database schema manually.

Data may contain personal or sensitive material. Backups and exports are subject to the same access controls as the original local data; v0.1 provides only operating-system file permissions.

## 4. Reset, export, and deletion

- **Export** from a project overview: “Export project JSON”. Export actions are recorded as audit events and include claims, sources, evidence, query sets, runs, raw observations, local HTML snapshots, reports, and recent audit events.
- **Delete** from a project overview: type the exact project name on the confirmation page. Deletion cascades through project-owned records, including local audit events. This is disclosed in the UI and runbook. It cannot be undone from within the application.
- **Fresh development instance:** stop the server, move or remove the configured data directory, and restart. This is destructive; use a separate data directory rather than deleting a directory you do not recognize.
- **Reports** are immutable snapshots. To “correct” a report, generate a new one; the previous report is marked superseded and remains available.

## 5. Common failures

| Symptom | Likely cause | Action |
|---|---|---|
| Startup says 403/host error in browser | Host header is not the configured loopback host/port | Use `http://127.0.0.1:<port>` or the configured `::1` address |
| 403 “form token” | Server restarted or the form expired | Reload the page and submit again |
| 403 “form origin” | Explicit cross-origin POST | Submit from the local application page; do not proxy through another origin |
| 413 | Body or upload exceeds configured limits | Reduce the answer/excerpt/HTML or adjust local limits deliberately |
| 422 | Validation issue | Read the server-rendered field errors and correct the input |
| 409 | State conflict or locked record | Reload the page; create a new revision or new run instead of editing frozen data |
| 404 | Wrong project-scoped ID or deleted record | Check the project ID and return to the project overview |
| `SQLITE_EXPERIMENTAL` warning | Node feature warning | Expected in the tested Node 24 release; do not suppress it in logs |
| Port already in use | Another process owns 4310 | Stop that process or set `APORIA_PORT` to a free local port |
| Migration checksum error | An applied SQL file was edited | Restore the original migration and add a new forward migration |
| Missing applied migration | The migration directory does not contain an applied version | Restore the matching migration file from the same revision |

## 6. Logs and incidents

Logs are JSON lines on stdout. They include request ID, method, path, status, duration, and safe error category. They intentionally omit request bodies, raw answers, evidence excerpts, cookies, CSRF tokens, and secrets. Use the request ID from an error page to locate the corresponding completion record.

If local data is exposed or a suspicious export occurred:

1. Stop the server.
2. Preserve logs and the data directory for investigation.
3. Revoke any copied exports or backups under your control.
4. Review audit events for project and export actions.
5. Rebuild the local environment from a trusted backup if integrity is uncertain.

Aporia cannot revoke copies made outside its data directory.

## 7. Upgrade and rollback

- Back up the data directory before upgrading code.
- Apply migrations by starting the new revision; never edit an applied migration.
- There are no down migrations. Rollback means restoring the pre-upgrade database backup and running the earlier code revision.
- Re-run `npm run check` after any dependency or Node upgrade. The `node:sqlite` API is experimental and must be revalidated.
- Report snapshots store method and template versions, so older reports remain interpretable after an evaluator change.

## 8. Verification commands

```bash
npm run check
npm start
curl -s http://127.0.0.1:4310/health
```

`/health` returns a local status JSON without exposing the database path or secrets. The automated suite and manual browser verification are described in [Testing](../TESTING.md).
