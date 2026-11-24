//! ADR-050 P1: native machine identity + meta KV helpers (std-only, no new crates).
//! The exe lane owns stable machine facts: Windows MachineGuid (via reg.exe,
//! cached by the caller in meta) with COMPUTERNAME fallback. Cloning the DB
//! file to another PC changes the GUID → drift → lock: the anti-clone anchor.

use rusqlite::Connection;
use serde_json::Value;

/// Parse `reg query HKLM\...\Cryptography /v MachineGuid` stdout.
/// Pure — unit-tested below.
pub fn parse_machine_guid_output(out: &str) -> Option<String> {
    for line in out.lines() {
        let t = line.trim();
        if t.starts_with("MachineGuid") {
            let v = t.split_whitespace().last().unwrap_or("");
            if v.len() >= 8 && v.contains('-') {
                return Some(v.to_string());
            }
        }
    }
    None
}

fn read_machine_guid() -> Option<String> {
    let o = std::process::Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .output()
        .ok()?;
    if !o.status.success() {
        return None;
    }
    parse_machine_guid_output(&String::from_utf8_lossy(&o.stdout))
}

/// Stable native facts for the HWID formula (shape mirrors TS MachineParts).
pub fn machine_facts() -> Value {
    let guid = read_machine_guid().unwrap_or_default();
    let host = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown".to_string());
    serde_json::json!({
        "guid": guid,
        "hostname": host,
        "arch": std::env::consts::ARCH,
        "os": std::env::var("OS").unwrap_or_default(),
    })
}

/// Meta KV read (license anchors live here on the native lane).
pub fn meta_get(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut st = conn
        .prepare("SELECT value FROM meta WHERE key = ?1")
        .map_err(|e| e.to_string())?;
    let v: Option<String> = st
        .query_row([key], |r| r.get(0))
        .map(Some)
        .or(Ok(None))
        .map_err(|e: rusqlite::Error| e.to_string())?;
    Ok(v)
}

/// Meta KV stamp-once (trial epoch anchor): INSERT OR IGNORE — the first
/// writer wins, later boots never move the anchor (kills trial resets).
pub fn meta_stamp_once(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO NOTHING",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
/// Meta KV upsert (full overwrite of an existing key).
pub fn meta_set(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const REG_OUT: &str = "\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\n    MachineGuid    REG_SZ    8f3b2a1c-4d5e-6f70-81a2-b3c4d5e6f708\n";

    #[test]
    fn parses_machine_guid_from_reg_output() {
        assert_eq!(
            parse_machine_guid_output(REG_OUT),
            Some("8f3b2a1c-4d5e-6f70-81a2-b3c4d5e6f708".to_string())
        );
    }

    #[test]
    fn rejects_reg_output_without_guid() {
        assert_eq!(parse_machine_guid_output("HKEY_FOO\n    Other    REG_SZ    x\n"), None);
        assert_eq!(parse_machine_guid_output(""), None);
    }

    #[test]
    fn machine_facts_shape_is_stable() {
        let f = machine_facts();
        assert!(f.get("hostname").and_then(|v| v.as_str()).is_some());
        assert!(f.get("arch").and_then(|v| v.as_str()).is_some());
        assert!(f.get("guid").is_some());
    }
}
