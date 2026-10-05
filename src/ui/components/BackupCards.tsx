import { useState } from 'react';
import { exportBackup, lastBackupDate, recordBackupMade, restoreBackup } from '../../db/backup';
import {
  BackupError,
  backupCounts,
  backupFileName,
  isEncryptedBackup,
  parseBackup,
  serializeBackup,
  type BackupData,
} from '../../lib/backup';
import { todayISO } from '../../lib/dates';
import { formatDate, plural } from '../format';
import { bumpDataVersion, useDb, useQuery } from '../hooks';
import { Banner } from './Banner';
import { Card } from './Card';

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof BackupError ? e.message : fallback;
}

function saveFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const canShareFiles = (file: File) => typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });

export function BackupCard() {
  const db = useDb();
  const last = useQuery((d) => lastBackupDate(d), []);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const mismatch = pass !== '' && pass !== pass2;

  async function make() {
    setBusy(true);
    setError(null);
    setFile(null);
    try {
      const today = todayISO();
      const text = await serializeBackup(await exportBackup(db), pass || undefined);
      const f = new File([text], backupFileName(today), { type: 'application/json' });
      setFile(f);
      saveFile(f);
      await recordBackupMade(db, today);
      bumpDataVersion();
    } catch (e) {
      setError(errorMessage(e, 'Could not create the backup.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Backup">
      <p className="small">
        Saves everything (transactions, rules, names, choices) to one file. Keep it somewhere safe, like iCloud Drive.
        Back up about once a month.
      </p>
      {last.data !== undefined && (
        <p className="muted small">{last.data ? `Last backup: ${formatDate(last.data)}` : 'No backup made yet.'}</p>
      )}
      <label className="field">
        <span className="small">Passphrase (optional, recommended)</span>
        <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
      </label>
      {pass && (
        <label className="field">
          <span className="small">Repeat passphrase</span>
          <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />
        </label>
      )}
      {mismatch && pass2 && <p className="small">The passphrases don't match.</p>}
      {!pass && (
        <Banner tone="warn">
          Without a passphrase the file is readable by anyone who gets it, and it holds your full transaction history.
        </Banner>
      )}
      {pass && (
        <p className="muted small">There is no way to recover a forgotten passphrase. Store it in your password manager.</p>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      <div className="row-actions">
        <button type="button" className="btn" disabled={busy || mismatch} onClick={make}>
          {busy ? 'Preparing…' : pass ? 'Download encrypted backup' : 'Download backup'}
        </button>
        {file && canShareFiles(file) && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigator.share({ files: [file] }).catch(() => undefined)}
          >
            Share / Save to Files
          </button>
        )}
      </div>
    </Card>
  );
}

export function RestoreCard() {
  const db = useDb();
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [pass, setPass] = useState('');
  const [parsed, setParsed] = useState<BackupData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const encrypted = text !== null && isEncryptedBackup(text);

  async function pick(f: File | undefined) {
    setParsed(null);
    setError(null);
    setDone(false);
    setPass('');
    if (!f) return setText(null);
    setFileName(f.name);
    const t = await f.text();
    setText(t);
    if (!isEncryptedBackup(t)) await check(t, '');
  }

  async function check(t: string, passphrase: string) {
    setBusy(true);
    setError(null);
    try {
      setParsed(await parseBackup(t, passphrase || undefined));
    } catch (e) {
      setError(errorMessage(e, 'Could not read this file.'));
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!parsed) return;
    setBusy(true);
    setError(null);
    try {
      await restoreBackup(db, parsed);
      setDone(true);
      setParsed(null);
      setText(null);
      bumpDataVersion();
    } catch {
      setError('Restore failed, so nothing was changed. The file may be from a newer version of Tally.');
    } finally {
      setBusy(false);
    }
  }

  const counts = parsed ? backupCounts(parsed) : null;

  return (
    <Card title="Restore">
      <p className="small">Replaces all data on this device with a backup file.</p>
      <label className="field">
        <span className="small">Backup file</span>
        <input type="file" accept=".json,application/json" onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      {encrypted && !parsed && (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault();
            if (text) void check(text, pass);
          }}
        >
          <label className="field">
            <span className="small">Passphrase for {fileName}</span>
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete="current-password" />
          </label>
          <button type="submit" className="btn btn-secondary" disabled={busy || !pass}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
        </form>
      )}
      {error && <Banner tone="error">{error}</Banner>}
      {parsed && counts && (
        <>
          <Banner tone="warn">
            <p>
              Backup from {parsed.exportedAt ? formatDate(parsed.exportedAt.slice(0, 10)) : 'an unknown date'}:{' '}
              {plural(counts.accounts, 'account')}, {plural(counts.transactions, 'transaction')},{' '}
              {plural(counts.merchant_rules, 'rule')}. Restoring deletes everything currently on this device.
            </p>
          </Banner>
          <button type="button" className="btn btn-danger" disabled={busy} onClick={restore}>
            {busy ? 'Restoring…' : 'Replace all data with this backup'}
          </button>
        </>
      )}
      {done && <Banner>Restore complete.</Banner>}
    </Card>
  );
}
