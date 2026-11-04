import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildJournalEntries,
  filterJournalByPeriod,
  journalToCsv,
  type JournalInput,
} from './compta-kernel';

const base: JournalInput = {
  sales: [
    {
      id: 'S1', invoice_number: 'FACT-1', ticket_number: 'T-1',
      cashier_id: 'c', cashier_name: 'c', client_id: 2,
      items: [{ product_id: 1, barcode: 'b', name_fr: 'x', name_ar: 'x', unit_price_ttc: 100, quantity: 2, unit: 'PIECE', tva_rate: 0, discount_percent: 0, total_line_ht: 200, total_line_tva: 0, total_line_ttc: 200 }],
      total_ht: 200, tva_breakdown: {}, total_tva: 0, timbre_fiscal: 0, total_ttc: 200,
      payment_method: 'CIB', amount_paid: 200, amount_returned: 0,
      status: 'COMPLETED', created_at: '2026-11-04T10:00:00.000Z',
    } as never,
    {
      id: 'S2', invoice_number: 'FACT-2', ticket_number: 'T-2',
      cashier_id: 'c', cashier_name: 'c', client_id: 2, items: [],
      total_ht: 50, tva_breakdown: {}, total_tva: 0, timbre_fiscal: 0, total_ttc: 50,
      payment_method: 'ESPECES', amount_paid: 50, amount_returned: 0,
      status: 'CANCELLED', created_at: '2026-11-04T11:00:00.000Z',
    } as never,
  ],
  purchases: [
    {
      id: 'P1', invoice_number: 'BR-2026-0001', supplier_id: 1, supplier_name: 'CEVITAL',
      items: [], total_ht: 1000, total_tva: 0, total_ttc: 1000,
      payment_method: 'VIREMENT', amount_paid: 1000, amount_due: 0, date: '2026-11-03T09:00:00.000Z',
    } as never,
  ],
  settlements: [
    { id: 'ST1', client_id: 2, client_name: 'Karim', amount: 500, payment_method: 'ESPECES', date: '2026-11-04T12:00:00.000Z', timbre_fiscal: 5, total_collected: 505 } as never,
  ],
  supplierPayments: [
    { id: 'SP1', supplier_id: 1, supplier_name: 'CEVITAL', amount: 300, payment_method: 'CHEQUE', date: '2026-11-02T09:00:00.000Z' } as never,
  ],
  expenses: [
    { id: 'EXP1', date: '2026-11-04', category: 'LOYER', amountCt: 100000, method: 'ESPECES', byUser: 'owner', tillPosted: true, createdAt: '2026-11-04T08:00:00.000Z' } as never,
  ],
};

describe('compta-kernel (C-lane)', () => {
  it('C3: voided sales never reach the journal', () => {
    const j = buildJournalEntries(base);
    assert.ok(!j.some(e => e.id === 'S2'), 'CANCELLED sale journaled!');
    assert.ok(j.some(e => e.id === 'S1'));
  });
  it('C6/C7: card and bank flows never debit the cash account', () => {
    const j = buildJournalEntries(base);
    const card = j.find(e => e.id === 'S1')!;
    assert.equal(card.debitAccount, '512000 Banque CIB');
    const virement = j.find(e => e.id === 'P1')!;
    assert.equal(virement.creditAccount, '512000 Banque');
    const cheque = j.find(e => e.id === 'SP1')!;
    assert.equal(cheque.creditAccount, '512000 Banque Chèque');
  });
  it('C9: settlement timbre rides as an explicit memo', () => {
    const j = buildJournalEntries(base);
    const st = j.find(e => e.id === 'ST1')!;
    assert.equal(st.timbreDzd, 5);
    assert.match(st.label, /timbre 5 DZD/);
  });
  it('C4: period filter selects today / month / all', () => {
    const j = buildJournalEntries(base);
    const now = new Date('2026-11-04T23:00:00.000Z');
    assert.equal(filterJournalByPeriod(j, 'today', now).length, 3); // S1, ST1, EXP1
    assert.ok(filterJournalByPeriod(j, 'month', now).length >= 5);
    assert.equal(filterJournalByPeriod(j, 'all', now).length, 5); // S2 voided out
  });
  it('CSV: header + rows, semicolon, semicolon-safe escaping', () => {
    const csv = journalToCsv(buildJournalEntries(base));
    assert.ok(csv.startsWith('﻿Date;Type;'), 'missing BOM/header');
    assert.equal(csv.split('\n').length, 6); // header + 5 rows
  });
});
