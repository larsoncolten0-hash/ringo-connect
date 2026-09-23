import { createClient } from "@/lib/supabase/server";
import { CATEGORY_IDS, MUSIC_ROLES, RESTAURANT_SUBCATEGORIES } from "@/lib/categories";
import { isUuid } from "@/lib/customer/connect";
import { DRAFT_DEFINITIONS } from "@/lib/ai/drafts/registry";
import { loadDraftFacts, loadOwnerMessages, todayUtc } from "@/lib/ai/drafts/facts";
import { discardDraft, getOwnDraft, insertDraft, listConversationDrafts, recordDraftEvent, reviseDraft } from "@/lib/ai/drafts/store";
import { toDraftView } from "@/lib/ai/drafts/view";
import type { DraftType } from "@/lib/ai/drafts/types";
import { NO_INPUT_SCHEMA, parseNoInput, type AiTool, type AiToolContext } from "../types";

// Phase 2 draft tools (kind "draft"). They PREPARE drafts only — they never
// write the owner's Ringo data. The owner applies a draft by clicking
// "Confirm & Apply" on the card in the panel, which calls
// POST /api/ai/drafts/[id]/apply. There is deliberately no apply tool.
//
// The model never supplies identity: no user/profile/organization/customer
// id exists in any schema below. The only id the model can pass is a draft
// id it got from these tools, and it's re-checked against the server-resolved
// owner, profile AND this conversation.

const MAX_DRAFTS_PER_CONVERSATION = 20;

const nullable = (schema: Record<string, unknown>, description: string) => ({ anyOf: [schema, { type: "null" }], description });
const draftIdParam = nullable({ type: "string", format: "uuid" }, "To REVISE a draft you prepared earlier in this conversation, its draft_id; otherwise null to prepare a new one.");

// Returned to the model so it can explain or ask — never a stack trace.
const HINTS: Record<string, string> = {
  invalid_input: "Some values aren't valid (see fields). Fix them or ask the user.",
  missing_fields: "Ask the user for the missing fields (see fields). Don't invent them.",
  nothing_to_change: "Nothing in this draft would change the page.",
  contact_not_from_user:
    "Contact details can only be used if the user typed them in this conversation. Ask the user to type the number/email themselves. Never guess or complete one.",
  feature_unavailable: "This page's category or plan doesn't have this feature. Explain it and point to where it's managed.",
  plan_limit_reached: "The plan's limit is reached. Explain it; upgrading is at Dashboard → Subscription.",
  date_in_past: "The date is in the past. Ask the user for the right date.",
  facts_unavailable: "Couldn't read the page right now. Tell the user to try again in a moment.",
  too_many_drafts: "Too many drafts in this conversation. Ask the user to review or discard existing ones first.",
  draft_not_found: "That draft doesn't exist in this conversation.",
  draft_not_editable: "That draft was already applied, discarded or expired — prepare a new one instead.",
};

const refuse = (reason: string, fields?: string[]) => ({ ok: false, reason, ...(fields ? { fields } : {}), hint: HINTS[reason] ?? "" });

async function prepareDraft(ctx: AiToolContext, type: DraftType, input: Record<string, unknown>) {
  if (!ctx.conversationId) return refuse("facts_unavailable");
  const def = DRAFT_DEFINITIONS[type];
  const db = createClient();
  const { draft_id: draftId, ...fields } = input;

  const [facts, ownerText] = await Promise.all([loadDraftFacts(db, ctx.workspace), loadOwnerMessages(db, ctx.workspace.userId, ctx.conversationId)]);
  if (!facts || !ownerText) return refuse("facts_unavailable");

  const checked = def.validate(fields, { facts, userText: ownerText, today: todayUtc() });
  if (!checked.ok) return refuse(checked.reason, checked.fields);
  const gate = def.availability(facts, checked.payload);
  if (!gate.ok) return refuse(gate.reason);

  const base = def.loadBase ? await def.loadBase(db, ctx.workspace, checked.payload) : null;
  if (def.loadBase && !base) return refuse("facts_unavailable");
  const changes = def.changes(checked.payload, base);
  if (changes.length === 0) return refuse("nothing_to_change");

  let row;
  if (draftId != null) {
    if (!isUuid(draftId)) return refuse("draft_not_found");
    const existing = await getOwnDraft(ctx.workspace, draftId, ctx.conversationId);
    if (!existing || existing.draft_type !== type) return refuse("draft_not_found");
    row = await reviseDraft(ctx.workspace, existing, { payload: checked.payload, base, summary: def.summary(checked.payload) });
    if (!row) return refuse("draft_not_editable");
    await recordDraftEvent({ draftId: row.id, workspace: ctx.workspace, draftType: type, action: "updated", revision: row.revision, fields: def.fieldNames(checked.payload) });
  } else {
    const existingCount = (await listConversationDrafts(ctx.workspace, ctx.conversationId)).length;
    if (existingCount >= MAX_DRAFTS_PER_CONVERSATION) return refuse("too_many_drafts");
    row = await insertDraft({ workspace: ctx.workspace, conversationId: ctx.conversationId, type, payload: checked.payload, base, summary: def.summary(checked.payload), locale: ctx.locale });
    await recordDraftEvent({ draftId: row.id, workspace: ctx.workspace, draftType: type, action: "created", revision: row.revision, fields: def.fieldNames(checked.payload) });
  }

  const view = toDraftView(row);
  if (view) ctx.emitDraft?.(view);
  return {
    ok: true,
    draft_id: row.id,
    revision: row.revision,
    status: "awaiting_confirmation",
    fields_in_draft: changes.map((c) => c.field),
    shown_to_user: "A review card with the before/after values, a Confirm & Apply button and a Discard button.",
    important:
      "NOTHING has changed yet. Only the user's own click on Confirm & Apply applies it — chat messages like 'yes' or 'looks good' do not. Never say it's done, saved or published.",
  };
}

