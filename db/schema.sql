-- ============================================================================
-- BARAKA MARKET v1.0 — SQLite schema (single source of truth)
-- Money  : ALL amounts are INTEGER centimes (DZD*100). No floats for money.
-- Qty    : ALL quantities are INTEGER milli-units (qty*1000). 1.45 kg -> 1450.
-- TVA    : 0 | 9 | 19 only (CHECK). Anything else is rejected at the DB gate.
-- Journal: WAL + foreign_keys=ON are enforced by openBarakaDb() on every open.
-- Tauri note: this exact file will feed @tauri-apps/plugin-sql in production.
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;

-- Key/value for schema version + shop settings Bollards
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Single-row shop fiscal identity (id always 1)
CREATE TABLE IF NOT EXISTS store_profile (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  store_name     TEXT NOT NULL,
  company_owner  TEXT NOT NULL DEFAULT '',
  rc_number      TEXT NOT NULL DEFAULT '',
  nif_number     TEXT NOT NULL DEFAULT '',
  nis_number     TEXT NOT NULL DEFAULT '',
  ai_number      TEXT NOT NULL DEFAULT '',
  address        TEXT NOT NULL DEFAULT '',
  phone          TEXT NOT NULL DEFAULT '',
  currency       TEXT NOT NULL DEFAULT 'DZD',
  receipt_footer TEXT NOT NULL DEFAULT '',
  timbre_rate    REAL    NOT NULL DEFAULT 0.01,
  timbre_min_ct  INTEGER NOT NULL DEFAULT 1000,
  timbre_max_ct  INTEGER NOT NULL DEFAULT 250000
);

CREATE TABLE IF NOT EXISTS products (
  id               INTEGER PRIMARY KEY,
  barcode          TEXT    NOT NULL UNIQUE,
  name_fr          TEXT    NOT NULL,
  name_ar          TEXT    NOT NULL DEFAULT '',
  category_id      TEXT    NOT NULL DEFAULT '',
  buy_price_ct     INTEGER NOT NULL CHECK (buy_price_ct >= 0),
  sell_price_ct    INTEGER NOT NULL CHECK (sell_price_ct >= 0),
  tva_rate         INTEGER NOT NULL CHECK (tva_rate IN (0, 9, 19)),
  stock_milli      INTEGER NOT NULL DEFAULT 0,
  min_stock_milli  INTEGER NOT NULL DEFAULT 0,
  unit             TEXT    NOT NULL CHECK (unit IN ('PIECE', 'KG', 'LITRE')),
  is_scale         INTEGER NOT NULL DEFAULT 0,
  scale_item_code  TEXT,
  has_expiry       INTEGER NOT NULL DEFAULT 0,
  expiry_date      TEXT
);

