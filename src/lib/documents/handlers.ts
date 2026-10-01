// The Phase 2 document API, as plain functions. Routes in src/app/api/documents/** are thin wrappers: they resolve the owner (session,
// owner-only, category, plan flag, demo) and call these. Keeping the logic here makes it testable with a fake owner.
//
// WRITE BOUNDARY: every write goes through a controlled database function (doc_*), called with the OWNER's own profile id and user id
// taken from the session — never from the request. These handlers never INSERT/UPDATE/DELETE a table directly.
// READS use the owner-scoped (row-level-security) client AND filter by the owner's profile id explicitly.
// Totals, numbers, dates, snapshots and hashes are always produced by the database; nothing the client sends for them is used.
import { currencyMinorDigits, parseMinor } from "@/lib/bookkeeping/money";
import { toLocalDateKey } from "@/lib/bookkeeping/summary";
import { documentActions } from "./actions";
import { SHARE_DEFAULT_DAYS, SHARE_MAX_ACTIVE, SHARE_MAX_DAYS } from "./shareConstants";
import { generateShareToken, hashShareToken, shareUrl } from "./shareToken";
import { DOCUMENT_STATUSES, DOCUMENT_TIME_ZONE } from "./constants";
import { docError } from "./http";
import { renderDocumentPdfSafe } from "./pdf/render";
import { safeFilename } from "./pdfText";
import { modelFromRows } from "./snapshot";
import { isOverdue } from "./totals";
import { isUuid, parseBusinessProfileBody, parseDraftBody, parsePaymentBody, parseReasonBody } from "./validation";

export type DocOwner = { userId: string; profile: { id: string; currency: string | null }; supabase: any; admin: any };
export type ApiResult = { status: number; body: any } | { status: 200; pdf: Uint8Array; filename: string };

const currencyOf = (o: DocOwner) => (o.profile.currency || "XAF").toUpperCase();
const todayKey = () => toLocalDateKey(new Date(), DOCUMENT_TIME_ZONE);
const bad = (details: string[]): ApiResult => ({ status: 400, body: { error: "validation_failed", details } });
const notFound = (): ApiResult => ({ status: 404, body: { error: "document_not_found" } });

async function rpc(owner: DocOwner, fn: string, args: Record<string, unknown>, okStatus = 200): Promise<ApiResult> {
  const { data, error } = await owner.admin.rpc(fn, args);
  if (error) return docError(error);
  return { status: okStatus, body: data };
}
const base = (o: DocOwner) => ({ p_profile_id: o.profile.id, p_actor_user_id: o.userId });

function minor(value: unknown, digits: number): number {
  const m = parseMinor(value, digits);
  if (m === null) throw new Error("unreadable stored amount");
  return m;
}

// ----------------------------------------------------------------------------------------- business profile
export async function getBusinessProfile(owner: DocOwner): Promise<ApiResult> {
  const [bp, prof] = await Promise.all([
    owner.supabase.from("bk_business_profiles").select("*").eq("profile_id", owner.profile.id).maybeSingle(),
    owner.supabase.from("profiles").select("name, username").eq("id", owner.profile.id).maybeSingle(),
  ]);
  if (bp.error) return docError(bp.error);
  // The public profile name is only a SUGGESTION for the form: it is never copied into the business-document profile automatically.
  return { status: 200, body: { profile_id: owner.profile.id, profile: bp.data ?? null, suggestion: { display_name: prof.data?.name || prof.data?.username || "" }, currency: currencyOf(owner) } };
}

export async function putBusinessProfile(owner: DocOwner, body: unknown): Promise<ApiResult> {
  const p = parseBusinessProfileBody(body);
  if (!p.ok) return bad(p.details);
  const v = p.value;
  return rpc(owner, "doc_upsert_business_profile", {
    ...base(owner), p_display_name: v.display_name, p_legal_name: v.legal_name, p_address: v.address, p_phone: v.phone, p_email: v.email,
    p_tax_id: v.tax_id, p_registration_no: v.registration_no, p_default_terms: v.default_terms, p_default_due_days: v.default_due_days,
    p_tax_label: v.tax_label, p_tax_rate_bp: v.tax_rate_bp,
  });
}

