import type { Cents } from '../lib/money';
import type { ISODate } from '../lib/dates';
import { sha256Hex } from '../lib/hash';
import { normalizeMerchant } from '../lib/merchant';
import {
  last4Of,
  parseQfx,
  QfxParseError,
  sanitizeFitid,
  scrubAccountNumber,
  type AccountKind,
  type ParsedStatement,
} from '../lib/qfx';
import type { Db, Queryable } from './client';

export interface StatementImportResult {
  accountId: string;
  kind: AccountKind;
  last4: string;
  displayName: string;
  total: number;
  inserted: number;
  duplicates: number;
  rangeStart: ISODate | null;
  rangeEnd: ISODate | null;
  balance: { amountCents: Cents; asOf: ISODate } | null;
}

export interface FileImportResult {
  fileName: string;
  ok: boolean;
  /** Safe to show: never contains values from the file. */
  error: string | null;
  warnings: string[];
  statements: StatementImportResult[];
}

const KIND_LABEL: Record<AccountKind, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit card',
};

/** Stable account key. The raw account id is hashed and never stored. */
export async function accountKey(kind: AccountKind, bankId: string | null, acctId: string): Promise<string> {
  return (await sha256Hex(`${kind}|${bankId ?? ''}|${acctId}`)).slice(0, 32);
}

/**
 * Import one QFX/QBO/OFX file. Each statement is written in a single DB transaction;
 * re-importing the same or an overlapping file inserts only rows not already present.
 */
export async function importFile(db: Db, fileName: string, text: string): Promise<FileImportResult> {
  let parsed;
  try {
    parsed = parseQfx(text);
  } catch (e) {
    const error = e instanceof QfxParseError ? e.message : 'Could not read this file as OFX/QFX';
    return { fileName, ok: false, error, warnings: [], statements: [] };
  }

  const statements: StatementImportResult[] = [];
  for (const stmt of parsed.statements) {
    statements.push(await db.transaction((tx) => importStatement(tx, fileName, stmt)));
  }
  return { fileName, ok: true, error: null, warnings: parsed.warnings, statements };
}

export async function importFiles(db: Db, files: Array<{ name: string; text: string }>): Promise<FileImportResult[]> {
  const results: FileImportResult[] = [];
  for (const f of files) results.push(await importFile(db, f.name, f.text));
  return results;
}

async function importStatement(tx: Queryable, fileName: string, stmt: ParsedStatement): Promise<StatementImportResult> {
  const id = await accountKey(stmt.kind, stmt.bankId, stmt.acctId);
  const last4 = last4Of(stmt.acctId);
  const defaultName = `${KIND_LABEL[stmt.kind]} ...${last4}`;

  await tx.query(
    `INSERT INTO accounts (id, kind, last4, display_name) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
    [id, stmt.kind, last4, defaultName],
  );
  const { rows: acct } = await tx.query<{ display_name: string }>(`SELECT display_name FROM accounts WHERE id = $1`, [id]);

  let inserted = 0;
  for (const t of stmt.transactions) {
    const name = scrubAccountNumber(t.name, stmt.acctId);
    const memo = t.memo === null ? null : scrubAccountNumber(t.memo, stmt.acctId);
    const { rows } = await tx.query<{ id: number }>(
      `INSERT INTO transactions
         (account_id, fitid, posted_on, amount_cents, trn_type, raw_name, raw_memo, merchant, flow, category_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'spend', 'uncategorized')
       ON CONFLICT (account_id, fitid) DO NOTHING
       RETURNING id`,
      [id, sanitizeFitid(t.fitid, stmt.acctId), t.postedOn, t.amountCents, t.trnType, name, memo, normalizeMerchant(name, memo)],
    );
    inserted += rows.length;
  }

  await tx.query(
    `INSERT INTO imports (account_id, file_name, range_start, range_end, txn_total, txn_new)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, fileName, stmt.rangeStart, stmt.rangeEnd, stmt.transactions.length, inserted],
  );

  if (stmt.ledgerBalance) {
    await tx.query(
      `INSERT INTO balance_snapshots (account_id, as_of, balance_cents) VALUES ($1, $2, $3)
       ON CONFLICT (account_id, as_of) DO UPDATE SET balance_cents = EXCLUDED.balance_cents`,
      [id, stmt.ledgerBalance.asOf, stmt.ledgerBalance.amountCents],
    );
  }

  return {
    accountId: id,
    kind: stmt.kind,
    last4,
    displayName: acct[0]?.display_name ?? defaultName,
    total: stmt.transactions.length,
    inserted,
    duplicates: stmt.transactions.length - inserted,
    rangeStart: stmt.rangeStart,
    rangeEnd: stmt.rangeEnd,
    balance: stmt.ledgerBalance,
  };
}
