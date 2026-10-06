import { formatCents, type Cents } from '../../lib/money';

export function Money({
  cents,
  signed = false,
  dollars = false,
  className = '',
}: {
  cents: Cents;
  signed?: boolean;
  /** Whole dollars, no cents: for tight spaces like the dashboard tiles. */
  dollars?: boolean;
  className?: string;
}) {
  const tone = cents > 0 ? 'money-in' : 'money-out';
  return <span className={`money ${tone} ${className}`.trim()}>{formatCents(cents, { signed, dollars })}</span>;
}
