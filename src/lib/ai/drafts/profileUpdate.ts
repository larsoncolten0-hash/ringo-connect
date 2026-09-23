import { getRestaurantSubcategory, isCategoryId, isMusicRole, profileHasCategory } from "@/lib/categories";
import { emailFromOwner, phoneFromOwner } from "./provenance";
import type { DraftChange, DraftDefinition, DraftValidationContext, ValidationResult } from "./types";

// profile.update — the Setup Assistant's profile draft. Writes ONLY columns
// the Dashboard editor cards already write, through the owner's session
// client (RLS "profiles update by owner"; the demo-flag guard trigger still
// runs):
//   ProfileHeaderCard → name, bio      AboutCard → about_long_bio, about_location, about_phone, about_email
//   CategoryCard → category, categories   MusicSettingsCard → music_role
//   RestaurantSettingsCard → restaurant_subcategory   WhatsAppCard → whatsapp_number
// Never: username, photos, published, verified, pixels/tokens, theme, plan.
// A null field means "leave unchanged".

export interface ProfileDraftPayload {
  name: string | null;
  bio: string | null;
  long_bio: string | null;
  location: string | null;
  category: string | null;
  extra_categories: string[] | null;
  music_role: string | null;
  restaurant_subcategory: string | null;
  whatsapp: string | null;
  phone: string | null;
  email: string | null;
}

const KEYS = ["name", "bio", "long_bio", "location", "category", "extra_categories", "music_role", "restaurant_subcategory", "whatsapp", "phone", "email"] as const;

const TEXT_LIMITS: Record<"name" | "bio" | "long_bio" | "location", number> = { name: 80, bio: 300, long_bio: 2000, location: 120 };

const COLUMN: Record<Exclude<keyof ProfileDraftPayload, "extra_categories">, string> = {
  name: "name",
  bio: "bio",
  long_bio: "about_long_bio",
  location: "about_location",
  category: "category",
  music_role: "music_role",
  restaurant_subcategory: "restaurant_subcategory",
  whatsapp: "whatsapp_number",
  phone: "about_phone",
  email: "about_email",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const strOrNull = (v: unknown): string | null | undefined => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined; // wrong type → invalid
  const t = v.trim();
  return t ? t : null;
};

export function validateProfileDraft(raw: unknown, ctx: DraftValidationContext): ValidationResult<ProfileDraftPayload> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "invalid_input" };
  const r = raw as Record<string, unknown>;
  const out: ProfileDraftPayload = {
    name: null, bio: null, long_bio: null, location: null, category: null, extra_categories: null,
    music_role: null, restaurant_subcategory: null, whatsapp: null, phone: null, email: null,
  };
  const invalid: string[] = [];

  for (const key of ["name", "bio", "long_bio", "location"] as const) {
    const v = strOrNull(r[key]);
    if (v === undefined || (v && v.length > TEXT_LIMITS[key])) invalid.push(key);
    else out[key] = v;
  }

  const category = strOrNull(r.category);
  if (category === undefined || (category !== null && !isCategoryId(category))) invalid.push("category");
  else out.category = category;

  if (r.extra_categories !== null && r.extra_categories !== undefined) {
    if (!Array.isArray(r.extra_categories) || r.extra_categories.length > 5 || !r.extra_categories.every(isCategoryId)) invalid.push("extra_categories");
    else out.extra_categories = Array.from(new Set(r.extra_categories as string[]));
  }

  const musicRole = strOrNull(r.music_role);
  if (musicRole === undefined || (musicRole !== null && !isMusicRole(musicRole))) invalid.push("music_role");
  else out.music_role = musicRole;

  const sub = strOrNull(r.restaurant_subcategory);
  if (sub === undefined || (sub !== null && !getRestaurantSubcategory(sub))) invalid.push("restaurant_subcategory");
  else out.restaurant_subcategory = sub;

  // Contact details: format + strict provenance (typed by the owner in this conversation).
  const notFromOwner: string[] = [];
  const whatsapp = strOrNull(r.whatsapp);
  if (whatsapp === undefined) invalid.push("whatsapp");
  else if (whatsapp !== null) {
    const digits = whatsapp.replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(digits)) invalid.push("whatsapp");
    else if (!phoneFromOwner(digits, ctx.userText)) notFromOwner.push("whatsapp");
    else out.whatsapp = digits;
  }
  const phone = strOrNull(r.phone);
  if (phone === undefined || (phone !== null && (phone.length > 40 || !/^\+?[\d\s().\-]+$/.test(phone)))) invalid.push("phone");
  else if (phone !== null) {
    if (!phoneFromOwner(phone.replace(/\D/g, ""), ctx.userText)) notFromOwner.push("phone");
    else out.phone = phone;
  }
  const email = strOrNull(r.email);
  if (email === undefined || (email !== null && (email.length > 200 || !EMAIL_RE.test(email)))) invalid.push("email");
  else if (email !== null) {
    if (!emailFromOwner(email, ctx.userText)) notFromOwner.push("email");
    else out.email = email;
  }

  if (invalid.length) return { ok: false, reason: "invalid_input", fields: invalid };
  if (notFromOwner.length) return { ok: false, reason: "contact_not_from_user", fields: notFromOwner };

  // Category-dependent fields use the categories the page WILL have (this
  // draft's, or the current ones) — the same profileHasCategory rule the
  // editor cards gate on.
  const primary = out.category ?? ctx.facts.category;
  if (out.extra_categories && !primary) return { ok: false, reason: "missing_fields", fields: ["category"] };
  const effective = {
    category: primary,
    categories: out.category || out.extra_categories ? [primary as string, ...(out.extra_categories ?? ctx.facts.categories.filter((c) => c !== primary))] : ctx.facts.categories,
  };
  if (out.music_role && !profileHasCategory(effective, "music_entertainment")) return { ok: false, reason: "feature_unavailable", fields: ["music_role"] };
  if (out.restaurant_subcategory && !profileHasCategory(effective, "restaurant_food")) return { ok: false, reason: "feature_unavailable", fields: ["restaurant_subcategory"] };

  if (KEYS.every((k) => out[k] === null)) return { ok: false, reason: "nothing_to_change" };
  return { ok: true, payload: out };
}

