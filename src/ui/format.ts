import type { ISODate } from '../lib/dates';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-01-05" -> "Jan 5, 2026" (no Date objects, so no timezone shifts). */
export function formatDate(d: ISODate | null | undefined): string {
  if (!d) return '—';
  const month = MONTHS[Number(d.slice(5, 7)) - 1] ?? '';
  return `${month} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
}

/** "2026-01-05" -> "Jan 5". */
export function formatDateShort(d: ISODate): string {
  const month = MONTHS[Number(d.slice(5, 7)) - 1] ?? '';
  return `${month} ${Number(d.slice(8, 10))}`;
}

export function formatRange(start: ISODate | null, end: ISODate | null): string {
  if (!start && !end) return 'unknown range';
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/** "2026-01" -> "Jan 2026" (or "Jan" when short). */
export function formatMonth(month: string, short = false): string {
  const name = MONTHS[Number(month.slice(5, 7)) - 1] ?? month;
  return short ? name : `${name} ${month.slice(0, 4)}`;
}

/** Axis labels: whole dollars, "k" above $1,000. Display only. */
export function formatCompactCents(cents: number): string {
  const dollars = Math.round(cents / 100);
  const sign = dollars < 0 ? '\u2212' : '';
  const abs = Math.abs(dollars);
  return abs >= 1000 ? `${sign}$${(abs / 1000).toFixed(abs >= 10_000 ? 0 : 1)}k` : `${sign}$${abs}`;
}

export const FLOW_LABEL = { spend: 'Spending', income: 'Income', transfer: 'Transfer' } as const;

export const CADENCE_LABEL = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
} as const;

export function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}