-- ADR-004-MKT: alternate barcodes + multipack/colisage labels.
-- multiplier = 1 -> alias barcode; > 1 -> pack/carton of N base units.
CREATE TABLE IF NOT EXISTS product_barcodes (
  id               INTEGER PRIMARY KEY,
  product_id       INTEGER NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  barcode          TEXT    NOT NULL UNIQUE,
  multiplier       INTEGER NOT NULL DEFAULT 1 CHECK (multiplier >= 1),
  pack_name        TEXT,
  price_override_ct INTEGER CHECK (price_override_ct IS NULL OR price_override_ct >= 0),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_barcode ON product_barcodes (barcode);
CREATE INDEX IF NOT EXISTS idx_product_barcodes_product ON product_barcodes (product_id);

-- ADR-006-MKT: auditable shrinkage ledger (La Casse / Démarque). One row per
-- write-off event; stock_milli is decremented atomically by recordInventoryLoss.
-- product_id uses RESTRICT: a product with loss history cannot be deleted.
CREATE TABLE IF NOT EXISTS inventory_losses (
  id            INTEGER PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
  qty_milli     INTEGER NOT NULL CHECK (qty_milli > 0),
  reason        TEXT    NOT NULL CHECK (reason IN ('EXPIRED', 'BROKEN', 'DAMAGED', 'THEFT', 'INTERNAL_USE', 'AUTRE')),
  unit_cost_ct  INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_ct >= 0),
  total_loss_ct INTEGER NOT NULL DEFAULT 0 CHECK (total_loss_ct >= 0),
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_inventory_losses_product ON inventory_losses (product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_losses_created ON inventory_losses (created_at);
CREATE INDEX IF NOT EXISTS idx_products_expiry ON products (expiry_date) WHERE has_expiry = 1;

CREATE TABLE IF NOT EXISTS clients (
  id                  INTEGER PRIMARY KEY,
  name                TEXT    NOT NULL,
  phone               TEXT    NOT NULL DEFAULT '',
  address             TEXT    NOT NULL DEFAULT '',
  nif                 TEXT,
  nis                 TEXT,
  rc                  TEXT,
  ai                  TEXT,
  credit_balance_ct   INTEGER NOT NULL DEFAULT 0,
  max_credit_limit_ct INTEGER NOT NULL DEFAULT 0,
  notes               TEXT
);

CREATE TABLE IF NOT EXISTS suppliers (
  id             INTEGER PRIMARY KEY,
  name           TEXT    NOT NULL,
  contact_person TEXT    NOT NULL DEFAULT '',
  phone          TEXT    NOT NULL DEFAULT '',
  address        TEXT    NOT NULL DEFAULT '',
  nif            TEXT,
  nis            TEXT,
  rc             TEXT,
  ai             TEXT,
  balance_due_ct INTEGER NOT NULL DEFAULT 0,
  payment_terms  TEXT,
  category       TEXT    NOT NULL DEFAULT ''
);

-- Atomic invoice/ticket/quittance counters. Bump via single UPDATE..RETURNING (one statement = atomic).
CREATE TABLE IF NOT EXISTS seq (
  kind TEXT NOT NULL CHECK (kind IN ('FACT', 'T', 'Q', 'Z', 'RET')),
  year   INTEGER NOT NULL,
  last_n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, year)
);

CREATE TABLE IF NOT EXISTS sales (
  id                TEXT    PRIMARY KEY,
  invoice_number    TEXT    NOT NULL UNIQUE,
  ticket_number     TEXT    NOT NULL UNIQUE,
  cashier_id        TEXT    NOT NULL DEFAULT '',
  cashier_name      TEXT    NOT NULL DEFAULT '',
  client_id         INTEGER REFERENCES clients (id),
  client_name       TEXT,
  client_nif        TEXT,
  client_nis        TEXT,
  client_rc         TEXT,
  client_ai         TEXT,
  client_address    TEXT,
  total_ht_ct       INTEGER NOT NULL,
  total_tva_ct      INTEGER NOT NULL,
  timbre_ct         INTEGER NOT NULL,
  total_ttc_ct      INTEGER NOT NULL,
  tva0_base_ct      INTEGER NOT NULL DEFAULT 0,
  tva0_amt_ct       INTEGER NOT NULL DEFAULT 0,
  tva0_ttc_ct       INTEGER NOT NULL DEFAULT 0,
  tva9_base_ct      INTEGER NOT NULL DEFAULT 0,
  tva9_amt_ct       INTEGER NOT NULL DEFAULT 0,
  tva9_ttc_ct       INTEGER NOT NULL DEFAULT 0,
  tva19_base_ct     INTEGER NOT NULL DEFAULT 0,
  tva19_amt_ct      INTEGER NOT NULL DEFAULT 0,
  tva19_ttc_ct      INTEGER NOT NULL DEFAULT 0,
  payment_method    TEXT    NOT NULL CHECK (payment_method IN ('ESPECES', 'CIB', 'DAHABIYA', 'CREDIT')),
  tva_enabled       INTEGER NOT NULL DEFAULT 1,   -- v7: fiscal regime toggles
  timbre_enabled    INTEGER NOT NULL DEFAULT 1,   -- (owner Card 3), stored per sale
  amount_paid_ct    INTEGER NOT NULL DEFAULT 0,
  amount_returned_ct INTEGER NOT NULL DEFAULT 0,
  status            TEXT    NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'CANCELLED')),
  is_facture        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL,
  -- T1 (ADR-021): idempotency key minted by the checkout at finalize time.
  -- Retried POSTs with the same key return the original row, never a new seq.
  client_sale_id    TEXT
);

CREATE TABLE IF NOT EXISTS sale_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id       TEXT    NOT NULL REFERENCES sales (id) ON DELETE RESTRICT,
  product_id    INTEGER REFERENCES products (id),
  barcode       TEXT    NOT NULL DEFAULT '',
  name_fr       TEXT    NOT NULL DEFAULT '',
  name_ar       TEXT    NOT NULL DEFAULT '',
  unit_price_ct INTEGER NOT NULL,
  qty_milli     INTEGER NOT NULL CHECK (qty_milli > 0),
  unit          TEXT    NOT NULL CHECK (unit IN ('PIECE', 'KG', 'LITRE')),
  tva_rate      INTEGER NOT NULL CHECK (tva_rate IN (0, 9, 19)),
  discount_bp   INTEGER NOT NULL DEFAULT 0,
  line_ht_ct    INTEGER NOT NULL,
  line_tva_ct   INTEGER NOT NULL,
  line_ttc_ct   INTEGER NOT NULL
);

