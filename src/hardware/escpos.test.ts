import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReceipt,
  buildQuittance,
  containsBytes,
  ESCPOS_DRAWER_KICK,
  ESCPOS_PAPER_CUT,
} from './escpos.js';

const sale = {
  storeName: 'BARAKA MARKET',
  rc: '16/00-501101',
  nif: '001516012345678',
  invoice: 'FACT-2026-000001',
  ticket: 'T-2026-000001',
  date: '26/10/2026',
  cashier: 'Amine',
  items: [
    { name: 'LAIT CONDENSE SUCRE 397G', qty: 2, unit: 'PIECE', lineTtc: 360 },
    { name: 'POMMES LOCALES GOLDEN', qty: 1.45, unit: 'KG', lineTtc: 406 },
  ],
  totalHt: 1000,
  tva9Base: 500,
  tva9Amt: 45,
  tva19Base: 200,
  tva19Amt: 38,
  timbre: 18,
  totalTtc: 1794,
  paymentMethod: 'ESPECES',
  amountPaid: 2000,
  changeDue: 206,
};

test('escpos: receipt is a valid Uint8Array with header + rows + tax table', () => {
  const buf = buildReceipt(sale);
  assert.ok(buf instanceof Uint8Array);
  assert.ok(buf.length > 200);
  const text = Buffer.from(buf).toString('utf8');
  assert.ok(text.includes('BARAKA MARKET'), 'header store name');
  assert.ok(text.includes('FACT-2026-000001'), 'invoice number');
  assert.ok(text.includes('LAIT CONDENSE SUCRE 397G'), 'french item row');
  assert.ok(text.includes('TVA 9%'), 'tax breakdown 9%');
  assert.ok(text.includes('TVA 19%'), 'tax breakdown 19%');
  assert.ok(text.includes('Timbre'), 'timbre line');
  assert.ok(text.includes('TOTAL TTC'), 'grand total');
});

test('escpos: receipt embeds drawer-kick and cut sequences', () => {
  const buf = buildReceipt(sale);
  assert.ok(containsBytes(buf, ESCPOS_DRAWER_KICK), 'drawer kick [1B 70 00 19 FA]');
  assert.ok(containsBytes(buf, ESCPOS_PAPER_CUT), 'paper cut [1D 56 42 00]');
  assert.deepEqual(Array.from(ESCPOS_DRAWER_KICK), [0x1b, 0x70, 0x00, 0x19, 0xfa]);
  assert.deepEqual(Array.from(ESCPOS_PAPER_CUT), [0x1d, 0x56, 0x42, 0x00]);
  // ESC @ init opens the buffer
  assert.equal(buf[0], 0x1b);
  assert.equal(buf[1], 0x40);
});

test('escpos: quittance carries settlement ledger + timbre + kick/cut', () => {
  const buf = buildQuittance({
    storeName: 'BARAKA MARKET',
    receipt: 'Q-2026-000007',
    date: '26/10/2026',
    clientName: 'Mohamed B.',
    prevBalance: 15000,
    amount: 5000,
    timbre: 50,
    collected: 5050,
    newBalance: 10000,
    paymentMethod: 'ESPECES',
  });
  const text = Buffer.from(buf).toString('utf8');
  assert.ok(text.includes('QUITTANCE'), 'quittance title');
  assert.ok(text.includes('Q-2026-000007'), 'quittance number');
  assert.ok(text.includes('Mohamed B.'), 'client row');
  assert.ok(text.includes('Timbre'), 'stamp line');
  assert.ok(containsBytes(buf, ESCPOS_DRAWER_KICK), 'kick on cash encaissement');
  assert.ok(containsBytes(buf, ESCPOS_PAPER_CUT), 'cut paper');
});

test('escpos: thermal settlement quittance has bilingual title + ledger + kick/cut', async () => {
  const { buildThermalSettlementQuittance } = await import('./escpos.js');
  const buf = buildThermalSettlementQuittance({
    receiptNumber: 'Q-2026-000007', date: '2026-10-27T18:00:00.000Z',
    clientName: 'FAMILLE BENALI', clientPhone: '0550123456', cashierName: 'Yacine',
    previousBalanceCt: 2500000, paidAmountCt: 1000000, timbreCt: 10000,
    totalCollectedCt: 1010000, newBalanceCt: 1500000, paymentMethod: 'ESPECES',
  });
  const text = Buffer.from(buf).toString('utf8');
  assert.ok(buf[0] === 0x1b && buf[1] === 0x40, 'ESC @ init');
  assert.ok(text.includes('QUITTANCE DE REGLEMENT'), 'french title');
  assert.ok(text.includes('Ancien Solde : 25000.00 DZD'), 'previous balance');
  assert.ok(text.includes('Versement    : 10000.00 DZD'), 'payment line');
  assert.ok(text.includes('Timbre Art.136: +100.00 DZD'), 'stamp line');
  assert.ok(text.includes('Nouveau Solde: 15000.00 DZD'), 'new balance');
  assert.ok(text.includes('Q-2026-000007'), 'quittance ref');
  assert.ok(containsBytes(buf, [0x1b, 0x21, 0x10]), 'double-height Versement');
  assert.ok(containsBytes(buf, ESCPOS_DRAWER_KICK), 'drawer kick');
  assert.ok(containsBytes(buf, ESCPOS_PAPER_CUT), 'auto-cut');
});

