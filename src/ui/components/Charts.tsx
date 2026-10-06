import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  LabelList,
} from 'recharts';
import type { BalancePoint } from '../../lib/balance';
import { formatCents } from '../../lib/money';
import type { CategorySpendRow, MonthTotalRow } from '../../db/repo';
import { formatCompactCents, formatDate, formatDateShort, formatMonth } from '../format';

/** Color-blind-safe categorical palette (README section 10). Never the only signal. */
export const PALETTE = { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a' } as const;

const animate = !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

const money = (v: unknown) => (typeof v === 'number' ? formatCents(v) : String(v));

function DataTable({ caption, head, rows }: { caption: string; head: string[]; rows: string[][] }) {
  return (
    <details className="chart-table">
      <summary>Show as table</summary>
      <table>
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>))}
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function IncomeSpendingChart({ data }: { data: MonthTotalRow[] }) {
  const rows = data.map((d) => ({ ...d, label: formatMonth(d.month, true) }));
  return (
    <figure className="chart">
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} />
            <YAxis tickFormatter={formatCompactCents} width={52} tickLine={false} axisLine={false} />
            <Tooltip formatter={money} labelFormatter={(_, p) => (p[0] ? formatMonth(p[0].payload.month) : '')} />
            <Legend />
            <Bar dataKey="income" name="Income" fill={PALETTE.aqua} radius={[3, 3, 0, 0]} isAnimationActive={animate} />
            <Bar dataKey="spending" name="Spending" fill={PALETTE.blue} radius={[3, 3, 0, 0]} isAnimationActive={animate} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        caption="Income and spending by month"
        head={['Month', 'Income', 'Spending', 'Net']}
        rows={data.map((d) => [formatMonth(d.month), formatCents(d.income), formatCents(d.spending), formatCents(d.income - d.spending)])}
      />
    </figure>
  );
}

/** Spending per month for the current filter, the selected month highlighted, with the average as a dashed line. */
export function MonthlySpendChart({ data, selected, label }: { data: MonthTotalRow[]; selected: string; label: string }) {
  const rows = data.map((d) => ({ month: d.month, spending: d.spending, label: formatMonth(d.month, true) }));
  const average = rows.length ? Math.round(rows.reduce((s, r) => s + r.spending, 0) / rows.length) : 0;
  return (
    <figure className="chart">
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} />
            <YAxis tickFormatter={formatCompactCents} width={52} tickLine={false} axisLine={false} />
            <Tooltip formatter={money} labelFormatter={(_, p) => (p[0] ? formatMonth(p[0].payload.month) : '')} />
            <ReferenceLine y={average} stroke={PALETTE.orange} strokeDasharray="6 4" />
            <Bar dataKey="spending" name="Spent" radius={[3, 3, 0, 0]} isAnimationActive={animate}>
              {rows.map((r) => (
                <Cell key={r.month} fill={PALETTE.blue} fillOpacity={r.month === selected ? 1 : 0.45} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="muted small">
        Dashed line: monthly average, {formatCents(average)}. The selected month is darker.
      </p>
      <DataTable
        caption={`Monthly spending, ${label}`}
        head={['Month', 'Spent']}
        rows={data.map((d) => [formatMonth(d.month), formatCents(d.spending)])}
      />
    </figure>
  );
}

export function CategoryChart({ data }: { data: CategorySpendRow[] }) {
  const rows = data.map((d) => ({ ...d, label: d.is_fixed ? `${d.name} (fixed)` : d.name }));
  return (
    <figure className="chart">
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={Math.max(120, rows.length * 34 + 16)}>
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="label" width={150} tickLine={false} axisLine={false} interval={0} />
            <Tooltip formatter={money} />
            <Bar dataKey="total" name="Spent" fill={PALETTE.blue} radius={[0, 3, 3, 0]} isAnimationActive={animate}>
              <LabelList dataKey="total" position="right" formatter={(v: unknown) => money(v)} className="bar-label" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        caption="Spending by category"
        head={['Category', 'Type', 'Spent']}
        rows={data.map((d) => [d.name, d.is_fixed ? 'Fixed' : 'Variable', formatCents(d.total)])}
      />
    </figure>
  );
}

export function BalanceChart({ data }: { data: BalancePoint[] }) {
  // Weekly table rows keep the text equivalent readable.
  const tableRows = data.filter((_, i) => i % 7 === 0 || i === data.length - 1);
  return (
    <figure className="chart">
      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatDateShort} minTickGap={40} tickLine={false} />
            <YAxis tickFormatter={formatCompactCents} width={56} tickLine={false} axisLine={false} />
            <Tooltip formatter={money} labelFormatter={(d) => formatDate(String(d))} />
            <Legend />
            <Line type="stepAfter" dataKey="cash" name="Cash" stroke={PALETTE.aqua} strokeWidth={2} dot={false} isAnimationActive={animate} />
            <Line
              isAnimationActive={animate}
              type="stepAfter"
              dataKey="net"
              name="Net (after card)"
              stroke={PALETTE.orange}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <DataTable
        caption="Balance over time"
        head={['Date', 'Cash', 'Net after card']}
        rows={tableRows.map((p) => [formatDate(p.date), formatCents(p.cash), formatCents(p.net)])}
      />
    </figure>
  );
}
