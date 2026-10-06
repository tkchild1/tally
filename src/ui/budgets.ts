import type { Db } from '../db/client';
import { listBudgets, listMonths, spendingByCategory } from '../db/repo';
import { budgetSummary, type BudgetSummary } from '../lib/budgets';
import { isYearPeriod, monthInPeriod, todayISO } from '../lib/dates';

/**
 * Budget progress for a month ("YYYY-MM") or a year ("YYYY"), in budget-name order.
 * A year's limits cover only the months of that year that have data.
 */
export async function loadBudgetSummary(db: Db, period: string): Promise<BudgetSummary> {
  const [budgets, spending, months] = await Promise.all([
    listBudgets(db),
    spendingByCategory(db, period),
    isYearPeriod(period) ? listMonths(db) : Promise.resolve([period]),
  ]);
  return budgetSummary(
    budgets.map((b) => ({ categoryId: b.category_id, name: b.name, limitCents: b.monthly_cents })),
    new Map(spending.map((s) => [s.category_id, s.total])),
    months.filter((m) => monthInPeriod(m, period)),
    todayISO(),
  );
}
