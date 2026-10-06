import type { Db } from '../db/client';
import { listBudgets, spendingByCategory } from '../db/repo';
import { budgetSummary, type BudgetSummary } from '../lib/budgets';
import { todayISO } from '../lib/dates';

/** Budget progress for a month ("YYYY-MM"), in budget-name order. */
export async function loadBudgetSummary(db: Db, month: string): Promise<BudgetSummary> {
  const [budgets, spending] = await Promise.all([listBudgets(db), spendingByCategory(db, month)]);
  return budgetSummary(
    budgets.map((b) => ({ categoryId: b.category_id, name: b.name, limitCents: b.monthly_cents })),
    new Map(spending.map((s) => [s.category_id, s.total])),
    month,
    todayISO(),
  );
}
