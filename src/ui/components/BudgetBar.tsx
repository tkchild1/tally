import type { BudgetProgress } from '../../lib/budgets';
import { formatCents } from '../../lib/money';

const STATUS_LABEL = { under: 'On track', near: 'Almost at limit', over: 'Over budget' } as const;

/**
 * One budget's progress. The bar is decorative; the text carries the same information
 * (status words, not just color). `pace` (0..1) marks how much of the period (a month or a year) has passed.
 */
export function BudgetBar({ row, pace, unit = 'month' }: { row: BudgetProgress; pace: number | null; unit?: 'month' | 'year' }) {
  const fill = Math.min(1, Number.isFinite(row.ratio) ? row.ratio : 1);
  const ahead = pace !== null && pace > 0 && pace < 1 && row.status === 'under' && row.ratio > pace + 0.1;
  return (
    <div className="budget">
      <div className="budget-head">
        <span>{row.name}</span>
        <span className={`budget-status budget-${row.status}`}>{STATUS_LABEL[row.status]}</span>
      </div>
      <div className="budget-track" aria-hidden="true">
        <span className={`budget-fill budget-fill-${row.status}`} style={{ width: `${fill * 100}%` }} />
        {pace !== null && pace > 0 && pace < 1 && <span className="budget-pace" style={{ left: `${pace * 100}%` }} />}
      </div>
      <div className="small muted">
        {formatCents(row.spentCents)} of {formatCents(row.limitCents)} ·{' '}
        {row.remainingCents >= 0 ? `${formatCents(row.remainingCents)} left` : `over by ${formatCents(-row.remainingCents)}`}
        {ahead && ` · spending faster than the ${unit}`}
      </div>
    </div>
  );
}
