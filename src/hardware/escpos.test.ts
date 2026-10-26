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
