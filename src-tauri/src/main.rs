//! Baraka Market v1.0 — Tauri shell.
//! v1 installer scope: native window + first-run SQLite provisioning
//! (db/schema.sql embedded at compile time). The POS UI runs the verified
//! localStorage lane; full SQLite wiring lands in TASK #003 via `invoke`.
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

fn main() {
    match provision_db() {
        Ok(p) => println!("[baraka] db ready at {}", p.display()),
        Err(e) => eprintln!("[baraka] db provisioning FAILED: {e}"),
    }
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running Baraka Market");
}
