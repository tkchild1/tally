import { useState } from 'react';
import { lastBackupDate } from '../../db/backup';
import { countTransactions, listTransferHints, markHintAsTransfer } from '../../db/repo';
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

/** Coverage gaps per account and a nudge when the last import is getting old. */
export function CoverageBanners({ showStale = true }: { showStale?: boolean }) {
  const coverage = useQuery((d) => loadCoverage(d), []);
  if (!coverage.data) return null;
  const { accounts, lastImport } = coverage.data;
  const age = lastImport ? daysBetween(lastImport, todayISO()) : null;

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
      {showStale && age !== null && age >= STALE_AFTER_DAYS && (
        <Banner>
          Last imported {plural(age, 'day')} ago. <a href="#/import">Import this week's exports.</a>
        </Banner>
      )}
    </>
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
