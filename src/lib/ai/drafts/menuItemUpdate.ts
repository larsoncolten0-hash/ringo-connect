import { profileHasCategory } from "@/lib/categories";
import { isUuid } from "@/lib/customer/connect";
import type { DraftChange, DraftDefinition, DraftValidationContext, ValidationResult } from "./types";

// menu_item.update — edit ONE existing restaurant menu item (name,
// description, price, availability, featured, prep time). Applied through
// the owner's session client with the same columns MenuCard's saveAllItems
// writes (RLS "menu_items owner write"). Never touches image_url/image_urls
// (the multi-photo gallery stays Dashboard-only, same rule as products) or
// menu_category_id.
//
// order_items snapshots item_name_snapshot/item_price_snapshot at order
// time and never re-reads live menu_items — editing after an order exists
// cannot affect it.

export interface MenuItemUpdatePayload {
  menuItemId: string;
  name: string | null;
  description: string | null;
  price: number | null;
  available: boolean | null;
  featured: boolean | null;
  prepTimeMinutes: number | null;
  /** The store currency at draft time; apply refuses if it changed since. */
  currency: string;
}

const MAX_PRICE = 100_000_000;

export function validateMenuItemUpdateDraft(raw: unknown, ctx: DraftValidationContext): ValidationResult<MenuItemUpdatePayload> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "invalid_input" };
  const r = raw as Record<string, unknown>;
  const invalid: string[] = [];

  const menuItemId = typeof r.menuItemId === "string" ? r.menuItemId : typeof r.menu_item_id === "string" ? r.menu_item_id : null;
  if (!menuItemId || !isUuid(menuItemId)) return { ok: false, reason: "invalid_input", fields: ["menu_item_id"] };

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

  const available = r.available === null || r.available === undefined ? null : typeof r.available === "boolean" ? r.available : undefined;
  if (available === undefined) invalid.push("available");
  const featured = r.featured === null || r.featured === undefined ? null : typeof r.featured === "boolean" ? r.featured : undefined;
  if (featured === undefined) invalid.push("featured");

  let prepTimeMinutes: number | null = null;
  if (r.prep_time_minutes !== null && r.prep_time_minutes !== undefined) {
    const v = typeof r.prep_time_minutes === "number" ? r.prep_time_minutes : NaN;
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0 || v > 1440) invalid.push("prep_time_minutes");
    else prepTimeMinutes = v;
  }

  if (invalid.length) return { ok: false, reason: "invalid_input", fields: invalid };
  const finalName = name ?? null;
  const finalDescription = description ?? null;
  const finalAvailable = available ?? null;
  const finalFeatured = featured ?? null;
  if (finalName === null && finalDescription === null && price === null && finalAvailable === null && finalFeatured === null && prepTimeMinutes === null) {
    return { ok: false, reason: "nothing_to_change" };
  }
  return { ok: true, payload: { menuItemId, name: finalName, description: finalDescription, price, available: finalAvailable, featured: finalFeatured, prepTimeMinutes, currency } };
}

export const menuItemUpdateDraft: DraftDefinition<MenuItemUpdatePayload> = {
  type: "menu_item.update",
  validate: validateMenuItemUpdateDraft,

  availability: (facts) => (profileHasCategory(facts, "restaurant_food") ? { ok: true } : { ok: false, reason: "feature_unavailable" }),

  async loadBase(db, workspace, payload) {
    const { data, error } = await db
      .from("menu_items")
      .select("name, description, price, available, featured, prep_time_minutes")
      .eq("id", payload.menuItemId)
      .eq("profile_id", workspace.profileId)
      .maybeSingle();
    if (error || !data) return null;
    return data as Record<string, unknown>;
  },

  changes(payload, base) {
    const b = base || {};
    const rows: DraftChange[] = [];
    if (payload.name !== null) rows.push({ field: "menu_item_name", kind: "text", before: b.name ?? null, after: payload.name });
    if (payload.description !== null) rows.push({ field: "menu_item_description", kind: "longtext", before: b.description ?? null, after: payload.description, generated: true });
    if (payload.price !== null) rows.push({ field: "menu_item_price", kind: "price", before: b.price == null ? null : { amount: Number(b.price), currency: payload.currency }, after: { amount: payload.price, currency: payload.currency } });
    if (payload.available !== null) rows.push({ field: "menu_item_available", kind: "text", before: b.available ?? null, after: payload.available });
    if (payload.featured !== null) rows.push({ field: "menu_item_featured", kind: "text", before: b.featured ?? null, after: payload.featured });
    if (payload.prepTimeMinutes !== null) rows.push({ field: "menu_item_prep_time", kind: "text", before: b.prep_time_minutes ?? null, after: payload.prepTimeMinutes });
    return rows;
  },

  summary(payload) {
    const n = [payload.name, payload.description, payload.price, payload.available, payload.featured, payload.prepTimeMinutes].filter((v) => v !== null).length;
    return `Update menu item: ${n} field${n === 1 ? "" : "s"}`;
  },

  fieldNames: (payload) =>
    [
      payload.name !== null ? "name" : null,
      payload.description !== null ? "description" : null,
      payload.price !== null ? "price" : null,
      payload.available !== null ? "available" : null,
      payload.featured !== null ? "featured" : null,
      payload.prepTimeMinutes !== null ? "prep_time_minutes" : null,
    ].filter((v): v is string => v !== null),

  async apply(db, workspace, draft, facts) {
    if (facts.currency !== draft.payload.currency) return { ok: false, code: "stale" };
    const base = draft.base;
    if (!base) return { ok: false, code: "invalid_payload" };
    const patch: Record<string, unknown> = {};
    if (draft.payload.name !== null) patch.name = draft.payload.name;
    if (draft.payload.description !== null) patch.description = draft.payload.description;
    if (draft.payload.price !== null) patch.price = draft.payload.price;
    if (draft.payload.available !== null) patch.available = draft.payload.available;
    if (draft.payload.featured !== null) patch.featured = draft.payload.featured;
    if (draft.payload.prepTimeMinutes !== null) patch.prep_time_minutes = draft.payload.prepTimeMinutes;

    const { data, error } = await db.rpc("ai_apply_menu_item_update", {
      p_menu_item_id: draft.payload.menuItemId,
      p_profile_id: workspace.profileId,
      p_patch: patch,
      p_base: base,
    });
    if (error) {
      console.error("ai menu item update draft apply failed:", error.message);
      return { ok: false, code: "write_failed" };
    }
    switch (data) {
      case "updated":
        return { ok: true, resultId: draft.payload.menuItemId, alreadyApplied: false };
      case "already_applied":
        return { ok: true, resultId: draft.payload.menuItemId, alreadyApplied: true };
      case "stale":
        return { ok: false, code: "stale" };
      case "not_found":
        return { ok: false, code: "write_failed" };
      default:
        return { ok: false, code: "write_failed" };
    }
  },

  reviewPath: () => "/dashboard?section=menu",
};
