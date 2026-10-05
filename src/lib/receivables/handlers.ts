// The Phase 3 API (debtors, contacts, reminders) as plain functions; routes in src/app/api/receivables/** are thin wrappers that resolve the
// owner (the same owner-only gate as bookkeeping and invoices) and call these.
//
// WRITE BOUNDARY: every write goes through a controlled database function, called with the OWNER's own profile id and user id taken from
// the session, never from the request. Reads use the owner-scoped (RLS) client AND filter by the owner's profile id. This module never
// INSERTs/UPDATEs/DELETEs a table, never touches bk_documents / bk_document_payments / bk_entries, and never creates a share link.
import { currencyMinorDigits, parseMinor } from "@/lib/bookkeeping/money";
import type { ApiResult, DocOwner } from "@/lib/documents/handlers";
import { isUuid } from "@/lib/documents/validation";
import { hashShareToken, shareUrl } from "@/lib/documents/shareToken";
import { recvError } from "./http";
import { buildWhatsAppReminder, renderReminderEmail, type ReminderContext } from "./reminderMessages";
import { parseBoolBody, parseContactBody, parseLinkBody, parseReminderBody, parseSettingsBody } from "./validation";
import { REMINDER_DEFAULTS, REMINDER_LIMITS } from "./constants";

const base = (o: DocOwner) => ({ p_profile_id: o.profile.id, p_actor_user_id: o.userId });
const bad = (details: string[]): ApiResult => ({ status: 400, body: { error: "validation_failed", details } });
const notFound = (error: string): ApiResult => ({ status: 404, body: { error } });

async function rpc(owner: DocOwner, fn: string, args: Record<string, unknown>, okStatus = 200): Promise<ApiResult> {
  const { data, error } = await owner.admin.rpc(fn, args);
  if (error) return recvError(error);
  return { status: okStatus, body: data };
}

/** Exact decimal text from the database -> integer minor units of the currency (0 when absent). Never through floating point. */
const minor = (value: unknown, currency: string): number => {
  const m = parseMinor(value ?? "0", currencyMinorDigits(currency));
  return m ?? 0;
};

// ----------------------------------------------------------------------------------------- contacts
const CONTACT_COLUMNS = "id, name, phone, email, notes, auto_reminders_paused, archived_at, created_at, updated_at";

export async function listContacts(owner: DocOwner, query: { archived?: string | null }): Promise<ApiResult> {
  let q = owner.supabase.from("bk_customers").select(CONTACT_COLUMNS).eq("profile_id", owner.profile.id);
  if (query.archived !== "1") q = q.is("archived_at", null);
  const { data, error } = await q.order("name", { ascending: true }).limit(500);
  if (error) return recvError(error);
  return { status: 200, body: { items: data || [] } };
}

export async function saveContact(owner: DocOwner, id: string | null, body: unknown): Promise<ApiResult> {
  if (id !== null && !isUuid(id)) return notFound("customer_not_found");
  const p = parseContactBody(body, id === null);
  if (!p.ok) return bad(p.details);
  const r = await rpc(owner, "bk_customer_save", {
    ...base(owner), p_customer_id: id, p_name: p.value.name, p_phone: p.value.phone, p_email: p.value.email, p_notes: p.value.notes,
    p_client_request_id: p.value.client_request_id,
    // the location is optional and is only sent when there is one: without it this is exactly the call that was always made (the original function)
    ...(p.value.address !== null ? { p_address: p.value.address } : {}),
  }, id === null ? 201 : 200);
  if (r.status >= 400 || "pdf" in r) return r;
  // an existing active contact with the same phone/email is REPORTED (409), never merged and never duplicated
  if (r.body?.duplicate_of) return { status: 409, body: { error: "duplicate_customer", existing: r.body.duplicate_of } };
  if (r.body?.duplicate === true) return { status: 200, body: r.body };
  return r;
}

export async function setContactArchived(owner: DocOwner, id: string, body: unknown): Promise<ApiResult> {
  if (!isUuid(id)) return notFound("customer_not_found");
  const p = parseBoolBody(body, "archived");
  if (!p.ok) return bad(p.details);
  return rpc(owner, "bk_customer_set_archived", { ...base(owner), p_customer_id: id, p_archived: p.value });
}

