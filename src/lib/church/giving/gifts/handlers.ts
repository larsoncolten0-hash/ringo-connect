import type { ChurchActor } from "../../actor";
import { failure } from "../../errors";
import type { Result } from "../../handlers";
import { GIVING_AVAILABLE } from "../../features/handlers";
import { isUuid } from "../../validation";
import { buildGivingReport, doualaDayBounds, type LedgerEarning, type LedgerGift } from "./reports";

// Church giving, the money part: what the CHURCH DASHBOARD reads. Everything behind /api/church/gifts, /api/church/giving-payouts and /api/church/gift-refunds.
//
// Same rules as every church handler: the church is actor.profileId (server-resolved, never from the request) and the user's OWN session decides through row-level security, so another church's gifts are
// unreachable even if this code were wrong. The gift ledger is a database view: staff see a donor's name and contact only when the gift is not anonymous, and never the payer's phone, email or token.
// Money (the balance, the commission, the net, payouts) is owner-only: the earnings ledger view and request_church_payout() refuse anyone else.

const ok = (body: Record<string, unknown> = {}, status = 200): Result => ({ status, body: { ok: true, ...body } });
const fail = (status: number, code: string, field?: string): Result => failure(status, code, field);

const GIFT_COLS = "id, receipt_number, fund_id, fund_kind, amount_xaf, is_anonymous, donor_name, donor_contact, status, provider_status, external_id, provider_transaction_id, failure_reason, created_at, confirmed_at";
const EARNING_COLS = "id, gift_id, gross_amount, commission_rate, platform_fee, net_amount, status, available_at, payout_id, created_at";
const STATUSES = ["initiated", "pending", "succeeded", "failed", "expired", "cancelled", "payment_review", "refunded"];
const MAX_ROWS = 200;

/** GET /api/church/gifts?from=YYYY-MM-DD&to=YYYY-MM-DD&status=&fund_id=&limit= : the gifts of this church, newest first, and the report of the period. */
export async function listGifts(a: ChurchActor, params: URLSearchParams): Promise<Result> {
  if (!a.caps.manageGiving) return fail(403, "forbidden");
  for (const k of Array.from(params.keys())) if (!["from", "to", "status", "fund_id", "limit"].includes(k)) return fail(400, "unexpected_field", k);
  const bounds = doualaDayBounds(params.get("from"), params.get("to"));
  if (!bounds) return fail(400, "invalid_range");
  const status = params.get("status");
  if (status !== null && !STATUSES.includes(status)) return fail(400, "invalid_status", "status");
  const fund = params.get("fund_id");
  if (fund !== null && !isUuid(fund)) return fail(400, "invalid_fund", "fund_id");
  const limitRaw = params.get("limit");
  const limit = limitRaw === null ? 100 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROWS) return fail(400, "invalid_limit", "limit");

  let q = a.supabase.from("church_gift_ledger").select(GIFT_COLS).order("created_at", { ascending: false }).limit(limit);
  if (bounds.fromIso) q = q.gte("created_at", bounds.fromIso);
  if (bounds.toIso) q = q.lte("created_at", bounds.toIso);
  if (status) q = q.eq("status", status);
  if (fund) q = q.eq("fund_id", fund);
  const gifts = await q;
  if (gifts.error) return fail(500, "server_error");
  const items = (gifts.data || []) as Array<LedgerGift & Record<string, unknown>>;

  // The report always covers the WHOLE period (not just the page of rows above), without a status or fund filter.
  let rq = a.supabase.from("church_gift_ledger").select("id, fund_kind, amount_xaf, status, created_at, confirmed_at").order("created_at", { ascending: false }).limit(5000);
  if (bounds.fromIso) rq = rq.gte("created_at", bounds.fromIso);
  if (bounds.toIso) rq = rq.lte("created_at", bounds.toIso);
  const all = await rq;
  if (all.error) return fail(500, "server_error");

  let earnings: LedgerEarning[] | null = null;
  if (a.kind === "owner") {
    let eq = a.supabase.from("church_gift_earnings_ledger").select(EARNING_COLS).order("created_at", { ascending: false }).limit(5000);
    if (bounds.fromIso) eq = eq.gte("created_at", bounds.fromIso);
    if (bounds.toIso) eq = eq.lte("created_at", bounds.toIso);
    const e = await eq;
    if (!e.error) earnings = (e.data || []) as LedgerEarning[];
  }
  return ok({ items, report: buildGivingReport((all.data || []) as LedgerGift[], earnings, { nowMs: Date.now() }), giving_available: GIVING_AVAILABLE, truncated: (all.data || []).length >= 5000 });
}

/** GET /api/church/giving-payouts: the owner's balance and payout requests. Owner only. */
export async function payoutSummary(a: ChurchActor): Promise<Result> {
  if (a.kind !== "owner") return fail(403, "forbidden");
  const [earn, payouts] = await Promise.all([
    a.supabase.from("church_gift_earnings_ledger").select("net_amount, status, available_at").limit(5000),
    a.supabase.from("church_payouts").select("id, amount, currency, status, requested_at, processed_at, admin_note").order("requested_at", { ascending: false }).limit(50),
  ]);
  if (earn.error || payouts.error) return fail(500, "server_error");
  const now = Date.now();
  let available = 0, held = 0, requested = 0, paid = 0;
  for (const e of (earn.data || []) as Array<{ net_amount: number | string; status: string; available_at: string | null }>) {
    const n = Number(e.net_amount) || 0;
    if (e.status === "recorded") (e.available_at && new Date(e.available_at).getTime() <= now ? (available += n) : (held += n));
    else if (e.status === "requested") requested += n;
    else if (e.status === "paid") paid += n;
  }
  return ok({ balance: { available, held, requested, paid }, payouts: payouts.data || [] });
}

/** POST /api/church/giving-payouts: the OWNER asks for the available balance to be paid out. The database does the locking, the hold, the minimum and the owner check. */
export async function requestPayout(a: ChurchActor): Promise<Result> {
  if (a.kind !== "owner") return fail(403, "forbidden");
  const { data, error } = await a.supabase.rpc("request_church_payout", { p_profile_id: a.profileId });
  if (error) {
    const m = String(error.message || "");
    if (m.includes("payout_below_minimum")) return fail(409, "payout_below_minimum");
    if (m.includes("payout_method_missing")) return fail(409, "payout_method_missing");
    if (m.includes("church_owner_required") || m.includes("not_authenticated")) return fail(403, "forbidden");
    console.error(JSON.stringify({ scope: "church_gifts", result: "payout_error", code: String(error.code || "") }));
    return fail(500, "server_error");
  }
  return ok({ payout: { id: data?.id, amount: data?.amount, status: data?.status } }, 201);
}

/** GET /api/church/gift-refunds: the refund requests on this church's gifts (a record of the request and of the decision; nothing here moves money). */
export async function listRefundRequests(a: ChurchActor): Promise<Result> {
  if (!a.caps.manageGiving) return fail(403, "forbidden");
  const { data, error } = await a.supabase.from("church_gift_refund_requests").select("id, gift_id, reason, status, requested_at, decided_at, decision_note").order("requested_at", { ascending: false }).limit(100);
  if (error) return fail(500, "server_error");
  return ok({ items: data || [] });
}
