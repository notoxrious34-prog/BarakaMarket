/// TASK-MKT-005: sales-book domain extracted from fiscal.rs (~4500-line
/// monolith, first submodule). Read-only day ledger + head + governed
/// duplicata. fiscal.rs keeps the canonical helpers (valid_day,
/// day_bounds_utc) and re-exports these three, so every existing
/// `fiscal::…` call site (main.rs commands, fiscal tests) is untouched.
use rusqlite::Connection;
use serde_json::Value;

use super::fiscal::{day_bounds_utc, valid_day};

pub fn sales_book_day(conn: &Connection, day: &str) -> Result<Value, String> {
    if !valid_day(day) {
        return Err("[fiscal] day must be YYYY-MM-DD".to_string());
    }
    let (wstart, wend) = day_bounds_utc(day)?;
    let mut st = conn
        .prepare(
            "SELECT s.id, s.invoice_number, s.ticket_number, s.created_at, s.cashier_name,
               s.payment_method, s.total_ttc_ct, s.status, c.name AS client_name,
               CASE WHEN EXISTS (SELECT 1 FROM returns r WHERE r.sale_id = s.id AND r.status = 'APPROVED') THEN 1 ELSE 0 END AS has_approved_return,
               COALESCE((SELECT SUM(r2.refund_ct) FROM returns r2 WHERE r2.sale_id = s.id AND r2.status = 'APPROVED'), 0) AS avoir_total_ct,
               (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count
             FROM sales s LEFT JOIN clients c ON c.id = s.client_id
             WHERE s.created_at >= ?1 AND s.created_at < ?2
             ORDER BY s.created_at DESC, s.id DESC",
        )
        .map_err(|e| e.to_string())?;
    let qrows = st
        .query_map([&wstart, &wend], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "invoice_number": r.get::<_, String>(1)?,
                "ticket_number": r.get::<_, String>(2)?,
                "created_at": r.get::<_, String>(3)?,
                "cashier_name": r.get::<_, String>(4)?,
                "payment_method": r.get::<_, String>(5)?,
                "total_ttc_ct": r.get::<_, i64>(6)?,
                "status": r.get::<_, String>(7)?,
                "client_name": r.get::<_, Option<String>>(8)?,
                "has_approved_return": r.get::<_, i64>(9)?,
                "avoir_total_ct": r.get::<_, i64>(10)?,
                "item_count": r.get::<_, i64>(11)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut arr = Vec::new();
    for r in qrows {
        arr.push(r.map_err(|e| e.to_string())?);
    }
    let zrow: (i64, Option<i64>, Option<i64>, Option<i64>, Option<i64>) = conn
        .query_row(
            "SELECT COUNT(*),
               SUM(CASE WHEN payment_method = 'ESPECES' THEN total_ttc_ct ELSE 0 END),
               SUM(CASE WHEN payment_method IN ('CIB', 'DAHABIYA') THEN total_ttc_ct ELSE 0 END),
               SUM(CASE WHEN payment_method = 'CREDIT' THEN total_ttc_ct ELSE 0 END),
               SUM(total_ttc_ct)
             FROM sales WHERE status = 'COMPLETED' AND created_at >= ?1 AND created_at < ?2",
            [&wstart, &wend],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "rows": Value::Array(arr),
        "z": {
            "sales_count": zrow.0,
            "total_especes_ct": zrow.1.unwrap_or(0),
            "total_bank_ct": zrow.2.unwrap_or(0),
            "total_credit_granted_ct": zrow.3.unwrap_or(0),
            "total_ttc_ct": zrow.4.unwrap_or(0),
        },
    }))
}

