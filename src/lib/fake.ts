import { addDays, addMonths, daysBetween, type ISODate } from './dates';
import { centsToDecimal, type Cents } from './money';
import type { AccountKind } from './qfx';

/**
 * Deterministic fake QFX generator (README section 12). Mimics the structure and quirks of
 * real PNC exports with entirely made-up identifiers, merchants, and amounts.
 *
 * The ledger is generated day by day from a fixed `ledgerStart`, so two exports with
 * different end dates agree on every overlapping day (same FITIDs, same amounts). That is
 * what makes overlapping-import tests realistic.
 */

export const FAKE_ACCOUNTS = {
  checking: { acctId: 'x5555', bankId: '000000000', last4: '5555' },
  savings: { acctId: 'x7777', bankId: '000000000', last4: '7777' },
  card: { acctId: '4000000000001234', last4: '1234' },
} as const;

export interface FakeOptions {
  seed?: number;
  endDate: ISODate;
  months?: number;
  /** Generation starts here regardless of the export window. */
  ledgerStart?: ISODate;
}

export interface FakeExport {
  fileName: string;
  kind: AccountKind;
  text: string;
}

interface FakeTxn {
  date: ISODate;
  amount: Cents;
  name: string;
  memo: string | null;
  trnType: 'DEBIT' | 'CREDIT';
  fitid: string;
}

interface Ledger {
  txns: FakeTxn[];
  balance: Cents;
}

const DEFAULT_LEDGER_START = '2025-01-01';
const PAYDAY_ANCHOR = '2024-01-05';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private readonly next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)] as T;
  }
  digits(n: number): string {
    let s = '';
    for (let i = 0; i < n; i++) s += String(this.int(0, 9));
    return s;
  }
}

interface Merchant {
  name: string;
  min: Cents;
  max: Cents;
}

const GROCERIES: Merchant[] = [
  { name: 'WALMART SUPERCENTER #1234 OREM UT', min: 2500, max: 14000 },
  { name: "SMITH'S FOOD #4123 Provo UT", min: 1500, max: 9000 },
  { name: 'COSTCO WHSE #0123 SALT LAKE CITY UT', min: 6000, max: 22000 },
];
const DINING: Merchant[] = [
  { name: 'SQ *SOME CAFE Provo UT', min: 600, max: 1400 },
  { name: 'CHIPOTLE 1234 PROVO UT', min: 1000, max: 1600 },
  { name: 'CAFE RIO #12 OREM UT', min: 1100, max: 2400 },
  { name: 'DOORDASH*TACOS SAN FRANCISCO CA', min: 2000, max: 4000 },
  { name: 'STARBUCKS STORE 12345 PROVO UT', min: 500, max: 900 },
];
const GAS: Merchant[] = [
  { name: 'MAVERIK #321 OREM UT', min: 3000, max: 5500 },
  { name: 'CHEVRON 0098765 PROVO UT', min: 3000, max: 5500 },
  { name: 'SHELL OIL 57444 OREM UT', min: 2800, max: 5200 },
];
const SHOPPING: Merchant[] = [
  { name: 'TARGET 00012345 OREM UT', min: 1500, max: 9000 },
  { name: 'BARNES & NOBLE #2345 OREM UT', min: 1200, max: 4500 },
];
const ENTERTAINMENT: Merchant[] = [
  { name: 'LANES BOWLING OREM UT', min: 1800, max: 4500 },
  { name: 'CINEMARK THEATRES Provo UT', min: 1200, max: 3200 },
  { name: 'STEAMGAMES.COM 425-555-0199 WA', min: 999, max: 5999 },
];

