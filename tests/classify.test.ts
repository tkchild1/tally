import { describe, expect, it } from 'vitest';
import { classifyTransactions, type ClassifyAccount, type ClassifyTxn, type UserRule } from '../src/lib/classify';
import { normalizeMerchant } from '../src/lib/merchant';

const CHECKING: ClassifyAccount = { id: 'chk', kind: 'checking', last4: '5555' };
const SAVINGS: ClassifyAccount = { id: 'sav', kind: 'savings', last4: '7777' };
const CARD: ClassifyAccount = { id: 'card', kind: 'credit_card', last4: '1234' };

let nextId = 1;
function txn(accountId: string, postedOn: string, amountCents: number, rawName: string, extra: Partial<ClassifyTxn> = {}): ClassifyTxn {
  return {
    id: nextId++,
    accountId,
    postedOn,
    amountCents,
    rawName,
    rawMemo: null,
    merchant: normalizeMerchant(rawName, extra.rawMemo ?? null),
    flow: 'spend',
    categoryId: 'uncategorized',
    transferGroup: null,
    flowLocked: false,
    categoryLocked: false,
    ...extra,
  };
}

function byId(results: ReturnType<typeof classifyTransactions>) {
  return new Map(results.map((r) => [r.id, r]));
}

describe('transfers', () => {
  it('strong A: checking payment referencing the card last4 pairs with the card PAYMENT', () => {
    const pay = txn('chk', '2025-12-20', -25000, 'MOBILE PAYMENT TO XXXXX1234');
    const recv = txn('card', '2025-12-22', 25000, 'PAYMENT');
    const r = byId(classifyTransactions([pay, recv], [CHECKING, CARD], []));
    expect(r.get(pay.id)).toMatchObject({ flow: 'transfer', categoryId: 'transfer', transferHint: null });
    expect(r.get(recv.id)).toMatchObject({ flow: 'transfer', categoryId: 'transfer' });
    expect(r.get(pay.id)!.transferGroup).not.toBeNull();
    expect(r.get(pay.id)!.transferGroup).toBe(r.get(recv.id)!.transferGroup);
  });

  it('strong B: a card-side PAYMENT with no checking counterpart is still a transfer', () => {
    const recv = txn('card', '2025-12-22', 25000, 'PAYMENT');
    const r = byId(classifyTransactions([recv], [CARD], []));
    expect(r.get(recv.id)).toMatchObject({ flow: 'transfer', transferGroup: null });
  });

  it('a card refund is spend (positive), not a transfer or income', () => {
    const refund = txn('card', '2025-12-22', 1500, 'AMZN Mktp US Refund');
    const reversal = txn('card', '2025-12-23', 900, 'PAYMENT REVERSAL ADJUSTMENT');
    const r = byId(classifyTransactions([refund, reversal], [CARD], []));
    expect(r.get(refund.id)).toMatchObject({ flow: 'spend', categoryId: 'shopping' });
    expect(r.get(reversal.id)!.flow).toBe('spend');
  });

  it('checking-only import leaves the payment as spend with a hint; importing the card flips it', () => {
    const pay = txn('chk', '2025-12-20', -25000, 'MOBILE PAYMENT TO XXXXX1234');
    const before = byId(classifyTransactions([pay], [CHECKING], []));
    expect(before.get(pay.id)).toMatchObject({ flow: 'spend', transferHint: '1234' });

    const recv = txn('card', '2025-12-22', 25000, 'PAYMENT');
    const after = byId(classifyTransactions([pay, recv], [CHECKING, CARD], []));
    expect(after.get(pay.id)).toMatchObject({ flow: 'transfer', transferHint: null });
  });

  it('ignores a masked reference to the account itself', () => {
    const t = txn('chk', '2025-12-20', -1200, 'DEBIT CARD PAYMENT XXXXX5555 SMITHS FOOD');
    const r = byId(classifyTransactions([t], [CHECKING, CARD], []));
    expect(r.get(t.id)).toMatchObject({ flow: 'spend', transferHint: null });
  });

  it('weak pair: opposite amounts in different accounts 2 days apart are transfers', () => {
    const out = txn('chk', '2025-12-01', -20000, 'ONLINE TRANSFER TO SAVINGS');
    const into = txn('sav', '2025-12-03', 20000, 'ONLINE TRANSFER FROM CHECKING');
    const r = byId(classifyTransactions([out, into], [CHECKING, SAVINGS], []));
    expect(r.get(out.id)!.flow).toBe('transfer');
    expect(r.get(into.id)!.flow).toBe('transfer');
    expect(r.get(out.id)!.transferGroup).toBe(r.get(into.id)!.transferGroup);
  });

  it('weak pair: 9 days apart is not a transfer', () => {
    const out = txn('chk', '2025-12-01', -20000, 'ONLINE TRANSFER TO SAVINGS');
    const into = txn('sav', '2025-12-10', 20000, 'ONLINE TRANSFER FROM CHECKING');
    const r = byId(classifyTransactions([out, into], [CHECKING, SAVINGS], []));
    expect(r.get(out.id)!.flow).toBe('spend');
    expect(r.get(into.id)!.flow).toBe('income');
  });

  it('weak pairing: nearest date wins and each row pairs once', () => {
    const out = txn('chk', '2025-12-05', -20000, 'ONLINE TRANSFER TO SAVINGS');
    const far = txn('sav', '2025-12-01', 20000, 'ONLINE TRANSFER FROM CHECKING');
    const near = txn('sav', '2025-12-06', 20000, 'ONLINE TRANSFER FROM CHECKING');
    const r = byId(classifyTransactions([out, far, near], [CHECKING, SAVINGS], []));
    expect(r.get(out.id)!.transferGroup).toBe(r.get(near.id)!.transferGroup);
    expect(r.get(far.id)).toMatchObject({ flow: 'income', transferGroup: null });
  });

  it('weak candidates in the same account never pair', () => {
    const a = txn('chk', '2025-12-01', -20000, 'ONLINE TRANSFER TO X');
    const b = txn('chk', '2025-12-02', 20000, 'ONLINE TRANSFER FROM X');
    const r = byId(classifyTransactions([a, b], [CHECKING], []));
    expect(r.get(a.id)!.flow).toBe('spend');
  });
});

