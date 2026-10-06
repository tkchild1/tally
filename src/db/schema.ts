import { DEFAULT_CATEGORIES } from '../lib/categories';
import type { Db, Queryable } from './client';

/**
 * Numbered migrations. On open, read meta.schema_version and apply the missing ones,
 * each in its own transaction. Never edit a shipped migration; add a new one.
 */
export const MIGRATIONS: readonly string[] = [
  /* 1 */ `
  CREATE TABLE accounts (
    id           text PRIMARY KEY,
    kind         text NOT NULL CHECK (kind IN ('checking','savings','credit_card')),
    last4        text NOT NULL,
    display_name text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE balance_snapshots (
    account_id    text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    as_of         date NOT NULL,
    balance_cents integer NOT NULL,
    PRIMARY KEY (account_id, as_of)
  );

  CREATE TABLE imports (
    id          serial PRIMARY KEY,
    account_id  text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    file_name   text,
    range_start date,
    range_end   date,
    imported_at timestamptz NOT NULL DEFAULT now(),
    txn_total   integer NOT NULL,
    txn_new     integer NOT NULL
  );

  CREATE TABLE categories (
    id       text PRIMARY KEY,
    name     text NOT NULL,
    kind     text NOT NULL CHECK (kind IN ('income','expense','system')),
    is_fixed boolean NOT NULL DEFAULT false
  );

  CREATE TABLE transactions (
    id              serial PRIMARY KEY,
    account_id      text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    fitid           text NOT NULL,
    posted_on       date NOT NULL,
    amount_cents    integer NOT NULL,
    trn_type        text,
    raw_name        text NOT NULL,
    raw_memo        text,
    merchant        text NOT NULL,
    flow            text NOT NULL CHECK (flow IN ('spend','income','transfer')),
    flow_source     text NOT NULL DEFAULT 'auto' CHECK (flow_source IN ('auto','user')),
    category_id     text NOT NULL REFERENCES categories(id),
    category_source text NOT NULL DEFAULT 'auto' CHECK (category_source IN ('auto','user')),
    transfer_group  text,
    transfer_hint   text,
    UNIQUE (account_id, fitid)
  );
  CREATE INDEX transactions_posted_idx   ON transactions (posted_on);
  CREATE INDEX transactions_merchant_idx ON transactions (merchant);

  CREATE TABLE merchant_rules (
    id          serial PRIMARY KEY,
    match_type  text NOT NULL CHECK (match_type IN ('equals','contains')),
    pattern     text NOT NULL,
    category_id text NOT NULL REFERENCES categories(id),
    UNIQUE (match_type, pattern)
  );

  CREATE TABLE merchant_flags (
    merchant text PRIMARY KEY,
    state    text NOT NULL CHECK (state IN ('confirmed','dismissed'))
  );

  CREATE TABLE budgets (
    category_id   text PRIMARY KEY REFERENCES categories(id),
    monthly_cents integer NOT NULL CHECK (monthly_cents >= 0)
  );
  `,
  /* 2 */ `
  UPDATE categories SET name = 'Dining' WHERE id = 'dining' AND name = 'Dining & coffee';
  `,
  /* 3 */ `
  ALTER TABLE categories ADD COLUMN is_custom boolean NOT NULL DEFAULT false;
  `,
  /* 4 */ `
  ALTER TABLE categories ADD COLUMN is_earned boolean NOT NULL DEFAULT false;
  UPDATE categories SET is_earned = true WHERE id = 'income_paycheck';
  `,
];

export async function getSchemaVersion(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`);
  return rows[0] ? Number(rows[0].value) : 0;
}

export async function migrate(db: Db): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text NOT NULL)`);
  const current = await getSchemaVersion(db);
  for (let v = current + 1; v <= MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v - 1] as string;
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query(
        `INSERT INTO meta (key, value) VALUES ('schema_version', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [String(v)],
      );
    });
  }
  await seedCategories(db);
}

/** Insert missing default categories; existing rows (and the user's fixed/earned choices) are kept. */
export async function seedCategories(db: Queryable): Promise<void> {
  for (const c of DEFAULT_CATEGORIES) {
    await db.query(
      `INSERT INTO categories (id, name, kind, is_fixed, is_earned) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [c.id, c.name, c.kind, c.isFixed, c.isEarned ?? false],
    );
  }
}
