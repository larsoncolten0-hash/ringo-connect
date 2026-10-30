import type { ChurchActor } from "../actor";
import { failure } from "../errors";
import { todayDouala, type Result } from "../handlers";
import { parseReportPeriod, type ReportPeriod } from "../reports/period";
import { ORDER_STATUSES, type OrderStatus } from "./statuses";

// Churches & Ministries, Phase 4: the Church Store summary. It reads the church's EXISTING Shop orders (product_orders) and adds up what they already say, for the dates the owner chooses. Nothing else:
//   * Shop orders only. It never reads a gift, a tithe, a pledge or any giving table, and never adds Shop money to anything. Giving has its own report (in the Giving screen); the two are never combined.
//   * Owner only, because the Shop is owner only. Read through the owner's OWN session, so row-level security ("product_orders owner read") stays the authority; the church is always actor.profileId.
//   * "Sales" are orders the platform verified as paid (status paid or fulfilled), counted on the day they were paid, in Africa/Douala days, exactly like Bookkeeping. "Orders placed" counts every order
//     created in the range by its current status. Amounts are whole XAF; an order in another currency is counted but NEVER added to the XAF total.
//   * No buyer name, phone, e-mail, address or order line ever enters the summary: counts and totals only. Read-only.
// GET /api/church/store-summary?from=&to=   (default: the last 30 days)

type Row = Record<string, any>;
export const SUMMARY_ROW_LIMIT = 5000;

export interface StoreSummary {
  period: { from: string; to: string; days: number };
  placed: { total: number; byStatus: Record<OrderStatus, number> };
  sales: { orders: number; revenueXaf: number; otherCurrencyOrders: number; averageXaf: number };
  /** True when more rows existed than were read, so the figures are a floor: the screen says so instead of presenting them as exact. */
  truncated: boolean;
}

const amount = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Pure: turns the two row sets into the summary. `placedRows` = orders created in the range; `paidRows` = orders paid in the range. */
export function summarizeStore(period: Pick<ReportPeriod, "from" | "to" | "days">, placedRows: Row[], paidRows: Row[], truncated: boolean): StoreSummary {
  const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
  for (const r of placedRows) if ((ORDER_STATUSES as readonly string[]).includes(r.status)) byStatus[r.status as OrderStatus] += 1;
  let orders = 0;
  let revenueXaf = 0;
  let otherCurrencyOrders = 0;
  for (const r of paidRows) {
    if ((r.status !== "paid" && r.status !== "fulfilled") || !r.paid_at) continue;
    if (String(r.currency || "XAF").toUpperCase() !== "XAF") {
      otherCurrencyOrders += 1;
      continue;
    }
    orders += 1;
    revenueXaf += Math.round(amount(r.total));
  }
  return {
    period: { from: period.from, to: period.to, days: period.days },
    placed: { total: placedRows.length, byStatus },
    sales: { orders, revenueXaf, otherCurrencyOrders, averageXaf: orders > 0 ? Math.round(revenueXaf / orders) : 0 },
    truncated,
  };
}

export async function getStoreSummary(a: ChurchActor, params: URLSearchParams): Promise<Result> {
  if (a.kind !== "owner") return failure(403, "forbidden");
  for (const k of Array.from(params.keys())) if (k !== "from" && k !== "to") return failure(400, "unexpected_field", k);
  const period = parseReportPeriod(params.get("from"), params.get("to"), todayDouala());
  if (!period.ok) return failure(400, period.code, period.field);
  const p = period.value;

  const orders = () => a.supabase.from("product_orders").select("id, status, total, currency, paid_at, created_at").eq("profile_id", a.profileId);
  const [placed, paid] = await Promise.all([
    orders().gte("created_at", p.fromUtc).lt("created_at", p.toUtcExclusive).order("created_at", { ascending: false }).limit(SUMMARY_ROW_LIMIT),
    orders().in("status", ["paid", "fulfilled"]).gte("paid_at", p.fromUtc).lt("paid_at", p.toUtcExclusive).order("paid_at", { ascending: false }).limit(SUMMARY_ROW_LIMIT),
  ]);
  // a failed read is an error, never a zero
  if (placed.error || paid.error) {
    console.error(JSON.stringify({ scope: "church", result: "store_summary_error" }));
    return failure(502, "report_failed");
  }
  const placedRows = (placed.data as Row[]) || [];
  const paidRows = (paid.data as Row[]) || [];
  const truncated = placedRows.length >= SUMMARY_ROW_LIMIT || paidRows.length >= SUMMARY_ROW_LIMIT;
  return { status: 200, body: { ok: true, summary: summarizeStore(p, placedRows, paidRows, truncated) } };
}
