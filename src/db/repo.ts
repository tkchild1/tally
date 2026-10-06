import { categoryNameProblem, customCategoryId, DEFAULT_CATEGORIES, TITHING_CATEGORY, type Flow } from '../lib/categories';
import { periodBounds } from '../lib/dates';
import type { AccountKind } from '../lib/qfx';
import type { MerchantFlag } from '../lib/subscriptions';
import type { Db, Queryable } from './client';
import { reclassifyAll } from './reclassify';

/**
 * All SQL reads/writes used by the UI. Conventions: DATE columns are selected as
 * `::text` (never JS Date), aggregates are cast to `::int` (never bigint strings).
 */

// ---------- Accounts ----------

export interface AccountRow {
  id: string;
  kind: AccountKind;
  last4: string;
  display_name: string;
  balance_cents: number | null;
  balance_as_of: string | null;
  txn_count: number;
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

export async function renameAccount(db: Queryable, id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Account name cannot be empty');
  await db.query(`UPDATE accounts SET display_name = $2 WHERE id = $1`, [id, trimmed]);
}

// ---------- Transactions ----------

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
  flow: Flow;
  flow_source: 'auto' | 'user';
  category_id: string;
  category_source: 'auto' | 'user';
  category_name: string;
  transfer_group: string | null;
  transfer_hint: string | null;
}

export interface TransactionFilter {
  accountId?: string;
  /** "YYYY-MM" */
  month?: string;
  categoryId?: string;
  flow?: Flow;
  search?: string;
  limit?: number;
  offset?: number;
}

function buildWhere(f: TransactionFilter, params: unknown[]): string {
  const where = buildConditions(f, params);
  return where.length ? 'WHERE ' + where.join(' AND ') : '';
}

/** SQL conditions on alias `t`; values are appended to `params` as placeholders. */
function buildConditions(f: TransactionFilter, params: unknown[]): string[] {
  const where: string[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.accountId) add('t.account_id = ?', f.accountId);
  if (f.month) {
    add(`t.posted_on >= ?::date`, `${f.month}-01`);
    add(`t.posted_on < (?::date + interval '1 month')`, `${f.month}-01`);
  }
  if (f.categoryId) add('t.category_id = ?', f.categoryId);
  if (f.flow) add('t.flow = ?', f.flow);
  if (f.search?.trim()) {
    params.push(`%${f.search.trim().replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    const p = `$${params.length}`;
    where.push(`(t.merchant ILIKE ${p} OR t.raw_name ILIKE ${p} OR coalesce(t.raw_memo, '') ILIKE ${p})`);
  }
  return where;
}

/** Dashboard filter: narrows KPIs and charts to a category and/or a search term. */
export interface DashboardFilter {
  search?: string;
  categoryId?: string;
}

const andConditions = (f: DashboardFilter, params: unknown[]) =>
  buildConditions({ search: f.search, categoryId: f.categoryId }, params).map((c) => ` AND ${c}`).join('');

export async function listTransactions(db: Queryable, f: TransactionFilter = {}): Promise<TransactionRow[]> {
  const params: unknown[] = [];
  const where = buildWhere(f, params);
  params.push(f.limit ?? 200, f.offset ?? 0);
  const { rows } = await db.query<TransactionRow>(
    `SELECT t.id, t.account_id, a.display_name AS account_name, t.posted_on::text AS posted_on,
            t.amount_cents, t.trn_type, t.raw_name, t.raw_memo, t.merchant, t.flow, t.flow_source,
            t.category_id, t.category_source, c.name AS category_name, t.transfer_group, t.transfer_hint
     FROM transactions t
     JOIN accounts a ON a.id = t.account_id
     JOIN categories c ON c.id = t.category_id
     ${where}
     ORDER BY t.posted_on DESC, t.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

export async function countTransactions(db: Queryable, f: TransactionFilter = {}): Promise<number> {
  const params: unknown[] = [];
  const where = buildWhere(f, params);
  const { rows } = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM transactions t ${where}`, params);
  return rows[0]?.n ?? 0;
}

/**
 * Change a transaction's category. With `applyToAll`, an `equals` merchant rule is saved
 * and the row stays automatic, so every unlocked row from that merchant follows the rule.
 * Without it, only this row changes and it is locked against re-classification.
 */
export async function setTransactionCategory(db: Db, id: number, categoryId: string, applyToAll: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    if (applyToAll) {
      const { rows } = await tx.query<{ merchant: string }>(`SELECT merchant FROM transactions WHERE id = $1`, [id]);
      const merchant = rows[0]?.merchant;
      if (!merchant) throw new Error('Transaction not found');
      await upsertMerchantRule(tx, merchant, categoryId);
      await tx.query(`UPDATE transactions SET category_source = 'auto' WHERE id = $1`, [id]);
    } else {
      await tx.query(`UPDATE transactions SET category_id = $2, category_source = 'user' WHERE id = $1`, [id, categoryId]);
    }
    await reclassifyAll(tx);
  });
}

/** Change a transaction's flow (spending / income / transfer). Locks the flow. */
export async function setTransactionFlow(db: Db, id: number, flow: Flow): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(`UPDATE transactions SET flow = $2, flow_source = 'user', transfer_hint = NULL WHERE id = $1`, [id, flow]);
    await reclassifyAll(tx);
  });
}

// ---------- Transfer hints ----------

export interface TransferHintRow {
  hint: string;
  count: number;
}

export async function listTransferHints(db: Queryable): Promise<TransferHintRow[]> {
  const { rows } = await db.query<TransferHintRow>(
    `SELECT transfer_hint AS hint, COUNT(*)::int AS count FROM transactions
     WHERE transfer_hint IS NOT NULL GROUP BY transfer_hint ORDER BY transfer_hint`,
  );
  return rows;
}

/** One-tap fix for payments to an account that hasn't been imported. */
export async function markHintAsTransfer(db: Db, hint: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE transactions SET flow = 'transfer', flow_source = 'user', transfer_hint = NULL WHERE transfer_hint = $1`,
      [hint],
    );
    await reclassifyAll(tx);
  });
}

