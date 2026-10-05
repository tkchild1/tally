import { useEffect, useRef, useState } from 'react';
import {
  listCategories,
  listMerchantFlags,
  setMerchantFlag,
  setTransactionCategory,
  setTransactionFlow,
  type TransactionRow,
} from '../../db/repo';
import type { Flow } from '../../lib/categories';
import { prettyMerchant } from '../../lib/merchant';
import { formatDate, FLOW_LABEL } from '../format';
import { bumpDataVersion, useDb, useQuery } from '../hooks';
import { Money } from './Money';

/** Bottom sheet for inspecting and correcting one transaction. */
export function TransactionSheet({ txn, onClose }: { txn: TransactionRow; onClose: () => void }) {
  const db = useDb();
  const categories = useQuery((d) => listCategories(d), []);
  const flags = useQuery((d) => listMerchantFlags(d), []);
  const [categoryId, setCategoryId] = useState(txn.category_id);
  const [flow, setFlow] = useState<Flow>(txn.flow);
  const [applyToAll, setApplyToAll] = useState(true);
  const [tracked, setTracked] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const isTracked = tracked ?? flags.data?.get(txn.merchant) === 'confirmed';
  const pretty = prettyMerchant(txn.merchant);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (flow !== txn.flow) await setTransactionFlow(db, txn.id, flow);
      if (flow !== 'transfer' && categoryId !== txn.category_id) {
        await setTransactionCategory(db, txn.id, categoryId, applyToAll);
      }
      if (tracked !== null && tracked !== (flags.data?.get(txn.merchant) === 'confirmed')) {
        await setMerchantFlag(db, txn.merchant, tracked ? 'confirmed' : null);
      }
      bumpDataVersion();
      onClose();
    } catch {
      setError('Could not save the change.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <h2 id="sheet-title">{pretty}</h2>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="sheet-amount">
          <Money cents={txn.amount_cents} />
          <span className="muted small">
            {formatDate(txn.posted_on)} · {txn.account_name}
          </span>
        </div>

        <dl className="sheet-details small">
          <div>
            <dt>Bank description</dt>
            <dd>{txn.raw_name}</dd>
          </div>
          {txn.raw_memo && txn.raw_memo !== txn.raw_name && (
            <div>
              <dt>Memo</dt>
              <dd>{txn.raw_memo}</dd>
            </div>
          )}
          <div>
            <dt>Merchant (normalized)</dt>
            <dd>{txn.merchant}</dd>
          </div>
          {txn.transfer_hint && (
            <div>
              <dt>Note</dt>
              <dd>References an account ending in {txn.transfer_hint} that hasn't been imported.</dd>
            </div>
          )}
        </dl>

        <label className="field">
          <span>Type</span>
          <select value={flow} onChange={(e) => setFlow(e.target.value as Flow)}>
            {(['spend', 'income', 'transfer'] as const).map((f) => (
              <option key={f} value={f}>
                {FLOW_LABEL[f]}
              </option>
            ))}
          </select>
          {flow === 'transfer' && <span className="muted small">Transfers between your accounts count as neither spending nor income.</span>}
        </label>

        {flow !== 'transfer' && (
          <>
            <label className="field">
              <span>Category</span>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {categories.data
                  ?.filter((c) => c.kind !== 'system')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} />
              <span>
                Apply to all <strong>{pretty}</strong> transactions, including future imports
              </span>
            </label>
          </>
        )}

        {flow === 'spend' && txn.amount_cents < 0 && (
          <label className="check">
            <input type="checkbox" checked={isTracked} onChange={(e) => setTracked(e.target.checked)} />
            <span>Track {pretty} as a subscription</span>
          </label>
        )}

        {error && <p role="alert">{error}</p>}
        <div className="sheet-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
