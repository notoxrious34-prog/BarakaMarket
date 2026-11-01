//! T8 (ADR-031) — native users + security audit.
//! SHA-256 is a compact portable implementation (FIPS 180-4) pinned by the
//! NIST vectors below. Same `saltHex:hashHex` verifier as
//! src/core/security.ts, so verifiers are interchangeable across lanes.
//! Recorded trade-off: SHA-256 (not scrypt/argon2) because no hash crate is
//! vendored and the build is offline; local-only PINs + lockout + audit.
//! T8b upgrades the KDF when crates are available (verifier format versions
//! cleanly: `salt:hash` gains a `kdf$` prefix).

use rusqlite::Connection;
use serde_json::{json, Value};

const K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

fn sha256_bytes(msg: &[u8]) -> [u8; 32] {
    let ml = msg.len() as u64;
    let mut padded = msg.to_vec();
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&ml.wrapping_mul(8).to_be_bytes());
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut w = [0u32; 64];
    for off in (0..padded.len()).step_by(64) {
        for i in 0..16 {
            let b = &padded[off + i * 4..off + i * 4 + 4];
            w[i] = u32::from_be_bytes([b[0], b[1], b[2], b[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) =
            (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }
    let mut out = [0u8; 32];
    for (i, v) in h.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}

pub fn sha256_hex(s: &str) -> String {
    sha256_bytes(s.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub fn verify_pin_format(pin: &str) -> bool {
    (4..=8).contains(&pin.len()) && pin.bytes().all(|c| c.is_ascii_digit())
}

fn safe_equal(a: &str, b: &str) -> bool {
    if (a.len() != b.len()) || a.is_empty() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

/// Same verifier as TS `verifyPin`: `saltHex:hashHex`, SHA-256(salt:pin).
pub fn verify_pin_verifier(input_pin: &str, stored: &str) -> bool {
    match stored.split_once(':') {
        Some((salt, expected)) => safe_equal(&sha256_hex(&format!("{salt}:{input_pin}")), expected),
        None => false,
    }
}

/// Boot salt: (nanos, pid, counter) hashed. Unique per mint, rotated on
/// every PIN change. Documented T8 trade-off (no rand crate vendored).
static SALT_CTR: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

pub fn mint_verifier(pin: &str) -> Result<String, String> {
    if (!verify_pin_format(pin)) {
        return Err("[auth] PIN must be 4-8 numeric digits".to_string());
    }
    let n = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let c = SALT_CTR.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let salt_full = sha256_hex(&format!("{n}:{}:{c}", std::process::id()));
    let salt = &salt_full[..32];
    Ok(format!("{salt}:{}", sha256_hex(&format!("{salt}:{pin}"))))
}

fn audit(conn: &Connection, actor: &str, action: &str, detail: &str) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| (d.as_secs() as i64))
        .unwrap_or(0);
    let _ = conn.execute(
        "INSERT INTO audit_log (ts, actor, action, detail) VALUES (datetime(?1, 'unixepoch'), ?2, ?3, ?4)",
        rusqlite::params![ts, actor, action, detail],
    );
}

/// v3 → v4 step for the native lane (mirrors TS migrateSchemaVersion).
pub fn migrate_v4(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS users (
           id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
           display_name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL CHECK (role IN ('cashier', 'manager', 'owner')),
           pin_verifier TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
           must_change_pin INTEGER NOT NULL DEFAULT 0, failed_attempts INTEGER NOT NULL DEFAULT 0,
           locked_until_ms INTEGER NOT NULL DEFAULT 0, lock_cycles INTEGER NOT NULL DEFAULT 0,
           created_at TEXT NOT NULL DEFAULT '', last_login_at TEXT NOT NULL DEFAULT ''
         );
         CREATE TABLE IF NOT EXISTS audit_log (
           id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL,
           actor TEXT NOT NULL DEFAULT '', action TEXT NOT NULL,
           entity TEXT NOT NULL DEFAULT '', entity_id TEXT NOT NULL DEFAULT '',
           detail TEXT NOT NULL DEFAULT ''
         );",
    )
    .map_err(|e| e.to_string())?;
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if (n == 0) {
        let v = mint_verifier("1234")?;
        conn.execute(
            "INSERT INTO users (username, display_name, role, pin_verifier, must_change_pin, created_at)
             VALUES ('owner', 'Gérant', 'owner', ?1, 1, datetime('now'))",
            [v],
        )
        .map_err(|e| e.to_string())?;
        audit(conn, "system", "user.create", "first-owner seed");
    }
    Ok(())
}

const LOCK_MAX: i64 = 5;
const LOCK_BASE_MS: i64 = 60_000;

pub fn user_verify(conn: &Connection, username: &str, pin: &str) -> Result<Value, String> {
    let name = username.trim().to_lowercase();
    let row: Option<(i64, String, String, String, String, i64, i64, i64, i64)> = conn
        .query_row(
            "SELECT id, username, display_name, role, pin_verifier, active, failed_attempts, locked_until_ms, lock_cycles FROM users WHERE username = ?1",
            [&name],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    // now_ms
    let now_ms: i64 = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let Some((id, uname, display, role, verifier, active, fails, locked_until, cycles)) = row
    else {
        audit(conn, &name, "login.fail", "unknown-or-inactive");
        return Ok(json!({ "ok": false, "locked": false }));
    };
    if active == 0 {
        audit(conn, &name, "login.fail", "unknown-or-inactive");
        return Ok(json!({ "ok": false, "locked": false }));
    }
    if locked_until > now_ms {
        audit(conn, &name, "login.locked", "");
        return Ok(json!({ "ok": false, "locked": true }));
    }
    if verify_pin_verifier(pin, &verifier) {
        conn.execute(
            "UPDATE users SET failed_attempts = 0, locked_until_ms = 0, last_login_at = datetime('now') WHERE id = ?1",
            [id],
        )
        .map_err(|e| e.to_string())?;
        audit(conn, &name, "login.ok", "");
        let must: i64 = conn
            .query_row(
                "SELECT must_change_pin FROM users WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        return Ok(
            json!({ "ok": true, "user": { "id": id, "username": uname, "display_name": display, "role": role, "must_change_pin": must, "active": 1 } }),
        );
    }
    // Failure: T8 lockout math (mirrors TS registerAttempt exactly).
    let (nfails, nlocked, ncycles) = if fails + 1 < LOCK_MAX {
        (fails + 1, 0, cycles)
    } else {
        (0, now_ms + LOCK_BASE_MS * (1 << cycles.min(10)), cycles + 1)
    };
    conn.execute(
        "UPDATE users SET failed_attempts = ?1, locked_until_ms = ?2, lock_cycles = ?3 WHERE id = ?4",
        rusqlite::params![nfails, nlocked, ncycles, id],
    )
    .map_err(|e| e.to_string())?;
    audit(conn, &name, "login.fail", "");
    Ok(json!({ "ok": false, "locked": nlocked > now_ms }))
}

/// T8: client-side security events (logout, session lock/unlock) — both
/// lanes audit verify server-side already; this covers the local-only ones.
pub fn audit_log(
    conn: &Connection,
    actor: &str,
    action: &str,
    detail: &str,
) -> Result<Value, String> {
    audit(conn, actor, action, detail);
    Ok(json!({ "ok": true }))
}

pub fn user_list(conn: &Connection) -> Result<Value, String> {
    let mut st = conn
        .prepare("SELECT id, username, display_name, role, must_change_pin, active FROM users ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?, "username": r.get::<_, String>(1)?,
                "display_name": r.get::<_, String>(2)?, "role": r.get::<_, String>(3)?,
                "must_change_pin": r.get::<_, i64>(4)?, "active": r.get::<_, i64>(5)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(Value::Array(out))
}

// Convenience: rusqlite OptionalExtension trait import for .optional().
use rusqlite::OptionalExtension;

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    const SCHEMA: &str = include_str!("../../db/schema.sql");

    fn memdb() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        crate::fiscal::migrate(&conn).unwrap();
        migrate_v4(&conn).unwrap();
        conn.query_row("PRAGMA user_version = 4", [], |_| Ok(()))
            .unwrap_or(());
        conn
    }

    #[test]
    fn sha256_matches_nist_vectors() {
        assert_eq!(
            sha256_hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256_hex(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn verifier_round_trips_and_rejects() {
        let v = mint_verifier("1234").unwrap();
        assert!(verify_pin_verifier("1234", &v));
        assert!(!verify_pin_verifier("0000", &v));
        assert!(!verify_pin_verifier("1234", "no-separator"));
        assert!(mint_verifier("12").is_err());
    }

    #[test]
    fn native_verify_ok_fail_lockout() {
        let db = memdb();
        let ok = user_verify(&db, "owner", "1234").unwrap();
        assert_eq!(ok["ok"], true);
        assert_eq!(ok["user"]["role"], "owner");
        for _ in 0..4 {
            let r = user_verify(&db, "owner", "0000").unwrap();
            assert_eq!(r["locked"], false);
        }
        let fifth = user_verify(&db, "owner", "0000").unwrap();
        assert_eq!(fifth["locked"], true);
        let during = user_verify(&db, "owner", "1234").unwrap();
        assert_eq!(during["ok"], false);
    }

    #[test]
    fn migrate_v4_seeds_owner_once() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        migrate_v4(&conn).unwrap();
        migrate_v4(&conn).unwrap(); // idempotent
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let list = user_list(&conn).unwrap();
        assert_eq!(list[0]["username"], "owner");
        assert!(
            list[0].get("pin_verifier").is_none(),
            "secrets never listed"
        );
    }

    #[test]
    fn audit_and_users_are_append_only() {
        // T11 (ADR-034): the security trail cannot be edited or erased, and
        // operators deactivate instead of deleting — even via direct SQL.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        migrate_v4(&conn).unwrap();
        assert!(conn.execute("DELETE FROM audit_log", []).is_err());
        assert!(conn
            .execute("UPDATE audit_log SET detail = 'x'", [])
            .is_err());
        assert!(conn.execute("DELETE FROM users", []).is_err());
    }
}
