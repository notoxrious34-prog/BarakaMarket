//! T4b (ADR-026): native fiscal commit lane — rusqlite edition of the
//! TypeScript DAL invariants. The frontend computes payloads with the tested
//! centimes engine; Rust RE-VALIDATES every money invariant before touching
//! the WAL, then owns seq + idempotency + atomicity. Same schema.sql, same
//! rules, zero trust in the caller.
//!
//! Dual-lane migration contract: `migrate()` here and `migrateSchemaVersion()`
//! in TS converge any file to LATEST_SCHEMA_VERSION (idempotent steps).

use rusqlite::Connection;
use rusqlite::OptionalExtension;
use serde_json::Value;

use crate::auth::sha256_hex;

pub const LATEST_SCHEMA_VERSION: i64 = 11;
const EXEMPT_BELOW_CT: i64 = 5000; // Art.136: ESPECES < 50 DZD exempt

fn ct(v: &Value, name: &str) -> Result<i64, String> {
    v.as_i64()
        .ok_or_else(|| format!("[fiscal] {name} must be integer centimes"))
}

fn str_field(v: &Value, name: &str) -> Result<String, String> {
    v.as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| format!("[fiscal] {name} must be a string"))
}

fn opt_str(v: &Value, name: &str) -> Result<Option<String>, String> {
    if v.is_null() {
        return Ok(None);
    }
    Ok(Some(str_field(v, name)?))
}

/// Idempotent version climb (mirrors TS migrateSchemaVersion).
pub fn migrate(conn: &Connection) -> Result<(), String> {
    let v: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if v > LATEST_SCHEMA_VERSION {
        return Err(format!(
            "[fiscal] database is newer than this build (v{v} > v{LATEST_SCHEMA_VERSION})"
        ));
    }
    let has_col = |table: &str, col: &str| -> Result<bool, String> {
        let mut st = conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|e| e.to_string())?;
        let rows = st
            .query_map([], |r| r.get::<_, String>(1))
            .map_err(|e| e.to_string())?;
        for c in rows {
            if c.map_err(|e| e.to_string())? == col {
                return Ok(true);
            }
        }
        Ok(false)
    };
    let has_table = |table: &str| -> Result<bool, String> {
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(n > 0)
    };
    if v < 2 && !has_col("sales", "client_sale_id")? {
        conn.execute_batch(
            "DROP INDEX IF EXISTS idx_sales_client_sale_id;
             ALTER TABLE sales ADD COLUMN client_sale_id TEXT;
             PRAGMA user_version = 2;",
        )
        .map_err(|e| e.to_string())?;
    }
    if v < 3 && !has_col("client_settlements", "client_settlement_key")? {
        conn.execute_batch(
            "DROP INDEX IF EXISTS idx_settlements_client_key;
             ALTER TABLE client_settlements ADD COLUMN client_settlement_key TEXT;
             PRAGMA user_version = 3;",
        )
        .map_err(|e| e.to_string())?;
    }
    // Always-ensured (never in schema.sql: old files would fail at open).
    conn.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_client_sale_id
           ON sales(client_sale_id) WHERE client_sale_id IS NOT NULL;
         CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_client_key
           ON client_settlements(client_settlement_key) WHERE client_settlement_key IS NOT NULL;",
    )
    .map_err(|e| e.to_string())?;
    // v3 → v4: T8 users + audit_log (mirrors TS migrateSchemaVersion).
    if v < 4 {
        crate::auth::migrate_v4(conn)?;
        conn.execute_batch("PRAGMA user_version = 4;")
            .map_err(|e| e.to_string())?;
    }
    // v4 → v5: T11 append-only + terminal-state triggers (ADR-034).
    // Fresh files get them from schema.sql at provision; legacy files climb here.
    if v < 5 {
        conn.execute_batch(
            "CREATE TRIGGER IF NOT EXISTS trg_sales_no_delete
             BEFORE DELETE ON sales BEGIN
               SELECT RAISE(ABORT, 'append-only: sales rows are never deleted (void instead)');
             END;
             CREATE TRIGGER IF NOT EXISTS trg_sale_items_no_delete
             BEFORE DELETE ON sale_items BEGIN
               SELECT RAISE(ABORT, 'append-only: sale_items rows are never deleted');
             END;
             CREATE TRIGGER IF NOT EXISTS trg_settlements_no_delete
             BEFORE DELETE ON client_settlements BEGIN
               SELECT RAISE(ABORT, 'append-only: settlements are never deleted');
             END;
             CREATE TRIGGER IF NOT EXISTS trg_sales_terminal
             BEFORE UPDATE OF status ON sales
             WHEN OLD.status = 'CANCELLED' AND NEW.status <> 'CANCELLED' BEGIN
               SELECT RAISE(ABORT, 'terminal: a CANCELLED sale can never be resurrected');
             END;
             CREATE TRIGGER IF NOT EXISTS trg_users_no_delete
             BEFORE DELETE ON users BEGIN
               SELECT RAISE(ABORT, 'append-only: users deactivate, never delete');
             END;
             CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
             BEFORE DELETE ON audit_log BEGIN
               SELECT RAISE(ABORT, 'append-only: audit_log is immutable');
             END;
             CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
             BEFORE UPDATE ON audit_log BEGIN
               SELECT RAISE(ABORT, 'append-only: audit_log rows are never modified');
             END;
             PRAGMA user_version = 5;",
        )
        .map_err(|e| e.to_string())?;
    }
    // v5 → v6 (#004): close_kind marks DAY (legal lock, one per day) vs
    // SHIFT (cash-session snapshot). Fresh files get it from schema.sql.
    if v < 6 {
        if !has_col("z_reports", "close_kind")? {
            conn.execute_batch(
                "ALTER TABLE z_reports ADD COLUMN close_kind TEXT NOT NULL DEFAULT 'DAY';",
            )
            .map_err(|e| e.to_string())?;
        }
        conn.execute_batch("PRAGMA user_version = 6;")
            .map_err(|e| e.to_string())?;
    }
    // v6 → v7 (régime fiscal): per-sale tva_enabled/timbre_enabled flags.
    // Fresh files get them from schema.sql; legacy files climb here.
    if v < 7 {
        if !has_col("sales", "tva_enabled")? {
            conn.execute_batch(
                "ALTER TABLE sales ADD COLUMN tva_enabled INTEGER NOT NULL DEFAULT 1;",
            )
            .map_err(|e| e.to_string())?;
        }
        if !has_col("sales", "timbre_enabled")? {
            conn.execute_batch(
                "ALTER TABLE sales ADD COLUMN timbre_enabled INTEGER NOT NULL DEFAULT 1;",
            )
            .map_err(|e| e.to_string())?;
        }
        conn.execute_batch("PRAGMA user_version = 7;")
            .map_err(|e| e.to_string())?;
    }
    // v7 → v8 P3 (v1.4.4): retention-exempt flag for pre-reset safety archives.
    // Fresh files get it from schema.sql; legacy files climb here.
    if v < 8 {
        if !has_col("backups_log", "exempt")? {
            conn.execute_batch(
                "ALTER TABLE backups_log ADD COLUMN exempt INTEGER NOT NULL DEFAULT 0;",
            )
            .map_err(|e| e.to_string())?;
        }
        conn.execute_batch("PRAGMA user_version = 8;")
            .map_err(|e| e.to_string())?;
    }
    // v8 → v9 (v1.5.0 RETURNS): inverse fiscal rows — draft → approve/reject.
    // Fresh files get them from schema.sql; legacy files climb here.
    // Canonical DDL mirrors db/schema.sql + the TS v8→v9 step in
    // src/db/sqlite.ts exactly (TEXT-UUID heads, full sale snapshot columns,
    // same triggers, seq rebuilt to admit 'RET' with counters preserved).
    if v < 9 {
        if !has_table("returns")? {
            conn.execute_batch(
                "CREATE TABLE returns (
                   id              TEXT PRIMARY KEY,
                   return_number   TEXT UNIQUE,
                   sale_id         TEXT NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
                   invoice_number  TEXT NOT NULL,
                   client_id       INTEGER REFERENCES clients(id),
                   client_name     TEXT,
                   payment_method  TEXT NOT NULL
                     CHECK (payment_method IN ('ESPECES','CIB','DAHABIYA','CREDIT')),
                   reason          TEXT NOT NULL
                     CHECK (reason IN ('DEFECT','WRONG_ITEM','SIZE_FIT','EXPIRED','CHANGED_MIND','OTHER')),
                   reason_note     TEXT,
                   refund_ct       INTEGER NOT NULL CHECK (refund_ct > 0),
                   status          TEXT NOT NULL DEFAULT 'DRAFT'
                     CHECK (status IN ('DRAFT','APPROVED','REJECTED')),
                   actor           TEXT NOT NULL DEFAULT '',
                   approver        TEXT NOT NULL DEFAULT '',
                   sale_day        TEXT NOT NULL,
                   posting_day     TEXT,
                   decided_at      TEXT,
                   created_at      TEXT NOT NULL,
                   client_return_key TEXT
                 );
                 CREATE TABLE return_items (
                   id               INTEGER PRIMARY KEY AUTOINCREMENT,
                   return_id        TEXT NOT NULL REFERENCES returns(id) ON DELETE RESTRICT,
                   sale_item_id     INTEGER NOT NULL REFERENCES sale_items(id) ON DELETE RESTRICT,
                   product_id       INTEGER REFERENCES products(id),
                   barcode          TEXT NOT NULL DEFAULT '',
                   name_fr          TEXT NOT NULL DEFAULT '',
                   name_ar          TEXT NOT NULL DEFAULT '',
                   unit_price_ct    INTEGER NOT NULL,
                   qty_milli        INTEGER NOT NULL CHECK (qty_milli > 0),
                   unit             TEXT NOT NULL CHECK (unit IN ('PIECE','KG','LITRE')),
                   tva_rate         INTEGER NOT NULL CHECK (tva_rate IN (0, 9, 19)),
                   line_ht_ct       INTEGER NOT NULL,
                   line_tva_ct      INTEGER NOT NULL,
                   line_ttc_ct      INTEGER NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS idx_return_items_return ON return_items(return_id);
                 CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status, posting_day);
                 CREATE UNIQUE INDEX IF NOT EXISTS idx_returns_client_key
                   ON returns(client_return_key) WHERE client_return_key IS NOT NULL;
                 CREATE TRIGGER IF NOT EXISTS trg_returns_no_delete
                 BEFORE DELETE ON returns BEGIN
                   SELECT RAISE(ABORT, 'append-only: returns are never deleted (reject instead)');
                 END;
                 CREATE TRIGGER IF NOT EXISTS trg_return_items_no_delete
                 BEFORE DELETE ON return_items BEGIN
                   SELECT RAISE(ABORT, 'append-only: return_items are never deleted');
                 END;
                 CREATE TRIGGER IF NOT EXISTS trg_returns_terminal
                 BEFORE UPDATE OF status ON returns
                 WHEN OLD.status <> 'DRAFT' AND NEW.status <> OLD.status BEGIN
                   SELECT RAISE(ABORT, 'terminal: a decided return can never go back to DRAFT');
                 END;",
            )
            .map_err(|e| e.to_string())?;
        }
        if !has_col("z_reports", "returns_count")? {
            conn.execute_batch(
                "ALTER TABLE z_reports ADD COLUMN returns_count INTEGER NOT NULL DEFAULT 0;",
            )
            .map_err(|e| e.to_string())?;
        }
        if !has_col("z_reports", "returns_total_ttc_ct")? {
            conn.execute_batch(
                "ALTER TABLE z_reports ADD COLUMN returns_total_ttc_ct INTEGER NOT NULL DEFAULT 0;",
            )
            .map_err(|e| e.to_string())?;
        }
        // The seq CHECK lists the lanes explicitly — rebuild it to admit
        // 'RET', preserving every counter (never reseeds numbering).
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS seq_new (
               kind TEXT NOT NULL CHECK (kind IN ('FACT', 'T', 'Q', 'Z', 'RET')),
               year INTEGER NOT NULL, last_n INTEGER NOT NULL DEFAULT 0,
               PRIMARY KEY (kind, year));
             INSERT OR IGNORE INTO seq_new (kind, year, last_n)
               SELECT kind, year, last_n FROM seq;
             DROP TABLE IF EXISTS seq;
             ALTER TABLE seq_new RENAME TO seq;",
        )
        .map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA user_version = 9;")
            .map_err(|e| e.to_string())?;
    }
    // v9 → v10 (USERS-PLUS §1, v1.5.1): mandatory freeze reason + note on
    // users. Fresh files get them from schema.sql; legacy files climb here.
    if v < 10 {
        if !has_col("users", "freeze_reason")? {
            conn.execute_batch(
                "ALTER TABLE users ADD COLUMN freeze_reason TEXT
                   CHECK (freeze_reason IN ('RESIGNED','LEAVE','MISUSE','OTHER'));",
            )
            .map_err(|e| e.to_string())?;
        }
        if !has_col("users", "freeze_note")? {
            conn.execute_batch("ALTER TABLE users ADD COLUMN freeze_note TEXT;")
                .map_err(|e| e.to_string())?;
        }
        conn.execute_batch("PRAGMA user_version = 10;")
            .map_err(|e| e.to_string())?;
    }
    // v10 → v11 (USERS-PLUS §3+§4, v1.5.1): temp-PIN expiry + rotation clock.
    // Fresh files get both from schema.sql; legacy files climb here with the
    // rotation clock backfilled to `now` so upgrades never force-change live.
    if v < 11 {
        if !has_col("users", "pin_expires_at")? {
            conn.execute_batch("ALTER TABLE users ADD COLUMN pin_expires_at TEXT;")
                .map_err(|e| e.to_string())?;
        }
        if !has_col("users", "pin_changed_at")? {
            conn.execute_batch("ALTER TABLE users ADD COLUMN pin_changed_at TEXT;")
                .map_err(|e| e.to_string())?;
        }
        conn.execute_batch(
            "UPDATE users SET pin_changed_at = replace(datetime('now'),' ','T') WHERE pin_changed_at IS NULL;",
        )
        .map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA user_version = 11;")
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn valid_day(day: &str) -> bool {
    day.len() == 10 && day.as_bytes()[4] == b'-' && day.as_bytes()[7] == b'-'
}

/// F2 (v1.4.5): the legal day is Africa/Algiers local, never UTC.
/// Algiers is UTC+1 year-round (no DST), so a local day D is exactly the
/// UTC window [D-1 23:00Z, D 23:00Z). No chrono dependency — civil-date
/// arithmetic (Howard Hinnant's days_from_civil / civil_from_days).
pub(crate) fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = if y2 >= 0 { y2 } else { y2 - 399 } / 400;
    let yoe = y2 - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z2 = z + 719468;
    let era = if z2 >= 0 { z2 } else { z2 - 146096 } / 146097;
    let doe = z2 - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn parse_day(day: &str) -> Result<(i64, i64, i64), String> {
    let y: i64 = day
        .get(0..4)
        .ok_or("[fiscal] bad day")?
        .parse()
        .map_err(|_| "[fiscal] bad day")?;
    let m: i64 = day
        .get(5..7)
        .ok_or("[fiscal] bad day")?
        .parse()
        .map_err(|_| "[fiscal] bad day")?;
    let d: i64 = day
        .get(8..10)
        .ok_or("[fiscal] bad day")?
        .parse()
        .map_err(|_| "[fiscal] bad day")?;
    Ok((y, m, d))
}

fn fmt_day(y: i64, m: i64, d: i64) -> String {
    format!("{y:04}-{m:02}-{d:02}")
}

/// UTC instant bounds [start, end) covering one local Algiers day (ISO strings).
fn day_bounds_utc(day: &str) -> Result<(String, String), String> {
    let (y, m, d) = parse_day(day)?;
    let prev = days_from_civil(y, m, d) - 1;
    let (py, pm, pd) = civil_from_days(prev);
    Ok((
        format!("{}T23:00:00.000Z", fmt_day(py, pm, pd)),
        format!("{day}T23:00:00.000Z"),
    ))
}

/// Local Algiers calendar day of a stored UTC timestamp (`YYYY-MM-DDTHH:MM…Z`).
fn algiers_day(ts: &str) -> Result<String, String> {
    let date = ts.get(0..10).ok_or("[fiscal] bad timestamp")?;
    let hh: i64 = ts
        .get(11..13)
        .ok_or("[fiscal] bad timestamp")?
        .parse()
        .map_err(|_| "[fiscal] bad timestamp")?;
    let (y, m, d) = parse_day(date)?;
    if hh + 1 >= 24 {
        let (ny, nm, nd) = civil_from_days(days_from_civil(y, m, d) + 1);
        Ok(fmt_day(ny, nm, nd))
    } else {
        Ok(date.to_string())
    }
}

/// #004: true when a legal DAY close already freezes `day`.
/// SHIFT snapshots never lock — several shifts may close the same day.
fn day_locked(conn: &Connection, day: &str) -> Result<bool, String> {
    let n: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM z_reports WHERE day = ?1 AND close_kind = 'DAY'",
            [day],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(n > 0)
}

/// Canonical Z chain hash — byte-identical to core/zreport.ts computeZHash.
fn z_hash(prev: &str, number: &str, day: &str, ttc: i64, timbre: i64) -> String {
    sha256_hex(&format!("{prev}||{number}||{day}||{ttc}||{timbre}"))
}

fn bump_seq(tx: &rusqlite::Transaction, kind: &str, year: i64) -> Result<i64, String> {
    if !(2000..=2100).contains(&year) {
        return Err(format!("[fiscal] invalid seq year: {year}"));
    }
    tx.execute(
        "INSERT INTO seq (kind, year, last_n) VALUES (?1, ?2, 0)
         ON CONFLICT (kind, year) DO NOTHING",
        rusqlite::params![kind, year],
    )
    .map_err(|e| e.to_string())?;
    tx.query_row(
        "UPDATE seq SET last_n = last_n + 1 WHERE kind = ?1 AND year = ?2 RETURNING last_n",
        rusqlite::params![kind, year],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// Art.136 timbre, mirrored from calculateTimbreFiscalCt (DZD-ceiled, floored).
/// Regime timbre off (owner Card 3) zeroes it even on ESPECES.
fn timbre_expected(
    conn: &Connection,
    sum_ttc_ct: i64,
    method: &str,
    enabled: bool,
) -> Result<i64, String> {
    if !enabled {
        return Ok(0);
    }
    if method != "ESPECES" || sum_ttc_ct < EXEMPT_BELOW_CT {
        return Ok(0);
    }
    let (rate, min_ct, max_ct): (f64, i64, i64) = conn
        .query_row(
            "SELECT timbre_rate, timbre_min_ct, timbre_max_ct FROM store_profile WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap_or((0.01, 1000, 250000));
    let mut t = ((sum_ttc_ct as f64 * rate / 100.0).ceil() as i64) * 100;
    if t < min_ct {
        t = min_ct;
    }
    if t > max_ct {
        t = max_ct;
    }
    Ok(t)
}

/// Fiscal regime flag from a commit payload (owner Card 3 toggles).
/// Absent = tax applies (legacy rows behave exactly as before).
fn regime_flag(v: &Value, key: &str) -> bool {
    v.get(key).and_then(|x| x.as_bool()).unwrap_or(true)
}

fn tva_ok(r: i64) -> bool {
    r == 0 || r == 9 || r == 19
}

fn method_ok(m: &str) -> bool {
    matches!(m, "ESPECES" | "CIB" | "DAHABIYA" | "CREDIT")
}

/// Native record_sale. `header`/`items` mirror SaleHeaderInput/SaleItemInput.
pub fn record_sale(
    conn: &mut Connection,
    header: &Value,
    items: &[Value],
) -> Result<Value, String> {
    if items.is_empty() {
        return Err("[fiscal] cannot record a sale with zero items".to_string());
    }
    let id = str_field(&header["id"], "id")?;
    let year: i64 = str_field(&header["created_at"], "created_at")?
        .get(0..4)
        .ok_or("[fiscal] bad created_at")?
        .parse()
        .map_err(|_| "[fiscal] bad created_at year")?;
    let method = str_field(&header["payment_method"], "payment_method")?;
    if !method_ok(&method) {
        return Err(format!("[fiscal] bad payment method: {method}"));
    }
    let t = &header["totals"];
    let (ht, tva, timbre, ttc) = (
        ct(&t["total_ht_ct"], "total_ht_ct")?,
        ct(&t["total_tva_ct"], "total_tva_ct")?,
        ct(&t["timbre_ct"], "timbre_ct")?,
        ct(&t["total_ttc_ct"], "total_ttc_ct")?,
    );
    if ht + tva + timbre != ttc {
        return Err("[fiscal] header invariant broken: HT + TVA + timbre !== TTC".to_string());
    }
    // Line invariants + tier sums.
    let (mut sh, mut sv, mut st) = (0i64, 0i64, 0i64);
    let mut tier = [(0i64, 0i64, 0i64); 3]; // idx 0/1/2 -> TVA 0/9/19
    for it in items {
        let r = ct(&it["tva_rate"], "tva_rate")?;
        if !tva_ok(r) {
            return Err(format!("[fiscal] TVA rate must be 0, 9 or 19 (got {r})"));
        }
        let (lh, la, lt) = (
            ct(&it["line_ht_ct"], "line_ht_ct")?,
            ct(&it["line_tva_ct"], "line_tva_ct")?,
            ct(&it["line_ttc_ct"], "line_ttc_ct")?,
        );
        if lh + la != lt {
            return Err("[fiscal] line invariant broken: HT + TVA !== TTC".to_string());
        }
        let q = ct(&it["qty_milli"], "qty_milli")?;
        if q <= 0 {
            return Err("[fiscal] qty_milli must be > 0".to_string());
        }
        sh += lh;
        sv += la;
        st += lt;
        let ti = if r == 0 {
            0
        } else if r == 9 {
            1
        } else {
            2
        };
        tier[ti].0 += lh;
        tier[ti].1 += la;
        tier[ti].2 += lt;
    }
    if sh != ht || sv != tva {
        return Err("[fiscal] item sums do not match header HT/TVA".to_string());
    }
    // Fiscal regime travels with the commit; absent flags = legacy (both apply).
    let tva_on = regime_flag(&header["fiscal_regime"], "tva_enabled");
    let timbre_on = regime_flag(&header["fiscal_regime"], "timbre_enabled");
    // Regime TVA off: the header must carry zero TVA (client coerced lines to tier 0).
    if !tva_on && tva != 0 {
        return Err(
            "[fiscal] regime TVA off but header carries TVA — refusing to record".to_string(),
        );
    }
    for (i, r) in [0, 9, 19].iter().enumerate() {
        let b = &t["tva_breakdown"][&r.to_string()];
        if ct(&b["base_ht_ct"], "tier base")? != tier[i].0
            || ct(&b["tva_amount_ct"], "tier amt")? != tier[i].1
            || ct(&b["total_ttc_ct"], "tier ttc")? != tier[i].2
        {
            return Err(format!("[fiscal] tier {r}% breakdown mismatch"));
        }
    }
    if timbre_expected(conn, st, &method, timbre_on)? != timbre {
        return Err("[fiscal] timbre mismatch against Art.136 engine".to_string());
    }
    let paid = ct(&header["amount_paid_ct"], "amount_paid_ct")?;
    let ret = ct(&header["amount_returned_ct"], "amount_returned_ct")?;
    let key = opt_str(&header["client_sale_id"], "client_sale_id")?;

    // Idempotent pre-check (outside the write tx, like the TS lane).
    if let Some(k) = &key {
        if let Ok(row) = conn.query_row(
            "SELECT id, invoice_number, ticket_number FROM sales WHERE client_sale_id = ?1",
            [k],
            |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, String>(0)?,
                    "invoice_number": r.get::<_, String>(1)?,
                    "ticket_number": r.get::<_, String>(2)?,
                }))
            },
        ) {
            return Ok(row);
        }
    }

    // #004/F2: a legally closed LOCAL day is frozen — no new posting may land in it.
    let created = str_field(&header["created_at"], "created_at")?;
    let day = algiers_day(&created)?;
    if !valid_day(&day) {
        return Err("[fiscal] bad created_at day".to_string());
    }
    if day_locked(conn, &day)? {
        return Err(format!(
            "[fiscal] day {day} is already legally closed (Z FINALISÉ) — sale refused"
        ));
    }
    // Walk-in safety (v1.4.8 PROD-SALE): the client registry lives in the UI;
    // a fresh/unsynced fiscal DB has no such row. Cash sales degrade to an
    // anonymous walk-in (NULL, name preserved) instead of dying on the FK.
    // CREDIT needs a ledger identity — refused with a naming message.
    let client_wanted: Option<i64> = header["client_id"].as_i64();
    let client_fk: Option<i64> = match client_wanted {
        None => None,
        Some(c) => conn
            .query_row("SELECT id FROM clients WHERE id = ?1", [c], |r| {
                r.get::<_, i64>(0)
            })
            .ok(),
    };
    if client_wanted.is_some() && client_fk.is_none() && method == "CREDIT" {
        return Err(
            "[fiscal] client inconnu — recréez le client avant une vente à crédit".to_string(),
        );
    }

    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let invoice = format!("FACT-{year}-{:06}", bump_seq(&tx, "FACT", year)?);
    let ticket = format!("T-{year}-{:06}", bump_seq(&tx, "T", year)?);
    let is_facture = if header["is_facture"].as_i64().unwrap_or(0) == 1 {
        1
    } else {
        0
    };
    let insert = tx.execute(
        "INSERT INTO sales (id, invoice_number, ticket_number, cashier_id, cashier_name,
          client_id, client_name, client_nif, client_nis, client_rc, client_ai, client_address,
          total_ht_ct, total_tva_ct, timbre_ct, total_ttc_ct,
          tva0_base_ct, tva0_amt_ct, tva0_ttc_ct, tva9_base_ct, tva9_amt_ct, tva9_ttc_ct,
          tva19_base_ct, tva19_amt_ct, tva19_ttc_ct,
          payment_method, tva_enabled, timbre_enabled, amount_paid_ct, amount_returned_ct, status, is_facture, created_at,
          client_sale_id)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,'COMPLETED',?31,?32,?33)",
        rusqlite::params![
            id, invoice, ticket,
            str_field(&header["cashier_id"], "cashier_id")?,
            str_field(&header["cashier_name"], "cashier_name")?,
            header["client_id"].as_i64().and(client_fk),
            opt_str(&header["client_name"], "client_name")?.unwrap_or_default(),
            opt_str(&header["client_nif"], "client_nif")?.unwrap_or_default(),
            opt_str(&header["client_nis"], "client_nis")?.unwrap_or_default(),
            opt_str(&header["client_rc"], "client_rc")?.unwrap_or_default(),
            opt_str(&header["client_ai"], "client_ai")?.unwrap_or_default(),
            opt_str(&header["client_address"], "client_address")?.unwrap_or_default(),
            ht, tva, timbre, ttc,
            tier[0].0, tier[0].1, tier[0].2, tier[1].0, tier[1].1, tier[1].2, tier[2].0, tier[2].1, tier[2].2,
            method, tva_on as i64, timbre_on as i64, paid, ret, is_facture,
            str_field(&header["created_at"], "created_at")?, key,
        ],
    );
    if let Err(e) = insert {
        let msg = e.to_string();
        drop(tx); // rollback
        if key.is_some()
            && (msg.contains("sales.client_sale_id") || msg.contains("idx_sales_client_sale_id"))
        {
            if let Ok(row) = conn.query_row(
                "SELECT id, invoice_number, ticket_number FROM sales WHERE client_sale_id = ?1",
                [&key],
                |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?,
                        "invoice_number": r.get::<_, String>(1)?,
                        "ticket_number": r.get::<_, String>(2)?,
                    }))
                },
            ) {
                return Ok(row);
            }
        }
        return Err(msg);
    }
    for it in items {
        // Unknown products (exe lane carries barcode/name truth) NULL the FK;
        // matched rows drain stock exactly like the TS lane.
        let pid: Option<i64> = it["product_id"].as_i64().and_then(|p| {
            tx.query_row("SELECT id FROM products WHERE id = ?1", [p], |r| {
                r.get::<_, i64>(0)
            })
            .ok()
        });
        let qty = ct(&it["qty_milli"], "qty_milli")?;
        tx.execute(
            "INSERT INTO sale_items (sale_id, product_id, barcode, name_fr, name_ar, unit_price_ct,
              qty_milli, unit, tva_rate, discount_bp, line_ht_ct, line_tva_ct, line_ttc_ct)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            rusqlite::params![
                id,
                pid,
                str_field(&it["barcode"], "barcode")?,
                str_field(&it["name_fr"], "name_fr")?,
                it["name_ar"].as_str().unwrap_or(""),
                ct(&it["unit_price_ct"], "unit_price_ct")?,
                qty,
                str_field(&it["unit"], "unit")?,
                ct(&it["tva_rate"], "tva_rate")?,
                it["discount_bp"].as_i64().unwrap_or(0),
                ct(&it["line_ht_ct"], "line_ht_ct")?,
                ct(&it["line_tva_ct"], "line_tva_ct")?,
                ct(&it["line_ttc_ct"], "line_ttc_ct")?,
            ],
        )
        .map_err(|e| e.to_string())?;
        if let Some(p) = pid {
            tx.execute(
                "UPDATE products SET stock_milli = stock_milli - ?1 WHERE id = ?2",
                rusqlite::params![qty, p],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "id": id, "invoice_number": invoice, "ticket_number": ticket }))
}

