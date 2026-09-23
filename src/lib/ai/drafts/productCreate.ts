import type { DraftDefinition, DraftValidationContext, ValidationResult } from "./types";

// product.create — one catalog product. Applied through the owner's session
// client with the same insert CatalogCard makes (RLS "products owner
// write"), plus the fields its Save writes. Products have no hidden state in
// Ringo: once confirmed, the product is visible on the public page — the
// review card says so explicitly. Photos, stock and links are added in
// Catalog afterwards (Ringo AI never uploads images).
//
// Plan rule: identical to Editor.tsx/CatalogCard — plans.max_products === 0
// locks the catalog; otherwise the count must be below max_products (null =
// unlimited). Checked when the draft is prepared, and ENFORCED atomically at
// apply time by ai_create_product_within_limit (count + insert in one
// transaction under a per-profile lock, run as the owner so "products owner
// write" RLS applies) — two simultaneous confirms can't share the last slot.

export interface ProductDraftPayload {
  name: string;
  description: string | null;
  price: number | null;
  /** The store currency the price was prepared in; apply refuses if it changed since. */
  currency: string;
}

const MAX_PRICE = 100_000_000;

export function validateProductDraft(raw: unknown, ctx: DraftValidationContext): ValidationResult<ProductDraftPayload> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "invalid_input" };
  const r = raw as Record<string, unknown>;
  const invalid: string[] = [];

  const name = typeof r.name === "string" ? r.name.trim() : r.name == null ? "" : null;
  if (name === null || name.length > 120) invalid.push("name");
  const description = r.description == null ? null : typeof r.description === "string" ? r.description.trim() || null : undefined;
  if (description === undefined || (description && description.length > 1000)) invalid.push("description");

  const currency = ctx.facts.currency;
  let price: number | null = null;
  if (r.price !== null && r.price !== undefined) {
    const v = typeof r.price === "number" ? r.price : NaN;
    // XAF amounts have no decimals (as the rest of Ringo formats them); others at most 2.
    // (tolerance: 19.99 * 100 is 1998.9999… in floating point)
    const decimalsOk = currency === "XAF" ? Number.isInteger(v) : Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
    if (!Number.isFinite(v) || v < 0 || v > MAX_PRICE || !decimalsOk) invalid.push("price");
    else price = v;
  }
  // `currency` always comes from the live store currency (never the model).
  // At apply time a stored payload whose currency no longer matches
  // re-validates to a different payload → the apply route marks it stale.

  if (invalid.length) return { ok: false, reason: "invalid_input", fields: invalid };
  if (!name) return { ok: false, reason: "missing_fields", fields: ["name"] };
  return { ok: true, payload: { name, description: description ?? null, price, currency } };
}

export const productCreateDraft: DraftDefinition<ProductDraftPayload> = {
  type: "product.create",
  validate: validateProductDraft,

  availability(facts) {
    if (facts.maxProducts === 0) return { ok: false, reason: "feature_unavailable" };
    if (facts.maxProducts !== null && facts.productCount >= facts.maxProducts) return { ok: false, reason: "plan_limit_reached" };
    return { ok: true };
  },

  changes: (p) => [
    { field: "product_name", kind: "text", before: null, after: p.name },
    ...(p.description ? [{ field: "product_description", kind: "longtext" as const, before: null, after: p.description, generated: true }] : []),
    { field: "product_price", kind: "price", before: null, after: p.price === null ? null : { amount: p.price, currency: p.currency } },
  ],

  summary: (p) => `New product: ${p.name.slice(0, 80)}`,
  fieldNames: (p) => ["name", ...(p.description ? ["description"] : []), ...(p.price !== null ? ["price"] : [])],

  async apply(db, workspace, draft, facts) {
    if (facts.currency !== draft.payload.currency) return { ok: false, code: "stale" };
    const { data, error } = await db.rpc("ai_create_product_within_limit", {
      p_id: draft.targetId,
      p_profile_id: workspace.profileId,
      p_name: draft.payload.name,
      p_description: draft.payload.description,
      p_price: draft.payload.price,
    });
    const row = (Array.isArray(data) ? data[0] : data) as { outcome?: string } | null;
    if (error || !row) {
      if (error) console.error("ai product draft apply failed:", error.message);
      return { ok: false, code: "write_failed" };
    }
    switch (row.outcome) {
      case "inserted":
        return { ok: true, resultId: draft.targetId, alreadyApplied: false };
      case "already_exists": // retry of an apply whose insert already committed
        return { ok: true, resultId: draft.targetId, alreadyApplied: true };
      case "limit_reached":
        return { ok: false, code: "plan_limit_reached" };
      case "catalog_locked":
        return { ok: false, code: "feature_unavailable" };
      default:
        return { ok: false, code: "write_failed" };
    }
  },

  reviewPath: () => "/dashboard?section=catalog",
};
