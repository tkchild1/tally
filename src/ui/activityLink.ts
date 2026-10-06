import type { TransactionFilter } from '../db/repo';

/** The Activity page's "Type" choices, and what each one filters on. */
export const ACTIVITY_TYPES = {
  spend: { label: 'Spending', filter: { flow: 'spend' } },
  'spend-fixed': { label: 'Fixed spending', filter: { flow: 'spend', fixed: true } },
  'spend-variable': { label: 'Variable spending', filter: { flow: 'spend', fixed: false } },
  income: { label: 'Income', filter: { flow: 'income' } },
  'income-earned': { label: 'Earned income', filter: { flow: 'income', earned: true } },
  'income-other': { label: 'Other income', filter: { flow: 'income', earned: false } },
  'in-out': { label: 'Income & spending', filter: { excludeTransfers: true } },
  transfer: { label: 'Transfers', filter: { flow: 'transfer' } },
} as const satisfies Record<string, { label: string; filter: TransactionFilter }>;

export type ActivityType = keyof typeof ACTIVITY_TYPES;

export function isActivityType(v: string | null): v is ActivityType {
  return v !== null && Object.hasOwn(ACTIVITY_TYPES, v);
}

/** A link to the Activity page with its filters preset. */
export function activityLink(opts: { period?: string; type?: ActivityType; search?: string; categoryId?: string }): string {
  const p = new URLSearchParams();
  if (opts.period) p.set('period', opts.period);
  if (opts.type) p.set('type', opts.type);
  if (opts.search) p.set('q', opts.search);
  if (opts.categoryId) p.set('category', opts.categoryId);
  const q = p.toString();
  return q ? `#/transactions?${q}` : '#/transactions';
}
