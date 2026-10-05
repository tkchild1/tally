export type CategoryKind = 'income' | 'expense' | 'system';

export interface CategoryDef {
  id: string;
  name: string;
  kind: CategoryKind;
  isFixed: boolean;
}

/** Seeded into `categories` on first run. Users can toggle `isFixed` later. */
export const DEFAULT_CATEGORIES: readonly CategoryDef[] = [
  { id: 'income_paycheck', name: 'Paycheck', kind: 'income', isFixed: false },
  { id: 'income_other', name: 'Other income', kind: 'income', isFixed: false },
  { id: 'housing', name: 'Housing', kind: 'expense', isFixed: true },
  { id: 'utilities', name: 'Utilities & phone', kind: 'expense', isFixed: true },
  { id: 'insurance', name: 'Insurance', kind: 'expense', isFixed: true },
  { id: 'subscriptions', name: 'Subscriptions', kind: 'expense', isFixed: true },
  { id: 'groceries', name: 'Groceries', kind: 'expense', isFixed: false },
  { id: 'dining', name: 'Dining & coffee', kind: 'expense', isFixed: false },
  { id: 'transport', name: 'Transport & fuel', kind: 'expense', isFixed: false },
  { id: 'shopping', name: 'Shopping', kind: 'expense', isFixed: false },
  { id: 'entertainment', name: 'Entertainment', kind: 'expense', isFixed: false },
  { id: 'health', name: 'Health', kind: 'expense', isFixed: false },
  { id: 'education', name: 'Education', kind: 'expense', isFixed: false },
  { id: 'travel', name: 'Travel', kind: 'expense', isFixed: false },
  { id: 'fees', name: 'Fees & interest', kind: 'expense', isFixed: false },
  { id: 'uncategorized', name: 'Uncategorized', kind: 'expense', isFixed: false },
  { id: 'transfer', name: 'Transfer', kind: 'system', isFixed: false },
];
