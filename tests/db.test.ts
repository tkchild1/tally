import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/client';
import { importFile } from '../src/db/importer';
import { listAccounts, listTransactions } from '../src/db/repo';
import { getSchemaVersion, MIGRATIONS } from '../src/db/schema';
import { DEFAULT_CATEGORIES } from '../src/lib/categories';
import { generateFakeExports } from '../src/lib/fake';
import { CARD_EXAMPLE, CHECKING_EXAMPLE, FAKE_CARD_NUMBER } from './fixtures/examples';

let db: Db;
beforeEach(async () => {
  db = await openDb();
});

async function count(table: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table}`);
  return rows[0]!.n;
}

describe('migrations', () => {
  it('apply cleanly on an empty DB and seed categories', async () => {
    expect(await getSchemaVersion(db)).toBe(MIGRATIONS.length);
    expect(await count('categories')).toBe(DEFAULT_CATEGORIES.length);
  });
});

describe('importer', () => {
  it('imports the README examples with correct counts, dates, and balances', async () => {
    const checking = await importFile(db, 'checking.qfx', CHECKING_EXAMPLE);
    const card = await importFile(db, 'card.qfx', CARD_EXAMPLE);
    expect(checking.ok && card.ok).toBe(true);
    expect(checking.statements[0]).toMatchObject({ kind: 'checking', last4: '5555', total: 2, inserted: 2, duplicates: 0 });
    expect(card.statements[0]).toMatchObject({ kind: 'credit_card', last4: '1234', displayName: 'Credit card ...1234' });

    expect(await count('transactions')).toBe(4);
    expect(await count('accounts')).toBe(2);
    expect(await count('balance_snapshots')).toBe(2);
    expect(await count('imports')).toBe(2);

    const accounts = await listAccounts(db);
    expect(accounts.map((a) => [a.kind, a.balance_cents, a.balance_as_of])).toEqual([
      ['checking', 410050, '2026-01-02'],
      ['credit_card', -31240, '2026-01-02'],
    ]);
  });

  it('stores the calendar day from the file for both 000000 and 120000 times', async () => {
    await importFile(db, 'checking.qfx', CHECKING_EXAMPLE);
    await importFile(db, 'card.qfx', CARD_EXAMPLE);
    const { rows } = await db.query<{ posted_on: string; amount_cents: number }>(
      `SELECT posted_on::text AS posted_on, amount_cents FROM transactions ORDER BY posted_on, amount_cents`,
    );
    expect(rows).toEqual([
      { posted_on: '2025-12-19', amount_cents: 235000 },
      { posted_on: '2025-12-20', amount_cents: -25000 },
      { posted_on: '2025-12-22', amount_cents: 25000 },
      { posted_on: '2025-12-26', amount_cents: -865 },
    ]);
  });

  it('is idempotent: the same file twice adds 0 rows the second time', async () => {
    await importFile(db, 'card.qfx', CARD_EXAMPLE);
    const again = await importFile(db, 'card.qfx', CARD_EXAMPLE);
    expect(again.statements[0]).toMatchObject({ total: 2, inserted: 0, duplicates: 2 });
    expect(await count('transactions')).toBe(2);
    expect(await count('balance_snapshots')).toBe(1);
  });

  it('merges overlapping exports into their union with no duplicates', async () => {
    const a = generateFakeExports({ endDate: '2025-10-31', months: 3 });
    const b = generateFakeExports({ endDate: '2025-12-15', months: 3 });
    const wide = generateFakeExports({ endDate: '2025-12-15', months: 6, ledgerStart: '2025-01-01' });

    for (const f of [...a, ...b]) await importFile(db, f.fileName, f.text);
    const unionCount = await count('transactions');

    const fresh = await openDb();
    for (const f of wide) await importFile(fresh, f.fileName, f.text);
    const { rows } = await fresh.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM transactions WHERE posted_on >= '2025-07-31'`,
    );
    expect(unionCount).toBe(rows[0]!.n);

    const { rows: dupes } = await db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM (SELECT account_id, fitid FROM transactions GROUP BY 1, 2 HAVING COUNT(*) > 1) d`,
    );
    expect(dupes[0]!.n).toBe(0);
  });

  it('never stores the card number (or any 12+ digit run of it) in any text column', async () => {
    // Card files only: the zero-padded fake checking FITIDs would match zero-only windows by coincidence.
    await importFile(db, 'card.qfx', CARD_EXAMPLE);
    const fakeCard = generateFakeExports({ endDate: '2026-01-02' }).find((f) => f.kind === 'credit_card')!;
    await importFile(db, fakeCard.fileName, fakeCard.text);

    const dump = JSON.stringify([
      (await db.query(`SELECT * FROM accounts`)).rows,
      (await db.query(`SELECT * FROM transactions`)).rows,
      (await db.query(`SELECT * FROM imports`)).rows,
      (await db.query(`SELECT * FROM balance_snapshots`)).rows,
    ]);
    const windows = new Set<string>();
    for (let len = 12; len <= FAKE_CARD_NUMBER.length; len++) {
      for (let i = 0; i + len <= FAKE_CARD_NUMBER.length; i++) windows.add(FAKE_CARD_NUMBER.slice(i, i + len));
    }
    for (const w of windows) expect(dump).not.toContain(w);
    expect(dump).toContain('{ACCT}');
  });

  it('reports a clear error for an unparseable file and imports nothing', async () => {
    const r = await importFile(db, 'notes.txt', 'hello');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Not an OFX\/QFX file/);
    expect(await count('transactions')).toBe(0);
  });

  it('keeps a renamed account name across re-imports', async () => {
    await importFile(db, 'card.qfx', CARD_EXAMPLE);
    await db.query(`UPDATE accounts SET display_name = 'My card'`);
    const r = await importFile(db, 'card.qfx', CARD_EXAMPLE);
    expect(r.statements[0]!.displayName).toBe('My card');
  });
});

describe('driver gotchas', () => {
  it('DATE comes back as YYYY-MM-DD text and SUM as a JS number', async () => {
    await importFile(db, 'checking.qfx', CHECKING_EXAMPLE);
    const { rows } = await db.query<{ d: string; total: number }>(
      `SELECT MIN(posted_on)::text AS d, SUM(amount_cents)::int AS total FROM transactions`,
    );
    expect(rows[0]).toEqual({ d: '2025-12-19', total: 210000 });
    expect(typeof rows[0]!.total).toBe('number');

    const list = await listTransactions(db);
    expect(list[0]!.posted_on).toBe('2025-12-20');
    expect(list[0]!.category_name).toBe('Uncategorized');
  });
});