test('escpos: settlement quittance skips timbre line when zero and accepts profile store', async () => {
  const { buildThermalSettlementQuittance } = await import('./escpos.js');
  const buf = buildThermalSettlementQuittance({
    receiptNumber: 'Q-2026-000008', date: '2026-10-27', clientName: 'CANTINE',
    previousBalanceCt: 500000, paidAmountCt: 500000, timbreCt: 0,
    totalCollectedCt: 500000, newBalanceCt: 0, paymentMethod: 'CIB',
  }, { store_name: 'SUPERETTE NOUR', phone: '023456789', address: 'Alger' });
  const text = Buffer.from(buf).toString('utf8');
  assert.ok(!text.includes('Timbre'), 'no stamp line for CIB');
  assert.ok(text.includes('SUPERETTE NOUR'), 'profile store name');
  assert.ok(text.includes('023456789'), 'profile contact');
  assert.ok(containsBytes(buf, ESCPOS_PAPER_CUT), 'cut paper');
});

test('escpos: thermal Z report carries turnover, verdict and cut', async () => {
  const { buildThermalZReport } = await import('./escpos.js');
  const z = {
    zNumber: 'Z-2026-000001', periodStart: '2026-10-28T08:00:00.000Z', periodEnd: '2026-10-28T20:00:00.000Z',
    cashierName: 'Yacine', totalHtCt: 800000, totalTva9Ct: 0, totalTva19Ct: 0, totalTimbreCt: 3000,
    totalTtcCt: 803000, salesCount: 2, cashSalesCt: 303000, cibSalesCt: 500000, dahabiyaSalesCt: 0,
    creditSalesCt: 0, settlementsCashCt: 101000, depositsCt: 50000, withdrawalsCt: 20000, expensesCt: 10000,
    openingFloatCt: 1000000, theoreticalCashCt: 1424000, closingCountedCt: 1419000, cashDiffCt: -5000,
    hash: 'ab'.repeat(32),
  };
  const buf = buildThermalZReport(z);
  const text = Buffer.from(buf).toString('utf8');
  assert.ok(buf[0] === 0x1b && buf[1] === 0x40, 'ESC @ init');
  assert.ok(text.includes('RAPPORT Z DE CLOTURE'), 'z title');
  assert.ok(text.includes('Z-2026-000001'), 'z number');
  assert.ok(text.includes('8030.00 DZD'), 'total ttc');
  assert.ok(text.includes('Ecart      : -50.00 DZD DEFICIT'), 'deficit verdict');
  assert.ok(text.includes('Hash: abababababababab...'), 'hash tail');
  assert.ok(containsBytes(buf, ESCPOS_PAPER_CUT), 'auto-cut');
});

test('escpos: Z report surplus and perfect verdicts', async () => {
  const { buildThermalZReport } = await import('./escpos.js');
  const base = {
    zNumber: 'Z-2026-000002', periodStart: 'x', periodEnd: 'y', cashierName: 'K',
    totalHtCt: 0, totalTva9Ct: 0, totalTva19Ct: 0, totalTimbreCt: 0, totalTtcCt: 0,
    salesCount: 0, cashSalesCt: 0, cibSalesCt: 0, dahabiyaSalesCt: 0, creditSalesCt: 0,
    settlementsCashCt: 0, depositsCt: 0, withdrawalsCt: 0, expensesCt: 0,
    openingFloatCt: 0, theoreticalCashCt: 0, closingCountedCt: 0, cashDiffCt: 0, hash: 'cd'.repeat(32),
  };
  const surplus = Buffer.from(buildThermalZReport({ ...base, cashDiffCt: 250 })).toString('utf8');
  assert.ok(surplus.includes('2.50 DZD EXCEDENT'), 'surplus verdict');
  const perfect = Buffer.from(buildThermalZReport(base)).toString('utf8');
  assert.ok(perfect.includes('0.00 DZD PARFAIT'), 'perfect verdict');
});
