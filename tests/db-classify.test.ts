import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/client';
import { importFile, importFiles } from '../src/db/importer';
import { reclassifyAll } from '../src/db/reclassify';
import {
  addCategory,
  balanceInputs,
  CategoryNameError,
  categorySpendByMonth,
  deleteBudget,
  deleteCategory,
  deleteRule,
  eraseAllData,
  filterSummary,
  listBudgets,
  listCategories,
  listRules,
  renameCategory,
  setMerchantCategory,
  uncategorizedMerchants,
  listSpendCharges,
  listTransactions,
  listTransferHints,
  markHintAsTransfer,
  monthlyTotals,
  setTransactionCategory,
  setBudget,
  setTransactionFlow,
  spendingByCategory,
  topMerchants,
  transactionTotals,
} from '../src/db/repo';
import { ACTIVITY_TYPES } from '../src/ui/activityLink';
import { balanceSeries } from '../src/lib/balance';
import { generateFakeExports } from '../src/lib/fake';
import { detectSubscriptions } from '../src/lib/subscriptions';
import { CARD_EXAMPLE, CHECKING_EXAMPLE } from './fixtures/examples';

let db: Db;
beforeEach(async () => {
  db = await openDb();
});

async function rowsByMerchant(merchant: string) {
  return (await listTransactions(db, { limit: 10_000 })).filter((t) => t.merchant === merchant);
}

describe('re-classification on import', () => {
  it('checking first leaves a transfer hint; importing the card flips it to a paired transfer', async () => {
    await importFile(db, 'checking.qfx', CHECKING_EXAMPLE);
    expect(await listTransferHints(db)).toEqual([{ hint: '1234', count: 1 }]);
    const [payBefore] = await rowsByMerchant('MOBILE PAYMENT TO');
    expect(payBefore).toMatchObject({ flow: 'spend', transfer_hint: '1234' });

    await importFile(db, 'card.qfx', CARD_EXAMPLE);
    expect(await listTransferHints(db)).toEqual([]);
    const [pay] = await rowsByMerchant('MOBILE PAYMENT TO');
    const [recv] = await rowsByMerchant('PAYMENT');
    expect(pay).toMatchObject({ flow: 'transfer', category_id: 'transfer', transfer_hint: null });
    expect(recv!.flow).toBe('transfer');
    expect(pay!.transfer_group).toBe(recv!.transfer_group);
  });

  it('classifies payroll and card spending', async () => {
    await importFiles(db, [
      { name: 'c.qfx', text: CHECKING_EXAMPLE },
      { name: 'k.qfx', text: CARD_EXAMPLE },
    ]);
    expect((await rowsByMerchant('ACME CORP PAYROLL'))[0]).toMatchObject({ flow: 'income', category_id: 'income_paycheck' });
    expect((await rowsByMerchant('SOME CAFE'))[0]).toMatchObject({ flow: 'spend', category_id: 'dining' });
  });

  it('is a no-op when nothing changed', async () => {
    await importFile(db, 'checking.qfx', CHECKING_EXAMPLE);
    expect(await reclassifyAll(db)).toBe(0);
  });

  it('marking a hint as transfer fixes every row with that hint', async () => {
    await importFile(db, 'checking.qfx', CHECKING_EXAMPLE);
    await markHintAsTransfer(db, '1234');
    const [pay] = await rowsByMerchant('MOBILE PAYMENT TO');
    expect(pay).toMatchObject({ flow: 'transfer', flow_source: 'user', category_id: 'transfer', transfer_hint: null });
    expect(await listTransferHints(db)).toEqual([]);
  });
});

