import { mulberry32 } from './fake';
import { centsToDecimal, parseAmountToCents } from './money';

/**
 * Redacts a real QFX file so it can be shared for debugging (README section 12).
 * The report contains counts and tag names only, never values from the input.
 */

export interface RedactOptions {
  scrubNames?: boolean;
  scrubAmounts?: boolean;
  seed?: number;
}

export interface RedactReport {
  accountIdsMasked: number;
  accountIdOccurrencesReplaced: number;
  userIdsReplaced: number;
  longDigitRunsMasked: number;
  namesScrubbed: number;
  amountsScrubbed: number;
  /** Digit runs of 9+ left outside allowed tags, by tag name. Empty means the check passed. */
  postCheckViolations: Record<string, number>;
  postCheckPassed: boolean;
}

export interface RedactResult {
  output: string;
  report: RedactReport;
}

/** Tags whose values may legitimately contain long digit runs (dates, routing number). */
const ALLOWED_DIGIT_TAGS = new Set([
  'DTSERVER',
  'DTSTART',
  'DTEND',
  'DTPOSTED',
  'DTUSER',
  'DTASOF',
  'DTAVAIL',
  'DTACCTUP',
  'DTPROFUP',
  'DTPRICEASOF',
  'BANKID',
]);

/** Matches `<TAG>value` leaves (value up to the next `<` or line break). */
const LEAF_RE = /<([A-Z0-9.]+)>([^<\r\n]*)/gi;

export function redactQfx(input: string, opts: RedactOptions = {}): RedactResult {
  const report: RedactReport = {
    accountIdsMasked: 0,
    accountIdOccurrencesReplaced: 0,
    userIdsReplaced: 0,
    longDigitRunsMasked: 0,
    namesScrubbed: 0,
    amountsScrubbed: 0,
    postCheckViolations: {},
    postCheckPassed: true,
  };

  let text = input;

  // 1. Mask every unmasked ACCTID everywhere it appears (FITIDs, memos, ...).
  const acctIds = new Set<string>();
  for (const m of text.matchAll(/<ACCTID>([^<\r\n]+)/gi)) {
    const v = (m[1] ?? '').trim();
    if (/^\d{5,}$/.test(v)) acctIds.add(v);
  }
  for (const id of [...acctIds].sort((a, b) => b.length - a.length)) {
    const masked = 'X'.repeat(id.length - 4) + id.slice(-4);
    const parts = text.split(id);
    report.accountIdOccurrencesReplaced += parts.length - 1;
    text = parts.join(masked);
    report.accountIdsMasked++;
  }

  // 2. User id.
  text = text.replace(/<INTU\.USERID>[^<\r\n]*/gi, () => {
    report.userIdsReplaced++;
    return '<INTU.USERID>REDACTED';
  });

  // 3. Leaf-level transforms: long digit runs, names, amounts.
  const nameMap = new Map<string, number>();
  const factor = 0.5 + mulberry32(opts.seed ?? 1)();
  text = text.replace(LEAF_RE, (whole, rawTag: string, value: string) => {
    const tag = rawTag.toUpperCase();
    if (ALLOWED_DIGIT_TAGS.has(tag)) return whole;

    if (opts.scrubNames && (tag === 'NAME' || tag === 'MEMO')) {
      const key = value.trim();
      if (!nameMap.has(key)) nameMap.set(key, nameMap.size + 1);
      report.namesScrubbed++;
      return `<${rawTag}>MERCHANT ${nameMap.get(key)}`;
    }
    if (opts.scrubAmounts && (tag === 'TRNAMT' || tag === 'BALAMT')) {
      try {
        const cents = parseAmountToCents(value);
        report.amountsScrubbed++;
        return `<${rawTag}>${centsToDecimal(Math.round(cents * factor))}`;
      } catch {
        return whole;
      }
    }

    const masked = value.replace(/\d{12,}/g, (run) => {
      report.longDigitRunsMasked++;
      // FITIDs must stay unique for dedupe, so they get a short hash instead of X's.
      return tag === 'FITID' ? 'H' + fnv1aHex(run) : 'X'.repeat(run.length - 4) + run.slice(-4);
    });
    return `<${rawTag}>${masked}`;
  });

  // 4. Post-check: no 9+ digit run may remain outside allowed tags.
  for (const m of text.matchAll(LEAF_RE)) {
    const tag = (m[1] ?? '').toUpperCase();
    if (ALLOWED_DIGIT_TAGS.has(tag)) continue;
    if (/\d{9,}/.test(m[2] ?? '')) {
      report.postCheckViolations[tag] = (report.postCheckViolations[tag] ?? 0) + 1;
    }
  }
  report.postCheckPassed = Object.keys(report.postCheckViolations).length === 0;

  return { output: text, report };
}

/** Count digit runs of at least `minLength` (used to verify redaction and storage). */
export function countUnmaskedDigitRuns(text: string, minLength = 12): number {
  return [...text.matchAll(new RegExp(`\\d{${minLength},}`, 'g'))].length;
}

/** 32-bit FNV-1a, hex with a letter alphabet so it never forms a digit run. */
function fnv1aHex(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h
    .toString(16)
    .padStart(8, '0')
    .replace(/\d/g, (d) => 'GHIJKLMNOP'[Number(d)] ?? d);
}
