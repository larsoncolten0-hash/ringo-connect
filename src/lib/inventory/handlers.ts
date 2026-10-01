// The Phase 4 API (inventory & stock control) as plain functions; routes in src/app/api/inventory/** are thin wrappers that resolve the owner
// (the same owner-only gate as bookkeeping, invoices and debtors) and call these.
//
// WRITE BOUNDARY: every write goes through a controlled database function, called with the OWNER's own profile id and user id taken from the
// session, never from the request. The functions update products.inventory_count and write the ledger row in ONE transaction. This module
// never INSERTs/UPDATEs/DELETEs a table, never touches orders, payments, invoices or bookkeeping, and never sends a stored quantity: the
// browser sends an operation and an amount, the database computes the result.
import { currencyMinorDigits, parseMinor } from "@/lib/bookkeeping/money";
import type { ApiResult, DocOwner } from "@/lib/documents/handlers";
import { isUuid } from "@/lib/documents/validation";
import { invError } from "./http";
import { INVENTORY_FILTERS } from "./constants";
import { parseAdjustBody, parseCountBody, parseRestockBody, parseSettingsBody, parseStartBody, parseStopBody } from "./validation";

const base = (o: DocOwner) => ({ p_profile_id: o.profile.id, p_actor_user_id: o.userId });
const bad = (details: string[]): ApiResult => ({ status: 400, body: { error: "validation_failed", details } });
const notFound = (error = "product_not_found"): ApiResult => ({ status: 404, body: { error } });

async function rpc(owner: DocOwner, fn: string, args: Record<string, unknown>, okStatus = 200): Promise<ApiResult> {
  const { data, error } = await owner.admin.rpc(fn, args);
  if (error) return invError(error);
  return { status: okStatus, body: data };
}

/** Exact decimal from the database -> integer minor units (null when absent or unreadable). Never through floating point. */
const minor = (value: unknown, currency: string): number | null => {
  if (value === null || value === undefined) return null;
  return parseMinor(typeof value === "number" ? String(value) : value, currencyMinorDigits(currency));
};

function movement(m: any, currency: string) {
  return {
    id: m.id, kind: m.kind, qty_delta: m.qty_delta, balance_before: m.balance_before ?? null, balance_after: m.balance_after ?? null,
    reason: m.reason ?? null, note: m.note ?? null, unit_cost_minor: minor(m.unit_cost, currency), source_type: m.source_type ?? null, source_id: m.source_id ?? null, created_at: m.created_at,
  };
}

// ----------------------------------------------------------------------------------------- reads
export async function inventoryOverview(owner: DocOwner, query: { filter?: string | null; limit?: string | null; offset?: string | null }): Promise<ApiResult> {
  const filter = query.filter && (INVENTORY_FILTERS as readonly string[]).includes(query.filter) ? query.filter : null;
  if (query.filter && !filter) return bad(["invalid_filter"]);
  const n = (v: string | null | undefined, d: number) => (v && /^\d{1,6}$/.test(v) ? Number(v) : d);
  const r = await rpc(owner, "inv_overview", { ...base(owner), p_filter: filter, p_limit: n(query.limit, 50), p_offset: n(query.offset, 0) });
  if (r.status !== 200 || "pdf" in r) return r;
  const d = r.body;
  const cur = String(d.profile_currency);
  return {
    status: 200,
    body: {
      profile_currency: cur, total: d.total,
      summary: { ...d.summary, estimated_value_minor: minor(d.summary?.estimated_value, cur) ?? 0, estimated_value: undefined },
      items: ((d.items as any[]) || []).map((i) => ({
        product_id: i.product_id, name: i.name, available: i.available, state: i.state, tracked: i.tracked, count: i.count ?? null, low_stock_threshold: i.low_stock_threshold ?? null,
        reserved: i.reserved, sold_units: i.sold_units, sku: i.sku ?? null, unit_cost_minor: minor(i.unit_cost, i.cost_currency || cur), cost_currency: i.cost_currency ?? null,
        estimated_value_minor: minor(i.estimated_value, cur), last_movement_at: i.last_movement_at ?? null, drift: i.drift,
      })),
    },
  };
}