describe('learning from corrections', () => {
  const card = () => generateFakeExports({ endDate: '2026-01-02' }).find((f) => f.kind === 'credit_card')!;

  it('"apply to all" saves an equals rule and recategorizes every unlocked row of that merchant', async () => {
    await importFile(db, 'card.qfx', card().text);
    const before = await rowsByMerchant('NETFLIX.COM');
    expect(before.length).toBeGreaterThan(3);
    expect(before.every((t) => t.category_id === 'subscriptions')).toBe(true);

    // Lock one row first: it must not follow the rule.
    await setTransactionCategory(db, before[0]!.id, 'shopping', false);
    await setTransactionCategory(db, before[1]!.id, 'entertainment', true);

    const after = await rowsByMerchant('NETFLIX.COM');
    expect(after.find((t) => t.id === before[0]!.id)).toMatchObject({ category_id: 'shopping', category_source: 'user' });
    expect(after.filter((t) => t.id !== before[0]!.id).every((t) => t.category_id === 'entertainment')).toBe(true);

    const rules = await listRules(db);
    expect(rules).toMatchObject([{ match_type: 'equals', pattern: 'NETFLIX.COM', category_id: 'entertainment' }]);
    expect(rules[0]!.matches).toBe(after.length);

    // Re-importing does not undo anything.
    await importFile(db, 'card.qfx', card().text);
    expect(await rowsByMerchant('NETFLIX.COM')).toEqual(after);

    // Deleting the rule reverts unlocked rows to the default category.
    await deleteRule(db, rules[0]!.id);
    const reverted = await rowsByMerchant('NETFLIX.COM');
    expect(reverted.find((t) => t.id === before[0]!.id)!.category_id).toBe('shopping');
    expect(reverted.filter((t) => t.id !== before[0]!.id).every((t) => t.category_id === 'subscriptions')).toBe(true);
  });

  it('changing the flow locks it and survives re-classification', async () => {
    await importFile(db, 'card.qfx', card().text);
    const [t] = await rowsByMerchant('LANES BOWLING');
    await setTransactionFlow(db, t!.id, 'transfer');
    await reclassifyAll(db);
    const [after] = (await rowsByMerchant('LANES BOWLING')).filter((x) => x.id === t!.id);
    expect(after).toMatchObject({ flow: 'transfer', flow_source: 'user', category_id: 'transfer' });
  });
});

