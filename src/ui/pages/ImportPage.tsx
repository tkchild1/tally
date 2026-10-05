import { useRef, useState, type DragEvent } from 'react';
import { importFiles, type FileImportResult } from '../../db/importer';
import { Banner } from '../components/Banner';
import { Card } from '../components/Card';
import { Money } from '../components/Money';
import { CoverageBanners, TransferHintBanners } from '../components/StatusBanners';
import { loadCoverage } from '../coverage';
import { loadDemoData } from '../demo';
import { formatDate, formatRange, plural } from '../format';
import { bumpDataVersion, useDb, useQuery } from '../hooks';

export function ImportPage() {
  const db = useDb();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<FileImportResult[] | null>(null);
  const [demo, setDemo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const coverage = useQuery((d) => loadCoverage(d), []);

  async function run(load: () => Promise<FileImportResult[]>, isDemo: boolean) {
    setBusy(true);
    try {
      setResults(await load());
      setDemo(isDemo);
      bumpDataVersion();
    } finally {
      setBusy(false);
    }
  }

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const files = await Promise.all(Array.from(list, async (f) => ({ name: f.name, text: await f.text() })));
    await run(() => importFiles(db, files), false);
    if (inputRef.current) inputRef.current.value = '';
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    void onFiles(e.dataTransfer.files);
  }

  function loadDemo() {
    void run(() => loadDemoData(db), true);
  }

  return (
    <div className="page">
      <h1>Import</h1>

      <label
        className={`dropzone ${dragging ? 'dropzone-active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          // No `accept` filter: iOS doesn't know the .qfx type and greys every file out. The parser rejects non-OFX files.
          multiple
          disabled={busy}
          onChange={(e) => void onFiles(e.target.files)}
          className="visually-hidden"
        />
        <span className="dropzone-title">{busy ? 'Importing…' : 'Choose QFX files'}</span>
        <span className="muted">or drop them here (.qfx, .qbo, .ofx). Files are read on this device only.</span>
      </label>
      <p className="muted small">
        First download the files from your bank's website (on a phone they land in the Files app, under Downloads). Then
        choose them here; you can pick several at once.
      </p>

      <div className="row-actions">
        <button type="button" className="btn btn-secondary" onClick={loadDemo} disabled={busy}>
          Load demo data
        </button>
        <span className="muted small">Fake accounts and transactions, for trying the app out.</span>
      </div>

      {results && (
        <section aria-live="polite" className="stack">
          {demo && <Banner>Demo data loaded. These are fake accounts, not yours.</Banner>}
          {results.map((r, i) => (
            <ResultCard key={`${r.fileName}-${i}`} result={r} />
          ))}
        </section>
      )}

      <TransferHintBanners />
      <CoverageBanners />

      <Card title="Accounts and coverage">
        {coverage.data && coverage.data.accounts.length > 0 ? (
          <>
            <ul className="list">
              {coverage.data.accounts.map(({ account: a, ranges, gaps }) => (
                <li key={a.id} className="list-row">
                  <div>
                    <div>{a.display_name}</div>
                    <div className="muted small">
                      {plural(a.txn_count, 'transaction')}
                      {a.balance_as_of && ` · balance as of ${formatDate(a.balance_as_of)}`}
                    </div>
                    <div className="small">
                      Covered: {ranges.map((r) => formatRange(r.start, r.end)).join('; ') || 'unknown'}
                      {gaps.length > 0 && <strong className="gap-flag"> · {plural(gaps.length, 'gap')}</strong>}
                    </div>
                  </div>
                  {a.balance_cents !== null && <Money cents={a.balance_cents} className="money-neutral" />}
                </li>
              ))}
            </ul>
            {coverage.data.lastImport && <p className="muted small">Last import {formatDate(coverage.data.lastImport)}</p>}
          </>
        ) : (
          <p className="muted">No accounts yet. Import a file or load demo data.</p>
        )}
      </Card>

      <Card title="Weekly routine">
        <p className="small">
          In PNC online banking, export each account as <strong>QFX</strong> covering roughly the last 30–60 days, not
          just “since last statement”. Overlapping ranges are fine: Tally skips transactions it already has.
        </p>
      </Card>
    </div>
  );
}

function ResultCard({ result }: { result: FileImportResult }) {
  if (!result.ok) {
    return (
      <Card title={result.fileName} className="card-error">
        <p>{result.error}</p>
        <p className="muted small">Nothing was imported from this file.</p>
      </Card>
    );
  }
  return (
    <Card title={result.fileName}>
      {result.statements.map((s) => (
        <div key={s.accountId} className="result">
          <div className="result-head">
            <strong>{s.displayName}</strong>
            {s.balance && (
              <span className="small">
                Balance <Money cents={s.balance.amountCents} /> on {formatDate(s.balance.asOf)}
              </span>
            )}
          </div>
          <div className="muted small">{formatRange(s.rangeStart, s.rangeEnd)}</div>
          <div className="small">
            {plural(s.total, 'row')}: <strong>{s.inserted} new</strong>, {s.duplicates} already imported
          </div>
        </div>
      ))}
      {result.warnings.map((w) => (
        <Banner key={w} tone="warn">
          {w}
        </Banner>
      ))}
    </Card>
  );
}
