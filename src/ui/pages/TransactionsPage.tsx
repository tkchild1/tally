import { useState } from 'react';
import { countTransactions, listAccounts, listTransactions, type TransactionRow } from '../../db/repo';
import { prettyMerchant } from '../../lib/merchant';
import { Money } from '../components/Money';
import { formatDateShort, plural } from '../format';
import { useQuery } from '../hooks';

const PAGE_SIZE = 200;

export function TransactionsPage() {
  const [accountId, setAccountId] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const accounts = useQuery((db) => listAccounts(db), []);
  const filter = accountId ? { accountId } : {};
  const total = useQuery((db) => countTransactions(db, filter), [accountId]);
  const txns = useQuery((db) => listTransactions(db, { ...filter, limit }), [accountId, limit]);

  if (total.data === 0 && !accountId) {
    return (
      <div className="page">
        <h1>Transactions</h1>
        <p className="muted">
          No transactions yet. <a href="#/import">Import a file or load demo data.</a>
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Transactions</h1>
      <div className="filters">
        <label>
          <span className="visually-hidden">Account</span>
          <select
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              setLimit(PAGE_SIZE);
            }}
          >
            <option value="">All accounts</option>
            {accounts.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.display_name}
              </option>
            ))}
          </select>
        </label>
        {total.data !== undefined && <span className="muted small">{plural(total.data, 'transaction')}</span>}
      </div>

      {txns.error && <p role="alert">Could not load transactions.</p>}
      <ul className="txn-list">
        {txns.data?.map((t) => <TxnRow key={t.id} t={t} showAccount={!accountId} />)}
      </ul>

      {txns.data && total.data !== undefined && txns.data.length < total.data && (
        <button type="button" className="btn btn-secondary btn-block" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
          Load more
        </button>
      )}
    </div>
  );
}

function TxnRow({ t, showAccount }: { t: TransactionRow; showAccount: boolean }) {
  return (
    <li className="txn">
      <span className="txn-date">{formatDateShort(t.posted_on)}</span>
      <span className="txn-main">
        <span className="txn-merchant">{prettyMerchant(t.merchant)}</span>
        <span className="txn-meta">
          <span className="chip">{t.category_name}</span>
          {showAccount && <span className="muted small">{t.account_name}</span>}
        </span>
      </span>
      <Money cents={t.amount_cents} className="txn-amount" />
    </li>
  );
}
