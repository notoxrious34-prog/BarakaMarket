# Scripts — seed & migration (SQLite)

All scripts run with tsx (no build step):

```bash
# Fresh shop DB from seedData.ts (legacy floats -> ct/milli), default out: data/baraka.db
npx tsx scripts/seed-db.ts [out.db]

# Migrate a browser localStorage dump into SQLite
npx tsx scripts/migrate-localstorage.ts <dump.json> <out.db>
```

## Producing dump.json from the running web app

Paste in DevTools console on the app page, then save the copied object as `dump.json`:

```js
const pick = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return undefined; } };
copy({
  products: pick('baraka_products_v2'),
  clients: pick('baraka_clients_v2'),
  suppliers: pick('baraka_suppliers_v2'),
  sales: pick('baraka_sales_v2'),
  purchases: pick('baraka_purchases_v2'),
});
```

## Notes

- `data/` is gitignored (databases are generated artifacts, incl. `.tmp-tests/`).
- C: on this machine is full — never point outputs or TMP at C: paths.
- Migration canonicalizes legacy float lines through the deterministic engine
  (`HT = round(TTC*100/(100+taux))`); per-line drift is capped at 1ct and every
  adjusted line + every timbre recomputation is counted in the report.
