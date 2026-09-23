import { isUuid } from "@/lib/customer/connect";
import { imageUrlFromOwner } from "./provenance";
import type { DraftChange, DraftDefinition, DraftValidationContext, ValidationResult } from "./types";

// product.update — edit ONE existing product the caller already owns (name,
// description, price, cover image). Applied through the owner's session
// client with the same columns CatalogCard's saveAll() writes (RLS
// "products owner write"). Unlike product.create, this never counts against
// plans.max_products — no availability gate beyond the product existing and
// being owned by this workspace (loadBase refuses otherwise).
//
// `null` on a field means "not changing it" — the same convention
// create_profile_draft already uses. `image_url`, when present, must be a
// URL the owner actually attached-and-uploaded in THIS conversation
// (imageUrlFromOwner) — the model can never invent or reuse one.

export interface ProductUpdatePayload {
  productId: string;
  name: string | null;
  description: string | null;
  price: number | null;
  imageUrl: string | null;
  /** The store currency at draft time; apply refuses if it changed since. */
  currency: string;
}

const MAX_PRICE = 100_000_000;

export function validateProductUpdateDraft(raw: unknown, ctx: DraftValidationContext): ValidationResult<ProductUpdatePayload> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "invalid_input" };
  const r = raw as Record<string, unknown>;
  const invalid: string[] = [];

  const productId = typeof r.productId === "string" ? r.productId : typeof r.product_id === "string" ? r.product_id : null;
  if (!productId || !isUuid(productId)) return { ok: false, reason: "invalid_input", fields: ["product_id"] };

  const name = r.name == null ? null : typeof r.name === "string" ? r.name.trim() || null : undefined;
  if (name === undefined || (name && name.length > 120)) invalid.push("name");

  const description = r.description == null ? null : typeof r.description === "string" ? r.description.trim() || null : undefined;
  if (description === undefined || (description && description.length > 1000)) invalid.push("description");

  const currency = ctx.facts.currency;
  let price: number | null = null;
  if (r.price !== null && r.price !== undefined) {
    const v = typeof r.price === "number" ? r.price : NaN;
    const decimalsOk = currency === "XAF" ? Number.isInteger(v) : Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
    if (!Number.isFinite(v) || v < 0 || v > MAX_PRICE || !decimalsOk) invalid.push("price");
    else price = v;
  }

  let imageUrl: string | null = null;
  if (r.image_url !== null && r.image_url !== undefined) {
    if (typeof r.image_url !== "string" || r.image_url.length > 2000) invalid.push("image_url");
    else if (!imageUrlFromOwner(r.image_url, ctx.userText)) return { ok: false, reason: "contact_not_from_user", fields: ["image_url"] };
    else imageUrl = r.image_url;
  }

  if (invalid.length) return { ok: false, reason: "invalid_input", fields: invalid };
  // invalid.length === 0 here guarantees name/description aren't the `undefined` (wrong-type) branch.
  const finalName = name ?? null;
  const finalDescription = description ?? null;
  if (finalName === null && finalDescription === null && price === null && imageUrl === null) return { ok: false, reason: "nothing_to_change" };
  return { ok: true, payload: { productId, name: finalName, description: finalDescription, price, imageUrl, currency } };
}

export const productUpdateDraft: DraftDefinition<ProductUpdatePayload> = {
  type: "product.update",
  validate: validateProductUpdateDraft,

  // No plan-limit gate — only product.create counts against max_products.
  availability: () => ({ ok: true }),

  async loadBase(db, workspace, payload) {
    const { data, error } = await db
      .from("products")
      .select("name, description, price, image_url")
      .eq("id", payload.productId)
      .eq("profile_id", workspace.profileId)
      .maybeSingle();
    if (error || !data) return null;
    return data as Record<string, unknown>;
  },

  changes(payload, base) {
    const b = base || {};
    const rows: DraftChange[] = [];
    if (payload.name !== null) rows.push({ field: "product_name", kind: "text", before: b.name ?? null, after: payload.name });
    if (payload.description !== null) rows.push({ field: "product_description", kind: "longtext", before: b.description ?? null, after: payload.description, generated: true });
    if (payload.price !== null) rows.push({ field: "product_price", kind: "price", before: b.price == null ? null : { amount: Number(b.price), currency: payload.currency }, after: { amount: payload.price, currency: payload.currency } });
    if (payload.imageUrl !== null) rows.push({ field: "product_image", kind: "image", before: b.image_url ?? null, after: payload.imageUrl });
    return rows;
  },

  summary(payload) {
    const n = [payload.name, payload.description, payload.price, payload.imageUrl].filter((v) => v !== null).length;
    return `Update product: ${n} field${n === 1 ? "" : "s"}`;
  },

  fieldNames: (payload) =>
    [
      payload.name !== null ? "name" : null,
      payload.description !== null ? "description" : null,
      payload.price !== null ? "price" : null,
      payload.imageUrl !== null ? "image_url" : null,
    ].filter((v): v is string => v !== null),

  async apply(db, workspace, draft, facts) {
    if (facts.currency !== draft.payload.currency) return { ok: false, code: "stale" };
    const base = draft.base;
    if (!base) return { ok: false, code: "invalid_payload" };
    const patch: Record<string, unknown> = {};
    if (draft.payload.name !== null) patch.name = draft.payload.name;
    if (draft.payload.description !== null) patch.description = draft.payload.description;
    if (draft.payload.price !== null) patch.price = draft.payload.price;
    if (draft.payload.imageUrl !== null) patch.image_url = draft.payload.imageUrl;

    const { data, error } = await db.rpc("ai_apply_product_update", {
      p_product_id: draft.payload.productId,
      p_profile_id: workspace.profileId,
      p_patch: patch,
      p_base: base,
    });
    if (error) {
      console.error("ai product update draft apply failed:", error.message);
      return { ok: false, code: "write_failed" };
    }
    switch (data) {
      case "updated":
        return { ok: true, resultId: draft.payload.productId, alreadyApplied: false };
      case "already_applied":
        return { ok: true, resultId: draft.payload.productId, alreadyApplied: true };
      case "stale":
        return { ok: false, code: "stale" };
      case "not_found":
        return { ok: false, code: "write_failed" };
      default:
        return { ok: false, code: "write_failed" };
    }
  },

  reviewPath: () => "/dashboard?section=catalog",
};
