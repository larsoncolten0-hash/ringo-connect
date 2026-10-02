// Record Sale, as plain functions (the routes under src/app/api/sales are thin wrappers; the owner comes from the same owner-only Business Toolkit gate as every
// other Toolkit route). WRITE BOUNDARY: the only write is the ONE database function sale_record, called with the owner's own profile id and user id from the
// session. It records the sale atomically through the existing bookkeeping, inventory and document functions; nothing here touches a table directly.
// READS use the owner-scoped (row-level-security) client with an explicit profile filter.
import { currencyMinorDigits, parseMinor } from "@/lib/bookkeeping/money";
import type { ApiResult, DocOwner } from "@/lib/documents/handlers";
import { syncBrandLogo } from "@/lib/documents/brand";
import { docError } from "@/lib/documents/http";
import { isUuid } from "@/lib/documents/validation";
import { parseSaleBody } from "./validation";

const bad = (details: string[]): ApiResult => ({ status: 400, body: { error: "validation_failed", details } });
const currencyOf = (o: DocOwner) => (o.profile.currency || "XAF").toUpperCase();

export async function recordSale(owner: DocOwner, body: unknown): Promise<ApiResult> {
  const parsed = parseSaleBody(body, currencyOf(owner));
  if (!parsed.ok) return bad(parsed.details);
  const v = parsed.value;
  // the profile picture is copied into the immutable logo store first, so the receipt freezes a reference to that copy (never the live URL)
  await syncBrandLogo(owner);
  const { data, error } = await owner.admin.rpc("sale_record", {
    p_profile_id: owner.profile.id,
    p_actor_user_id: owner.userId,
    p_locale: v.locale,
    p_lines: v.lines,
    p_customer_id: v.customer_id,
    p_method: v.method,
    p_sold_on: v.sold_on,
    p_notes: v.notes,
    p_client_request_id: v.client_request_id,
  });
  if (error) return docError(error);
  const doc = data?.document;
  if (!doc?.id) return { status: 500, body: { error: "internal_error" } };
  return {
    status: data.duplicate === true ? 200 : 201,
    body: { receipt: { id: doc.id, number: doc.number, total: doc.total, currency: doc.currency }, duplicate: data.duplicate === true, stock_movements: Array.isArray(data.movements) ? data.movements.length : 0 },
  };
}

/**
 * Voids a recorded sale (the receipt id). ONE database function does the whole reversal atomically: the receipt is marked void (kept), the bookkeeping sale is voided
 * through the existing bk_void_entry, and the exact quantity the sale took from a still-tracked product is put back through the existing inv_adjust_stock. Idempotent.
 */
export async function voidSale(owner: DocOwner, receiptId: string, body: unknown): Promise<ApiResult> {
  if (!isUuid(receiptId)) return { status: 404, body: { error: "document_not_found" } };
  const reason = body && typeof body === "object" && typeof (body as any).reason === "string" ? (body as any).reason.trim() : "";
  if (!reason || Array.from(reason).length > 300) return bad(["reason_required"]);
  const { data, error } = await owner.admin.rpc("sale_void", { p_profile_id: owner.profile.id, p_actor_user_id: owner.userId, p_receipt_id: receiptId, p_reason: reason });
  if (error) return docError(error);
  const doc = data?.document;
  if (!doc?.id) return { status: 500, body: { error: "internal_error" } };
  return {
    status: 200,
    body: {
      receipt: { id: doc.id, number: doc.number, status: doc.status },
      already_voided: data.already_voided === true,
      stock_restored: Array.isArray(data.restored) ? data.restored.length : 0,
      stock_not_restored: Array.isArray(data.not_restored) ? data.not_restored.length : 0,
    },
  };
}

/** The owner's last sale receipts (names only: no phone, e-mail or note). */
export async function listRecentSales(owner: DocOwner, limit = 10): Promise<ApiResult> {
  const { data, error } = await owner.supabase
    .from("bk_documents")
    .select("id, number, total, currency, issue_date, customer_snapshot, status, created_at")
    .eq("profile_id", owner.profile.id)
    .eq("doc_type", "receipt")
    .eq("source_type", "sale")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 25));
  if (error) return docError(error);
  const items = (data || []).map((d: any) => {
    const digits = currencyMinorDigits(String(d.currency));
    const minor = parseMinor(d.total, digits);
    return { id: d.id, number: d.number, total_minor: minor, currency: d.currency, issue_date: d.issue_date, status: d.status, customer_name: typeof d.customer_snapshot?.name === "string" ? d.customer_snapshot.name : null };
  });
  return { status: 200, body: { items } };
}

/** The products the owner can sell, with the current stock and whether stock is tracked. Reads only. */
export async function listSaleProducts(owner: DocOwner): Promise<ApiResult> {
  const pid = owner.profile.id;
  const [products, settings] = await Promise.all([
    owner.supabase.from("products").select("id, name, price, inventory_count, product_type, available").eq("profile_id", pid).order("sort_order", { ascending: true }).limit(500),
    owner.supabase.from("bk_stock_settings").select("product_id").eq("profile_id", pid).eq("active", true).limit(1000),
  ]);
  if (products.error) return docError(products.error);
  if (settings.error) return docError(settings.error);
  const tracked = new Set((settings.data || []).map((s: any) => s.product_id));
  const items = (products.data || []).map((p: any) => ({
    id: p.id, name: p.name, price: p.price === null || p.price === undefined ? null : String(p.price), product_type: p.product_type,
    tracked: tracked.has(p.id), stock: tracked.has(p.id) && typeof p.inventory_count === "number" ? p.inventory_count : null,
  }));
  return { status: 200, body: { items, currency: currencyOf(owner) } };
}
