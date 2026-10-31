/**
 * Baraka Market — local authoritative API (Node + Express + SQLite WAL).
 * Run:  BARAKA_DB=data/baraka.db PORT=3100 npx tsx server/index.ts
 * Lane: shop back-office / ops / Tauri bridge validation. The browser UI
 * keeps working offline on localStorage; this lane is authoritative for
 * invoice sequencing, voids journal and Z summaries.
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { openBarakaDb, type BarakaDb, type ProductRow } from '../src/db/sqlite.js';
import type {
  LossReason, ImportProductRow, ShelfLabelItem, SupplierDeliveryReceipt, ClientSettlementPayload,
} from '../src/types/index.js';
import { buildThermalSettlementQuittance, buildThermalZReport } from '../src/hardware/escpos.js';
import { isValidPinFormat } from '../src/core/security.js';
import { preflightCsv } from '../src/core/csv-importer.js';
import { generateA4LabelsHtml, generateThermal80mmLabelsEscPos } from '../src/core/shelf-labels.js';
import { REF_TO_PRODUCT_CATEGORY } from '../src/core/reference-search.js';

export function createApp(dbPath: string): { app: express.Express; baraka: BarakaDb } {
  let baraka = openBarakaDb(dbPath);
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, db: path.resolve(dbPath), ...baraka.pragmas() });
  });

  app.get('/api/products', (_req, res) => {
    const rows = baraka.db.prepare('SELECT * FROM products ORDER BY id').all();
    res.json(rows);
  });

  app.get('/api/products/:barcode', (req, res) => {
    const row = baraka.db.prepare('SELECT * FROM products WHERE barcode = ?').get(req.params.barcode);
    if (!row) { res.status(404).json({ error: 'product not found' }); return; }
    res.json(row);
  });

  app.post('/api/sales', (req, res) => {
    try {
      const { header, items } = req.body as { header: never; items: never };
      if (!header || !Array.isArray(items)) { res.status(400).json({ error: 'body must be {header, items[]}' }); return; }
      const out = baraka.recordSale(header, items);
      res.status(201).json(out);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get('/api/sales/active-count', (_req, res) => {
    res.json({ active: baraka.activeSalesCount() });
  });

  app.get('/api/sales/:id', (req, res) => {
    const row = baraka.getSaleOrNull(req.params.id);
    if (!row) { res.status(404).json({ error: 'sale not found' }); return; }
    res.json(row);
  });

  app.post('/api/sales/:id/void', (req, res) => {
    try {
      const { reason, by } = req.body as { reason: string; by?: string };
      baraka.voidSale(req.params.id, reason, by ?? '');
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // ADR-006-MKT: auditable shrinkage ledger (La Casse / Démarque).
  app.post('/api/losses', (req, res) => {
    try {
      const { product_id, qty_milli, reason, unit_cost_ct, total_loss_ct, notes, created_at } = req.body as {
        product_id: number; qty_milli: number; reason: string;
        unit_cost_ct?: number; total_loss_ct?: number; notes?: string | null; created_at?: string;
      };
      if (product_id === undefined || qty_milli === undefined || !reason) {
        res.status(400).json({ error: 'body must be {product_id, qty_milli, reason, ...}' }); return;
      }
      const out = baraka.recordInventoryLoss({
        product_id, qty_milli, reason: reason as LossReason,
        unit_cost_ct, total_loss_ct, notes, created_at,
      });
      res.status(201).json(out);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get('/api/losses', (req, res) => {
    try {
      const q = req.query as { reason?: string; product_id?: string; from?: string; to?: string; limit?: string };
      res.json(baraka.getInventoryLosses({
        reason: q.reason as LossReason | undefined,
        product_id: q.product_id !== undefined ? Number(q.product_id) : undefined,
        from: q.from, to: q.to,
        limit: q.limit !== undefined ? Number(q.limit) : undefined,
      }));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get('/api/perishables/expiring', (req, res) => {
    try {
      const days = req.query.days !== undefined ? Number(req.query.days) : 7;
      res.json(baraka.getExpiringProducts(days));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // ADR-009-MKT: bulk catalog import — dry-run preflight + atomic commit.
  app.post('/api/products/import-preview', (req, res) => {
    try {
      const { csvText } = req.body as { csvText: string };
      if (typeof csvText !== 'string' || !csvText.trim()) {
        res.status(400).json({ error: 'body must be {csvText: string}' }); return;
      }
      const report = preflightCsv(csvText);
      res.json({
        success: true,
        summary: { total: report.summary.total, valid: report.summary.valid, errorsCount: report.summary.errorsCount },
        preview: report.validRows.slice(0, 10),
        errors: report.errors,
      });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/products/import-execute', (req, res) => {
    try {
      const { rows, mode } = req.body as { rows: ImportProductRow[]; mode?: 'INSERT_ONLY' | 'UPSERT' };
      if (!Array.isArray(rows)) { res.status(400).json({ error: 'body must be {rows: [], mode?}' }); return; }
      const out = baraka.importProductsBatch(rows, mode ?? 'UPSERT');
      res.json({ success: true, ...out });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // ADR-010-MKT: shelf-edge labels (A4 sheets + 80mm thermal strips).
  const labelItemsFor = (ids: number[]): ShelfLabelItem[] => {
    const get = baraka.db.prepare('SELECT * FROM products WHERE id = ?');
    return ids.map(id => {
      const p = get.get(id) as ProductRow | undefined;
      if (!p) throw new Error(`[labels] product not found: ${id}`);
      if (p.tva_rate !== 0 && p.tva_rate !== 9 && p.tva_rate !== 19) {
        throw new Error(`[labels] illegal TVA rate on product ${id}: ${p.tva_rate}`);
      }
      return {
        id: p.id, barcode: p.barcode, nameFr: p.name_fr, nameAr: p.name_ar || undefined,
        sellPriceCt: p.sell_price_ct, unit: p.unit, isScale: p.is_scale === 1,
        scaleCode: p.scale_item_code ?? undefined, tvaRate: p.tva_rate,
        category: p.category_id || undefined,
      } satisfies ShelfLabelItem;
    });
  };

  app.post('/api/labels/preview-html', (req, res) => {
    try {
      const { productIds, storeName } = req.body as { productIds: number[]; storeName?: string };
      if (!Array.isArray(productIds) || productIds.length === 0) {
        res.status(400).json({ error: 'body must be {productIds: number[], storeName?}' }); return;
      }
      res.json({ html: generateA4LabelsHtml(labelItemsFor(productIds), { storeName }) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/labels/print-thermal', (req, res) => {
    try {
      const { productIds, storeName } = req.body as { productIds: number[]; storeName?: string };
      if (!Array.isArray(productIds) || productIds.length === 0) {
        res.status(400).json({ error: 'body must be {productIds: number[], storeName?}' }); return;
      }
      const buf = generateThermal80mmLabelsEscPos(labelItemsFor(productIds), storeName);
      // Same spool as /api/raw-print (shop thermal printer lane).
      fs.mkdirSync(path.resolve('data'), { recursive: true });
      fs.appendFileSync(path.resolve('data', 'raw-print-spool.bin'), Buffer.from(buf));
      res.json({ success: true, count: productIds.length, bytes: buf.length });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // ADR-011-MKT: supplier BL receiving — atomic stock influx + debt.
  app.post('/api/purchases/receive', (req, res) => {
    try {
      const payload = req.body as SupplierDeliveryReceipt;
      if (!payload || typeof payload.supplierId !== 'number' || !Array.isArray(payload.items)) {
        res.status(400).json({ error: 'body must be {supplierId, items[], paidAmountCt, ...}' }); return;
      }
      res.status(201).json({ success: true, ...baraka.receiveSupplierDelivery(payload) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get('/api/suppliers/:id/purchases', (req, res) => {
    try {
      const id = Number(req.params.id);
      const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
      res.json(baraka.getSupplierPurchases(id, limit));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get('/api/suppliers/:id/statement', (req, res) => {
    try {
      res.json(baraka.getSupplierBalanceStatement(Number(req.params.id)));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // ADR-012-MKT: Carnet de Dette — atomic settlement + thermal quittance.
  app.post('/api/clients/:id/settle', (req, res) => {
    try {
      const { amountCt, paymentMethod, notes, cashierName } = req.body as {
        amountCt: number; paymentMethod?: ClientSettlementPayload['paymentMethod'];
        notes?: string; cashierName?: string;
      };
      if (typeof amountCt !== 'number') {
        res.status(400).json({ error: 'body must be {amountCt, paymentMethod?, notes?, cashierName?}' }); return;
      }
      res.status(201).json({
        success: true,
        ...baraka.settleClientCredit({ clientId: Number(req.params.id), amountCt, paymentMethod, notes, cashierName }),
      });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/clients/:id/settle-and-print', (req, res) => {
    try {
      const { amountCt, paymentMethod, notes, cashierName, storeName } = req.body as {
        amountCt: number; paymentMethod?: ClientSettlementPayload['paymentMethod'];
        notes?: string; cashierName?: string; storeName?: string;
      };
      if (typeof amountCt !== 'number') {
        res.status(400).json({ error: 'body must be {amountCt, ...}' }); return;
      }
      const settlement = baraka.settleClientCredit({
        clientId: Number(req.params.id), amountCt, paymentMethod, notes, cashierName,
      });
      const buf = buildThermalSettlementQuittance(
        { ...settlement, date: settlement.createdAt }, storeName ?? 'BARAKA MARKET');
      fs.mkdirSync(path.resolve('data'), { recursive: true });
      fs.appendFileSync(path.resolve('data', 'raw-print-spool.bin'), Buffer.from(buf));
      res.status(201).json({ success: true, settlement, bytes: buf.length });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get('/api/clients/:id/statement', (req, res) => {
    try {
      res.json(baraka.getClientStatement(Number(req.params.id)));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // ADR-013-MKT: cash session lifecycle + Z closure.
  app.post('/api/cash/open', (req, res) => {
    try {
      const { cashierName, openingFloatCt } = req.body as { cashierName: string; openingFloatCt: number };
      if (typeof cashierName !== 'string' || typeof openingFloatCt !== 'number') {
        res.status(400).json({ error: 'body must be {cashierName, openingFloatCt}' }); return;
      }
      res.status(201).json({ success: true, ...baraka.openCashSession(cashierName, openingFloatCt) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/cash/movement', (req, res) => {
    try {
      const { sessionId, movementType, amountCt, reason } = req.body as {
        sessionId: string; movementType: 'DEPOSIT' | 'WITHDRAWAL' | 'EXPENSE';
        amountCt: number; reason: string;
      };
      if (typeof sessionId !== 'string' || typeof amountCt !== 'number' || typeof reason !== 'string') {
        res.status(400).json({ error: 'body must be {sessionId, movementType, amountCt, reason}' }); return;
      }
      res.status(201).json({ success: true, ...baraka.recordCashMovement(sessionId, movementType, amountCt, reason) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get('/api/cash/active', (_req, res) => {
    res.json(baraka.getActiveCashSession());
  });

  app.post('/api/cash/close-and-z', (req, res) => {
    try {
      const { sessionId, countedCashCt, notes, storeName, printReceipt } = req.body as {
        sessionId: string; countedCashCt: number; notes?: string;
        storeName?: string; printReceipt?: boolean;
      };
      if (typeof sessionId !== 'string' || typeof countedCashCt !== 'number') {
        res.status(400).json({ error: 'body must be {sessionId, countedCashCt, notes?, printReceipt?}' }); return;
      }
      const z = baraka.closeCashSessionAndGenerateZ(sessionId, countedCashCt, notes);
      let bytes = 0;
      if (printReceipt !== false) {
        const buf = buildThermalZReport(z, storeName ?? 'BARAKA MARKET');
        fs.mkdirSync(path.resolve('data'), { recursive: true });
        fs.appendFileSync(path.resolve('data', 'raw-print-spool.bin'), Buffer.from(buf));
        bytes = buf.length;
      }
      res.status(201).json({ success: true, bytes, ...z });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // ADR-014-MKT: manager override PIN gate + void audit trail.
  app.post('/api/security/verify-pin', (req, res) => {
    try {
      const { pin } = req.body as { pin: string };
      if (typeof pin !== 'string') { res.status(400).json({ error: 'body must be {pin}' }); return; }
      res.json({ success: baraka.verifyManagerPinDb(pin) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/security/set-pin', (req, res) => {
    try {
      const { currentPin, newPin } = req.body as { currentPin: string; newPin: string };
      if (typeof currentPin !== 'string' || typeof newPin !== 'string') {
        res.status(400).json({ error: 'body must be {currentPin, newPin}' }); return;
      }
      if (!baraka.verifyManagerPinDb(currentPin)) {
        res.status(403).json({ error: 'current PIN rejected' }); return;
      }
      if (!isValidPinFormat(newPin)) {
        res.status(400).json({ error: 'new PIN must be 4-8 numeric digits' }); return;
      }
      baraka.setManagerPin(newPin);
      res.json({ success: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/security/void-log', (req, res) => {
    try {
      const entry = req.body as {
        actionType: 'LINE_VOID' | 'CART_CLEAR' | 'MANUAL_DISCOUNT' | 'DRAWER_KICK';
        productId?: number; productName?: string; amountCt: number;
        cashierName: string; managerApprovedBy?: string; reason: string; sessionId?: string;
      };
      if (!entry || typeof entry.actionType !== 'string' || typeof entry.amountCt !== 'number') {
        res.status(400).json({ error: 'body must be VoidLogEntry' }); return;
      }
      res.status(201).json({ success: true, ...baraka.recordVoidLog(entry) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get('/api/security/void-log', (req, res) => {
    try {
      const q = req.query as { fromDate?: string; toDate?: string; reason?: string; limit?: string };
      res.json(baraka.getVoidLogs({
        fromDate: q.fromDate, toDate: q.toDate, reason: q.reason,
        limit: q.limit !== undefined ? Number(q.limit) : undefined,
      }));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get('/api/security/void-summary', (req, res) => {
    try {
      const q = req.query as { sessionId?: string };
      res.json(baraka.getVoidSummaryBySession(q.sessionId));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // TASK-BRK-016-MKT: Algerian reference catalog autofill.
  app.get('/api/reference/templates', (req, res) => {
    try {
      const q = req.query as { q?: string; limit?: string };
      const hits = baraka.searchProductTemplates(q.q ?? '', q.limit !== undefined ? Number(q.limit) : 8);
      res.json(hits.map(t => ({
        id: t.id, brandName: t.brandName, nameFr: t.suggestedNameFr, nameAr: t.suggestedNameAr,
        categoryCode: t.categoryCode, productCategory: REF_TO_PRODUCT_CATEGORY[t.categoryCode] ?? 'epicerie',
        defaultTva: t.defaultTva, isWeighable: t.isWeighable, defaultUnit: t.defaultUnit,
      })));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // ADR-015-MKT: online backup + disaster recovery.
  app.post('/api/backups/create', (req, res) => {
    try {
      const { label } = (req.body ?? {}) as { label?: string };
      res.status(201).json({ success: true, ...baraka.createDatabaseBackup({ label }) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get('/api/backups', (_req, res) => {
    res.json(baraka.listDatabaseBackups());
  });

  app.post('/api/backups/verify', (req, res) => {
    try {
      const { backupPath } = req.body as { backupPath: string };
      if (typeof backupPath !== 'string') {
        res.status(400).json({ error: 'body must be {backupPath}' }); return;
      }
      res.json(baraka.validateBackupForRestore(backupPath));
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/backups/restore', (req, res) => {
    try {
      const { backupPath } = req.body as { backupPath: string };
      if (typeof backupPath !== 'string') {
        res.status(400).json({ error: 'body must be {backupPath}' }); return;
      }
      const result = baraka.restoreBackupSafely(backupPath);
      // The restore closed the live handle; re-provision a fresh connection.
      baraka = openBarakaDb(dbPath);
      res.json(result);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get('/api/z/summary', (req, res) => {
    const date = String(req.query.date ?? new Date().toISOString().slice(0, 10));
    const rows = baraka.db.prepare(
      "SELECT * FROM sales WHERE status = 'COMPLETED' AND substr(created_at, 1, 10) = ?",
    ).all(date) as Array<Record<string, number | string>>;
    const sum = (k: string) => rows.reduce((a, r) => a + (r[k] as number), 0);
    const byMethod = (m: string) => rows.filter(r => r.payment_method === m).reduce((a, r) => a + (r.total_ttc_ct as number), 0);
    res.json({
      date,
      sales_count: rows.length,
      total_ht_ct: sum('total_ht_ct'),
      total_tva_ct: sum('total_tva_ct'),
      total_timbre_ct: sum('timbre_ct'),
      total_ttc_ct: sum('total_ttc_ct'),
      total_especes_ct: byMethod('ESPECES'),
      total_bank_ct: byMethod('CIB') + byMethod('DAHABIYA'),
      total_credit_granted_ct: byMethod('CREDIT'),
    });
  });

  // Gate-03 TASK 1 — finalized Z-report closures (hash-chained, immutable).
  app.post('/api/z/close', (req, res) => {
    try {
      const out = baraka.finalizeZReport(req.body as never);
      res.status(201).json(out);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get('/api/z/list', (_req, res) => {
    res.json(baraka.listZReports());
  });

  app.get('/api/z/latest-hash', (_req, res) => {
    res.json({ prev_hash: baraka.getLatestZHash() });
  });

  // Gate-03 TASK 3 — license + machine seed meta lane.
  app.get('/api/meta/:key', (req, res) => {
    res.json({ key: req.params.key, value: baraka.getMeta(req.params.key) });
  });

  app.post('/api/meta/:key', (req, res) => {
    try {
      const { value } = req.body as { value?: unknown };
      if (typeof value !== 'string' || value.length > 512) { res.status(400).json({ error: 'body must be {value: string<=512}' }); return; }
      baraka.setMeta(req.params.key, value);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.post('/api/backup', (req, res) => {
    try {
      const dest = String((req.body as { dest?: string }).dest ?? `data/backup-${new Date().toISOString().slice(0, 10)}.db`);
      baraka.backupTo(dest);
      res.json({ ok: true, dest: path.resolve(dest) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // TASK 4 — ACID ephemeral cart draft (power-cut resilience, session MAIN_POS).
  app.post('/api/cart-draft', (req, res) => {
    try {
      const { session_id, payload_json, item_count, total_ttc_ct } = req.body as {
        session_id?: string; payload_json?: string; item_count?: number; total_ttc_ct?: number;
      };
      if (!session_id || typeof payload_json !== 'string' || typeof item_count !== 'number' || typeof total_ttc_ct !== 'number') {
        res.status(400).json({ error: 'body must be {session_id, payload_json, item_count, total_ttc_ct}' }); return;
      }
      baraka.saveCartDraft(session_id, payload_json, item_count, total_ttc_ct);
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get('/api/cart-draft/:session_id', (req, res) => {
    const row = baraka.loadCartDraft(req.params.session_id);
    if (!row) { res.status(404).json({ error: 'no draft' }); return; }
    res.json(row);
  });

  app.delete('/api/cart-draft/:session_id', (req, res) => {
    baraka.clearCartDraft(req.params.session_id);
    res.json({ ok: true });
  });

  // TASK 3 — fiscal debt settlement with Art.136 timbre + Q-XXXXXX quittance.
  app.post('/api/settlements', (req, res) => {
    try {
      const out = baraka.recordSettlement(req.body as never);
      res.status(201).json(out);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  // Gate-02 TASK 2 Lane A — raw ESC/POS spool. Accepts {hex} byte stream
  // (drawer kicks, ticket buffers) and appends to a local spool file that a
  // USB/COM forwarder drains. Zero hardware in the test lane: file exists
  // and byte counts reconcile.
  app.post('/api/raw-print', (req, res) => {
    try {
      const { hex, label } = req.body as { hex?: string; label?: string };
      if (!hex || !/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0 || hex.length > 200000) {
        res.status(400).json({ error: 'body must be {hex: even-length hex string <=100KB}' }); return;
      }
      const buf = Buffer.from(hex, 'hex');
      const dir = path.resolve('data');
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'raw-print-spool.bin'), buf);
      res.json({ ok: true, bytes: buf.length, label: label ?? 'raw' });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  return { app, baraka };
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('server/index.ts')) {
  const port = parseInt(process.env.PORT ?? '3100', 10);
  const dbPath = process.env.BARAKA_DB ?? 'data/baraka.db';
  const { app } = createApp(dbPath);
  app.listen(port, '127.0.0.1', () => {
    console.log(`[baraka-api] listening on http://127.0.0.1:${port} db=${path.resolve(dbPath)}`);
  });
}
