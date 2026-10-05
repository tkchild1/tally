import { describe, expect, it } from 'vitest';
import { tithingOwed, tithingSummary } from '../src/lib/tithing';

describe('tithing', () => {
  it('is 10% of income, rounded to the cent', () => {
    expect(tithingOwed(470_000)).toBe(47_000);
    expect(tithingOwed(470_273)).toBe(47_027);
    expect(tithingOwed(5)).toBe(1);
    expect(tithingOwed(0)).toBe(0);
    expect(tithingOwed(-1_000)).toBe(0);
  });

  const rows = [
    { month: '2025-12', income: 500_000, tithingPaid: 50_000 },
    { month: '2026-01', income: 470_000, tithingPaid: 47_000 },
    { month: '2026-02', income: 705_000, tithingPaid: 47_000 },
    { month: '2026-03', income: 470_000, tithingPaid: 0 },
  ];

  it('summarizes the month and the year to date', () => {
    const s = tithingSummary(rows, '2026-02');
    expect(s.month).toEqual({ income: 705_000, owed: 70_500, paid: 47_000, remaining: 23_500 });
    expect(s.yearToDate).toEqual({ income: 1_175_000, owed: 117_500, paid: 94_000, remaining: 23_500 });
  });

  it('shows overpayment as negative remaining', () => {
    const s = tithingSummary([{ month: '2026-01', income: 100_000, tithingPaid: 15_000 }], '2026-01');
    expect(s.month.remaining).toBe(-5_000);
  });

  it('a month without data owes nothing', () => {
    expect(tithingSummary(rows, '2026-07').month).toEqual({ income: 0, owed: 0, paid: 0, remaining: 0 });
  });
});