/** The exact profiles columns this draft writes — the same shape the editor cards write. */
export function profilePatch(payload: ProfileDraftPayload, facts: { category: string | null; categories: string[] }): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(COLUMN) as (keyof typeof COLUMN)[]) {
    if (payload[key] !== null) patch[COLUMN[key]] = payload[key];
  }
  // CategoryCard always writes both: categories = [primary, ...extras].
  if (payload.category !== null || payload.extra_categories !== null) {
    const primary = (payload.category ?? facts.category) as string;
    const extras = (payload.extra_categories ?? facts.categories).filter((c) => c !== primary);
    patch.category = primary;
    patch.categories = [primary, ...extras];
  }
  return patch;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const KIND: Record<string, DraftChange["kind"]> = {
  name: "text", bio: "longtext", about_long_bio: "longtext", about_location: "text", category: "category", categories: "categories",
  music_role: "music_role", restaurant_subcategory: "restaurant_subcategory", whatsapp_number: "phone", about_phone: "phone", about_email: "email",
};

export const profileUpdateDraft: DraftDefinition<ProfileDraftPayload> = {
  type: "profile.update",
  validate: validateProfileDraft,
  availability: () => ({ ok: true }),

  async loadBase(db, workspace, payload) {
    // Current values of exactly the columns this draft will write. The
    // category pair needs the live categories, read here too.
    const { data, error } = await db
      .from("profiles")
      .select("name, bio, about_long_bio, about_location, category, categories, music_role, restaurant_subcategory, whatsapp_number, about_phone, about_email")
      .eq("id", workspace.profileId)
      .eq("user_id", workspace.userId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    const patch = profilePatch(payload, { category: (row.category as string) ?? null, categories: (row.categories as string[]) ?? [] });
    const base: Record<string, unknown> = {};
    for (const col of Object.keys(patch)) base[col] = row[col] ?? null;
    return base;
  },

  changes(payload, base) {
    const b = base || {};
    const patch = profilePatch(payload, { category: (b.category as string) ?? null, categories: (b.categories as string[]) ?? [] });
    // Only fields whose value really changes — "before → after" rows.
    return Object.entries(patch)
      .filter(([col, after]) => !same(b[col], after))
      .map(([col, after]) => ({ field: col, kind: KIND[col] ?? "text", before: b[col] ?? null, after, generated: col === "bio" || col === "about_long_bio" }));
  },

  summary(payload) {
    const n = KEYS.filter((k) => payload[k] !== null).length;
    return `Profile update: ${n} field${n === 1 ? "" : "s"}${payload.name ? ` (${payload.name.slice(0, 60)})` : ""}`;
  },

  fieldNames: (payload) => KEYS.filter((k) => payload[k] !== null),

  async apply(db, workspace, draft) {
    const base = draft.base;
    if (!base) return { ok: false, code: "invalid_payload" };
    // The patch is rebuilt from the base captured at draft time, so
    // "categories" means exactly what the owner reviewed.
    const patch = profilePatch(draft.payload, { category: (base.category as string) ?? null, categories: (base.categories as string[]) ?? [] });

    // Compare-and-set in ONE transaction, as the owner (RLS + triggers apply):
    // ai_apply_profile_update locks the row, refuses if any base value changed
    // since the draft was prepared (a newer manual edit is never overwritten),
    // and treats "already has these values" as an idempotent success.
    const { data, error } = await db.rpc("ai_apply_profile_update", { p_profile_id: workspace.profileId, p_patch: patch, p_base: base });
    if (error) {
      console.error("ai profile draft apply failed:", error.message);
      return { ok: false, code: "write_failed" };
    }
    switch (data) {
      case "updated":
        return { ok: true, resultId: workspace.profileId, alreadyApplied: false };
      case "already_applied":
        return { ok: true, resultId: workspace.profileId, alreadyApplied: true };
      case "stale":
        return { ok: false, code: "stale" };
      default:
        return { ok: false, code: "write_failed" };
    }
  },

  reviewPath: () => "/dashboard",
};
