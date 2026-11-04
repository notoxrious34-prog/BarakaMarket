//! Baraka Market v1.0 — Tauri v2 shell (verified baseline, ADR-001-MKT).
//! Native window + first-run SQLite provisioning
//! (db/schema.sql embedded at compile time). Fiscal authority is exposed
//! via the `db_status` invoke command; full sales/settlement/Z lanes are
//! served by the audited loopback API and the SQLite WAL layer.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::PathBuf};

mod auth;
mod fiscal;
mod product;

/// Frozen fiscal schema — the SAME file the Node lane is tested against.
const SCHEMA: &str = include_str!("../../db/schema.sql");

fn data_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("Baraka Market")
}

/// Create %APPDATA%/Baraka Market/baraka.db on first run. Idempotent:
/// existing shops are never touched. Migrates old files to LATEST (T4b).
fn provision_db() -> Result<PathBuf, String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    let db = dir.join("baraka.db");
    if !db.exists() {
        let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    }
    // Converge every open (fresh or legacy) to LATEST_SCHEMA_VERSION.
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::migrate(&conn)?;
    Ok(db)
}

/// T4 (ADR-025): relay the loopback write token (minted by the server beside
/// the DB) to the frontend. Absent until the server boots once — the client
/// treats that as the no-token path (writes queue in the outbox).
#[tauri::command]
fn loopback_token() -> Result<String, String> {
    let p = data_dir().join(".loopback.token");
    let t = fs::read_to_string(&p)
        .map(|s| s.trim().to_string())
        .map_err(|_| {
            "loopback server has not issued a token yet (start the loopback first)".to_string()
        })?;
    if t.len() < 16 {
        return Err("loopback token file is corrupt (delete it to rotate)".to_string());
    }
    Ok(t)
}

/// T4b (ADR-026): native fiscal commit — sale. The frontend computes the
/// centimes payload with the tested engine; Rust re-validates, owns seq +
/// idempotency, and commits atomically. Loopback-independent (exe lane).
#[tauri::command]
fn record_sale(
    header: serde_json::Value,
    items: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let mut conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    let arr = items
        .as_array()
        .ok_or("[fiscal] items must be an array")?
        .clone();
    fiscal::record_sale(&mut conn, &header, &arr)
}

/// T4b (ADR-026): native fiscal commit — debt settlement (Q via server seq).
#[tauri::command]
fn record_settlement(input: serde_json::Value) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let mut conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::record_settlement(&mut conn, &input)
}

/// T4c (ADR-027): native product mirror — upsert one row (explicit UI id).
#[tauri::command]
fn product_upsert(product: serde_json::Value) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    product::product_upsert(&conn, &product)
}

/// T4c: native product mirror — full list for stock-truth reads.
#[tauri::command]
fn product_list() -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    product::product_list(&conn)
}

/// T4c: native product mirror — POS lookup (barcode exact-first).
#[tauri::command]
fn product_search(query: String) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    product::product_search(&conn, &query)
}

/// T8 (ADR-031): native user verification (salted SHA-256, lockout, audit).
#[tauri::command]
fn user_verify(username: String, pin: String) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    auth::user_verify(&conn, &username, &pin)
}

/// #003 (Phase A): atomic sequence mint (preview/reservation lane).
#[tauri::command]
fn next_invoice(kind: String, year: i64) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let mut conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::next_invoice(&mut conn, &kind, year)
}

/// #003 (Phase A): legal void — status flip + journal row, no DELETE.
#[tauri::command]
fn void_sale(
    saleId: String,
    reason: String,
    voidedBy: String,
) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let mut conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::void_sale(&mut conn, &saleId, &reason, &voidedBy)
}

/// #004 (Phase A): legal day close — recompute, lock, chain (native lane).
#[tauri::command]
fn z_close(
    day: String,
    opening_time: String,
    closing_time: String,
) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let mut conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::z_close(&mut conn, &day, &opening_time, &closing_time)
}

/// #003 (Phase A): day summary for the Z lane (read-only; lock lives in #004).
#[tauri::command]
fn daily_z(day: String) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::daily_z(&conn, &day)
}

/// #003 (Phase A): hot snapshot — VACUUM INTO a sibling file.
#[tauri::command]
fn backup_db(dest: String) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::backup_db(&conn, &dest)
}

/// P3 (v1.4.4): audited clean-start — refuses without a VERIFIED exempt
/// pre-reset archive; clears trial books, restarts numbering, genesis audit.
#[tauri::command]
fn factory_reset(archiveRef: String, actor: String) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::factory_reset(&conn, &archiveRef, &actor)
}

/// P3 (v1.4.4): log a just-taken hot snapshot in `backups_log`
/// (retention-exempt when it is a pre-reset safety archive).
#[tauri::command]
fn register_backup(
    id: String,
    dest: String,
    label: String,
    appVersion: String,
    exempt: bool,
) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::register_backup(&conn, &id, &dest, &label, &appVersion, exempt)
}

/// T12 fix: native PIN change. The exe never had this command — forced-change
/// died with "check the connection" because no loopback runs in the shell.
#[tauri::command]
fn change_pin(userId: i64, oldPin: String, newPin: String) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    auth::user_change_pin(&conn, userId, &oldPin, &newPin)
}

/// T8: native safe user list (secrets never leave the DAL).
#[tauri::command]
fn user_list() -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    auth::user_list(&conn)
}

/// T8: native audit read for the manager lane.
#[tauri::command]
fn audit_list(limit: u32) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    let n = limit.clamp(1, 500) as i64;
    let mut st = conn
        .prepare("SELECT id, ts, actor, action, entity, entity_id, detail FROM audit_log ORDER BY id DESC LIMIT ?1")
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map([n], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, i64>(0)?, "ts": r.get::<_, String>(1)?, "actor": r.get::<_, String>(2)?,
                "action": r.get::<_, String>(3)?, "entity": r.get::<_, String>(4)?,
                "entity_id": r.get::<_, String>(5)?, "detail": r.get::<_, String>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(serde_json::Value::Array(out))
}

/// T8: client-side security events (logout, lock) for the native lane.
#[tauri::command]
fn audit_log(actor: String, action: String, detail: String) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    auth::audit_log(&conn, &actor, &action, &detail)
}

/// Gate-02 TASK 1: native authority probe. The frontend calls this via
/// `invoke('db_status')`; success flips the POS into MODE FISCAL ACTIF.
#[tauri::command]
fn db_status() -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    let journal: String = conn
        .query_row("PRAGMA journal_mode", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "db": db.to_string_lossy(), "journal_mode": journal }))
}

fn main() {
    match provision_db() {
        Ok(p) => println!("[baraka] db ready at {}", p.display()),
        Err(e) => eprintln!("[baraka] db provisioning FAILED: {e}"),
    }
    tauri::Builder::default()
        // T9 (ADR-032): silent updater — no dialog. The UI drives check/
        // download/install explicitly (AR/FR) so a cashier never gets a
        // surprise restart mid-shift.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            db_status,
            loopback_token,
            record_sale,
            record_settlement,
            next_invoice,
            void_sale,
            daily_z,
            z_close,
            backup_db,
            factory_reset,
            register_backup,
            product_upsert,
            product_list,
            product_search,
            user_verify,
            change_pin,
            user_list,
            audit_list,
            audit_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running Baraka Market");
}
