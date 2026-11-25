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
    // ADR-053 P3: barcode is optional — empty/missing means a legitimate
    // codeless article (NULL in DB, control #1). The anti-fake warning lives
    // in the UI; the lane only normalizes.
    req_str(&p["name_fr"], "name_fr")?;
    Ok(())
}

/// Normalized barcode: None = legitimate codeless article (control #1).
fn opt_barcode(p: &Value) -> Option<String> {
    match p.get("barcode").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        _ => None,
    }
}

fn opt_kind(p: &Value) -> Result<String, String> {
    let k = p
        .get("kind")
        .and_then(|v| v.as_str())
        .unwrap_or("PIECE");
    if k != "PIECE" && k != "POIDS" && k != "LIBRE" {
        return Err(format!("[product] kind must be PIECE|POIDS|LIBRE (got {k})"));
    }
    Ok(k.to_string())
}

fn opt_price_per_kg(p: &Value, kind: &str) -> Result<Option<i64>, String> {
    let v = p.get("price_per_kg_ct").and_then(|v| v.as_i64());
    // ADR-053 P3 (Q4): POIDS creation requires an explicit owner-set price/kg.
    if kind == "POIDS" && v.map(|n| n <= 0).unwrap_or(true) {
        return Err("[product] POIDS product requires price_per_kg_ct > 0 (owner-set, Q4)".to_string());
    }
    if let Some(n) = v {
        if n < 0 {
            return Err("[product] price_per_kg_ct must be >= 0".to_string());
        }
    }
    Ok(v)
}

/// Insert or replace by id (explicit UI identity preserved). Barcode
/// collisions across ids surface as errors — catalog data issue, visible.
pub fn product_upsert(conn: &Connection, p: &Value) -> Result<Value, String> {
    validate_common(p)?;
    let id = ct(&p["id"], "id")?;
    if id <= 0 {
        return Err("[product] id must be > 0".to_string());
    }
    // ADR-053 P3: NULL barcode = legitimate codeless article (control #1).
    let barcode = opt_barcode(p);
    let kind = opt_kind(p)?;
    let price_per_kg = opt_price_per_kg(p, &kind)?;
    let tare_g = p.get("tare_g").and_then(|v| v.as_i64()).unwrap_or(0);
    if tare_g < 0 {
        return Err("[product] tare_g must be >= 0".to_string());
    }
    let track_stock = p.get("track_stock").and_then(|v| v.as_i64()).unwrap_or(0);
    if track_stock != 0 && track_stock != 1 {
        return Err("[product] track_stock must be 0 or 1".to_string());
    }
    let min_stock = p["min_stock_milli"].as_i64().unwrap_or(0);
    let is_scale = p["is_scale"].as_i64().unwrap_or(0);
    let has_expiry = p["has_expiry"].as_i64().unwrap_or(0);
    conn.execute(
        "INSERT INTO products (id, barcode, name_fr, name_ar, category_id,
          buy_price_ct, sell_price_ct, tva_rate, stock_milli, min_stock_milli,
          unit, is_scale, scale_item_code, has_expiry, expiry_date,
          kind, price_per_kg_ct, tare_g, track_stock)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,
           ?16,?17,?18,?19)
         ON CONFLICT(id) DO UPDATE SET
          barcode = excluded.barcode, name_fr = excluded.name_fr,
          name_ar = excluded.name_ar, category_id = excluded.category_id,
          buy_price_ct = excluded.buy_price_ct, sell_price_ct = excluded.sell_price_ct,
          tva_rate = excluded.tva_rate, stock_milli = excluded.stock_milli,
          min_stock_milli = excluded.min_stock_milli, unit = excluded.unit,
          is_scale = excluded.is_scale, scale_item_code = excluded.scale_item_code,
          has_expiry = excluded.has_expiry, expiry_date = excluded.expiry_date,
          kind = excluded.kind, price_per_kg_ct = excluded.price_per_kg_ct,
          tare_g = excluded.tare_g, track_stock = excluded.track_stock",
        rusqlite::params![
            id,
            barcode,
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
            kind,
            price_per_kg,
            tare_g,
            track_stock,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "id": id }))
}