describe('Milestone 2 acceptance on demo data', () => {
  // Just after the January Hulu price rise, so the latest Hulu charge carries a price change.
  const END = '2026-01-25';

  beforeEach(async () => {
    await importFiles(
      db,
      generateFakeExports({ seed: 42, endDate: END, months: 7 }).map((f) => ({ name: f.fileName, text: f.text })),
    );
  });

  it('card payments and savings transfers are neither spending nor income', async () => {
    const all = await listTransactions(db, { limit: 10_000 });
    const transferish = all.filter((t) => /MOBILE PAYMENT TO|ONLINE TRANSFER|^PAYMENT$/.test(t.raw_name));
    expect(transferish.length).toBeGreaterThan(20);
    expect(transferish.every((t) => t.flow === 'transfer' && t.transfer_group !== null)).toBe(true);
    expect(await listTransferHints(db)).toEqual([]);
  });

  it('monthly income is roughly the payroll', async () => {
    const totals = await monthlyTotals(db);
    const all = await listTransactions(db, { limit: 10_000 });
    for (const m of totals.filter((x) => x.month > '2025-06' && x.month < '2026-01')) {
      const payroll = all
        .filter((t) => t.posted_on.startsWith(m.month) && t.merchant === 'ACME CORP PAYROLL')
        .reduce((s, t) => s + t.amount_cents, 0);
      expect(payroll).toBeGreaterThanOrEqual(2 * 235_000);
      expect(m.earned).toBe(payroll);
      expect(m.income).toBeGreaterThanOrEqual(m.earned);
      expect(m.spending).toBe(m.fixed + m.variable);
    }
  });

  it('subscriptions include the fake services, but not electricity or weekly coffee', async () => {
    const subs = detectSubscriptions(await listSpendCharges(db), END, new Map());
    const names = subs.map((s) => s.merchant);
    for (const m of ['NETFLIX.COM', 'SPOTIFY USA', 'HULU', 'APPLE.COM/BILL', 'PLANET FITNESS']) expect(names).toContain(m);
    expect(names).not.toContain('ROCKY MOUNTAIN POWER');
    expect(names).not.toContain('BEAN THERE');
    expect(subs.find((s) => s.merchant === 'NETFLIX.COM')).toMatchObject({ cadence: 'monthly', monthlyCents: 1549, active: true });
    expect(subs.find((s) => s.merchant === 'HULU')!.priceChange).not.toBeNull();
    expect(names).not.toContain('TITHING DONATION ONLINE');
  });

  it('tithing payments land in the tithing category, and paid is about 10% of payroll', async () => {
    const tithes = await rowsByMerchant('TITHING DONATION ONLINE');
    expect(tithes.length).toBeGreaterThan(10);
    expect(tithes.every((t) => t.flow === 'spend' && t.category_id === 'tithing')).toBe(true);
    const all = await listTransactions(db, { limit: 10_000 });
    for (const m of (await monthlyTotals(db)).filter((x) => x.month > '2025-07' && x.month < '2026-01')) {
      const payroll = all
        .filter((t) => t.posted_on.startsWith(m.month) && t.merchant === 'ACME CORP PAYROLL')
        .reduce((s, t) => s + t.amount_cents, 0);
      expect(Math.abs(m.tithing - payroll / 10)).toBeLessThanOrEqual(23_500);
    }
  });

  it('dashboard filters narrow totals, summaries, and merchants to matching rows', async () => {
    const all = await listTransactions(db, { limit: 10_000 });
    const golf = all.filter((t) => /GOLF/i.test(t.merchant) && t.flow === 'spend');
    expect(golf.length).toBeGreaterThan(0);
    const golfSpent = -golf.reduce((s, t) => s + t.amount_cents, 0);

    const totals = await monthlyTotals(db, { search: 'golf' });
    expect(totals.reduce((s, m) => s + m.spending, 0)).toBe(golfSpent);
    expect(totals.every((m) => m.income === 0)).toBe(true);

    const summary = await filterSummary(db, { search: 'GoLf' });
    expect(summary).toMatchObject({ spent: golfSpent, purchases: golf.length, income: 0 });

    const merchants = await topMerchants(db, { search: 'golf' });
    expect(merchants.map((m) => m.merchant).sort()).toEqual([...new Set(golf.map((t) => t.merchant))].sort());

    const groceries = await topMerchants(db, { categoryId: 'groceries' }, undefined, 50);
    expect(groceries.length).toBeGreaterThan(1);
    const groceryRows = all.filter((t) => t.category_id === 'groceries' && t.flow === 'spend');
    expect(groceries.reduce((s, m) => s + m.total, 0)).toBe(-groceryRows.reduce((s, t) => s + t.amount_cents, 0));

    const both = await filterSummary(db, { search: 'golf', categoryId: 'groceries' });
    expect(both).toMatchObject({ spent: 0, purchases: 0, first: null });
  });

  it('each dashboard total adds up to the Activity filter it links to', async () => {
    const months = (await monthlyTotals(db)).filter((m) => m.month.startsWith('2025'));
    const sum = (k: 'income' | 'earned' | 'spending' | 'fixed' | 'variable') => months.reduce((s, m) => s + m[k], 0);
    const total = async (type: keyof typeof ACTIVITY_TYPES, search?: string) =>
      (await transactionTotals(db, { period: '2025', search, ...ACTIVITY_TYPES[type].filter })).sum;
    expect(await total('income-earned')).toBe(sum('earned'));
    expect(await total('income-other')).toBe(sum('income') - sum('earned'));
    expect(-(await total('spend'))).toBe(sum('spending'));
    expect(-(await total('spend-fixed'))).toBe(sum('fixed'));
    expect(-(await total('spend-variable'))).toBe(sum('variable'));
    expect(await total('in-out')).toBe(sum('income') - sum('spending'));

    const golf = (await monthlyTotals(db, { search: 'golf' })).filter((m) => m.month.startsWith('2025'));
    expect(-(await total('spend', 'golf'))).toBe(golf.reduce((s, m) => s + m.spending, 0));
    const dec = (await monthlyTotals(db)).find((m) => m.month === '2025-12')!;
    expect(-(await transactionTotals(db, { period: '2025-12', flow: 'spend' })).sum).toBe(dec.spending);
  });

  it('budgets: set, update, list, delete; per-category monthly spending matches the category chart', async () => {
    await setBudget(db, 'dining', 30_000);
    await setBudget(db, 'groceries', 50_000);
    await setBudget(db, 'dining', 25_000);
    expect(await listBudgets(db)).toEqual([
      { category_id: 'dining', name: 'Dining', monthly_cents: 25_000 },
      { category_id: 'groceries', name: 'Groceries', monthly_cents: 50_000 },
    ]);
    await expect(setBudget(db, 'dining', -1)).rejects.toThrow();
    await expect(setBudget(db, 'dining', 12.5)).rejects.toThrow();
    await deleteBudget(db, 'dining');
    expect((await listBudgets(db)).map((b) => b.category_id)).toEqual(['groceries']);

    const byMonth = await categorySpendByMonth(db);
    const dec = await spendingByCategory(db, '2025-12');
    for (const c of dec) {
      expect(byMonth.find((r) => r.month === '2025-12' && r.categoryId === c.category_id)?.totalCents).toBe(c.total);
    }

    const year = await spendingByCategory(db, '2026');
    for (const c of year) {
      const sum = byMonth.filter((r) => r.month.startsWith('2026-') && r.categoryId === c.category_id).reduce((s, r) => s + r.totalCents, 0);
      expect(c.total).toBe(sum);
    }
    const yearMerchants = await topMerchants(db, {}, '2026', 1000);
    expect(yearMerchants.reduce((s, m) => s + m.total, 0)).toBe(year.reduce((s, c) => s + c.total, 0));
  });

  it('the balance chart ends at the snapshot values', async () => {
    const { accounts, txns, snapshots } = await balanceInputs(db);
    const series = balanceSeries(accounts, txns, snapshots);
    const last = series.at(-1)!;
    expect(last.date).toBe(END);
    const snap = (kind: string) =>
      snapshots.filter((s) => accounts.find((a) => a.id === s.accountId)!.kind === kind).reduce((x, s) => x + s.balanceCents, 0);
    expect(last.cash).toBe(snap('checking') + snap('savings'));
    expect(last.net).toBe(last.cash + snap('credit_card'));
  });
});

