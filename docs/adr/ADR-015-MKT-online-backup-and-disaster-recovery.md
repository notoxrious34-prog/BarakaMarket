# ADR-015-MKT: Online Backup & Disaster Recovery

* **Status:** ACCEPTED
* **Date:** 2026-10-27
* **Deciders:** Master Principal Architect; Executor: Muse Spark 1.3 Contributor

## Context

Phase 5 needs brownout-proofing: copying a live SQLite file corrupts it,
so the engine must snapshot without downtime, prove integrity, and rehearse
restores without risking the live till.

## Decision

1. **Hot backup:** `VACUUM INTO` (atomic under WAL, readers keep serving;
   single-quote escaping for the path) into `data/backups/` with
   `baraka-backup-YYYYMMDD-HHMMSS[-label][-n].sqlite` naming; snapshot
   opened for `integrity_check` + sales/products counts, then SHA-256 +
   size recorded in `backups_log` (VERIFIED).
2. **Catalog:** `listDatabaseBackups` reads the journal newest-first,
   skips missing files, recomputes hashes — mismatches are marked CORRUPT
   in the log and excluded from results (tamper-evident, not silent).
3. **Pre-flight:** magic bytes (`SQLite format 3\0`), size > 0,
   `integrity_check`, user-table census, sales readability — all failures
   collected in `errors`, never thrown, so the API can display them.
4. **Restore drill:** validate (else `BACKUP_INTEGRITY_FAILED`, live DB
   untouched) → quarantine snapshot to `data/quarantine/` with its own
   integrity gate → close live handle → swap files → journal a fresh
   RESTORED entry recomputed from the restored file (the snapshot
   predates its own log row, so UPDATE would match nothing). The DAL
   handle is dead after the swap by design — the server re-provisions via
   `openBarakaDb`, tests open a fresh handle.
5. **REST:** `create` (201), `GET` catalog, `verify`, `restore` (reopens
   the loopback DAL before responding, so the till keeps serving).

## Consequences

* Positive: zero-downtime snapshots; every restore rehearsed behind a
   quarantine copy; hash drift auto-flagged; 186/186.
* Accepted: `BackupValidationReport` carries `tableCount` beyond the
   sketch (needed for the "schemas valid" check); `:memory:` DBs can
   back up but not be restore targets; server backup files from API
   tests are shop data, not test litter (cleaned in-flow).
