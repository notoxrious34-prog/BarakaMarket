//! T4c (ADR-027): native product/stock truth — CRUD edition.
//! The exe lane carries UI catalog truth (localStorage); this module gives
//! SQLite the fiscal stock mirror. `syncCatalogToNative` (frontend) pushes
//! the catalog once per session; native sale commits then decrement MATCHED
//! rows instead of NULLing every FK. One-way mirror (UI → SQLite); the UI
//! keeps reading its own store. Full two-way merge is ops tooling (T9).

use rusqlite::Connection;
use serde_json::{json, Value};

fn ct(v: &Value, name: &str) -> Result<i64, String> {
    v.as_i64()
        .ok_or_else(|| format!("[product] {name} must be integer centimes/milli"))
}

fn req_str(v: &Value, name: &str) -> Result<String, String> {
    let s = v
        .as_str()
        .ok_or_else(|| format!("[product] {name} must be a string"))?;
    if s.is_empty() {
        return Err(format!("[product] {name} must not be empty"));
    }
    Ok(s.to_string())
}

fn validate_common(p: &Value) -> Result<(), String> {
    let r = ct(&p["tva_rate"], "tva_rate")?;
    if r != 0 && r != 9 && r != 19 {
        return Err(format!("[product] TVA rate must be 0, 9 or 19 (got {r})"));
    }
    let u = req_str(&p["unit"], "unit")?;
    if u != "PIECE" && u != "KG" && u != "LITRE" {
        return Err(format!("[product] bad unit: {u}"));
    }
    for f in ["buy_price_ct", "sell_price_ct", "stock_milli"] {
        if ct(&p[f], f)? < 0 {
            return Err(format!("[product] {f} must be >= 0"));
        }
    }
    req_str(&p["barcode"], "barcode")?;
    req_str(&p["name_fr"], "name_fr")?;
    Ok(())
}

/// Insert or replace by id (explicit UI identity preserved). Barcode
/// collisions across ids surface as errors — catalog data issue, visible.
pub fn product_upsert(conn: &Connection, p: &Value) -> Result<Value, String> {
    validate_common(p)?;
    let id = ct(&p["id"], "id")?;
    if id <= 0 {
        return Err("[product] id must be > 0".to_string());
    }
    let min_stock = p["min_stock_milli"].as_i64().unwrap_or(0);
    let is_scale = p["is_scale"].as_i64().unwrap_or(0);
    let has_expiry = p["has_expiry"].as_i64().unwrap_or(0);
    conn.execute(
        "INSERT INTO products (id, barcode, name_fr, name_ar, category_id,
          buy_price_ct, sell_price_ct, tva_rate, stock_milli, min_stock_milli,
          unit, is_scale, scale_item_code, has_expiry, expiry_date)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
         ON CONFLICT(id) DO UPDATE SET
          barcode = excluded.barcode, name_fr = excluded.name_fr,
          name_ar = excluded.name_ar, category_id = excluded.category_id,
          buy_price_ct = excluded.buy_price_ct, sell_price_ct = excluded.sell_price_ct,
          tva_rate = excluded.tva_rate, stock_milli = excluded.stock_milli,
          min_stock_milli = excluded.min_stock_milli, unit = excluded.unit,
          is_scale = excluded.is_scale, scale_item_code = excluded.scale_item_code,
          has_expiry = excluded.has_expiry, expiry_date = excluded.expiry_date",
        rusqlite::params![
            id,
            req_str(&p["barcode"], "barcode")?,
            req_str(&p["name_fr"], "name_fr")?,
            p["name_ar"].as_str().unwrap_or(""),
            p["category_id"].as_str().unwrap_or(""),
            ct(&p["buy_price_ct"], "buy_price_ct")?,
            ct(&p["sell_price_ct"], "sell_price_ct")?,
            ct(&p["tva_rate"], "tva_rate")?,
            ct(&p["stock_milli"], "stock_milli")?,
            min_stock,
            req_str(&p["unit"], "unit")?,
            is_scale,
            p["scale_item_code"].as_str().unwrap_or(""),
            has_expiry,
            p["expiry_date"].as_str().unwrap_or(""),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "id": id }))
}

fn row_to_json(r: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": r.get::<_, i64>(0)?,
        "barcode": r.get::<_, String>(1)?,
        "name_fr": r.get::<_, String>(2)?,
        "name_ar": r.get::<_, String>(3)?,
        "category_id": r.get::<_, String>(4)?,
        "buy_price_ct": r.get::<_, i64>(5)?,
        "sell_price_ct": r.get::<_, i64>(6)?,
        "tva_rate": r.get::<_, i64>(7)?,
        "stock_milli": r.get::<_, i64>(8)?,
        "min_stock_milli": r.get::<_, i64>(9)?,
        "unit": r.get::<_, String>(10)?,
        "is_scale": r.get::<_, i64>(11)?,
        "scale_item_code": r.get::<_, String>(12)?,
        "has_expiry": r.get::<_, i64>(13)?,
        "expiry_date": r.get::<_, String>(14)?,
    }))
}

