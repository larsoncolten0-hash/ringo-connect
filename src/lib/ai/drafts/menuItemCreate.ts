import { profileHasCategory } from "@/lib/categories";
import { isUuid } from "@/lib/customer/connect";
import type { DraftChange, DraftDefinition, DraftValidationContext, ValidationResult } from "./types";

// menu_item.create — one new restaurant menu item, inside an EXISTING menu
// category (the Dashboard's own addItem() always creates an item within a
// specific category — there is no "uncategorized" item in the real UI, so
// this isn't an invented requirement). Applied through the owner's session
// client with the same columns MenuCard's addItem()/saveAllItems() write
// (RLS "menu_items owner write"). No plan limit exists for menu items
// (unlike products), so no advisory lock is needed — a plain owner-checked
// insert is enough.
//
// Never touches: image_url/image_urls (gallery stays Dashboard-only, same
// rule as products and menu_item.update), menu categories themselves
// (create/rename/delete stays Dashboard-only).

export interface MenuItemCreatePayload {
  menuCategoryId: string;
  name: string;
  description: string | null;
  price: number;
  available: boolean;
  featured: boolean;
  prepTimeMinutes: number | null;
  /** The store currency the price was prepared in; apply refuses if it changed since. */
  currency: string;
}

const MAX_PRICE = 100_000_000;

export function validateMenuItemCreateDraft(raw: unknown, ctx: DraftValidationContext): ValidationResult<MenuItemCreatePayload> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "invalid_input" };
  const r = raw as Record<string, unknown>;
  const invalid: string[] = [];

  const menuCategoryId = typeof r.menu_category_id === "string" ? r.menu_category_id : typeof r.menuCategoryId === "string" ? r.menuCategoryId : null;
  if (!menuCategoryId || !isUuid(menuCategoryId)) return { ok: false, reason: "invalid_input", fields: ["menu_category_id"] };

  const name = typeof r.name === "string" ? r.name.trim() : r.name == null ? "" : null;
  if (name === null || name.length > 120) invalid.push("name");

  const description = r.description == null ? null : typeof r.description === "string" ? r.description.trim() || null : undefined;
  if (description === undefined || (description && description.length > 1000)) invalid.push("description");

  const currency = ctx.facts.currency;
  let price = 0;
  if (r.price !== null && r.price !== undefined) {
    const v = typeof r.price === "number" ? r.price : NaN;
    const decimalsOk = currency === "XAF" ? Number.isInteger(v) : Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
    if (!Number.isFinite(v) || v < 0 || v > MAX_PRICE || !decimalsOk) invalid.push("price");
    else price = v;
  }

  const available = r.available === null || r.available === undefined ? true : typeof r.available === "boolean" ? r.available : undefined;
  if (available === undefined) invalid.push("available");
  const featured = r.featured === null || r.featured === undefined ? false : typeof r.featured === "boolean" ? r.featured : undefined;
  if (featured === undefined) invalid.push("featured");

  let prepTimeMinutes: number | null = null;
  if (r.prep_time_minutes !== null && r.prep_time_minutes !== undefined) {
    const v = typeof r.prep_time_minutes === "number" ? r.prep_time_minutes : NaN;
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0 || v > 1440) invalid.push("prep_time_minutes");
    else prepTimeMinutes = v;
  }

  if (invalid.length) return { ok: false, reason: "invalid_input", fields: invalid };
  if (!name) return { ok: false, reason: "missing_fields", fields: ["name"] };
  // invalid.length === 0 here guarantees available/featured aren't the `undefined` (wrong-type) branch.
  return { ok: true, payload: { menuCategoryId, name, description: description ?? null, price, available: available ?? true, featured: featured ?? false, prepTimeMinutes, currency } };
}

export const menuItemCreateDraft: DraftDefinition<MenuItemCreatePayload> = {
  type: "menu_item.create",
  validate: validateMenuItemCreateDraft,

  // No plan limit on menu items today (unlike products).
  availability: (facts) => (profileHasCategory(facts, "restaurant_food") ? { ok: true } : { ok: false, reason: "feature_unavailable" }),

  // Not a "before" state (nothing exists yet) — this instead proves the
  // referenced category is real and belongs to THIS workspace before the
  // model is allowed to target it, the same defensive posture update-type
  // drafts use for their target id, adapted for a create-type draft that
  // references something other than the row being created.
  async loadBase(db, workspace, payload) {
    const { data, error } = await db
      .from("menu_categories")
      .select("id, name")
      .eq("id", payload.menuCategoryId)
      .eq("profile_id", workspace.profileId)
      .maybeSingle();
    if (error || !data) return null;
    return { menu_category_id: data.id as string, menu_category_name: data.name as string };
  },

  changes(payload, base) {
    const rows: DraftChange[] = [
      { field: "menu_item_category", kind: "text", before: null, after: (base?.menu_category_name as string) ?? null },
      { field: "menu_item_name", kind: "text", before: null, after: payload.name },
      { field: "menu_item_price", kind: "price", before: null, after: { amount: payload.price, currency: payload.currency } },
      { field: "menu_item_available", kind: "text", before: null, after: payload.available },
    ];
    if (payload.description) rows.push({ field: "menu_item_description", kind: "longtext", before: null, after: payload.description, generated: true });
    if (payload.featured) rows.push({ field: "menu_item_featured", kind: "text", before: null, after: payload.featured });
    if (payload.prepTimeMinutes !== null) rows.push({ field: "menu_item_prep_time", kind: "text", before: null, after: payload.prepTimeMinutes });
    return rows;
  },

  summary: (p) => `New menu item: ${p.name.slice(0, 80)}`,
  fieldNames: (p) => [
    "menu_category_id",
    "name",
    "price",
    "available",
    ...(p.description ? ["description"] : []),
    ...(p.featured ? ["featured"] : []),
    ...(p.prepTimeMinutes !== null ? ["prep_time_minutes"] : []),
  ],

  async apply(db, workspace, draft, facts) {
    if (facts.currency !== draft.payload.currency) return { ok: false, code: "stale" };
    const { data, error } = await db.rpc("ai_create_menu_item", {
      p_id: draft.targetId,
      p_profile_id: workspace.profileId,
      p_menu_category_id: draft.payload.menuCategoryId,
      p_name: draft.payload.name,
      p_description: draft.payload.description,
      p_price: draft.payload.price,
      p_available: draft.payload.available,
      p_featured: draft.payload.featured,
      p_prep_time_minutes: draft.payload.prepTimeMinutes,
    });
    const row = (Array.isArray(data) ? data[0] : data) as { outcome?: string } | null;
    if (error || !row) {
      if (error) console.error("ai menu item create draft apply failed:", error.message);
      return { ok: false, code: "write_failed" };
    }
    switch (row.outcome) {
      case "inserted":
        return { ok: true, resultId: draft.targetId, alreadyApplied: false };
      case "already_exists": // retry of an apply whose insert already committed
        return { ok: true, resultId: draft.targetId, alreadyApplied: true };
      case "category_not_found":
        return { ok: false, code: "invalid_payload" };
      case "not_owner":
        return { ok: false, code: "write_failed" };
      default:
        return { ok: false, code: "write_failed" };
    }
  },

  reviewPath: () => "/dashboard?section=menu",
};
