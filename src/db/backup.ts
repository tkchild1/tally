import { BACKUP_TABLES, createBackup, type BackupData, type BackupRow, type BackupTableName } from '../lib/backup';
import type { Db, Queryable } from './client';
import { reclassifyAll } from './reclassify';

/** What each table contributes to a backup. Categories keep only the user's fixed/variable choice. */
const EXPORT_SQL: Record<BackupTableName, string> = {
  accounts: `SELECT * FROM accounts ORDER BY id`,
  balance_snapshots: `SELECT * FROM balance_snapshots ORDER BY account_id, as_of`,
  imports: `SELECT * FROM imports ORDER BY id`,
  transactions: `SELECT * FROM transactions ORDER BY id`,
  merchant_rules: `SELECT * FROM merchant_rules ORDER BY id`,
  merchant_flags: `SELECT * FROM merchant_flags ORDER BY merchant`,
  categories: `SELECT id, is_fixed FROM categories ORDER BY id`,
  budgets: `SELECT * FROM budgets ORDER BY category_id`,
};

/** Insert order respects foreign keys. Categories are updated, not inserted. */
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
    for (const t of RESTORE_ORDER) {
      const rows = data.tables[t];
      if (rows.length === 0) continue;
      await tx.query(`INSERT INTO ${t} SELECT * FROM jsonb_populate_recordset(NULL::${t}, $1::jsonb)`, [JSON.stringify(rows)]);
    }
    await tx.query(
      `UPDATE categories c SET is_fixed = r.is_fixed
       FROM jsonb_to_recordset($1::jsonb) AS r(id text, is_fixed boolean)
       WHERE c.id = r.id AND r.is_fixed IS NOT NULL`,
      [JSON.stringify(data.tables.categories)],
    );
    for (const t of SERIAL_TABLES) {
      await tx.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), COALESCE((SELECT MAX(id) FROM ${t}), 0) + 1, false)`);
    }
    await reclassifyAll(tx);
  });
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
