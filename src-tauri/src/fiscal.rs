//! T4b (ADR-026): native fiscal commit lane — rusqlite edition of the
//! TypeScript DAL invariants. The frontend computes payloads with the tested
//! centimes engine; Rust RE-VALIDATES every money invariant before touching
//! the WAL, then owns seq + idempotency + atomicity. Same schema.sql, same
//! rules, zero trust in the caller.
//!
//! Dual-lane migration contract: `migrate()` here and `migrateSchemaVersion()`
//! in TS converge any file to LATEST_SCHEMA_VERSION (idempotent steps).

use rusqlite::Connection;
use serde_json::Value;

use crate::auth::sha256_hex;

pub const LATEST_SCHEMA_VERSION: i64 = 6;
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
    Ok(())
}

fn valid_day(day: &str) -> bool {
    day.len() == 10 && day.as_bytes()[4] == b'-' && day.as_bytes()[7] == b'-'
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
fn timbre_expected(conn: &Connection, sum_ttc_ct: i64, method: &str) -> Result<i64, String> {
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
    for (i, r) in [0, 9, 19].iter().enumerate() {
        let b = &t["tva_breakdown"][&r.to_string()];
        if ct(&b["base_ht_ct"], "tier base")? != tier[i].0
            || ct(&b["tva_amount_ct"], "tier amt")? != tier[i].1
            || ct(&b["total_ttc_ct"], "tier ttc")? != tier[i].2
        {
            return Err(format!("[fiscal] tier {r}% breakdown mismatch"));
        }
    }
    if timbre_expected(conn, st, &method)? != timbre {
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

    // #004: a legally closed day is frozen — no new posting may land in it.
    let created = str_field(&header["created_at"], "created_at")?;
    let day = created.get(0..10).ok_or("[fiscal] bad created_at day")?;
    if !valid_day(day) {
        return Err("[fiscal] bad created_at day".to_string());
    }
    if day_locked(conn, day)? {
        return Err(format!(
            "[fiscal] day {day} is already legally closed (Z FINALISÉ) — sale refused"
        ));
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
          payment_method, amount_paid_ct, amount_returned_ct, status, is_facture, created_at,
          client_sale_id)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,'COMPLETED',?29,?30,?31)",
        rusqlite::params![
            id, invoice, ticket,
            str_field(&header["cashier_id"], "cashier_id")?,
            str_field(&header["cashier_name"], "cashier_name")?,
            header["client_id"].as_i64(),
            opt_str(&header["client_name"], "client_name")?.unwrap_or_default(),
            opt_str(&header["client_nif"], "client_nif")?.unwrap_or_default(),
            opt_str(&header["client_nis"], "client_nis")?.unwrap_or_default(),
            opt_str(&header["client_rc"], "client_rc")?.unwrap_or_default(),
            opt_str(&header["client_ai"], "client_ai")?.unwrap_or_default(),
            opt_str(&header["client_address"], "client_address")?.unwrap_or_default(),
            ht, tva, timbre, ttc,
            tier[0].0, tier[0].1, tier[0].2, tier[1].0, tier[1].1, tier[1].2, tier[2].0, tier[2].1, tier[2].2,
            method, paid, ret, is_facture,
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
    if timbre_expected(conn, amount, &method)? != timbre {
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
    let (invoice, status, day): (String, String, String) = tx
        .query_row(
            "SELECT invoice_number, status, substr(created_at, 1, 10) FROM sales WHERE id = ?1",
            [sale_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| format!("[fiscal] sale not found: {sale_id}"))?;
    if status == "CANCELLED" {
        return Err("[fiscal] sale already voided".to_string());
    }
    // #004: a legally closed day is frozen — voids to it are refused.
    // (COUNT runs on the tx: same Immediate lock, no TOCTOU.)
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
    let (n, ht, b0, b9, a9, b19, a19, tva, timbre, ttc, cash, cib, dah, cred, first, last): (
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
             FROM sales WHERE status = 'COMPLETED' AND substr(created_at, 1, 10) = ?1",
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
             WHERE payment_method = 'ESPECES' AND substr(date, 1, 10) = ?1",
            [day],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let prev: String = match tx.query_row(
        "SELECT hash FROM z_reports ORDER BY rowid DESC LIMIT 1",
        [],
        |r| r.get::<_, String>(0),
    ) {
        Ok(h) => h,
        Err(rusqlite::Error::QueryReturnedNoRows) => "0".repeat(64),
        Err(e) => return Err(e.to_string()),
    };
    let number = format!("Z-{year}-{:06}", bump_seq(&tx, "Z", year)?);
    let hash = z_hash(&prev, &number, day, ttc, timbre);
    tx.execute(
        "INSERT INTO z_reports (report_number, day, opening_time, closing_time,
          total_sales_count, total_ht_ct, tva0_base_ct, tva9_base_ct, tva9_amt_ct,
          tva19_base_ct, tva19_amt_ct, total_tva_ct, total_timbre_ct, total_ttc_ct,
          especes_gross_ct, cib_total_ct, dahabiya_total_ct, credit_granted_ct,
          credit_collected_ct, first_invoice_number, last_invoice_number,
          prev_hash, hash, finalized, close_kind)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,1,'DAY')",
        rusqlite::params![
            number, day, opening_time, closing_time,
            n, ht, b0, b9, a9, b19, a19, tva, timbre, ttc,
            cash, cib, dah, cred, coll,
            first.unwrap_or_default(), last.unwrap_or_default(),
            prev, hash,
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "report_number": number, "day": day,
        "opening_time": opening_time, "closing_time": closing_time,
        "sales_count": n, "total_ht_ct": ht, "total_tva_ct": tva,
        "total_timbre_ct": timbre, "total_ttc_ct": ttc,
        "hash": hash, "prev_hash": prev,
    }))
}

/// #003 (Phase A): day summary for the Z lane — read-only. COMPLETED sales
/// only; voids counted separately. The legal day-LOCK lives in #004.
pub fn daily_z(conn: &Connection, day: &str) -> Result<Value, String> {
    if day.len() != 10 || day.as_bytes()[4] != b'-' || day.as_bytes()[7] != b'-' {
        return Err("[fiscal] day must be YYYY-MM-DD".to_string());
    }
    let (count, total): (i64, Option<i64>) = conn
        .query_row(
            "SELECT COUNT(*), SUM(total_ttc_ct) FROM sales
             WHERE substr(created_at, 1, 10) = ?1 AND status = 'COMPLETED'",
            [day],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let voids: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sales WHERE substr(created_at, 1, 10) = ?1 AND status = 'CANCELLED'",
            [day],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    // #004: the UI locks the void surface (and shows JOUR VERROUILLÉ) when
    // a legal DAY close already freezes the day.
    let locked = day_locked(conn, day)?;
    Ok(serde_json::json!({
        "day": day,
        "sales_count": count,
        "total_ttc_ct": total.unwrap_or(0),
        "voids_count": voids,
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
        assert_eq!(v, 6);
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
}
