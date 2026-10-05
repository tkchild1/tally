import type { Cents } from './money';

/** 10%, in basis points so the math stays in integers. */
export const TITHING_RATE_BP = 1_000;

export interface TithingMonthInput {
  /** "YYYY-MM" */
  month: string;
  /** Income for the month in cents (transfers already excluded). */
  income: Cents;
  /** Tithing paid in the month in cents, positive. */
  tithingPaid: Cents;
}

export interface TithingTotals {
  income: Cents;
  owed: Cents;
  paid: Cents;
  /** owed - paid: positive means still to pay, negative means paid ahead. */
  remaining: Cents;
}

export interface TithingSummary {
  month: TithingTotals;
  /** January through the selected month of the same year. */
  yearToDate: TithingTotals;
}

export function tithingOwed(income: Cents, rateBp = TITHING_RATE_BP): Cents {
  return income > 0 ? Math.round((income * rateBp) / 10_000) : 0;
}

function totals(rows: readonly TithingMonthInput[], rateBp: number): TithingTotals {
  const income = rows.reduce((s, r) => s + r.income, 0);
  const paid = rows.reduce((s, r) => s + r.tithingPaid, 0);
  const owed = rows.reduce((s, r) => s + tithingOwed(r.income, rateBp), 0);
  return { income, owed, paid, remaining: owed - paid };
}

/** Owed is computed per month (rounded to the cent) and summed, so the year equals the sum of its months. */
export function tithingSummary(rows: readonly TithingMonthInput[], month: string, rateBp = TITHING_RATE_BP): TithingSummary {
  const year = month.slice(0, 4);
  return {
    month: totals(
      rows.filter((r) => r.month === month),
      rateBp,
    ),
    yearToDate: totals(
      rows.filter((r) => r.month.startsWith(year) && r.month <= month),
      rateBp,
    ),
  };
}
