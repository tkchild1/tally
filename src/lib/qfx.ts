import { parseAmountToCents, type Cents } from './money';
import { parseOfxDate, type ISODate } from './dates';

/**
 * Tolerant OFX/QFX parser for both OFX 1.x SGML (leaf tags have no closing tag) and
 * OFX 2.x XML. Aggregates are located by tag name; leaves are read as `<TAG>value`
 * up to the next `<` or line break. A real XML parser would reject SGML input.
 *
 * Errors and warnings never include values from the file (account numbers, FITIDs,
 * descriptions, amounts); only counts and field names.
 */

export type AccountKind = 'checking' | 'savings' | 'credit_card';

export interface ParsedTransaction {
  fitid: string;
  postedOn: ISODate;
  amountCents: Cents;
  trnType: string | null;
  name: string;
  memo: string | null;
}

export interface ParsedStatement {
  kind: AccountKind;
  /** Raw account id from the file. May be a FULL card number: never store or log it. */
  acctId: string;
  bankId: string | null;
  currency: string | null;
  rangeStart: ISODate | null;
  rangeEnd: ISODate | null;
  ledgerBalance: { amountCents: Cents; asOf: ISODate } | null;
  transactions: ParsedTransaction[];
}

export interface QfxParseResult {
  statements: ParsedStatement[];
  warnings: string[];
}

export class QfxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QfxParseError';
  }
}

export function parseQfx(text: string): QfxParseResult {
  const ofxStart = text.search(/<OFX>/i);
  if (ofxStart < 0) throw new QfxParseError('Not an OFX/QFX file: no <OFX> element found');
  const body = text.slice(ofxStart);

  const warnings: string[] = [];
  const statements: ParsedStatement[] = [];

  for (const block of findBlocks(body, 'STMTRS')) {
    const stmt = parseStatement(block, false, warnings);
    if (stmt) statements.push(stmt);
  }
  for (const block of findBlocks(body, 'CCSTMTRS')) {
    const stmt = parseStatement(block, true, warnings);
    if (stmt) statements.push(stmt);
  }

  if (statements.length === 0) {
    throw new QfxParseError('No bank or credit card statements found in file');
  }
  return { statements, warnings };
}

function parseStatement(block: string, isCard: boolean, warnings: string[]): ParsedStatement | null {
  const acctBlock = findBlocks(block, isCard ? 'CCACCTFROM' : 'BANKACCTFROM')[0];
  const acctId = acctBlock ? readLeaf(acctBlock, 'ACCTID') : null;
  if (!acctBlock || !acctId) {
    warnings.push(`Skipped a statement with no ${isCard ? 'CCACCTFROM' : 'BANKACCTFROM'}/ACCTID`);
    return null;
  }

  let kind: AccountKind = 'credit_card';
  if (!isCard) {
    const acctType = (readLeaf(acctBlock, 'ACCTTYPE') ?? 'CHECKING').toUpperCase();
    kind = acctType === 'SAVINGS' ? 'savings' : 'checking';
  }

  const tranList = findBlocks(block, 'BANKTRANLIST')[0] ?? '';
  const txnBlocks = findBlocks(tranList, 'STMTTRN');
  const listHeader = tranList.split(/<STMTTRN>/i)[0] ?? '';

  const transactions: ParsedTransaction[] = [];
  const missing = new Map<string, number>();
  let badValues = 0;
  for (const tb of txnBlocks) {
    const fitid = readLeaf(tb, 'FITID');
    const posted = readLeaf(tb, 'DTPOSTED');
    const amt = readLeaf(tb, 'TRNAMT');
    const name = readLeaf(tb, 'NAME');
    const memo = readLeaf(tb, 'MEMO');
    const absent = [
      ['FITID', fitid],
      ['DTPOSTED', posted],
      ['TRNAMT', amt],
      ['NAME', name ?? memo],
    ].filter(([, v]) => !v);
    if (absent.length > 0) {
      for (const [field] of absent) missing.set(field as string, (missing.get(field as string) ?? 0) + 1);
      continue;
    }
    try {
      transactions.push({
        fitid: fitid!,
        postedOn: parseOfxDate(posted!),
        amountCents: parseAmountToCents(amt!),
        trnType: readLeaf(tb, 'TRNTYPE'),
        name: (name ?? memo)!,
        memo,
      });
    } catch {
      badValues++;
    }
  }
  for (const [field, n] of missing) {
    warnings.push(`Skipped ${n} transaction(s) missing ${field}`);
  }
  if (badValues > 0) warnings.push(`Skipped ${badValues} transaction(s) with an invalid date or amount`);

  return {
    kind,
    acctId,
    bankId: isCard ? null : readLeaf(acctBlock, 'BANKID'),
    currency: readLeaf(block, 'CURDEF'),
    rangeStart: safeDate(readLeaf(listHeader, 'DTSTART')),
    rangeEnd: safeDate(readLeaf(listHeader, 'DTEND')),
    ledgerBalance: readBalance(findBlocks(block, 'LEDGERBAL')[0], warnings),
    transactions,
  };
}

