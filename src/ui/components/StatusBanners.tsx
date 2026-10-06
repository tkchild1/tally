import { useState } from 'react';
import { lastBackupDate } from '../../db/backup';
import { countTransactions, listTransferHints, markHintAsTransfer, uncategorizedMerchants } from '../../db/repo';
import { daysBetween, todayISO } from '../../lib/dates';
import { loadCoverage } from '../coverage';
import { formatDate, plural } from '../format';
import { bumpDataVersion, useDb, useQuery } from '../hooks';
import { Banner } from './Banner';

const STALE_AFTER_DAYS = 7;
const BACKUP_REMINDER_DAYS = 30;

/** Unmatched transfer hints, with a one-tap fix. */
export function TransferHintBanners() {
  const db = useDb();
  const hints = useQuery((d) => listTransferHints(d), []);
  const [busy, setBusy] = useState(false);

  return (
    <>
      {hints.data?.map((h) => (
        <Banner key={h.hint} tone="warn">
          <p>
            {plural(h.count, 'payment')} reference an account ending in <strong>{h.hint}</strong> that you haven't
            imported, so {h.count === 1 ? 'it counts' : 'they count'} as spending. Import that account, or mark{' '}
            {h.count === 1 ? 'it' : 'them'} as transfers.
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await markHintAsTransfer(db, h.hint);
                bumpDataVersion();
              } finally {
                setBusy(false);
              }
            }}
          >
            Mark as transfers
          </button>
        </Banner>
      ))}
    </>
  );
}

function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Coverage gaps per account and a nudge for accounts whose newest data is getting old. */
export function CoverageBanners({ showStale = true }: { showStale?: boolean }) {
  const coverage = useQuery((d) => loadCoverage(d), []);
  if (!coverage.data) return null;
  const today = todayISO();
  const staleByEnd = new Map<string, string[]>();
  for (const { account, ranges } of coverage.data.accounts) {
    const end = ranges[ranges.length - 1]?.end;
    if (end && daysBetween(end, today) >= STALE_AFTER_DAYS) staleByEnd.set(end, [...(staleByEnd.get(end) ?? []), account.display_name]);
  }
  const stale = [...staleByEnd].sort(([a], [b]) => (a < b ? -1 : 1));
  const { accounts } = coverage.data;

  return (
    <>
      {accounts.flatMap(({ account, gaps }) =>
        gaps.map((g) => (
          <Banner key={`${account.id}-${g.start}`} tone="warn">
            {account.display_name} has no data between {formatDate(g.start)} and {formatDate(g.end)}, so balances before
            then may be off. Import an export that covers those dates.
          </Banner>
        )),
      )}
      {showStale && stale.length > 0 && (
        <Banner>
          {stale.map(([end, names]) => (
            <p key={end}>
              {joinNames(names)} {names.length === 1 ? 'has' : 'have'} nothing newer than {formatDate(end)} (
              {plural(daysBetween(end, today), 'day')} ago).
            </p>
          ))}
          <p>
            <a href="#/import">Import newer exports</a>
          </p>
        </Banner>
      )}
    </>
  );
}

/** Points to the review page while any merchant's spending is uncategorized. */
export function UncategorizedBanner() {
  const merchants = useQuery((d) => uncategorizedMerchants(d), []);
  const count = merchants.data?.length ?? 0;
  if (count === 0) return null;
  return (
    <Banner>
      {plural(count, 'merchant')} {count === 1 ? 'has' : 'have'} no category. <a href="#/review">Sort them in one place</a>
    </Banner>
  );
}

/** Monthly backup reminder: browser storage can be cleared, a backup file can't. */
export function BackupReminderBanner() {
  const info = useQuery(async (d) => ({ last: await lastBackupDate(d), hasData: (await countTransactions(d)) > 0 }), []);
  if (!info.data?.hasData) return null;
  const { last } = info.data;
  const age = last ? daysBetween(last, todayISO()) : null;
  if (age !== null && age < BACKUP_REMINDER_DAYS) return null;
  return (
    <Banner>
      {last ? `Your last backup was ${plural(age!, 'day')} ago.` : "You haven't made a backup yet."}{' '}
      <a href="#/settings">Back up to a file</a> in case this browser's storage is ever cleared.
    </Banner>
  );
}