/// v1.5.3 (SALES BOOK): full fiscal head of one sale for the detail view.
/// Null when unknown (the view shows "sale not found", never a blank).
pub fn sale_head(conn: &Connection, id: &str) -> Result<Value, String> {
    let id = id.trim();
    if id.is_empty() {
        return Ok(Value::Null);
    }
    let mut st = conn
        .prepare(
            "SELECT id, invoice_number, ticket_number, cashier_id, cashier_name,
               client_id, client_name, total_ht_ct, total_tva_ct, timbre_ct, total_ttc_ct,
               tva0_base_ct, tva0_amt_ct, tva0_ttc_ct,
               tva9_base_ct, tva9_amt_ct, tva9_ttc_ct,
               tva19_base_ct, tva19_amt_ct, tva19_ttc_ct,
               payment_method, tva_enabled, timbre_enabled,
               amount_paid_ct, amount_returned_ct, status, created_at
             FROM sales WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = st
        .query_map([id], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "invoice_number": r.get::<_, String>(1)?,
                "ticket_number": r.get::<_, String>(2)?,
                "cashier_id": r.get::<_, String>(3)?,
                "cashier_name": r.get::<_, String>(4)?,
                "client_id": r.get::<_, Option<i64>>(5)?,
                "client_name": r.get::<_, Option<String>>(6)?,
                "total_ht_ct": r.get::<_, i64>(7)?,
                "total_tva_ct": r.get::<_, i64>(8)?,
                "timbre_ct": r.get::<_, i64>(9)?,
                "total_ttc_ct": r.get::<_, i64>(10)?,
                "tva0_base_ct": r.get::<_, i64>(11)?,
                "tva0_amt_ct": r.get::<_, i64>(12)?,
                "tva0_ttc_ct": r.get::<_, i64>(13)?,
                "tva9_base_ct": r.get::<_, i64>(14)?,
                "tva9_amt_ct": r.get::<_, i64>(15)?,
                "tva9_ttc_ct": r.get::<_, i64>(16)?,
                "tva19_base_ct": r.get::<_, i64>(17)?,
                "tva19_amt_ct": r.get::<_, i64>(18)?,
                "tva19_ttc_ct": r.get::<_, i64>(19)?,
                "payment_method": r.get::<_, String>(20)?,
                "tva_enabled": r.get::<_, i64>(21)?,
                "timbre_enabled": r.get::<_, i64>(22)?,
                "amount_paid_ct": r.get::<_, i64>(23)?,
                "amount_returned_ct": r.get::<_, i64>(24)?,
                "status": r.get::<_, String>(25)?,
                "created_at": r.get::<_, String>(26)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    match rows.next() {
        Some(r) => Ok(r.map_err(|e| e.to_string())?),
        None => Ok(Value::Null),
    }
}

/// v1.5.3 (SALES BOOK P2): governed duplicata for the installed shell —
/// the audit row lands in the same call (actor + reason), no silent copies.
pub fn sale_duplicata(
    conn: &Connection,
    id: &str,
    by: &str,
    reason: &str,
) -> Result<Value, String> {
    let id = id.trim();
    let actor = by.trim();
    if id.is_empty() {
        return Err("[fiscal] sale id required".to_string());
    }
    if actor.is_empty() {
        return Err("[fiscal] actor required".to_string());
    }
    let exists: i64 = conn
        .query_row("SELECT COUNT(*) FROM sales WHERE id = ?1", [id], |r| {
            r.get(0)
        })
        .map_err(|e| e.to_string())?;
    if exists == 0 {
        return Err("[fiscal] sale not found".to_string());
    }
    let detail: String = reason.chars().take(140).collect();
    conn.execute(
        "INSERT INTO audit_log (ts, actor, action, entity, entity_id, detail)
         VALUES (datetime('now'), ?1, 'sale.duplicata', 'sales', ?2, ?3)",
        rusqlite::params![actor, id, detail],
    )
    .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "ok": true }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    const SCHEMA: &str = include_str!("../../db/schema.sql");

    /// MKT-005: the extracted lane behaves identically on a fresh migrated
    /// schema — guards, empty-day shape, unknown-head Null, governed audit.
    /// Fails before the extraction (no such module); passes after.
    #[test]
    fn sales_book_submodule_matches_fiscal_contract() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SCHEMA).unwrap();
        super::super::fiscal::migrate(&db).unwrap();

        // Bad day is an Err, not a silent empty.
        assert!(sales_book_day(&db, "nope").is_err());

        // Empty day: shape holds, Z is zeroed.
        let day = sales_book_day(&db, "2026-11-01").unwrap();
        assert_eq!(day["rows"].as_array().unwrap().len(), 0);
        assert_eq!(day["z"]["sales_count"], 0);
        assert_eq!(day["z"]["total_ttc_ct"], 0);

        // Unknown / blank head is Null (view shows "not found").
        assert!(sale_head(&db, "does-not-exist").unwrap().is_null());
        assert!(sale_head(&db, "   ").unwrap().is_null());

        // Duplicata guards first…
        assert!(sale_duplicata(&db, "", "boss", "x").is_err());
        assert!(sale_duplicata(&db, "s9", "", "x").is_err());
        assert!(sale_duplicata(&db, "s9", "boss", "x").is_err());

        // …then lands the governed audit row on a real sale.
        db.execute(
            "INSERT INTO sales (id, invoice_number, ticket_number, cashier_id, cashier_name,
               total_ht_ct, total_tva_ct, timbre_ct, total_ttc_ct, payment_method,
               amount_paid_ct, amount_returned_ct, status, created_at)
             VALUES ('s9','F-9','T-9','c1','Amine',1000,0,0,1000,'ESPECES',1000,0,'COMPLETED','2026-11-01T10:00:00Z')",
            [],
        )
        .unwrap();
        let d = sale_duplicata(&db, "s9", "boss", "client perdu").unwrap();
        assert_eq!(d["ok"], true);
        let h = sale_head(&db, "s9").unwrap();
        assert_eq!(h["invoice_number"], "F-9");
        assert_eq!(h["total_ttc_ct"], 1000);
        let day = sales_book_day(&db, "2026-11-01").unwrap();
        assert_eq!(day["rows"].as_array().unwrap().len(), 1);
        assert_eq!(day["rows"][0]["item_count"], 0);
        assert_eq!(day["z"]["sales_count"], 1);
        assert_eq!(day["z"]["total_ttc_ct"], 1000);
        let n: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM audit_log WHERE action = 'sale.duplicata' AND entity_id = 's9'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1);
    }
}
