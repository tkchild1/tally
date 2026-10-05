/**
 * Heuristic merchant normalization (README 9.1). Deterministic, and errs toward keeping
 * text when unsure. Output is UPPERCASE and never empty.
 */

const US_STATES = new Set(
  (
    'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM ' +
    'NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR'
  ).split(' '),
);

/** Multi-word cities to drop as a unit after a trailing state code. Extend as needed. */
export const MULTI_WORD_CITIES: readonly string[] = [
  'SALT LAKE CITY',
  'WEST VALLEY CITY',
  'SOUTH JORDAN',
  'WEST JORDAN',
  'AMERICAN FORK',
  'PLEASANT GROVE',
  'SPANISH FORK',
  'CEDAR CITY',
  'PARK CITY',
  'ST GEORGE',
  'LOS GATOS',
  'LOS ANGELES',
  'SAN FRANCISCO',
  'SAN JOSE',
  'SAN DIEGO',
  'SANTA CLARA',
  'SANTA MONICA',
  'MOUNTAIN VIEW',
  'NEW YORK',
  'LAS VEGAS',
  'SALT LAKE CTY',
];

const LEADING_NOISE: RegExp[] = [
  /^(RECURRING )?(PURCHASE|PAYMENT) AUTHORIZED ON \d{1,2}\/\d{1,2}\s+/,
  /^(CHECKCARD|CHECK CARD)\s+(\d{4}\s+)?/,
  /^DEBIT CARD( PURCHASE)?\s+/,
  /^POS( DEBIT| PURCHASE)?\s+/,
  /^[X*]{2,}\d{2,6}\s+/,
  /^(SQ|TST|SP|PY|PP|PAYPAL|IC|DD|BT|WPY|EB|LS|SPO)\s?\*\s?/,
];

const TRAILING_NOISE: RegExp[] = [
  /\s+(EFT)?[X*]{2,}\d{2,6}\b.*$/,
  /EFT[X*]{2,}\d{2,6}\b.*$/,
  /\s+(PPD|CCD|WEB|TEL)\s?ID:?\s*\S+.*$/,
  /\s+ID:\s*\S+.*$/,
  /\s+ACH(\s+(CREDIT|DEBIT|CRE|DEB|CR|DR|PMT|PAYMENT))?$/,
  /\s*#\s*\d.*$/,
  /\s+\d{1,2}\/\d{1,2}(\/\d{2,4})?$/,
  /\s+\d{4,}$/,
  /[\s\-*,/]+$/,
];

const PHONE = /\s*\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b/g;
/** `*REF1234`-style suffixes glued to the merchant (must contain a digit). */
const STAR_REF = /\*[A-Z0-9]*\d[A-Z0-9]*\b/g;

export function normalizeMerchant(name: string, memo?: string | null): string {
  const n = clean(name);
  const m = memo ? clean(memo) : '';
  let s = m.length > n.length && m.startsWith(n) ? m : n;
  const fallback = s;

  s = repeatUntilStable(s, (x) => LEADING_NOISE.reduce((acc, re) => acc.replace(re, ''), x));

  if (/^AMZN MKTP|^AMAZON MKTPL?/.test(s)) return 'AMAZON MARKETPLACE';
  if (/^AMAZON PRIME\b/.test(s)) return 'AMAZON PRIME';
  if (/^(AMAZON\.COM|AMZN\.COM)\b/.test(s)) return 'AMAZON';

  // Online merchants put a phone number where the city would be ("HULU 877-555-0100 CA").
  const hadPhone = new RegExp(PHONE.source).test(s);
  s = s.replace(PHONE, ' ').replace(STAR_REF, ' ');
  s = clean(s);
  s = stripTrailing(s);
  s = stripCityState(s, !hadPhone);
  s = stripTrailing(s);

  return s === '' ? fallback || 'UNKNOWN' : s;
}

function stripTrailing(s: string): string {
  return repeatUntilStable(s, (x) => clean(TRAILING_NOISE.reduce((acc, re) => acc.replace(re, ''), x)));
}

/** Drop a trailing `CITY ST`, but only when a state code is present, and never down to zero tokens. */
function stripCityState(s: string, dropCity: boolean): string {
  const tokens = s.split(' ');
  const last = tokens[tokens.length - 1];
  if (tokens.length < 2 || last === undefined || !US_STATES.has(last)) return s;
  tokens.pop();
  if (!dropCity) return tokens.join(' ');

  const joined = tokens.join(' ');
  for (const city of MULTI_WORD_CITIES) {
    if (joined.endsWith(' ' + city)) {
      return joined.slice(0, joined.length - city.length - 1);
    }
  }
  const city = tokens[tokens.length - 1];
  if (tokens.length >= 2 && city !== undefined && /^[A-Z]+$/.test(city)) tokens.pop();
  return tokens.join(' ');
}

function clean(s: string): string {
  return s.toUpperCase().replace(/\s+/g, ' ').trim();
}

function repeatUntilStable(s: string, f: (x: string) => string): string {
  for (let i = 0; i < 10; i++) {
    const next = f(s);
    if (next === s) return s;
    s = next;
  }
  return s;
}

/** Display form: "SOME CAFE" -> "Some Cafe". Vowel-less tokens (CVS, TJ) stay uppercase. */
export function prettyMerchant(merchant: string): string {
  return merchant
    .split(' ')
    .map((t) => {
      if (!/[A-Z]/.test(t) || !/[AEIOUY]/.test(t)) return t;
      const lower = t.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}
