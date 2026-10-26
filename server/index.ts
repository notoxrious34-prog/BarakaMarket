/**
 * Baraka Market — local authoritative API (Node + Express + SQLite WAL).
 * Run:  BARAKA_DB=data/baraka.db PORT=3100 npx tsx server/index.ts
 * Lane: shop back-office / ops / Tauri bridge validation. The browser UI
 * keeps working offline on localStorage; this lane is authoritative for
 * invoice sequencing, voids journal and Z summaries.
 */
import express from 'express';
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

  app.post('/api/backup', (req, res) => {
    try {
      const dest = String((req.body as { dest?: string }).dest ?? `data/backup-${new Date().toISOString().slice(0, 10)}.db`);
      baraka.backupTo(dest);
      res.json({ ok: true, dest: path.resolve(dest) });
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
