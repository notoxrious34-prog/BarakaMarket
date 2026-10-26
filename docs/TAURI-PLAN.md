# TAURI migration plan (single-exe <60MB) — deferred with exact steps

Why: web lanes are done and verified; the installer needs a Windows PC with
free disk for the Rust target dir (C: here is 100% full → set `CARGO_HOME` /
`CARGO_TARGET_DIR` on D: first).

## Steps (shop/build PC)
1. `set CARGO_HOME=D:\cargo` + `set CARGO_TARGET_DIR=D:\cargo-target` (persist in env).
2. `cargo install tauri-cli --version ^2` (or `npm i -D @tauri-apps/cli`).
3. `npx tauri init --ci` (frontend: `dist/`, devUrl `http://localhost:3000`).
4. `cargo add tauri-plugin-sql --features sqlite` (or `npx @tauri-apps/cli plugin add sql`).
5. Feed **`db/schema.sql` unchanged** to the plugin at first run (same file = same law).
6. Port `src/db/sqlite.ts` logic 1:1 to Tauri `invoke` commands:
   - `next_invoice` → same `UPDATE seq..RETURNING` statement
   - `record_sale` → same validation (call the TS centimes engine, then SQL)
   - `void_sale`, `backup_db` (`VACUUM INTO` works in the plugin)
7. Point AppContext at `invoke` when `window.__TAURI__` exists, else API/localStorage.
8. `npx tauri build --bundles nsis` → assert exe+installer <60MB, RAM <120MB @8h.

## Non-goals for this step
No SQL changes (schema is frozen by tests); no fiscal changes (engine untouched).
