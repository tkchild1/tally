import { describe, expect, it } from 'vitest';
import { budgetStatus, budgetSummary, monthElapsed, typicalSpending } from '../src/lib/budgets';

describe('budgets', () => {
  it('status: under, near (90%+), over', () => {
    expect(budgetStatus(0, 10_000)).toBe('under');
    expect(budgetStatus(8_999, 10_000)).toBe('under');
    expect(budgetStatus(9_000, 10_000)).toBe('near');
    expect(budgetStatus(10_000, 10_000)).toBe('near');
    expect(budgetStatus(10_001, 10_000)).toBe('over');
    expect(budgetStatus(0, 0)).toBe('under');
    expect(budgetStatus(1, 0)).toBe('over');
  });

  it('month elapsed: current, past, future, and February', () => {
    expect(monthElapsed('2026-09', '2026-09-15')).toBe(0.5);
    expect(monthElapsed('2026-09', '2026-10-01')).toBe(1);
    expect(monthElapsed('2026-09', '2026-08-31')).toBe(0);
    expect(monthElapsed('2026-02', '2026-02-14')).toBe(0.5);
    expect(monthElapsed('2026-01', '2026-01-31')).toBe(1);
  });

  it('summarizes spent, remaining, totals, and unbudgeted spending', () => {
    const budgets = [
      { categoryId: 'groceries', name: 'Groceries', limitCents: 50_000 },
      { categoryId: 'dining', name: 'Dining', limitCents: 20_000 },
      { categoryId: 'travel', name: 'Travel', limitCents: 10_000 },
    ];
    const spending = new Map([
      ['groceries', 46_000],
      ['dining', 25_000],
      ['shopping', 7_000],
      ['entertainment', -500],
    ]);
    const s = budgetSummary(budgets, spending, '2026-09', '2026-09-15');
    expect(s.rows.map((r) => [r.categoryId, r.spentCents, r.remainingCents, r.status])).toEqual([
      ['groceries', 46_000, 4_000, 'near'],
      ['dining', 25_000, -5_000, 'over'],
      ['travel', 0, 10_000, 'under'],
    ]);
    expect(s.rows[1]!.ratio).toBe(1.25);
    expect(s.totalLimitCents).toBe(80_000);
    expect(s.totalSpentCents).toBe(71_000);
    expect(s.unbudgetedCents).toBe(7_000);
    expect(s.monthElapsed).toBe(0.5);
  });

  it('a net refund in a category counts as zero spent', () => {
    const s = budgetSummary([{ categoryId: 'shopping', name: 'Shopping', limitCents: 10_000 }], new Map([['shopping', -2_000]]), '2026-09', '2026-09-30');
    expect(s.rows[0]).toMatchObject({ spentCents: 0, remainingCents: 10_000, status: 'under' });
  });

  it('typical spending averages the last 3 complete months, zeros included', () => {
    const rows = [
      { month: '2026-05', categoryId: 'groceries', totalCents: 90_000 },
      { month: '2026-06', categoryId: 'groceries', totalCents: 30_000 },
      { month: '2026-07', categoryId: 'groceries', totalCents: 60_000 },
      { month: '2026-08', categoryId: 'groceries', totalCents: 30_000 },
      { month: '2026-08', categoryId: 'travel', totalCents: 30_000 },
      { month: '2026-09', categoryId: 'groceries', totalCents: 99_999 },
    ];
    const t = typicalSpending(rows, ['2026-09', '2026-08', '2026-07', '2026-06', '2026-05'], '2026-09');
    expect(t.get('groceries')).toBe(40_000);
    expect(t.get('travel')).toBe(10_000);
    expect(typicalSpending(rows, ['2026-09'], '2026-09').size).toBe(0);
  });
});
