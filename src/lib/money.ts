/** Money is always integer cents. Out is negative, in is positive. */
export type Cents = number;

const AMOUNT_RE = /^([+-])?(\d+)(?:\.(\d*))?$|^([+-])?\.(\d+)$/;

/**
 * Parse a decimal amount string ("585.07", "-8.65", "1,234.5") into integer cents
 * using string math only, so no floating-point rounding is involved.
 * Digits beyond the second decimal place must be zero; otherwise it throws.
 */
export function parseAmountToCents(input: string): Cents {
  const s = input.trim().replace(/,/g, '');
  const m = AMOUNT_RE.exec(s);
  if (!m) throw new Error('Invalid amount format');
  const sign = (m[1] ?? m[4]) === '-' ? -1 : 1;
  const whole = m[2] ?? '0';
  const frac = m[3] ?? m[5] ?? '';
  if (frac.length > 2 && /[1-9]/.test(frac.slice(2))) {
    throw new Error('Amount has sub-cent precision');
  }
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents)) throw new Error('Amount out of range');
  return cents === 0 ? 0 : sign * cents;
}

/** Integer cents to a plain decimal string ("-8.65"). Used for exports, not display. */
export function centsToDecimal(cents: Cents): string {
  assertCents(cents);
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

const MINUS = '\u2212';

/**
 * Display format: "$1,234.56", with a real minus sign (U+2212) for negatives.
 * `dollars` rounds to the nearest whole dollar and drops the cents ("$1,235").
 */
export function formatCents(cents: Cents, opts: { signed?: boolean; dollars?: boolean } = {}): string {
  assertCents(cents);
  const abs = Math.abs(cents);
  const wholeDollars = opts.dollars ? Math.round(abs / 100) : Math.floor(abs / 100);
  const whole = wholeDollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = cents < 0 && (!opts.dollars || wholeDollars > 0) ? MINUS : opts.signed && cents > 0 ? '+' : '';
  if (opts.dollars) return `${sign}$${whole}`;
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}$${whole}.${frac}`;
}

function assertCents(cents: number): void {
  if (!Number.isSafeInteger(cents)) throw new Error('Cents must be a safe integer');
}