describe('flow and income', () => {
  it('payroll is income_paycheck even when the employer is a university', () => {
    const pay = txn('chk', '2025-12-19', 120000, 'STATE UNIVERSITY PAYROLL ACH CREDIT');
    const r = byId(classifyTransactions([pay], [CHECKING], []));
    expect(r.get(pay.id)).toMatchObject({ flow: 'income', categoryId: 'income_paycheck' });
  });
  it('university tuition paid is education spending', () => {
    const t = txn('chk', '2025-12-19', -150000, 'STATE UNIVERSITY TUITION');
    expect(classifyTransactions([t], [CHECKING], [])[0]).toMatchObject({ flow: 'spend', categoryId: 'education' });
  });
  it('other positive amounts on checking fall back to income_other', () => {
    const t = txn('chk', '2025-12-19', 4000, 'MOBILE DEPOSIT');
    expect(classifyTransactions([t], [CHECKING], [])[0]).toMatchObject({ flow: 'income', categoryId: 'income_other' });
  });
  it('unknown spending is uncategorized', () => {
    const t = txn('card', '2025-12-19', -4000, 'ZZQ HOLDINGS OREM UT');
    expect(classifyTransactions([t], [CARD], [])[0]).toMatchObject({ flow: 'spend', categoryId: 'uncategorized' });
  });
  it.each([
    ['DAIRY QUEEN #12345 OREM UT', 'dining'],
    ['SQ *SOMEPLACE ICE CREAM PROVO UT', 'dining'],
    ['NORTHSIDE CREAMERY LEHI UT', 'dining'],
    ['TST* SOMEPLACE KITCHEN PROVO UT', 'dining'],
    ['SOMEPLACE POKE BOWL OREM UT', 'dining'],
    ["SMITH'S FUEL #4000 OREM UT", 'transport'],
    ['COSTCO GAS #0001 OREM UT', 'transport'],
    ['COSTCO WHSE #0001 OREM UT', 'groceries'],
    ['DOLLAR TREE OREM UT', 'shopping'],
    ['SOMETOWN SCHOOL DISTRICT FEES', 'education'],
  ])('default rules: %s is %s', (raw, categoryId) => {
    const t = txn('card', '2025-12-19', -1500, raw);
    expect(classifyTransactions([t], [CARD], [])[0]!.categoryId).toBe(categoryId);
  });
  it('default rules: UBER EATS is dining, UBER is transport', () => {
    const eats = txn('card', '2025-12-19', -2500, 'UBER EATS HELP.UBER.COM CA');
    const ride = txn('card', '2025-12-19', -1800, 'UBER TRIP HELP.UBER.COM CA');
    const r = byId(classifyTransactions([eats, ride], [CARD], []));
    expect(r.get(eats.id)!.categoryId).toBe('dining');
    expect(r.get(ride.id)!.categoryId).toBe('transport');
  });
});