// ---------- Categories and rules ----------

export interface CategoryRow {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'system';
  is_fixed: boolean;
  is_custom: boolean;
}

export async function listCategories(db: Queryable): Promise<CategoryRow[]> {
  const { rows } = await db.query<CategoryRow>(
    `SELECT id, name, kind, is_fixed, is_custom FROM categories
     ORDER BY CASE kind WHEN 'income' THEN 0 WHEN 'expense' THEN 1 ELSE 2 END, name`,
  );
  return rows;
}

export async function setCategoryFixed(db: Queryable, id: string, isFixed: boolean): Promise<void> {
  await db.query(`UPDATE categories SET is_fixed = $2 WHERE id = $1`, [id, isFixed]);
}

/** Thrown for a name the user must change; the message is safe to show. */
export class CategoryNameError extends Error {}

async function otherCategoryNames(db: Queryable, exceptId: string | null): Promise<string[]> {
  const { rows } = await db.query<{ name: string }>(`SELECT name FROM categories WHERE id IS DISTINCT FROM $1`, [exceptId]);
  return rows.map((r) => r.name);
}

/** Adds a custom category and returns its id. */
export async function addCategory(db: Queryable, name: string, kind: 'expense' | 'income', isFixed: boolean): Promise<string> {
  const problem = categoryNameProblem(name, await otherCategoryNames(db, null));
  if (problem) throw new CategoryNameError(problem);
  const { rows } = await db.query<{ id: string }>(`SELECT id FROM categories`);
  const id = customCategoryId(name, rows.map((r) => r.id));
  await db.query(`INSERT INTO categories (id, name, kind, is_fixed, is_custom) VALUES ($1, $2, $3, $4, true)`, [
    id,
    name.trim(),
    kind,
    kind === 'expense' && isFixed,
  ]);
  return id;
}

/** Renames any category except the built-in Transfer one. */
export async function renameCategory(db: Queryable, id: string, name: string): Promise<void> {
  const problem = categoryNameProblem(name, await otherCategoryNames(db, id));
  if (problem) throw new CategoryNameError(problem);
  await db.query(`UPDATE categories SET name = $2 WHERE id = $1 AND kind <> 'system'`, [id, name.trim()]);
}

/**
 * Deletes a custom category along with its merchant rules and budget. Its transactions go back
 * to automatic categorization (usually Uncategorized), including ones that were set by hand.
 */
export async function deleteCategory(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const { rows } = await tx.query<{ kind: string }>(`SELECT kind FROM categories WHERE id = $1 AND is_custom`, [id]);
    const kind = rows[0]?.kind;
    if (!kind) throw new Error('Only custom categories can be deleted');
    const placeholder = kind === 'income' ? 'income_other' : 'uncategorized';
    await tx.query(`UPDATE transactions SET category_id = $2, category_source = 'auto' WHERE category_id = $1`, [id, placeholder]);
    await tx.query(`DELETE FROM merchant_rules WHERE category_id = $1`, [id]);
    await tx.query(`DELETE FROM budgets WHERE category_id = $1`, [id]);
    await tx.query(`DELETE FROM categories WHERE id = $1`, [id]);
    await reclassifyAll(tx);
  });
}

