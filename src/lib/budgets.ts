import { addMonths, type ISODate } from './dates';
import type { Cents } from './money';

export type BudgetStatus = 'under' | 'near' | 'over';

/** At or above this share of the limit, a budget is "near" its limit. */
export const NEAR_LIMIT = 0.9;

export interface BudgetInput {
  categoryId: string;
  name: string;
  limitCents: Cents;
}

export interface BudgetProgress extends BudgetInput {
  spentCents: Cents;
  /** limit - spent; negative when over. */
  remainingCents: Cents;
  /** spent / limit (0 when the limit is 0 and nothing was spent). */
  ratio: number;
  status: BudgetStatus;
}

export interface BudgetSummary {
  rows: BudgetProgress[];
  totalLimitCents: Cents;
  totalSpentCents: Cents;
  /** Spending in categories without a budget. */
  unbudgetedCents: Cents;
  /** Share of the period elapsed (0..1): partial when it includes the current month, 1 when past, 0 when future. */
  monthElapsed: number;
}

export function budgetStatus(spent: Cents, limit: Cents): BudgetStatus {
  if (spent > limit) return 'over';
  if (limit > 0 && spent >= limit * NEAR_LIMIT) return 'near';
  return 'under';
}

/** Fraction of `month` ("YYYY-MM") that has passed on `today`, counting today as passed. */
export function monthElapsed(month: string, today: ISODate): number {
  const start = `${month}-01`;
  const next = addMonths(start, 1);
  if (today < start) return 0;
  if (today >= next) return 1;
  return Number(today.slice(8, 10)) / daysInMonth(month);
}

function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Share of a run of months ("YYYY-MM") that has passed on `today`, each month weighted equally. */
export function monthsElapsed(months: readonly string[], today: ISODate): number {
  if (months.length === 0) return 0;
  return months.reduce((s, m) => s + monthElapsed(m, today), 0) / months.length;
}

/**
 * Budget progress for one month, or for several months (e.g. a year) by multiplying each
 * monthly limit by the number of months. `spending` is spending per category over those
 * months (positive cents, refunds already netted). Rows keep the budgets' order.
 */
export function budgetSummary(
  budgets: readonly BudgetInput[],
  spending: ReadonlyMap<string, Cents>,
  months: string | readonly string[],
  today: ISODate,
): BudgetSummary {
  const list = typeof months === 'string' ? [months] : months;
  const rows = budgets.map((b) => {
    const limitCents = b.limitCents * list.length;
    const spentCents = Math.max(0, spending.get(b.categoryId) ?? 0);
    return {
      ...b,
      limitCents,
      spentCents,
      remainingCents: limitCents - spentCents,
      ratio: limitCents > 0 ? spentCents / limitCents : spentCents > 0 ? Infinity : 0,
      status: budgetStatus(spentCents, limitCents),
    };
  });
  const budgeted = new Set(budgets.map((b) => b.categoryId));
  let unbudgetedCents = 0;
  for (const [id, cents] of spending) if (!budgeted.has(id) && cents > 0) unbudgetedCents += cents;
  return {
    rows,
    totalLimitCents: rows.reduce((s, r) => s + r.limitCents, 0),
    totalSpentCents: rows.reduce((s, r) => s + r.spentCents, 0),
    unbudgetedCents,
    monthElapsed: monthsElapsed(list, today),
  };
}

/**
 * Typical monthly spending per category: the average over the last `count` complete months
 * before `currentMonth` that have data. Months with no spending in a category count as zero.
 */
export function typicalSpending(
  rows: ReadonlyArray<{ month: string; categoryId: string; totalCents: Cents }>,
  dataMonths: readonly string[],
  currentMonth: string,
  count = 3,
): Map<string, Cents> {
  const months = [...dataMonths].filter((m) => m < currentMonth).sort().slice(-count);
  const out = new Map<string, Cents>();
  if (months.length === 0) return out;
  const included = new Set(months);
  const sums = new Map<string, Cents>();
  for (const r of rows) if (included.has(r.month)) sums.set(r.categoryId, (sums.get(r.categoryId) ?? 0) + r.totalCents);
  for (const [id, sum] of sums) out.set(id, Math.round(sum / months.length));
  return out;
}
