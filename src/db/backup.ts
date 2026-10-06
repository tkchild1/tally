import { BACKUP_TABLES, createBackup, type BackupData, type BackupRow, type BackupTableName } from '../lib/backup';
import type { Db, Queryable } from './client';
import { reclassifyAll } from './reclassify';
import { resetCategories } from './repo';

/**
 * What each table contributes to a backup. Backups made before custom categories hold only id and
 * is_fixed for categories; ones made before earned income have no is_earned (the defaults stay).
 */
const EXPORT_SQL: Record<BackupTableName, string> = {
  accounts: `SELECT * FROM accounts ORDER BY id`,
  balance_snapshots: `SELECT * FROM balance_snapshots ORDER BY account_id, as_of`,
  imports: `SELECT * FROM imports ORDER BY id`,
  transactions: `SELECT * FROM transactions ORDER BY id`,
  merchant_rules: `SELECT * FROM merchant_rules ORDER BY id`,
  merchant_flags: `SELECT * FROM merchant_flags ORDER BY merchant`,
  categories: `SELECT id, name, kind, is_fixed, is_custom, is_earned FROM categories ORDER BY id`,
  budgets: `SELECT * FROM budgets ORDER BY category_id`,
};

/** Insert order respects foreign keys. Categories are handled first, by `restoreCategories`. */
const RESTORE_ORDER = ['accounts', 'balance_snapshots', 'imports', 'transactions', 'merchant_rules', 'merchant_flags', 'budgets'] as const;
const SERIAL_TABLES = ['imports', 'transactions', 'merchant_rules'] as const;

export async function exportBackup(db: Queryable, exportedAt = new Date().toISOString()): Promise<BackupData> {
  const entries = await Promise.all(
    BACKUP_TABLES.map(async (t) => {
      // json_agg turns DATE into "YYYY-MM-DD" text, so no JS Date objects sneak in.
      const { rows } = await db.query<{ rows: BackupRow[] }>(`SELECT COALESCE(json_agg(x), '[]'::json) AS rows FROM (${EXPORT_SQL[t]}) x`);
      return [t, rows[0]?.rows ?? []] as const;
    }),
  );
  return createBackup(Object.fromEntries(entries) as Record<BackupTableName, BackupRow[]>, exportedAt);
}

/**
 * Replace all data with the backup's, in one transaction: any constraint failure rolls
 * everything back and the current data stays. Classification re-runs afterwards.
 */
export async function restoreBackup(db: Db, data: BackupData): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.exec(`
      DELETE FROM transactions; DELETE FROM balance_snapshots; DELETE FROM imports;
      DELETE FROM merchant_rules; DELETE FROM merchant_flags; DELETE FROM budgets; DELETE FROM accounts;`);
    await restoreCategories(tx, data.tables.categories);
    for (const t of RESTORE_ORDER) {
      const rows = data.tables[t];
      if (rows.length === 0) continue;
      await tx.query(`INSERT INTO ${t} SELECT * FROM jsonb_populate_recordset(NULL::${t}, $1::jsonb)`, [JSON.stringify(rows)]);
    }
    for (const t of SERIAL_TABLES) {
      await tx.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
    }
    await reclassifyAll(tx);
  });
}

/**
 * Built-in categories always exist; the backup supplies their names and fixed/earned choices. Custom
 * categories are replaced by the backup's, before any transaction or rule refers to them.
 */
async function restoreCategories(tx: Queryable, rows: readonly BackupRow[]): Promise<void> {
  await resetCategories(tx);
  const json = JSON.stringify(rows);
  await tx.query(
    `INSERT INTO categories (id, name, kind, is_fixed, is_earned, is_custom)
     SELECT r.id, r.name, r.kind, COALESCE(r.is_fixed, false), r.kind = 'income' AND COALESCE(r.is_earned, false), true
     FROM jsonb_to_recordset($1::jsonb) AS r(id text, name text, kind text, is_fixed boolean, is_earned boolean, is_custom boolean)
     WHERE r.is_custom AND r.kind IN ('expense', 'income')
     ON CONFLICT (id) DO NOTHING`,
    [json],
  );
  await tx.query(
    `UPDATE categories c SET is_fixed = COALESCE(r.is_fixed, c.is_fixed),
       is_earned = c.kind = 'income' AND COALESCE(r.is_earned, c.is_earned),
       name = COALESCE(NULLIF(trim(r.name), ''), c.name)
     FROM jsonb_to_recordset($1::jsonb) AS r(id text, name text, is_fixed boolean, is_earned boolean)
     WHERE c.id = r.id AND c.kind <> 'system'`,
    [json],
  );
}

export async function recordBackupMade(db: Queryable, date: string): Promise<void> {
  await db.query(
    `INSERT INTO meta (key, value) VALUES ('last_backup_on', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [date],
  );
}

/** Calendar date of the last backup download, or null if none was ever made. */
export async function lastBackupDate(db: Queryable): Promise<string | null> {
  const { rows } = await db.query<{ value: string }>(`SELECT value FROM meta WHERE key = 'last_backup_on'`);
  return rows[0]?.value ?? null;
}
