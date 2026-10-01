// Business Toolkit Phase 6 (customers): the API as plain functions; the routes in src/app/api/customers/** are thin wrappers that resolve the owner
// (the same owner-only gate as Phases 1-5) and call these. EVERYTHING HERE IS READ-ONLY.
//
//   * The customer is bk_customers (Phase 3), the business's own contact. This module never reads ringo_customers, customer_sessions,
//     customer_login_codes or customer_connections, and never selects an order's customer_id.
//   * Creating, editing, archiving and pausing a contact stay on the existing Phase 3 endpoints (/api/receivables/customers/**).
//   * Every query filters by the owner's own profile id and goes through the owner's RLS-scoped client; the id of a customer in the URL is only a
//     lookup key and never grants anything.
//   * The financial picture is the existing Phase 3 statement (contactStatement), reused unchanged.
import { toLocalDateKey } from "@/lib/bookkeeping/summary";
import type { ApiResult, DocOwner } from "@/lib/documents/handlers";
import { isUuid } from "@/lib/documents/validation";
import { contactStatement } from "@/lib/receivables/handlers";
import { DIRECTORY_PAGE, DIRECTORY_STATUSES, ORDER_SCAN, TIMELINE_CAP, type DirectoryStatus } from "./constants";
import { classifyOrders, type ContactKeys, type OrderRow } from "./match";
import { buildTimeline, deriveTotals, statementTruncation, type EventRow, type ReminderRow } from "./profile";
import { buildSearchFilter, sanitizeSearch } from "./search";

const bad = (details: string[]): ApiResult => ({ status: 400, body: { error: "validation_failed", details } });
const notFound = (): ApiResult => ({ status: 404, body: { error: "customer_not_found" } });
const UNAVAILABLE = new Set(["PGRST205", "42P01"]);

function dbFailure(error: { code?: string; message?: string }): ApiResult {
  if (UNAVAILABLE.has(String(error?.code))) return { status: 503, body: { error: "customers_unavailable" } };
  console.error("customers query failed:", String(error?.message || "").slice(0, 200));
  return { status: 500, body: { error: "internal_error" } };
}

const toInt = (v: string | null | undefined, min: number, max: number, dflt: number): number | null => {
  if (v === null || v === undefined || v === "") return dflt;
  if (!/^\d{1,7}$/.test(v)) return null;
  const n = Number(v);
  return n < min || n > max ? null : n;
};

// ------------------------------------------------------------------------------------------------------------------------------ 6A directory
const DIRECTORY_COLUMNS = "id, name, phone, email, auto_reminders_paused, archived_at";

