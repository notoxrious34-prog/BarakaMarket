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
import { openBarakaDb, type BarakaDb } from '../src/db/sqlite.js';

export function createApp(dbPath: string): { app: express.Express; baraka: BarakaDb } {
  const baraka = openBarakaDb(dbPath);
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