export async function setContactAutoPaused(owner: DocOwner, id: string, body: unknown): Promise<ApiResult> {
  if (!isUuid(id)) return notFound("customer_not_found");
  const p = parseBoolBody(body, "paused");
  if (!p.ok) return bad(p.details);
  return rpc(owner, "bk_customer_set_auto_paused", { ...base(owner), p_customer_id: id, p_paused: p.value });
}

// ----------------------------------------------------------------------------------------- linking
export async function getDocumentCustomer(owner: DocOwner, documentId: string): Promise<ApiResult> {
  if (!isUuid(documentId)) return notFound("document_not_found");
  const link = await owner.supabase.from("bk_document_customer_links").select("customer_id").eq("document_id", documentId).eq("profile_id", owner.profile.id).maybeSingle();
  if (link.error) return recvError(link.error);
  if (!link.data?.customer_id) return { status: 200, body: { customer: null } };
  const c = await owner.supabase.from("bk_customers").select(CONTACT_COLUMNS).eq("id", link.data.customer_id).eq("profile_id", owner.profile.id).maybeSingle();
  if (c.error) return recvError(c.error);
  return { status: 200, body: { customer: c.data ?? null } };
}

export async function setDocumentCustomer(owner: DocOwner, documentId: string, body: unknown): Promise<ApiResult> {
  if (!isUuid(documentId)) return notFound("document_not_found");
  const p = parseLinkBody(body);
  if (!p.ok) return bad(p.details);
  return rpc(owner, "doc_set_document_customer", { ...base(owner), p_document_id: documentId, p_customer_id: p.value });
}

export async function suggestContacts(owner: DocOwner, documentId: string): Promise<ApiResult> {
  if (!isUuid(documentId)) return notFound("document_not_found");
  const r = await rpc(owner, "doc_suggest_customers", { ...base(owner), p_document_id: documentId });
  if (r.status !== 200 || "pdf" in r) return r;
  return { status: 200, body: { items: r.body ?? [] } };
}

// ----------------------------------------------------------------------------------------- receivables (read-only)
export async function receivablesSummary(owner: DocOwner): Promise<ApiResult> {
  const r = await rpc(owner, "doc_receivables_summary", base(owner));
  if (r.status !== 200 || "pdf" in r) return r;
  const d = r.body;
  const currencies = ((d?.currencies as any[]) || []).map((c) => {
    const cur = String(c.currency);
    const aging: Record<string, { amount_minor: number; count: number }> = {};
    for (const [k, v] of Object.entries(c.aging || {})) aging[k] = { amount_minor: minor((v as any).amount, cur), count: Number((v as any).count) || 0 };
    return {
      currency: cur, can_record_payment: c.can_record_payment === true, outstanding_minor: minor(c.outstanding, cur), overdue_minor: minor(c.overdue, cur),
      invoice_count: c.invoice_count, overdue_count: c.overdue_count, aging,
      customers: ((c.customers as any[]) || []).map((x) => ({
        customer_id: x.customer_id, name: x.name, archived: x.archived === true, auto_paused: x.auto_paused === true,
        outstanding_minor: minor(x.outstanding, cur), overdue_minor: minor(x.overdue, cur), invoice_count: x.invoice_count, oldest_due_date: x.oldest_due_date ?? null,
        last_reminder_at: x.last_reminder_at ?? null,
      })),
      unassigned: { outstanding_minor: minor(c.unassigned?.outstanding, cur), overdue_minor: minor(c.unassigned?.overdue, cur), invoice_count: c.unassigned?.invoice_count ?? 0 },
    };
  });
  return { status: 200, body: { today: d?.today ?? null, profile_currency: d?.profile_currency ?? null, currencies } };
}

export type InvoiceQuery = { customer?: string | null; unassigned?: string | null; overdue?: string | null; currency?: string | null; limit?: string | null; offset?: string | null };