-- v1.5.0 (RETURNS): customer returns are inverse fiscal rows, never edits.
-- A return mirrors the sale lines it reverses; approval posts it to the
-- open day (even when the sale day is long closed). Draft -> APPROVED /
-- REJECTED is terminal; rows are never deleted (triggers, ADR-034 family).
CREATE TABLE IF NOT EXISTS returns (
  id                TEXT    PRIMARY KEY,
  return_number     TEXT    UNIQUE, -- RET-YYYY-XXXXXX, minted at APPROVAL (posted docs only; drafts carry the id)
  sale_id           TEXT    NOT NULL REFERENCES sales (id) ON DELETE RESTRICT,
  invoice_number    TEXT    NOT NULL,        -- source FACT (human trace)
  client_id         INTEGER REFERENCES clients (id),
  client_name       TEXT,
  payment_method    TEXT    NOT NULL CHECK (payment_method IN ('ESPECES', 'CIB', 'DAHABIYA', 'CREDIT')),
  reason            TEXT    NOT NULL CHECK (reason IN ('DEFECT', 'WRONG_ITEM', 'SIZE_FIT', 'EXPIRED', 'CHANGED_MIND', 'OTHER')),
  reason_note       TEXT,
  refund_ct         INTEGER NOT NULL CHECK (refund_ct > 0), -- full TTC of lines, timbre excluded (non-refundable, accountant to confirm)
  status            TEXT    NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED', 'REJECTED')),
  actor             TEXT    NOT NULL DEFAULT '',   -- draft creator
  approver          TEXT    NOT NULL DEFAULT '',   -- set at decision time
  sale_day          TEXT    NOT NULL,              -- fiscal day of the source sale
  posting_day       TEXT,                          -- fiscal day of approval (open day)
  decided_at        TEXT,
  created_at        TEXT    NOT NULL,
  -- T1/T2b family: idempotency key minted by the checkout at draft time.
  client_return_key TEXT
);

CREATE TABLE IF NOT EXISTS return_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id     TEXT    NOT NULL REFERENCES returns (id) ON DELETE RESTRICT,
  sale_item_id  INTEGER NOT NULL REFERENCES sale_items (id) ON DELETE RESTRICT,
  product_id    INTEGER REFERENCES products (id),
  barcode       TEXT    NOT NULL DEFAULT '',
  name_fr       TEXT    NOT NULL DEFAULT '',
  name_ar       TEXT    NOT NULL DEFAULT '',
  unit_price_ct INTEGER NOT NULL,
  qty_milli     INTEGER NOT NULL CHECK (qty_milli > 0),
  unit          TEXT    NOT NULL CHECK (unit IN ('PIECE', 'KG', 'LITRE')),
  tva_rate      INTEGER NOT NULL CHECK (tva_rate IN (0, 9, 19)),
  line_ht_ct    INTEGER NOT NULL,
  line_tva_ct   INTEGER NOT NULL,
  line_ttc_ct   INTEGER NOT NULL,
  -- A1 (supermarket): per-line disposition decided at approval.
  disposition   TEXT    NOT NULL DEFAULT 'RESTOCK'
                CHECK (disposition IN ('RESTOCK', 'QUARANTINE', 'DESTROY'))
);

CREATE TABLE IF NOT EXISTS client_settlements (
  id             TEXT    PRIMARY KEY,
  client_id      INTEGER NOT NULL REFERENCES clients (id),
  client_name    TEXT    NOT NULL DEFAULT '',
  amount_ct      INTEGER NOT NULL CHECK (amount_ct > 0),
  payment_method TEXT    NOT NULL CHECK (payment_method IN ('ESPECES', 'CIB', 'DAHABIYA', 'CREDIT')),
  timbre_ct      INTEGER NOT NULL DEFAULT 0,
  total_collected_ct INTEGER NOT NULL DEFAULT 0,
  receipt_number TEXT    UNIQUE,
  date           TEXT    NOT NULL,
  note           TEXT,
  -- T2b (ADR-024): idempotency key minted by the checkout at finalize.
  client_settlement_key TEXT
);

