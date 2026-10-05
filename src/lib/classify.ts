import { DEFAULT_RULES, type Flow } from './categories';
import { daysBetween, type ISODate } from './dates';
import type { Cents } from './money';
import type { AccountKind } from './qfx';

/**
 * Two-step classification (README 9.2-9.4): decide the flow (spend / income / transfer),
 * then the category. Pure and deterministic: the same inputs always give the same output,
 * and nothing depends on the previous automatic result, so re-running is idempotent.
 */

export interface ClassifyTxn {
  id: number;
  accountId: string;
  postedOn: ISODate;
  amountCents: Cents;
  rawName: string;
  rawMemo: string | null;
  merchant: string;
  /** Current values; only used when the matching `*Locked` flag is set. */
  flow: Flow;
  categoryId: string;
  transferGroup: string | null;
  flowLocked: boolean;
  categoryLocked: boolean;
}

export interface ClassifyAccount {
  id: string;
  kind: AccountKind;
  last4: string;
}

export interface UserRule {
  matchType: 'equals' | 'contains';
  pattern: string;
  categoryId: string;
}

export interface ClassifyResult {
  id: number;
  flow: Flow;
  categoryId: string;
  transferGroup: string | null;
  transferHint: string | null;
}

const TRANSFER_WORDS = /TRANSFER|XFER|\bTFR\b|PAYMENT|\bPMT\b|AUTOPAY/;
const NOT_A_TRANSFER = /REFUND|REVERSAL|RETURN|ADJUST/;
const MASKED_REF = /(?:X{2,}|\*{2,})(\d{4})(?!\d)/g;
export const TRANSFER_PAIR_WINDOW_DAYS = 5;

type Evidence =
  | { kind: 'strong'; targetAccountId: string | null }
  | { kind: 'weak' }
  | { kind: 'none'; hint: string | null };

export function classifyTransactions(
  txns: readonly ClassifyTxn[],
  accounts: readonly ClassifyAccount[],
  userRules: readonly UserRule[],
): ClassifyResult[] {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const sorted = [...txns].sort((a, b) => a.id - b.id);

  // Step 1: transfer evidence for rows whose flow is not locked.
  const evidence = new Map<number, Evidence>();
  for (const t of sorted) {
    if (!t.flowLocked) evidence.set(t.id, transferEvidence(t, accountById, accounts));
  }

  // Step 2: pair candidates (strong and weak) across accounts: exact opposite amount,
  // within the window, nearest date first, each row pairs at most once.
  const pool = sorted.filter((t) => {
    const e = evidence.get(t.id);
    return e !== undefined && e.kind !== 'none';
  });
  const groups = pairTransfers(pool, evidence);

  // Step 3: final flow and category per row.
  const rules = sortUserRules(userRules);
  const results: ClassifyResult[] = [];
  for (const t of sorted) {
    if (t.flowLocked && t.categoryLocked) continue;
    const account = accountById.get(t.accountId);

    let flow: Flow;
    let transferGroup: string | null = null;
    let transferHint: string | null = null;
    if (t.flowLocked) {
      flow = t.flow;
      transferGroup = flow === 'transfer' ? t.transferGroup : null;
    } else {
      const e = evidence.get(t.id)!;
      transferGroup = groups.get(t.id) ?? null;
      if (e.kind === 'strong' || transferGroup !== null) {
        flow = 'transfer';
      } else {
        flow = t.amountCents > 0 && account?.kind !== 'credit_card' ? 'income' : 'spend';
        if (e.kind === 'none') transferHint = e.hint;
      }
    }

    const categoryId = t.categoryLocked ? t.categoryId : categorize(t, flow, rules);
    results.push({ id: t.id, flow, categoryId, transferGroup, transferHint });
  }
  return results;
}

function transferEvidence(
  t: ClassifyTxn,
  accountById: Map<string, ClassifyAccount>,
  accounts: readonly ClassifyAccount[],
): Evidence {
  const text = `${t.rawName} ${t.rawMemo ?? ''}`.toUpperCase();
  if (!TRANSFER_WORDS.test(text)) return { kind: 'none', hint: null };
  const own = accountById.get(t.accountId);

  // Strong A: masked reference to the last 4 of another imported account.
  const refs = [...text.matchAll(MASKED_REF)].map((m) => m[1]!).filter((r) => r !== own?.last4);
  for (const ref of refs) {
    const target = accounts.find((a) => a.id !== t.accountId && a.last4 === ref);
    if (target) return { kind: 'strong', targetAccountId: target.id };
  }

  // Strong B: a payment received by a credit card.
  if (own?.kind === 'credit_card' && t.amountCents > 0 && !NOT_A_TRANSFER.test(text)) {
    return { kind: 'strong', targetAccountId: null };
  }

  // A reference to an account that hasn't been imported: not a transfer yet, but surface it.
  if (refs.length > 0) return { kind: 'none', hint: refs[0]! };
  return { kind: 'weak' };
}

function pairTransfers(pool: readonly ClassifyTxn[], evidence: Map<number, Evidence>): Map<number, string> {
  const candidates: Array<{ a: ClassifyTxn; b: ClassifyTxn; gap: number }> = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i]!;
      const b = pool[j]!;
      if (a.accountId === b.accountId || a.amountCents !== -b.amountCents || a.amountCents === 0) continue;
      if (!targetAllows(evidence.get(a.id), b) || !targetAllows(evidence.get(b.id), a)) continue;
      const gap = Math.abs(daysBetween(a.postedOn, b.postedOn));
      if (gap <= TRANSFER_PAIR_WINDOW_DAYS) candidates.push({ a, b, gap });
    }
  }
  candidates.sort((x, y) => x.gap - y.gap || x.a.id - y.a.id || x.b.id - y.b.id);

  const groups = new Map<number, string>();
  for (const { a, b } of candidates) {
    if (groups.has(a.id) || groups.has(b.id)) continue;
    const group = `tg-${a.id}-${b.id}`;
    groups.set(a.id, group);
    groups.set(b.id, group);
  }
  return groups;
}

/** A strong reference names its counterpart's account; don't pair it with any other account. */
function targetAllows(e: Evidence | undefined, partner: ClassifyTxn): boolean {
  return !(e?.kind === 'strong' && e.targetAccountId !== null && e.targetAccountId !== partner.accountId);
}

function sortUserRules(rules: readonly UserRule[]): UserRule[] {
  return [...rules].sort(
    (a, b) =>
      (a.matchType === 'equals' ? 0 : 1) - (b.matchType === 'equals' ? 0 : 1) ||
      b.pattern.length - a.pattern.length ||
      (a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0),
  );
}

function categorize(t: ClassifyTxn, flow: Flow, rules: readonly UserRule[]): string {
  if (flow === 'transfer') return 'transfer';

  const merchant = t.merchant.toUpperCase();
  for (const r of rules) {
    const p = r.pattern.toUpperCase();
    if (r.matchType === 'equals' ? merchant === p : merchant.includes(p)) return r.categoryId;
  }

  const text = `${merchant} | ${t.rawName} ${t.rawMemo ?? ''}`.toUpperCase();
  for (const r of DEFAULT_RULES) {
    if (r.flow === flow && r.pattern.test(text)) return r.categoryId;
  }
  return flow === 'income' ? 'income_other' : 'uncategorized';
}
