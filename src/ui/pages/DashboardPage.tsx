import { useState } from 'react';
import { balanceInputs, listAccounts, listMonths, monthlyTotals, spendingByCategory } from '../../db/repo';
import { balanceSeries } from '../../lib/balance';
import { TITHING_RATE_BP, tithingSummary, type TithingTotals } from '../../lib/tithing';
import { Banner } from '../components/Banner';
import { Card } from '../components/Card';
import { BalanceChart, CategoryChart, IncomeSpendingChart } from '../components/Charts';
import { Money } from '../components/Money';
import { BackupReminderBanner, CoverageBanners, TransferHintBanners } from '../components/StatusBanners';
import { loadDemoData } from '../demo';
import { formatDate, formatMonth } from '../format';
import { bumpDataVersion, useDb, useQuery } from '../hooks';

const CHART_MONTHS = 12;

export function DashboardPage() {
  const months = useQuery((d) => listMonths(d), []);
  const [picked, setPicked] = useState<string | null>(null);

  if (months.data === undefined) return <div className="page" />;
  if (months.data.length === 0) return <EmptyDashboard />;
  const month = picked && months.data.includes(picked) ? picked : months.data[0]!;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Dashboard</h1>
        <label>
          <span className="visually-hidden">Month</span>
          <select value={month} onChange={(e) => setPicked(e.target.value)}>
            {months.data.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <TransferHintBanners />
      <CoverageBanners />
      <BackupReminderBanner />

      <MonthSummary month={month} />
      <TithingCard month={month} />
      <AccountsCard />

      <Card title={`Spending by category, ${formatMonth(month)}`}>
        <CategorySection month={month} />
      </Card>
      <Card title="Income vs spending">
        <TrendSection />
      </Card>
      <Card title="Balance over time">
        <BalanceSection />
      </Card>
    </div>
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

function MonthSummary({ month }: { month: string }) {
  const totals = useQuery((d) => monthlyTotals(d), []);
  const t = totals.data?.find((x) => x.month === month);
  if (!t) return null;
  const net = t.income - t.spending;
  const fixedShare = t.spending > 0 ? Math.round((Math.max(0, t.fixed) / t.spending) * 100) : 0;

  return (
    <div className="kpis">
      <div className="kpi">
        <span className="kpi-label">Income</span>
        <Money cents={t.income} className="kpi-value" />
      </div>
      <div className="kpi">
        <span className="kpi-label">Spending</span>
        <Money cents={t.spending} className="kpi-value money-neutral" />
      </div>
      <div className="kpi">
        <span className="kpi-label">Net</span>
        <Money cents={net} signed className="kpi-value" />
      </div>
      <div className="kpi kpi-wide">
        <span className="kpi-label">Fixed vs variable spending</span>
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
      </div>
    </div>
  );
}

function TithingCard({ month }: { month: string }) {
  const totals = useQuery((d) => monthlyTotals(d), []);
  if (!totals.data) return null;
  const s = tithingSummary(
    totals.data.map((t) => ({ month: t.month, income: t.income, tithingPaid: t.tithing })),
    month,
  );
  return (
    <Card title={`Tithing (${TITHING_RATE_BP / 100}% of income)`}>
      <div className="tithing">
        <TithingColumn label={formatMonth(month)} t={s.month} />
        <TithingColumn label={`${month.slice(0, 4)} to date`} t={s.yearToDate} />
      </div>
      <p className="muted small">
        Based on income deposited to your accounts. Payments categorized as Tithing count as paid.
      </p>
    </Card>
  );
}

function TithingColumn({ label, t }: { label: string; t: TithingTotals }) {
  return (
    <section aria-label={`Tithing, ${label}`}>
      <h3 className="small muted">{label}</h3>
      <dl className="tithing-rows">
        <div>
          <dt>Owed</dt>
          <dd>
            <Money cents={t.owed} className="money-neutral" />
          </dd>
        </div>
        <div>
          <dt>Paid</dt>
          <dd>
            <Money cents={t.paid} className="money-neutral" />
          </dd>
        </div>
        <div className="tithing-remaining">
          <dt>{t.remaining >= 0 ? 'Still to pay' : 'Paid ahead'}</dt>
          <dd>
            <Money cents={Math.abs(t.remaining)} className="money-neutral" />
          </dd>
        </div>
      </dl>
    </section>
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
    <Card title="Accounts">
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
    </Card>
  );
}

function CategorySection({ month }: { month: string }) {
  const rows = useQuery((d) => spendingByCategory(d, month), [month]);
  if (!rows.data) return null;
  if (rows.data.length === 0) return <p className="muted">No spending this month.</p>;
  return <CategoryChart data={rows.data} />;
}

function TrendSection() {
  const totals = useQuery((d) => monthlyTotals(d), []);
  if (!totals.data) return null;
  return <IncomeSpendingChart data={totals.data.slice(-CHART_MONTHS)} />;
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
