import { useState } from 'react';
import { listTransferHints, markHintAsTransfer } from '../../db/repo';
import { daysBetween, todayISO } from '../../lib/dates';
import { loadCoverage } from '../coverage';
import { formatDate, plural } from '../format';
import { bumpDataVersion, useDb, useQuery } from '../hooks';
import { Banner } from './Banner';

const STALE_AFTER_DAYS = 7;

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
