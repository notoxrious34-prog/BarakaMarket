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

pub const LATEST_SCHEMA_VERSION: i64 = 3;
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
    Ok(())
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
        let legacy = SCHEMA
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
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(&legacy).unwrap();
        conn.execute_batch("PRAGMA user_version = 1;").unwrap();
        migrate(&conn).unwrap();
        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 3);
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
}