-- ACID ephemeral cart draft (EXEC-DIR-2023-001 TASK 4).
-- Keyed by session_id (default 'MAIN_POS'); survives power-cut cache flush.
CREATE TABLE IF NOT EXISTS active_cart_draft (
  session_id   TEXT    PRIMARY KEY DEFAULT 'MAIN_POS',
  payload_json TEXT    NOT NULL DEFAULT '[]',
  item_count   INTEGER NOT NULL DEFAULT 0,
  total_ttc_ct INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id             TEXT    PRIMARY KEY,
  invoice_number TEXT    NOT NULL,
  supplier_id    INTEGER NOT NULL REFERENCES suppliers (id),
  supplier_name  TEXT    NOT NULL DEFAULT '',
  total_ht_ct    INTEGER NOT NULL,
  total_tva_ct   INTEGER NOT NULL,
  total_ttc_ct   INTEGER NOT NULL,
  payment_method TEXT    NOT NULL CHECK (payment_method IN ('ESPECES', 'VIREMENT', 'CHEQUE', 'CREDIT')),
  amount_paid_ct INTEGER NOT NULL DEFAULT 0,
  amount_due_ct  INTEGER NOT NULL DEFAULT 0,
  date           TEXT    NOT NULL,
  note           TEXT
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id           TEXT    NOT NULL REFERENCES purchases (id) ON DELETE RESTRICT,
  product_id            INTEGER REFERENCES products (id),
  barcode               TEXT    NOT NULL DEFAULT '',
  name_fr               TEXT    NOT NULL DEFAULT '',
  name_ar               TEXT    NOT NULL DEFAULT '',
  qty_milli             INTEGER NOT NULL CHECK (qty_milli > 0),
  unit                  TEXT    NOT NULL CHECK (unit IN ('PIECE', 'KG', 'LITRE')),
  unit_buy_price_ht_ct  INTEGER NOT NULL,
  tva_rate              INTEGER NOT NULL CHECK (tva_rate IN (0, 9, 19)),
  unit_sell_price_ttc_ct INTEGER NOT NULL,
  line_ht_ct            INTEGER NOT NULL,
  line_ttc_ct           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id             TEXT    PRIMARY KEY,
  supplier_id    INTEGER NOT NULL REFERENCES suppliers (id),
  supplier_name  TEXT    NOT NULL DEFAULT '',
  amount_ct      INTEGER NOT NULL CHECK (amount_ct > 0),
  payment_method TEXT    NOT NULL CHECK (payment_method IN ('ESPECES', 'VIREMENT', 'CHEQUE')),
  reference      TEXT,
  date           TEXT    NOT NULL,
  note           TEXT
);

CREATE TABLE IF NOT EXISTS z_reports (
  report_number      TEXT    PRIMARY KEY, -- Z-YYYY-XXXXXX (monotonic, hash-chained)
  day                TEXT    NOT NULL,    -- business date YYYY-MM-DD
  opening_time       TEXT    NOT NULL,
  closing_time       TEXT    NOT NULL,
  total_sales_count  INTEGER NOT NULL DEFAULT 0,
  total_ht_ct        INTEGER NOT NULL DEFAULT 0,
  tva0_base_ct       INTEGER NOT NULL DEFAULT 0,
  tva9_base_ct       INTEGER NOT NULL DEFAULT 0,
  tva9_amt_ct        INTEGER NOT NULL DEFAULT 0,
  tva19_base_ct      INTEGER NOT NULL DEFAULT 0,
  tva19_amt_ct       INTEGER NOT NULL DEFAULT 0,
  total_tva_ct       INTEGER NOT NULL DEFAULT 0,
  total_timbre_ct    INTEGER NOT NULL DEFAULT 0,
  total_ttc_ct       INTEGER NOT NULL DEFAULT 0,
  especes_gross_ct   INTEGER NOT NULL DEFAULT 0,
  cib_total_ct       INTEGER NOT NULL DEFAULT 0,
  dahabiya_total_ct  INTEGER NOT NULL DEFAULT 0,
  credit_granted_ct  INTEGER NOT NULL DEFAULT 0,
  credit_collected_ct INTEGER NOT NULL DEFAULT 0,
  -- v1.5.0 (RETURNS memo): money columns above are NET of approved returns;
  -- these two memoize the return flow for the ticket and the audit.
  returns_count      INTEGER NOT NULL DEFAULT 0,
  returns_total_ttc_ct INTEGER NOT NULL DEFAULT 0,
  -- A3 (supermarket): daily scrappage (casse) memo — cost-at-buy of goods
  -- written off today, shown on the Z as its own line. NET semantics like returns.
  losses_count       INTEGER NOT NULL DEFAULT 0,
  losses_total_ct    INTEGER NOT NULL DEFAULT 0,
  first_invoice_number TEXT  NOT NULL DEFAULT '',
  last_invoice_number  TEXT  NOT NULL DEFAULT '',
  prev_hash          TEXT    NOT NULL DEFAULT '',
  hash               TEXT    NOT NULL,
  finalized          INTEGER NOT NULL DEFAULT 1,
  -- #004: DAY = legal day lock (one per day); SHIFT = cash-session snapshot.
  close_kind         TEXT    NOT NULL DEFAULT 'DAY'
);

