import { useState } from 'react';
import { listCategories, listMerchantFlags, listSpendCharges, setMerchantFlag } from '../../db/repo';
import { todayISO } from '../../lib/dates';
import { prettyMerchant } from '../../lib/merchant';
import { detectSubscriptions, type MerchantFlag, type Subscription } from '../../lib/subscriptions';
import { Card } from '../components/Card';
import { Money } from '../components/Money';
import { CADENCE_LABEL, formatDate, plural } from '../format';
import { bumpDataVersion, useDb, useQuery } from '../hooks';

export function SubscriptionsPage() {
  const data = useQuery(async (db) => {
    const [charges, flags, categories] = await Promise.all([listSpendCharges(db), listMerchantFlags(db), listCategories(db)]);
    return {
      subs: detectSubscriptions(charges, todayISO(), flags),
      dismissed: [...flags].filter(([, s]) => s === 'dismissed').map(([m]) => m).sort(),
      categoryName: new Map(categories.map((c) => [c.id, c.name])),
    };
  }, []);

  if (!data.data) return <div className="page" />;
  const { subs, dismissed, categoryName } = data.data;
  const active = subs.filter((s) => s.active);
  const lapsed = subs.filter((s) => !s.active);
  const monthly = active.reduce((s, x) => s + x.monthlyCents, 0);
  const yearly = active.reduce((s, x) => s + x.yearlyCents, 0);

  return (
    <div className="page">
      <h1>Subscriptions</h1>
      <div className="kpis">
        <div className="kpi">
          <span className="kpi-label">Per month</span>
          <Money cents={monthly} className="kpi-value money-neutral" />
        </div>
        <div className="kpi">
          <span className="kpi-label">Per year</span>
          <Money cents={yearly} className="kpi-value money-neutral" />
        </div>
        <div className="kpi">
          <span className="kpi-label">Active</span>
          <span className="kpi-value">{active.length}</span>
        </div>
      </div>

      {active.length === 0 ? (
        <p className="muted">
          No recurring charges detected yet. They appear after a few charges at a regular interval. To track one now, open
          a charge in Transactions and choose "Track as a subscription".
        </p>
      ) : (
        <ul className="sub-list">
          {active.map((s) => (
            <SubRow key={s.merchant} sub={s} categoryName={categoryName.get(s.categoryId) ?? s.categoryId} />
          ))}
        </ul>
      )}

      {lapsed.length > 0 && (
        <details className="card">
          <summary className="card-title">Lapsed ({lapsed.length})</summary>
          <p className="muted small">No recent charge where one was expected. Possibly cancelled.</p>
          <ul className="sub-list">
            {lapsed.map((s) => (
              <SubRow key={s.merchant} sub={s} categoryName={categoryName.get(s.categoryId) ?? s.categoryId} />
            ))}
          </ul>
        </details>
      )}

      {dismissed.length > 0 && (
        <Card title={`Dismissed (${dismissed.length})`}>
          <ul className="list">
            {dismissed.map((m) => (
              <li key={m} className="list-row">
                <span>{prettyMerchant(m)}</span>
                <FlagButton merchant={m} state={null} label="Undo" />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function SubRow({ sub, categoryName }: { sub: Subscription; categoryName: string }) {
  return (
    <li className="sub">
      <div className="sub-head">
        <strong className="sub-name">{prettyMerchant(sub.merchant)}</strong>
        <span className="sub-price">
          <Money cents={sub.monthlyCents} className="money-neutral" />
          <span className="muted small">/mo</span>
        </span>
      </div>
      {(sub.priceChange || sub.confirmed) && (
        <div className="sub-chips">
          {sub.priceChange && (
            <span className="chip chip-hint">
              Price {sub.priceChange.latestCents > sub.priceChange.previousCents ? 'up' : 'down'} from{' '}
              <Money cents={sub.priceChange.previousCents} className="money-neutral" />
            </span>
          )}
          {sub.confirmed && <span className="chip">Confirmed</span>}
        </div>
      )}
      <div className="muted small">
        {CADENCE_LABEL[sub.cadence]}
        {sub.cadence !== 'monthly' && (
          <>
            , <Money cents={sub.currentCents} className="money-neutral" /> each
          </>
        )}{' '}
        · {categoryName} · {plural(sub.charges, 'charge')}
      </div>
      <div className="muted small">
        {sub.active ? <>Next about {formatDate(sub.nextExpected)} · last </> : 'Last '}
        {formatDate(sub.lastCharged)}
      </div>
      <div className="sub-actions">
        {!sub.confirmed && <FlagButton merchant={sub.merchant} state="confirmed" label="Confirm" />}
        <FlagButton merchant={sub.merchant} state="dismissed" label="Dismiss" />
      </div>
    </li>
  );
}

function FlagButton({ merchant, state, label }: { merchant: string; state: MerchantFlag | null; label: string }) {
  const db = useDb();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-secondary btn-small"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await setMerchantFlag(db, merchant, state);
          bumpDataVersion();
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </button>
  );
}
