//! Baraka Market v1.0 — Tauri v2 shell (verified baseline, ADR-001-MKT).
//! Native window + first-run SQLite provisioning
//! (db/schema.sql embedded at compile time). Fiscal authority is exposed
//! via the `db_status` invoke command; full sales/settlement/Z lanes are
//! served by the audited loopback API and the SQLite WAL layer.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, path::PathBuf};

/// Frozen fiscal schema — the SAME file the Node lane is tested against.
const SCHEMA: &str = include_str!("../../db/schema.sql");

fn data_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("Baraka Market")
}

/// Create %APPDATA%/Baraka Market/baraka.db on first run. Idempotent:
/// existing shops are never touched.
fn provision_db() -> Result<PathBuf, String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
    let db = dir.join("baraka.db");
    if !db.exists() {
        let conn = rusqlite::Connection::open(&db).map_err(|e| e.to_string())?;
        conn.execute_batch(SCHEMA).map_err(|e| e.to_string())?;
    }
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
        .invoke_handler(tauri::generate_handler![db_status, loopback_token])
        .run(tauri::generate_context!())
        .expect("error while running Baraka Market");
}