/** Removes custom categories and restores the built-in names and fixed/variable defaults. */
export async function resetCategories(db: Queryable): Promise<void> {
  await db.query(`DELETE FROM categories WHERE is_custom`);
  await db.query(
    `UPDATE categories c SET name = d.name, is_fixed = d."isFixed"
     FROM jsonb_to_recordset($1::jsonb) AS d(id text, name text, "isFixed" boolean)
     WHERE c.id = d.id`,
    [JSON.stringify(DEFAULT_CATEGORIES)],
  );
}

// ---------- Uncategorized review ----------

export interface UncategorizedMerchantRow {
  merchant: string;
  count: number;
  /** Positive cents spent. */
  total: number;
  last: string;
}

/** Merchants with automatically uncategorized spending, most frequent first. */
export async function uncategorizedMerchants(db: Queryable): Promise<UncategorizedMerchantRow[]> {
  const { rows } = await db.query<UncategorizedMerchantRow>(
    `SELECT merchant, COUNT(*)::int AS count, (-SUM(amount_cents))::int AS total, MAX(posted_on)::text AS last
     FROM transactions
     WHERE category_id = 'uncategorized' AND category_source = 'auto' AND flow = 'spend'
     GROUP BY merchant
     ORDER BY COUNT(*) DESC, SUM(amount_cents) ASC, merchant`,
  );
  return rows;
}

/** Same as "Apply to all" in the transaction sheet: an equals rule for the merchant, then re-classify. */
export async function setMerchantCategory(db: Db, merchant: string, categoryId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await upsertMerchantRule(tx, merchant, categoryId);
    await reclassifyAll(tx);
  });
}

async function upsertMerchantRule(db: Queryable, merchant: string, categoryId: string): Promise<void> {
  await db.query(
    `INSERT INTO merchant_rules (match_type, pattern, category_id) VALUES ('equals', $1, $2)
     ON CONFLICT (match_type, pattern) DO UPDATE SET category_id = EXCLUDED.category_id`,
    [merchant, categoryId],
  );
}

export interface RuleRow {
  id: number;
  match_type: 'equals' | 'contains';
  pattern: string;
  category_id: string;
  category_name: string;
  matches: number;
}

export async function listRules(db: Queryable): Promise<RuleRow[]> {
  const { rows } = await db.query<RuleRow>(`
    SELECT r.id, r.match_type, r.pattern, r.category_id, c.name AS category_name,
           (SELECT COUNT(*)::int FROM transactions t
            WHERE CASE r.match_type WHEN 'equals' THEN t.merchant = r.pattern
                                    ELSE position(r.pattern in t.merchant) > 0 END) AS matches
    FROM merchant_rules r JOIN categories c ON c.id = r.category_id
    ORDER BY r.pattern`);
  return rows;
}

export async function deleteRule(db: Db, id: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(`DELETE FROM merchant_rules WHERE id = $1`, [id]);
    await reclassifyAll(tx);
  });
}

// ---------- Subscriptions ----------

export async function listMerchantFlags(db: Queryable): Promise<Map<string, MerchantFlag>> {
  const { rows } = await db.query<{ merchant: string; state: MerchantFlag }>(`SELECT merchant, state FROM merchant_flags`);
  return new Map(rows.map((r) => [r.merchant, r.state]));
}

export async function setMerchantFlag(db: Queryable, merchant: string, state: MerchantFlag | null): Promise<void> {
  if (state === null) {
    await db.query(`DELETE FROM merchant_flags WHERE merchant = $1`, [merchant]);
  } else {
    await db.query(
      `INSERT INTO merchant_flags (merchant, state) VALUES ($1, $2)
       ON CONFLICT (merchant) DO UPDATE SET state = EXCLUDED.state`,
      [merchant, state],
    );
  }
}

export interface SpendRow {
  merchant: string;
  postedOn: string;
  amountCents: number;
  flow: Flow;
  categoryId: string;
}

export async function listSpendCharges(db: Queryable): Promise<SpendRow[]> {
  const { rows } = await db.query<SpendRow>(`
    SELECT merchant, posted_on::text AS "postedOn", amount_cents AS "amountCents", flow, category_id AS "categoryId"
    FROM transactions WHERE flow = 'spend' AND amount_cents < 0`);
  return rows;
}

