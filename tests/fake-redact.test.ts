import { describe, expect, it } from 'vitest';
import { FAKE_ACCOUNTS, generateFakeExports } from '../src/lib/fake';
import { parseQfx } from '../src/lib/qfx';
import { countUnmaskedDigitRuns, redactQfx } from '../src/lib/redact';
import { CARD_EXAMPLE, FAKE_CARD_NUMBER } from './fixtures/examples';

describe('generateFakeExports', () => {
  const files = generateFakeExports({ seed: 42, endDate: '2026-01-02', months: 7 });

  it('is deterministic', () => {
    expect(generateFakeExports({ seed: 42, endDate: '2026-01-02', months: 7 })).toEqual(files);
    expect(generateFakeExports({ seed: 7, endDate: '2026-01-02', months: 7 })).not.toEqual(files);
  });

  it('produces parseable checking, savings, and card statements', () => {
    const kinds = files.map((f) => parseQfx(f.text).statements[0]!.kind);
    expect(kinds).toEqual(['checking', 'savings', 'credit_card']);
    for (const f of files) {
      const s = parseQfx(f.text).statements[0]!;
      expect(s.rangeStart).toBe('2025-06-02');
      expect(s.rangeEnd).toBe('2026-01-02');
      expect(s.transactions.length).toBeGreaterThan(5);
      expect(s.ledgerBalance?.asOf).toBe('2026-01-02');
    }
  });

  it('mimics real quirks: card FITIDs carry the card number, checking NAME is truncated', () => {
    const card = parseQfx(files[2]!.text).statements[0]!;
    expect(card.transactions.every((t) => t.fitid.startsWith(FAKE_ACCOUNTS.card.acctId))).toBe(true);
    expect(card.transactions.every((t) => t.memo === null)).toBe(true);
    expect(files[2]!.text).toContain('120000.000');
    expect(card.ledgerBalance!.amountCents).toBeLessThanOrEqual(0);

    const checking = parseQfx(files[0]!.text).statements[0]!;
    expect(checking.transactions.every((t) => t.name.length <= 32)).toBe(true);
    expect(checking.transactions.some((t) => (t.memo ?? '').length > 32)).toBe(true);
    expect(checking.ledgerBalance!.amountCents).toBeGreaterThan(0);
  });

  it('includes card payments, savings transfers, and biweekly payroll', () => {
    const checking = parseQfx(files[0]!.text).statements[0]!;
    const card = parseQfx(files[2]!.text).statements[0]!;
    const savings = parseQfx(files[1]!.text).statements[0]!;
    expect(checking.transactions.filter((t) => t.name.startsWith('MOBILE PAYMENT TO XXXXX1234')).length).toBeGreaterThanOrEqual(6);
    expect(card.transactions.filter((t) => t.name === 'PAYMENT').length).toBeGreaterThanOrEqual(6);
    expect(savings.transactions.filter((t) => t.name === 'ONLINE TRANSFER FROM CHECKING').length).toBeGreaterThanOrEqual(6);
    expect(checking.transactions.filter((t) => t.name.startsWith('ACME CORP PAYROLL')).length).toBeGreaterThanOrEqual(14);
  });

  it('agrees with itself across overlapping windows', () => {
    const a = parseQfx(generateFakeExports({ endDate: '2025-10-31', months: 3 })[2]!.text).statements[0]!;
    const b = parseQfx(generateFakeExports({ endDate: '2025-12-15', months: 3 })[2]!.text).statements[0]!;
    const overlap = (t: { postedOn: string }) => t.postedOn >= '2025-09-15' && t.postedOn <= '2025-10-31';
    const fa = a.transactions.filter(overlap);
    const fb = b.transactions.filter(overlap);
    expect(fa.length).toBeGreaterThan(10);
    expect(fb).toEqual(fa);
  });
});

describe('redactQfx', () => {
  it('removes the card number from ACCTID and FITIDs and passes the post-check', () => {
    const { output, report } = redactQfx(CARD_EXAMPLE);
    expect(output).not.toContain(FAKE_CARD_NUMBER);
    expect(output).toContain('<ACCTID>XXXXXXXXXXXX1234');
    expect(report.accountIdsMasked).toBe(1);
    expect(report.accountIdOccurrencesReplaced).toBe(3);
    expect(report.postCheckPassed).toBe(true);
    expect(parseQfx(output).statements[0]!.transactions).toHaveLength(2);
  });

  it('keeps redacted FITIDs unique', () => {
    const card = generateFakeExports({ endDate: '2026-01-02' })[2]!.text;
    const before = parseQfx(card).statements[0]!.transactions.map((t) => t.fitid);
    const after = parseQfx(redactQfx(card).output).statements[0]!.transactions.map((t) => t.fitid);
    expect(new Set(after).size).toBe(new Set(before).size);
    expect(after.join(' ')).not.toContain(FAKE_CARD_NUMBER);
  });

  it('is stable when run twice', () => {
    const once = redactQfx(CARD_EXAMPLE).output;
    expect(redactQfx(once).output).toBe(once);
  });

  it('reports counts only, never digits from the input', () => {
    const { report } = redactQfx(CARD_EXAMPLE, { scrubNames: true, scrubAmounts: true });
    const json = JSON.stringify(report);
    expect(json).not.toMatch(/\d{4,}/);
    expect(json).not.toContain('865');
    expect(json).not.toContain('SOME CAFE');
  });

  it('scrubs names and amounts on request, keeping signs', () => {
    const { output } = redactQfx(CARD_EXAMPLE, { scrubNames: true, scrubAmounts: true });
    const s = parseQfx(output).statements[0]!;
    expect(s.transactions.map((t) => t.name)).toEqual(['MERCHANT 1', 'MERCHANT 2']);
    expect(s.transactions[0]!.amountCents).toBeLessThan(0);
    expect(s.transactions[1]!.amountCents).toBeGreaterThan(0);
    expect(s.transactions[0]!.amountCents).not.toBe(-865);
  });

  it('fails the post-check when a 9+ digit run survives', () => {
    const leaky = CARD_EXAMPLE.replace('<NAME>PAYMENT', '<NAME>PAYMENT REF 123456789');
    const { report } = redactQfx(leaky);
    expect(report.postCheckPassed).toBe(false);
    expect(report.postCheckViolations).toEqual({ NAME: 1 });
  });

  it('countUnmaskedDigitRuns', () => {
    expect(countUnmaskedDigitRuns(CARD_EXAMPLE.split('<CCACCTFROM>')[1]!)).toBeGreaterThan(0);
    expect(countUnmaskedDigitRuns('abc 12345678901 def')).toBe(0);
  });
});