/// Native record_settlement (mirrors TS recordSettlement + T2b idempotency).
pub fn record_settlement(conn: &mut Connection, input: &Value) -> Result<Value, String> {
    let amount = ct(&input["amount_ct"], "amount_ct")?;
    if amount <= 0 {
        return Err("[fiscal] settlement amount must be > 0".to_string());
    }
    let method = str_field(&input["payment_method"], "payment_method")?;
    if !method_ok(&method) {
        return Err(format!("[fiscal] bad settlement method: {method}"));
    }
    let timbre = ct(&input["timbre_ct"], "timbre_ct")?;
    let collected = ct(&input["total_collected_ct"], "total_collected_ct")?;
    let timbre_on = regime_flag(input, "timbre_enabled");
    if timbre_expected(conn, amount, &method, timbre_on)? != timbre {
        return Err("[fiscal] settlement timbre mismatch".to_string());
    }
    let id = str_field(&input["id"], "id")?;
    let key = opt_str(&input["client_settlement_key"], "client_settlement_key")?;
    if let Some(k) = &key {
        if let Ok(row) = conn.query_row(
            "SELECT id, receipt_number FROM client_settlements WHERE client_settlement_key = ?1",
            [k],
            |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, String>(0)?,
                    "receipt_number": r.get::<_, String>(1)?,
                }))
            },
        ) {
            return Ok(row);
        }
    }
    let year: i64 = str_field(&input["date"], "date")?
        .get(0..4)
        .ok_or("[fiscal] bad date")?
        .parse()
        .map_err(|_| "[fiscal] bad date year")?;
    let client_id = input["client_id"]
        .as_i64()
        .ok_or("[fiscal] client_id must be an integer")?;

    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let prev: i64 = tx
        .query_row(
            "SELECT credit_balance_ct FROM clients WHERE id = ?1",
            [client_id],
            |r| r.get(0),
        )
        .map_err(|_| "[fiscal] CLIENT_NOT_FOUND".to_string())?;
    let receipt = format!("Q-{year}-{:06}", bump_seq(&tx, "Q", year)?);
    tx.execute(
        "UPDATE clients SET credit_balance_ct = ?1 WHERE id = ?2",
        rusqlite::params![prev - amount, client_id],
    )
    .map_err(|e| e.to_string())?;
    let insert = tx.execute(
        "INSERT INTO client_settlements (id, client_id, client_name, amount_ct, payment_method,
          timbre_ct, total_collected_ct, receipt_number, date, note, client_settlement_key)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        rusqlite::params![
            id,
            client_id,
            input["client_name"].as_str().unwrap_or(""),
            amount,
            method,
            timbre,
            collected,
            receipt,
            str_field(&input["date"], "date")?,
            input["note"].as_str().unwrap_or(""),
            key,
        ],
    );
    if let Err(e) = insert {
        let msg = e.to_string();
        drop(tx);
        if key.is_some()
            && (msg.contains("client_settlements.client_settlement_key")
                || msg.contains("idx_settlements_client_key"))
        {
            if let Ok(row) = conn.query_row(
                "SELECT id, receipt_number FROM client_settlements WHERE client_settlement_key = ?1",
                [&key],
                |r| {
                    Ok(serde_json::json!({
                        "id": r.get::<_, String>(0)?,
                        "receipt_number": r.get::<_, String>(1)?,
                    }))
                },
            ) {
                return Ok(row);
            }
        }
        return Err(msg);
    }
    let _ = collected;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "id": id, "receipt_number": receipt }))
}

/// #003 (Phase A): atomic sequence mint WITHOUT writing a sale.
/// Same UPDATE..RETURNING primitive as record_sale — ONE sequencer for every
/// lane, so a preview/reservation never forks the numbering.
pub fn next_invoice(conn: &mut Connection, kind: &str, year: i64) -> Result<Value, String> {
    let prefix = match kind {
        "FACT" => "FACT",
        "T" => "T",
        "Q" => "Q",
        _ => return Err(format!("[fiscal] bad seq kind: {kind} (FACT/T/Q)")),
    };
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let n = bump_seq(&tx, kind, year)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "number": format!("{prefix}-{year}-{n:06}") }))
}

/// #003 (Phase A): legal void — status flip + void_log row, ONE Immediate tx.
/// No DELETE ever (T11): the row stays, the journal explains why.
pub fn void_sale(
    conn: &mut Connection,
    sale_id: &str,
    reason: &str,
    voided_by: &str,
) -> Result<Value, String> {
    if reason.trim().is_empty() {
        return Err("[fiscal] void reason is required (legal journal)".to_string());
    }
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let (invoice, status, created_at): (String, String, String) = tx
        .query_row(
            "SELECT invoice_number, status, created_at FROM sales WHERE id = ?1",
            [sale_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| format!("[fiscal] sale not found: {sale_id}"))?;
    if status == "CANCELLED" {
        return Err("[fiscal] sale already voided".to_string());
    }
    // #004/F2: a legally closed LOCAL day is frozen — voids to it are refused.
    // (COUNT runs on the tx: same Immediate lock, no TOCTOU.)
    let day = algiers_day(&created_at)?;
    let locked: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM z_reports WHERE day = ?1 AND close_kind = 'DAY'",
            [&day],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if locked > 0 {
        return Err(format!(
            "[fiscal] day {day} is already legally closed (Z FINALISÉ) — void refused"
        ));
    }
    tx.execute(
        "UPDATE sales SET status = 'CANCELLED' WHERE id = ?1",
        [sale_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO void_log (sale_id, invoice_number, reason, voided_by, voided_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))",
        rusqlite::params![sale_id, invoice, reason, voided_by],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "id": sale_id, "invoice_number": invoice, "status": "CANCELLED" }))
}