const passObject = (raw: unknown): Record<string, unknown> | null =>
  raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;

export const createProfileDraft: AiTool<Record<string, unknown>> = {
  name: "create_profile_draft",
  description:
    "Prepare a DRAFT update of the user's own Ringo profile (setup assistant). Nothing changes until the user clicks Confirm & Apply on the card this shows. Use null for every field you are not changing. Only include facts the user actually gave you; bio/long_bio may be text you wrote from those facts (no invented achievements, awards, numbers, years or claims). whatsapp/phone/email ONLY if the user typed them in this conversation — never guess or complete one. Use exact ids from get_setup_options for category, extra_categories, music_role and restaurant_subcategory.",
  kind: "draft",
  permission: "settings.manage",
  inputSchema: {
    type: "object",
    properties: {
      draft_id: draftIdParam,
      name: nullable({ type: "string" }, "Display name on the public page (max 80 chars)."),
      bio: nullable({ type: "string" }, "Short bio under the name (max 300 chars)."),
      long_bio: nullable({ type: "string" }, "About → long description (max 2000 chars)."),
      location: nullable({ type: "string" }, "About → location, as the user said it (max 120 chars)."),
      category: nullable({ type: "string", enum: CATEGORY_IDS }, "Primary category id."),
      extra_categories: nullable({ type: "array", items: { type: "string", enum: CATEGORY_IDS } }, "Extra category ids (max 5), or null to keep the current ones."),
      music_role: nullable({ type: "string", enum: MUSIC_ROLES.map((r) => r.id) }, "Music & Entertainment only."),
      restaurant_subcategory: nullable({ type: "string", enum: RESTAURANT_SUBCATEGORIES.map((r) => r.id) }, "Restaurant & Food only."),
      whatsapp: nullable({ type: "string" }, "WhatsApp number exactly as the user typed it (a country code may be added in front)."),
      phone: nullable({ type: "string" }, "About → contact phone exactly as the user typed it."),
      email: nullable({ type: "string" }, "About → contact email exactly as the user typed it."),
    },
    required: ["draft_id", "name", "bio", "long_bio", "location", "category", "extra_categories", "music_role", "restaurant_subcategory", "whatsapp", "phone", "email"],
    additionalProperties: false,
  },
  parseInput: passObject,
  run: (ctx, input) => prepareDraft(ctx, "profile.update", input),
};

export const createProductDraft: AiTool<Record<string, unknown>> = {
  name: "create_product_draft",
  description:
    "Prepare a DRAFT of ONE new product for the user's catalog. Nothing is created until the user clicks Confirm & Apply; once confirmed the product appears on their public page. The price is in the page's store currency (see workspace; XAF has no decimals) — only a price the user gave you, otherwise null. The description may be text you wrote from the user's facts, with no invented claims. image_url is ONLY the exact URL of an image the user attached in this conversation (never invent or guess one) — otherwise null; stock and links are added afterwards in Catalog.",
  kind: "draft",
  permission: "settings.manage",
  inputSchema: {
    type: "object",
    properties: {
      draft_id: draftIdParam,
      name: { type: "string", description: "Product name (max 120 chars)." },
      description: nullable({ type: "string" }, "Product description (max 1000 chars)."),
      price: nullable({ type: "number" }, "Price in the store currency, or null if the user didn't give one."),
      image_url: nullable({ type: "string" }, "The exact URL of an image the user attached in this conversation, or null."),
    },
    required: ["draft_id", "name", "description", "price", "image_url"],
    additionalProperties: false,
  },
  parseInput: passObject,
  run: (ctx, input) => prepareDraft(ctx, "product.create", input),
};