export async function productDetail(owner: DocOwner, id: string, query: { limit?: string | null; offset?: string | null }): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  const n = (v: string | null | undefined, d: number) => (v && /^\d{1,6}$/.test(v) ? Number(v) : d);
  const r = await rpc(owner, "inv_product_detail", { ...base(owner), p_product_id: id, p_limit: n(query.limit, 50), p_offset: n(query.offset, 0) });
  if (r.status !== 200 || "pdf" in r) return r;
  const d = r.body;
  const cur = String(d.profile_currency);
  const s = d.settings;
  return {
    status: 200,
    body: {
      profile_currency: cur, product: d.product, tracked: d.tracked === true, legacy_count: d.legacy_count === true, reserved: d.reserved, sold_units: d.sold_units, drift: d.drift,
      estimated_value_minor: minor(d.estimated_value, cur),
      settings: s ? { active: s.active === true, low_stock_threshold: s.low_stock_threshold, sku: s.sku ?? null, unit_cost_minor: minor(s.unit_cost, s.cost_currency || cur), cost_currency: s.cost_currency ?? null, tracking_started_at: s.tracking_started_at, stopped_at: s.stopped_at ?? null } : null,
      movement_total: d.movement_total, movements: ((d.movements as any[]) || []).map((m) => movement(m, cur)), order_events: d.order_events || [],
    },
  };
}

export async function refundedOrders(owner: DocOwner, id: string): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  const r = await rpc(owner, "inv_refunded_orders", { ...base(owner), p_product_id: id });
  return r.status === 200 && !("pdf" in r) ? { status: 200, body: { items: r.body ?? [] } } : r;
}

// ----------------------------------------------------------------------------------------- writes (each one atomic in the database)
function done(r: ApiResult): ApiResult {
  if (r.status !== 200 || "pdf" in r) return r;
  // a replayed request id returns the original result with 200; a fresh one is 201
  return r.body?.duplicate === true ? r : { status: 201, body: r.body };
}

export async function startTracking(owner: DocOwner, id: string, body: unknown): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  const p = parseStartBody(body);
  if (!p.ok) return bad(p.details);
  return done(await rpc(owner, "inv_start_tracking", { ...base(owner), p_product_id: id, p_opening_qty: p.value.opening_quantity, p_low_stock_threshold: p.value.low_stock_threshold, p_client_request_id: p.value.client_request_id }));
}

export async function adjustStock(owner: DocOwner, id: string, body: unknown): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  const p = parseAdjustBody(body);
  if (!p.ok) return bad(p.details);
  const v = p.value;
  return done(await rpc(owner, "inv_adjust_stock", {
    ...base(owner), p_product_id: id, p_kind: v.kind, p_quantity: v.quantity, p_reason: v.reason, p_note: v.note,
    p_source_type: v.invoice_id ? "invoice" : null, p_source_id: v.invoice_id, p_unit_cost: v.unit_cost, p_client_request_id: v.client_request_id,
  }));
}

export async function correctCount(owner: DocOwner, id: string, body: unknown): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  const p = parseCountBody(body);
  if (!p.ok) return bad(p.details);
  return done(await rpc(owner, "inv_set_stock_count", { ...base(owner), p_product_id: id, p_target: p.value.target, p_reason: p.value.reason, p_note: p.value.note, p_client_request_id: p.value.client_request_id }));
}

export async function restockReturned(owner: DocOwner, id: string, body: unknown): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  const p = parseRestockBody(body);
  if (!p.ok) return bad(p.details);
  return done(await rpc(owner, "inv_return_restock", { ...base(owner), p_order_id: p.value.order_id, p_product_id: id, p_quantity: p.value.quantity, p_note: p.value.note, p_client_request_id: p.value.client_request_id }));
}

export async function stopTracking(owner: DocOwner, id: string, body: unknown): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  const p = parseStopBody(body);
  if (!p.ok) return bad(p.details);
  return done(await rpc(owner, "inv_stop_tracking", { ...base(owner), p_product_id: id, p_note: p.value.note, p_client_request_id: p.value.client_request_id }));
}

export async function updateSettings(owner: DocOwner, id: string, body: unknown): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  const p = parseSettingsBody(body);
  if (!p.ok) return bad(p.details);
  return rpc(owner, "inv_update_settings", { ...base(owner), p_product_id: id, p_low_stock_threshold: p.value.low_stock_threshold, p_sku: p.value.sku, p_unit_cost: p.value.unit_cost });
}