// ----------------------------------------------------------------------------------------- list
export async function listDocuments(owner: DocOwner, query: { status?: string | null; limit?: string | null; offset?: string | null }): Promise<ApiResult> {
  const status = query.status || null;
  if (status && !(DOCUMENT_STATUSES as readonly string[]).includes(status)) return bad(["invalid_status"]);
  const limit = query.limit === undefined || query.limit === null ? 25 : Number(query.limit);
  const offset = query.offset === undefined || query.offset === null ? 0 : Number(query.offset);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) return bad(["invalid_paging"]);

  let q = owner.supabase
    .from("bk_documents")
    .select("id, number, status, issue_date, due_date, currency, total, amount_paid, created_at, customer_name:customer_snapshot->>name", { count: "exact" })
    .eq("profile_id", owner.profile.id)
    .eq("doc_type", "invoice");
  if (status) q = q.eq("status", status);
  const { data, error, count } = await q.order("created_at", { ascending: false }).range(offset, offset + limit - 1);
  if (error) return docError(error);
  const today = todayKey();
  try {
    const items = (data || []).map((r: any) => {
      const digits = currencyMinorDigits(r.currency);
      const total = minor(r.total, digits), paid = minor(r.amount_paid, digits);
      return {
        id: r.id, number: r.number, status: r.status, customer_name: r.customer_name ?? null, issue_date: r.issue_date, due_date: r.due_date,
        currency: r.currency, minor_digits: digits, total_minor: total, amount_paid_minor: paid, balance_minor: Math.max(0, total - paid),
        overdue: isOverdue({ status: r.status, dueDate: r.due_date, totalMinor: total, amountPaidMinor: paid }, today), created_at: r.created_at,
        // "correct" needs the replacement lookup, which only the detail view does; the list never offers it
        actions: documentActions({ docType: "invoice", status: r.status, totalMinor: total, amountPaidMinor: paid, wasIssued: !!r.number, replaced: true }),
      };
    });
    return { status: 200, body: { items, total: count ?? items.length, limit, offset } };
  } catch {
    console.error("documents list: unreadable stored amount");
    return { status: 500, body: { error: "internal_error" } };
  }
}

// ----------------------------------------------------------------------------------------- one document
export async function loadDocumentFrom(db: any, profileId: string, id: string) {
  const doc = await db.from("bk_documents").select("*").eq("id", id).eq("profile_id", profileId).maybeSingle();
  if (doc.error) return { error: docError(doc.error) as ApiResult };
  if (!doc.data) return { error: notFound() };
  const lines = await db.from("bk_document_lines").select("*").eq("document_id", id).order("position", { ascending: true });
  if (lines.error) return { error: docError(lines.error) as ApiResult };
  return { doc: doc.data, lines: lines.data || [] };
}
const loadDocument = (owner: DocOwner, id: string) => loadDocumentFrom(owner.supabase, owner.profile.id, id);

/** The exact shape the invoice editor posts, built from a stored document (a draft being edited, or a voided invoice being corrected). */
function editorForm(doc: any, lines: any[]) {
  return {
    locale: doc.locale, customer: doc.customer_snapshot ?? null, due_date: null as string | null, notes: doc.notes ?? null, terms: doc.terms ?? null,
    tax_enabled: doc.tax_rate_bp !== null,
    lines: lines.map((l: any) => ({ description: l.description, quantity: String(l.quantity), unit_price: String(l.unit_price), discount_amount: String(l.discount_amount), product_id: l.product_id ?? null })),
  };
}

