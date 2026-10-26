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
  kind TEXT NOT NULL CHECK (kind IN ('FACT', 'T', 'Q', 'Z')),
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
  amount_paid_ct    INTEGER NOT NULL DEFAULT 0,
  amount_returned_ct INTEGER NOT NULL DEFAULT 0,
  status            TEXT    NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'CANCELLED')),
  is_facture        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL
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
  note           TEXT
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
  first_invoice_number TEXT  NOT NULL DEFAULT '',
  last_invoice_number  TEXT  NOT NULL DEFAULT '',
  prev_hash          TEXT    NOT NULL DEFAULT '',
  hash               TEXT    NOT NULL,
  finalized          INTEGER NOT NULL DEFAULT 1
);

-- Legal void journal. Rows are NEVER deleted from sales; voids append here.
CREATE TABLE IF NOT EXISTS void_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id        TEXT    NOT NULL,
  invoice_number TEXT    NOT NULL,
  reason         TEXT    NOT NULL,
  voided_by      TEXT    NOT NULL DEFAULT '',
  voided_at      TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode);
CREATE INDEX IF NOT EXISTS idx_products_scale ON products (scale_item_code);
CREATE INDEX IF NOT EXISTS idx_sales_created ON sales (created_at);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales (status);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_z_day ON z_reports (day);
