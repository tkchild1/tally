import { useState } from 'react';
import { categorySpendByMonth, deleteBudget, listCategories, listMonths, setBudget } from '../../db/repo';
import { typicalSpending, type BudgetProgress } from '../../lib/budgets';
import { todayISO } from '../../lib/dates';
import { formatCents, parseAmountToCents } from '../../lib/money';
import { loadBudgetSummary } from '../budgets';
import { Banner } from '../components/Banner';
import { BudgetBar } from '../components/BudgetBar';
import { Card } from '../components/Card';
import { Money } from '../components/Money';
import { formatMonth } from '../format';
import { bumpDataVersion, useDb, useQuery } from '../hooks';

/** Parses "250", "$1,200.50"; null for anything that isn't a non-negative amount. */
function parseBudgetInput(text: string): number | null {
  try {
    const cents = parseAmountToCents(text.replace(/[$\s]/g, ''));
    return cents >= 0 ? cents : null;
  } catch {
    return null;
  }
}

export function BudgetsPage() {
  const months = useQuery((d) => listMonths(d), []);
  const [picked, setPicked] = useState<string | null>(null);
  const current = todayISO().slice(0, 7);
  const options = months.data ? [...new Set([current, ...months.data])].sort().reverse() : [];
  const month = picked && options.includes(picked) ? picked : (options[0] ?? current);
  const summary = useQuery((d) => loadBudgetSummary(d, month), [month]);
  const typical = useQuery(async (d) => typicalSpending(await categorySpendByMonth(d), await listMonths(d), current), [current]);

  if (!summary.data || months.data === undefined) return <div className="page" />;
  const s = summary.data;
  const pace = month === current ? s.monthElapsed : null;
  const rows = [...s.rows].sort((a, b) => b.ratio - a.ratio || a.name.localeCompare(b.name));

  return (
    <div className="page">
      <div className="page-head">
        <h1>Budgets</h1>
        <label>
          <span className="visually-hidden">Month</span>
          <select value={month} onChange={(e) => setPicked(e.target.value)}>
            {options.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {s.rows.length === 0 ? (
        <Banner>
          <p>
            Set a monthly limit for the categories you want to keep an eye on, like Dining or Shopping. Spending is counted
            automatically from your imports.
          </p>
        </Banner>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <span className="kpi-label">Budgeted</span>
              <Money cents={s.totalLimitCents} className="kpi-value money-neutral" />
            </div>
            <div className="kpi">
              <span className="kpi-label">Spent</span>
              <Money cents={s.totalSpentCents} className="kpi-value money-neutral" />
            </div>
            <div className="kpi">
              <span className="kpi-label">{s.totalLimitCents - s.totalSpentCents >= 0 ? 'Left' : 'Over'}</span>
              <Money cents={Math.abs(s.totalLimitCents - s.totalSpentCents)} className="kpi-value money-neutral" />
            </div>
          </div>
          <Card title={formatMonth(month)}>
            {pace !== null && (
              <p className="muted small">
                {Math.round(pace * 100)}% of the month has passed (the thin line on each bar).
              </p>
            )}
            <ul className="list">
              {rows.map((r) => (
                <BudgetRowItem key={r.categoryId} row={r} pace={pace} typical={typical.data?.get(r.categoryId)} />
              ))}
            </ul>
            {s.unbudgetedCents > 0 && (
              <p className="muted small">
                Plus {formatCents(s.unbudgetedCents)} of spending in categories without a budget.
              </p>
            )}
          </Card>
        </>
      )}

      <AddBudgetCard budgeted={new Set(s.rows.map((r) => r.categoryId))} typical={typical.data} />
    </div>
  );
}

function BudgetRowItem({ row, pace, typical }: { row: BudgetProgress; pace: number | null; typical: number | undefined }) {
  const db = useDb();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const cents = parseBudgetInput(text);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      setEditing(false);
      bumpDataVersion();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="budget-item">
      <BudgetBar row={row} pace={pace} />
      {editing ? (
        <form
          className="row-actions"
          onSubmit={(e) => {
            e.preventDefault();
            if (cents !== null) void act(() => setBudget(db, row.categoryId, cents));
          }}
        >
          <label className="grow">
            <span className="visually-hidden">Monthly limit for {row.name}</span>
            <input type="text" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          </label>
          <button type="submit" className="btn btn-small" disabled={busy || cents === null}>
            Save
          </button>
          <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={() => void act(() => deleteBudget(db, row.categoryId))}>
            Remove
          </button>
        </form>
      ) : (
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => {
              setText((row.limitCents / 100).toFixed(2));
              setEditing(true);
            }}
            aria-label={`Change the ${row.name} budget`}
          >
            Change
          </button>
          {typical !== undefined && <span className="muted small">Usually {formatCents(typical)} a month</span>}
        </div>
      )}
    </li>
  );
}

function AddBudgetCard({ budgeted, typical }: { budgeted: Set<string>; typical: Map<string, number> | undefined }) {
  const db = useDb();
  const categories = useQuery((d) => listCategories(d), []);
  const [categoryId, setCategoryId] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const available = categories.data?.filter((c) => c.kind === 'expense' && !budgeted.has(c.id)) ?? [];
  const chosen = available.some((c) => c.id === categoryId) ? categoryId : '';
  const cents = parseBudgetInput(text);
  const hint = chosen ? typical?.get(chosen) : undefined;

  if (categories.data && available.length === 0) return null;

  return (
    <Card title="Add a budget">
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!chosen || cents === null) return;
          setBusy(true);
          try {
            await setBudget(db, chosen, cents);
            setCategoryId('');
            setText('');
            bumpDataVersion();
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>Category</span>
          <select value={chosen} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Choose a category</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Monthly limit</span>
          <input type="text" inputMode="decimal" placeholder="e.g. 300" value={text} onChange={(e) => setText(e.target.value)} />
          {hint !== undefined && (
            <span className="muted small">
              You usually spend about {formatCents(hint)} a month here.{' '}
              {!text && (
                <button type="button" className="link-button" onClick={() => setText((hint / 100).toFixed(0))}>
                  Use that
                </button>
              )}
            </span>
          )}
          {text && cents === null && <span className="small">Enter an amount like 250 or 1,200.50.</span>}
        </label>
        <button type="submit" className="btn" disabled={busy || !chosen || cents === null}>
          Add budget
        </button>
      </form>
    </Card>
  );
}
