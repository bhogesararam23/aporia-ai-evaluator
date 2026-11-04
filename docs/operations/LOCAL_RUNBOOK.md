# Local Operations Runbook

- Scope: local core v0.1–v0.7 on a single operator workstation
- Status: Implemented, not a production operations plan
- Date: 2026-11-05 (v0.7 added §9's provenance and roster rules and §10 for corpus releases and batch recovery)

This runbook covers starting, inspecting, backing up, and removing local data, plus the offline benchmark
review cycle (§9) and corpus releases and interrupted-batch recovery (§10). It does not cover remote hosting,
multi-user access, provider credentials, or public publication.

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

## 3. Data location, backup and restore

The database is a SQLite file in `APORIA_DATA_DIR`:

- `aporia.db`
- `aporia.db-wal` and `aporia.db-shm` while the server is running and WAL mode is active.

### Create a validated backup

```bash
npm run backup -- --data-dir ./data
# or choose the output directory
npm run backup -- --data-dir ./data --output ./protected/backup-2026-10-30
```

`npm run backup` uses SQLite `VACUUM INTO` on a read-only source connection, so the backup is a consistent single file and the source journal is not rewritten. It then reopens the copy and validates `PRAGMA integrity_check`, foreign keys, the applied migration identities, every application table count, report snapshot readability and per-project report numbering, and achievement approval hashes. The manifest records the database SHA-256, byte length, schema version, migration identities, table counts and validation results. A backup directory is written only after those checks pass; a failed attempt is removed. An existing output directory is never overwritten.

Verify a backup at any later point without restoring it:

```bash
npm run backup:verify -- ./protected/backup-2026-10-30
```

The verifier checks the manifest, digest, schema identity, integrity, foreign keys, table counts and report consistency and prints the recorded project, report and achievement counts.

The backup is an unencrypted local directory (`aporia.db`, `manifest.json`, `README.txt`). It can contain claims, evidence, answers and personal data; protect it like the original database. There is no scheduled backup, retention policy, or encryption at rest.

### Restore

**Stop the Aporia server before restoring.** The restore command opens and replaces the database file.

```bash
# Restore into an empty data directory
npm run restore -- ./protected/backup-2026-10-30 --data-dir ./data

# Replace existing data: both flags are required
npm run restore -- ./protected/backup-2026-10-30 --data-dir ./data \
  --replace --confirm backup-2026-10-30
```

Restore validates the manifest digest, byte length, migration identities, integrity, foreign keys, table counts and report consistency before touching the destination. It refuses to overwrite a database that contains projects unless `--replace` is present and `--confirm` exactly matches the backup directory name. Before replacing, it creates a validated safety backup under `<data-dir>/backups/pre-restore-<timestamp>` (or a raw copy when the existing database cannot be read). Replacement uses a synced temporary file and an atomic rename; if replacement or post-restore verification fails, the safety copy is restored and the original failure is reported.

The backup schema must match the running application's migrations exactly. Restoring a backup from a different schema is refused rather than silently migrated. After a successful restore, the command reopens the destination and verifies the manifest counts and report consistency. Start the server and inspect the restored records before relying on them.

Data may contain personal or sensitive material. Backups and exports are subject to the same access controls as the original local data; the application provides only operating-system file permissions.

## 4. Reset, export, and deletion

- **Export** from a project overview: “Export project JSON” (`schemaVersion: project-export-v2`). Export actions are recorded as audit events and include claims, sources, evidence, query sets, runs, raw observations, local HTML snapshots, reports, remediation findings with their status history and recorded retest comparisons, achievement records and their revisions/approvals, and recent audit events. `project-export-v1` predates the remediation workflow and omitted findings and comparisons; v2 adds them without renaming any earlier key.
- **Achievement records** are created and revised from the project's claims and evidence. A revision is a draft until an operator explicitly approves the current revision with a note and the exact title. Approved current revisions can be downloaded as HTML and JSON-LD from the achievement page; the download is audited and is not a publication action.
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

- Back up the data directory before upgrading code with `npm run backup -- --data-dir <dir>`.
- Apply migrations by starting the new revision; never edit an applied migration. Local core v0.4 adds `010_evaluator_integrity.sql` (labels and relationships that contradict a recorded relevance are refused at the database too) and `011_retest_provenance.sql` (the focus metric, both metric versions and the comparison rule version stored beside each comparison, plus the triggers binding a status to it). Both are additive: no earlier column is redefined and no stored row is rewritten.
- There are no down migrations. Rollback means restoring the pre-upgrade database backup and running the earlier code revision. Restore requires the backup schema to match the earlier code's migrations exactly.
- Re-run `npm run check` after any dependency or Node upgrade. The `node:sqlite` API is experimental and must be revalidated.
- Report snapshots store method and template versions, so older reports remain interpretable after an evaluator change.

## 8. Verification commands

```bash
npm run check
npm run verify:workflow   # boots a server on a free loopback port and a fresh temp data directory
npm start
curl -s http://127.0.0.1:4310/health
```

`/health` returns a local status JSON, including the application version, without exposing the database
path or secrets.

`npm run verify:workflow` is the check that the application is usable, not only that its modules are
correct. It drives the whole working sequence through the forms the running server actually served —
project and target entity through claim, proposition, evidence, reviewed conclusion, query set, run,
captured answer, statement decomposition, citation mappings, assessments, corrections and voids,
finalization, reports, the offline benchmark, findings, a retest comparison, exports, and finally
backup, verification, restore and a read-back of the restored records. It exits zero only when every
step passed and none was left unrun; a step it could not complete is reported as unverified with the
page's own refusal message. Run it after any change to a form, a route, a metric, or a lifecycle rule.
It binds a port and writes temporary directories, so it is run locally rather than in CI.

The automated suite and the manual browser verification are described in [Testing](../TESTING.md).

## 9. Benchmark offline human-review workflow

`npm run benchmark:case` runs the whole review cycle over local JSON files — no server, no database, no
network, no clock. It never invents a label, reviewer, timestamp, permission or gold answer. Read
[the rubric](../evaluator/BENCHMARK_ANNOTATION_RUBRIC.md) first. A round looks like this:

```bash
# 1. Freeze a blinded packet + a blank submission template per valid case.
npm run benchmark:case -- packet --corpus ./corpus --out ./packets
#    -> packets/<id>.packet.json (input + subjects only, with a stable packetHash)
#    -> packets/<id>.submission.json (reviewer/timestamp/labels left empty)

# 2. A reviewer fills a submission: their own name, their own finish time, one label + rationale per
#    subject. Nothing is pre-filled; hand it back as JSON.

# 3. Import submissions safely. A stale packetHash, a wrong case, a duplicate reviewer, an unknown
#    subject, an out-of-vocabulary label, a blank rationale, or a reviewer who is not declared in the
#    case's provenance.reviewedBy, is refused. Refused items report every reason.
npm run benchmark:case -- merge --corpus ./corpus --submissions ./returned --out ./corpus-merged --dry-run
npm run benchmark:case -- merge --corpus ./corpus --submissions ./returned --out ./corpus-merged
#    v0.7 default is ATOMIC: one refusal (including one malformed file) writes NOTHING to --out and the
#    command exits non-zero. Add --allow-partial to import the accepted items anyway; it prints each
#    ACCEPTED and REJECTED item. Gold `expected` is never edited, and no reviewer is ever authorised by
#    the tool. A merged label keeps the reviewer's rationale, their timestamp and the packet hash.

# 3b. See who the case declares versus who actually labelled. Read-only; it never edits the roster.
npm run benchmark:case -- roster --corpus ./corpus-merged

# 4. See where reviewers actually agree or split (a split stays UNRESOLVED; nothing is averaged).
npm run benchmark:case -- review --corpus ./corpus-merged

# 5. Where a subject genuinely split, ISSUE the bound form, let a person fill it in, then apply it.
npm run benchmark:case -- adjudicate --corpus ./corpus-merged --issue --out ./adjudications
#    -> <id>.adjudication.json, one entry per unresolved subject, each carrying the disagreementHash it
#    settles; outcome/label/reason/adjudicator/timestamp are left blank because deciding is a human act.
npm run benchmark:case -- adjudicate --corpus ./corpus-merged --adjudications ./adjudications --out ./corpus-final
#    A RESOLVED outcome must name an in-vocabulary label; a GENUINELY_AMBIGUOUS one must carry none. The
#    decision is applied ONLY while its disagreementHash still matches the current split: if reviewers
#    moved after the form was issued, it is refused as stale and the subject stays unresolved.

# 6. Audit corpus readiness and provenance. This reports coverage, authorisation, agreement state, roster
#    gaps and stale/unbound decisions — never accuracy; it always prints accuracyClaimable=false.
npm run benchmark:case -- audit --corpus ./corpus-final
```

Treat `./corpus`, `./packets` and `./returned` with the same care as the database: they may contain
sensitive claims and evidence excerpts and are operator-managed local files. These are workflow *artifact*
versions; the `benchmark-case-v1`/`v2` contract and the report are unchanged, so no corpus migration is
implied. Reviewer names and timestamps are operator-asserted and prove no independent review or
authentication. See [ADR-026](../agents/adrs/ADR-026-benchmark-review-workflow.md).

## 10. Corpus releases and interrupted-batch recovery

A release answers one operational question: **is this the exact corpus my last report was computed from?**

```bash
# Freeze: writes a deterministic manifest of case digests. It refuses a corpus that does not validate.
npm run benchmark:release -- freeze --corpus ./corpus-final --out ./releases/release-one.json
#    add --label "Q4 set" to record a human name for the release; it never changes the release id,
#    which is derived from content alone. Add --snapshot ./frozen only if you truly want a second copy
#    of the case files: it duplicates possibly-sensitive material into a new directory.
npm run benchmark:release -- gates --corpus ./corpus-final

# Later, check the corpus you are about to review against the freeze:
npm run benchmark:release -- verify --corpus ./corpus-final --manifest ./releases/release-one.json
#    VERIFIED or DRIFTED, naming every added / removed / changed case. Non-zero exit on drift.
# Freeze again after new review, then compare the two:
npm run benchmark:release -- diff --before ./releases/release-one.json --after ./releases/release-two.json
```

What a release does **not** give you: no signature, no timestamp, no publication and no external attestation.
A digest detects that a file changed; it does not prove a reviewer was a real person or that any material is
genuine, and every passing gate is a statement about consistency and declared provenance, not accuracy.

**If a batch write was interrupted** (power loss, killed process, full disk) a staging directory survives at
`<out>.staging/` with a `journal.json`. Re-run the same command with `--recover`:

```bash
npm run benchmark:case -- merge --corpus ./corpus --submissions ./returned --out ./corpus-merged --recover
```

A journal still at `staged` means the target was never touched, so the run is rolled back and the staging
directory removed. A journal at `committing` means publishing had begun, so the remaining files are completed —
by content hash, so files already in place are skipped — and the result is byte-identical to an uninterrupted
run. If the corpus or submissions changed since the interruption, the plan hash no longer matches and recovery
refuses rather than mixing two batches; inspect or remove the staging directory and run again. Recovery with
no journal present is reported as such and changes nothing. See
[ADR-027](../agents/adrs/ADR-027-review-provenance-and-corpus-releases.md) and the
[design document](../technical/BENCHMARK_PROVENANCE_AND_CORPUS_RELEASES.md).