export const updateProductDraft: AiTool<Record<string, unknown>> = {
  name: "update_product_draft",
  description:
    "Prepare a DRAFT edit of ONE EXISTING product already in the user's catalog (use a product_id from get_my_catalog_summary). Nothing changes until the user clicks Confirm & Apply. Use null for every field you are not changing. description may be text you wrote or rewrote from the user's facts (tone, length, translation), with no invented claims. image_url is ONLY the exact URL of an image the user attached in this conversation (never invent or guess one) — otherwise null.",
  kind: "draft",
  permission: "settings.manage",
  inputSchema: {
    type: "object",
    properties: {
      draft_id: draftIdParam,
      product_id: { type: "string", format: "uuid", description: "The id of the existing product to edit, from get_my_catalog_summary." },
      name: nullable({ type: "string" }, "New product name (max 120 chars), or null to keep it."),
      description: nullable({ type: "string" }, "New product description (max 1000 chars), or null to keep it."),
      price: nullable({ type: "number" }, "New price in the store currency, or null to keep it."),
      image_url: nullable({ type: "string" }, "The exact URL of an image the user attached in this conversation, or null to keep the current photo."),
    },
    required: ["draft_id", "product_id", "name", "description", "price", "image_url"],
    additionalProperties: false,
  },
  parseInput: passObject,
  run: (ctx, input) => prepareDraft(ctx, "product.update", input),
};

export const updateTrackDraft: AiTool<Record<string, unknown>> = {
  name: "update_track_draft",
  description:
    "Prepare a DRAFT edit of ONE EXISTING music track already in the user's catalog (use a track_id from get_my_music_summary). Nothing changes until the user clicks Confirm & Apply. Use null for every field you are not changing. description may be text you wrote or rewrote from the user's facts, with no invented claims. price can only be changed for a STANDALONE track (has_release: false in get_my_music_summary) — a track that's part of a release is priced through the release itself; don't offer to change price for those, explain why instead.",
  kind: "draft",
  permission: "music.manage",
  available: (s) => s.isMusic,
  inputSchema: {
    type: "object",
    properties: {
      draft_id: draftIdParam,
      track_id: { type: "string", format: "uuid", description: "The id of the existing track to edit, from get_my_music_summary." },
      title: nullable({ type: "string" }, "New track title (max 120 chars), or null to keep it."),
      description: nullable({ type: "string" }, "New track description (max 1000 chars), or null to keep it."),
      price: nullable({ type: "number" }, "New price in the store currency, or null to keep it. Only for standalone tracks."),
    },
    required: ["draft_id", "track_id", "title", "description", "price"],
    additionalProperties: false,
  },
  parseInput: passObject,
  run: (ctx, input) => prepareDraft(ctx, "track.update", input),
};

export const updateMenuItemDraft: AiTool<Record<string, unknown>> = {
  name: "update_menu_item_draft",
  description:
    "Prepare a DRAFT edit of ONE EXISTING restaurant menu item already in the user's menu (use a menu_item_id from get_my_restaurant_summary). Nothing changes until the user clicks Confirm & Apply. Use null for every field you are not changing. description may be text you wrote or rewrote from the user's facts, with no invented claims (ingredients, allergens etc. only if the user actually gave them).",
  kind: "draft",
  permission: "menu.manage",
  available: (s) => s.isRestaurant,
  inputSchema: {
    type: "object",
    properties: {
      draft_id: draftIdParam,
      menu_item_id: { type: "string", format: "uuid", description: "The id of the existing menu item to edit, from get_my_restaurant_summary." },
      name: nullable({ type: "string" }, "New item name (max 120 chars), or null to keep it."),
      description: nullable({ type: "string" }, "New item description (max 1000 chars), or null to keep it."),
      price: nullable({ type: "number" }, "New price in the store currency, or null to keep it."),
      available: nullable({ type: "boolean" }, "Whether the item is orderable, or null to keep it."),
      featured: nullable({ type: "boolean" }, "Whether the item is featured, or null to keep it."),
      prep_time_minutes: nullable({ type: "number" }, "Preparation time in minutes (whole number), or null to keep it."),
    },
    required: ["draft_id", "menu_item_id", "name", "description", "price", "available", "featured", "prep_time_minutes"],
    additionalProperties: false,
  },
  parseInput: passObject,
  run: (ctx, input) => prepareDraft(ctx, "menu_item.update", input),
};

