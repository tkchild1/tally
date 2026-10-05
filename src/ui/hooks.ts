import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { Db } from '../db/client';

export const DbContext = createContext<Db | null>(null);

export function useDb(): Db {
  const db = useContext(DbContext);
  if (!db) throw new Error('useDb must be used inside DbContext');
  return db;
}

// Global data version: bump after any write so every useQuery re-runs.
let dataVersion = 0;
const listeners = new Set<() => void>();

export function bumpDataVersion(): void {
  dataVersion++;
  for (const l of listeners) l();
}

function useDataVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => dataVersion,
  );
}

export interface QueryState<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
}

/** Runs `fn(db)` whenever `deps` or the global data version change. */
export function useQuery<T>(fn: (db: Db) => Promise<T>, deps: readonly unknown[]): QueryState<T> {
  const db = useDb();
  const version = useDataVersion();
  const [state, setState] = useState<QueryState<T>>({ data: undefined, error: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    fn(db).then(
      (data) => !cancelled && setState({ data, error: null, loading: false }),
      (e: unknown) => !cancelled && setState({ data: undefined, error: e instanceof Error ? e : new Error('Query failed'), loading: false }),
    );
    return () => {
      cancelled = true;
    };
  }, [db, version, ...deps]);

  return state;
}

/** Tiny hash router: "#/transactions" -> "transactions". */
export function useHashRoute(defaultRoute: string): string {
  const read = () => window.location.hash.replace(/^#\/?/, '') || defaultRoute;
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
