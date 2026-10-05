import { PGlite } from '@electric-sql/pglite';
import { migrate } from './schema';

/**
 * The ONLY module that constructs PGlite. Everything else talks to the minimal
 * `Queryable` / `Db` interfaces, so swapping to SQLite-WASM later stays contained here.
 */

export interface Queryable {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Runs a multi-statement script without parameters (migrations). */
  exec(sql: string): Promise<unknown>;
}

export interface Db extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

export const BROWSER_DATA_DIR = 'idb://tally';

/** Open and migrate a database. No `dataDir` means in-memory (used by tests). */
export async function openDb(dataDir?: string): Promise<Db> {
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  await migrate(pg);
  return pg;
}

let browserDb: Promise<Db> | null = null;

/** The app's persistent database (IndexedDB), opened once per page. */
export function getBrowserDb(): Promise<Db> {
  browserDb ??= openDb(BROWSER_DATA_DIR);
  return browserDb;
}

/**
 * PGlite is single-connection: two tabs on the same IndexedDB store can conflict.
 * Holds an exclusive Web Lock for the life of the page. Resolves false if another tab
 * already has Tally open. Browsers without Web Locks are allowed through.
 */
export function acquireTabLock(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    void navigator.locks.request('tally-db', { ifAvailable: true }, (lock) => {
      if (!lock) {
        resolve(false);
        return;
      }
      resolve(true);
      return new Promise<never>(() => {});
    });
  });
}
