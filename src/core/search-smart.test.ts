import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normToken, smartMatches } from './search-smart';

const MILK = { name_fr: 'Lait demi-écrémé 1L', name_ar: 'حليب نصف دسم 1ل', barcode: '613000000001' };
const BREAD = { name_fr: 'Pain traditionnel', name_ar: 'خبز تقليدي', barcode: '613000000002' };

describe('search-smart ADR-051 P1', () => {
  it('normalizes hamza/ta-marbuta/tashkeel', () => {
    assert.equal(normToken('أحمد'), 'احمد');
    assert.equal(normToken('فاطمة'), 'فاطمه');
    assert.equal(normToken('حَلِيبٌ'), normToken('حليب'));
  });
  it('transliterates latin staples to Arabic', () => {
    assert.equal(smartMatches(MILK, 'hlib'), true);
    assert.equal(smartMatches(MILK, 'lait'), true);
    assert.equal(smartMatches(BREAD, 'khobz'), true);
    assert.equal(smartMatches(BREAD, 'خبز'), true);
    assert.equal(smartMatches(BREAD, 'hlib'), false);
  });
  it('multi-token AND across FR/AR/barcode', () => {
    assert.equal(smartMatches(MILK, 'lait 1l'), true);
    assert.equal(smartMatches(MILK, 'lait sucre'), false);
    assert.equal(smartMatches(MILK, '613000000001'), true);
    assert.equal(smartMatches(MILK, ''), true);
  });
});
