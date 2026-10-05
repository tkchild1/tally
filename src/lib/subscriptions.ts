import { NOT_AUTO_SUBSCRIPTION, type Flow } from './categories';
import { addDays, addMonths, daysBetween, type ISODate } from './dates';
import type { Cents } from './money';

/**
 * Recurring-charge detection (README 9.5). Pure. A merchant is a subscription when its
 * charges repeat on a recognizable cadence with a stable amount. Variable bills
 * (electricity) and habits (weekly coffee) are deliberately not flagged.
 */

export type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
export type MerchantFlag = 'confirmed' | 'dismissed';

export interface SubscriptionTxn {
  merchant: string;
  postedOn: ISODate;
  amountCents: Cents;
  flow: Flow;
  categoryId: string;
}

export interface Subscription {
  merchant: string;
  categoryId: string;
  cadence: Cadence;
  /** Positive cents: the median charge. */
  typicalCents: Cents;
  monthlyCents: Cents;
  yearlyCents: Cents;
  lastCharged: ISODate;
  nextExpected: ISODate;
  charges: number;
  active: boolean;
  confirmed: boolean;
  priceChange: { previousCents: Cents; latestCents: Cents } | null;
}

interface CadenceSpec {
  cadence: Cadence;
  minGap: number;
  maxGap: number;
  minCharges: number;
  perYear: number;
  periodDays: number;
  months: number | null;
}

const CADENCES: readonly CadenceSpec[] = [
  { cadence: 'weekly', minGap: 6, maxGap: 8, minCharges: 4, perYear: 52, periodDays: 7, months: null },
  { cadence: 'biweekly', minGap: 13, maxGap: 16, minCharges: 4, perYear: 26, periodDays: 14, months: null },
  { cadence: 'monthly', minGap: 27, maxGap: 35, minCharges: 3, perYear: 12, periodDays: 30, months: 1 },
  { cadence: 'quarterly', minGap: 84, maxGap: 98, minCharges: 3, perYear: 4, periodDays: 91, months: 3 },
  { cadence: 'yearly', minGap: 350, maxGap: 380, minCharges: 2, perYear: 1, periodDays: 365, months: 12 },
];

const MIN_SHARE = 0.75;

export function detectSubscriptions(
  txns: readonly SubscriptionTxn[],
  today: ISODate,
  flags: ReadonlyMap<string, MerchantFlag>,
): Subscription[] {
  const byMerchant = new Map<string, SubscriptionTxn[]>();
  for (const t of txns) {
    if (t.flow !== 'spend' || t.amountCents >= 0) continue;
    const list = byMerchant.get(t.merchant);
    if (list) list.push(t);
    else byMerchant.set(t.merchant, [t]);
  }

  const subs: Subscription[] = [];
  for (const [merchant, list] of byMerchant) {
    const flag = flags.get(merchant);
    if (flag === 'dismissed') continue;
    const sub = analyze(merchant, list, today, flag === 'confirmed');
    if (sub) subs.push(sub);
  }
  return subs.sort((a, b) => b.monthlyCents - a.monthlyCents || (a.merchant < b.merchant ? -1 : 1));
}

function analyze(merchant: string, list: SubscriptionTxn[], today: ISODate, confirmed: boolean): Subscription | null {
  // One charge per calendar day (same-day charges are summed).
  const perDay = new Map<ISODate, Cents>();
  for (const t of list) perDay.set(t.postedOn, (perDay.get(t.postedOn) ?? 0) - t.amountCents);
  const charges = [...perDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  if (charges.length < 2) return null;

  const latestTxn = list.reduce((a, b) => (b.postedOn > a.postedOn ? b : a));
  const categoryId = latestTxn.categoryId;
  if (!confirmed && NOT_AUTO_SUBSCRIPTION.has(categoryId)) return null;

  const gaps = charges.slice(1).map(([d], i) => daysBetween(charges[i]![0], d));
  const medianGap = median(gaps);
  const spec = CADENCES.find((c) => medianGap >= c.minGap && medianGap <= c.maxGap);
  if (!spec) return null;
  if (share(gaps, (g) => g >= spec.minGap && g <= spec.maxGap) < MIN_SHARE) return null;
  if (charges.length < (confirmed ? 2 : spec.minCharges)) return null;

  const amounts = charges.map(([, c]) => c);
  const typical = Math.round(median(amounts));
  const tolerance = Math.max(typical * 0.1, 100);
  if (share(amounts, (a) => Math.abs(a - typical) <= tolerance) < MIN_SHARE) return null;

  const [lastCharged, latestCents] = charges[charges.length - 1]!;
  const previousCents = charges[charges.length - 2]![1];
  const priceChanged = Math.abs(latestCents - previousCents) > Math.max(previousCents * 0.02, 50);

  return {
    merchant,
    categoryId,
    cadence: spec.cadence,
    typicalCents: typical,
    monthlyCents: Math.round((typical * spec.perYear) / 12),
    yearlyCents: typical * spec.perYear,
    lastCharged,
    nextExpected: nextExpected(charges.map(([d]) => d), spec),
    charges: charges.length,
    active: daysBetween(lastCharged, today) <= 1.5 * spec.periodDays,
    confirmed,
    priceChange: priceChanged ? { previousCents, latestCents } : null,
  };
}

/**
 * Calendar-month cadences use month math with end-of-month clamping (Jan 31 -> Feb 28).
 * When the last charge was clamped to a month end, the billing day is recovered from
 * the previous charges, so Feb 28 is followed by Mar 31 rather than Mar 28.
 */
function nextExpected(dates: ISODate[], spec: CadenceSpec): ISODate {
  const last = dates[dates.length - 1]!;
  if (spec.months === null) return addDays(last, spec.periodDays);

  let anchor = last;
  const isMonthEnd = addDays(last, 1).slice(8, 10) === '01';
  if (isMonthEnd) {
    for (const d of dates.slice(-3)) if (d.slice(8, 10) > anchor.slice(8, 10)) anchor = d;
  }
  let k = 1;
  let next = addMonths(anchor, spec.months);
  while (next <= last) next = addMonths(anchor, spec.months * ++k);
  return next;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function share<T>(xs: T[], pred: (x: T) => boolean): number {
  return xs.filter(pred).length / xs.length;
}
