import { useState, type ReactNode } from 'react';
import {
  countTransactions,
  listAccounts,
  listCategories,
  listMonths,
  listTransactions,
  type TransactionFilter,
  type TransactionRow,
} from '../../db/repo';
import type { Flow } from '../../lib/categories';
import { prettyMerchant } from '../../lib/merchant';
import { Money } from '../components/Money';
import { TransferHintBanners, UncategorizedBanner } from '../components/StatusBanners';
import { TransactionSheet } from '../components/TransactionSheet';
import { formatDateShort, formatMonth, plural } from '../format';
import { useQuery } from '../hooks';

const PAGE_SIZE = 200;

export function TransactionsPage() {
  const [month, setMonth] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [flow, setFlow] = useState<Flow | ''>('');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<TransactionRow | null>(null);

  const accounts = useQuery((db) => listAccounts(db), []);
  const categories = useQuery((db) => listCategories(db), []);
  const months = useQuery((db) => listMonths(db), []);

  const filter: TransactionFilter = {
    month: month || undefined,
    accountId: accountId || undefined,
    categoryId: categoryId || undefined,
    flow: flow || undefined,
    search: search || undefined,
  };
  const deps = [month, accountId, categoryId, flow, search];
  const total = useQuery((db) => countTransactions(db, filter), deps);
  const txns = useQuery((db) => listTransactions(db, { ...filter, limit }), [...deps, limit]);
  const resetPaging = () => setLimit(PAGE_SIZE);

  if (months.data?.length === 0) {
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
      <TransferHintBanners />
      <UncategorizedBanner />

      <div className="filters">
        <input
          type="search"
          placeholder="Search merchant or description"
          aria-label="Search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetPaging();
          }}
        />
        <Select label="Month" value={month} onChange={(v) => (setMonth(v), resetPaging())}>
          <option value="">All months</option>
          {months.data?.map((m) => (
            <option key={m} value={m}>
              {formatMonth(m)}
            </option>
          ))}
        </Select>
        <Select label="Account" value={accountId} onChange={(v) => (setAccountId(v), resetPaging())}>
          <option value="">All accounts</option>
          {accounts.data?.map((a) => (
            <option key={a.id} value={a.id}>
              {a.display_name}
            </option>
          ))}
        </Select>
        <Select label="Category" value={categoryId} onChange={(v) => (setCategoryId(v), resetPaging())}>
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select label="Type" value={flow} onChange={(v) => (setFlow(v as Flow | ''), resetPaging())}>
          <option value="">All types</option>
          <option value="spend">Spending</option>
          <option value="income">Income</option>
          <option value="transfer">Transfers</option>
        </Select>
      </div>
      {total.data !== undefined && <p className="muted small">{plural(total.data, 'transaction')}</p>}

      {txns.data && txns.data.length > 0 && (
        <ul className="txn-list">
          {txns.data.map((t) => (
            <TxnRow key={t.id} t={t} showAccount={!accountId} onOpen={() => setSelected(t)} />
          ))}
        </ul>
      )}
      {txns.data?.length === 0 && <p className="muted">No transactions match these filters.</p>}

      {txns.data && total.data !== undefined && txns.data.length < total.data && (
        <button type="button" className="btn btn-secondary btn-block" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
          Load more
        </button>
      )}

      {selected && <TransactionSheet txn={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label>
      <span className="visually-hidden">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </label>
  );
}

function TxnRow({ t, showAccount, onOpen }: { t: TransactionRow; showAccount: boolean; onOpen: () => void }) {
  const isTransfer = t.flow === 'transfer';
  return (
    <li className={`txn ${isTransfer ? 'txn-transfer' : ''}`}>
      <button type="button" className="txn-button" onClick={onOpen}>
        <span className="txn-main">
          <span className="txn-merchant">{prettyMerchant(t.merchant)}</span>
          <span className="txn-meta">
            {isTransfer ? <span className="chip chip-transfer">Transfer</span> : <span className="chip">{t.category_name}</span>}
            {t.transfer_hint && (
              <span className="chip chip-hint" title={`References account ending in ${t.transfer_hint}`}>
                ? transfer
              </span>
            )}
            {showAccount && <span className="txn-account">{t.account_name}</span>}
          </span>
        </span>
        <span className="txn-side">
          <Money cents={t.amount_cents} className="txn-amount" />
          <span className="txn-date">{formatDateShort(t.posted_on)}</span>
        </span>
      </button>
    </li>
  );
}
