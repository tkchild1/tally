import { monthInPeriod } from '../../lib/dates';
import { formatMonth } from '../format';

/** `<option>`s for a period picker: months grouped by year, each year led by "All of YYYY". */
export function PeriodOptions({ months }: { months: readonly string[] }) {
  const years = [...new Set(months.map((m) => m.slice(0, 4)))];
  return (
    <>
      {years.map((y) => (
        <optgroup key={y} label={y}>
          <option value={y}>All of {y}</option>
          {months
            .filter((m) => monthInPeriod(m, y))
            .map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}
