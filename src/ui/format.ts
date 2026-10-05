import type { ISODate } from '../lib/dates';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-01-05" -> "Jan 5, 2026" (no Date objects, so no timezone shifts). */
export function formatDate(d: ISODate | null | undefined): string {
  if (!d) return '—';
  const month = MONTHS[Number(d.slice(5, 7)) - 1] ?? '';
  return `${month} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
}

/** "2026-01-05" -> "Jan 5". */
export function formatDateShort(d: ISODate): string {
  const month = MONTHS[Number(d.slice(5, 7)) - 1] ?? '';
  return `${month} ${Number(d.slice(8, 10))}`;
}

export function formatRange(start: ISODate | null, end: ISODate | null): string {
  if (!start && !end) return 'unknown range';
  return `${formatDate(start)} – ${formatDate(end)}`;
}

export function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}
