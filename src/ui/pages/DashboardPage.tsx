import { useEffect, useState } from 'react';
import {
  balanceInputs,
  filterSummary,
  listAccounts,
  listCategories,
  listMonths,
  monthlyTotals,
  spendingByCategory,
  topMerchants,
  type DashboardFilter,
  type MonthTotalRow,
} from '../../db/repo';
import { balanceSeries } from '../../lib/balance';
import { isYearPeriod, monthInPeriod, todayISO } from '../../lib/dates';
import { prettyMerchant } from '../../lib/merchant';
import { loadBudgetSummary } from '../budgets';
import { BudgetBar } from '../components/BudgetBar';
import { TITHING_RATE_BP, tithingSummary, type TithingTotals } from '../../lib/tithing';
import { Banner } from '../components/Banner';
import { Card } from '../components/Card';
import { CollapsibleCard } from '../components/CollapsibleCard';
import { BalanceChart, CategoryChart, IncomeSpendingChart, MonthlySpendChart } from '../components/Charts';
import { Money } from '../components/Money';
import { BackupReminderBanner, CoverageBanners, TransferHintBanners, UncategorizedBanner } from '../components/StatusBanners';
import { loadDemoData } from '../demo';
import { formatDate, formatMonth, formatPeriod, plural } from '../format';
import { bumpDataVersion, useDb, useQuery } from '../hooks';

const CHART_MONTHS = 12;

