import { useState } from 'react';
import {
  deleteRule,
  eraseAllData,
  listAccounts,
  listCategories,
  listRules,
  renameAccount,
  setCategoryFixed,
  type AccountRow,
} from '../../db/repo';
import { BackupCard, RestoreCard } from '../components/BackupCards';
import { Card } from '../components/Card';
import { bumpDataVersion, useDb, useQuery } from '../hooks';

export function SettingsPage() {
  return (
    <div className="page">
      <h1>Settings</h1>
      <BackupCard />
      <RestoreCard />
      <CategoriesCard />
      <RulesCard />
      <AccountsCard />
      <StorageCard />
      <PrivacyCard />
      <EraseCard />
    </div>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      bumpDataVersion();
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function CategoriesCard() {
  const db = useDb();
  const categories = useQuery((d) => listCategories(d), []);
  const { busy, run } = useAction();
  return (
    <Card title="Categories">
      <p className="muted small">Fixed costs (rent, insurance, subscriptions) stay about the same each month. The dashboard splits spending into fixed and variable.</p>
      <ul className="list">
        {categories.data
          ?.filter((c) => c.kind === 'expense')
          .map((c) => (
            <li key={c.id} className="list-row">
              <span>{c.name}</span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={c.is_fixed}
                  disabled={busy}
                  onChange={(e) => run(() => setCategoryFixed(db, c.id, e.target.checked))}
                />
                <span>Fixed</span>
              </label>
            </li>
          ))}
      </ul>
    </Card>
  );
}

function RulesCard() {
  const db = useDb();
  const rules = useQuery((d) => listRules(d), []);
  const { busy, run } = useAction();
  return (
    <Card title="Merchant rules">
      <p className="muted small">
        Created when you change a category with "Apply to all". Deleting a rule re-categorizes that merchant's
        transactions, except ones you edited individually.
      </p>
      {rules.data?.length === 0 && <p className="muted">No rules yet.</p>}
      <ul className="list">
        {rules.data?.map((r) => (
          <li key={r.id} className="list-row">
            <div>
              <div>
                {r.match_type === 'contains' ? 'Contains ' : ''}
                <strong>{r.pattern}</strong> → {r.category_name}
              </div>
              <div className="muted small">{r.matches} matching transactions</div>
            </div>
            <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => run(() => deleteRule(db, r.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AccountsCard() {
  const accounts = useQuery((d) => listAccounts(d), []);
  if (!accounts.data || accounts.data.length === 0) return null;
  return (
    <Card title="Account names">
      <ul className="list">
        {accounts.data.map((a) => (
          <AccountNameRow key={a.id} account={a} />
        ))}
      </ul>
    </Card>
  );
}

function AccountNameRow({ account }: { account: AccountRow }) {
  const db = useDb();
  const [name, setName] = useState(account.display_name);
  const { busy, run } = useAction();
  const dirty = name.trim() !== account.display_name && name.trim() !== '';
  return (
    <li className="list-row">
      <label className="grow">
        <span className="visually-hidden">Name for account ending in {account.last4}</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </label>
      <button type="button" className="btn btn-secondary btn-small" disabled={!dirty || busy} onClick={() => run(() => renameAccount(db, account.id, name))}>
        Save
      </button>
    </li>
  );
}

function StorageCard() {
  const status = useQuery(async () => {
    const persisted = (await navigator.storage?.persisted?.()) ?? null;
    const estimate = (await navigator.storage?.estimate?.()) ?? null;
    return { persisted, usageMb: estimate?.usage != null ? Math.round(estimate.usage / 1e5) / 10 : null };
  }, []);
  return (
    <Card title="Storage">
      {status.data && (
        <ul className="plain small">
          <li>
            Persistent storage:{' '}
            {status.data.persisted === null
              ? 'unknown in this browser'
              : status.data.persisted
                ? 'granted (the browser will not clear Tally under storage pressure)'
                : 'not granted (on iPhone, install Tally to the Home Screen; keep backups)'}
          </li>
          {status.data.usageMb !== null && <li>Using about {status.data.usageMb} MB on this device</li>}
          <li>App version {__APP_VERSION__}</li>
        </ul>
      )}
    </Card>
  );
}

function PrivacyCard() {
  return (
    <Card title="Privacy">
      <ul className="plain small">
        <li>All data stays in this browser on this device. Tally makes no network requests with your data and has no server or account.</li>
        <li>
          Full account and card numbers are never stored, only the last 4 digits plus a SHA-256 hash used as an ID. The hash is not
          encryption: a card number could be recovered from it by brute force. Your real protection is your device passcode and
          encryption.
        </li>
        <li>Opening Tally in two tabs at once is blocked to protect the database.</li>
      </ul>
    </Card>
  );
}

function EraseCard() {
  const db = useDb();
  const [confirmText, setConfirmText] = useState('');
  const { busy, run } = useAction();
  return (
    <Card title="Erase all data" className="card-danger">
      <p className="small">Deletes every account, transaction, rule, and subscription choice from this device. This cannot be undone.</p>
      <label className="field">
        <span className="small">
          Type <strong>ERASE</strong> to confirm
        </span>
        <input type="text" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
      </label>
      <button
        type="button"
        className="btn btn-danger"
        disabled={confirmText !== 'ERASE' || busy}
        onClick={() =>
          run(async () => {
            await eraseAllData(db);
            setConfirmText('');
          })
        }
      >
        Erase everything
      </button>
    </Card>
  );
}