export async function receivableInvoices(owner: DocOwner, query: InvoiceQuery): Promise<ApiResult> {
  if (query.customer && !isUuid(query.customer)) return notFound("customer_not_found");
  const currency = query.currency && /^[A-Za-z]{3}$/.test(query.currency) ? query.currency.toUpperCase() : null;
  const int = (v: string | null | undefined, d: number) => (v && /^\d{1,6}$/.test(v) ? Number(v) : d);
  const r = await rpc(owner, "doc_receivable_invoices", {
    ...base(owner), p_customer_id: query.customer || null, p_unassigned: query.unassigned === "1", p_overdue_only: query.overdue === "1", p_currency: currency,
    p_limit: int(query.limit, 50), p_offset: int(query.offset, 0),
  });
  if (r.status !== 200 || "pdf" in r) return r;
  const items = ((r.body?.items as any[]) || []).map((i) => ({
    id: i.id, number: i.number, status: i.status, issue_date: i.issue_date, due_date: i.due_date, currency: i.currency,
    total_minor: minor(i.total, i.currency), amount_paid_minor: minor(i.amount_paid, i.currency), amount_due_minor: minor(i.amount_due, i.currency),
    overdue: i.overdue === true, days_overdue: i.days_overdue, customer_id: i.customer_id ?? null, customer_name: i.customer_name ?? null, linked: i.linked === true,
    has_email: i.has_email === true, has_phone: i.has_phone === true, can_record_payment: i.can_record_payment === true,
    last_reminder_at: i.last_reminder_at ?? null, reminders_sent: i.reminders_sent ?? 0,
  }));
  return { status: 200, body: { items, total: r.body?.total ?? 0 } };
}

export async function contactStatement(owner: DocOwner, id: string): Promise<ApiResult> {
  if (!isUuid(id)) return notFound("customer_not_found");
  const r = await rpc(owner, "doc_customer_statement", { ...base(owner), p_customer_id: id });
  if (r.status !== 200 || "pdf" in r) return r;
  const d = r.body;
  const c = d.customer || {};
  return {
    status: 200,
    body: {
      customer: { id: c.id, name: c.name, phone: c.phone, email: c.email, notes: c.notes, auto_reminders_paused: c.auto_reminders_paused === true, archived: !!c.archived_at },
      profile_currency: d.profile_currency,
      invoices: ((d.invoices as any[]) || []).map((i) => ({
        id: i.id, number: i.number, status: i.status, currency: i.currency, total_minor: minor(i.total, i.currency), amount_paid_minor: minor(i.amount_paid, i.currency),
        amount_due_minor: minor(i.amount_due, i.currency), issue_date: i.issue_date, due_date: i.due_date, overdue: i.overdue === true, can_record_payment: i.can_record_payment === true,
      })),
      payments: ((d.payments as any[]) || []).map((p) => ({
        id: p.id, invoice_id: p.invoice_id, invoice_number: p.invoice_number, receipt_number: p.receipt_number, amount_minor: minor(p.amount, p.currency), currency: p.currency,
        method: p.method, reference: p.reference, paid_on: p.paid_on, voided: p.voided === true,
      })),
      totals: ((d.totals as any[]) || []).map((t) => ({ currency: t.currency, outstanding_minor: minor(t.outstanding, t.currency), overdue_minor: minor(t.overdue, t.currency) })),
    },
  };
}

// ----------------------------------------------------------------------------------------- reminder settings
export async function getReminderSettings(owner: DocOwner): Promise<ApiResult> {
  const s = await owner.supabase.from("bk_reminder_settings").select("auto_email_enabled, auto_enabled_at, remind_before_days, remind_on_due, overdue_every_days, max_auto_per_invoice, owner_alerts_enabled")
    .eq("profile_id", owner.profile.id).maybeSingle();
  if (s.error) return recvError(s.error);
  const bp = await owner.supabase.from("bk_business_profiles").select("email").eq("profile_id", owner.profile.id).maybeSingle();
  if (bp.error) return recvError(bp.error);
  return {
    status: 200,
    body: {
      settings: s.data ?? { auto_email_enabled: false, auto_enabled_at: null, remind_before_days: null, remind_on_due: false, overdue_every_days: REMINDER_DEFAULTS.overdueEveryDays, max_auto_per_invoice: REMINDER_DEFAULTS.maxAutoPerInvoice, owner_alerts_enabled: false },
      business_email_present: !!bp.data?.email,
      limits: REMINDER_LIMITS,
    },
  };
}

export async function putReminderSettings(owner: DocOwner, body: unknown): Promise<ApiResult> {
  const p = parseSettingsBody(body);
  if (!p.ok) return bad(p.details);
  return rpc(owner, "doc_upsert_reminder_settings", {
    ...base(owner), p_auto_email_enabled: p.value.auto_email_enabled, p_remind_before_days: p.value.remind_before_days, p_remind_on_due: p.value.remind_on_due,
    p_overdue_every_days: p.value.overdue_every_days, p_max_auto_per_invoice: p.value.max_auto_per_invoice, p_owner_alerts_enabled: p.value.owner_alerts_enabled,
  });
}