function readBalance(block: string | undefined, warnings: string[]): ParsedStatement['ledgerBalance'] {
  if (!block) return null;
  const amt = readLeaf(block, 'BALAMT');
  const asOf = readLeaf(block, 'DTASOF');
  if (!amt || !asOf) return null;
  try {
    return { amountCents: parseAmountToCents(amt), asOf: parseOfxDate(asOf) };
  } catch {
    warnings.push('Ignored LEDGERBAL with an invalid BALAMT or DTASOF');
    return null;
  }
}

function safeDate(raw: string | null): ISODate | null {
  if (!raw) return null;
  try {
    return parseOfxDate(raw);
  } catch {
    return null;
  }
}

/**
 * All occurrences of aggregate `<TAG>`. Each block runs to its `</TAG>` or, if the file
 * omits the closing tag, to the next `<TAG>`.
 */
export function findBlocks(text: string, tag: string): string[] {
  const parts = text.split(new RegExp(`<${tag}>`, 'i'));
  const close = new RegExp(`</${tag}>`, 'i');
  return parts.slice(1).map((p) => {
    const end = p.search(close);
    return end >= 0 ? p.slice(0, end) : p;
  });
}

/** First `<TAG>value` in the text, trimmed and entity-decoded; null if absent or empty. */
export function readLeaf(text: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i').exec(text);
  if (!m) return null;
  const v = decodeEntities((m[1] ?? '').trim());
  return v === '' ? null : v;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ent.toLowerCase()] ?? whole;
  });
}

/** Last 4 digits of an account id ("x5555" -> "5555"). Falls back to the last 4 characters. */
export function last4Of(acctId: string): string {
  const digits = acctId.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : acctId.slice(-4);
}

export const ACCT_PLACEHOLDER = '{ACCT}';

/** Account ids shorter than this are already masked (e.g. "x5555") and are left alone. */
const MIN_SENSITIVE_DIGITS = 6;

/**
 * Remove the full account number from any text (card FITIDs embed it as a prefix).
 * Short/masked ids are not replaced, since "5555" could legitimately appear elsewhere.
 */
export function scrubAccountNumber(text: string, acctId: string): string {
  const digits = acctId.replace(/\D/g, '');
  if (digits.length < MIN_SENSITIVE_DIGITS) return text;
  let out = text.split(digits).join(ACCT_PLACEHOLDER);
  const raw = acctId.trim();
  if (raw !== digits && raw.length >= MIN_SENSITIVE_DIGITS) out = out.split(raw).join(ACCT_PLACEHOLDER);
  return out;
}

/** FITID with the account number replaced by `{ACCT}`. Stable, so dedupe still works. */
export function sanitizeFitid(fitid: string, acctId: string): string {
  return scrubAccountNumber(fitid, acctId);
}
