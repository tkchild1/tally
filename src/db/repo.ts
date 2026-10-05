import type { AccountKind } from '../lib/qfx';
import type { Queryable } from './client';

/**
 * All SQL reads/writes used by the UI. Conventions: DATE columns are selected as
 * `::text` (never JS Date), aggregates are cast to `::int` (never bigint strings).
 */

export interface AccountRow {
  id: string;
  kind: AccountKind;
  last4: string;
  display_name: string;
  balance_cents: number | null;
  balance_as_of: string | null;
  txn_count: number;
}

export interface TransactionRow {
  id: number;
  account_id: string;
  account_name: string;
  posted_on: string;
  amount_cents: number;
  trn_type: string | null;
  raw_name: string;
  raw_memo: string | null;
  merchant: string;
  flow: 'spend' | 'income' | 'transfer';
  category_id: string;
  category_name: string;
  transfer_hint: string | null;
}

export interface ImportRow {
  id: number;
  account_id: string;
  file_name: string | null;
  range_start: string | null;
  range_end: string | null;
  imported_at: string;
  txn_total: number;
  txn_new: number;
}

export async function listAccounts(db: Queryable): Promise<AccountRow[]> {
  const { rows } = await db.query<AccountRow>(`
    SELECT a.id, a.kind, a.last4, a.display_name,
           s.balance_cents, s.as_of::text AS balance_as_of,
           (SELECT COUNT(*)::int FROM transactions t WHERE t.account_id = a.id) AS txn_count
    FROM accounts a
    LEFT JOIN LATERAL (
      SELECT balance_cents, as_of FROM balance_snapshots b
      WHERE b.account_id = a.id ORDER BY as_of DESC LIMIT 1
    ) s ON true
    ORDER BY CASE a.kind WHEN 'checking' THEN 0 WHEN 'savings' THEN 1 ELSE 2 END, a.display_name`);
  return rows;
}

export interface TransactionFilter {
  accountId?: string;
  limit?: number;
  offset?: number;
}

export async function listTransactions(db: Queryable, f: TransactionFilter = {}): Promise<TransactionRow[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.accountId) {
    params.push(f.accountId);
    where.push(`t.account_id = $${params.length}`);
  }
  params.push(f.limit ?? 200, f.offset ?? 0);
  const { rows } = await db.query<TransactionRow>(
    `SELECT t.id, t.account_id, a.display_name AS account_name, t.posted_on::text AS posted_on,
            t.amount_cents, t.trn_type, t.raw_name, t.raw_memo, t.merchant, t.flow,
            t.category_id, c.name AS category_name, t.transfer_hint
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     JOIN categories c ON c.id = t.category_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.posted_on DESC, t.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

export async function countTransactions(db: Queryable, f: Pick<TransactionFilter, 'accountId'> = {}): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    f.accountId
      ? `SELECT COUNT(*)::int AS n FROM transactions WHERE account_id = $1`
      : `SELECT COUNT(*)::int AS n FROM transactions`,
    f.accountId ? [f.accountId] : [],
  );
  return rows[0]?.n ?? 0;
}

export async function listImports(db: Queryable): Promise<ImportRow[]> {
  const { rows } = await db.query<ImportRow>(`
    SELECT id, account_id, file_name, range_start::text AS range_start, range_end::text AS range_end,
           imported_at::text AS imported_at, txn_total, txn_new
    FROM imports ORDER BY imported_at DESC, id DESC`);
  return rows;
}
