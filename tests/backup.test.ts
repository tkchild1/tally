import { beforeAll, describe, expect, it } from 'vitest';
import { exportBackup, restoreBackup } from '../src/db/backup';
import { openDb, type Db } from '../src/db/client';
import { importFile, importFiles } from '../src/db/importer';
import {
  addCategory,
  listAccounts,
  listCategories,
  listMerchantFlags,
  listRules,
  listTransactions,
  renameAccount,
  renameCategory,
  setBudget,
  setCategoryEarned,
  setCategoryFixed,
  setMerchantCategory,
  setMerchantFlag,
  setTransactionCategory,
} from '../src/db/repo';
import {
  BACKUP_TABLES,
  BackupError,
  backupCounts,
  backupFileName,
  isEncryptedBackup,
  parseBackup,
  serializeBackup,
  type BackupData,
} from '../src/lib/backup';
import { generateFakeExports } from '../src/lib/fake';
import { CHECKING_EXAMPLE } from './fixtures/examples';

const END = '2026-01-25';
let source: Db;
let backup: BackupData;

async function tableCounts(db: Db): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    const { rows } = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${t}`);
    out[t] = rows[0]!.n;
  }
  return out;
}

async function snapshot(db: Db) {
  const txns = await listTransactions(db, { limit: 10_000 });
  return {
    counts: await tableCounts(db),
    accounts: (await listAccounts(db)).map((a) => [a.id, a.display_name, a.balance_cents, a.balance_as_of]),
    sum: txns.reduce((s, t) => s + t.amount_cents, 0),
    txns: txns.map((t) => [t.id, t.posted_on, t.amount_cents, t.merchant, t.flow, t.category_id, t.category_source, t.transfer_group]),
    rules: (await listRules(db)).map((r) => [r.pattern, r.category_id, r.matches]),
    flags: [...(await listMerchantFlags(db)).entries()],
    categories: (await db.query(`SELECT id, name, kind, is_fixed, is_custom, is_earned FROM categories ORDER BY id`)).rows,
  };
}

beforeAll(async () => {
  source = await openDb();
  await importFiles(
    source,
    generateFakeExports({ seed: 7, endDate: END, months: 4 }).map((f) => ({ name: f.fileName, text: f.text })),
  );
  const checking = (await listAccounts(source)).find((a) => a.kind === 'checking')!;
  await renameAccount(source, checking.id, 'Bills account');
  const coffee = (await listTransactions(source, { search: 'BEAN THERE', limit: 1 }))[0]!;
  await setTransactionCategory(source, coffee.id, 'entertainment', true);
  const one = (await listTransactions(source, { search: 'SMITH', limit: 1 }))[0]!;
  await setTransactionCategory(source, one.id, 'health', false);
  await setMerchantFlag(source, 'HULU', 'dismissed');
  await setCategoryFixed(source, 'groceries', true);
  await renameCategory(source, 'education', 'Learning');
  const custom = await addCategory(source, 'School & work', 'expense', true);
  await setMerchantCategory(source, 'NETFLIX.COM', custom);
  await setBudget(source, custom, 5000);
  await setCategoryEarned(source, 'income_transfers_in', true);
  await addCategory(source, 'Side job', 'income', false, true);
  backup = await exportBackup(source, '2026-01-25T12:00:00.000Z');
});

describe('backup', () => {
  it('exports every table with plain JSON values (dates as YYYY-MM-DD text)', () => {
    const counts = backupCounts(backup);
    expect(counts.transactions).toBeGreaterThan(100);
    expect(counts.accounts).toBe(3);
    expect(counts.merchant_rules).toBe(2);
    const txn = backup.tables.transactions[0]!;
    expect(txn.posted_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof txn.amount_cents).toBe('number');
    expect(Object.keys(backup.tables.categories[0]!)).toEqual(['id', 'name', 'kind', 'is_fixed', 'is_custom', 'is_earned']);
    expect(backupFileName('2026-01-25')).toBe('tally-2026-01-25.budgetbackup.json');
  });

  it('plain round trip restores into a fresh DB identical to the source', async () => {
    const text = await serializeBackup(backup);
    expect(isEncryptedBackup(text)).toBe(false);
    const fresh = await openDb();
    await restoreBackup(fresh, await parseBackup(text));
    expect(await snapshot(fresh)).toEqual(await snapshot(source));
  });

  it('encrypted round trip works, and the file has no readable data', async () => {
    const text = await serializeBackup(backup, 'correct horse battery staple');
    expect(isEncryptedBackup(text)).toBe(true);
    expect(text).not.toContain('HULU');
    expect(text).not.toContain('Bills account');
    expect(JSON.parse(text)).toMatchObject({ app: 'tally', encrypted: true, v: 1, kdf: 'PBKDF2-SHA256', iter: 600_000 });
    const fresh = await openDb();
    await restoreBackup(fresh, await parseBackup(text, 'correct horse battery staple'));
    expect(await snapshot(fresh)).toEqual(await snapshot(source));
  });

  it('a wrong or missing passphrase fails with a clear error', async () => {
    const text = await serializeBackup(backup, 'right');
    await expect(parseBackup(text, 'wrong')).rejects.toMatchObject({ name: 'BackupError', code: 'wrong_passphrase' });
    await expect(parseBackup(text)).rejects.toMatchObject({ code: 'needs_passphrase' });
  });

  it('rejects files that are not Tally backups, without echoing their contents', async () => {
    for (const bad of ['not json', '{"app":"other"}', '{"app":"tally","version":1}', '{"app":"tally","version":99,"tables":{}}']) {
      const err = await parseBackup(bad).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BackupError);
      expect((err as Error).message).not.toContain(bad);
    }
    const missing = JSON.stringify({ ...backup, tables: { ...backup.tables, transactions: undefined } });
    await expect(parseBackup(missing)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('restore replaces existing data, and later imports keep working', async () => {
    const target = await openDb();
    await importFile(target, 'checking.qfx', CHECKING_EXAMPLE);
    await restoreBackup(target, backup);
    expect(await tableCounts(target)).toEqual(await tableCounts(source));
    const r = await importFile(target, 'checking.qfx', CHECKING_EXAMPLE);
    expect(r.ok).toBe(true);
    expect((await tableCounts(target)).imports).toBe(backup.tables.imports.length + 1);
  });

  it('restores custom categories (with their transactions, rules and budget) and built-in names', async () => {
    const fresh = await openDb();
    await restoreBackup(fresh, backup);
    const cats = await listCategories(fresh);
    expect(cats.find((c) => c.id === 'education')?.name).toBe('Learning');
    expect(cats.find((c) => c.name === 'School & work')).toMatchObject({ is_custom: true, is_fixed: true, kind: 'expense' });
    const movie = (await listTransactions(fresh, { search: 'NETFLIX', limit: 1 }))[0]!;
    expect(movie.category_name).toBe('School & work');
    expect(cats.find((c) => c.name === 'Side job')).toMatchObject({ is_custom: true, is_earned: true, kind: 'income' });
    expect(cats.find((c) => c.id === 'income_transfers_in')?.is_earned).toBe(true);
  });

  it('a backup from before custom categories restores, and drops custom categories it does not know', async () => {
    const old: BackupData = {
      ...backup,
      tables: {
        ...backup.tables,
        categories: backup.tables.categories.filter((c) => !c.is_custom).map((c) => ({ id: c.id, is_fixed: c.is_fixed })),
        transactions: backup.tables.transactions.filter((t) => !String(t.category_id).startsWith('custom-')),
        merchant_rules: backup.tables.merchant_rules.filter((r) => !String(r.category_id).startsWith('custom-')),
        budgets: [],
      },
    };
    const target = await openDb();
    await addCategory(target, 'Hobbies', 'expense', false);
    await renameCategory(target, 'dining', 'Eating out');
    await setCategoryEarned(target, 'income_paycheck', false);
    await restoreBackup(target, old);
    const cats = await listCategories(target);
    expect(cats.some((c) => c.is_custom)).toBe(false);
    expect(cats.find((c) => c.id === 'dining')?.name).toBe('Dining');
    expect(cats.find((c) => c.id === 'education')?.name).toBe('Education');
    expect(cats.find((c) => c.id === 'groceries')?.is_fixed).toBe(true);
    expect(cats.filter((c) => c.is_earned).map((c) => c.id)).toEqual(['income_paycheck']);
  });

  it('a backup that breaks a constraint rolls back and leaves current data alone', async () => {
    const target = await openDb();
    await importFile(target, 'checking.qfx', CHECKING_EXAMPLE);
    const before = await snapshot(target);
    const broken: BackupData = {
      ...backup,
      tables: { ...backup.tables, transactions: [{ ...backup.tables.transactions[0]!, category_id: 'no_such_category' }] },
    };
    await expect(restoreBackup(target, broken)).rejects.toThrow();
    expect(await snapshot(target)).toEqual(before);
  });
});
