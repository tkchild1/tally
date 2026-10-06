import { useEffect, useState, type ReactElement } from 'react';
import { acquireTabLock, getBrowserDb, type Db } from './db/client';
import { Tabs, type TabDef } from './ui/components/Tabs';
import { DbContext, useHashRoute } from './ui/hooks';
import { DashboardPage } from './ui/pages/DashboardPage';
import { ImportPage } from './ui/pages/ImportPage';
import { SettingsPage } from './ui/pages/SettingsPage';
import { SubscriptionsPage } from './ui/pages/SubscriptionsPage';
import { TransactionsPage } from './ui/pages/TransactionsPage';

const TABS: TabDef[] = [
  { route: 'dashboard', label: 'Dashboard', iconPath: 'M4 20V10m6 10V4m6 16v-7m4 7H2' },
  { route: 'transactions', label: 'Transactions', iconPath: 'M4 6h16M4 12h16M4 18h10' },
  { route: 'subscriptions', label: 'Subscriptions', iconPath: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4' },
  { route: 'import', label: 'Import', iconPath: 'M12 3v12m0 0l-5-5m5 5l5-5M4 20h16' },
  { route: 'settings', label: 'Settings', iconPath: 'M4 7h10m4 0h2M4 17h4m4 0h8M14 4v6M8 14v6' },
];

const PAGES: Record<string, () => ReactElement> = {
  dashboard: DashboardPage,
  transactions: TransactionsPage,
  subscriptions: SubscriptionsPage,
  import: ImportPage,
  settings: SettingsPage,
};

type Status = { state: 'opening' } | { state: 'ready'; db: Db } | { state: 'locked' } | { state: 'error' };

export function App() {
  const [status, setStatus] = useState<Status>({ state: 'opening' });
  const route = useHashRoute('dashboard');

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

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  if (status.state !== 'ready') {
    return (
      <main className="splash">
        <h1>Tally</h1>
        {status.state === 'opening' && <p className="muted">Opening your dataΓÇª</p>}
        {status.state === 'locked' && <p>Tally is open in another tab or window. Close it there, then reload this one.</p>}
        {status.state === 'error' && <p role="alert">Could not open the on-device database. Try reloading the page.</p>}
      </main>
    );
  }

  const active = route in PAGES ? route : 'dashboard';
  const Page = PAGES[active]!;
  return (
    <DbContext.Provider value={status.db}>
      <Tabs tabs={TABS} active={active} />
      <main className="content">
        <Page />
      </main>
    </DbContext.Provider>
  );
}