/// v1.5.0 (RETURNS): inverse fiscal rows — draft → approve / reject.
/// Native twin of the TS returns lane (same guards, same prorata math):
/// COMPLETED sales only, 7-day fiscal window, cumulative cap, cash refunds
/// need an OPEN session, two-person rule above 5000 DZD.
const RETURN_REASONS: [&str; 6] = [
    "DEFECT",
    "WRONG_ITEM",
    "SIZE_FIT",
    "EXPIRED",
    "CHANGED_MIND",
    "OTHER",
];
const RETURN_WINDOW_DAYS: i64 = 7;
const RETURN_TWO_PERSON_CT: i64 = 500_000;

/// Civil-day distance sale_day → today, both YYYY-MM-DD. The caller passes
/// its fiscal day explicitly, so the native lane never needs a clock.
fn return_window_ok(sale_day: &str, today: &str) -> Result<(), String> {
    let (sy, sm, sd) = parse_day(sale_day)?;
    let (ty, tm, td) = parse_day(today)?;
    let gap = days_from_civil(ty, tm, td) - days_from_civil(sy, sm, sd);
    if !(0..=RETURN_WINDOW_DAYS).contains(&gap) {
        return Err(format!(
            "[fiscal] return window is {RETURN_WINDOW_DAYS} days (sale {sale_day}, today {today})"
        ));
    }
    Ok(())
}

/// Half-up integer prorata: round(num / den) for non-negative operands.
fn half_up(num: i64, den: i64) -> i64 {
    (num * 2 + den) / (den * 2)
}