/// F4 (v1.8.4): client identity mirror (UI -> lane). Profile fields sync by
/// explicit UI id; credit_balance_ct is NEVER touched — the lane owns the
/// ledger (sale/settlement/void postings only). max_credit_limit_ct syncs
/// (UI-owned plafond) so the lane can enforce F1 at commit time.
pub fn client_upsert(conn: &Connection, c: &Value) -> Result<Value, String> {
    let id = ct(&c["id"], "id")?;
    if id <= 0 {
        return Err("[client] id must be > 0".to_string());
    }
    let name = req_str(&c["name"], "name")?;
    if name.trim().is_empty() {
        return Err("[client] name must not be empty".to_string());
    }
    let limit = c["max_credit_limit_ct"].as_i64().unwrap_or(0);
    if limit < 0 {
        return Err("[client] max_credit_limit_ct must be >= 0".to_string());
    }
    conn.execute(
        "INSERT INTO clients (id, name, phone, address, nif, nis, rc, ai,
          max_credit_limit_ct, notes)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(id) DO UPDATE SET
          name = excluded.name, phone = excluded.phone,
          address = excluded.address, nif = excluded.nif, nis = excluded.nis,
          rc = excluded.rc, ai = excluded.ai,
          max_credit_limit_ct = excluded.max_credit_limit_ct,
          notes = excluded.notes",
        rusqlite::params![
            id,
            name,
            c["phone"].as_str().unwrap_or(""),
            c["address"].as_str().unwrap_or(""),
            c["nif"].as_str(),
            c["nis"].as_str(),
            c["rc"].as_str(),
            c["ai"].as_str(),
            limit,
            c["notes"].as_str(),
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(json!({ "id": id }))
}

fn row_to_json(r: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(json!({
        // ADR-053 P3: barcode NULL = legitimate codeless article.
        "id": r.get::<_, i64>(0)?,
        "barcode": r.get::<_, Option<String>>(1)?,
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

const PIN_COLS: &str = "id, barcode, name_fr, name_ar, category_id, buy_price_ct,
    sell_price_ct, tva_rate, stock_milli, min_stock_milli, unit, kind,
    price_per_kg_ct, tare_g, pin_order, pin_color, pin_icon, track_stock,
    pinned_until";

fn pinned_row_to_json(r: &rusqlite::Row) -> rusqlite::Result<Value> {
    Ok(json!({
        "id": r.get::<_, i64>(0)?,
        "barcode": r.get::<_, Option<String>>(1)?,
        "name_fr": r.get::<_, String>(2)?,
        "name_ar": r.get::<_, String>(3)?,
        "category_id": r.get::<_, String>(4)?,
        "buy_price_ct": r.get::<_, i64>(5)?,
        "sell_price_ct": r.get::<_, i64>(6)?,
        "tva_rate": r.get::<_, i64>(7)?,
        "stock_milli": r.get::<_, i64>(8)?,
        "min_stock_milli": r.get::<_, i64>(9)?,
        "unit": r.get::<_, String>(10)?,
        "kind": r.get::<_, String>(11)?,
        "price_per_kg_ct": r.get::<_, Option<i64>>(12)?,
        "tare_g": r.get::<_, i64>(13)?,
        "pin_order": r.get::<_, Option<i64>>(14)?,
        "pin_color": r.get::<_, Option<String>>(15)?,
        "pin_icon": r.get::<_, Option<String>>(16)?,
        "track_stock": r.get::<_, i64>(17)?,
        "pinned_until": r.get::<_, Option<String>>(18)?,
    }))
}

/// ADR-053 P3: pinned tiles read path — ordered, expiry-aware (O3).
/// `today` is `YYYY-MM-DD` (the caller owns the clock).
pub fn product_pinned(conn: &Connection, today: &str) -> Result<Value, String> {
    let mut st = conn
        .prepare(&format!(
            "SELECT {PIN_COLS} FROM products WHERE pin_order IS NOT NULL
             AND (pinned_until IS NULL OR pinned_until = '' OR pinned_until >= ?1)
             ORDER BY pin_order ASC"
        ))
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map([today], pinned_row_to_json)
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(Value::Array(out))
}

/// ADR-053 P3: pin/unpin one article (owner-only enforced by callers + audit).
/// `pin` carries pin_order (1..12, or null to unpin) plus optional
/// pin_color/pin_icon/kind/price_per_kg_ct/track_stock/pinned_until.
/// One slot = one tile: assigning a slot evicts its previous holder.
pub fn product_set_pin(conn: &Connection, id: i64, pin: &Value) -> Result<Value, String> {
    if id <= 0 {
        return Err("[product] id must be > 0".to_string());
    }
    let order = pin.get("pin_order").and_then(|v| v.as_i64());
    if let Some(n) = order {
        if n < 1 || n > 12 {
            return Err(format!("[product] pin_order must be 1..12 or null (got {n})"));
        }
    }
    let cur_kind: String = conn
        .query_row("SELECT kind FROM products WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| format!("[product] not found: {id}"))?;
    let kind = pin.get("kind").and_then(|v| v.as_str()).unwrap_or(&cur_kind);
    if kind != "PIECE" && kind != "POIDS" && kind != "LIBRE" {
        return Err(format!("[product] kind must be PIECE|POIDS|LIBRE (got {kind})"));
    }
    // Q4 parity with the TS lane: POIDS needs an owner-set price/kg.
    if kind == "POIDS" {
        let cur_price: Option<i64> = conn
            .query_row("SELECT price_per_kg_ct FROM products WHERE id = ?1", [id], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let want = pin.get("price_per_kg_ct").and_then(|v| v.as_i64()).or(cur_price);
        if want.map(|n| n <= 0).unwrap_or(true) {
            return Err("[product] POIDS product requires price_per_kg_ct > 0 (owner-set, Q4)".to_string());
        }
    }
    conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
    let res: Result<Value, String> = (|| {
        if let Some(n) = order {
            conn.execute(
                "UPDATE products SET pin_order = NULL WHERE pin_order = ?1 AND id != ?2",
                rusqlite::params![n, id],
            )
            .map_err(|e| e.to_string())?;
        }
        conn.execute(
            "UPDATE products SET pin_order = ?1,
              pin_color = COALESCE(?2, pin_color), pin_icon = COALESCE(?3, pin_icon),
              kind = ?4, price_per_kg_ct = COALESCE(?5, price_per_kg_ct),
              track_stock = COALESCE(?6, track_stock), pinned_until = COALESCE(?7, pinned_until)
             WHERE id = ?8",
            rusqlite::params![
                order,
                pin.get("pin_color").and_then(|v| v.as_str()),
                pin.get("pin_icon").and_then(|v| v.as_str()),
                kind,
                pin.get("price_per_kg_ct").and_then(|v| v.as_i64()),
                pin.get("track_stock").and_then(|v| v.as_i64()),
                pin.get("pinned_until").and_then(|v| v.as_str()),
                id,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(json!({ "id": id, "pin_order": order }))
    })();
    match res {
        Ok(v) => {
            conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
            Ok(v)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
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

    // ADR-053 P3: NULL barcode = legitimate codeless article; '' normalizes
    // to NULL (control #1); POIDS requires an owner-set price/kg (Q4).
    #[test]
    fn adr053_null_barcode_multiples_and_weight_price_rule() {
        let db = memdb();
        let mut a = prod(21, "");
        a["barcode"] = serde_json::Value::Null;
        a["name_fr"] = json!("OEUF");
        product_upsert(&db, &a).unwrap();
        let mut b = prod(22, "");
        b["name_fr"] = json!("FROMAGE");
        product_upsert(&db, &b).unwrap(); // '' → NULL, no UNIQUE clash
        let n: i64 = db
            .query_row("SELECT COUNT(*) FROM products WHERE barcode IS NULL", [], |r| r.get(0))
            .unwrap();
        assert!(n >= 2, "two codeless articles coexist, got {n}");
        // Raw '' violates the CHECK at the SQL level.
        assert!(db
            .execute(
                "INSERT INTO products (id, barcode, name_fr, buy_price_ct, sell_price_ct, tva_rate, stock_milli, unit)
                 VALUES (99, '', 'RAW', 0, 1, 0, 0, 'PIECE')",
                [],
            )
            .is_err());
        // POIDS without price/kg refuses; with price commits.
        let mut w = prod(23, "");
        w["barcode"] = serde_json::Value::Null;
        w["name_fr"] = json!("LENTILLES");
        w["kind"] = json!("POIDS");
        assert!(product_upsert(&db, &w).is_err());
        w["price_per_kg_ct"] = json!(28000);
        product_upsert(&db, &w).unwrap();
        let kind: String = db
            .query_row("SELECT kind FROM products WHERE id = 23", [], |r| r.get(0))
            .unwrap();
        assert_eq!(kind, "POIDS");
        // Bad kind refuses.
        let mut k = prod(24, "613000000024");
        k["kind"] = json!("WEIRD");
        assert!(product_upsert(&db, &k).is_err());
    }

    #[test]
    fn adr053_pin_crud_evicts_orders_and_filters_expiry() {
        let db = memdb();
        let mut a = prod(31, "");
        a["barcode"] = serde_json::Value::Null;
        a["name_fr"] = json!("OEUF");
        product_upsert(&db, &a).unwrap();
        let mut b = prod(32, "");
        b["name_fr"] = json!("BONBON");
        product_upsert(&db, &b).unwrap();
        product_set_pin(&db, 31, &json!({ "pin_order": 1 })).unwrap();
        product_set_pin(&db, 32, &json!({ "pin_order": 2, "pin_color": "amber" })).unwrap();
        let pins = product_pinned(&db, "2026-11-25").unwrap();
        assert_eq!(pins.as_array().unwrap().len(), 2);
        assert_eq!(pins[0]["id"], 31);
        // Evict: slot 2 moves to 31.
        product_set_pin(&db, 31, &json!({ "pin_order": 2 })).unwrap();
        let pins2 = product_pinned(&db, "2026-11-25").unwrap();
        assert_eq!(pins2.as_array().unwrap().len(), 1);
        assert_eq!(pins2[0]["id"], 31);
        // Bad order + unknown id refuse.
        assert!(product_set_pin(&db, 31, &json!({ "pin_order": 13 })).is_err());
        assert!(product_set_pin(&db, 9999, &json!({ "pin_order": 1 })).is_err());
        // Expiry hides the tile.
        product_set_pin(&db, 31, &json!({ "pin_order": 2, "pinned_until": "2020-01-01" })).unwrap();
        assert!(product_pinned(&db, "2026-11-25").unwrap().as_array().unwrap().is_empty());
        product_set_pin(&db, 31, &json!({ "pin_order": null })).unwrap();
        let cleared: Option<i64> = db
            .query_row("SELECT pin_order FROM products WHERE id = 31", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cleared, None);
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

    // F4 (v1.8.4): client mirror inserts + updates profile, NEVER the balance.
    #[test]
    fn client_upsert_syncs_profile_never_balance() {
        let db = memdb();
        let out = client_upsert(
            &db,
            &json!({"id": 5, "name": "Test 1", "phone": "055", "max_credit_limit_ct": 500000}),
        )
        .unwrap();
        assert_eq!(out["id"], json!(5));
        // Lane-side debt posting, then a profile re-sync must NOT wipe it.
        db.execute(
            "UPDATE clients SET credit_balance_ct = 37000 WHERE id = 5",
            [],
        )
        .unwrap();
        client_upsert(
            &db,
            &json!({"id": 5, "name": "Test 1 Renamed", "max_credit_limit_ct": 600000}),
        )
        .unwrap();
        let (name, bal, lim): (String, i64, i64) = db
            .query_row(
                "SELECT name, credit_balance_ct, max_credit_limit_ct FROM clients WHERE id = 5",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(name, "Test 1 Renamed");
        assert_eq!(bal, 37000); // lane-owned ledger untouched
        assert_eq!(lim, 600000); // UI-owned plafond synced
        assert!(client_upsert(&db, &json!({"id": 0, "name": "X"})).is_err());
        assert!(client_upsert(&db, &json!({"id": 6, "name": "  "})).is_err());
    }
}
