import { useState } from 'react';
import {
  addCategory,
  CategoryNameError,
  deleteCategory,
  deleteRule,
  eraseAllData,
  listAccounts,
  listCategories,
  listRules,
  renameAccount,
  renameCategory,
  setCategoryEarned,
  setCategoryFixed,
  type AccountRow,
  type CategoryRow,
} from '../../db/repo';
import { CATEGORY_NAME_MAX } from '../../lib/categories';
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
  const categories = useQuery((d) => listCategories(d), []);
  const spending = categories.data?.filter((c) => c.kind === 'expense') ?? [];
  const income = categories.data?.filter((c) => c.kind === 'income') ?? [];
  return (
    <Card title="Categories">
      <p className="muted small">
        Fixed costs (rent, insurance, subscriptions) stay about the same each month. The dashboard splits spending into fixed
        and variable. Earned income is pay for work; tithing is figured on earned income only.{' '}
        <a href="#/review">Sort uncategorized merchants</a>
      </p>
      <h3 className="small muted">Spending</h3>
      <ul className="list">
        {spending.map((c) => (
          <CategoryRowItem key={c.id} category={c} />
        ))}
      </ul>
      <h3 className="small muted">Income</h3>
      <ul className="list">
        {income.map((c) => (
          <CategoryRowItem key={c.id} category={c} />
        ))}
      </ul>
      <AddCategoryForm />
    </Card>
  );
}

function CategoryRowItem({ category }: { category: CategoryRow }) {
  const db = useDb();
  const { busy, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      await run(() => renameCategory(db, category.id, name));
      setEditing(false);
    } catch (e) {
      setError(e instanceof CategoryNameError ? e.message : 'Could not rename the category.');
    }
  }

  if (editing) {
    return (
      <li className="category-edit">
        <label className="field">
          <span className="visually-hidden">New name for {category.name}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={CATEGORY_NAME_MAX}
            enterKeyHint="done"
            onKeyDown={(e) => e.key === 'Enter' && void save()}
            autoFocus
          />
        </label>
        {error && <p role="alert" className="small error-text">{error}</p>}
        <div className="row-actions">
          <button type="button" className="btn btn-small" disabled={busy || !name.trim()} onClick={save}>
            Save
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => {
              setEditing(false);
              setName(category.name);
              setError(null);
              setConfirmDelete(false);
            }}
          >
            Cancel
          </button>
          {category.is_custom &&
            (confirmDelete ? (
              <button type="button" className="btn btn-danger btn-small" disabled={busy} onClick={() => run(() => deleteCategory(db, category.id))}>
                Delete {category.name}
              </button>
            ) : (
              <button type="button" className="btn btn-secondary btn-small" onClick={() => setConfirmDelete(true)}>
                Delete…
              </button>
            ))}
        </div>
        {confirmDelete && (
          <p className="muted small">
            Its transactions go back to automatic categories (usually Uncategorized), and its rules and budget are removed.
          </p>
        )}
      </li>
    );
  }

  return (
    <li className="list-row">
      <span className="grow">{category.name}</span>
      {category.kind === 'expense' && (
        <label className="check">
          <input
            type="checkbox"
            checked={category.is_fixed}
            disabled={busy}
            onChange={(e) => run(() => setCategoryFixed(db, category.id, e.target.checked))}
          />
          <span>Fixed</span>
        </label>
      )}
      {category.kind === 'income' && (
        <label className="check">
          <input
            type="checkbox"
            checked={category.is_earned}
            disabled={busy}
            onChange={(e) => run(() => setCategoryEarned(db, category.id, e.target.checked))}
          />
          <span>Earned</span>
        </label>
      )}
      <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditing(true)} aria-label={`Edit ${category.name}`}>
        Edit
      </button>
    </li>
  );
}

function AddCategoryForm() {
  const db = useDb();
  const { busy, run } = useAction();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [isFixed, setIsFixed] = useState(false);
  const [isEarned, setIsEarned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  async function add() {
    setError(null);
    setAdded(null);
    try {
      await run(() => addCategory(db, name, kind, isFixed, isEarned));
      setAdded(name.trim());
      setName('');
      setIsFixed(false);
      setIsEarned(false);
    } catch (e) {
      setError(e instanceof CategoryNameError ? e.message : 'Could not add the category.');
    }
  }

  return (
    <div className="add-category">
      <h3 className="small">Add a category</h3>
      <div className="filters">
        <label className="grow">
          <span className="visually-hidden">Category name</span>
          <input
            type="text"
            placeholder="Name, e.g. School & work"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={CATEGORY_NAME_MAX}
            enterKeyHint="done"
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && void add()}
          />
        </label>
        <label>
          <span className="visually-hidden">Type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as 'expense' | 'income')}>
            <option value="expense">Spending</option>
            <option value="income">Income</option>
          </select>
        </label>
      </div>
      {kind === 'expense' && (
        <label className="check">
          <input type="checkbox" checked={isFixed} onChange={(e) => setIsFixed(e.target.checked)} />
          <span>Fixed cost (about the same every month)</span>
        </label>
      )}
      {kind === 'income' && (
        <label className="check">
          <input type="checkbox" checked={isEarned} onChange={(e) => setIsEarned(e.target.checked)} />
          <span>Earned income (pay for work; counts toward tithing)</span>
        </label>
      )}
      {error && <p role="alert" className="small error-text">{error}</p>}
      {added && (
        <p role="status" className="small">
          Added {added}. Pick it for a transaction in Activity, or for a merchant in{' '}
          <a href="#/review">uncategorized merchants</a>.
        </p>
      )}
      <button type="button" className="btn btn-block" disabled={busy || !name.trim()} onClick={add}>
        Add category
      </button>
    </div>
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
      <p className="small">Deletes every account, transaction, rule, budget, custom category, and subscription choice from this device. This cannot be undone.</p>
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
