import { addDays, daysBetween, type ISODate } from './dates';
import type { Cents } from './money';
import type { AccountKind } from './qfx';

/**
 * Balance history from snapshots (README 9.6). Banks give balance snapshots, not history,
 * so each day's balance is anchored on the nearest snapshot and walked backward or
 * forward by that account's transactions. Exact only when there are no coverage gaps.
 * The series runs from the earliest transaction or snapshot to the latest snapshot.
 */

export interface BalanceAccount {
  id: string;
  kind: AccountKind;
}
export interface BalanceTxn {
  accountId: string;
  postedOn: ISODate;
  amountCents: Cents;
}
export interface BalanceSnapshot {
  accountId: string;
  asOf: ISODate;
  balanceCents: Cents;
}
export interface BalancePoint {
  date: ISODate;
  /** Checking + savings. */
  cash: Cents;
  /** All accounts; card balances are negative (owed). */
  net: Cents;
}

export function balanceSeries(
  accounts: readonly BalanceAccount[],
  txns: readonly BalanceTxn[],
  snapshots: readonly BalanceSnapshot[],
): BalancePoint[] {
  if (snapshots.length === 0) return [];
  const withSnapshots = accounts.filter((a) => snapshots.some((s) => s.accountId === a.id));
  const relevantTxns = txns.filter((t) => withSnapshots.some((a) => a.id === t.accountId));

  const start = [...relevantTxns.map((t) => t.postedOn), ...snapshots.map((s) => s.asOf)].reduce((m, d) => (d < m ? d : m));
  const end = snapshots.reduce((m, s) => (s.asOf > m ? s.asOf : m), snapshots[0]!.asOf);
  if (start > end) return [];
  const days = daysBetween(start, end) + 1;

  // Per account: cumulative transaction sum through each day index (0 = start).
  const series = withSnapshots.map((a) => {
    const daily = new Array<number>(days).fill(0);
    for (const t of relevantTxns) {
      if (t.accountId !== a.id) continue;
      const i = daysBetween(start, t.postedOn);
      if (i >= 0 && i < days) daily[i]! += t.amountCents;
    }
    const cum = new Array<number>(days);
    let run = 0;
    for (let i = 0; i < days; i++) cum[i] = run += daily[i]!;
    const cumAt = (d: ISODate) => {
      const i = daysBetween(start, d);
      return i < 0 ? 0 : cum[Math.min(i, days - 1)]!;
    };
    const snaps = snapshots.filter((s) => s.accountId === a.id).sort((x, y) => (x.asOf < y.asOf ? -1 : 1));
    return { account: a, cumAt, snaps };
  });

  const points: BalancePoint[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    let cash = 0;
    let net = 0;
    for (const { account, cumAt, snaps } of series) {
      const anchor = nearestSnapshot(snaps, date);
      const balance = anchor.balanceCents + cumAt(date) - cumAt(anchor.asOf);
      net += balance;
      if (account.kind !== 'credit_card') cash += balance;
    }
    points.push({ date, cash, net });
  }
  return points;
}

/** Nearest by calendar distance; ties go to the later snapshot. `snaps` is sorted ascending. */
function nearestSnapshot(snaps: BalanceSnapshot[], date: ISODate): BalanceSnapshot {
  let best = snaps[0]!;
  let bestDist = Math.abs(daysBetween(best.asOf, date));
  for (const s of snaps.slice(1)) {
    const dist = Math.abs(daysBetween(s.asOf, date));
    if (dist <= bestDist) {
      best = s;
      bestDist = dist;
    }
  }
  return best;
}

export interface DateRange {
  start: ISODate;
  end: ISODate;
}

/**
 * Merge import ranges (README 9.7). Ranges that overlap or touch (next start at most one
 * day after the current end) merge. More than one merged range means a coverage gap.
 */
export function mergeCoverage(ranges: readonly DateRange[]): DateRange[] {
  const sorted = [...ranges].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const merged: DateRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && daysBetween(last.end, r.start) <= 1) {
      if (r.end > last.end) last.end = r.end;
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/** Missing stretches between merged ranges: the first and last uncovered day of each gap. */
export function coverageGaps(merged: readonly DateRange[]): DateRange[] {
  const gaps: DateRange[] = [];
  for (let i = 1; i < merged.length; i++) {
    gaps.push({ start: addDays(merged[i - 1]!.end, 1), end: addDays(merged[i]!.start, -1) });
  }
  return gaps;
}
