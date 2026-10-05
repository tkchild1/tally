import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/client';
import { importFile, importFiles } from '../src/db/importer';
import { reclassifyAll } from '../src/db/reclassify';
import {
  balanceInputs,
  deleteRule,
  listRules,
  listSpendCharges,
  listTransactions,
  listTransferHints,
  markHintAsTransfer,
  monthlyTotals,
  setTransactionCategory,
  setTransactionFlow,
} from '../src/db/repo';
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
      expect(m.income - payroll).toBeGreaterThanOrEqual(0);
      expect(m.income - payroll).toBeLessThan(1_000);
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