// ---------- Dashboard ----------

export async function listMonths(db: Queryable): Promise<string[]> {
  const { rows } = await db.query<{ month: string }>(
    `SELECT DISTINCT to_char(posted_on, 'YYYY-MM') AS month FROM transactions ORDER BY month DESC`,
  );
  return rows.map((r) => r.month);
}

export interface MonthTotalRow {
  month: string;
  income: number;
  spending: number;
  fixed: number;
  variable: number;
  /** Paid in the tithing category (positive). Also included in `spending`. */
  tithing: number;
}

/** Income and spending per month. Transfers are excluded; refunds reduce spending. */
export async function monthlyTotals(db: Queryable, filter: DashboardFilter = {}): Promise<MonthTotalRow[]> {
  const params: unknown[] = [TITHING_CATEGORY];
  const conditions = andConditions(filter, params);
  const { rows } = await db.query<MonthTotalRow>(
    `SELECT to_char(t.posted_on, 'YYYY-MM') AS month,
           COALESCE(SUM(t.amount_cents) FILTER (WHERE t.flow = 'income'), 0)::int AS income,
           (-COALESCE(SUM(t.amount_cents) FILTER (WHERE t.flow = 'spend'), 0))::int AS spending,
           (-COALESCE(SUM(t.amount_cents) FILTER (WHERE t.flow = 'spend' AND c.is_fixed), 0))::int AS fixed,
           (-COALESCE(SUM(t.amount_cents) FILTER (WHERE t.flow = 'spend' AND NOT c.is_fixed), 0))::int AS variable,
           (-COALESCE(SUM(t.amount_cents) FILTER (WHERE t.flow = 'spend' AND t.category_id = $1), 0))::int AS tithing
    FROM transactions t JOIN categories c ON c.id = t.category_id
    WHERE true${conditions}
    GROUP BY 1 ORDER BY 1`,
    params,
  );
  return rows;
}

export interface CategorySpendRow {
  category_id: string;
  name: string;
  is_fixed: boolean;
  total: number;
}

/** Spending per category within a period: a month ("YYYY-MM") or a whole year ("YYYY"). */
export async function spendingByCategory(db: Queryable, period: string, filter: DashboardFilter = {}): Promise<CategorySpendRow[]> {
  const { start, end } = periodBounds(period);
  const params: unknown[] = [start, end];
  const conditions = andConditions(filter, params);
  const { rows } = await db.query<CategorySpendRow>(
    `SELECT c.id AS category_id, c.name, c.is_fixed, (-SUM(t.amount_cents))::int AS total
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.flow = 'spend' AND t.posted_on >= $1::date AND t.posted_on < $2::date${conditions}
     GROUP BY c.id, c.name, c.is_fixed
     HAVING SUM(t.amount_cents) < 0
     ORDER BY total DESC`,
    params,
  );
  return rows;
}

export interface MerchantSpendRow {
  merchant: string;
  count: number;
  total: number;
}