export async function getDocument(owner: DocOwner, id: string): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  const loaded = await loadDocument(owner, id);
  if ("error" in loaded) return loaded.error as ApiResult;
  const { doc, lines } = loaded;
  const pid = owner.profile.id;
  const digits = currencyMinorDigits(doc.currency);

  let parent: { doc: any; lines: any[] } | null = null;
  if (doc.doc_type === "receipt" && doc.parent_document_id) {
    const p = await loadDocument(owner, doc.parent_document_id);
    if (!("error" in p)) parent = { doc: p.doc, lines: p.lines };
  }

  const paymentsQ = doc.doc_type === "invoice"
    ? owner.supabase.from("bk_document_payments").select("*").eq("invoice_id", id).eq("profile_id", pid).order("created_at", { ascending: true })
    : owner.supabase.from("bk_document_payments").select("*").eq("receipt_document_id", id).eq("profile_id", pid);
  const [payments, events, replacedBy] = await Promise.all([
    paymentsQ,
    owner.supabase.from("bk_document_events").select("event_type, created_at, details").eq("document_id", id).eq("profile_id", pid).order("created_at", { ascending: true }),
    owner.supabase.from("bk_documents").select("id, number").eq("replaces_document_id", id).eq("profile_id", pid).maybeSingle(),
  ]);
  for (const r of [payments, events]) if (r.error) return docError(r.error);

  const receiptIds = (payments.data || []).map((p: any) => p.receipt_document_id);
  const receiptDocs = receiptIds.length
    ? (await owner.supabase.from("bk_documents").select("id, number, status").in("id", receiptIds).eq("profile_id", pid)).data || []
    : [];
  const receiptById = new Map<string, any>(receiptDocs.map((r: any) => [r.id, r]));

  let model;
  try {
    model = modelFromRows({ doc, lines, parent, todayKey: todayKey() });
  } catch {
    console.error("documents get: unreadable stored document", id);
    return { status: 500, body: { error: "document_unreadable" } };
  }
  const invoiceVoid = doc.status === "void";
  const paymentViews = (payments.data || []).map((p: any) => {
    const r = receiptById.get(p.receipt_document_id);
    const voided = !!p.voided_at;
    return {
      id: p.id, receipt_document_id: p.receipt_document_id, receipt_number: r?.number ?? null, receipt_status: r?.status ?? null,
      amount_minor: minor(p.amount, digits), balance_after_minor: minor(p.balance_after, digits), method: p.method, reference: p.reference ?? null,
      paid_on: p.paid_on, recorded_at: p.created_at, voided, void_reason: p.void_reason ?? null,
      // the only way to void a payment is the controlled workflow; offered only while it is allowed
      can_void: doc.doc_type === "invoice" && !voided && !invoiceVoid,
    };
  });
  const balance = Math.max(0, model.totalMinor - model.amountPaidMinor);
  const isInvoice = doc.doc_type === "invoice";
  const actions = documentActions({ docType: doc.doc_type, status: doc.status, totalMinor: model.totalMinor, amountPaidMinor: model.amountPaidMinor, wasIssued: !!doc.issued_at, replaced: !!replacedBy.data });
  return {
    status: 200,
    body: {
      id: doc.id, doc_type: doc.doc_type, status: doc.status, model, balance_minor: balance,
      overdue: isInvoice ? isOverdue({ status: doc.status, dueDate: doc.due_date, totalMinor: model.totalMinor, amountPaidMinor: model.amountPaidMinor }, todayKey()) : false,
      created_at: doc.created_at, issued_at: doc.issued_at, voided_at: doc.voided_at, void_reason: doc.void_reason ?? null,
      replaces_document_id: doc.replaces_document_id ?? null, replaced_by: replacedBy.data ?? null,
      parent: parent ? { id: parent.doc.id, number: parent.doc.number } : null,
      payments: paymentViews, events: events.data || [], actions,
      // The editor's form: the draft itself when editing; for a VOIDED (previously issued) invoice, a copy to start a corrected invoice from.
      // A copy never carries the old due date (a new invoice gets its own).
      draft: doc.status === "draft" ? { ...editorForm(doc, lines), due_date: doc.due_date } : null,
      correction_form: isInvoice && doc.status === "void" && doc.issued_at ? editorForm(doc, lines) : null,
    },
  };
}

// ----------------------------------------------------------------------------------------- drafts
const draftArgs = (owner: DocOwner, documentId: string | null, v: ReturnType<typeof parseDraftBody> & { ok: true }) => ({
  ...base(owner), p_document_id: documentId, p_doc_type: "invoice", p_locale: v.value.locale, p_customer: v.value.customer, p_due_date: v.value.due_date,
  p_notes: v.value.notes, p_terms: v.value.terms, p_tax_enabled: v.value.tax_enabled, p_lines: v.value.lines, p_replaces_document_id: v.value.replaces_document_id,
  p_client_request_id: v.value.client_request_id,
});