-- Legal void journal. Rows are NEVER deleted from sales; voids append here.
-- ADR-014-MKT columns carry manager-override audit events alongside sale voids.
CREATE TABLE IF NOT EXISTS void_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id        TEXT,
  invoice_number TEXT,
  reason         TEXT    NOT NULL,
  voided_by      TEXT    NOT NULL DEFAULT '',
  voided_at      TEXT    NOT NULL,
  action_type    TEXT,
  product_id     INTEGER,
  product_name   TEXT,
  amount_ct      INTEGER NOT NULL DEFAULT 0,
  cashier_name   TEXT,
  manager_name   TEXT,
  session_id     TEXT,
  created_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode);
CREATE INDEX IF NOT EXISTS idx_products_scale ON products (scale_item_code);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales (created_at);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales (status);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_z_day ON z_reports (day);

-- ADR-013-MKT: cashier shift lifecycle + mid-day drawer movements.
CREATE TABLE IF NOT EXISTS cash_sessions (
  id                 TEXT PRIMARY KEY,
  cashier_name       TEXT NOT NULL,
  opened_at          TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at          TEXT,
  opening_float_ct   INTEGER NOT NULL DEFAULT 0,
  closing_counted_ct INTEGER,
  theoretical_cash_ct INTEGER,
  cash_diff_ct       INTEGER, -- counted - theoretical (surplus > 0, deficit < 0)
  status             TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED')) DEFAULT 'OPEN',
  z_report_id        TEXT REFERENCES z_reports (report_number),
  notes              TEXT
);
CREATE INDEX IF NOT EXISTS idx_cash_sessions_status ON cash_sessions (status);

CREATE TABLE IF NOT EXISTS cash_movements (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES cash_sessions (id) ON DELETE CASCADE,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('DEPOSIT', 'WITHDRAWAL', 'EXPENSE')),
  amount_ct     INTEGER NOT NULL CHECK (amount_ct > 0),
  reason        TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cash_movements_session ON cash_movements (session_id);

