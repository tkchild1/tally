import { useEffect, useState } from 'react';
import { acquireTabLock, getBrowserDb, type Db } from './db/client';
import { Tabs, type TabDef } from './ui/components/Tabs';
import { DbContext, useHashRoute } from './ui/hooks';
import { ImportPage } from './ui/pages/ImportPage';
import { TransactionsPage } from './ui/pages/TransactionsPage';

const TABS: TabDef[] = [
  { route: 'transactions', label: 'Transactions', iconPath: 'M4 6h16M4 12h16M4 18h10' },
  { route: 'import', label: 'Import', iconPath: 'M12 3v12m0 0l-5-5m5 5l5-5M4 20h16' },
];

type Status = { state: 'opening' } | { state: 'ready'; db: Db } | { state: 'locked' } | { state: 'error' };

export function App() {
  const [status, setStatus] = useState<Status>({ state: 'opening' });
  const route = useHashRoute('transactions');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!(await acquireTabLock())) return setStatus({ state: 'locked' });
      const db = await getBrowserDb();
      if (!cancelled) setStatus({ state: 'ready', db });
    })().catch(() => !cancelled && setStatus({ state: 'error' }));
    return () => {
      cancelled = true;
    };
  }, []);

  if (status.state !== 'ready') {
    return (
      <main className="splash">
        <h1>Tally</h1>
        {status.state === 'opening' && <p className="muted">Opening your data…</p>}
        {status.state === 'locked' && <p>Tally is open in another tab or window. Close it there, then reload this one.</p>}
        {status.state === 'error' && <p role="alert">Could not open the on-device database. Try reloading the page.</p>}
      </main>
    );
  }

  const active = TABS.some((t) => t.route === route) ? route : 'transactions';
  return (
    <DbContext.Provider value={status.db}>
      <Tabs tabs={TABS} active={active} />
      <main className="content">{active === 'import' ? <ImportPage /> : <TransactionsPage />}</main>
    </DbContext.Provider>
  );
}
