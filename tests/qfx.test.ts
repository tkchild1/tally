import { describe, expect, it } from 'vitest';
import { last4Of, parseQfx, QfxParseError, sanitizeFitid } from '../src/lib/qfx';
import { CARD_EXAMPLE, CHECKING_EXAMPLE, FAKE_CARD_NUMBER, XML_MULTI } from './fixtures/examples';

describe('parseQfx: README checking example (SGML)', () => {
  const { statements, warnings } = parseQfx(CHECKING_EXAMPLE);
  const s = statements[0]!;

  it('finds one checking statement', () => {
    expect(statements).toHaveLength(1);
    expect(warnings).toEqual([]);
    expect(s.kind).toBe('checking');
    expect(s.acctId).toBe('x5555');
    expect(s.bankId).toBe('000000000');
    expect(s.currency).toBe('USD');
  });
  it('reads the range and the ledger balance', () => {
    expect(s.rangeStart).toBe('2025-11-02');
    expect(s.rangeEnd).toBe('2026-01-02');
    expect(s.ledgerBalance).toEqual({ amountCents: 410050, asOf: '2026-01-02' });
  });
  it('reads leaf tags without closing tags', () => {
    expect(s.transactions).toHaveLength(2);
    expect(s.transactions[0]).toEqual({
      fitid: '900000000000000001#1#071#2025-12-19#',
      postedOn: '2025-12-19',
      amountCents: 235000,
      trnType: 'CREDIT',
      name: 'ACME CORP PAYROLL ACH CREDIT E',
      memo: 'ACME CORP PAYROLL ACH CREDIT EFTxxxxx9999',
    });
    expect(s.transactions[1]!.amountCents).toBe(-25000);
  });
});

describe('parseQfx: README card example (SGML)', () => {
  const s = parseQfx(CARD_EXAMPLE).statements[0]!;

  it('reads a credit card statement', () => {
    expect(s.kind).toBe('credit_card');
    expect(s.acctId).toBe(FAKE_CARD_NUMBER);
    expect(s.bankId).toBeNull();
    expect(s.rangeStart).toBe('2025-12-02');
    expect(s.rangeEnd).toBe('2026-01-02');
    expect(s.ledgerBalance).toEqual({ amountCents: -31240, asOf: '2026-01-02' });
  });
  it('keeps the calendar day of 120000 card times, and handles missing MEMO', () => {
    expect(s.transactions.map((t) => [t.postedOn, t.amountCents, t.name, t.memo])).toEqual([
      ['2025-12-26', -865, 'SQ *SOME CAFE Provo UT', null],
      ['2025-12-22', 25000, 'PAYMENT', null],
    ]);
  });
});

describe('parseQfx: XML, multiple statements, optional tags', () => {
  const { statements, warnings } = parseQfx(XML_MULTI);

  it('parses every statement', () => {
    expect(statements.map((s) => s.kind)).toEqual(['checking', 'savings']);
  });
  it('decodes entities and drops zone suffixes', () => {
    const t = statements[0]!.transactions[0]!;
    expect(t.name).toBe('BARNES & NOBLE #2345');
    expect(t.postedOn).toBe('2026-01-05');
    expect(t.memo).toBeNull();
  });
  it('tolerates a missing LEDGERBAL', () => {
    expect(statements[1]!.ledgerBalance).toBeNull();
  });
  it('skips transactions missing required tags, with a warning that has no values', () => {
    expect(statements[1]!.transactions).toHaveLength(1);
    expect(warnings).toEqual(['Skipped 1 transaction(s) missing FITID']);
  });
});

describe('parseQfx: errors', () => {
  it('throws a clear error for non-OFX input', () => {
    expect(() => parseQfx('date,amount\n2026-01-01,5.00')).toThrow(QfxParseError);
    expect(() => parseQfx('date,amount')).toThrow(/Not an OFX\/QFX file/);
  });
  it('throws when an OFX file has no statements', () => {
    expect(() => parseQfx('<OFX><SIGNONMSGSRSV1></SIGNONMSGSRSV1></OFX>')).toThrow(/No bank or credit card statements/);
  });
  it('warns about an invalid amount without echoing it', () => {
    const bad = CARD_EXAMPLE.replace('<TRNAMT>-8.65', '<TRNAMT>abc');
    const { statements, warnings } = parseQfx(bad);
    expect(statements[0]!.transactions).toHaveLength(1);
    expect(warnings).toEqual(['Skipped 1 transaction(s) with an invalid date or amount']);
  });
});

describe('account number helpers', () => {
  it('last4Of', () => {
    expect(last4Of('x5555')).toBe('5555');
    expect(last4Of(FAKE_CARD_NUMBER)).toBe('1234');
  });
  it('sanitizeFitid removes the full card number', () => {
    const out = sanitizeFitid('40000000000012340466269716891196', FAKE_CARD_NUMBER);
    expect(out).toBe('{ACCT}0466269716891196');
    expect(out).not.toContain(FAKE_CARD_NUMBER);
  });
  it('sanitizeFitid leaves masked checking ids alone', () => {
    const fitid = '900000000000005555#1#071#2025-12-19#';
    expect(sanitizeFitid(fitid, 'x5555')).toBe(fitid);
  });
});
