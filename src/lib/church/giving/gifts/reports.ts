// Church giving, the money part: the report of the gifts of a church over a period, and the reconciliation checks. Pure and dependency-free (no I/O).
// It reads what the dashboard already loaded (the gift ledger view, and for the owner the earnings ledger view) and never invents a number. Amounts are whole XAF.

export interface LedgerGift {
  id: string;
  fund_kind: "giving" | "care";
  amount_xaf: number;
  status: string;
  created_at: string;
  confirmed_at: string | null;
}
export interface LedgerEarning {
  gift_id: string;
  gross_amount: number | string;
  platform_fee: number | string;
  net_amount: number | string;
  status: "recorded" | "requested" | "paid" | "reversed";
}
export interface KindTotal {
  count: number;
  gross: number;
}
export interface GivingReport {
  gifts: number;
  paid: KindTotal & { by_kind: { giving: KindTotal; care: KindTotal } };
  pending: number;
  failed: number;
  expired: number;
  review: number;
  refunded: KindTotal;
  /** Owner only (money belongs to the owner); null for staff who may manage funds but not see the balance. */
  earnings: null | { fee: number; net: number; recorded: number; requested: number; paid: number; reversed: number };
  reconciliation: {
    /** Gifts that need a human: paid by Fapshi but held back for review. */
    review_ids: string[];
    /** Open attempts older than the stale limit: the donor probably walked away, or the check has not run. */
    stale_pending_ids: string[];
    /** Owner only: paid gifts that have no earning row yet (settlement is retried by the next check). */
    paid_without_earning_ids: string[] | null;
    ok: boolean;
  };
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const zero = (): KindTotal => ({ count: 0, gross: 0 });

export function buildGivingReport(gifts: LedgerGift[], earnings: LedgerEarning[] | null, opts: { nowMs: number; staleMinutes?: number } = { nowMs: Date.now() }): GivingReport {
  const stale = (opts.staleMinutes ?? 60) * 60_000;
  const r: GivingReport = {
    gifts: gifts.length,
    paid: { ...zero(), by_kind: { giving: zero(), care: zero() } },
    pending: 0,
    failed: 0,
    expired: 0,
    review: 0,
    refunded: zero(),
    earnings: null,
    reconciliation: { review_ids: [], stale_pending_ids: [], paid_without_earning_ids: null, ok: true },
  };
  for (const g of gifts) {
    const amount = num(g.amount_xaf);
    if (g.status === "succeeded") {
      r.paid.count++;
      r.paid.gross += amount;
      const k = g.fund_kind === "care" ? r.paid.by_kind.care : r.paid.by_kind.giving;
      k.count++;
      k.gross += amount;
    } else if (g.status === "refunded") {
      r.refunded.count++;
      r.refunded.gross += amount;
    } else if (g.status === "initiated" || g.status === "pending") {
      r.pending++;
      if (opts.nowMs - new Date(g.created_at).getTime() > stale) r.reconciliation.stale_pending_ids.push(g.id);
    } else if (g.status === "failed") r.failed++;
    else if (g.status === "expired" || g.status === "cancelled") r.expired++;
    else if (g.status === "payment_review") {
      r.review++;
      r.reconciliation.review_ids.push(g.id);
    }
  }
  if (earnings) {
    const e = { fee: 0, net: 0, recorded: 0, requested: 0, paid: 0, reversed: 0 };
    const have = new Set<string>();
    for (const x of earnings) {
      have.add(x.gift_id);
      if (x.status === "reversed") {
        e.reversed += num(x.net_amount);
        continue;
      }
      e.fee += num(x.platform_fee);
      e.net += num(x.net_amount);
      e[x.status] += num(x.net_amount);
    }
    r.earnings = e;
    r.reconciliation.paid_without_earning_ids = gifts.filter((g) => g.status === "succeeded" && !have.has(g.id)).map((g) => g.id);
  }
  r.reconciliation.ok = r.reconciliation.review_ids.length === 0 && r.reconciliation.stale_pending_ids.length === 0 && (r.reconciliation.paid_without_earning_ids?.length ?? 0) === 0;
  return r;
}

/** Whole-day bounds in Douala time (UTC+1, no daylight saving). Returns null for anything that is not a real calendar date. */
export function doualaDayBounds(from: string | null, to: string | null): { fromIso: string | null; toIso: string | null } | null {
  const real = (d: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    const t = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
  };
  if (from !== null && !real(from)) return null;
  if (to !== null && !real(to)) return null;
  const fromIso = from === null ? null : new Date(`${from}T00:00:00+01:00`).toISOString();
  const toIso = to === null ? null : new Date(`${to}T23:59:59.999+01:00`).toISOString();
  if (fromIso && toIso && fromIso > toIso) return null;
  return { fromIso, toIso };
}
