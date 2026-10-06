import { describe, expect, it } from 'vitest';
import { addDays, addMonths } from '../src/lib/dates';
import { detectSubscriptions, type MerchantFlag, type SubscriptionTxn } from '../src/lib/subscriptions';

function charge(merchant: string, postedOn: string, amountCents: number, categoryId = 'subscriptions'): SubscriptionTxn {
  return { merchant, postedOn, amountCents, flow: 'spend', categoryId };
}

function monthly(merchant: string, first: string, n: number, amounts: number | number[], categoryId?: string) {
  return Array.from({ length: n }, (_, i) =>
    charge(merchant, addMonths(first, i), -(Array.isArray(amounts) ? amounts[i]! : amounts), categoryId),
  );
}

const none = new Map<string, MerchantFlag>();

describe('detectSubscriptions', () => {
  it('detects a stable monthly charge with costs and next date (month-end clamping)', () => {
    const txns = monthly('NETFLIX.COM', '2025-10-31', 4, 1549);
    expect(txns.map((t) => t.postedOn)).toEqual(['2025-10-31', '2025-11-30', '2025-12-31', '2026-01-31']);
    const [sub, ...rest] = detectSubscriptions(txns, '2026-02-10', none);
    expect(rest).toEqual([]);
    expect(sub).toMatchObject({
      merchant: 'NETFLIX.COM',
      cadence: 'monthly',
      typicalCents: 1549,
      currentCents: 1549,
      monthlyCents: 1549,
      yearlyCents: 18588,
      lastCharged: '2026-01-31',
      nextExpected: '2026-02-28',
      charges: 4,
      active: true,
      priceChange: null,
    });
  });

  it('recovers the billing day after a clamped month end (Feb 28 -> Mar 31)', () => {
    const txns = [charge('X', '2025-12-31', -999), charge('X', '2026-01-31', -999), charge('X', '2026-02-28', -999)];
    expect(detectSubscriptions(txns, '2026-03-01', none)[0]!.nextExpected).toBe('2026-03-31');
  });

  it('does not flag a variable electricity bill', () => {
    const txns = monthly('ROCKY MOUNTAIN POWER', '2025-06-15', 7, [4500, 6200, 13800, 12100, 7400, 5200, 9900], 'utilities');
    expect(detectSubscriptions(txns, '2026-01-01', none)).toEqual([]);
  });

  it('does not flag a weekly coffee habit until the user confirms it', () => {
    const txns = Array.from({ length: 10 }, (_, i) => charge('BEAN THERE', addDays('2025-11-04', 7 * i), -525, 'dining'));
    expect(detectSubscriptions(txns, '2026-01-10', none)).toEqual([]);
    const subs = detectSubscriptions(txns, '2026-01-10', new Map([['BEAN THERE', 'confirmed' as const]]));
    expect(subs[0]).toMatchObject({ cadence: 'weekly', monthlyCents: 2275, confirmed: true });
  });

  it('confirmation relaxes the minimum charge count but not the cadence', () => {
    const two = monthly('NEW APP', '2025-12-05', 2, 499);
    expect(detectSubscriptions(two, '2026-01-10', none)).toEqual([]);
    expect(detectSubscriptions(two, '2026-01-10', new Map([['NEW APP', 'confirmed' as const]]))).toHaveLength(1);
    const irregular = [charge('ODD', '2025-12-01', -499), charge('ODD', '2025-12-20', -499)];
    expect(detectSubscriptions(irregular, '2026-01-10', new Map([['ODD', 'confirmed' as const]]))).toEqual([]);
  });

  it('hides dismissed merchants', () => {
    const txns = monthly('NETFLIX.COM', '2025-10-07', 4, 1549);
    expect(detectSubscriptions(txns, '2026-02-01', new Map([['NETFLIX.COM', 'dismissed' as const]]))).toEqual([]);
  });

  it('detects two yearly charges 365 days apart', () => {
    const txns = [charge('AMAZON PRIME', '2025-03-14', -13900), charge('AMAZON PRIME', '2026-03-14', -13900)];
    const sub = detectSubscriptions(txns, '2026-04-01', none)[0]!;
    expect(sub).toMatchObject({ cadence: 'yearly', monthlyCents: 1158, yearlyCents: 13900, nextExpected: '2027-03-14' });
  });

  it('flags a price change between the last two charges', () => {
    const txns = monthly('HULU', '2025-09-20', 4, [1799, 1799, 1799, 1899]);
    expect(detectSubscriptions(txns, '2026-01-01', none)[0]!.priceChange).toEqual({ previousCents: 1799, latestCents: 1899 });
  });

  it('costs a subscription at its latest price, not the median', () => {
    const txns = monthly('HULU', '2025-09-20', 4, [1799, 1799, 1799, 1899]);
    expect(detectSubscriptions(txns, '2026-01-01', none)[0]).toMatchObject({
      typicalCents: 1799,
      currentCents: 1899,
      monthlyCents: 1899,
      yearlyCents: 22788,
    });
  });

  it('marks a subscription lapsed when the last charge is too old', () => {
    const txns = monthly('OLD GYM', '2025-01-03', 4, 2499);
    const sub = detectSubscriptions(txns, '2026-01-01', none)[0]!;
    expect(sub.active).toBe(false);
  });

  it('ignores transfers, income, and refunds; sorts by monthly cost', () => {
    const txns = [
      ...monthly('SPOTIFY USA', '2025-10-12', 4, 1199),
      ...monthly('NETFLIX.COM', '2025-10-07', 4, 1549),
      ...monthly('CARD PAYMENT', '2025-10-22', 4, 50000).map((t) => ({ ...t, flow: 'transfer' as const })),
      charge('SPOTIFY USA', '2025-12-15', 1199),
    ];
    expect(detectSubscriptions(txns, '2026-01-20', none).map((s) => s.merchant)).toEqual(['NETFLIX.COM', 'SPOTIFY USA']);
  });
});
