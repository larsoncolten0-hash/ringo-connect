import { createAdminClient } from "@/lib/supabase/server";
import { isPackageActionAllowed, type LoyaltyOptions } from "@/lib/loyalty/categories";
import type { LoyaltyAdmin } from "@/lib/loyalty/engine";
import type { ParseResult } from "@/lib/loyalty/programs";

// Package templates: what a business sells (name, price for display, validity, included
// services). Activating one for a customer snapshots it (loyalty_activate_package), so
// editing or archiving a template later never changes packages already sold.
//
// Template items are replaced as a set. To make sure an in-between state can never be
// activated (a template with no items), an edit that replaces items first archives the
// template, swaps the items, then restores the intended active flag.

export interface TemplateItem {
  id: string;
  action_key: string;
  quantity: number;
}

export interface TemplateRow {
  id: string;
  name: string;
  price: number | null;
  currency: string | null;
  duration_days: number;
  carry_over: boolean;
  active: boolean;
  created_at: string;
  loyalty_package_template_items: TemplateItem[];
}

const COLUMNS =
  "id, name, price, currency, duration_days, carry_over, active, created_at, loyalty_package_template_items(id, action_key, quantity)";

export async function listTemplates(profileId: string, admin: LoyaltyAdmin = createAdminClient()): Promise<TemplateRow[]> {
  const { data, error } = await admin
    .from("loyalty_package_templates")
    .select(COLUMNS)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`listTemplates failed: ${error.message}`);
  return (data ?? []) as unknown as TemplateRow[];
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

export type TemplateItemInput = { action_key: string; quantity: number };

function parseItems(value: unknown, options: LoyaltyOptions): TemplateItemInput[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) return null;
  const seen = new Set<string>();
  const items: TemplateItemInput[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const { action_key, quantity } = raw as Record<string, unknown>;
    if (typeof action_key !== "string" || !isPackageActionAllowed(options, action_key) || seen.has(action_key)) return null;
    if (!isInt(quantity, 1, 10_000)) return null;
    seen.add(action_key);
    items.push({ action_key, quantity });
  }
  return items;
}

const cleanName = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length >= 1 && t.length <= 120 ? t : null;
};

export type TemplateCreateInput = {
  name: string;
  price: number | null;
  duration_days: number;
  carry_over: boolean;
  items: TemplateItemInput[];
};

export function parseTemplateCreate(body: Record<string, unknown>, options: LoyaltyOptions): ParseResult<TemplateCreateInput> {
  if (!options.packages) return { ok: false, error: "invalid_request" };
  const name = cleanName(body.name);
  const items = parseItems(body.items, options);
  const price = body.price === undefined || body.price === null || body.price === "" ? null : body.price;
  const duration = body.duration_days === undefined ? 30 : body.duration_days;
  const carry = body.carry_over === undefined ? false : body.carry_over;
  if (!name || !items) return { ok: false, error: "invalid_request" };
  if (price !== null && !isInt(price, 0, 1_000_000_000)) return { ok: false, error: "invalid_request" };
  if (!isInt(duration, 1, 3650) || typeof carry !== "boolean") return { ok: false, error: "invalid_request" };
  return { ok: true, value: { name, price: price as number | null, duration_days: duration, carry_over: carry, items } };
}

export type TemplateUpdateInput = {
  patch: Partial<{ name: string; price: number | null; duration_days: number; carry_over: boolean; active: boolean }>;
  items: TemplateItemInput[] | null;
};

export function parseTemplateUpdate(body: Record<string, unknown>, options: LoyaltyOptions): ParseResult<TemplateUpdateInput> {
  const patch: TemplateUpdateInput["patch"] = {};
  if (body.name !== undefined) {
    const v = cleanName(body.name);
    if (!v) return { ok: false, error: "invalid_request" };
    patch.name = v;
  }
  if (body.price !== undefined) {
    if (body.price === null || body.price === "") patch.price = null;
    else if (isInt(body.price, 0, 1_000_000_000)) patch.price = body.price;
    else return { ok: false, error: "invalid_request" };
  }
  if (body.duration_days !== undefined) {
    if (!isInt(body.duration_days, 1, 3650)) return { ok: false, error: "invalid_request" };
    patch.duration_days = body.duration_days;
  }
  if (body.carry_over !== undefined) {
    if (typeof body.carry_over !== "boolean") return { ok: false, error: "invalid_request" };
    patch.carry_over = body.carry_over;
  }
  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") return { ok: false, error: "invalid_request" };
    patch.active = body.active;
  }
  let items: TemplateItemInput[] | null = null;
  if (body.items !== undefined) {
    items = parseItems(body.items, options);
    if (!items) return { ok: false, error: "invalid_request" };
  }
  if (Object.keys(patch).length === 0 && !items) return { ok: false, error: "invalid_request" };
  return { ok: true, value: { patch, items } };
}