export async function listCustomers(owner: DocOwner, query: { q?: string | null; status?: string | null; limit?: string | null; offset?: string | null }): Promise<ApiResult> {
  const status = (query.status || "active") as DirectoryStatus;
  if (!(DIRECTORY_STATUSES as readonly string[]).includes(status)) return bad(["invalid_status"]);
  const limit = toInt(query.limit, 1, DIRECTORY_PAGE.max, DIRECTORY_PAGE.default);
  const offset = toInt(query.offset, 0, DIRECTORY_PAGE.maxOffset, 0);
  if (limit === null) return bad(["invalid_limit"]);
  if (offset === null) return bad(["invalid_offset"]);

  const term = sanitizeSearch(query.q);
  const filter = buildSearchFilter(query.q);
  // the profile scope is its own AND-ed filter: nothing in the search term can reach it
  let q = owner.supabase.from("bk_customers").select(DIRECTORY_COLUMNS, { count: "exact" }).eq("profile_id", owner.profile.id);
  if (status === "active") q = q.is("archived_at", null);
  else if (status === "archived") q = q.not("archived_at", "is", null);
  if (filter) q = q.or(filter);
  // one extra row tells whether another page exists without trusting a page length (PostgREST may cap responses)
  const { data, error, count } = await q.order("name", { ascending: true }).order("id", { ascending: true }).range(offset, offset + limit);
  if (error) return dbFailure(error);
  const rows = (data ?? []) as any[];
  return {
    status: 200,
    body: {
      items: rows.slice(0, limit).map((c) => ({ id: c.id, name: c.name, phone: c.phone ?? null, email: c.email ?? null, archived: !!c.archived_at, auto_reminders_paused: c.auto_reminders_paused === true })),
      has_more: rows.length > limit,
      total: typeof count === "number" ? count : null,
      limit, offset, status,
      q: term,
      search_too_short: !!(typeof query.q === "string" && query.q.trim() !== "" && !term),
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------------------ 6B profile
export async function customerProfile(owner: DocOwner, id: string): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  // the Phase 3 statement, unchanged: it re-checks that this customer belongs to THIS business (another business's id is "not found")
  const st = await contactStatement(owner, id);
  if (st.status !== 200 || "pdf" in st) return st;
  const s = st.body;

  const [ev, rem] = await Promise.all([
    owner.supabase.from("bk_customer_events").select("id, event_type, document_id, created_at").eq("profile_id", owner.profile.id).eq("customer_id", id)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(TIMELINE_CAP),
    owner.supabase.from("bk_reminders").select("id, document_id, channel, kind, status, trigger_type, created_at").eq("profile_id", owner.profile.id).eq("customer_id", id)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(TIMELINE_CAP),
  ]);
  const timeline = buildTimeline({ invoices: s.invoices, payments: s.payments, events: (ev.error ? [] : ev.data ?? []) as EventRow[], reminders: (rem.error ? [] : rem.data ?? []) as ReminderRow[] });
  const top = timeline.items[0];
  return {
    status: 200,
    body: {
      customer: s.customer,
      profile_currency: s.profile_currency,
      invoices: s.invoices,
      payments: s.payments,
      statement_totals: s.totals,
      totals: deriveTotals(s.invoices, s.payments, s.totals),
      truncated: statementTruncation(s.invoices, s.payments),
      timeline: timeline.items,
      timeline_truncated: timeline.truncated,
      timeline_partial: !!(ev.error || rem.error),
      last_activity_date: top ? (/^\d{4}-\d{2}-\d{2}$/.test(top.at) ? top.at : toLocalDateKey(top.at)) : null,
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------------------ 6C possible orders
const ORDER_COLUMNS = "id, order_number, status, total, currency, created_at, paid_at, customer_name, customer_phone, customer_email";
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Reads newest-first rows until `limit` rows are collected or the table runs out. The end is never inferred from a page length (PostgREST may cap pages). */
async function fetchRecent(build: () => { range: (a: number, b: number) => PromiseLike<{ data: any[] | null; error: any }> }, limit: number) {
  const out: any[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await build().range(offset, offset + (limit - out.length) - 1);
    if (error) return { rows: out, error };
    const got = data ?? [];
    if (got.length === 0) break;
    out.push(...got);
    offset += got.length;
    if (out.length >= limit) break;
  }
  return { rows: out, error: null };
}

export async function possibleOrders(owner: DocOwner, id: string): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  const profileId = owner.profile.id;
  const { data: contact, error: ce } = await owner.supabase.from("bk_customers").select("id, phone_normalized, email_normalized, archived_at").eq("profile_id", profileId).eq("id", id).maybeSingle();
  if (ce) return dbFailure(ce);
  if (!contact) return notFound();
  const key = { id: contact.id as string, phone_normalized: (contact.phone_normalized as string | null) ?? null, email_normalized: (contact.email_normalized as string | null) ?? null, archived: !!contact.archived_at };
  if (!key.phone_normalized && !key.email_normalized) {
    return { status: 200, body: { status: "no_contact_key", items: [], total_matches: 0, shown: 0, phone_scanned: false, scanned_orders: 0, window_full: false, contact_key_shared_with_active: false, contact_key_shared_with_archived: false, shared_phone_names: false, shared_email_names: false, ambiguous: false } };
  }

  // ALL of this business's contacts, active AND archived (same profile only): used only to see whether a key belongs to someone else
  const all = await fetchRecent(() => owner.supabase.from("bk_customers").select("id, phone_normalized, email_normalized, archived_at").eq("profile_id", profileId).order("id", { ascending: true }), 20_000);
  if (all.error) return dbFailure(all.error);

  // (1) ONLY for a contact with a usable phone: the most recent orders, matched on the normalised phone in Node. A contact without a phone runs no phone scan at all.
  // (2) for a contact with an e-mail: one exact e-mail query over ALL orders, so an e-mail match never depends on the window
  const phoneScanned = !!key.phone_normalized;
  const recent = phoneScanned
    ? await fetchRecent(() => owner.supabase.from("product_orders").select(ORDER_COLUMNS).eq("profile_id", profileId).order("created_at", { ascending: false }).order("id", { ascending: false }), ORDER_SCAN.window)
    : { rows: [] as any[], error: null };
  if (recent.error) return dbFailure(recent.error);
  let byEmail: any[] = [];
  if (key.email_normalized) {
    const r = await fetchRecent(() => owner.supabase.from("product_orders").select(ORDER_COLUMNS).eq("profile_id", profileId).ilike("customer_email", escapeLike(key.email_normalized as string)).order("created_at", { ascending: false }).order("id", { ascending: false }), ORDER_SCAN.window);
    if (r.error) return dbFailure(r.error);
    byEmail = r.rows;
  }
  const result = classifyOrders({
    contact: key,
    contacts: (all.rows as any[]).map((c) => ({ id: c.id, phone_normalized: c.phone_normalized ?? null, email_normalized: c.email_normalized ?? null, archived: !!c.archived_at })) as ContactKeys[],
    orders: [...recent.rows, ...byEmail] as OrderRow[],
    phoneScanned,
    scannedOrders: recent.rows.length,
    windowFull: phoneScanned && recent.rows.length >= ORDER_SCAN.window,
  });
  return { status: 200, body: result };
}