// ----------------------------------------------------------------------------------------- reminders
export async function listReminders(owner: DocOwner, documentId: string): Promise<ApiResult> {
  if (!isUuid(documentId)) return notFound("document_not_found");
  const { data, error } = await owner.supabase.from("bk_reminders")
    .select("id, trigger_type, channel, kind, status, amount_due, currency, due_date, days_overdue, include_link, recipient_hint, failure_code, created_at, completed_at")
    .eq("document_id", documentId).eq("profile_id", owner.profile.id).order("created_at", { ascending: false }).limit(50);
  if (error) return recvError(error);
  return { status: 200, body: { items: (data || []).map((r: any) => ({ ...r, amount_due_minor: minor(r.amount_due, r.currency), amount_due: undefined })) } };
}

export type SendDeps = {
  /** The existing shared email sender (src/lib/email/provider.ts sendEmail); injected so tests never send. */
  send: (input: { to: string; subject: string; html: string; replyTo?: string | null; log?: { emailType: string; resourceType?: string | null; resourceId?: string | null } }) => Promise<{ ok: boolean; error?: string }>;
  /** Public origin used only to rebuild the link the owner already holds. */
  origin: string;
};

/**
 * One manual reminder. EMAIL: the row is claimed first (database limits and checks), then sent through the existing email infrastructure
 * with the reminder id as the provider idempotency key, then its outcome is recorded once. WHATSAPP: only a draft + click-to-chat link is
 * prepared and logged as "prepared"; Ringo never sends it. A link is included ONLY when the owner pasted one that the database confirms
 * is a valid share link of this very invoice: this code never creates a share link and never stores the token.
 */
export async function sendReminder(owner: DocOwner, documentId: string, body: unknown, deps: SendDeps): Promise<ApiResult> {
  if (!isUuid(documentId)) return notFound("document_not_found");
  const p = parseReminderBody(body);
  if (!p.ok) return bad(p.details);
  const token = p.value.share_token;
  const r = await rpc(owner, "doc_record_manual_reminder", {
    ...base(owner), p_document_id: documentId, p_channel: p.value.channel, p_client_request_id: p.value.client_request_id,
    p_share_token_hash: token ? hashShareToken(token) : null,
  });
  if (r.status !== 200 || "pdf" in r) return r;
  const res = r.body;
  if (res.duplicate === true) return { status: 200, body: { duplicate: true, reminder_id: res.reminder_id, channel: res.channel, status: res.status } };

  const ctx = res.context as ReminderContext & { include_link: boolean };
  const link = ctx.include_link && token ? shareUrl(deps.origin, token) : null;

  if (p.value.channel === "whatsapp_manual") {
    const wa = buildWhatsAppReminder(ctx, link);
    if (!wa) return { status: 409, body: { error: "no_phone" } };
    return { status: 201, body: { reminder_id: res.reminder_id, channel: "whatsapp_manual", status: "prepared", whatsapp: wa } };
  }

  // email: claimed above; now the single send attempt
  const mail = renderReminderEmail(ctx, link);
  let outcome: { status: "sent" | "failed" | "suppressed"; code: string | null };
  try {
    const sent = ctx.to
      ? await deps.send({ to: ctx.to, subject: mail.subject, html: mail.html, replyTo: ctx.reply_to, log: { emailType: "invoice_reminder", resourceType: "invoice_reminder", resourceId: res.reminder_id } })
      : { ok: false, error: "no_recipient" };
    outcome = sent.ok ? { status: "sent", code: null } : sent.error === "all_recipients_suppressed" ? { status: "suppressed", code: "suppressed" } : { status: "failed", code: String(sent.error || "send_failed").slice(0, 60) };
  } catch {
    outcome = { status: "failed", code: "send_threw" };
  }
  const done = await rpc(owner, "doc_complete_reminder", { p_profile_id: owner.profile.id, p_reminder_id: res.reminder_id, p_status: outcome.status, p_failure_code: outcome.code });
  if (done.status !== 200) console.error("receivables: could not record reminder outcome", res.reminder_id);
  if (outcome.status === "sent") return { status: 201, body: { reminder_id: res.reminder_id, channel: "email", status: "sent" } };
  if (outcome.status === "suppressed") return { status: 409, body: { error: "email_suppressed", reminder_id: res.reminder_id } };
  return { status: 502, body: { error: "email_failed", reminder_id: res.reminder_id } };
}