export async function createDraft(owner: DocOwner, body: unknown): Promise<ApiResult> {
  const v = parseDraftBody(body, currencyOf(owner));
  if (!v.ok) return bad(v.details);
  const r = await rpc(owner, "doc_save_draft", draftArgs(owner, null, v), 201);
  if (r.status === 201 && (r as any).body?.duplicate === true) return { status: 200, body: (r as any).body };
  return r;
}

export async function updateDraft(owner: DocOwner, id: string, body: unknown): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  const loaded = await loadDocument(owner, id);
  if ("error" in loaded) return loaded.error as ApiResult;
  if (loaded.doc.doc_type !== "invoice" || loaded.doc.status !== "draft") return { status: 409, body: { error: "document_not_draft" } };
  const v = parseDraftBody(body, loaded.doc.currency);      // a draft keeps the currency it was created in
  if (!v.ok) return bad(v.details);
  // The database replaces a draft's replaces_document_id with the value passed in, so an edit that omits it must KEEP the stored one
  // (otherwise editing a corrected-invoice draft would silently drop its link to the voided invoice).
  const keep = { ...v, value: { ...v.value, replaces_document_id: v.value.replaces_document_id ?? loaded.doc.replaces_document_id ?? null } };
  return rpc(owner, "doc_save_draft", draftArgs(owner, id, keep as typeof v));
}

/** "Delete" of a draft = discard (void): nothing is ever deleted and a draft has no number to consume. Issued documents use voidDocument. */
export async function discardDraft(owner: DocOwner, id: string): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  const loaded = await loadDocument(owner, id);
  if ("error" in loaded) return loaded.error as ApiResult;
  if (loaded.doc.doc_type !== "invoice" || loaded.doc.status !== "draft") return { status: 409, body: { error: "document_not_draft" } };
  return rpc(owner, "doc_void_document", { ...base(owner), p_document_id: id, p_reason: "Draft discarded" });
}

// ----------------------------------------------------------------------------------------- state changes
export async function issueDocument(owner: DocOwner, id: string): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  // Nothing from the client is used: number, date, totals, snapshots and hash all come from the database.
  return rpc(owner, "doc_issue", { ...base(owner), p_document_id: id });
}

export async function voidDocument(owner: DocOwner, id: string, body: unknown): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  const r = parseReasonBody(body);
  if (!r.ok) return bad(r.details);
  return rpc(owner, "doc_void_document", { ...base(owner), p_document_id: id, p_reason: r.value.reason });
}

export async function recordPayment(owner: DocOwner, invoiceId: string, body: unknown): Promise<ApiResult> {
  if (!isUuid(invoiceId)) return notFound();
  const p = parsePaymentBody(body, currencyOf(owner), todayKey());
  if (!p.ok) return bad(p.details);
  const r = await rpc(owner, "doc_record_payment", {
    ...base(owner), p_invoice_id: invoiceId, p_amount: p.value.amount, p_method: p.value.method, p_reference: p.value.reference,
    p_paid_on: p.value.paid_on, p_client_request_id: p.value.client_request_id,
  }, 201);
  if (r.status === 201 && (r as any).body?.duplicate === true) return { status: 200, body: (r as any).body };
  return r;
}

/** The ONLY way to void an invoice payment: voids the payment, its receipt AND its bookkeeping entry together. */
export async function voidPayment(owner: DocOwner, paymentId: string, body: unknown): Promise<ApiResult> {
  if (!isUuid(paymentId)) return { status: 404, body: { error: "payment_not_found" } };
  const r = parseReasonBody(body);
  if (!r.ok) return bad(r.details);
  return rpc(owner, "doc_void_payment", { ...base(owner), p_payment_id: paymentId, p_reason: r.value.reason });
}

// ----------------------------------------------------------------------------------------- PDF (owner download)
/**
 * Builds the PDF of one stored document. Shared by the owner download and the public share link, so both produce the SAME bytes from
 * the same immutable snapshot, behind the same tamper check. `db` reads rows (owner client or service role); `admin` runs the hash.
 */