-- ADR-015-MKT: append-only online backup journal (VACUUM INTO snapshots).
CREATE TABLE IF NOT EXISTS backups_log (
  id               TEXT PRIMARY KEY,
  filename         TEXT NOT NULL,
  file_path        TEXT NOT NULL,
  file_size_bytes  INTEGER NOT NULL,
  sha256_checksum  TEXT NOT NULL,
  sales_count      INTEGER NOT NULL DEFAULT 0,
  products_count   INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL CHECK (status IN ('VERIFIED', 'CORRUPT', 'RESTORED')) DEFAULT 'VERIFIED',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  -- P3 (v1.4.4): pre-reset safety archives are retention-exempt (never pruned).
  exempt           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_backups_created ON backups_log (created_at);

-- TASK-BRK-016-MKT: Algerian reference catalog (read-only lookup tables).
CREATE TABLE IF NOT EXISTS ref_categories (
  code         TEXT PRIMARY KEY,
  name_fr      TEXT NOT NULL,
  name_ar      TEXT NOT NULL,
  default_tva  INTEGER NOT NULL DEFAULT 19
);

CREATE TABLE IF NOT EXISTS ref_templates (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id          TEXT NOT NULL,
  brand_name        TEXT NOT NULL,
  brand_name_ar     TEXT NOT NULL,
  manufacturer      TEXT NOT NULL DEFAULT '',
  category_code     TEXT NOT NULL REFERENCES ref_categories(code),
  suggested_name_fr TEXT NOT NULL,
  suggested_name_ar TEXT NOT NULL,
  search_aliases    TEXT NOT NULL DEFAULT '',
  is_weighable      INTEGER NOT NULL DEFAULT 0,
  default_unit      TEXT NOT NULL DEFAULT 'PIECE'
);

CREATE INDEX IF NOT EXISTS idx_ref_templates_lookup
  ON ref_templates(brand_name, category_code);

-- Schema version is managed by migrateSchemaVersion() in src/db/sqlite.ts
-- (it stamps fresh DBs and climbs old files). NEVER stamp user_version here:
-- a stamp would clobber old files before the migrator reads their version.

-- T8 (ADR-031): users + security audit (v4). PINs are salted SHA-256
-- (node:crypto TS lane, pinned implementation Rust lane — T8b upgrades
-- to scrypt/argon2 when vendored crates are available).
CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  username          TEXT    NOT NULL UNIQUE,
  display_name      TEXT    NOT NULL DEFAULT '',
  role              TEXT    NOT NULL CHECK (role IN ('cashier', 'manager', 'owner')),
  -- `saltHex:hashHex` per src/core/security.ts (SHA-256(salt:pin)).
  pin_verifier      TEXT    NOT NULL,
  active            INTEGER NOT NULL DEFAULT 1,
  must_change_pin   INTEGER NOT NULL DEFAULT 0,
  -- v1.5.1 (USERS-PLUS §1): mandatory freeze reason + note. Set on
  -- deactivate, cleared on reactivate; never edited in place.
  freeze_reason     TEXT    CHECK (freeze_reason IN ('RESIGNED', 'LEAVE', 'MISUSE', 'OTHER')),
  freeze_note       TEXT,
  -- v1.5.1 (USERS-PLUS §3): temp-PIN expiry (`YYYY-MM-DDTHH:MM:SS`, UTC).
  -- Set by owner reset only; NULL = no expiry (provisioned accounts).
  pin_expires_at    TEXT,
  -- v1.5.1 (USERS-PLUS §4): last PIN change, rotation clock. Backfilled
  -- with `now` at climb; refreshed by every create/change/reset.
  pin_changed_at    TEXT,
  failed_attempts   INTEGER NOT NULL DEFAULT 0,
  locked_until_ms   INTEGER NOT NULL DEFAULT 0,
  lock_cycles       INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL DEFAULT '',
  last_login_at     TEXT    NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         TEXT    NOT NULL,
  actor      TEXT    NOT NULL DEFAULT '',
  action     TEXT    NOT NULL,
  entity     TEXT    NOT NULL DEFAULT '',
  entity_id  TEXT    NOT NULL DEFAULT '',
  detail     TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log (ts);

-- T11 (ADR-034): append-only + terminal-state guards. All IF NOT EXISTS so
-- legacy files climb via the v5 migration step; fresh files get them at open.
-- Application code already honors these — triggers are the last line that even
-- raw SQL cannot cross.
CREATE TRIGGER IF NOT EXISTS trg_sales_no_delete
BEFORE DELETE ON sales BEGIN
  SELECT RAISE(ABORT, 'append-only: sales rows are never deleted (void instead)');
END;
CREATE TRIGGER IF NOT EXISTS trg_sale_items_no_delete
BEFORE DELETE ON sale_items BEGIN
  SELECT RAISE(ABORT, 'append-only: sale_items rows are never deleted');
END;
CREATE TRIGGER IF NOT EXISTS trg_settlements_no_delete
BEFORE DELETE ON client_settlements BEGIN
  SELECT RAISE(ABORT, 'append-only: settlements are never deleted');
END;
CREATE TRIGGER IF NOT EXISTS trg_sales_terminal
BEFORE UPDATE OF status ON sales
WHEN OLD.status = 'CANCELLED' AND NEW.status <> 'CANCELLED' BEGIN
  SELECT RAISE(ABORT, 'terminal: a CANCELLED sale can never be resurrected');
END;
CREATE TRIGGER IF NOT EXISTS trg_users_no_delete
BEFORE DELETE ON users BEGIN
  SELECT RAISE(ABORT, 'append-only: users deactivate, never delete');
END;
CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
BEFORE DELETE ON audit_log BEGIN
  SELECT RAISE(ABORT, 'append-only: audit_log is immutable');
END;
CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
BEFORE UPDATE ON audit_log BEGIN
  SELECT RAISE(ABORT, 'append-only: audit_log rows are never modified');
END;
