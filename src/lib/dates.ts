/**
 * Calendar dates as "YYYY-MM-DD" strings. Never timestamps: bank exports fake the time
 * of day, and timezone conversion would move transactions to the wrong day.
 * All arithmetic happens in UTC on the calendar date.
 */
export type ISODate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isISODate(s: string): s is ISODate {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function toUTCms(d: ISODate): number {
  if (!isISODate(d)) throw new Error('Invalid ISO date');
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
}

function fromUTCms(ms: number): ISODate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** b - a in whole days. */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toUTCms(b) - toUTCms(a)) / DAY_MS);
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromUTCms(toUTCms(d) + n * DAY_MS);
}

/** Calendar-month math with end-of-month clamping (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(d: ISODate, n: number): ISODate {
  if (!isISODate(d)) throw new Error('Invalid ISO date');
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7)) - 1;
  const day = Number(d.slice(8, 10));
  const target = new Date(Date.UTC(y, m + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fromUTCms(target.getTime());
}

/**
 * OFX dates look like "20251226120000.000[-5:EST]". Keep only the first 8 digits
 * so the calendar day is exactly what the bank wrote, regardless of time or zone.
 */
export function parseOfxDate(raw: string): ISODate {
  const m = /^\s*(\d{4})(\d{2})(\d{2})/.exec(raw);
  if (!m) throw new Error('Invalid OFX date');
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  if (!isISODate(iso)) throw new Error('Invalid OFX date');
  return iso;
}

/** Today's calendar date in the user's local timezone (what "today" means to a person). */
export function todayISO(now: Date = new Date()): ISODate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** "2026-01" for a date. */
export function monthOf(d: ISODate): string {
  return d.slice(0, 7);
}

/** A period is either a month ("2026-01") or a whole calendar year ("2026"). */
export function isYearPeriod(period: string): boolean {
  return /^\d{4}$/.test(period);
}

/** First day of the period and the first day after it. */
export function periodBounds(period: string): { start: ISODate; end: ISODate } {
  if (isYearPeriod(period)) {
    return { start: `${period}-01-01`, end: `${Number(period) + 1}-01-01` };
  }
  const start = `${period}-01`;
  return { start, end: addMonths(start, 1) };
}

/** Whether a "YYYY-MM" month falls inside the period. */
export function monthInPeriod(month: string, period: string): boolean {
  return isYearPeriod(period) ? month.slice(0, 4) === period : month === period;
}

export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
