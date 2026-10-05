import type { Flow } from '../lib/categories';
import { classifyTransactions, type ClassifyAccount, type ClassifyTxn, type UserRule } from '../lib/classify';
import type { AccountKind } from '../lib/qfx';
import type { Queryable } from './client';

interface TxnRow {
  id: number;
  account_id: string;
  posted_on: string;
  amount_cents: number;
  raw_name: string;
  raw_memo: string | null;
  merchant: string;
  flow: Flow;
  flow_source: 'auto' | 'user';
  category_id: string;
  category_source: 'auto' | 'user';
  transfer_group: string | null;
  transfer_hint: string | null;
}

/**
 * Re-run classification over every transaction and write back only rows that changed.
 * All rows (not just new ones) are reconsidered, because importing a new account can turn
 * an old unmatched payment into a matched transfer. User-edited fields are never touched.
 * Returns the number of rows updated.
 */
export async function reclassifyAll(db: Queryable): Promise<number> {
  const [{ rows: txns }, { rows: accounts }, { rows: rules }] = await Promise.all([
    db.query<TxnRow>(`
      SELECT id, account_id, posted_on::text AS posted_on, amount_cents, raw_name, raw_memo, merchant,
             flow, flow_source, category_id, category_source, transfer_group, transfer_hint
      FROM transactions`),
    db.query<{ id: string; kind: AccountKind; last4: string }>(`SELECT id, kind, last4 FROM accounts`),
    db.query<{ match_type: 'equals' | 'contains'; pattern: string; category_id: string }>(
      `SELECT match_type, pattern, category_id FROM merchant_rules`,
    ),
  ]);

  const input: ClassifyTxn[] = txns.map((t) => ({
    id: t.id,
    accountId: t.account_id,
    postedOn: t.posted_on,
    amountCents: t.amount_cents,
    rawName: t.raw_name,
    rawMemo: t.raw_memo,
    merchant: t.merchant,
    flow: t.flow,
    categoryId: t.category_id,
    transferGroup: t.transfer_group,
    flowLocked: t.flow_source === 'user',
    categoryLocked: t.category_source === 'user',
  }));
  const accountsIn: ClassifyAccount[] = accounts.map((a) => ({ id: a.id, kind: a.kind, last4: a.last4 }));
  const rulesIn: UserRule[] = rules.map((r) => ({ matchType: r.match_type, pattern: r.pattern, categoryId: r.category_id }));

  const current = new Map(txns.map((t) => [t.id, t]));
  const changed = classifyTransactions(input, accountsIn, rulesIn).filter((r) => {
    const t = current.get(r.id)!;
    return (
      t.flow !== r.flow ||
      t.category_id !== r.categoryId ||
      t.transfer_group !== r.transferGroup ||
      t.transfer_hint !== r.transferHint
    );
  });
  if (changed.length === 0) return 0;

  await db.query(
    `UPDATE transactions t
     SET flow = x.flow, category_id = x.category_id, transfer_group = x.transfer_group, transfer_hint = x.transfer_hint
     FROM jsonb_to_recordset($1::jsonb)
       AS x(id integer, flow text, category_id text, transfer_group text, transfer_hint text)
     WHERE t.id = x.id`,
    [
      JSON.stringify(
        changed.map((r) => ({
          id: r.id,
          flow: r.flow,
          category_id: r.categoryId,
          transfer_group: r.transferGroup,
          transfer_hint: r.transferHint,
        })),
      ),
    ],
  );
  return changed.length;
}
