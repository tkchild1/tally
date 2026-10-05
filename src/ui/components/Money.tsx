import { formatCents, type Cents } from '../../lib/money';

export function Money({ cents, signed = false, className = '' }: { cents: Cents; signed?: boolean; className?: string }) {
  const tone = cents > 0 ? 'money-in' : 'money-out';
  return <span className={`money ${tone} ${className}`.trim()}>{formatCents(cents, { signed })}</span>;
}
