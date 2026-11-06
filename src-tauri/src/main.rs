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

/// T4c-fix (institutional stock audit S3): native mirror row delete.
#[tauri::command]
fn product_delete(id: i64) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    product::product_delete(&conn, id)
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
#[tauri::command(rename_all = "camelCase")]
fn void_sale(
    sale_id: String,
    reason: String,
    voided_by: String,
) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let mut conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::void_sale(&mut conn, &sale_id, &reason, &voided_by)
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

/// v1.5.0 (RETURNS): draft a return (no RET number yet — minted at approve).
#[tauri::command(rename_all = "camelCase")]
fn return_create(
    sale_id: String,
    items_json: String,
    reason: String,
    reason_note: Option<String>,
    actor: String,
    client_key: Option<String>,
    today: String,
) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let mut conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::return_create(
        &mut conn,
        &sale_id,
        &items_json,
        &reason,
        reason_note,
        &actor,
        client_key,
        &today,
    )
}

/// v1.5.0 (RETURNS): approve a draft — mints RET-YYYY-XXXXXX, restocks,
/// posts the cash WITHDRAWAL, audits.
#[tauri::command(rename_all = "camelCase")]
fn return_approve(
    id: String,
    approver: String,
    approver_role: String,
    today: String,
) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let mut conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::return_approve(&mut conn, &id, &approver, &approver_role, &today)
}

/// v1.5.0 (RETURNS): reject a draft (terminal, audited).
#[tauri::command]
fn return_reject(
    id: String,
    actor: String,
    note: Option<String>,
) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let mut conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::return_reject(&mut conn, &id, &actor, note)
}

/// v1.5.0 (RETURNS): read one return with its lines (null JSON when unknown).
#[tauri::command]
fn return_get(id: String) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::return_get(&conn, &id)
}

/// v1.5.0 (RETURNS lookup): sale head + returnable lines by UUID id OR FACT
/// number (read-only; null JSON when unknown).
#[tauri::command]
fn sale_for_return(key: String) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::sale_for_return(&conn, &key)
}

/// v1.5.0 (RETURNS): list returns, optionally filtered by status.
#[tauri::command]
fn return_list(status: Option<String>) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::return_list(&conn, status)
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
#[tauri::command(rename_all = "camelCase")]
fn factory_reset(archive_ref: String, actor: String) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::factory_reset(&conn, &archive_ref, &actor)
}

/// P3 (v1.4.4): log a just-taken hot snapshot in `backups_log`
/// (retention-exempt when it is a pre-reset safety archive).
#[tauri::command(rename_all = "camelCase")]
fn register_backup(
    id: String,
    dest: String,
    label: String,
    app_version: String,
    exempt: bool,
) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::register_backup(&conn, &id, &dest, &label, &app_version, exempt)
}

/// v1.4.6: native cash-session lane (production independence, #PROD-CASH).
/// The installed app has no :3100 loopback — these replace the server calls
/// the Cloture page and the POS till-expense path used to make.
#[tauri::command(rename_all = "camelCase")]
fn cash_open(
    id: String,
    cashier_name: String,
    opening_float_ct: i64,
) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::cash_open(&conn, &id, &cashier_name, opening_float_ct)
}

/// v1.4.6: guarded till movement (F3/F4 twins enforced natively).
#[tauri::command(rename_all = "camelCase")]
fn cash_movement(
    id: String,
    session_id: String,
    movement_type: String,
    amount_ct: i64,
    reason: String,
) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::cash_movement(&conn, &id, &session_id, &movement_type, amount_ct, &reason)
}

/// v1.4.6: live till status (native theoretical, same equation as the server).
#[tauri::command]
fn cash_active() -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::cash_active(&conn)
}

/// v1.4.6: newest-first session history for the Cloture page.
#[tauri::command]
fn cash_sessions(limit: i64) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::cash_sessions(&conn, limit)
}

/// v1.4.6: the movement trail of one session (F8), newest first.
#[tauri::command(rename_all = "camelCase")]
fn cash_movements(session_id: String, limit: i64) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::cash_movements(&conn, &session_id, limit)
}

/// v1.4.6: atomic SHIFT close + hash-chained Z (day-lock enforced natively).
#[tauri::command(rename_all = "camelCase")]
fn cash_close_and_z(
    session_id: String,
    counted_cash_ct: i64,
    notes: Option<String>,
) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let mut conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::cash_close_and_z(&mut conn, &session_id, counted_cash_ct, notes.as_deref())
}

/// v1.4.9 (#PROD-LOCAL): fiscal loss — ledger row + stock decrement, no :3100.
#[tauri::command]
fn record_loss(input: serde_json::Value) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let mut conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::record_loss(&mut conn, &input)
}

/// v1.4.9 (#PROD-LOCAL): self-contained hot backup (dest derived from DB dir).
#[tauri::command]
fn backup_create(app: tauri::AppHandle, label: String) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let dir = db
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    let ver = app.package_info().version.to_string();
    fiscal::backup_create(&conn, &dir, &label, &ver)
}

/// v1.4.9 (#PROD-LOCAL): list registered hot snapshots (newest first).
#[tauri::command]
fn backup_list() -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::backup_list(&conn)
}

/// v1.4.9 (#PROD-LOCAL): Z registry for the exe (reprint + chain after restart).
#[tauri::command]
fn z_list() -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    fiscal::z_list(&conn)
}

/// T12 fix: native PIN change. The exe never had this command — forced-change
/// died with "check the connection" because no loopback runs in the shell.
#[tauri::command(rename_all = "camelCase")]
fn change_pin(user_id: i64, old_pin: String, new_pin: String) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    auth::user_change_pin(&conn, user_id, &old_pin, &new_pin)
}

/// T8: native safe user list (secrets never leave the DAL).
#[tauri::command]
fn user_list() -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    auth::user_list(&conn)
}

/// T8b: native user creation (owner-gated) — closes the production gap where
/// the exe could verify users but never create them.
#[tauri::command(rename_all = "camelCase")]
fn user_create(
    username: String,
    display_name: String,
    role: String,
    pin: String,
    requester_role: String,
    actor: String,
) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    auth::user_create(
        &conn,
        &username,
        &display_name,
        &role,
        &pin,
        &requester_role,
        &actor,
    )
}

/// T8b: native activate/deactivate (owner-gated, owners immune).
#[tauri::command(rename_all = "camelCase")]
fn user_set_active(
    user_id: i64,
    active: bool,
    requester_role: String,
    actor: String,
) -> Result<serde_json::Value, String> {
    let db = provision_db()?;
    let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
    auth::user_set_active(&conn, user_id, active, &requester_role, &actor)
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
            product_delete,
            user_verify,
            change_pin,
            user_list,
            user_create,
            user_set_active,
            audit_list,
            audit_log,
            cash_open,
            cash_movement,
            cash_active,
            cash_sessions,
            cash_movements,
            cash_close_and_z,
            record_loss,
            backup_create,
            backup_list,
            z_list,
            return_create,
            return_approve,
            return_reject,
            return_get,
            sale_for_return,
            return_list
        ])
        .run(tauri::generate_context!())
        .expect("error while running Baraka Market");
}