fn audit_return(
    tx: &rusqlite::Transaction,
    actor: &str,
    action: &str,
    entity_id: &str,
    detail: String,
) -> Result<(), String> {
    tx.execute(
        "INSERT INTO audit_log (ts, actor, action, entity, entity_id, detail)
         VALUES (datetime('now'), ?1, ?2, 'returns', ?3, ?4)",
        rusqlite::params![actor, action, entity_id, detail],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn return_create(
    conn: &mut Connection,
    sale_id: &str,
    items_json: &str,
    reason: &str,
    reason_note: Option<String>,
    actor: &str,
    client_key: Option<String>,
    today: &str,
) -> Result<Value, String> {
    if !RETURN_REASONS.contains(&reason) {
        return Err(format!("[fiscal] bad return reason: {reason}"));
    }
    // A4 (supermarket): OTHER without a note is an unauditable black box.
    if reason == "OTHER" && reason_note.as_deref().unwrap_or("").trim().is_empty() {
        return Err(
            "[fiscal] return reason OTHER needs a note (what exactly is wrong?)".to_string(),
        );
    }
    if actor.trim().is_empty() {
        return Err("[fiscal] return actor is required".to_string());
    }
    if !valid_day(today) {
        return Err("[fiscal] today must be YYYY-MM-DD".to_string());
    }
    let items: Vec<Value> = serde_json::from_str(items_json)
        .map_err(|_| "[fiscal] items must be a JSON array".to_string())?;
    if items.is_empty() {
        return Err("[fiscal] return needs at least one line".to_string());
    }
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    // Idempotency inside the lock: same key returns the original draft.
    if let Some(k) = client_key.as_deref().filter(|k| !k.trim().is_empty()) {
        let hit: Option<(String, i64)> = tx
            .query_row(
                "SELECT id, refund_ct FROM returns WHERE client_return_key = ?1",
                [k],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((id, refund_ct)) = hit {
            tx.commit().map_err(|e| e.to_string())?;
            return Ok(serde_json::json!({ "id": id, "refund_ct": refund_ct }));
        }
    }
    let (status, invoice_number, created_at, payment, client_id, client_name): (
        String,
        String,
        String,
        String,
        Option<i64>,
        Option<String>,
    ) = tx
        .query_row(
            "SELECT status, invoice_number, created_at, payment_method, client_id, client_name
             FROM sales WHERE id = ?1",
            [sale_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .map_err(|_| format!("[fiscal] sale not found: {sale_id}"))?;
    if status != "COMPLETED" {
        return Err(format!(
            "[fiscal] only COMPLETED sales can be returned (sale {sale_id} is {status})"
        ));
    }
    let sale_day = algiers_day(&created_at)?;
    return_window_ok(&sale_day, today)?;
    let mut refund_ct: i64 = 0;
    // Canonical snapshot columns (mirrors the TS DAL): the return carries the
    // sale's identity so the ticket and the audit never re-join the sale.
    let mut rows: Vec<(
        i64,
        Option<i64>,
        String,
        String,
        String,
        i64,
        i64,
        String,
        i64,
        i64,
        i64,
    )> = Vec::new();
    for it in &items {
        let sid = it
            .get("saleItemId")
            .and_then(|v| v.as_i64())
            .ok_or("[fiscal] each line needs {saleItemId, qty_milli}".to_string())?;
        let qty = it
            .get("qty_milli")
            .and_then(|v| v.as_i64())
            .ok_or("[fiscal] each line needs {saleItemId, qty_milli}".to_string())?;
        if qty <= 0 {
            return Err("[fiscal] return qty must be > 0".to_string());
        }
        let (
            owner,
            product_id,
            barcode,
            name_fr,
            name_ar,
            unit_price,
            sale_qty,
            unit,
            tva_rate,
            line_ht,
            line_ttc,
        ): (
            String,
            Option<i64>,
            String,
            String,
            String,
            i64,
            i64,
            String,
            i64,
            i64,
            i64,
        ) = tx
            .query_row(
                "SELECT sale_id, product_id, barcode, name_fr, name_ar, unit_price_ct,
                        qty_milli, unit, tva_rate, line_ht_ct, line_ttc_ct
                 FROM sale_items WHERE id = ?1",
                [sid],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                        r.get(9)?,
                        r.get(10)?,
                    ))
                },
            )
            .map_err(|_| format!("[fiscal] sale item {sid} is not part of sale {sale_id}"))?;
        if owner != sale_id {
            return Err(format!(
                "[fiscal] sale item {sid} is not part of sale {sale_id}"
            ));
        }
        if ![0, 9, 19].contains(&tva_rate) {
            return Err(format!(
                "[fiscal] bad TVA rate on sale item {sid}: {tva_rate}"
            ));
        }
        // Canonical cumulative guard (TS DAL): only APPROVED returns consume
        // the sold quantity — DRAFTs are provisional until a manager signs.
        // The atomic recheck at approve closes the double-draft race.
        let used: i64 = tx
            .query_row(
                "SELECT COALESCE(SUM(ri.qty_milli), 0) FROM return_items ri
                 JOIN returns r ON r.id = ri.return_id
                 WHERE r.sale_id = ?1 AND ri.sale_item_id = ?2 AND r.status = 'APPROVED'",
                rusqlite::params![sale_id, sid],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if used + qty > sale_qty {
            return Err(format!(
                "[fiscal] return qty exceeds remaining (item {sid}: sold {sale_qty}, already returned {used})"
            ));
        }
        let lht = half_up(line_ht * qty, sale_qty);
        let lttc = half_up(line_ttc * qty, sale_qty);
        refund_ct += lttc;
        rows.push((
            sid, product_id, barcode, name_fr, name_ar, unit_price, qty, unit, tva_rate, lht, lttc,
        ));
    }
    if refund_ct <= 0 {
        return Err("[fiscal] return refund must be > 0".to_string());
    }
    let rid = uuid::Uuid::new_v4().to_string();
    let now = now_iso();
    tx.execute(
        "INSERT INTO returns (id, sale_id, invoice_number, client_id, client_name,
          payment_method, reason, reason_note, refund_ct, status, actor,
          sale_day, created_at, client_return_key)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'DRAFT', ?10, ?11, ?12, ?13)",
        rusqlite::params![
            rid,
            sale_id,
            invoice_number,
            client_id,
            client_name,
            payment,
            reason,
            reason_note.filter(|n| !n.trim().is_empty()),
            refund_ct,
            actor,
            sale_day,
            now,
            client_key.filter(|k| !k.trim().is_empty())
        ],
    )
    .map_err(|e| e.to_string())?;
    for (sid, product_id, barcode, name_fr, name_ar, unit_price, qty, unit, tva_rate, lht, lttc) in
        &rows
    {
        let ltva = lttc - lht;
        tx.execute(
            "INSERT INTO return_items (return_id, sale_item_id, product_id, barcode,
              name_fr, name_ar, unit_price_ct, qty_milli, unit, tva_rate,
              line_ht_ct, line_tva_ct, line_ttc_ct)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            rusqlite::params![
                rid, sid, product_id, barcode, name_fr, name_ar, unit_price, qty, unit, tva_rate,
                lht, ltva, lttc
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    audit_return(
        &tx,
        actor,
        "return.create",
        &rid,
        format!("draft for sale {sale_id}: {refund_ct}ct ({reason})"),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "id": rid, "refund_ct": refund_ct }))
}

pub fn return_approve(
    conn: &mut Connection,
    id: &str,
    approver: &str,
    approver_role: &str,
    today: &str,
) -> Result<Value, String> {
    if !["manager", "owner"].contains(&approver_role) {
        return Err("[fiscal] returns need a manager or owner to approve".to_string());
    }
    let who = approver.trim();
    if who.is_empty() {
        return Err("[fiscal] approver is required".to_string());
    }
    if !valid_day(today) {
        return Err("[fiscal] today must be YYYY-MM-DD".to_string());
    }
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let (status, sale_id, invoice_number, payment, refund_ct, actor, sale_day): (
        String,
        String,
        String,
        String,
        i64,
        String,
        String,
    ) = tx
        .query_row(
            "SELECT status, sale_id, invoice_number, payment_method, refund_ct, actor, sale_day
             FROM returns WHERE id = ?1",
            [id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            },
        )
        .map_err(|_| format!("[fiscal] return not found: {id}"))?;
    if status != "DRAFT" {
        return Err(format!(
            "[fiscal] return {id} is already decided ({status})"
        ));
    }
    let sale_status: String = tx
        .query_row("SELECT status FROM sales WHERE id = ?1", [&sale_id], |r| {
            r.get(0)
        })
        .map_err(|_| format!("[fiscal] sale not found: {sale_id}"))?;
    if sale_status != "COMPLETED" {
        return Err("[fiscal] the original sale is no longer COMPLETED".to_string());
    }
    return_window_ok(&sale_day, today)?;
    // Canonical posting day (TS DAL): the approval lands on the OPEN day,
    // never backdated — even when the source sale day is long closed.
    let posting_day = today.to_string();
    if day_locked(&tx, &posting_day)? {
        return Err(format!(
            "[fiscal] day {posting_day} is already legally closed (Z FINALISÉ) — approve refused"
        ));
    }
    // Owner decision 2026-11-05: above 5000 DZD the approver must differ from
    // the creator — compared by login name (PIN identity is lane-side).
    if refund_ct > RETURN_TWO_PERSON_CT && who == actor {
        return Err("[fiscal] refunds above 5000 DZD need a second person to approve".to_string());
    }
    // Atomic recheck (TS DAL): a concurrent approval can never double-return.
    let items: Vec<(i64, i64, Option<i64>)> = {
        let mut st = tx
            .prepare(
                "SELECT ri.sale_item_id, ri.qty_milli, ri.product_id FROM return_items ri
                 JOIN sale_items si ON si.id = ri.sale_item_id
                 WHERE ri.return_id = ?1",
            )
            .map_err(|e| e.to_string())?;
        let lines = st
            .query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for line in lines {
            out.push(line.map_err(|e| e.to_string())?);
        }
        out
    };
    for (sale_item_id, qty, _) in &items {
        let sold_qty: i64 = tx
            .query_row(
                "SELECT qty_milli FROM sale_items WHERE id = ?1",
                [sale_item_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let already: i64 = tx
            .query_row(
                "SELECT COALESCE(SUM(ri.qty_milli), 0) FROM return_items ri
                 JOIN returns r ON r.id = ri.return_id
                 WHERE r.sale_id = ?1 AND ri.sale_item_id = ?2 AND r.status = 'APPROVED'",
                rusqlite::params![sale_id, sale_item_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if already + qty > sold_qty {
            return Err(format!(
                "[fiscal] line {sale_item_id} was already returned by a concurrent approval"
            ));
        }
    }
    let session: Option<String> = tx
        .query_row(
            "SELECT id FROM cash_sessions WHERE status = 'OPEN' LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if payment == "ESPECES" && session.is_none() {
        return Err("[fiscal] cash refunds need an OPEN cash session".to_string());
    }
    let year: i64 = posting_day
        .get(0..4)
        .ok_or("[fiscal] bad posting day")?
        .parse()
        .map_err(|_| "[fiscal] bad posting day year")?;
    let number = format!("RET-{year}-{n:06}", n = bump_seq(&tx, "RET", year)?);
    let now = now_iso();
    tx.execute(
        "UPDATE returns SET status = 'APPROVED', return_number = ?1,
          approver = ?2, posting_day = ?3, decided_at = ?4 WHERE id = ?5",
        rusqlite::params![number, who, posting_day, now, id],
    )
    .map_err(|e| e.to_string())?;
    // Stock flows back in (null product = ad-hoc line, nothing to restock).
    for (_, qty, product_id) in &items {
        if let Some(pid) = product_id {
            tx.execute(
                "UPDATE products SET stock_milli = stock_milli + ?1 WHERE id = ?2",
                rusqlite::params![qty, pid],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    if payment == "ESPECES" {
        let sid = session.clone().unwrap_or_default();
        // A2 (supermarket): never drive the drawer negative — same
        // theoretical as cash_session_status (opening + cash + settled + dep − wit − exp).
        let (opening_float_ct, opened_at): (i64, String) = tx
            .query_row(
                "SELECT opening_float_ct, opened_at FROM cash_sessions WHERE id = ?1",
                [&sid],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        let (cash, _, settled, dep, wit, exp) = status_sums(&tx, &opened_at, &now, &sid)?;
        let holds = opening_float_ct + cash + settled + dep - wit - exp;
        if holds < refund_ct {
            return Err(format!(
                "[fiscal] drawer short: holds {holds} ct, refund needs {refund_ct} ct — count the drawer or split the refund"
            ));
        }
        tx.execute(
            "INSERT INTO cash_movements (id, session_id, movement_type, amount_ct, reason, created_at)
             VALUES (?1, ?2, 'WITHDRAWAL', ?3, ?4, ?5)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                sid,
                refund_ct,
                format!("Retour {number} ({invoice_number})"),
                now,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    audit_return(
        &tx,
        who,
        "return.approve",
        id,
        format!("{number} {invoice_number} refund={refund_ct} creator={actor}"),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "return_number": number, "refund_ct": refund_ct, "posting_day": posting_day,
    }))
}

pub fn return_reject(
    conn: &mut Connection,
    id: &str,
    actor: &str,
    note: Option<String>,
) -> Result<Value, String> {
    let who = actor.trim();
    if who.is_empty() {
        return Err("[fiscal] reject actor is required".to_string());
    }
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let (status, invoice_number): (String, String) = tx
        .query_row(
            "SELECT status, invoice_number FROM returns WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| format!("[fiscal] return not found: {id}"))?;
    if status != "DRAFT" {
        return Err(format!(
            "[fiscal] return {id} is already decided ({status})"
        ));
    }
    let now = now_iso();
    let note_txt = note.unwrap_or_default();
    tx.execute(
        "UPDATE returns SET status = 'REJECTED', approver = ?1, decided_at = ?2,
          reason_note = COALESCE(NULLIF(?3, ''), reason_note)
         WHERE id = ?4",
        rusqlite::params![who, now, note_txt, id],
    )
    .map_err(|e| e.to_string())?;
    audit_return(
        &tx,
        who,
        "return.reject",
        id,
        format!(
            "{invoice_number} note={}",
            note_txt.chars().take(140).collect::<String>()
        ),
    )?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "id": id, "status": "REJECTED" }))
}

pub fn return_get(conn: &Connection, id: &str) -> Result<Value, String> {
    let head: Option<Value> = conn
        .query_row(
            "SELECT id, return_number, sale_id, invoice_number, client_id, client_name,
              payment_method, reason, reason_note, refund_ct, status, actor, approver,
              sale_day, posting_day, decided_at, created_at, client_return_key
             FROM returns WHERE id = ?1",
            [id],
            |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, String>(0)?,
                    "return_number": r.get::<_, Option<String>>(1)?,
                    "sale_id": r.get::<_, String>(2)?,
                    "invoice_number": r.get::<_, String>(3)?,
                    "client_id": r.get::<_, Option<i64>>(4)?,
                    "client_name": r.get::<_, Option<String>>(5)?,
                    "payment_method": r.get::<_, String>(6)?,
                    "reason": r.get::<_, String>(7)?,
                    "reason_note": r.get::<_, Option<String>>(8)?,
                    "refund_ct": r.get::<_, i64>(9)?,
                    "status": r.get::<_, String>(10)?,
                    "actor": r.get::<_, String>(11)?,
                    "approver": r.get::<_, String>(12)?,
                    "sale_day": r.get::<_, String>(13)?,
                    "posting_day": r.get::<_, Option<String>>(14)?,
                    "decided_at": r.get::<_, Option<String>>(15)?,
                    "created_at": r.get::<_, String>(16)?,
                    "client_return_key": r.get::<_, Option<String>>(17)?,
                }))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(mut h) = head else {
        return Ok(Value::Null);
    };
    let mut st = conn
        .prepare(
            "SELECT id, sale_item_id, product_id, barcode, name_fr, name_ar,
              unit_price_ct, qty_milli, unit, tva_rate,
              line_ht_ct, line_tva_ct, line_ttc_ct
             FROM return_items WHERE return_id = ?1 ORDER BY id ASC",
        )
        .map_err(|e| e.to_string())?;
    let lines = st
        .query_map([id], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, i64>(0)?,
                "sale_item_id": r.get::<_, i64>(1)?,
                "product_id": r.get::<_, Option<i64>>(2)?,
                "barcode": r.get::<_, String>(3)?,
                "name_fr": r.get::<_, String>(4)?,
                "name_ar": r.get::<_, String>(5)?,
                "unit_price_ct": r.get::<_, i64>(6)?,
                "qty_milli": r.get::<_, i64>(7)?,
                "unit": r.get::<_, String>(8)?,
                "tva_rate": r.get::<_, i64>(9)?,
                "line_ht_ct": r.get::<_, i64>(10)?,
                "line_tva_ct": r.get::<_, i64>(11)?,
                "line_ttc_ct": r.get::<_, i64>(12)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut arr = Vec::new();
    for line in lines {
        arr.push(line.map_err(|e| e.to_string())?);
    }
    h["items"] = Value::Array(arr);
    Ok(h)
}

fn return_head_json(r: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(serde_json::json!({
        "id": r.get::<_, String>(0)?,
        "return_number": r.get::<_, Option<String>>(1)?,
        "sale_id": r.get::<_, String>(2)?,
        "invoice_number": r.get::<_, String>(3)?,
        "payment_method": r.get::<_, String>(4)?,
        "status": r.get::<_, String>(5)?,
        "reason": r.get::<_, String>(6)?,
        "actor": r.get::<_, String>(7)?,
        "approver": r.get::<_, String>(8)?,
        "sale_day": r.get::<_, String>(9)?,
        "posting_day": r.get::<_, Option<String>>(10)?,
        "refund_ct": r.get::<_, i64>(11)?,
        "created_at": r.get::<_, String>(12)?,
    }))
}

pub fn return_list(conn: &Connection, status: Option<String>) -> Result<Value, String> {
    const BASE: &str = "SELECT id, return_number, sale_id, invoice_number, payment_method,
          status, reason, actor, approver, sale_day, posting_day, refund_ct, created_at
         FROM returns";
    let mut arr = Vec::new();
    match status.as_deref() {
        Some(s) if ["DRAFT", "APPROVED", "REJECTED"].contains(&s) => {
            let mut st = conn
                .prepare(&format!(
                    "{BASE} WHERE status = ?1 ORDER BY created_at DESC, id DESC LIMIT 200"
                ))
                .map_err(|e| e.to_string())?;
            let rows = st
                .query_map([s], return_head_json)
                .map_err(|e| e.to_string())?;
            for row in rows {
                arr.push(row.map_err(|e| e.to_string())?);
            }
        }
        _ => {
            let mut st = conn
                .prepare(&format!(
                    "{BASE} ORDER BY created_at DESC, id DESC LIMIT 200"
                ))
                .map_err(|e| e.to_string())?;
            let rows = st
                .query_map([], return_head_json)
                .map_err(|e| e.to_string())?;
            for row in rows {
                arr.push(row.map_err(|e| e.to_string())?);
            }
        }
    }
    Ok(Value::Array(arr))
}

/// v1.5.0 (RETURNS lookup): sale head + lines with APPROVED-returned and
/// remaining qty, found by UUID id OR FACT number. Null when unknown.
/// Read-only twin of the TS `getSaleForReturn` (same shape, same guard math).
pub fn sale_for_return(conn: &Connection, key: &str) -> Result<Value, String> {
    let k = key.trim();
    if k.is_empty() {
        return Ok(Value::Null);
    }
    let head: Option<Value> = conn
        .query_row(
            "SELECT id, invoice_number, status, created_at, payment_method,
              client_name, total_ttc_ct
             FROM sales WHERE id = ?1 OR invoice_number = ?1",
            [k],
            |r| {
                Ok(serde_json::json!({
                    "id": r.get::<_, String>(0)?,
                    "invoice_number": r.get::<_, String>(1)?,
                    "status": r.get::<_, String>(2)?,
                    "created_at": r.get::<_, String>(3)?,
                    "payment_method": r.get::<_, String>(4)?,
                    "client_name": r.get::<_, Option<String>>(5)?,
                    "total_ttc_ct": r.get::<_, i64>(6)?,
                }))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(h) = head else {
        return Ok(Value::Null);
    };
    let sale_id = h["id"].as_str().unwrap_or_default().to_string();
    let mut st = conn
        .prepare(
            "SELECT si.id, si.product_id, si.barcode, si.name_fr, si.name_ar,
              si.unit_price_ct, si.qty_milli, si.unit, si.tva_rate, si.line_ttc_ct,
              COALESCE((SELECT SUM(ri.qty_milli) FROM return_items ri
                JOIN returns r ON r.id = ri.return_id
                WHERE r.sale_id = si.sale_id AND ri.sale_item_id = si.id
                  AND r.status = 'APPROVED'), 0) AS returned_milli
             FROM sale_items si WHERE si.sale_id = ?1 ORDER BY si.id ASC",
        )
        .map_err(|e| e.to_string())?;
    let lines = st
        .query_map([sale_id], |r| {
            let qty: i64 = r.get(6)?;
            let returned: i64 = r.get(10)?;
            Ok(serde_json::json!({
                "sale_item_id": r.get::<_, i64>(0)?,
                "product_id": r.get::<_, Option<i64>>(1)?,
                "barcode": r.get::<_, String>(2)?,
                "name_fr": r.get::<_, String>(3)?,
                "name_ar": r.get::<_, String>(4)?,
                "unit_price_ct": r.get::<_, i64>(5)?,
                "qty_milli": qty,
                "unit": r.get::<_, String>(7)?,
                "tva_rate": r.get::<_, i64>(8)?,
                "line_ttc_ct": r.get::<_, i64>(9)?,
                "returned_milli": returned,
                "remaining_milli": qty - returned,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut arr = Vec::new();
    for line in lines {
        arr.push(line.map_err(|e| e.to_string())?);
    }
    Ok(serde_json::json!({ "sale": h, "items": Value::Array(arr) }))
}

/// #004 (Phase A): legal day close — recompute from the ledger, lock the
/// day, chain the hash. Native twin of TS finalizeZReport (which additionally
/// verifies caller-supplied totals against the same ledger query).
pub fn z_close(
    conn: &mut Connection,
    day: &str,
    opening_time: &str,
    closing_time: &str,
) -> Result<Value, String> {
    if !valid_day(day) {
        return Err("[fiscal] day must be YYYY-MM-DD".to_string());
    }
    let year: i64 = day
        .get(0..4)
        .ok_or("[fiscal] bad day")?
        .parse()
        .map_err(|_| "[fiscal] bad day year")?;
    if !(2000..=2100).contains(&year) {
        return Err("[fiscal] bad day year".to_string());
    }
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    if day_locked(&tx, day)? {
        return Err(format!(
            "[fiscal] day {day} is already legally closed (Z FINALISÉ) — close refused"
        ));
    }
    // F2: aggregate the LOCAL day's UTC window, never the UTC prefix.
    let (wstart, wend) = day_bounds_utc(day)?;
    let (n, ht, _b0, b9, a9, b19, a19, tva, timbre, ttc, cash, cib, dah, cred, first, last): (
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        Option<String>,
        Option<String>,
    ) = tx
        .query_row(
            "SELECT COUNT(*),
               COALESCE(SUM(total_ht_ct), 0), COALESCE(SUM(tva0_base_ct), 0),
               COALESCE(SUM(tva9_base_ct), 0), COALESCE(SUM(tva9_amt_ct), 0),
               COALESCE(SUM(tva19_base_ct), 0), COALESCE(SUM(tva19_amt_ct), 0),
               COALESCE(SUM(total_tva_ct), 0), COALESCE(SUM(timbre_ct), 0),
               COALESCE(SUM(total_ttc_ct), 0),
               COALESCE(SUM(CASE WHEN payment_method = 'ESPECES' THEN total_ttc_ct ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN payment_method = 'CIB' THEN total_ttc_ct ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN payment_method = 'DAHABIYA' THEN total_ttc_ct ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN payment_method = 'CREDIT' THEN total_ttc_ct ELSE 0 END), 0),
               MIN(invoice_number), MAX(invoice_number)
             FROM sales WHERE status = 'COMPLETED' AND created_at >= ?1 AND created_at < ?2",
            [&wstart, &wend],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                    r.get(10)?,
                    r.get(11)?,
                    r.get(12)?,
                    r.get(13)?,
                    r.get(14)?,
                    r.get(15)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;
    let coll: i64 = tx
        .query_row(
            "SELECT COALESCE(SUM(total_collected_ct), 0) FROM client_settlements
             WHERE payment_method = 'ESPECES' AND date >= ?1 AND date < ?2",
            [&wstart, &wend],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    // v1.5.0 (RETURNS): approved returns posted this day net the sales down.
    // Timbre is NOT netted (stamp duty on the original document, non-refundable).
    // Mirrors the TS computeDayAggregates return leg exactly (posting_day = day).
    let (rn, rht, rb9, ra9, rb19, ra19, rtva, rttc, rcash, rcib, rdah, rcred): (
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
        i64,
    ) = tx
        .query_row(
            "SELECT COUNT(*),
               COALESCE(SUM(ri.line_ht_ct), 0),
               COALESCE(SUM(CASE WHEN ri.tva_rate = 9 THEN ri.line_ht_ct ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN ri.tva_rate = 9 THEN ri.line_tva_ct ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN ri.tva_rate = 19 THEN ri.line_ht_ct ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN ri.tva_rate = 19 THEN ri.line_tva_ct ELSE 0 END), 0),
               COALESCE(SUM(ri.line_tva_ct), 0),
               COALESCE(SUM(ri.line_ttc_ct), 0),
               COALESCE(SUM(CASE WHEN r.payment_method = 'ESPECES' THEN ri.line_ttc_ct ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN r.payment_method = 'CIB' THEN ri.line_ttc_ct ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN r.payment_method = 'DAHABIYA' THEN ri.line_ttc_ct ELSE 0 END), 0),
               COALESCE(SUM(CASE WHEN r.payment_method = 'CREDIT' THEN ri.line_ttc_ct ELSE 0 END), 0)
             FROM return_items ri JOIN returns r ON r.id = ri.return_id
             WHERE r.status = 'APPROVED' AND r.posting_day = ?1",
            [day],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                    r.get(10)?,
                    r.get(11)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;
    // TVA-0 base is derived (HT minus the 9/19 bases) so the tier invariant
    // can never drift; every money column below is NET of approved returns.
    let (nht, nb9, na9, nb19, na19, ntva, nttc, ncash, ncib, ndah, ncred) = (
        ht - rht,
        b9 - rb9,
        a9 - ra9,
        b19 - rb19,
        a19 - ra19,
        tva - rtva,
        ttc - rttc,
        cash - rcash,
        cib - rcib,
        dah - rdah,
        cred - rcred,
    );
    let nb0 = nht - nb9 - nb19;
    let prev: String = match tx.query_row(
        "SELECT hash FROM z_reports ORDER BY rowid DESC LIMIT 1",
        [],
        |r| r.get::<_, String>(0),
    ) {
        Ok(h) => h,
        Err(rusqlite::Error::QueryReturnedNoRows) => "0".repeat(64),
        Err(e) => return Err(e.to_string()),
    };
    let number = format!("Z-{year}-{n:06}", n = bump_seq(&tx, "Z", year)?);
    // The fiscal hash chains the NET day totals (same inputs as the TS lane).
    let hash = z_hash(&prev, &number, day, nttc, timbre);
    tx.execute(
        "INSERT INTO z_reports (report_number, day, opening_time, closing_time,
          total_sales_count, total_ht_ct, tva0_base_ct, tva9_base_ct, tva9_amt_ct,
          tva19_base_ct, tva19_amt_ct, total_tva_ct, total_timbre_ct, total_ttc_ct,
          especes_gross_ct, cib_total_ct, dahabiya_total_ct, credit_granted_ct,
          credit_collected_ct, returns_count, returns_total_ttc_ct,
          first_invoice_number, last_invoice_number,
          prev_hash, hash, finalized, close_kind)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,1,'DAY')",
        rusqlite::params![
            number, day, opening_time, closing_time,
            n, nht, nb0, nb9, na9, nb19, na19, ntva, timbre, nttc,
            ncash, ncib, ndah, ncred, coll, rn, rttc,
            first.unwrap_or_default(), last.unwrap_or_default(),
            prev, hash,
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "report_number": number, "day": day,
        "opening_time": opening_time, "closing_time": closing_time,
        "sales_count": n, "total_ht_ct": nht, "total_tva_ct": ntva,
        "total_timbre_ct": timbre, "total_ttc_ct": nttc,
        "returns_count": rn, "returns_total_ttc_ct": rttc,
        "hash": hash, "prev_hash": prev,
    }))
}

/// #003 (Phase A): day summary for the Z lane — read-only. COMPLETED sales
/// only; voids counted separately. The legal day-LOCK lives in #004.
/// v1.5.0: money is NET of approved returns posted this day (same ledger as
/// z_close); timbre stays gross (non-refundable, accountant to confirm).
pub fn daily_z(conn: &Connection, day: &str) -> Result<Value, String> {
    if day.len() != 10 || day.as_bytes()[4] != b'-' || day.as_bytes()[7] != b'-' {
        return Err("[fiscal] day must be YYYY-MM-DD".to_string());
    }
    // F2: the label is a LOCAL day — aggregate its UTC window.
    let (wstart, wend) = day_bounds_utc(day)?;
    let (count, total): (i64, Option<i64>) = conn
        .query_row(
            "SELECT COUNT(*), SUM(total_ttc_ct) FROM sales
             WHERE created_at >= ?1 AND created_at < ?2 AND status = 'COMPLETED'",
            [&wstart, &wend],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let voids: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sales WHERE created_at >= ?1 AND created_at < ?2 AND status = 'CANCELLED'",
            [&wstart, &wend],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let (returns_count, returns_total): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(ri.line_ttc_ct), 0)
             FROM return_items ri JOIN returns r ON r.id = ri.return_id
             WHERE r.status = 'APPROVED' AND r.posting_day = ?1",
            [day],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    // #004: the UI locks the void surface (and shows JOUR VERROUILLÉ) when
    // a legal DAY close already freezes the day.
    let locked = day_locked(conn, day)?;
    Ok(serde_json::json!({
        "day": day,
        "sales_count": count,
        "total_ttc_ct": total.unwrap_or(0) - returns_total,
        "voids_count": voids,
        "returns_count": returns_count,
        "returns_total_ttc_ct": returns_total,
        "closed": locked,
    }))
}

/// #003 (Phase A): hot snapshot — VACUUM INTO a sibling file. Mirrors the
/// TS `backupTo` contract (.db suffix, parents created).
pub fn backup_db(conn: &Connection, dest: &str) -> Result<Value, String> {
    if !dest.ends_with(".db") {
        return Err("[fiscal] backup destination must end with .db".to_string());
    }
    if let Some(parent) = std::path::Path::new(dest).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    let escaped = dest.replace('\'', "''");
    conn.execute_batch(&format!("VACUUM INTO '{escaped}'"))
        .map_err(|e| e.to_string())?;
    let bytes = std::fs::metadata(dest).map_err(|e| e.to_string())?.len();
    Ok(serde_json::json!({ "path": dest, "bytes": bytes }))
}

/// P3 (v1.4.4): register a hot snapshot (usually just taken by `backup_db`)
/// in `backups_log` with the retention-exempt flag when it is a pre-reset
/// safety archive. Computes size + SHA-256 over the file bytes itself.
pub fn register_backup(
    conn: &Connection,
    id: &str,
    dest: &str,
    label: &str,
    app_version: &str,
    exempt: bool,
) -> Result<Value, String> {
    let bytes = std::fs::read(dest).map_err(|e| format!("[fiscal] snapshot unreadable: {e}"))?;
    let sha: String = crate::auth::sha256_bytes(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let size = bytes.len() as i64;
    let sales: i64 = conn
        .query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let products: i64 = conn
        .query_row("SELECT COUNT(*) FROM products", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let schema: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let filename = dest.rsplit(['/', '\\']).next().unwrap_or(dest);
    conn.execute(
        "INSERT INTO backups_log (id, filename, file_path, file_size_bytes, sha256_checksum,
          sales_count, products_count, status, created_at, exempt)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'VERIFIED', datetime('now'), ?8)",
        rusqlite::params![
            id,
            filename,
            dest,
            size,
            sha,
            sales,
            products,
            if exempt { 1 } else { 0 }
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "id": id, "filename": filename, "filePath": dest,
        "fileSizeBytes": size, "sha256Checksum": sha,
        "salesCount": sales, "productsCount": products,
        "status": "VERIFIED", "label": label,
        "appVersion": app_version, "schemaVersion": schema,
        "exempt": exempt,
    }))
}

/// v1.4.9 (#PROD-LOCAL): self-contained hot backup. The dest is derived
/// from the live DB dir (…/backups/baraka-YYYYMMDD-HHMMSS[-label][-n].db),
/// then VACUUM + integrity check + register + retention prune (newest 30
/// non-exempt). No :3100 needed — the installed app backs itself up.
pub fn backup_create(
    conn: &Connection,
    dir: &std::path::Path,
    label: &str,
    app_version: &str,
) -> Result<Value, String> {
    let bdir = dir.join("backups");
    std::fs::create_dir_all(&bdir).map_err(|e| format!("[fiscal] backups dir: {e}"))?;
    let stamp = now_iso().replace(['-', ':', 'T', '.', 'Z'], "");
    let clean: String = label
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(24)
        .collect();
    let mut n = 0;
    let dest = loop {
        let suffix = if n == 0 {
            String::new()
        } else {
            format!("-{n}")
        };
        let name = if clean.is_empty() {
            format!("baraka-{stamp}{suffix}.db")
        } else {
            format!("baraka-{stamp}-{clean}{suffix}.db")
        };
        let p = bdir.join(&name);
        if !p.exists() {
            break p;
        }
        n += 1;
    };
    let dest_s = dest.to_string_lossy().to_string();
    backup_db(conn, &dest_s)?;
    // Integrity gate on the snapshot itself (same rule as the TS lane).
    let snap = Connection::open(&dest).map_err(|e| e.to_string())?;
    let check: String = snap
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if check != "ok" {
        return Err(format!("[fiscal] snapshot integrity_check failed: {check}"));
    }
    let filename = dest
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or(dest_s.clone());
    let meta = register_backup(conn, &filename, &dest_s, &clean, app_version, false)?;
    // Retention: newest 30 non-exempt survive; older files + rows are pruned.
    let mut rows: Vec<(String, String)> = vec![];
    {
        let mut st = conn.prepare("SELECT id, file_path FROM backups_log WHERE exempt != 1 ORDER BY created_at DESC, rowid DESC").map_err(|e| e.to_string())?;
        let it = st
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        for r in it {
            rows.push(r.map_err(|e| e.to_string())?);
        }
    }
    for (oid, opath) in rows.iter().skip(30) {
        let _ = std::fs::remove_file(opath);
        let manifest = format!("{opath}.manifest.json");
        let _ = std::fs::remove_file(&manifest);
        let _ = conn.execute("DELETE FROM backups_log WHERE id = ?1", [oid]);
    }
    Ok(meta)
}

/// v1.4.9 (#PROD-LOCAL): list registered hot snapshots (newest first).
pub fn backup_list(conn: &Connection) -> Result<Value, String> {
    let mut st = conn.prepare("SELECT id, filename, file_path, file_size_bytes, sha256_checksum, sales_count, products_count, status, created_at, exempt FROM backups_log ORDER BY created_at DESC, rowid DESC LIMIT 100").map_err(|e| e.to_string())?;
    let it = st.query_map([], |r| {
        Ok(serde_json::json!({
            "id": r.get::<_, String>(0)?, "filename": r.get::<_, String>(1)?,
            "filePath": r.get::<_, String>(2)?, "fileSizeBytes": r.get::<_, i64>(3)?,
            "sha256Checksum": r.get::<_, String>(4)?, "salesCount": r.get::<_, i64>(5)?,
            "productsCount": r.get::<_, i64>(6)?, "status": r.get::<_, String>(7)?,
            "createdAt": r.get::<_, String>(8)?, "exempt": r.get::<_, i64>(10).unwrap_or(0) == 1,
        }))
    }).map_err(|e| e.to_string())?;
    let mut rows = vec![];
    for r in it {
        rows.push(r.map_err(|e| e.to_string())?);
    }
    Ok(Value::Array(rows))
}

/// v1.4.9 (#PROD-LOCAL): Z registry for the exe (reprint + chain after restart).
pub fn z_list(conn: &Connection) -> Result<Value, String> {
    let cols = "day, report_number, closing_time, hash, prev_hash, total_sales_count, total_ht_ct, tva0_base_ct, tva9_base_ct, tva9_amt_ct, tva19_base_ct, tva19_amt_ct, total_tva_ct, total_timbre_ct, total_ttc_ct, especes_gross_ct, cib_total_ct, dahabiya_total_ct, credit_granted_ct, credit_collected_ct, first_invoice_number, last_invoice_number, close_kind";
    let mut st = conn
        .prepare(&format!(
            "SELECT {cols} FROM z_reports ORDER BY day DESC LIMIT 200"
        ))
        .map_err(|e| e.to_string())?;
    let it = st.query_map([], |r| {
        Ok(serde_json::json!({
            "day": r.get::<_, String>(0)?, "report_number": r.get::<_, String>(1)?,
            "closing_time": r.get::<_, String>(2)?, "hash": r.get::<_, String>(3)?,
            "prev_hash": r.get::<_, String>(4)?, "total_sales_count": r.get::<_, i64>(5)?,
            "total_ht_ct": r.get::<_, i64>(6)?, "tva0_base_ct": r.get::<_, i64>(7)?,
            "tva9_base_ct": r.get::<_, i64>(8)?, "tva9_amt_ct": r.get::<_, i64>(9)?,
            "tva19_base_ct": r.get::<_, i64>(10)?, "tva19_amt_ct": r.get::<_, i64>(11)?,
            "total_tva_ct": r.get::<_, i64>(12)?, "total_timbre_ct": r.get::<_, i64>(13)?,
            "total_ttc_ct": r.get::<_, i64>(14)?, "especes_gross_ct": r.get::<_, i64>(15)?,
            "cib_total_ct": r.get::<_, i64>(16)?, "dahabiya_total_ct": r.get::<_, i64>(17)?,
            "credit_granted_ct": r.get::<_, i64>(18)?, "credit_collected_ct": r.get::<_, i64>(19)?,
            "first_invoice_number": r.get::<_, String>(20)?, "last_invoice_number": r.get::<_, String>(21)?,
            "close_kind": r.get::<_, String>(22)?,
        }))
    }).map_err(|e| e.to_string())?;
    let mut rows = vec![];
    for r in it {
        rows.push(r.map_err(|e| e.to_string())?);
    }
    let prev: String = conn
        .query_row(
            "SELECT hash FROM z_reports ORDER BY rowid DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap_or_else(|_| "GENESIS".to_string());
    Ok(serde_json::json!({ "rows": rows, "prev_hash": prev }))
}

fn loss_reason_ok(r: &str) -> bool {
    matches!(
        r,
        "EXPIRED" | "BROKEN" | "DAMAGED" | "THEFT" | "INTERNAL_USE" | "AUTRE"
    )
}

/// v1.4.9 (#PROD-LOCAL): fiscal loss twin of the TS lane — ledger row +
/// stock decrement atomically; product must exist with sufficient stock.
pub fn record_loss(conn: &mut Connection, input: &Value) -> Result<Value, String> {
    let product_id = input["product_id"]
        .as_i64()
        .ok_or("[fiscal] loss needs product_id")?;
    let qty = input["qty_milli"]
        .as_i64()
        .ok_or("[fiscal] loss needs qty_milli")?;
    if qty <= 0 {
        return Err(format!("[fiscal] loss qty_milli must be > 0 (got {qty})"));
    }
    let reason = str_field(&input["reason"], "reason")?;
    if !loss_reason_ok(&reason) {
        return Err(format!("[fiscal] bad loss reason: {reason}"));
    }
    let unit_cost = input["unit_cost_ct"].as_i64().unwrap_or(0);
    if unit_cost < 0 {
        return Err("[fiscal] loss unit_cost_ct must be >= 0".to_string());
    }
    let total = input["total_loss_ct"]
        .as_i64()
        .unwrap_or((unit_cost * qty) / 1000);
    if total < 0 {
        return Err("[fiscal] loss total_loss_ct must be >= 0".to_string());
    }
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let stock: i64 = tx
        .query_row(
            "SELECT stock_milli FROM products WHERE id = ?1",
            [product_id],
            |r| r.get(0),
        )
        .map_err(|_| format!("[fiscal] loss target product not found: {product_id}"))?;
    if qty > stock {
        return Err(format!(
            "[fiscal] loss qty {qty} exceeds stock {stock} (product {product_id})"
        ));
    }
    tx.execute(
        "INSERT INTO inventory_losses (product_id, qty_milli, reason, unit_cost_ct, total_loss_ct, notes, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        rusqlite::params![product_id, qty, reason, unit_cost, total, opt_str(&input["notes"], "notes")?, now_iso()],
    ).map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE products SET stock_milli = stock_milli - ?1 WHERE id = ?2",
        rusqlite::params![qty, product_id],
    )
    .map_err(|e| e.to_string())?;
    let left: i64 = tx
        .query_row(
            "SELECT stock_milli FROM products WHERE id = ?1",
            [product_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "stock_milli": left }))
}

/// P3 (v1.4.4): audited clean-start — the mirror of the TS `factoryReset`.
/// Refuses unless a VERIFIED exempt pre-reset archive exists and matches its
/// bytes. Append-only triggers are dropped and rebuilt inside the same
/// Immediate transaction (never left dropped); the audit log restarts with a
/// single genesis row citing the archive.
pub fn factory_reset(conn: &Connection, archive_ref: &str, actor: &str) -> Result<Value, String> {
    let (fp, sha): (String, String) = conn
        .query_row(
            "SELECT file_path, sha256_checksum FROM backups_log
             WHERE (file_path = ?1 OR filename = ?1) AND exempt = 1 AND status = 'VERIFIED'
             ORDER BY created_at DESC LIMIT 1",
            [archive_ref],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|_| {
            "[fiscal] factory-reset refused: no VERIFIED exempt pre-reset archive".to_string()
        })?;
    let bytes = std::fs::read(&fp)
        .map_err(|_| "[fiscal] factory-reset refused: archive file missing".to_string())?;
    let actual: String = crate::auth::sha256_bytes(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    if actual.to_lowercase() != sha.to_lowercase() {
        return Err("[fiscal] factory-reset refused: archive checksum mismatch".to_string());
    }
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;
    let run = || -> Result<serde_json::Map<String, Value>, String> {
        let mut triggers: Vec<(String, String)> = Vec::new();
        {
            let mut stmt = conn
                .prepare(
                    "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name IN
                     ('trg_sales_no_delete', 'trg_sale_items_no_delete',
                      'trg_settlements_no_delete', 'trg_audit_no_delete')",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(|e| e.to_string())?;
            for row in rows {
                triggers.push(row.map_err(|e| e.to_string())?);
            }
        }
        for (name, _) in &triggers {
            conn.execute_batch(&format!(
                "DROP TRIGGER IF EXISTS \"{}\";",
                name.replace('"', "\"\"")
            ))
            .map_err(|e| e.to_string())?;
        }
        // Children before parents (foreign_keys=ON aborts parent-first deletes).
        let tables = [
            "sale_items",
            "client_settlements",
            "purchase_items",
            "purchases",
            "supplier_payments",
            "void_log",
            "cash_movements",
            "cash_sessions",
            "z_reports",
            "inventory_losses",
            "sales",
            "seq",
            "active_cart_draft",
            "audit_log",
        ];
        let mut cleared = serde_json::Map::new();
        for table in tables {
            let exists: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            if exists == 0 {
                continue;
            }
            let n = conn
                .execute(
                    &format!("DELETE FROM \"{}\";", table.replace('"', "\"\"")),
                    [],
                )
                .map_err(|e| e.to_string())?;
            cleared.insert(table.to_string(), serde_json::json!(n as i64));
        }
        for (_, sql) in &triggers {
            conn.execute_batch(sql).map_err(|e| e.to_string())?;
        }
        conn.execute(
            "INSERT INTO audit_log (ts, actor, action, entity, entity_id, detail)
             VALUES (datetime('now'), ?1, 'factory_reset', '', '', ?2)",
            rusqlite::params![
                actor,
                format!("clean start by {actor}; pre-reset archive {fp}")
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(cleared)
    };
    match run() {
        Ok(cleared) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok(serde_json::json!({ "cleared": cleared, "archive": fp }))
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(e)
        }
    }
}

// ── v1.4.6: native cash-session lane (production independence).
// The installed app has no :3100 loopback, so the Cloture page and the POS
// till-expense path were dead on user machines ("Mode autonome"). These
// twins mirror TS sqlite.ts semantics exactly: single OPEN session, guarded
// movements, live theoretical, atomic SHIFT close with a hash-chained Z.
// Views call invoke-first, loopback second; legacy files get the tables
// idempotently here (same DDL as db/schema.sql).

pub(crate) fn now_iso() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z",
        y,
        m,
        d,
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

fn ensure_cash_tables(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS cash_sessions (
           id                 TEXT PRIMARY KEY,
           cashier_name       TEXT NOT NULL,
           opened_at          TEXT NOT NULL DEFAULT (datetime('now')),
           closed_at          TEXT,
           opening_float_ct   INTEGER NOT NULL DEFAULT 0,
           closing_counted_ct INTEGER,
           theoretical_cash_ct INTEGER,
           cash_diff_ct       INTEGER,
           status             TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')) DEFAULT 'OPEN',
           z_report_id        TEXT REFERENCES z_reports (report_number),
           notes              TEXT
         );
         CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON cash_sessions (status);
         CREATE TABLE IF NOT EXISTS cash_movements (
           id            TEXT PRIMARY KEY,
           session_id    TEXT NOT NULL REFERENCES cash_sessions (id) ON DELETE CASCADE,
           movement_type TEXT NOT NULL CHECK (movement_type IN ('DEPOSIT', 'WITHDRAWAL', 'EXPENSE')),
           amount_ct     INTEGER NOT NULL CHECK (amount_ct > 0),
           reason        TEXT NOT NULL,
           created_at    TEXT NOT NULL DEFAULT (datetime('now'))
         );
         CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements (session_id);",
    )
    .map_err(|e| e.to_string())
}

/// Single-OPEN-session open. Mirrors TS openCashSession (name non-empty,
/// float >= 0, refuses when a session is already OPEN).
pub fn cash_open(
    conn: &rusqlite::Connection,
    id: &str,
    cashier_name: &str,
    opening_float_ct: i64,
) -> Result<serde_json::Value, String> {
    ensure_cash_tables(conn)?;
    let name = cashier_name.trim();
    if name.is_empty() {
        return Err("[fiscal] cashierName must be non-empty".to_string());
    }
    if opening_float_ct < 0 {
        return Err("[fiscal] openingFloatCt must be >= 0".to_string());
    }
    if id.trim().is_empty() {
        return Err("[fiscal] cash session id must be non-empty".to_string());
    }
    let open: Option<String> = conn
        .query_row(
            "SELECT id FROM cash_sessions WHERE status = 'OPEN' LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(existing) = open {
        return Err(format!("[fiscal] cash session already OPEN: {existing}"));
    }
    let opened_at = now_iso();
    conn.execute(
        "INSERT INTO cash_sessions (id, cashier_name, opened_at, opening_float_ct, status)
         VALUES (?1, ?2, ?3, ?4, 'OPEN')",
        rusqlite::params![id, name, opened_at, opening_float_ct],
    )
    .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "id": id, "cashierName": name, "openedAt": opened_at,
        "openingFloatCt": opening_float_ct, "status": "OPEN",
    }))
}

/// Guarded movement (F3/F4 twins: amount > 0, reason non-empty, session OPEN).
pub fn cash_movement(
    conn: &rusqlite::Connection,
    id: &str,
    session_id: &str,
    movement_type: &str,
    amount_ct: i64,
    reason: &str,
) -> Result<serde_json::Value, String> {
    ensure_cash_tables(conn)?;
    if !["DEPOSIT", "WITHDRAWAL", "EXPENSE"].contains(&movement_type) {
        return Err(format!(
            "[fiscal] movement type must be DEPOSIT|WITHDRAWAL|EXPENSE (got {movement_type})"
        ));
    }
    if amount_ct <= 0 {
        return Err("[fiscal] movement amount must be > 0".to_string());
    }
    let why = reason.trim();
    if why.is_empty() {
        return Err("[fiscal] movement reason must be non-empty".to_string());
    }
    let status: Option<String> = conn
        .query_row(
            "SELECT status FROM cash_sessions WHERE id = ?1",
            [session_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match status.as_deref() {
        None => return Err(format!("[fiscal] cash session not found: {session_id}")),
        Some(s) if s != "OPEN" => {
            return Err(format!("[fiscal] cash session is {s}: {session_id}"))
        }
        _ => {}
    }
    let created_at = now_iso();
    conn.execute(
        "INSERT INTO cash_movements (id, session_id, movement_type, amount_ct, reason, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, session_id, movement_type, amount_ct, why, created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "id": id, "sessionId": session_id, "type": movement_type,
        "amountCt": amount_ct, "reason": why, "createdAt": created_at,
    }))
}

fn status_sums(
    conn: &rusqlite::Connection,
    opened_at: &str,
    end: &str,
    session_id: &str,
) -> Result<(i64, i64, i64, i64, i64, i64), String> {
    let (cash, n): (i64, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(CASE WHEN payment_method = 'ESPECES' THEN total_ttc_ct ELSE 0 END), 0),
                    COUNT(*)
             FROM sales WHERE status = 'COMPLETED' AND created_at >= ?1 AND created_at <= ?2",
            rusqlite::params![opened_at, end],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let settled: i64 = conn
        .query_row(
            "SELECT COALESCE(SUM(total_collected_ct), 0) FROM client_settlements
             WHERE payment_method = 'ESPECES' AND date >= ?1 AND date <= ?2",
            rusqlite::params![opened_at, end],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let (dep, wit, exp): (i64, i64, i64) = conn
        .query_row(
            "SELECT COALESCE(SUM(CASE WHEN movement_type = 'DEPOSIT' THEN amount_ct ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN movement_type = 'WITHDRAWAL' THEN amount_ct ELSE 0 END), 0),
                    COALESCE(SUM(CASE WHEN movement_type = 'EXPENSE' THEN amount_ct ELSE 0 END), 0)
             FROM cash_movements WHERE session_id = ?1",
            [session_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    Ok((cash, n, settled, dep, wit, exp))
}

/// Live till status. Mirrors TS getCashSessionStatus (same theoretical).
pub fn cash_session_status(
    conn: &rusqlite::Connection,
    session_id: &str,
) -> Result<serde_json::Value, String> {
    ensure_cash_tables(conn)?;
    let row: Option<(
        String,
        String,
        String,
        Option<String>,
        i64,
        Option<i64>,
        Option<i64>,
        Option<i64>,
        String,
        Option<String>,
        Option<String>,
    )> = conn
        .query_row(
            "SELECT id, cashier_name, opened_at, closed_at, opening_float_ct,
                    closing_counted_ct, theoretical_cash_ct, cash_diff_ct,
                    status, z_report_id, notes
             FROM cash_sessions WHERE id = ?1",
            [session_id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                    r.get(9)?,
                    r.get(10)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let (
        id,
        cashier_name,
        opened_at,
        closed_at,
        opening_float_ct,
        closing_counted_ct,
        theoretical_stored,
        diff_stored,
        status,
        z_report_id,
        notes,
    ) = row.ok_or_else(|| format!("[fiscal] cash session not found: {session_id}"))?;
    let end = if status == "OPEN" {
        now_iso()
    } else {
        closed_at.clone().unwrap_or_else(now_iso)
    };
    let (cash, n, settled, dep, wit, exp) = status_sums(conn, &opened_at, &end, &id)?;
    let theoretical = opening_float_ct + cash + settled + dep - wit - exp;
    let mut session = serde_json::json!({
        "id": id, "cashierName": cashier_name, "openedAt": opened_at,
        "openingFloatCt": opening_float_ct, "status": status,
    });
    if let Some(c) = closed_at {
        session["closedAt"] = serde_json::json!(c);
    }
    if let Some(c) = closing_counted_ct {
        session["closingCountedCt"] = serde_json::json!(c);
    }
    session["theoreticalCashCt"] = serde_json::json!(theoretical_stored.unwrap_or(theoretical));
    if let Some(d) = diff_stored {
        session["cashDiffCt"] = serde_json::json!(d);
    }
    if let Some(z) = z_report_id {
        session["zReportId"] = serde_json::json!(z);
    }
    if let Some(nt) = notes {
        session["notes"] = serde_json::json!(nt);
    }
    Ok(serde_json::json!({
        "session": session, "openingFloatCt": opening_float_ct,
        "cashSalesCt": cash, "settlementsCashCt": settled,
        "depositsCt": dep, "withdrawalsCt": wit, "expensesCt": exp,
        "theoreticalCashCt": theoretical, "totalSalesCount": n,
    }))
}

pub fn cash_active(conn: &rusqlite::Connection) -> Result<serde_json::Value, String> {
    ensure_cash_tables(conn)?;
    let open: Option<String> = conn
        .query_row(
            "SELECT id FROM cash_sessions WHERE status = 'OPEN' LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match open {
        None => Ok(serde_json::Value::Null),
        Some(id) => cash_session_status(conn, &id),
    }
}

pub fn cash_sessions(conn: &rusqlite::Connection, limit: i64) -> Result<serde_json::Value, String> {
    ensure_cash_tables(conn)?;
    let n = limit.clamp(1, 100);
    let mut st = conn
        .prepare(
            "SELECT id, cashier_name, opened_at, closed_at, opening_float_ct,
                    closing_counted_ct, theoretical_cash_ct, cash_diff_ct, status,
                    z_report_id, notes
             FROM cash_sessions ORDER BY opened_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map([n], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, Option<i64>>(5)?,
                r.get::<_, Option<i64>>(6)?,
                r.get::<_, Option<i64>>(7)?,
                r.get::<_, String>(8)?,
                r.get::<_, Option<String>>(9)?,
                r.get::<_, Option<String>>(10)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let (id, name, opened, closed, fl, counted, theo, diff, status, zid, notes) =
            row.map_err(|e| e.to_string())?;
        let mut s = serde_json::json!({
            "id": id, "cashierName": name, "openedAt": opened,
            "openingFloatCt": fl, "status": status,
        });
        if let Some(c) = closed {
            s["closedAt"] = serde_json::json!(c);
        }
        if let Some(c) = counted {
            s["closingCountedCt"] = serde_json::json!(c);
        }
        if let Some(t) = theo {
            s["theoreticalCashCt"] = serde_json::json!(t);
        }
        if let Some(d) = diff {
            s["cashDiffCt"] = serde_json::json!(d);
        }
        if let Some(z) = zid {
            s["zReportId"] = serde_json::json!(z);
        }
        if let Some(nt) = notes {
            s["notes"] = serde_json::json!(nt);
        }
        out.push(s);
    }
    Ok(serde_json::Value::Array(out))
}

pub fn cash_movements(
    conn: &rusqlite::Connection,
    session_id: &str,
    limit: i64,
) -> Result<serde_json::Value, String> {
    ensure_cash_tables(conn)?;
    let n = limit.clamp(1, 200);
    let mut st = conn
        .prepare(
            "SELECT id, session_id, movement_type, amount_ct, reason, created_at
             FROM cash_movements WHERE session_id = ?1
             ORDER BY created_at DESC, rowid DESC LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map(rusqlite::params![session_id, n], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, String>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let (id, sid, typ, amt, why, created) = row.map_err(|e| e.to_string())?;
        out.push(serde_json::json!({
            "id": id, "sessionId": sid, "type": typ,
            "amountCt": amt, "reason": why.unwrap_or_default(), "createdAt": created,
        }));
    }
    Ok(serde_json::Value::Array(out))
}

/// Atomic SHIFT close + hash-chained Z. Mirrors TS closeCashSessionAndGenerateZ:
/// day-lock (#004/F2), session-window aggregates, Z-{year}-{seq:06}, SHIFT.
pub fn cash_close_and_z(
    conn: &mut rusqlite::Connection,
    session_id: &str,
    counted_cash_ct: i64,
    notes: Option<&str>,
) -> Result<serde_json::Value, String> {
    ensure_cash_tables(conn)?;
    if counted_cash_ct < 0 {
        return Err("[fiscal] countedCashCt must be >= 0".to_string());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let run = || -> Result<serde_json::Value, String> {
        let row: Option<(String, String, i64, String)> = tx
            .query_row(
                "SELECT id, cashier_name, opening_float_ct, opened_at FROM cash_sessions WHERE id = ?1",
                [session_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let (id, cashier_name, opening_float_ct, opened_at) =
            row.ok_or_else(|| format!("[fiscal] cash session not found: {session_id}"))?;
        let status: String = tx
            .query_row(
                "SELECT status FROM cash_sessions WHERE id = ?1",
                [session_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if status != "OPEN" {
            return Err(format!(
                "[fiscal] cash session already {status}: {session_id}"
            ));
        }
        let period_end = now_iso();
        let period_day = algiers_day(&period_end)?;
        let locked: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM z_reports WHERE day = ?1 AND close_kind = 'DAY'",
                [&period_day],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if locked > 0 {
            return Err(format!(
                "[fiscal] day {period_day} is already legally closed (Z FINALISÉ) — shift close refused"
            ));
        }
        let agg: (i64, i64, i64, i64, i64, i64, i64, i64, i64, i64, i64, i64, Option<String>, Option<String>) = tx
            .query_row(
                "SELECT COUNT(*),
                   COALESCE(SUM(total_ht_ct), 0), COALESCE(SUM(tva9_base_ct), 0),
                   COALESCE(SUM(tva9_amt_ct), 0), COALESCE(SUM(tva19_base_ct), 0),
                   COALESCE(SUM(tva19_amt_ct), 0), COALESCE(SUM(timbre_ct), 0),
                   COALESCE(SUM(total_ttc_ct), 0),
                   COALESCE(SUM(CASE WHEN payment_method = 'ESPECES' THEN total_ttc_ct ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN payment_method = 'CIB' THEN total_ttc_ct ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN payment_method = 'DAHABIYA' THEN total_ttc_ct ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN payment_method = 'CREDIT' THEN total_ttc_ct ELSE 0 END), 0),
                   MIN(invoice_number), MAX(invoice_number)
                 FROM sales WHERE status = 'COMPLETED' AND created_at >= ?1 AND created_at <= ?2",
                rusqlite::params![opened_at, period_end],
                |r| {
                    Ok((
                        r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?,
                        r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?,
                        r.get(11)?, r.get(12)?, r.get(13)?,
                    ))
                },
            )
            .map_err(|e| e.to_string())?;
        let (n, ht, b9, a9, b19, a19, timbre, ttc, cash, cib, dah, cred, first, last) = agg;
        let settled: i64 = tx
            .query_row(
                "SELECT COALESCE(SUM(total_collected_ct), 0) FROM client_settlements
                 WHERE payment_method = 'ESPECES' AND date >= ?1 AND date <= ?2",
                rusqlite::params![opened_at, period_end],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let (dep, wit, exp): (i64, i64, i64) = tx
            .query_row(
                "SELECT COALESCE(SUM(CASE WHEN movement_type = 'DEPOSIT' THEN amount_ct ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN movement_type = 'WITHDRAWAL' THEN amount_ct ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN movement_type = 'EXPENSE' THEN amount_ct ELSE 0 END), 0)
                 FROM cash_movements WHERE session_id = ?1",
                [session_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|e| e.to_string())?;
        let theoretical = opening_float_ct + cash + settled + dep - wit - exp;
        let diff = counted_cash_ct - theoretical;
        let day = algiers_day(&period_end)?;
        let year: i64 = day[0..4].parse().map_err(|_| "[fiscal] bad day")?;
        let prev: Option<String> = tx
            .query_row(
                "SELECT hash FROM z_reports ORDER BY rowid DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let prev = prev.unwrap_or_else(|| "0".repeat(64));
        let number = format!("Z-{year}-{:06}", bump_seq(&tx, "Z", year)?);
        let hash = z_hash(&prev, &number, &day, ttc, timbre);
        tx.execute(
            "INSERT INTO z_reports (report_number, day, opening_time, closing_time,
              total_sales_count, total_ht_ct, tva0_base_ct, tva9_base_ct, tva9_amt_ct,
              tva19_base_ct, tva19_amt_ct, total_tva_ct, total_timbre_ct, total_ttc_ct,
              especes_gross_ct, cib_total_ct, dahabiya_total_ct, credit_granted_ct,
              credit_collected_ct, first_invoice_number, last_invoice_number,
              prev_hash, hash, finalized, close_kind)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, ?9, ?10, ?11, ?12, ?13,
                     ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, 1, 'SHIFT')",
            rusqlite::params![
                number,
                day,
                opened_at,
                period_end,
                n,
                ht,
                b9,
                a9,
                b19,
                a19,
                a9 + a19,
                timbre,
                ttc,
                cash,
                cib,
                dah,
                cred,
                settled,
                first.unwrap_or_default(),
                last.unwrap_or_default(),
                prev,
                hash,
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE cash_sessions SET status = 'CLOSED', closed_at = ?1, closing_counted_ct = ?2,
               theoretical_cash_ct = ?3, cash_diff_ct = ?4, z_report_id = ?5,
               notes = COALESCE(?6, notes) WHERE id = ?7",
            rusqlite::params![
                period_end,
                counted_cash_ct,
                theoretical,
                diff,
                number,
                notes,
                id
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(serde_json::json!({
            "zNumber": number, "sessionId": id, "cashierName": cashier_name,
            "periodStart": opened_at, "periodEnd": period_end,
            "totalHtCt": ht, "totalTva9Ct": a9, "totalTva19Ct": a19,
            "totalTimbreCt": timbre, "totalTtcCt": ttc, "salesCount": n,
            "cashSalesCt": cash, "cibSalesCt": cib, "dahabiyaSalesCt": dah,
            "creditSalesCt": cred, "settlementsCashCt": settled,
            "depositsCt": dep, "withdrawalsCt": wit, "expensesCt": exp,
            "openingFloatCt": opening_float_ct, "theoreticalCashCt": theoretical,
            "closingCountedCt": counted_cash_ct, "cashDiffCt": diff,
            "hash": hash, "prevHash": prev,
        }))
    };
    match run() {
        Ok(v) => {
            tx.commit().map_err(|e| e.to_string())?;
            Ok(v)
        }
        Err(e) => {
            let _ = tx.rollback();
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    const SCHEMA: &str = include_str!("../../db/schema.sql");

    fn memdb() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        migrate(&conn).unwrap();
        conn.execute(
            "INSERT INTO products (id, barcode, name_fr, buy_price_ct, stock_milli, sell_price_ct, tva_rate, unit)
             VALUES (1, 'a', 'LAIT', 12000, 48000, 18000, 9, 'PIECE')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO clients (id, name, credit_balance_ct) VALUES (1, 'Zed', 500000)",
            [],
        )
        .unwrap();
        conn
    }

    fn sale_header(key: Option<&str>) -> Value {
        serde_json::json!({
            "id": "s1", "cashier_id": "C-1", "cashier_name": "Amine",
            "client_id": null, "client_name": null,
            "payment_method": "ESPECES", "amount_paid_ct": 200000, "amount_returned_ct": 20600,
            "client_sale_id": key,
            "totals": { "total_ht_ct": 165528, "total_tva_ct": 12072, "timbre_ct": 1800,
                        "total_ttc_ct": 179400,
                        "tva_breakdown": {
                            "0": {"base_ht_ct": 65000, "tva_amount_ct": 0, "total_ttc_ct": 65000},
                            "9": {"base_ht_ct": 70276, "tva_amount_ct": 6324, "total_ttc_ct": 76600},
                            "19": {"base_ht_ct": 30252, "tva_amount_ct": 5748, "total_ttc_ct": 36000}}},
            "is_facture": 0, "created_at": "2026-11-01T12:00:00.000Z"
        })
    }

    fn sale_items() -> Vec<Value> {
        vec![
            serde_json::json!({"product_id": 1, "barcode": "a", "name_fr": "LAIT", "name_ar": "", "unit_price_ct": 18000, "qty_milli": 2000, "unit": "PIECE", "tva_rate": 9, "discount_bp": 0, "line_ht_ct": 33028, "line_tva_ct": 2972, "line_ttc_ct": 36000}),
            serde_json::json!({"product_id": null, "barcode": "b", "name_fr": "HUILE", "name_ar": "", "unit_price_ct": 65000, "qty_milli": 1000, "unit": "PIECE", "tva_rate": 0, "discount_bp": 0, "line_ht_ct": 65000, "line_tva_ct": 0, "line_ttc_ct": 65000}),
            serde_json::json!({"product_id": null, "barcode": "c", "name_fr": "CHOC", "name_ar": "", "unit_price_ct": 12000, "qty_milli": 3000, "unit": "PIECE", "tva_rate": 19, "discount_bp": 0, "line_ht_ct": 30252, "line_tva_ct": 5748, "line_ttc_ct": 36000}),
            serde_json::json!({"product_id": null, "barcode": "d", "name_fr": "POMMES", "name_ar": "", "unit_price_ct": 28000, "qty_milli": 1450, "unit": "KG", "tva_rate": 9, "discount_bp": 0, "line_ht_ct": 37248, "line_tva_ct": 3352, "line_ttc_ct": 40600}),
        ]
    }

    #[test]
    fn native_sale_commits_and_dedupes_by_key() {
        let mut db = memdb();
        let h = sale_header(Some("K1"));
        let items = sale_items();
        let r1 = record_sale(&mut db, &h, &items).unwrap();
        assert_eq!(r1["invoice_number"], "FACT-2026-000001");
        let r2 = record_sale(&mut db, &h, &items).unwrap();
        assert_eq!(r2["id"], r1["id"]);
        let n: i64 = db
            .query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let stock: i64 = db
            .query_row("SELECT stock_milli FROM products WHERE id = 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(stock, 46000); // 48000 - 2000, once
    }

    #[test]
    fn native_sale_rejects_broken_invariant() {
        let mut db = memdb();
        let mut h = sale_header(Some("BAD"));
        h["totals"]["total_ttc_ct"] = serde_json::json!(179401);
        assert!(record_sale(&mut db, &h, &sale_items()).is_err());
        let n: i64 = db
            .query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn prodfail_ui_payload_shape_commits() {
        // v1.4.7 PROD-FAIL: the EXACT header the POS checkout builds today
        // (AppContext: fiscal_regime, tva/timbre flags, U- prefixed cashier,
        // 0/9/19 breakdown, ESPECES + change). Must commit on a fresh v8 DB.
        let mut db = memdb();
        let h = serde_json::json!({
            "id": "ui-1", "cashier_id": "U-7", "cashier_name": "Gérant",
            "client_id": null, "client_name": "Client Passager (Comptoir)",
            "payment_method": "ESPECES", "amount_paid_ct": 200000,
            "amount_returned_ct": 20600, "client_sale_id": "SALE-UI-1",
            "fiscal_regime": "TVA_ON/TIMBRE_ON", "tva_enabled": true, "timbre_enabled": true,
            "totals": { "total_ht_ct": 165528, "total_tva_ct": 12072, "timbre_ct": 1800,
                        "total_ttc_ct": 179400,
                        "tva_breakdown": {
                            "0": {"base_ht_ct": 65000, "tva_amount_ct": 0, "total_ttc_ct": 65000},
                            "9": {"base_ht_ct": 70276, "tva_amount_ct": 6324, "total_ttc_ct": 76600},
                            "19": {"base_ht_ct": 30252, "tva_amount_ct": 5748, "total_ttc_ct": 36000}}},
            "is_facture": 0, "created_at": "2026-11-05T12:00:00.000Z"
        });
        let r = record_sale(&mut db, &h, &sale_items()).unwrap();
        assert_eq!(r["invoice_number"], "FACT-2026-000001");
        let timbre: i64 = db
            .query_row("SELECT timbre_ct FROM sales", [], |r| r.get(0))
            .unwrap();
        assert_eq!(timbre, 1800);
    }

    #[test]
    fn prodsale_unknown_client_cash_walks_in_credit_refused() {
        // v1.4.8 PROD-SALE: the registry gap that froze the user's till
        // (walk-in id=1 on a DB whose clients table is empty).
        let mut db = memdb();
        db.execute("DELETE FROM clients", []).unwrap();
        let mut h = sale_header(Some("WALKIN"));
        h["client_id"] = serde_json::json!(1);
        h["client_name"] = serde_json::json!("Client Passager (Comptoir)");
        let r = record_sale(&mut db, &h, &sale_items()).unwrap();
        assert!(r["invoice_number"].as_str().unwrap().starts_with("FACT-"));
        let cid: Option<i64> = db
            .query_row("SELECT client_id FROM sales", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cid, None); // anonymous walk-in, name preserved on the row
        let mut h2 = sale_header(Some("CREDIT-GAP"));
        h2["client_id"] = serde_json::json!(1);
        h2["payment_method"] = serde_json::json!("CREDIT");
        h2["totals"]["timbre_ct"] = serde_json::json!(0);
        h2["totals"]["total_ttc_ct"] = serde_json::json!(177600);
        let err = record_sale(&mut db, &h2, &sale_items()).unwrap_err();
        assert!(err.contains("client inconnu"), "got: {err}");
    }

    #[test]
    fn native_settlement_commits_and_dedupes() {
        let mut db = memdb();
        let mk = |key: Option<&str>| {
            serde_json::json!({"id": "x1", "client_id": 1, "client_name": "Zed",
                "amount_ct": 100000, "payment_method": "ESPECES",
                "timbre_ct": 1000, "total_collected_ct": 101000,
                "client_settlement_key": key, "date": "2026-11-01T12:00:00.000Z", "note": null})
        };
        let r1 = record_settlement(&mut db, &mk(Some("ST-1"))).unwrap();
        assert_eq!(r1["receipt_number"], "Q-2026-000001");
        let r2 = record_settlement(&mut db, &mk(Some("ST-1"))).unwrap();
        assert_eq!(r2["id"], r1["id"]);
        let bal: i64 = db
            .query_row(
                "SELECT credit_balance_ct FROM clients WHERE id = 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(bal, 400000);
    }

    #[test]
    fn migrate_climbs_legacy_file() {
        // Faithful v1 file: strip BOTH key columns from the DDL (production
        // legacy files never had them — no DROP COLUMN simulation needed).
        // Also drop the trailing T8 block: v1 predates users/audit entirely.
        let mut legacy = SCHEMA
            .replace(
                "  created_at        TEXT    NOT NULL,\n  -- T1 (ADR-021): idempotency key minted by the checkout at finalize time.\n  -- Retried POSTs with the same key return the original row, never a new seq.\n  client_sale_id    TEXT\n);",
                "  created_at        TEXT    NOT NULL\n);",
            )
            .replace(
                "  note           TEXT,\n  -- T2b (ADR-024): idempotency key minted by the checkout at finalize.\n  client_settlement_key TEXT\n);",
                "  note           TEXT\n);",
            );
        assert!(!legacy.contains("client_sale_id"));
        assert!(!legacy.contains("client_settlement_key"));
        let cut = legacy
            .find("-- T8 (ADR-031)")
            .expect("T8 block must trail schema.sql");
        legacy.truncate(cut);
        assert!(!legacy.contains("CREATE TABLE users"));
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(&legacy).unwrap();
        conn.execute_batch("PRAGMA user_version = 1;").unwrap();
        migrate(&conn).unwrap();
        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, LATEST_SCHEMA_VERSION);
        // Regime v7: the climb also adds per-sale tva/timbre flags on legacy files.
        let has_regime: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('sales') WHERE name IN ('tva_enabled','timbre_enabled')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_regime, 2);
        // Reset-safety v8: the climb adds the retention-exempt flag on legacy files.
        let has_exempt: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('backups_log') WHERE name = 'exempt'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_exempt, 1);
        // #004: the climb also adds close_kind (DAY lock marker) on legacy files.
        let has_kind: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('z_reports') WHERE name = 'close_kind'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_kind, 1);
        // T11: the climb also restores the append-only triggers on legacy files.
        let trig: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .map(|t| t.unwrap())
            .collect();
        for t in [
            "trg_sales_no_delete",
            "trg_sales_terminal",
            "trg_audit_no_update",
        ] {
            assert!(trig.contains(&t.to_string()), "trigger {t} restored");
        }
        // Both key columns now exist after the climb.
        let cols: Vec<String> = conn
            .prepare("PRAGMA table_info(sales)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .map(|c| c.unwrap())
            .collect();
        assert!(cols.contains(&"client_sale_id".to_string()));
        let cols2: Vec<String> = conn
            .prepare("PRAGMA table_info(client_settlements)")
            .unwrap()
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .map(|c| c.unwrap())
            .collect();
        assert!(cols2.contains(&"client_settlement_key".to_string()));
    }

    #[test]
    fn migrate_reopen_after_climb_stays_ok() {
        // Cumulative-update contract: migrate() must accept the file it just
        // stamped. A step that writes user_version = N while LATEST stays N-1
        // bricks EVERY native command on second launch (v1.4.0 iron outage:
        // db_status/audit_list/login all refused with "newer than this build").
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        conn.execute_batch("PRAGMA user_version = 6;").unwrap();
        migrate(&conn).unwrap(); // first open climbs 6 → 7
        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, LATEST_SCHEMA_VERSION);
        // Second open (app relaunch, updater restart…) must also succeed.
        migrate(&conn).unwrap();
        let v2: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v2, LATEST_SCHEMA_VERSION);
    }

    #[test]
    fn triggers_block_raw_sql_abuse() {
        // T11 (ADR-034): even direct SQL cannot delete fiscal rows or resurrect
        // a CANCELLED sale. The legal void path has no native command yet —
        // the trigger guards the invariant at the storage layer regardless.
        let mut db = memdb();
        record_sale(&mut db, &sale_header(Some("TRG-1")), &sale_items()).unwrap();
        assert!(db.execute("DELETE FROM sales", []).is_err());
        assert!(db.execute("DELETE FROM sale_items", []).is_err());
        db.execute("UPDATE sales SET status = 'CANCELLED'", [])
            .unwrap();
        assert!(db
            .execute("UPDATE sales SET status = 'COMPLETED'", [])
            .is_err());
        let st = serde_json::json!({"id": "st1", "client_id": 1, "client_name": "Zed",
            "amount_ct": 100000, "payment_method": "ESPECES",
            "timbre_ct": 1000, "total_collected_ct": 101000,
            "client_settlement_key": "TRG-ST", "date": "2026-11-01T12:00:00.000Z", "note": null});
        record_settlement(&mut db, &st).unwrap();
        assert!(db.execute("DELETE FROM client_settlements", []).is_err());
    }

    #[test]
    fn next_invoice_mints_gapless_sequences() {
        // #003 gate: the SAME primitive every lane shares — 1000 mints, no gap.
        let mut db = memdb();
        for i in 1..=1000 {
            let r = next_invoice(&mut db, "FACT", 2026).unwrap();
            assert_eq!(r["number"], format!("FACT-2026-{i:06}"));
        }
        assert_eq!(
            next_invoice(&mut db, "T", 2026).unwrap()["number"],
            "T-2026-000001"
        );
        assert_eq!(
            next_invoice(&mut db, "Q", 2026).unwrap()["number"],
            "Q-2026-000001"
        );
        assert!(next_invoice(&mut db, "X", 2026).is_err());
    }

    #[test]
    fn void_sale_flips_and_journals() {
        // #003: legal void keeps the row, explains in the journal, never DELETEs.
        let mut db = memdb();
        let r = record_sale(&mut db, &sale_header(Some("V-1")), &sale_items()).unwrap();
        let out = void_sale(&mut db, "s1", "wrong item scanned", "owner").unwrap();
        assert_eq!(out["status"], "CANCELLED");
        assert_eq!(out["invoice_number"], r["invoice_number"]);
        let st: String = db
            .query_row("SELECT status FROM sales WHERE id = 's1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(st, "CANCELLED");
        let j: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM void_log WHERE sale_id = 's1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(j, 1);
        assert!(void_sale(&mut db, "s1", "again", "owner").is_err()); // already voided
        assert!(void_sale(&mut db, "s1", "   ", "owner").is_err()); // reason required
        assert!(void_sale(&mut db, "nope", "reason", "owner").is_err()); // unknown id
    }

    #[test]
    fn returns_happy_path_mints_ret_restocks_and_withdraws() {
        // v1.5.0: draft (no number) → approve (RET-YYYY-XXXXXX, stock back,
        // WITHDRAWAL, audit). Mirrors the TS returns.test.ts happy path.
        let mut db = memdb();
        record_sale(&mut db, &sale_header(Some("R-1")), &sale_items()).unwrap();
        cash_open(&db, "sess-ret", "Amine", 1_000_000).unwrap();
        let item_id: i64 = db
            .query_row(
                "SELECT id FROM sale_items WHERE sale_id = 's1' ORDER BY id ASC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let items = serde_json::json!([{ "saleItemId": item_id, "qty_milli": 2000 }]).to_string();
        let d = return_create(
            &mut db,
            "s1",
            &items,
            "DEFECT",
            None,
            "lina",
            Some("k-ret-1".to_string()),
            "2026-11-01",
        )
        .unwrap();
        assert_eq!(d["refund_ct"], 36000);
        let id = d["id"].as_str().unwrap().to_string();
        // Idempotent retry: same key returns the same draft, no second row.
        let d2 = return_create(
            &mut db,
            "s1",
            &items,
            "DEFECT",
            None,
            "lina",
            Some("k-ret-1".to_string()),
            "2026-11-01",
        )
        .unwrap();
        assert_eq!(d2["id"].as_str().unwrap(), id);
        let got = return_get(&db, &id).unwrap();
        assert_eq!(got["status"], "DRAFT");
        assert!(got["return_number"].is_null());
        assert_eq!(got["items"].as_array().unwrap().len(), 1);
        let a = return_approve(&mut db, &id, "karim", "manager", "2026-11-01").unwrap();
        assert_eq!(a["return_number"], "RET-2026-000001");
        assert_eq!(a["refund_ct"], 36000);
        // Stock flowed back (2000 milli of LAIT returned to 48000).
        let stock: i64 = db
            .query_row("SELECT stock_milli FROM products WHERE id = 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(stock, 48000);
        // The refund rode the cash journal as a WITHDRAWAL.
        let w: i64 = db
            .query_row(
                "SELECT amount_ct FROM cash_movements
                 WHERE session_id = 'sess-ret' AND movement_type = 'WITHDRAWAL'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(w, 36000);
        // Both lane actions are audited.
        for action in ["return.create", "return.approve"] {
            let n: i64 = db
                .query_row(
                    "SELECT COUNT(*) FROM audit_log WHERE action = ?1",
                    [action],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 1, "missing audit {action}");
        }
        // Decided returns are terminal.
        assert!(return_approve(&mut db, &id, "owner2", "owner", "2026-11-01").is_err());
        assert!(return_reject(&mut db, &id, "owner2", None).is_err());
    }

    #[test]
    fn return_approve_refuses_when_drawer_short() {
        // A2 (supermarket): an ESPECES refund can never drive the drawer negative.
        let mut db = memdb();
        record_sale(&mut db, &sale_header(Some("R-9")), &sale_items()).unwrap();
        cash_open(&db, "sess-short", "Amine", 0).unwrap();
        // Drain exactly what the open session window holds — drawer now at 0.
        let opened: String = db
            .query_row(
                "SELECT opened_at FROM cash_sessions WHERE id = 'sess-short'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let (cash, _, settled, dep, wit, exp) =
            status_sums(&db, &opened, &now_iso(), "sess-short").unwrap();
        let holds = cash + settled + dep - wit - exp;
        assert!(holds >= 0);
        if holds > 0 {
            cash_movement(
                &db,
                "m-drain",
                "sess-short",
                "WITHDRAWAL",
                holds,
                "supplier run",
            )
            .unwrap();
        }
        let item_id: i64 = db
            .query_row(
                "SELECT id FROM sale_items WHERE sale_id = 's1' ORDER BY id ASC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let items = serde_json::json!([{ "saleItemId": item_id, "qty_milli": 2000 }]).to_string();
        let d = return_create(
            &mut db,
            "s1",
            &items,
            "DEFECT",
            None,
            "lina",
            Some("k-short-1".to_string()),
            "2026-11-01",
        )
        .unwrap();
        let id = d["id"].as_str().unwrap().to_string();
        let err = return_approve(&mut db, &id, "karim", "manager", "2026-11-01").unwrap_err();
        assert!(err.contains("drawer short"), "got: {err}");
        // Top up exactly the refund → approval passes.
        let refund = d["refund_ct"].as_i64().unwrap();
        cash_movement(&db, "m-top", "sess-short", "DEPOSIT", refund, "top-up").unwrap();
        assert!(return_approve(&mut db, &id, "karim", "manager", "2026-11-01").is_ok());
    }

    #[test]
    fn returns_guards_hold_window_roles_session_and_reject() {
        let mut db = memdb();
        record_sale(&mut db, &sale_header(Some("R-2")), &sale_items()).unwrap();
        let item_id: i64 = db
            .query_row(
                "SELECT id FROM sale_items WHERE sale_id = 's1' ORDER BY id ASC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let items = serde_json::json!([{ "saleItemId": item_id, "qty_milli": 2000 }]).to_string();
        // Bad reason, unknown sale, over-qty, empty actor.
        assert!(return_create(
            &mut db,
            "s1",
            &items,
            "NOPE",
            None,
            "lina",
            None,
            "2026-11-01"
        )
        .is_err());
        // A4 (supermarket): OTHER without a note is refused, with a note passes.
        assert!(return_create(
            &mut db,
            "s1",
            &items,
            "OTHER",
            None,
            "lina",
            None,
            "2026-11-01"
        )
        .is_err());
        assert!(return_create(
            &mut db,
            "s1",
            &items,
            "OTHER",
            Some("boite ecrasee".to_string()),
            "lina",
            None,
            "2026-11-01"
        )
        .is_ok());
        assert!(return_create(
            &mut db,
            "nope",
            &items,
            "DEFECT",
            None,
            "lina",
            None,
            "2026-11-01"
        )
        .is_err());
        let over = serde_json::json!([{ "saleItemId": item_id, "qty_milli": 2001 }]).to_string();
        assert!(return_create(
            &mut db,
            "s1",
            &over,
            "DEFECT",
            None,
            "lina",
            None,
            "2026-11-01"
        )
        .is_err());
        // Window: sale day is 2026-11-01 — day 7 passes, day 8 and the past refuse.
        assert!(return_create(
            &mut db,
            "s1",
            &items,
            "DEFECT",
            None,
            "lina",
            Some("k-w7".to_string()),
            "2026-11-08"
        )
        .is_ok());
        assert!(return_create(
            &mut db,
            "s1",
            &items,
            "DEFECT",
            None,
            "lina",
            None,
            "2026-11-09"
        )
        .is_err());
        assert!(return_create(
            &mut db,
            "s1",
            &items,
            "DEFECT",
            None,
            "lina",
            None,
            "2026-10-31"
        )
        .is_err());
        // Cashier can never approve; ESPECES needs an OPEN session.
        let d = return_create(
            &mut db,
            "s1",
            &items,
            "WRONG_ITEM",
            None,
            "lina",
            Some("k-g1".to_string()),
            "2026-11-01",
        )
        .unwrap();
        let id = d["id"].as_str().unwrap().to_string();
        assert!(return_approve(&mut db, &id, "lina", "cashier", "2026-11-01").is_err());
        assert!(return_approve(&mut db, &id, "karim", "manager", "2026-11-01").is_err()); // no session
        cash_open(&db, "sess-g", "Amine", 1_000_000).unwrap();
        assert!(return_approve(&mut db, &id, "karim", "manager", "2026-11-01").is_ok());
        // Reject path on a second draft. The first line is fully consumed by
        // the approval above, so the reject draft targets the second line
        // (HUILE, 1000 milli) — a full-qty retry on the first line must now
        // fail the cumulative guard instead.
        let item2_id: i64 = db
            .query_row(
                "SELECT id FROM sale_items WHERE sale_id = 's1' ORDER BY id ASC LIMIT 1 OFFSET 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let items2 = serde_json::json!([{ "saleItemId": item2_id, "qty_milli": 1000 }]).to_string();
        // The consumed line is now fenced: any further full-qty draft fails.
        assert!(return_create(
            &mut db,
            "s1",
            &items,
            "DEFECT",
            None,
            "lina",
            None,
            "2026-11-01"
        )
        .is_err());
        let d2 = return_create(
            &mut db,
            "s1",
            &items2,
            "CHANGED_MIND",
            None,
            "lina",
            Some("k-g2".to_string()),
            "2026-11-01",
        )
        .unwrap();
        let id2 = d2["id"].as_str().unwrap().to_string();
        let r = return_reject(&mut db, &id2, "karim", Some("client kept it".to_string())).unwrap();
        assert_eq!(r["status"], "REJECTED");
        let got = return_get(&db, &id2).unwrap();
        assert_eq!(got["status"], "REJECTED");
        // Unknown id reads as null JSON, never a throw.
        assert!(return_get(&db, "does-not-exist").unwrap().is_null());
    }

    #[test]
    fn sale_for_return_finds_by_fact_or_id_with_remaining_math() {
        // v1.5.0 lookup twin: FACT number and UUID id resolve the same head,
        // lines carry APPROVED-returned vs remaining; unknown/blank → Null.
        let mut db = memdb();
        record_sale(&mut db, &sale_header(Some("R-3")), &sale_items()).unwrap();
        for key in ["s1", "FACT-2026-000001"] {
            let f = sale_for_return(&db, key).unwrap();
            assert_eq!(f["sale"]["invoice_number"], "FACT-2026-000001");
            assert_eq!(f["sale"]["status"], "COMPLETED");
            assert_eq!(f["items"].as_array().unwrap().len(), 4);
            assert_eq!(f["items"][0]["remaining_milli"], 2000);
            assert_eq!(f["items"][0]["returned_milli"], 0);
        }
        assert!(sale_for_return(&db, "FACT-2099-999999").unwrap().is_null());
        assert!(sale_for_return(&db, "   ").unwrap().is_null());
        // After a full approval the consumed line reads zero remaining.
        let item_id: i64 = db
            .query_row(
                "SELECT id FROM sale_items WHERE sale_id = 's1' ORDER BY id ASC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let items = serde_json::json!([{ "saleItemId": item_id, "qty_milli": 2000 }]).to_string();
        cash_open(&db, "sess-lkp", "Amine", 1_000_000).unwrap();
        let d = return_create(
            &mut db,
            "s1",
            &items,
            "DEFECT",
            None,
            "lina",
            Some("k-lkp-1".to_string()),
            "2026-11-01",
        )
        .unwrap();
        let id = d["id"].as_str().unwrap().to_string();
        return_approve(&mut db, &id, "karim", "manager", "2026-11-01").unwrap();
        let f2 = sale_for_return(&db, "FACT-2026-000001").unwrap();
        assert_eq!(f2["items"][0]["returned_milli"], 2000);
        assert_eq!(f2["items"][0]["remaining_milli"], 0);
        assert_eq!(f2["items"][1]["remaining_milli"], 1000);
    }

    #[test]
    fn z_close_locks_chains_and_freezes_the_day() {
        // #004: native close recomputes from the ledger (179400ct vector),
        // chains prev→hash, then freezes the day: second close, voids and
        // late sales to it are all refused.
        let mut db = memdb();
        record_sale(&mut db, &sale_header(Some("ZC-1")), &sale_items()).unwrap();
        let z = z_close(&mut db, "2026-11-01", "08:00", "20:00").unwrap();
        assert_eq!(z["report_number"], "Z-2026-000001");
        assert_eq!(z["sales_count"], 1);
        assert_eq!(z["total_ttc_ct"], 179400);
        assert_eq!(z["total_ht_ct"], 165528);
        assert_eq!(z["day"], "2026-11-01");
        assert_eq!(z["prev_hash"], "0".repeat(64));
        // Hash matches the canonical TS join prev||number||day||ttc||timbre.
        let expect = crate::auth::sha256_hex(&format!(
            "{}||{}||{}||{}||{}",
            z["prev_hash"].as_str().unwrap(),
            "Z-2026-000001",
            "2026-11-01",
            179400,
            1800
        ));
        assert_eq!(z["hash"].as_str().unwrap(), expect);
        // Day lock: second close refused (seq not consumed twice).
        assert!(z_close(&mut db, "2026-11-01", "08:00", "21:00").is_err());
        // Void after lock refused.
        assert!(void_sale(&mut db, "s1", "late regret", "owner").is_err());
        // Late sale to the frozen day refused.
        let mut late = sale_header(Some("ZC-2"));
        late["id"] = serde_json::json!("s9");
        assert!(record_sale(&mut db, &late, &sale_items()).is_err());
        // Another day still closes and chains onto the first hash.
        let z2 = z_close(&mut db, "2026-11-02", "08:00", "20:00").unwrap();
        assert_eq!(z2["report_number"], "Z-2026-000002");
        assert_eq!(
            z2["prev_hash"].as_str().unwrap(),
            z["hash"].as_str().unwrap()
        );
        assert!(z_close(&mut db, "11-02", "08:00", "20:00").is_err()); // bad day
    }

    #[test]
    fn regime_off_records_clean_ttc_only_sale() {
        // Owner Card 3: both taxes off — coerced tier-0 lines, zero TVA/timbre,
        // flags stored per sale for audit replay.
        let mut db = memdb();
        let mut h = sale_header(Some("RG-1"));
        h["fiscal_regime"] = serde_json::json!({"tva_enabled": false, "timbre_enabled": false});
        // Client coerces every line to tier 0 (HT=TTC, TVA=0).
        let items = vec![
            serde_json::json!({"product_id": 1, "barcode": "a", "name_fr": "LAIT", "name_ar": "", "unit_price_ct": 18000, "qty_milli": 2000, "unit": "PIECE", "tva_rate": 0, "discount_bp": 0, "line_ht_ct": 36000, "line_tva_ct": 0, "line_ttc_ct": 36000}),
        ];
        h["totals"] = serde_json::json!({ "total_ht_ct": 36000, "total_tva_ct": 0, "timbre_ct": 0,
            "total_ttc_ct": 36000,
            "tva_breakdown": {
                "0": {"base_ht_ct": 36000, "tva_amount_ct": 0, "total_ttc_ct": 36000},
                "9": {"base_ht_ct": 0, "tva_amount_ct": 0, "total_ttc_ct": 0},
                "19": {"base_ht_ct": 0, "tva_amount_ct": 0, "total_ttc_ct": 0}}});
        h["amount_paid_ct"] = serde_json::json!(36000);
        h["amount_returned_ct"] = serde_json::json!(0);
        let r = record_sale(&mut db, &h, &items).unwrap();
        let flags: (i64, i64) = db
            .query_row(
                "SELECT tva_enabled, timbre_enabled FROM sales WHERE id = 's1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(flags, (0, 0));
        assert!(r["invoice_number"].as_str().unwrap().starts_with("FACT-"));
        // Regime TVA off but header carries TVA → refused.
        let mut bad = sale_header(Some("RG-2"));
        bad["fiscal_regime"] = serde_json::json!({"tva_enabled": false, "timbre_enabled": true});
        assert!(record_sale(&mut db, &bad, &sale_items()).is_err());
    }

    #[test]
    fn daily_z_counts_completed_only() {
        // #003: Z preview reads COMPLETED; voids counted apart (lock is #004).
        let mut db = memdb();
        let mut h2 = sale_header(Some("Z-2"));
        h2["id"] = serde_json::json!("s2");
        record_sale(&mut db, &sale_header(Some("Z-1")), &sale_items()).unwrap();
        record_sale(&mut db, &h2, &sale_items()).unwrap();
        void_sale(&mut db, "s1", "test void", "owner").unwrap();
        let z = daily_z(&db, "2026-11-01").unwrap();
        assert_eq!(z["sales_count"], 1);
        assert_eq!(z["voids_count"], 1);
        assert_eq!(z["total_ttc_ct"], 179400);
        assert!(daily_z(&db, "11-01").is_err());
    }

    #[test]
    fn f2_edge_hour_belongs_to_the_new_local_day() {
        // 2026-10-26T23:30:00Z == 2026-10-27T00:30:00+01:00 (Algiers).
        let mut db = memdb();
        let mut h = sale_header(Some("F2-1"));
        h["id"] = serde_json::json!("f2");
        h["created_at"] = serde_json::json!("2026-10-26T23:30:00.000Z");
        record_sale(&mut db, &h, &sale_items()).unwrap();
        let old = daily_z(&db, "2026-10-26").unwrap();
        assert_eq!(old["sales_count"], 0);
        let new = daily_z(&db, "2026-10-27").unwrap();
        assert_eq!(new["sales_count"], 1);
        assert_eq!(
            algiers_day("2026-10-26T23:30:00.000Z").unwrap(),
            "2026-10-27"
        );
        assert_eq!(
            algiers_day("2026-11-04T22:30:00.000Z").unwrap(),
            "2026-11-04"
        );
        let (s, e) = day_bounds_utc("2026-11-04").unwrap();
        assert_eq!(s, "2026-11-03T23:00:00.000Z");
        assert_eq!(e, "2026-11-04T23:00:00.000Z");
    }

    #[test]
    fn backup_db_writes_reopenable_sibling() {
        // #003: hot snapshot mirrors the TS backupTo contract.
        let mut db = memdb();
        record_sale(&mut db, &sale_header(Some("B-1")), &sale_items()).unwrap();
        let dir = std::env::temp_dir().join("baraka-003-test");
        let dest = dir.join("snap.db");
        let _ = std::fs::remove_file(&dest);
        let out = backup_db(&db, dest.to_str().expect("temp path must be UTF-8")).unwrap();
        assert!(out["bytes"].as_u64().unwrap() > 0);
        let check = Connection::open(&dest).unwrap();
        let n: i64 = check
            .query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let _ = std::fs::remove_file(&dest);
        assert!(backup_db(&db, "snap.txt").is_err()); // .db suffix contract
    }

    #[test]
    fn factory_reset_refuses_then_wipes_with_genesis() {
        // P3 (v1.4.4): no exempt archive → refused; with one → trial books
        // cleared, triggers rebuilt, single genesis audit row.
        let mut db = memdb();
        record_sale(&mut db, &sale_header(Some("R-1")), &sale_items()).unwrap();
        assert!(factory_reset(&db, "missing.db", "owner").is_err());
        let dir = std::env::temp_dir().join("baraka-reset-test");
        let _ = std::fs::create_dir_all(&dir);
        let arc = dir.join("pre-reset.db");
        std::fs::write(&arc, b"archive-bytes").unwrap();
        let sha: String = crate::auth::sha256_bytes(b"archive-bytes")
            .iter()
            .map(|x| format!("{x:02x}"))
            .collect();
        db.execute(
            "INSERT INTO backups_log (id, filename, file_path, file_size_bytes, sha256_checksum, sales_count, products_count, status, created_at, exempt)
             VALUES ('a1','pre-reset.db',?1,13,?2,1,0,'VERIFIED',datetime('now'),1)",
            rusqlite::params![arc.to_str().unwrap(), sha],
        )
        .unwrap();
        let out = factory_reset(&db, arc.to_str().unwrap(), "owner").unwrap();
        assert_eq!(out["cleared"]["sales"], 1);
        let n: i64 = db
            .query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
        let (action, detail): (String, String) = db
            .query_row(
                "SELECT action, detail FROM audit_log ORDER BY rowid",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(action, "factory_reset");
        assert!(detail.contains("clean start"));
        // Guards rebuilt: new inserts protected again.
        record_sale(&mut db, &sale_header(Some("R-2")), &sale_items()).unwrap();
        assert!(db.execute("DELETE FROM sales", []).is_err());
        let _ = std::fs::remove_file(&arc);
    }

    #[test]
    fn register_backup_logs_exempt_row() {
        // P3 (v1.4.4): a hot snapshot file gets a VERIFIED exempt log row
        // with its true size + sha — the reset gate's proof.
        let mut db = memdb();
        record_sale(&mut db, &sale_header(Some("G-1")), &sale_items()).unwrap();
        let dir = std::env::temp_dir().join("baraka-register-test");
        let _ = std::fs::create_dir_all(&dir);
        let dest = dir.join("snap.db");
        let _ = std::fs::remove_file(&dest);
        backup_db(&db, dest.to_str().unwrap()).unwrap();
        let out = register_backup(
            &db,
            "g1",
            dest.to_str().unwrap(),
            "pre-reset",
            "1.4.4",
            true,
        )
        .unwrap();
        assert_eq!(out["exempt"], true);
        assert_eq!(out["salesCount"], 1);
        let (status, exempt): (String, i64) = db
            .query_row(
                "SELECT status, exempt FROM backups_log WHERE id = 'g1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((status.as_str(), exempt), ("VERIFIED", 1));
        let _ = std::fs::remove_file(&dest);
    }

    #[test]
    fn cash_lane_open_move_status_close() {
        // v1.4.6: the production-independence lane — open (single), guarded
        // movements, live theoretical, atomic SHIFT close with chained Z.
        let mut db = memdb();
        let s = cash_open(&db, "s1", "Gérant", 5000).unwrap();
        assert_eq!(s["status"], "OPEN");
        assert!(cash_open(&db, "s2", "Autre", 0).is_err()); // single OPEN
        let m = cash_movement(&db, "m1", "s1", "DEPOSIT", 100000, "appoint").unwrap();
        assert_eq!(m["amountCt"], 100000);
        assert!(cash_movement(&db, "m2", "s1", "EXPENSE", 0, "x").is_err()); // F4
        assert!(cash_movement(&db, "m3", "s1", "EXPENSE", 500, "  ").is_err()); // F3
        let live = cash_session_status(&db, "s1").unwrap();
        assert_eq!(live["theoreticalCashCt"], 105000); // 5000 + 100000
        assert!(cash_active(&db).unwrap().is_object());
        assert_eq!(cash_sessions(&db, 20).unwrap().as_array().unwrap().len(), 1);
        assert_eq!(
            cash_movements(&db, "s1", 50)
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let z = cash_close_and_z(&mut db, "s1", 105000, None).unwrap();
        assert_eq!(z["cashDiffCt"], 0);
        assert!(z["zNumber"].as_str().unwrap().starts_with("Z-"));
        assert!(cash_active(&db).unwrap().is_null());
        assert!(cash_close_and_z(&mut db, "s1", 105000, None).is_err()); // terminal
    }

    /// v1.4.9 (#PROD-LOCAL): loss ledger + stock decrement, refusals named.
    #[test]
    fn prodlocal_loss_ok_and_refusals() {
        let mut db = memdb();
        db.execute(
            "INSERT INTO products (id, barcode, name_fr, buy_price_ct, stock_milli, sell_price_ct, tva_rate, unit) VALUES (9,'L9','Loss9',8000,5000,100,9,'PIECE')",
            [],
        ).unwrap();
        let ok = record_loss(
            &mut db,
            &serde_json::json!({
                "product_id": 9, "qty_milli": 2000, "reason": "BROKEN",
                "unit_cost_ct": 80, "notes": "lane-test",
            }),
        )
        .unwrap();
        assert_eq!(ok["stock_milli"], 3000);
        let logged: i64 = db
            .query_row(
                "SELECT total_loss_ct FROM inventory_losses WHERE product_id = 9",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(logged, (80 * 2000) / 1000);
        // Over-stock refused, ghost product refused, bad reason refused.
        assert!(record_loss(
            &mut db,
            &serde_json::json!({"product_id": 9, "qty_milli": 99999, "reason": "BROKEN"})
        )
        .is_err());
        assert!(record_loss(
            &mut db,
            &serde_json::json!({"product_id": 4242, "qty_milli": 1, "reason": "BROKEN"})
        )
        .is_err());
        assert!(record_loss(
            &mut db,
            &serde_json::json!({"product_id": 9, "qty_milli": 1, "reason": "MYSTERY"})
        )
        .is_err());
        // Stock untouched by the refusals.
        let left: i64 = db
            .query_row("SELECT stock_milli FROM products WHERE id = 9", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(left, 3000);
    }

    /// v1.4.9 (#PROD-LOCAL): self-contained snapshot roundtrip — VERIFIED meta
    /// + listed newest-first; empty registry returns GENESIS head.
    #[test]
    fn prodlocal_backup_and_z_registry() {
        let db = memdb();
        let dir = std::env::temp_dir().join("baraka-prodlocal-test");
        let _ = std::fs::create_dir_all(&dir);
        let meta = backup_create(&db, &dir, "lane-test", "1.4.9-test").unwrap();
        assert_eq!(meta["status"], "VERIFIED");
        assert!(meta["filename"].as_str().unwrap().starts_with("baraka-"));
        let list = backup_list(&db).unwrap();
        assert!(list
            .as_array()
            .unwrap()
            .iter()
            .any(|b| b["id"] == meta["id"]));
        let reg = z_list(&db).unwrap();
        assert_eq!(reg["rows"].as_array().unwrap().len(), 0);
        assert_eq!(reg["prev_hash"], "GENESIS");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