export function DashboardPage() {
  const months = useQuery((d) => listMonths(d), []);
  const categories = useQuery((d) => listCategories(d), []);
  const [picked, setPicked] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  if (months.data === undefined) return <div className="page" />;
  if (months.data.length === 0) return <EmptyDashboard />;
  const monthList = months.data;
  const years = [...new Set(monthList.map((m) => m.slice(0, 4)))];
  const period = picked && (monthList.includes(picked) || years.includes(picked)) ? picked : monthList[0]!;
  const filter: DashboardFilter = { search: search || undefined, categoryId: categoryId || undefined };
  const filtered = Boolean(filter.search || filter.categoryId);
  const categoryName = categories.data?.find((c) => c.id === categoryId)?.name;
  const filterLabel = [categoryName, search && `“${search}”`].filter(Boolean).join(', ') || 'all spending';

  return (
    <div className="page">
      <div className="page-head">
        <h1>Dashboard</h1>
        <label>
          <span className="visually-hidden">Month or year</span>
          <select value={period} onChange={(e) => setPicked(e.target.value)}>
            {years.map((y) => (
              <optgroup key={y} label={y}>
                <option value={y}>All of {y}</option>
                {monthList
                  .filter((m) => monthInPeriod(m, y))
                  .map((m) => (
                    <option key={m} value={m}>
                      {formatMonth(m)}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>

      <div className="filters dash-filters" role="search">
        <label className="grow">
          <span className="visually-hidden">Filter the dashboard</span>
          <input
            type="search"
            placeholder="Filter, e.g. golf"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            enterKeyHint="search"
          />
        </label>
        <label>
          <span className="visually-hidden">Category</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">All categories</option>
            {categories.data
              ?.filter((c) => c.kind !== 'system')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </label>
      </div>

      {filtered ? (
        <Banner>
          <p>
            Showing only <strong>{filterLabel}</strong>. Balances and tithing are hidden while filtering.
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            onClick={() => {
              setSearchInput('');
              setSearch('');
              setCategoryId('');
            }}
          >
            Clear filter
          </button>
        </Banner>
      ) : (
        <>
          <TransferHintBanners />
          <CoverageBanners />
          <UncategorizedBanner />
          <BackupReminderBanner />
        </>
      )}

      <PeriodSummary period={period} filter={filter} />
      {filtered && <FilterSummaryCard filter={filter} label={filterLabel} monthCount={months.data.length} />}
      {!filtered && <BudgetsCard period={period} />}
      {!filtered && <AccountsCard />}

      <CollapsibleCard id="monthly-spending" title={`Monthly spending, ${filterLabel}`}>
        <MonthlySpendSection filter={filter} period={period} label={filterLabel} />
      </CollapsibleCard>
      {filter.categoryId ? (
        <CollapsibleCard id="top-merchants" title={`Top merchants, ${formatPeriod(period)}`}>
          <MerchantList filter={filter} period={period} />
        </CollapsibleCard>
      ) : (
        <CollapsibleCard id="by-category" title={`Spending by category, ${formatPeriod(period)}`}>
          <CategorySection period={period} filter={filter} />
        </CollapsibleCard>
      )}
      <CollapsibleCard id="income-vs-spending" title="Income vs spending" defaultOpen={false}>
        <TrendSection filter={filter} />
      </CollapsibleCard>
      {!filtered && (
        <CollapsibleCard id="balance" title="Balance over time" defaultOpen={false}>
          <BalanceSection />
        </CollapsibleCard>
      )}
      {!filtered && <TithingCard period={period} />}
    </div>
  );
}

/** Every month that has any data, oldest first, with zeros where the filter matched nothing. */
function useFilteredMonths(filter: DashboardFilter): MonthTotalRow[] | undefined {
  const q = useQuery(
    async (d) => {
      const [months, totals] = await Promise.all([listMonths(d), monthlyTotals(d, filter)]);
      const byMonth = new Map(totals.map((t) => [t.month, t]));
      return months
        .slice()
        .reverse()
        .map((m) => byMonth.get(m) ?? { month: m, income: 0, spending: 0, fixed: 0, variable: 0, tithing: 0 });
    },
    [filter.search, filter.categoryId],
  );
  return q.data;
}

/** "this month" or "in 2026", for sentences like "No spending this month." */
function periodPhrase(period: string): string {
  return isYearPeriod(period) ? `in ${period}` : 'this month';
}

function MonthlySpendSection({ filter, period, label }: { filter: DashboardFilter; period: string; label: string }) {
  const rows = useFilteredMonths(filter);
  if (!rows) return null;
  const shown = isYearPeriod(period) ? rows.filter((r) => monthInPeriod(r.month, period)) : rows.slice(-CHART_MONTHS);
  if (shown.every((t) => t.spending <= 0)) return <p className="muted">No spending matches this filter.</p>;
  return <MonthlySpendChart data={shown} selected={period} label={label} />;
}

function MerchantList({ filter, period }: { filter: DashboardFilter; period?: string }) {
  const rows = useQuery((d) => topMerchants(d, filter, period), [filter.search, filter.categoryId, period]);
  if (!rows.data) return null;
  if (rows.data.length === 0) return <p className="muted">No spending matches{period ? ` ${periodPhrase(period)}` : ''}.</p>;
  return (
    <ul className="list">
      {rows.data.map((m) => (
        <li key={m.merchant} className="list-row">
          <div>
            <div>{prettyMerchant(m.merchant)}</div>
            <div className="muted small">{plural(m.count, 'transaction')}</div>
          </div>
          <Money cents={m.total} className="money-neutral" />
        </li>
      ))}
    </ul>
  );
}

function FilterSummaryCard({ filter, label, monthCount }: { filter: DashboardFilter; label: string; monthCount: number }) {
  const summary = useQuery((d) => filterSummary(d, filter), [filter.search, filter.categoryId]);
  const s = summary.data;
  if (!s) return null;
  return (
    <Card title={`All time, ${label}`}>
      {s.first === null ? (
        <p className="muted">Nothing matches this filter.</p>
      ) : (
        <>
          <dl className="totals">
            <div>
              <dt>Total spent</dt>
              <dd>
                <Money cents={s.spent} className="money-neutral" />
              </dd>
            </div>
            <div>
              <dt>Per month</dt>
              <dd>
                <Money cents={Math.round(s.spent / Math.max(1, monthCount))} className="money-neutral" />
              </dd>
            </div>
            <div>
              <dt>Per purchase</dt>
              <dd>
                <Money cents={s.purchases ? Math.round(s.spent / s.purchases) : 0} className="money-neutral" />
              </dd>
            </div>
          </dl>
          <p className="muted small">
            {plural(s.purchases, 'purchase')} from {formatDate(s.first)} to {formatDate(s.last!)}, averaged over{' '}
            {plural(monthCount, 'month')} of data.
            {s.income > 0 && (
              <>
                {' '}
                Money in: <Money cents={s.income} className="money-neutral" />.
              </>
            )}
          </p>
          <h3 className="small muted">Top merchants</h3>
          <MerchantList filter={filter} />
        </>
      )}
    </Card>
  );
}

function EmptyDashboard() {
  const db = useDb();
  const [busy, setBusy] = useState(false);
  return (
    <div className="page">
      <h1>Dashboard</h1>
      <Banner>
        <p>No data yet. Import your bank's QFX exports, or try the app with fake demo data.</p>
        <div className="row-actions">
          <a className="btn" href="#/import">
            Import files
          </a>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await loadDemoData(db);
                bumpDataVersion();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Loading…' : 'Load demo data'}
          </button>
        </div>
      </Banner>
    </div>
  );
}

function PeriodSummary({ period, filter }: { period: string; filter: DashboardFilter }) {
  const totals = useQuery((d) => monthlyTotals(d, filter), [filter.search, filter.categoryId]);
  if (!totals.data) return null;
  const t = { income: 0, spending: 0, fixed: 0, variable: 0 };
  for (const r of totals.data) {
    if (!monthInPeriod(r.month, period)) continue;
    t.income += r.income;
    t.spending += r.spending;
    t.fixed += r.fixed;
    t.variable += r.variable;
  }
  const net = t.income - t.spending;
  const fixedShare = t.spending > 0 ? Math.round((Math.max(0, t.fixed) / t.spending) * 100) : 0;
  const inProgress = monthInPeriod(todayISO().slice(0, 7), period);
  const noIncomeYet = inProgress && t.income === 0 && !filter.search && !filter.categoryId;

  return (
    <div className="kpis">
      <div className="kpi">
        <span className="kpi-label">Income</span>
        <Money cents={t.income} className="kpi-value" />
        {noIncomeYet && <span className="kpi-note">None yet</span>}
      </div>
      <div className="kpi">
        <span className="kpi-label">{inProgress ? 'Spent so far' : 'Spending'}</span>
        <Money cents={t.spending} className="kpi-value money-neutral" />
      </div>
      <div className="kpi">
        <span className="kpi-label">{inProgress ? 'Net so far' : 'Net'}</span>
        <Money cents={net} signed className={noIncomeYet ? 'kpi-value money-neutral' : 'kpi-value'} />      </div>
      <div className="kpi kpi-wide">
        <span className="kpi-label">Fixed vs variable spending</span>
        {t.spending <= 0 ? (
          <p className="muted small">No spending {periodPhrase(period)}.</p>
        ) : (
          <>
            <div className="split" role="img" aria-label={`Fixed ${fixedShare} percent, variable ${100 - fixedShare} percent`}>
              <span className="split-fixed" style={{ width: `${fixedShare}%` }} />
            </div>
            <div className="split-legend small">
              <span>
                <span className="swatch swatch-fixed" aria-hidden="true" /> Fixed <Money cents={t.fixed} className="money-neutral" />
              </span>
              <span>
                <span className="swatch swatch-variable" aria-hidden="true" /> Variable{' '}
                <Money cents={t.variable} className="money-neutral" />
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const DASHBOARD_BUDGETS = 4;

function BudgetsCard({ period }: { period: string }) {
  const summary = useQuery((d) => loadBudgetSummary(d, period), [period]);
  const s = summary.data;
  if (!s) return null;
  if (s.rows.length === 0) {
    return (
      <Card title="Budgets">
        <p className="small">
          No budgets yet. <a href="#/budgets">Set a monthly limit</a> for categories like Dining or Shopping.
        </p>
      </Card>
    );
  }
  const worst = [...s.rows].sort((a, b) => b.ratio - a.ratio).slice(0, DASHBOARD_BUDGETS);
  const pace = s.monthElapsed > 0 && s.monthElapsed < 1 ? s.monthElapsed : null;
  const year = isYearPeriod(period);
  const over = s.rows.filter((r) => r.status === 'over').length;
  const near = s.rows.filter((r) => r.status === 'near').length;
  const status = over ? `${over} over budget` : near ? `${near} almost at limit` : 'All on track';
  return (
    <CollapsibleCard id="budgets" title={`Budgets, ${formatPeriod(period)}`} summary={status}>
      <ul className="list">
        {worst.map((r) => (
          <li key={r.categoryId} className="budget-item">
            <BudgetBar row={r} pace={pace} unit={year ? 'year' : 'month'} />
          </li>
        ))}
      </ul>
      {year && <p className="muted small">Monthly limits × the months of {period} that have data.</p>}
      <p className="small">
        <a href="#/budgets">
          {s.rows.length > worst.length ? `All ${s.rows.length} budgets` : 'Manage budgets'}
        </a>
      </p>
    </CollapsibleCard>
  );
}

function TithingCard({ period }: { period: string }) {
  const totals = useQuery((d) => monthlyTotals(d), []);
  if (!totals.data) return null;
  const year = isYearPeriod(period);
  const s = tithingSummary(
    totals.data.map((t) => ({ month: t.month, income: t.income, tithingPaid: t.tithing })),
    year ? `${period}-12` : period,
  );
  const headline = year ? s.yearToDate : s.month;
  const y = period.slice(0, 4);
  const yearLabel = !year || todayISO().startsWith(y) ? `${y} to date` : y;
  return (
    <CollapsibleCard
      id="tithing"
      title={`Tithing (${TITHING_RATE_BP / 100}% of income)`}
      summary={
        <>
          <Money cents={Math.abs(headline.remaining)} className="money-neutral" />{' '}
          {headline.remaining >= 0 ? 'still to pay' : 'paid ahead'} {periodPhrase(period)}
        </>
      }
    >
      <ul className="list">
        {!year && <TithingRow label={formatMonth(period)} t={s.month} />}
        <TithingRow label={yearLabel} t={s.yearToDate} />
      </ul>
      <p className="muted small">Payments in the Tithing category count as paid.</p>
    </CollapsibleCard>
  );
}

function TithingRow({ label, t }: { label: string; t: TithingTotals }) {
  const ratio = t.owed > 0 ? Math.min(1, t.paid / t.owed) : t.paid > 0 ? 1 : 0;
  const empty = t.owed === 0 && t.paid === 0;
  return (
    <li className="tithing-row">
      <div className="tithing-head">
        <span>{label}</span>
        <strong className="tithing-status">
          {empty ? (
            'Nothing owed yet'
          ) : t.remaining > 0 ? (
            <>
              <Money cents={t.remaining} className="money-neutral" /> to pay
            </>
          ) : t.remaining < 0 ? (
            <>
              <Money cents={-t.remaining} className="money-neutral" /> ahead
            </>
          ) : (
            'Paid in full'
          )}
        </strong>
      </div>
      {!empty && (
        <>
          <div className="budget-track" aria-hidden="true">
            <span className="budget-fill budget-fill-under" style={{ width: `${Math.round(ratio * 100)}%` }} />
          </div>
          <div className="muted small">
            Paid <Money cents={t.paid} className="money-neutral" /> of <Money cents={t.owed} className="money-neutral" />
          </div>
        </>
      )}
    </li>
  );
}

function AccountsCard() {
  const accounts = useQuery((d) => listAccounts(d), []);
  if (!accounts.data) return null;
  const sum = (pred: (k: string) => boolean) =>
    accounts.data!.filter((a) => pred(a.kind)).reduce((s, a) => s + (a.balance_cents ?? 0), 0);
  const cash = sum((k) => k !== 'credit_card');
  const card = sum((k) => k === 'credit_card');

  return (
    <CollapsibleCard
      id="accounts"
      title="Accounts"
      summary={
        <>
          Net after card <Money cents={cash + card} className="money-neutral" />
        </>
      }
    >
      <ul className="list">
        {accounts.data.map((a) => (
          <li key={a.id} className="list-row">
            <div>
              <div>{a.display_name}</div>
              <div className="muted small">{a.balance_as_of ? `as of ${formatDate(a.balance_as_of)}` : 'no balance yet'}</div>
            </div>
            {a.balance_cents !== null && <Money cents={a.balance_cents} className="money-neutral" />}
          </li>
        ))}
      </ul>
      <dl className="totals">
        <div>
          <dt>Cash</dt>
          <dd>
            <Money cents={cash} className="money-neutral" />
          </dd>
        </div>
        <div>
          <dt>Card owed</dt>
          <dd>
            <Money cents={-card} className="money-neutral" />
          </dd>
        </div>
        <div>
          <dt>Net after card</dt>
          <dd>
            <Money cents={cash + card} className="money-neutral" />
          </dd>
        </div>
      </dl>
    </CollapsibleCard>
  );
}

function CategorySection({ period, filter }: { period: string; filter: DashboardFilter }) {
  const rows = useQuery((d) => spendingByCategory(d, period, filter), [period, filter.search, filter.categoryId]);
  if (!rows.data) return null;
  if (rows.data.length === 0) return <p className="muted">No spending {periodPhrase(period)}.</p>;
  return <CategoryChart data={rows.data} />;
}

function TrendSection({ filter }: { filter: DashboardFilter }) {
  const rows = useFilteredMonths(filter);
  if (!rows) return null;
  return <IncomeSpendingChart data={rows.slice(-CHART_MONTHS)} />;
}

function BalanceSection() {
  const series = useQuery(async (d) => {
    const { accounts, txns, snapshots } = await balanceInputs(d);
    return balanceSeries(accounts, txns, snapshots);
  }, []);
  if (!series.data) return null;
  if (series.data.length === 0) return <p className="muted">Balances appear once an import includes a balance.</p>;
  return <BalanceChart data={series.data} />;
}