const COLS: &str = "id, barcode, name_fr, name_ar, category_id, buy_price_ct,
    sell_price_ct, tva_rate, stock_milli, min_stock_milli, unit, is_scale,
    scale_item_code, has_expiry, expiry_date";

/// Full fiscal stock mirror (small catalogs; UI pages client-side).
pub fn product_list(conn: &Connection) -> Result<Value, String> {
    let mut st = conn
        .prepare(&format!("SELECT {COLS} FROM products ORDER BY name_fr"))
        .map_err(|e| e.to_string())?;
    let rows = st.query_map([], row_to_json).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(Value::Array(out))
}

/// T4c-fix (institutional stock audit S3/S8): delete the native mirror row.
/// RESTRICT guards (loss ledger, sale FKs) surface as errors — the caller
/// must then abort the UI delete too (no ghost fiscal rows, no orphans).
pub fn product_delete(conn: &Connection, id: i64) -> Result<Value, String> {
    if id <= 0 {
        return Err("[product] id must be > 0".to_string());
    }
    let n = conn
        .execute("DELETE FROM products WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    if n == 0 {
        return Err(format!("[product] not found: {id}"));
    }
    Ok(json!({ "deleted": id }))
}

/// POS lookup: barcode exact-first, then name prefix (limit 50).
pub fn product_search(conn: &Connection, q: &str) -> Result<Value, String> {
    let like = format!("%{q}%");
    let mut st = conn
        .prepare(&format!(
            "SELECT {COLS} FROM products
             WHERE barcode = ?1 OR barcode LIKE ?2 OR name_fr LIKE ?2 OR name_ar LIKE ?2
             ORDER BY CASE WHEN barcode = ?1 THEN 0 ELSE 1 END, name_fr LIMIT 50"
        ))
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map(rusqlite::params![q, like], row_to_json)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(Value::Array(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    const SCHEMA: &str = include_str!("../../db/schema.sql");

    fn memdb() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        crate::fiscal::migrate(&conn).unwrap();
        conn
    }

    fn prod(id: i64, barcode: &str) -> Value {
        json!({
            "id": id, "barcode": barcode, "name_fr": "LAIT", "name_ar": "حليب",
            "category_id": "c1", "buy_price_ct": 12000, "sell_price_ct": 18000,
            "tva_rate": 9, "stock_milli": 48000, "min_stock_milli": 5000,
            "unit": "PIECE", "is_scale": 0, "scale_item_code": "",
            "has_expiry": 0, "expiry_date": ""
        })
    }

    #[test]
    fn upsert_inserts_then_updates_by_id() {
        let db = memdb();
        product_upsert(&db, &prod(7, "613000000001")).unwrap();
        let mut p = prod(7, "613000000001");
        p["stock_milli"] = json!(46000);
        product_upsert(&db, &p).unwrap();
        let list = product_list(&db).unwrap();
        assert_eq!(list.as_array().unwrap().len(), 1);
        assert_eq!(list[0]["stock_milli"], 46000);
    }

    #[test]
    fn upsert_rejects_bad_tva_and_negative_price() {
        let db = memdb();
        let mut bad = prod(8, "x");
        bad["tva_rate"] = json!(7);
        assert!(product_upsert(&db, &bad).is_err());
        let mut neg = prod(9, "y");
        neg["buy_price_ct"] = json!(-1);
        assert!(product_upsert(&db, &neg).is_err());
    }

    #[test]
    fn delete_removes_row_and_reports_missing() {
        let db = memdb();
        product_upsert(&db, &prod(11, "613000000031")).unwrap();
        let out = product_delete(&db, 11).unwrap();
        assert_eq!(out["deleted"], json!(11));
        assert!(product_list(&db).unwrap().as_array().unwrap().is_empty());
        assert!(product_delete(&db, 11).is_err());
        assert!(product_delete(&db, 0).is_err());
    }

    #[test]
    fn search_finds_by_barcode_and_name() {
        let db = memdb();
        product_upsert(&db, &prod(10, "613000000021")).unwrap();
        let r = product_search(&db, "613000000021").unwrap();
        assert_eq!(r.as_array().unwrap().len(), 1);
        let r2 = product_search(&db, "LAI").unwrap();
        assert_eq!(r2.as_array().unwrap().len(), 1);
        let r3 = product_search(&db, "zzz-no-match").unwrap();
        assert_eq!(r3.as_array().unwrap().len(), 0);
    }
}