export async function renderStoredPdf(db: any, admin: any, profileId: string, id: string): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  const loaded = await loadDocumentFrom(db, profileId, id);
  if ("error" in loaded) return loaded.error as ApiResult;
  const { doc, lines } = loaded;

  // Tamper evidence: an issued document is rendered only if its stored content still matches the hash computed at issue.
  if (doc.status !== "draft") {
    const h = await admin.rpc("bk_doc_hash", { p_document_id: id });
    if (h.error) return docError(h.error);
    if (!doc.content_hash || h.data !== doc.content_hash) {
      console.error("documents pdf: integrity check failed for", id);
      return { status: 500, body: { error: "integrity_check_failed" } };
    }
  }
  let parent: { doc: any; lines: any[] } | null = null;
  if (doc.doc_type === "receipt" && doc.parent_document_id) {
    const p = await loadDocumentFrom(db, profileId, doc.parent_document_id);
    if ("error" in p) return p.error as ApiResult;
    parent = { doc: p.doc, lines: p.lines };
  }
  let model;
  try {
    model = modelFromRows({ doc, lines, parent, todayKey: todayKey() });
  } catch {
    return { status: 500, body: { error: "document_unreadable" } };
  }
  const out = await renderDocumentPdfSafe(model);
  if (!out.ok) {
    console.error("documents pdf: render failed:", out.error);
    return { status: 500, body: { error: "pdf_failed" } };
  }
  return { status: 200, pdf: out.bytes, filename: `${safeFilename(doc.number || `draft-${String(id).slice(0, 8)}`)}.pdf` };
}

export async function renderPdf(owner: DocOwner, id: string): Promise<ApiResult> {
  return renderStoredPdf(owner.supabase, owner.admin, owner.profile.id, id);
}

// ----------------------------------------------------------------------------------------- share links (owner side)
// The raw token is generated here, shown to the owner ONCE in the create response and never stored: the database receives only its
// SHA-256 hash. A list can therefore never reveal a working link.
export async function createShare(owner: DocOwner, id: string, body: unknown, origin: string): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  const raw = body && typeof body === "object" ? (body as any).expires_in_days : undefined;
  let days = SHARE_DEFAULT_DAYS;
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > SHARE_MAX_DAYS) return bad(["invalid_expiry"]);
    days = raw;
  }
  const token = generateShareToken();
  const r = await rpc(owner, "doc_create_share", { ...base(owner), p_document_id: id, p_token_hash: hashShareToken(token), p_expires_in_days: days }, 201);
  if (r.status !== 201 || "pdf" in r) return r;
  if (!r.body || typeof r.body.share_id !== "string") return { status: 500, body: { error: "share_failed" } };
  return { status: 201, body: { share_id: r.body.share_id, document_id: r.body.document_id, expires_at: r.body.expires_at, url: shareUrl(origin, token) } };
}

export async function listShares(owner: DocOwner, id: string): Promise<ApiResult> {
  if (!isUuid(id)) return notFound();
  const doc = await owner.supabase.from("bk_documents").select("id").eq("id", id).eq("profile_id", owner.profile.id).maybeSingle();
  if (doc.error) return docError(doc.error);
  if (!doc.data) return notFound();
  const { data, error } = await owner.supabase.from("bk_document_shares")
    .select("id, expires_at, revoked_at, created_at, last_accessed_at, access_count")
    .eq("document_id", id).eq("profile_id", owner.profile.id).order("created_at", { ascending: false }).limit(50);
  if (error) return docError(error);
  const now = Date.now();
  const items = (data || []).map((s: any) => ({
    id: s.id, expires_at: s.expires_at, revoked_at: s.revoked_at, created_at: s.created_at, last_accessed_at: s.last_accessed_at, access_count: s.access_count,
    active: !s.revoked_at && new Date(s.expires_at).getTime() > now,
  }));
  return { status: 200, body: { items, max_active: SHARE_MAX_ACTIVE } };
}

export async function revokeShare(owner: DocOwner, shareId: string): Promise<ApiResult> {
  if (!isUuid(shareId)) return { status: 404, body: { error: "share_not_found" } };
  return rpc(owner, "doc_revoke_share", { ...base(owner), p_share_id: shareId });
}