function generateLedgers(seed: number, ledgerStart: ISODate, endDate: ISODate) {
  const rng = new Rng(seed);
  const checking: Ledger = { txns: [], balance: 250_000 };
  const savings: Ledger = { txns: [], balance: 400_000 };
  const card: Ledger = { txns: [], balance: 0 };
  let checkingSeq = 0;
  let savingsSeq = 0;
  const cardScheduled = new Map<ISODate, Array<Omit<FakeTxn, 'fitid' | 'date'>>>();

  const bankFitid = (prefix: string, seq: number, date: ISODate) =>
    `${prefix}${String(seq).padStart(17, '0')}#1#071#${date}#`;

  const addChecking = (date: ISODate, amount: Cents, memo: string) => {
    checkingSeq++;
    checking.balance += amount;
    checking.txns.push({
      date,
      amount,
      name: memo.slice(0, 32),
      memo,
      trnType: amount < 0 ? 'DEBIT' : 'CREDIT',
      fitid: bankFitid('9', checkingSeq, date),
    });
  };
  const addSavings = (date: ISODate, amount: Cents, memo: string) => {
    savingsSeq++;
    savings.balance += amount;
    savings.txns.push({
      date,
      amount,
      name: memo.slice(0, 32),
      memo,
      trnType: amount < 0 ? 'DEBIT' : 'CREDIT',
      fitid: bankFitid('8', savingsSeq, date),
    });
  };
  const addCard = (date: ISODate, amount: Cents, name: string) => {
    card.balance += amount;
    card.txns.push({
      date,
      amount,
      name,
      memo: null,
      trnType: amount < 0 ? 'DEBIT' : 'CREDIT',
      fitid: FAKE_ACCOUNTS.card.acctId + rng.digits(16),
    });
  };
  const charge = (date: ISODate, m: Merchant) => addCard(date, -rng.int(m.min, m.max), m.name);

  const totalDays = daysBetween(ledgerStart, endDate);
  for (let i = 0; i <= totalDays; i++) {
    const d = addDays(ledgerStart, i);
    const dom = Number(d.slice(8, 10));
    const monthIndex = Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    const isLastDayOfMonth = addDays(d, 1).slice(8, 10) === '01';

    for (const t of cardScheduled.get(d) ?? []) addCard(d, t.amount, t.name);
    cardScheduled.delete(d);

    // Checking: income, bills, card payment, savings transfer.
    if (daysBetween(PAYDAY_ANCHOR, d) % 14 === 0) {
      addChecking(d, 235_000, 'ACME CORP PAYROLL ACH CREDIT EFTxxxxx9999');
    }
    if (dom === 1) addChecking(d, -135_000, 'SUNSET APARTMENTS RENT ACH DEBIT WEB ID: 4455667');
    if (dom === 5) addChecking(d, -11_840, 'STATE FARM INSURANCE ACH DEBIT');
    if (dom === 15) addChecking(d, -rng.int(4_200, 13_800), 'ROCKY MOUNTAIN POWER ACH DEBIT');
    if (dom === 18) addChecking(d, -7_999, 'COMCAST CABLE COMM ACH DEBIT');
    if (dom === 22 && card.balance < 0) {
      const owed = -card.balance;
      const pay = Math.min(owed, Math.max(0, checking.balance - 10_000));
      if (pay > 0) {
        addChecking(d, -pay, `MOBILE PAYMENT TO XXXXX${FAKE_ACCOUNTS.card.last4}`);
        const next = addDays(d, 1);
        cardScheduled.set(next, [...(cardScheduled.get(next) ?? []), { amount: pay, name: 'PAYMENT', memo: null, trnType: 'CREDIT' }]);
      }
    }
    if (dom === 25 && checking.balance > 60_000) {
      addChecking(d, -20_000, `ONLINE TRANSFER TO SAVINGS XXXXX${FAKE_ACCOUNTS.savings.last4}`);
      addSavings(d, 20_000, 'ONLINE TRANSFER FROM CHECKING');
    }
    if (rng.chance(0.06)) {
      const amt = rng.int(800, 4_500);
      if (checking.balance - amt > 10_000) {
        addChecking(d, -amt, `DEBIT CARD PURCHASE XXXXX${FAKE_ACCOUNTS.checking.last4} SMITHS FOOD #4123 OREM UT`);
      }
    }
    if (isLastDayOfMonth) addSavings(d, rng.int(150, 450), 'INTEREST PAYMENT');

    // Card: subscriptions.
    if (dom === 3) addCard(d, -2_499, 'PLANET FITNESS 800-555-0142 UT');
    if (dom === 7) addCard(d, -1_549, 'NETFLIX.COM LOS GATOS CA');
    if (dom === 9) addCard(d, -6_500, 'T-MOBILE*AUTO PAY 800-555-0177 WA');
    if (dom === 12) addCard(d, -1_199, 'Spotify USA New York NY');
    if (dom === 16) addCard(d, -299, 'APPLE.COM/BILL 866-555-0123 CA');
    if (dom === 20) {
      // Price goes up $1 every January and July; the badge shows only when the latest charge is the first at a new price.
      const halfYearsSince2024 = Math.floor((monthIndex - 2024 * 12) / 6);
      addCard(d, -(1_599 + 100 * halfYearsSince2024), 'HULU 877-555-0100 CA');
    }
    if (d.slice(5) === '03-14') addCard(d, -13_900, `Amazon Prime*${rng.digits(2)}AB${rng.digits(2)} Amzn.com/bill WA`);

    // Card: habits and noise.
    if (dow === 2) addCard(d, -525, 'SQ *BEAN THERE Provo UT');
    if (rng.chance(0.28)) charge(d, rng.pick(GROCERIES));
    if (rng.chance(0.45)) charge(d, rng.pick(DINING));
    if (rng.chance(0.15)) charge(d, rng.pick(GAS));
    if (rng.chance(0.08)) {
      const code = `${rng.digits(1)}K${rng.digits(1)}AB${rng.digits(1)}C`;
      addCard(d, -rng.int(1_200, 8_000), `AMZN Mktp US*${code} Amzn.com/bill WA`);
    }
    if (rng.chance(0.04)) charge(d, rng.pick(SHOPPING));
    if (rng.chance(0.05)) charge(d, rng.pick(ENTERTAINMENT));
    if (rng.chance(0.01)) {
      const refund = rng.int(1_500, 4_000);
      if (card.balance + refund <= 0) addCard(d, refund, 'AMZN Mktp US Refund Amzn.com/bill WA');
    }
  }

  return { checking, savings, card };
}