async function replaceItems(admin: LoyaltyAdmin, templateId: string, items: TemplateItemInput[]): Promise<boolean> {
  const del = await admin.from("loyalty_package_template_items").delete().eq("template_id", templateId);
  if (del.error) return false;
  const ins = await admin
    .from("loyalty_package_template_items")
    .insert(items.map((i) => ({ template_id: templateId, action_key: i.action_key, quantity: i.quantity })));
  return !ins.error;
}

export async function createTemplate(
  profileId: string,
  userId: string,
  currency: string | null,
  input: TemplateCreateInput,
  admin: LoyaltyAdmin = createAdminClient()
): Promise<{ ok: true; template: TemplateRow } | { ok: false; error: "server_error" }> {
  const safeCurrency = currency && /^[A-Z]{3}$/.test(currency.toUpperCase()) ? currency.toUpperCase() : null;
  // Created archived, so it can never be activated before its items exist.
  const { data, error } = await admin
    .from("loyalty_package_templates")
    .insert({
      profile_id: profileId,
      created_by: userId,
      name: input.name,
      price: input.price,
      currency: input.price === null ? null : safeCurrency,
      duration_days: input.duration_days,
      carry_over: input.carry_over,
      active: false,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("createTemplate failed:", error?.message);
    return { ok: false, error: "server_error" };
  }
  const id = (data as any).id as string;
  if (!(await replaceItems(admin, id, input.items))) return { ok: false, error: "server_error" };
  const done = await admin.from("loyalty_package_templates").update({ active: true, updated_at: new Date().toISOString() }).eq("id", id).eq("profile_id", profileId);
  if (done.error) return { ok: false, error: "server_error" };
  const list = await listTemplates(profileId, admin);
  return { ok: true, template: list.find((t) => t.id === id)! };
}

export async function updateTemplate(
  profileId: string,
  templateId: string,
  input: TemplateUpdateInput,
  admin: LoyaltyAdmin = createAdminClient()
): Promise<{ ok: true; template: TemplateRow } | { ok: false; error: "not_found" | "server_error" }> {
  const { data: existing } = await admin
    .from("loyalty_package_templates")
    .select("id, active")
    .eq("id", templateId)
    .eq("profile_id", profileId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "not_found" };

  const wantActive = input.patch.active ?? (existing as any).active;
  const now = new Date().toISOString();

  if (input.items) {
    const off = await admin.from("loyalty_package_templates").update({ active: false, updated_at: now }).eq("id", templateId).eq("profile_id", profileId);
    if (off.error || !(await replaceItems(admin, templateId, input.items))) return { ok: false, error: "server_error" };
  }
  const upd = await admin
    .from("loyalty_package_templates")
    .update({ ...input.patch, active: wantActive, updated_at: now })
    .eq("id", templateId)
    .eq("profile_id", profileId);
  if (upd.error) return { ok: false, error: "server_error" };

  const list = await listTemplates(profileId, admin);
  return { ok: true, template: list.find((t) => t.id === templateId)! };
}

/** A template can only be sold if it is active and still has items. */
export async function templateHasItems(profileId: string, templateId: string, admin: LoyaltyAdmin = createAdminClient()): Promise<boolean> {
  const { data } = await admin
    .from("loyalty_package_templates")
    .select("id, loyalty_package_template_items(id)")
    .eq("id", templateId)
    .eq("profile_id", profileId)
    .maybeSingle();
  const items = (data as any)?.loyalty_package_template_items;
  return Array.isArray(items) && items.length > 0;
}
