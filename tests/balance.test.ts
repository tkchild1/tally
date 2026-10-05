import { describe, expect, it } from 'vitest';
import { balanceSeries, coverageGaps, mergeCoverage } from '../src/lib/balance';

const CHK = { id: 'chk', kind: 'checking' as const };
const CARD = { id: 'card', kind: 'credit_card' as const };

describe('balanceSeries', () => {
  it('walks backward and forward from a snapshot (hand-computed)', () => {
    const txns = [
      { accountId: 'chk', postedOn: '2026-01-01', amountCents: 10000 },
      { accountId: 'chk', postedOn: '2026-01-03', amountCents: -2500 },
      { accountId: 'chk', postedOn: '2026-01-05', amountCents: -500 },
    ];
    // Snapshot on Jan 3 (after that day's txn): 50,000.
    const points = balanceSeries([CHK], txns, [{ accountId: 'chk', asOf: '2026-01-03', balanceCents: 50000 }]);
    expect(points.map((p) => [p.date, p.cash])).toEqual([
      ['2026-01-01', 52500],
      ['2026-01-02', 52500],
      ['2026-01-03', 50000],
    ]);
  });

  it('extends to the latest snapshot and continues forward', () => {
    const txns = [
      { accountId: 'chk', postedOn: '2026-01-01', amountCents: 10000 },
      { accountId: 'chk', postedOn: '2026-01-05', amountCents: -500 },
    ];
    const snaps = [
      { accountId: 'chk', asOf: '2026-01-02', balanceCents: 20000 },
      { accountId: 'card', asOf: '2026-01-06', balanceCents: -3000 },
    ];
    const card = [{ accountId: 'card', postedOn: '2026-01-04', amountCents: -1000 }];
    const points = balanceSeries([CHK, CARD], [...txns, ...card], snaps);
    expect(points[0]).toEqual({ date: '2026-01-01', cash: 20000, net: 20000 - 2000 });
    expect(points.at(-1)).toEqual({ date: '2026-01-06', cash: 19500, net: 19500 - 3000 });
  });

  it('uses the nearest snapshot as the anchor when there are several', () => {
    const txns = [{ accountId: 'chk', postedOn: '2026-01-02', amountCents: -1000 }];
    // Snapshots disagree with the txns (a coverage gap); each day trusts its nearest snapshot.
    const snaps = [
      { accountId: 'chk', asOf: '2026-01-01', balanceCents: 10000 },
      { accountId: 'chk', asOf: '2026-01-10', balanceCents: 50000 },
    ];
    const points = balanceSeries([CHK], txns, snaps);
    const at = (d: string) => points.find((p) => p.date === d)!.cash;
    expect(at('2026-01-01')).toBe(10000);
    expect(at('2026-01-02')).toBe(9000);
    expect(at('2026-01-06')).toBe(50000);
    expect(at('2026-01-10')).toBe(50000);
  });

  it('returns nothing without snapshots', () => {
    expect(balanceSeries([CHK], [{ accountId: 'chk', postedOn: '2026-01-01', amountCents: 1 }], [])).toEqual([]);
  });
});

describe('mergeCoverage', () => {
  it('merges overlapping and touching ranges', () => {
    expect(
      mergeCoverage([
        { start: '2026-02-01', end: '2026-03-03' },
        { start: '2026-01-01', end: '2026-02-10' },
        { start: '2026-03-04', end: '2026-03-31' },
      ]),
    ).toEqual([{ start: '2026-01-01', end: '2026-03-31' }]);
  });

  it('keeps a gap of 2+ days and reports the missing stretch', () => {
    const merged = mergeCoverage([
      { start: '2026-01-01', end: '2026-03-03' },
      { start: '2026-03-05', end: '2026-03-31' },
    ]);
    expect(merged).toHaveLength(2);
    expect(coverageGaps(merged)).toEqual([{ start: '2026-03-04', end: '2026-03-04' }]);
  });
});
