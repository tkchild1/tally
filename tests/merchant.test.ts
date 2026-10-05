import { describe, expect, it } from 'vitest';
import { normalizeMerchant, prettyMerchant } from '../src/lib/merchant';

describe('normalizeMerchant: README 9.1 table', () => {
  it.each([
    ['SQ *SOME CAFE Provo UT', null, 'SOME CAFE'],
    ['LANES BOWLING OREM UT', null, 'LANES BOWLING'],
    ['ACME CORP PAYROLL ACH CRE', 'ACME CORP PAYROLL ACH CREDIT EFTxxxxx9999', 'ACME CORP PAYROLL'],
    ['NETFLIX.COM LOS GATOS CA', null, 'NETFLIX.COM'],
    ['COSTCO WHSE #0123 SALT LAKE CITY UT', null, 'COSTCO WHSE'],
    ['AMZN Mktp US*2K4AB1C Amzn.com/bill WA', null, 'AMAZON MARKETPLACE'],
    ['HULU 877-555-0100 CA', null, 'HULU'],
  ])('%s -> %s', (name, memo, expected) => {
    expect(normalizeMerchant(name, memo)).toBe(expected);
  });
});

describe('normalizeMerchant: other behaviour', () => {
  it.each([
    ['ACME CORP PAYROLL ACH CRE', null, 'ACME CORP PAYROLL'],
    ['MOBILE PAYMENT TO XXXXX1234', 'MOBILE PAYMENT TO XXXXX1234', 'MOBILE PAYMENT TO'],
    ['DEBIT CARD PURCHASE XXXXX5555 SMI', 'DEBIT CARD PURCHASE XXXXX5555 SMITHS FOOD #4123 OREM UT', 'SMITHS FOOD'],
    ['PURCHASE AUTHORIZED ON 12/03 TARGET 00012345 OREM UT', null, 'TARGET'],
    ['TST* TACO SPOT OREM UT', null, 'TACO SPOT'],
    ['Spotify USA New York NY', null, 'SPOTIFY USA'],
    ['NETFLIX.COM*REF12345', null, 'NETFLIX.COM'],
    ['AMAZON.COM*AB12C3 AMZN.COM/BILL WA', null, 'AMAZON'],
    ['SUNSET APARTMENTS RENT ACH DEBIT WEB ID: 4455667', null, 'SUNSET APARTMENTS RENT'],
    ['IDAHO FALLS STORE', null, 'IDAHO FALLS STORE'],
  ])('%s -> %s', (name, memo, expected) => {
    expect(normalizeMerchant(name, memo)).toBe(expected);
  });

  it('only drops a city when a state code is present', () => {
    expect(normalizeMerchant('LANES BOWLING')).toBe('LANES BOWLING');
  });
  it('never strips a merchant down to nothing', () => {
    expect(normalizeMerchant('PROVO UT')).toBe('PROVO');
    expect(normalizeMerchant('UT')).toBe('UT');
    expect(normalizeMerchant('#1234')).toBe('#1234');
  });
  it('ignores a memo that does not extend the name', () => {
    expect(normalizeMerchant('LANES BOWLING OREM UT', 'SOMETHING ELSE')).toBe('LANES BOWLING');
  });
});

describe('prettyMerchant', () => {
  it('title-cases words and keeps vowel-less tokens', () => {
    expect(prettyMerchant('SOME CAFE')).toBe('Some Cafe');
    expect(prettyMerchant('NETFLIX.COM')).toBe('Netflix.com');
    expect(prettyMerchant('CVS')).toBe('CVS');
  });
});
