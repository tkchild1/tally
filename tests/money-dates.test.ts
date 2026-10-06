import { describe, expect, it } from 'vitest';
import { centsToDecimal, formatCents, parseAmountToCents } from '../src/lib/money';
import { addDays, addMonths, daysBetween, isISODate, isYearPeriod, monthInPeriod, parseOfxDate, periodBounds, todayISO } from '../src/lib/dates';

describe('parseAmountToCents', () => {
  it.each([
    ['585.07', 58507],
    ['-8.65', -865],
    ['1,234.5', 123450],
    ['0.1', 10],
    ['2350.00', 235000],
    ['+12', 1200],
    ['-.5', -50],
    ['-0.00', 0],
    ['19.990', 1999],
  ])('%s -> %i', (input, cents) => {
    expect(parseAmountToCents(input)).toBe(cents);
  });

  it.each(['', 'abc', '1.2.3', '$5', '1e3', '12.345', '--1'])('rejects %j', (input) => {
    expect(() => parseAmountToCents(input)).toThrow();
  });
});

describe('cents formatting', () => {
  it('converts to decimal strings', () => {
    expect(centsToDecimal(-865)).toBe('-8.65');
    expect(centsToDecimal(5)).toBe('0.05');
    expect(centsToDecimal(235000)).toBe('2350.00');
  });
  it('formats for display with a real minus sign', () => {
    expect(formatCents(-123456)).toBe('\u2212$1,234.56');
    expect(formatCents(99)).toBe('$0.99');
    expect(formatCents(100, { signed: true })).toBe('+$1.00');
  });
});

describe('dates', () => {
  it('keeps the OFX calendar day regardless of time and zone suffix', () => {
    expect(parseOfxDate('20251226120000.000')).toBe('2025-12-26');
    expect(parseOfxDate('20251219000000.000')).toBe('2025-12-19');
    expect(parseOfxDate('20260102235900.000[-5:EST]')).toBe('2026-01-02');
    expect(parseOfxDate('20260131')).toBe('2026-01-31');
    expect(parseOfxDate('20260101000000[+14:LINT]')).toBe('2026-01-01');
  });
  it('rejects invalid OFX dates', () => {
    expect(() => parseOfxDate('2026')).toThrow();
    expect(() => parseOfxDate('20261332')).toThrow();
  });
  it('does day and month math on calendar dates', () => {
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59);
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
  });
  it('validates ISO dates', () => {
    expect(isISODate('2026-02-29')).toBe(false);
    expect(isISODate('2028-02-29')).toBe(true);
    expect(todayISO(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
  it('periods: a month or a whole year', () => {
    expect(isYearPeriod('2026')).toBe(true);
    expect(isYearPeriod('2026-03')).toBe(false);
    expect(periodBounds('2026')).toEqual({ start: '2026-01-01', end: '2027-01-01' });
    expect(periodBounds('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
    expect(monthInPeriod('2026-03', '2026')).toBe(true);
    expect(monthInPeriod('2025-12', '2026')).toBe(false);
    expect(monthInPeriod('2026-03', '2026-03')).toBe(true);
    expect(monthInPeriod('2026-04', '2026-03')).toBe(false);
  });
});