/** Biggest merchants by spending for a filter, optionally within a period ("YYYY-MM" or "YYYY"). */
export async function topMerchants(db: Queryable, filter: DashboardFilter, period?: string, limit = 5): Promise<MerchantSpendRow[]> {
  const params: unknown[] = [];
  const conditions = andConditions(filter, params);
  let periodSql = '';
  if (period) {
    const { start, end } = periodBounds(period);
    params.push(start, end);
    periodSql = ` AND t.posted_on >= $${params.length - 1}::date AND t.posted_on < $${params.length}::date`;
  }
  params.push(limit);
  const { rows } = await db.query<MerchantSpendRow>(
    `SELECT t.merchant, COUNT(*)::int AS count, (-SUM(t.amount_cents))::int AS total
     FROM transactions t
     WHERE t.flow = 'spend'${conditions}${periodSql}
     GROUP BY t.merchant
     HAVING SUM(t.amount_cents) < 0
     ORDER BY total DESC, t.merchant
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

export interface FilterSummary {
  spent: number;
  purchases: number;
  income: number;
  first: string | null;
  last: string | null;
}

/** All-time totals for a dashboard filter (transfers excluded; refunds reduce `spent`). */
export async function filterSummary(db: Queryable, filter: DashboardFilter): Promise<FilterSummary> {
  const params: unknown[] = [];
  const conditions = andConditions(filter, params);
  const { rows } = await db.query<FilterSummary>(
    `SELECT (-COALESCE(SUM(t.amount_cents) FILTER (WHERE t.flow = 'spend'), 0))::int AS spent,
            COUNT(*) FILTER (WHERE t.flow = 'spend' AND t.amount_cents < 0)::int AS purchases,
            COALESCE(SUM(t.amount_cents) FILTER (WHERE t.flow = 'income'), 0)::int AS income,
            MIN(t.posted_on)::text AS first, MAX(t.posted_on)::text AS last
     FROM transactions t
     WHERE t.flow <> 'transfer'${conditions}`,
    params,
  );
  return rows[0] ?? { spent: 0, purchases: 0, income: 0, first: null, last: null };
}

export interface BalanceInputs {
  accounts: Array<{ id: string; kind: AccountKind }>;
  txns: Array<{ accountId: string; postedOn: string; amountCents: number }>;
  snapshots: Array<{ accountId: string; asOf: string; balanceCents: number }>;
}

export async function balanceInputs(db: Queryable): Promise<BalanceInputs> {
  const [a, t, s] = await Promise.all([
    db.query<{ id: string; kind: AccountKind }>(`SELECT id, kind FROM accounts`),
    db.query<{ accountId: string; postedOn: string; amountCents: number }>(
      `SELECT account_id AS "accountId", posted_on::text AS "postedOn", amount_cents AS "amountCents" FROM transactions`,
    ),
    db.query<{ accountId: string; asOf: string; balanceCents: number }>(
      `SELECT account_id AS "accountId", as_of::text AS "asOf", balance_cents AS "balanceCents" FROM balance_snapshots`,
    ),
  ]);
  return { accounts: a.rows, txns: t.rows, snapshots: s.rows };
}

// ---------- Imports / coverage ----------

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

export async function listImports(db: Queryable): Promise<ImportRow[]> {
  const { rows } = await db.query<ImportRow>(`
    SELECT id, account_id, file_name, range_start::text AS range_start, range_end::text AS range_end,
           imported_at::text AS imported_at, txn_total, txn_new
    FROM imports ORDER BY imported_at DESC, id DESC`);
  return rows;
}

/** Calendar date (UTC) of the most recent import, or null. */
export async function lastImportDate(db: Queryable): Promise<string | null> {
  const { rows } = await db.query<{ d: string | null }>(
    `SELECT (MAX(imported_at) AT TIME ZONE 'UTC')::date::text AS d FROM imports`,
  );
  return rows[0]?.d ?? null;
}

// ---------- Budgets ----------

export interface BudgetRow {
  category_id: string;
  name: string;
  monthly_cents: number;
}

export async function listBudgets(db: Queryable): Promise<BudgetRow[]> {
  const { rows } = await db.query<BudgetRow>(
    `SELECT b.category_id, c.name, b.monthly_cents FROM budgets b JOIN categories c ON c.id = b.category_id ORDER BY c.name`,
  );
  return rows;
}

export async function setBudget(db: Queryable, categoryId: string, monthlyCents: number): Promise<void> {
  if (!Number.isInteger(monthlyCents) || monthlyCents < 0) throw new Error('Budget must be a whole number of cents >= 0');
  await db.query(
    `INSERT INTO budgets (category_id, monthly_cents) VALUES ($1, $2)
     ON CONFLICT (category_id) DO UPDATE SET monthly_cents = EXCLUDED.monthly_cents`,
    [categoryId, monthlyCents],
  );
}

export async function deleteBudget(db: Queryable, categoryId: string): Promise<void> {
  await db.query(`DELETE FROM budgets WHERE category_id = $1`, [categoryId]);
}

export interface CategoryMonthRow {
  month: string;
  categoryId: string;
  totalCents: number;
}

/** Net spending per category per month (refunds reduce it). */
export async function categorySpendByMonth(db: Queryable): Promise<CategoryMonthRow[]> {
  const { rows } = await db.query<CategoryMonthRow>(
    `SELECT to_char(posted_on, 'YYYY-MM') AS month, category_id AS "categoryId", (-SUM(amount_cents))::int AS "totalCents"
     FROM transactions WHERE flow = 'spend'
     GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  return rows;
}

// ---------- Danger zone ----------

/** Delete every account, transaction, import, rule, flag, and budget. Categories stay. */
export async function eraseAllData(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.exec(`
      DELETE FROM transactions; DELETE FROM balance_snapshots; DELETE FROM imports;
      DELETE FROM merchant_rules; DELETE FROM merchant_flags; DELETE FROM budgets; DELETE FROM accounts;`);
    await resetCategories(tx);
  });
}
