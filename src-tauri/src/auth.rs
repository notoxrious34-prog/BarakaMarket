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

pub(crate) fn sha256_bytes(msg: &[u8]) -> [u8; 32] {
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
    if !verify_pin_format(pin) {
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
        .map(|d| d.as_secs() as i64)
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
    if n == 0 {
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

/// v1.5.1 §4: periodic mandatory rotation — window in days (meta KV),
/// default 90, valid 1..365. Garbage/blank reads fall back to the default.
pub const PIN_ROTATION_DEFAULT_DAYS: i64 = 90;
const PIN_ROTATION_MIN_DAYS: i64 = 1;
const PIN_ROTATION_MAX_DAYS: i64 = 365;
const PIN_ROTATION_META_KEY: &str = "pin_rotation_days";

pub fn get_rotation_days(conn: &Connection) -> i64 {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key = ?1",
            [PIN_ROTATION_META_KEY],
            |r| r.get(0),
        )
        .optional()
        .unwrap_or(None)
        .flatten();
    if let Some(s) = raw {
        if let Ok(n) = s.trim().parse::<i64>() {
            if (PIN_ROTATION_MIN_DAYS..=PIN_ROTATION_MAX_DAYS).contains(&n) {
                return n;
            }
        }
    }
    PIN_ROTATION_DEFAULT_DAYS
}

pub fn set_rotation_days(conn: &Connection, days: i64, actor: &str) -> Result<Value, String> {
    if !(PIN_ROTATION_MIN_DAYS..=PIN_ROTATION_MAX_DAYS).contains(&days) {
        return Err("[auth] rotation window must be 1-365 days".to_string());
    }
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        rusqlite::params![PIN_ROTATION_META_KEY, days.to_string()],
    )
    .map_err(|e| e.to_string())?;
    audit(
        conn,
        actor,
        "users.rotation_config",
        &format!("days={days}"),
    );
    Ok(json!({ "ok": true, "days": days }))
}

/// Whole days since a `YYYY-MM-DDTHH:MM:SS` stamp (floor, UTC). None =
/// missing/garbage clock (treated as fresh by the caller).
fn days_since(stamp: Option<String>) -> Option<i64> {
    let s = stamp?;
    if s.len() < 19 {
        return None;
    }
    let b = s.as_bytes();
    if b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' {
        return None;
    }
    let y: i64 = s[0..4].parse().ok()?;
    let m: i64 = s[5..7].parse().ok()?;
    let d: i64 = s[8..10].parse().ok()?;
    let now_secs: i64 = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|x| x.as_secs() as i64)
        .unwrap_or(0);
    let elapsed = now_secs.div_euclid(86_400) - crate::fiscal::days_from_civil(y, m, d);
    Some(elapsed.max(0))
}

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
        let row2: (i64, Option<String>) = conn
            .query_row(
                "SELECT must_change_pin, pin_expires_at FROM users WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        // v1.5.1 §3: a temp PIN past its deadline dies even with the right code.
        if row2.0 == 1 {
            if let Some(ref exp) = row2.1 {
                let now19 = &crate::fiscal::now_iso()[..19];
                if exp.as_str() <= now19 {
                    audit(conn, &name, "login.fail", "temp-expired");
                    return Ok(json!({ "ok": false, "locked": false }));
                }
            }
        }
        let must: i64 = row2.0;
        // v1.5.1 §4: rotation — N days since the last change forces a change;
        // the countdown rides along for the 7-day reminder. NULL clock = fresh.
        let win = get_rotation_days(conn);
        let changed: Option<String> = conn
            .query_row(
                "SELECT pin_changed_at FROM users WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let (rotation_due, rotation_days_left) = match days_since(changed) {
            None => (false, win),
            Some(elapsed) => (elapsed >= win, win - elapsed),
        };
        return Ok(
            json!({ "ok": true, "user": { "id": id, "username": uname, "display_name": display, "role": role, "must_change_pin": must, "active": 1, "rotation_due": rotation_due, "rotation_days_left": rotation_days_left } }),
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

/// T12 fix: native PIN change (the exe never had this command — forced-change
/// died with "check the connection" because no loopback runs in the shell).
/// The old PIN must verify; no lockout counting here (identity was just proven
/// via verify, or the session is mid forced-change); rejections stay generic.
pub fn user_change_pin(
    conn: &Connection,
    user_id: i64,
    old_pin: &str,
    new_pin: &str,
) -> Result<Value, String> {
    if !verify_pin_format(new_pin) {
        return Err("[auth] new PIN must be 4-8 digits".to_string());
    }
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT username, pin_verifier FROM users WHERE id = ?1 AND active = 1",
            [user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((uname, verifier)) = row else {
        return Err("[auth] unknown or inactive user".to_string());
    };
    if !verify_pin_verifier(old_pin, &verifier) {
        audit(conn, &uname, "pin.change", "rejected: old mismatch");
        return Err("[auth] current PIN is incorrect".to_string());
    }
    let v = mint_verifier(new_pin)?;
    conn.execute(
        "UPDATE users SET pin_verifier = ?1, must_change_pin = 0, pin_expires_at = NULL, pin_changed_at = substr(?2, 1, 19) WHERE id = ?3",
        rusqlite::params![v, crate::fiscal::now_iso(), user_id],
    )
    .map_err(|e| e.to_string())?;
    audit(conn, &uname, "pin.change", "");
    Ok(json!({ "ok": true }))
}

/// v1.5.1 §3: owner-issued temporary PIN. Flags `must_change_pin = 1` so the
/// new PIN dies at first login; owner accounts are immune (self-change with
/// the old PIN). `expires_at` (`YYYY-MM-DDTHH:MM:SS`, UTC, future) arms
/// auto-expiry; empty = provisioned-style flag with no deadline.
/// The audit carries the target only — verifiers never leave.
pub fn user_reset_pin(
    conn: &Connection,
    user_id: i64,
    new_pin: &str,
    requester_role: &str,
    actor: &str,
    expires_at: &str,
) -> Result<Value, String> {
    if requester_role != "owner" {
        return Err("[auth] owner role required".to_string());
    }
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT username, role FROM users WHERE id = ?1",
            [user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((uname, role)) = row else {
        return Err(format!("[auth] unknown user: {user_id}"));
    };
    if role == "owner" {
        return Err("[auth] owner accounts are never reset — use self-change".to_string());
    }
    if !verify_pin_format(new_pin) {
        return Err("[auth] PIN must be 4-8 numeric digits".to_string());
    }
    // Canonical temp-PIN deadline: 19-char UTC stamp, strictly in the future.
    let exp: Option<String> = if expires_at.trim().is_empty() {
        None
    } else {
        let e = expires_at.trim();
        let shape = e.len() == 19
            && e.as_bytes()[4] == b'-'
            && e.as_bytes()[7] == b'-'
            && e.as_bytes()[10] == b'T'
            && e.as_bytes()[13] == b':'
            && e.as_bytes()[16] == b':';
        if !shape {
            return Err("[auth] expiresAt must be YYYY-MM-DDTHH:MM:SS".to_string());
        }
        let now19 = &crate::fiscal::now_iso()[..19];
        if e <= now19 {
            return Err("[auth] temp PIN expiry must be in the future".to_string());
        }
        Some(e.to_string())
    };
    let v = mint_verifier(new_pin)?;
    conn.execute(
        "UPDATE users SET pin_verifier = ?1, must_change_pin = 1, pin_expires_at = ?2, pin_changed_at = substr(?3, 1, 19) WHERE id = ?4",
        rusqlite::params![v, exp, crate::fiscal::now_iso(), user_id],
    )
    .map_err(|e| e.to_string())?;
    audit(
        conn,
        actor,
        "pin.reset",
        &match exp {
            Some(ref e) => format!("users:{uname} temporary until {e} — change enforced at login"),
            None => format!("users:{uname} temporary — change enforced at login"),
        },
    );
    Ok(json!({ "ok": true }))
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
        .prepare("SELECT id, username, display_name, role, must_change_pin, active, freeze_reason, freeze_note, pin_expires_at, pin_changed_at FROM users ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = st
        .query_map([], |r| {
            Ok(json!({
                "id": r.get::<_, i64>(0)?, "username": r.get::<_, String>(1)?,
                "display_name": r.get::<_, String>(2)?, "role": r.get::<_, String>(3)?,
                "must_change_pin": r.get::<_, i64>(4)?, "active": r.get::<_, i64>(5)?,
                "freeze_reason": r.get::<_, Option<String>>(6)?,
                "freeze_note": r.get::<_, Option<String>>(7)?,
                "pin_expires_at": r.get::<_, Option<String>>(8)?,
                "pin_changed_at": r.get::<_, Option<String>>(9)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(Value::Array(out))
}

/// T8b: native user creation (owner-gated). Mirrors the TS DAL validation so
/// both lanes accept exactly the same usernames/roles/PINs. New users start
/// with `must_change_pin = 1`: a provisioned PIN never survives first login.
pub fn user_create(
    conn: &Connection,
    username: &str,
    display_name: &str,
    role: &str,
    pin: &str,
    requester_role: &str,
    actor: &str,
    confirm_pin: &str,
) -> Result<Value, String> {
    if requester_role != "owner" {
        return Err("[auth] owner role required".to_string());
    }
    let name = username.trim().to_lowercase();
    if !valid_username(&name) {
        return Err("[auth] bad username (3-20 chars: a-z 0-9 . _ -)".to_string());
    }
    if role != "cashier" && role != "manager" && role != "owner" {
        return Err(format!("[auth] bad role: {role}"));
    }
    if !verify_pin_format(pin) {
        return Err("[auth] PIN must be 4-8 numeric digits".to_string());
    }
    // v1.5.1 B2-5: a second owner needs a live owner confirmation — the
    // requesting owner re-enters their OWN current PIN (presence proof
    // against a walked-away terminal). No lockout counting: re-auth
    // gesture, not a login; refusal is audited either way.
    if role == "owner" {
        let gate: Option<String> = conn
            .query_row(
                "SELECT pin_verifier FROM users WHERE username = ?1 AND role = 'owner' AND active = 1",
                [actor.trim().to_lowercase()],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten();
        let ok = match gate {
            Some(v) => verify_pin_verifier(confirm_pin.trim(), &v),
            None => false,
        };
        if !ok {
            audit(
                conn,
                actor,
                "owner.confirm",
                &format!("second-owner:{name} rejected"),
            );
            return Err("[auth] second-owner creation needs the requesting owner PIN".to_string());
        }
        audit(
            conn,
            actor,
            "owner.confirm",
            &format!("second-owner:{name} ok"),
        );
    }
    let dn_trimmed = display_name.trim();
    let dn: String = if dn_trimmed.is_empty() {
        name.clone()
    } else {
        dn_trimmed.chars().take(40).collect()
    };
    let v = mint_verifier(pin)?;
    match conn.execute(
        "INSERT INTO users (username, display_name, role, pin_verifier, must_change_pin, pin_changed_at, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, replace(datetime('now'),' ','T'), datetime('now'))",
        rusqlite::params![name, dn, role, v],
    ) {
        Ok(_) => {}
        Err(e) => {
            let m = e.to_string();
            if m.contains("UNIQUE") {
                return Err(format!("[auth] username taken: {name}"));
            }
            return Err(m);
        }
    }
    let id = conn.last_insert_rowid();
    audit(
        conn,
        actor,
        "user.create",
        &format!("users:{name} role={role}"),
    );
    let row: (i64, String, String, String, i64, i64) = conn
        .query_row(
            "SELECT id, username, display_name, role, must_change_pin, active FROM users WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .map_err(|e| e.to_string())?;
    Ok(
        json!({ "id": row.0, "username": row.1, "display_name": row.2, "role": row.3, "must_change_pin": row.4, "active": row.5, "pin_expires_at": Value::Null }),
    )
}

fn valid_username(name: &str) -> bool {
    (3..=20).contains(&name.len())
        && name.bytes().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'.' || c == b'_' || c == b'-'
        })
}

/// T8b: native activate/deactivate (owner-gated). Owner accounts are immune —
/// operators deactivate instead of deleting, and owners never deactivate.
/// v1.5.1 §1: deactivation REQUIRES a freeze reason (+ note ≤140 chars);
/// reactivation clears both. Reason travels into the audit detail.
pub fn user_set_active(
    conn: &Connection,
    user_id: i64,
    active: bool,
    requester_role: &str,
    actor: &str,
    reason: &str,
    note: &str,
) -> Result<Value, String> {
    if requester_role != "owner" {
        return Err("[auth] owner role required".to_string());
    }
    let row: Option<(String, String)> = conn
        .query_row(
            "SELECT username, role FROM users WHERE id = ?1",
            [user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((uname, role)) = row else {
        return Err(format!("[auth] unknown user: {user_id}"));
    };
    if role == "owner" {
        return Err("[auth] the owner account cannot be deactivated".to_string());
    }
    if !active {
        let rc = reason.trim().to_uppercase();
        if !["RESIGNED", "LEAVE", "MISUSE", "OTHER"].contains(&rc.as_str()) {
            return Err("[auth] freeze reason required (RESIGNED|LEAVE|MISUSE|OTHER)".to_string());
        }
        let nt: String = note.trim().chars().take(140).collect();
        let note_val: Option<String> = if nt.is_empty() {
            None
        } else {
            Some(nt.clone())
        };
        conn.execute(
            "UPDATE users SET active = 0, freeze_reason = ?1, freeze_note = ?2 WHERE id = ?3",
            rusqlite::params![rc, note_val, user_id],
        )
        .map_err(|e| e.to_string())?;
        audit(
            conn,
            actor,
            "user.deactivate",
            &format!(
                "users:{uname}: deactivated [{rc}]{}",
                if nt.is_empty() {
                    String::new()
                } else {
                    format!(" {nt}")
                }
            ),
        );
    } else {
        conn.execute(
            "UPDATE users SET active = 1, freeze_reason = NULL, freeze_note = NULL WHERE id = ?1",
            [user_id],
        )
        .map_err(|e| e.to_string())?;
        audit(
            conn,
            actor,
            "user.deactivate",
            &format!("users:{uname}: reactivated"),
        );
    }
    Ok(json!({ "ok": true }))
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

    #[test]
    fn change_pin_verifies_old_clears_forced_flag() {
        // T12: the forced-change screen died in the exe for lack of this lane.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        migrate_v4(&conn).unwrap();
        // Wrong old PIN rejected, nothing rewritten.
        assert!(super::user_change_pin(&conn, 1, "0000", "5678").is_err());
        // Bad format rejected.
        assert!(super::user_change_pin(&conn, 1, "1234", "12").is_err());
        // Correct change: ok, forced flag cleared, new PIN verifies.
        let out = super::user_change_pin(&conn, 1, "1234", "5678").unwrap();
        assert_eq!(out["ok"], true);
        let v = super::user_verify(&conn, "owner", "5678").unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["user"]["must_change_pin"], 0);
    }

    #[test]
    fn create_and_toggle_mirror_ts_rules() {
        // T8b: the exe lane accepts exactly what the TS DAL accepts.
        let db = memdb();
        let refused_owner =
            super::user_create(&db, "sara", "Sara", "manager", "5678", "manager", "m", "");
        assert!(refused_owner.is_err());
        assert!(
            super::user_create(&db, "x", "X", "cashier", "1111", "owner", "owner", "").is_err()
        );
        assert!(
            super::user_create(&db, "bob", "Bob", "super", "1111", "owner", "owner", "").is_err()
        );
        assert!(
            super::user_create(&db, "bob", "Bob", "cashier", "12", "owner", "owner", "").is_err()
        );
        let u = super::user_create(&db, "Sara", "Sara", "manager", "5678", "owner", "owner", "")
            .unwrap();
        assert_eq!(u["username"], "sara");
        assert_eq!(u["must_change_pin"], 1);
        assert!(
            super::user_create(&db, "sara", "S", "cashier", "1111", "owner", "owner", "").is_err()
        );
        let id = u["id"].as_i64().unwrap();
        assert_eq!(super::user_verify(&db, "sara", "5678").unwrap()["ok"], true);
        // v1.5.1 §1: freeze reason mandatory — empty/unknown refused.
        assert!(super::user_set_active(&db, id, false, "owner", "owner", "", "").is_err());
        assert!(super::user_set_active(&db, id, false, "owner", "owner", "VACATION", "").is_err());
        assert!(super::user_set_active(
            &db,
            id,
            false,
            "owner",
            "owner",
            "LEAVE",
            "sick leave, back soon"
        )
        .is_ok());
        let row: (i64, Option<String>, Option<String>) = db
            .query_row(
                "SELECT active, freeze_reason, freeze_note FROM users WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            row,
            (
                0,
                Some("LEAVE".to_string()),
                Some("sick leave, back soon".to_string())
            )
        );
        let locked_out = super::user_verify(&db, "sara", "5678").unwrap();
        assert_eq!(locked_out["ok"], false);
        assert!(super::user_set_active(&db, id, true, "owner", "owner", "", "").is_ok());
        let cleared: (i64, Option<String>, Option<String>) = db
            .query_row(
                "SELECT active, freeze_reason, freeze_note FROM users WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(cleared, (1, None, None));
        assert_eq!(super::user_verify(&db, "sara", "5678").unwrap()["ok"], true);
        // Owner immune, requester gated, unknown refused (reason valid).
        assert!(super::user_set_active(&db, 1, false, "owner", "owner", "LEAVE", "").is_err());
        assert!(super::user_set_active(&db, id, false, "manager", "m", "LEAVE", "").is_err());
        assert!(super::user_set_active(&db, 9999, false, "owner", "owner", "LEAVE", "").is_err());
        // v1.5.1 §3: temporary PIN — owner-gated, owner immune, shape
        // checked, flag set, old PIN dead, audit carries no PIN digits.
        assert!(super::user_reset_pin(&db, id, "4242", "manager", "m", "").is_err());
        assert!(super::user_reset_pin(&db, 1, "4242", "owner", "owner", "").is_err());
        assert!(super::user_reset_pin(&db, id, "12", "owner", "owner", "").is_err());
        assert!(super::user_reset_pin(&db, 9999, "4242", "owner", "owner", "").is_err());
        assert!(super::user_reset_pin(&db, id, "4242", "owner", "owner", "").is_ok());
        assert_eq!(
            super::user_verify(&db, "sara", "5678").unwrap()["ok"],
            false
        );
        let tv = super::user_verify(&db, "sara", "4242").unwrap();
        assert_eq!(tv["ok"], true);
        assert_eq!(tv["user"]["must_change_pin"], 1);
        let flag: i64 = db
            .query_row(
                "SELECT must_change_pin FROM users WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(flag, 1);
        let reset_audit: String = db
            .query_row(
                "SELECT detail FROM audit_log WHERE action = 'pin.reset' ORDER BY id DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(!reset_audit.contains("4242"), "no PIN digits in audit");
        assert!(super::user_change_pin(&db, id, "4242", "9999").is_ok());
        let cleared_flag: i64 = db
            .query_row(
                "SELECT must_change_pin FROM users WHERE id = ?1",
                [id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cleared_flag, 0);
        // §3 completion: expiry — bad shape / past refused; future armed and
        // enforced at verify; self-change clears the deadline.
        assert!(super::user_reset_pin(&db, id, "5151", "owner", "owner", "not-a-date").is_err());
        assert!(
            super::user_reset_pin(&db, id, "5151", "owner", "owner", "2000-01-01T00:00:00")
                .is_err()
        );
        let future = "2099-12-31T23:59:59";
        assert!(super::user_reset_pin(&db, id, "5151", "owner", "owner", future).is_ok());
        let tv2 = super::user_verify(&db, "sara", "5151").unwrap();
        assert_eq!(tv2["ok"], true);
        db.execute(
            "UPDATE users SET pin_expires_at = '2000-01-01T00:00:00' WHERE id = ?1",
            [id],
        )
        .unwrap();
        let dead = super::user_verify(&db, "sara", "5151").unwrap();
        assert_eq!(dead["ok"], false);
        assert_eq!(dead["locked"], false);
        let exp_audit: String = db
            .query_row(
                "SELECT detail FROM audit_log WHERE action = 'login.fail' ORDER BY id DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(exp_audit, "temp-expired");
        // v1.5.1 §4: rotation — default 90, garbage config refused, window
        // audited, due forces change, countdown rides verify, NULL clock fresh.
        assert_eq!(super::get_rotation_days(&db), 90);
        assert!(super::set_rotation_days(&db, 0, "owner").is_err());
        assert!(super::set_rotation_days(&db, 400, "owner").is_err());
        assert!(super::set_rotation_days(&db, 30, "owner").is_ok());
        assert_eq!(super::get_rotation_days(&db), 30);
        let rot_audit: String = db
            .query_row(
                "SELECT detail FROM audit_log WHERE action = 'users.rotation_config' ORDER BY id DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rot_audit, "days=30");
        assert!(super::set_rotation_days(&db, 90, "owner").is_ok());
        // §3 left a past deadline armed — re-issue + self-change to clear it
        // (clock=now, flag=0), so the rotation math below reads clean.
        assert!(
            super::user_reset_pin(&db, id, "5151", "owner", "owner", "2099-12-31T23:59:59").is_ok()
        );
        assert!(super::user_change_pin(&db, id, "5151", "7777").is_ok());
        db.execute("UPDATE users SET pin_changed_at = NULL WHERE id = ?1", [id])
            .unwrap();
        // sara's live PIN is 7777 (re-issued + self-changed above).
        let null_clock2 = super::user_verify(&db, "sara", "7777").unwrap();
        assert_eq!(null_clock2["ok"], true);
        assert_eq!(null_clock2["user"]["rotation_due"], false);
        assert_eq!(null_clock2["user"]["rotation_days_left"], 90);
        db.execute(
            "UPDATE users SET pin_changed_at = '2000-01-01T00:00:00' WHERE id = ?1",
            [id],
        )
        .unwrap();
        let due = super::user_verify(&db, "sara", "7777").unwrap();
        assert_eq!(due["ok"], true);
        assert_eq!(due["user"]["rotation_due"], true);
        assert!(due["user"]["rotation_days_left"].as_i64().unwrap() <= 0);
        // v1.5.1 B2-5: second owner needs the requesting owner's own current
        // PIN — missing/wrong/non-owner refused (audited), correct doubly logged.
        assert!(super::user_create(
            &db, "boss2", "Boss Two", "owner", "9999", "owner", "owner", ""
        )
        .is_err());
        assert!(super::user_create(
            &db, "boss2", "Boss Two", "owner", "9999", "owner", "owner", "0000"
        )
        .is_err());
        assert!(super::user_create(
            &db, "boss2", "Boss Two", "owner", "9999", "owner", "sara", "1234"
        )
        .is_err());
        let boss = super::user_create(
            &db, "boss2", "Boss Two", "owner", "9999", "owner", "owner", "1234",
        )
        .unwrap();
        assert_eq!(boss["username"], "boss2");
        assert_eq!(boss["must_change_pin"], 1);
        assert_eq!(
            super::user_verify(&db, "boss2", "9999").unwrap()["ok"],
            true
        );
        let conf_ok: String = db
            .query_row(
                "SELECT detail FROM audit_log WHERE action = 'owner.confirm' AND detail LIKE 'second-owner:boss2%' ORDER BY id DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(conf_ok, "second-owner:boss2 ok");
        let conf_no: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM audit_log WHERE action = 'owner.confirm' AND detail = 'second-owner:boss2 rejected'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(conf_no >= 3, "every refusal is audited");
    }
}