describe('custom categories and uncategorized review', () => {
  it('lists uncategorized merchants, sorts one into a custom category, and undoes it on delete', async () => {
    await importFile(db, 'checking.qfx', CHECKING_EXAMPLE);
    const before = await uncategorizedMerchants(db);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ count: 1, total: 25000 });
    const merchant = before[0]!.merchant;

    const id = await addCategory(db, 'School & work', 'expense', false);
    await expect(addCategory(db, 'school & WORK', 'expense', false)).rejects.toBeInstanceOf(CategoryNameError);
    await setMerchantCategory(db, merchant, id);
    expect(await uncategorizedMerchants(db)).toEqual([]);
    expect((await rowsByMerchant(merchant))[0]!.category_name).toBe('School & work');
    await setBudget(db, id, 10000);

    await renameCategory(db, id, 'Work');
    expect((await rowsByMerchant(merchant))[0]!.category_name).toBe('Work');
    await expect(renameCategory(db, id, 'Dining')).rejects.toBeInstanceOf(CategoryNameError);

    await deleteCategory(db, id);
    expect((await rowsByMerchant(merchant))[0]!.category_id).toBe('uncategorized');
    expect(await listRules(db)).toEqual([]);
    expect(await listBudgets(db)).toEqual([]);
    await expect(deleteCategory(db, 'dining')).rejects.toThrow();
  });

  it('erase removes custom categories and restores built-in names', async () => {
    await addCategory(db, 'Hobbies', 'expense', false);
    await renameCategory(db, 'education', 'School & work');
    await eraseAllData(db);
    const cats = await listCategories(db);
    expect(cats.some((c) => c.is_custom)).toBe(false);
    expect(cats.find((c) => c.id === 'education')?.name).toBe('Education');
  });
});