describe('user edits and rules', () => {
  it('rows with both flow and category locked are skipped', () => {
    const t = txn('chk', '2025-12-20', -25000, 'MOBILE PAYMENT TO XXXXX1234', {
      flow: 'spend',
      categoryId: 'housing',
      flowLocked: true,
      categoryLocked: true,
    });
    expect(classifyTransactions([t], [CHECKING, CARD], [])).toEqual([]);
  });

  it('a locked flow is kept; its category is still computed', () => {
    const t = txn('chk', '2025-12-20', -25000, 'MOBILE PAYMENT TO XXXXX1234', { flow: 'spend', flowLocked: true });
    const r = classifyTransactions([t], [CHECKING, CARD], [])[0]!;
    expect(r.flow).toBe('spend');
    expect(r.categoryId).toBe('uncategorized');
  });

  it('a user-set transfer flow gets the transfer category', () => {
    const t = txn('chk', '2025-12-20', -5000, 'ZELLE TO ROOMMATE', { flow: 'transfer', flowLocked: true });
    expect(classifyTransactions([t], [CHECKING], [])[0]).toMatchObject({ flow: 'transfer', categoryId: 'transfer' });
  });

  it('a locked category is kept', () => {
    const t = txn('card', '2025-12-20', -1549, 'NETFLIX.COM LOS GATOS CA', { categoryId: 'entertainment', categoryLocked: true });
    expect(classifyTransactions([t], [CARD], [])[0]!.categoryId).toBe('entertainment');
  });

  it('a user rule beats a default rule', () => {
    const t = txn('card', '2025-12-20', -1549, 'NETFLIX.COM LOS GATOS CA');
    const rules: UserRule[] = [{ matchType: 'equals', pattern: 'NETFLIX.COM', categoryId: 'entertainment' }];
    expect(classifyTransactions([t], [CARD], rules)[0]!.categoryId).toBe('entertainment');
  });

  it('equals beats contains, and longer contains patterns go first', () => {
    const t = txn('card', '2025-12-20', -900, 'SQ *SOME CAFE Provo UT');
    const rules: UserRule[] = [
      { matchType: 'contains', pattern: 'CAFE', categoryId: 'shopping' },
      { matchType: 'contains', pattern: 'SOME CAFE', categoryId: 'entertainment' },
      { matchType: 'equals', pattern: 'SOME CAFE', categoryId: 'health' },
    ];
    expect(classifyTransactions([t], [CARD], rules)[0]!.categoryId).toBe('health');
    expect(classifyTransactions([t], [CARD], rules.slice(0, 2))[0]!.categoryId).toBe('entertainment');
  });

  it('is idempotent: re-running on its own output gives identical results', () => {
    const txns = [
      txn('chk', '2025-12-20', -25000, 'MOBILE PAYMENT TO XXXXX1234'),
      txn('card', '2025-12-22', 25000, 'PAYMENT'),
      txn('chk', '2025-12-01', -20000, 'ONLINE TRANSFER TO SAVINGS'),
      txn('sav', '2025-12-03', 20000, 'ONLINE TRANSFER FROM CHECKING'),
      txn('card', '2025-12-05', -865, 'SQ *SOME CAFE Provo UT'),
      txn('chk', '2025-12-19', 235000, 'ACME CORP PAYROLL ACH CRE'),
    ];
    const accounts = [CHECKING, SAVINGS, CARD];
    const first = classifyTransactions(txns, accounts, []);
    const applied = txns.map((t) => {
      const r = first.find((x) => x.id === t.id)!;
      return { ...t, flow: r.flow, categoryId: r.categoryId, transferGroup: r.transferGroup };
    });
    expect(classifyTransactions(applied, accounts, [])).toEqual(first);
    expect(classifyTransactions([...txns].reverse(), accounts, [])).toEqual(first);
  });
});