export function generateFakeExports(opts: FakeOptions): FakeExport[] {
  const seed = opts.seed ?? 42;
  const months = opts.months ?? 7;
  const windowStart = addMonths(opts.endDate, -months);
  const configuredStart = opts.ledgerStart ?? DEFAULT_LEDGER_START;
  const ledgerStart = windowStart < configuredStart ? windowStart : configuredStart;

  const { checking, savings, card } = generateLedgers(seed, ledgerStart, opts.endDate);
  const inWindow = (t: FakeTxn) => t.date >= windowStart && t.date <= opts.endDate;

  return [
    {
      fileName: `fake-checking-${FAKE_ACCOUNTS.checking.last4}-${opts.endDate}.qfx`,
      kind: 'checking',
      text: bankStatement('CHECKING', FAKE_ACCOUNTS.checking, windowStart, opts.endDate, checking.txns.filter(inWindow), checking.balance),
    },
    {
      fileName: `fake-savings-${FAKE_ACCOUNTS.savings.last4}-${opts.endDate}.qfx`,
      kind: 'savings',
      text: bankStatement('SAVINGS', FAKE_ACCOUNTS.savings, windowStart, opts.endDate, savings.txns.filter(inWindow), savings.balance),
    },
    {
      fileName: `fake-card-${FAKE_ACCOUNTS.card.last4}-${opts.endDate}.qfx`,
      kind: 'credit_card',
      text: cardStatement(windowStart, opts.endDate, card.txns.filter(inWindow), card.balance),
    },
  ];
}

const HEADER = [
  'OFXHEADER:100',
  'DATA:OFXSGML',
  'VERSION:102',
  'SECURITY:NONE',
  'ENCODING:USASCII',
  'CHARSET:1252',
  'COMPRESSION:NONE',
  'OLDFILEUID:NONE',
  'NEWFILEUID:NONE',
  '',
  '',
].join('\r\n');

const ofxDate = (d: ISODate, time: string) => `${d.replace(/-/g, '')}${time}.000`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function signon(endDate: ISODate): string {
  return `<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>${ofxDate(endDate, '000000')}<LANGUAGE>ENG<FI><ORG>BANK<FID>0000</FI></SONRS></SIGNONMSGSRSV1>`;
}

function txnXml(t: FakeTxn, time: string): string {
  const memo = t.memo ? `<MEMO>${esc(t.memo)}` : '';
  return `<STMTTRN><TRNTYPE>${t.trnType}<DTPOSTED>${ofxDate(t.date, time)}<DTUSER>${ofxDate(t.date, time)}<TRNAMT>${centsToDecimal(t.amount)}<FITID>${t.fitid}<NAME>${esc(t.name)}${memo}</STMTTRN>`;
}

function bankStatement(
  acctType: 'CHECKING' | 'SAVINGS',
  acct: { acctId: string; bankId: string },
  start: ISODate,
  end: ISODate,
  txns: FakeTxn[],
  balance: Cents,
): string {
  const list = txns.map((t) => txnXml(t, '000000')).join('');
  return (
    HEADER +
    `<OFX>${signon(end)}<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS><STMTRS><CURDEF>USD` +
    `<BANKACCTFROM><BANKID>${acct.bankId}<ACCTID>${acct.acctId}<ACCTTYPE>${acctType}</BANKACCTFROM>` +
    `<BANKTRANLIST><DTSTART>${ofxDate(start, '000000')}<DTEND>${ofxDate(end, '000000')}${list}</BANKTRANLIST>` +
    `<LEDGERBAL><BALAMT>${centsToDecimal(balance)}<DTASOF>${ofxDate(end, '000000')}</LEDGERBAL>` +
    `</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>\r\n`
  );
}

function cardStatement(start: ISODate, end: ISODate, txns: FakeTxn[], balance: Cents): string {
  const list = txns.map((t) => txnXml(t, '120000')).join('');
  return (
    HEADER +
    `<OFX>${signon(end)}<CREDITCARDMSGSRSV1><CCSTMTTRNRS><TRNUID>0<STATUS><CODE>0<SEVERITY>INFO</STATUS><CCSTMTRS><CURDEF>USD` +
    `<CCACCTFROM><ACCTID>${FAKE_ACCOUNTS.card.acctId}</CCACCTFROM>` +
    `<BANKTRANLIST><DTSTART>${ofxDate(start, '120000')}<DTEND>${ofxDate(end, '235900')}${list}</BANKTRANLIST>` +
    `<LEDGERBAL><BALAMT>${centsToDecimal(balance)}<DTASOF>${ofxDate(end, '235900')}</LEDGERBAL>` +
    `</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>\r\n`
  );
}
