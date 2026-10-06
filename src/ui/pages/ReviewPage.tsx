import { useState } from 'react';
import { listCategories, setMerchantCategory, uncategorizedMerchants, type UncategorizedMerchantRow } from '../../db/repo';
import { prettyMerchant } from '../../lib/merchant';
import { Money } from '../components/Money';
import { formatDate, plural } from '../format';
import { bumpDataVersion, useDb, useQuery } from '../hooks';

/** Every merchant with uncategorized spending, so each can be given a category once (a rule for future imports too). */
export function ReviewPage() {
  const merchants = useQuery((d) => uncategorizedMerchants(d), []);
  const categories = useQuery((d) => listCategories(d), []);
  const [done, setDone] = useState(0);

  if (!merchants.data || !categories.data) return <div className="page" />;
  const choices = categories.data.filter((c) => c.kind === 'expense' && c.id !== 'uncategorized');

  return (
    <div className="page">
      <h1>Needs a category</h1>
      {merchants.data.length === 0 ? (
        <div className="card">
          <p>{done > 0 ? `All sorted. ${plural(done, 'merchant')} categorized.` : 'Nothing is uncategorized right now.'}</p>
          <p className="small">
            <a href="#/transactions">Back to Activity</a>
          </p>
        </div>
      ) : (
        <>
          <p className="muted small">
            Pick a category for each merchant. It applies to all of its transactions and to future imports. Don't see the
            right category? <a href="#/settings">Add one in Settings</a>.
          </p>
          <ul className="txn-list">
            {merchants.data.map((m) => (
              <MerchantRow key={m.merchant} row={m} choices={choices} onDone={() => setDone((n) => n + 1)} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function MerchantRow({
  row,
  choices,
  onDone,
}: {
  row: UncategorizedMerchantRow;
  choices: { id: string; name: string }[];
  onDone: () => void;
}) {
  const db = useDb();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const name = prettyMerchant(row.merchant);

  async function choose(categoryId: string) {
    if (!categoryId) return;
    setBusy(true);
    setError(false);
    try {
      await setMerchantCategory(db, row.merchant, categoryId);
      onDone();
      bumpDataVersion();
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <li className="txn review-row">
      <div className="review-head">
        <span className="txn-merchant">{name}</span>
        <Money cents={row.total} className="money-neutral txn-amount" />
      </div>
      <div className="muted small">
        {plural(row.count, 'purchase')} · last {formatDate(row.last)}
      </div>
      <label>
        <span className="visually-hidden">Category for {name}</span>
        <select value="" disabled={busy} onChange={(e) => void choose(e.target.value)}>
          <option value="">{busy ? 'Saving…' : 'Choose a category'}</option>
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="small error-text">
          Could not save. Try again.
        </p>
      )}
    </li>
  );
}