export const createEventDraft: AiTool<Record<string, unknown>> = {
  name: "create_event_draft",
  description:
    "Prepare a DRAFT of ONE new event (pages with ticketing only). Nothing is created until the user clicks Confirm & Apply, and even then the event is created UNPUBLISHED — the user adds tickets/prices and publishes it themselves in Tickets. Needs a title and a date the user gave you.",
  kind: "draft",
  permission: "tickets.manage",
  available: (s) => s.hasTicketing,
  inputSchema: {
    type: "object",
    properties: {
      draft_id: draftIdParam,
      title: { type: "string", description: "Event title (max 120 chars)." },
      date: nullable({ type: "string", format: "date" }, "Event date YYYY-MM-DD, or null if the user hasn't said."),
      time: nullable({ type: "string" }, "Start time as the user said it, e.g. '20:00' or '8 PM'."),
      location: nullable({ type: "string" }, "Venue / place (max 160 chars)."),
    },
    required: ["draft_id", "title", "date", "time", "location"],
    additionalProperties: false,
  },
  parseInput: passObject,
  run: (ctx, input) => prepareDraft(ctx, "event.create", input),
};

export const updateEventDraft: AiTool<Record<string, unknown>> = {
  name: "update_event_draft",
  description:
    "Prepare a DRAFT edit of ONE EXISTING event already in the user's Tickets (use an event_id from get_my_events_summary). Nothing changes until the user clicks Confirm & Apply. Use null for every field you are not changing. Editing a past date is allowed (e.g. correcting a typo). price can only be changed when the event has NO ticket tiers yet (ticket_tiers_count: 0 in get_my_events_summary) — once tiers exist, price is set per tier in Tickets; don't offer to change it here, explain why instead.",
  kind: "draft",
  permission: "tickets.manage",
  available: (s) => s.hasTicketing,
  inputSchema: {
    type: "object",
    properties: {
      draft_id: draftIdParam,
      event_id: { type: "string", format: "uuid", description: "The id of the existing event to edit, from get_my_events_summary." },
      title: nullable({ type: "string" }, "New event title (max 120 chars), or null to keep it."),
      description: nullable({ type: "string" }, "New event description (max 1000 chars), or null to keep it."),
      event_date: nullable({ type: "string", format: "date" }, "New date YYYY-MM-DD, or null to keep it."),
      event_time: nullable({ type: "string" }, "New start time as the user said it, or null to keep it."),
      location: nullable({ type: "string" }, "New venue / place (max 160 chars), or null to keep it."),
      price: nullable({ type: "number" }, "New price in the store currency, or null to keep it. Only when the event has no ticket tiers yet."),
    },
    required: ["draft_id", "event_id", "title", "description", "event_date", "event_time", "location", "price"],
    additionalProperties: false,
  },
  parseInput: passObject,
  run: (ctx, input) => prepareDraft(ctx, "event.update", input),
};

export const discardMyDraft: AiTool<{ draft_id: string }> = {
  name: "discard_draft",
  description: "Discard a draft you prepared in this conversation (when the user asks to drop it). Applied drafts can't be discarded.",
  kind: "draft",
  inputSchema: {
    type: "object",
    properties: { draft_id: { type: "string", format: "uuid", description: "The draft_id to discard." } },
    required: ["draft_id"],
    additionalProperties: false,
  },
  parseInput: (raw) => {
    const id = (raw as { draft_id?: unknown } | null)?.draft_id;
    return isUuid(id) ? { draft_id: id } : null;
  },
  async run(ctx, { draft_id }) {
    if (!ctx.conversationId) return refuse("draft_not_found");
    const existing = await getOwnDraft(ctx.workspace, draft_id, ctx.conversationId);
    if (!existing) return refuse("draft_not_found");
    const row = await discardDraft(ctx.workspace, draft_id);
    if (!row) return refuse("draft_not_editable");
    await recordDraftEvent({ draftId: row.id, workspace: ctx.workspace, draftType: row.draft_type, action: "discarded", revision: row.revision });
    const view = toDraftView(row);
    if (view) ctx.emitDraft?.(view);
    return { ok: true, draft_id: row.id, status: "rejected" };
  },
};

export const getMyDrafts: AiTool = {
  name: "get_my_drafts",
  description: "List the drafts prepared in this conversation with their status (awaiting_confirmation, applied, failed, stale, rejected, expired).",
  kind: "read",
  inputSchema: NO_INPUT_SCHEMA,
  parseInput: parseNoInput,
  async run(ctx) {
    if (!ctx.conversationId) return { drafts: [] };
    const rows = await listConversationDrafts(ctx.workspace, ctx.conversationId);
    return {
      drafts: rows.map((r) => {
        const view = toDraftView(r);
        return { draft_id: r.id, type: r.draft_type, status: view?.status ?? r.status, revision: r.revision, fields: (view?.changes || []).map((c) => c.field), error: r.error_code };
      }),
    };
  },
};
