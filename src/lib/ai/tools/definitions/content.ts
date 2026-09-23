import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/customer/connect";
import { getOwnDraft } from "@/lib/ai/drafts/store";
import type { ContentType, ContentView } from "@/lib/ai/content/view";
import type { AiTool } from "../types";

// AI Content Studio — the model calls this only AFTER it has already
// composed marketing copy (using a get_my_*_summary tool for grounding, or
// the user's own words). This tool never generates anything itself: it
// validates the shape/length of what the model wrote and, if the content is
// about a specific Ringo object, verifies that object actually belongs to
// this workspace (same defensive posture as a draft's loadBase, but
// read-only — nothing is written or stored). Never persisted: there is no
// ai_drafts row, no apply, no Confirm & Apply — the card is done the moment
// it's shown.

const nullable = (schema: Record<string, unknown>, description: string) => ({ anyOf: [schema, { type: "null" }], description });

const CONTENT_TYPES = ["promotional_post", "whatsapp_promotion", "social_caption", "announcement"] as const;
const TARGET_TYPES = ["product", "event", "track", "menu_item"] as const;
type TargetType = (typeof TARGET_TYPES)[number];

const TARGET_TABLE: Record<TargetType, string> = {
  product: "products",
  event: "events",
  track: "tracks",
  menu_item: "menu_items",
};

const HINTS: Record<string, string> = {
  invalid_input: "Some values aren't valid (see fields). Fix them and call generate_content again.",
  not_found: "That target id doesn't belong to this workspace. Look it up again with the matching get_my_*_summary tool, or ask the user which item they mean.",
  draft_not_found: "That draft_id doesn't exist in this conversation, or isn't yours. Omit draft_id and use what you already know, or ask the user.",
  draft_not_usable: "That draft was discarded, expired, or is a type this doesn't support yet. Omit draft_id and use what you already know, or ask the user.",
};

const refuse = (reason: string, fields?: string[]) => ({ ok: false, reason, ...(fields ? { fields } : {}), hint: HINTS[reason] ?? "" });

function str(v: unknown, max: number): string | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > max ? undefined : t || null;
}

// A draft is usable for content grounding while its facts are still what the
// owner would actually see if they clicked Confirm & Apply — never once
// discarded/expired/stale/failed (those facts may no longer be true).
const SAFE_DRAFT_STATUSES = new Set(["awaiting_confirmation", "applying", "applied"]);

/**
 * Only the fields appropriate for grounding generated marketing copy — never
 * an id, never PII, never payment/audit data, never a raw column not already
 * reviewed by the owner on the draft's own card. *.update drafts only carry
 * CHANGED fields in `payload` (null = unchanged), so they're merged with
 * `base` (the current values captured when the draft was prepared) to
 * describe the whole object, not just what's being edited. *.create drafts
 * have no `base` — `payload` alone is already the complete picture. Draft
 * types with no case here (e.g. profile.update) are simply not supported for
 * content grounding — the caller treats a `null` return as "unsupported."
 */
function draftContentFacts(draftType: string, payload: any, base: Record<string, unknown> | null): { kind: string; facts: Record<string, unknown> } | null {
  const b = base || {};
  switch (draftType) {
    case "product.create":
      return { kind: "product", facts: { name: payload.name, description: payload.description, price: payload.price, currency: payload.currency, has_photo: !!payload.imageUrl } };
    case "product.update":
      return {
        kind: "product",
        facts: {
          name: payload.name ?? b.name ?? null,
          description: payload.description ?? b.description ?? null,
          price: payload.price ?? b.price ?? null,
          currency: payload.currency,
          has_photo: !!(payload.imageUrl ?? b.image_url),
        },
      };
    case "event.create":
      return { kind: "event", facts: { title: payload.title, date: payload.date, time: payload.time, location: payload.location } };
    case "event.update":
      return {
        kind: "event",
        facts: {
          title: payload.title ?? b.title ?? null,
          description: payload.description ?? b.description ?? null,
          date: payload.eventDate ?? b.event_date ?? null,
          time: payload.eventTime ?? b.event_time ?? null,
          location: payload.location ?? b.location ?? null,
          price: payload.price ?? b.price ?? null,
          currency: payload.currency,
        },
      };
    case "menu_item.create":
      return {
        kind: "menu_item",
        facts: {
          name: payload.name,
          description: payload.description,
          price: payload.price,
          currency: payload.currency,
          available: payload.available,
          category: b.menu_category_name ?? null,
        },
      };
    case "menu_item.update":
      return {
        kind: "menu_item",
        facts: {
          name: payload.name ?? b.name ?? null,
          description: payload.description ?? b.description ?? null,
          price: payload.price ?? b.price ?? null,
          currency: payload.currency,
          available: payload.available ?? b.available ?? null,
        },
      };
    case "track.update":
      return {
        kind: "track",
        facts: {
          title: payload.title ?? b.title ?? null,
          description: payload.description ?? b.description ?? null,
          price: payload.price ?? b.price ?? null,
          currency: payload.currency,
        },
      };
    default:
      return null;
  }
}

export const generateContent: AiTool<Record<string, unknown>> = {
  name: "generate_content",
  description:
    "Present marketing content you have ALREADY WRITTEN (headline/body/cta/etc.) as a clean card the user can copy. Call this AFTER grounding yourself with the right get_my_*_summary tool and composing the text — never before. Only include facts that tool actually returned or the user gave you; marketing language (tone, enthusiasm) can be creative, factual claims cannot be invented. If target_type/target_id are given, target_id must be a real id from a get_my_*_summary tool for THIS workspace. If this content is about a product/event/menu item/track draft you (or an earlier turn) prepared but the owner hasn't confirmed yet, pass its draft_id instead — the result includes draft_facts verified straight from the draft; if they differ from what you wrote, call generate_content again with corrected content before replying. This never publishes, sends or applies anything — the user copies it themselves, and the referenced draft is never changed.",
  kind: "content",
  permission: "settings.view",
  inputSchema: {
    type: "object",
    properties: {
      content_type: { type: "string", enum: [...CONTENT_TYPES], description: "promotional_post | whatsapp_promotion | social_caption | announcement." },
      target_type: nullable({ type: "string", enum: [...TARGET_TYPES] }, "What kind of Ringo object this is about, or null if it's not about one specific item."),
      target_id: nullable({ type: "string", format: "uuid" }, "The id of that item from a get_my_*_summary tool, or null. Required together with target_type."),
      draft_id: nullable(
        { type: "string", format: "uuid" },
        "The draft_id of a product/event/menu item/track draft prepared in this conversation, to ground the content in its verified prepared facts (returned as draft_facts), or null. Independent of target_type/target_id — use whichever applies, or neither."
      ),
      language: { type: "string", enum: ["en", "fr"], description: "The language you wrote the content in." },
      headline: nullable({ type: "string" }, "Short headline/title (max 120 chars), or null if this content type doesn't use one."),
      body: { type: "string", description: "The main content (max 2000 chars)." },
      cta: nullable({ type: "string" }, "Call to action (max 80 chars), or null."),
      short_version: nullable({ type: "string" }, "A shorter alternative version (max 500 chars), or null."),
      hashtags: nullable({ type: "array", items: { type: "string" } }, "Up to 10 hashtags without the # symbol, or null."),
    },
    required: ["content_type", "target_type", "target_id", "draft_id", "language", "headline", "body", "cta", "short_version", "hashtags"],
    additionalProperties: false,
  },
  parseInput: (raw) => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null),
  async run(ctx, input) {
    const contentType = input.content_type;
    if (typeof contentType !== "string" || !(CONTENT_TYPES as readonly string[]).includes(contentType)) return refuse("invalid_input", ["content_type"]);
    const language = input.language === "fr" ? "fr" : input.language === "en" ? "en" : null;
    if (!language) return refuse("invalid_input", ["language"]);

    const invalid: string[] = [];
    const headline = str(input.headline, 120);
    if (headline === undefined) invalid.push("headline");
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!body || body.length > 2000) invalid.push("body");
    const cta = str(input.cta, 80);
    if (cta === undefined) invalid.push("cta");
    const shortVersion = str(input.short_version, 500);
    if (shortVersion === undefined) invalid.push("short_version");

    let hashtags: string[] = [];
    if (input.hashtags !== null && input.hashtags !== undefined) {
      const raw = input.hashtags;
      if (!Array.isArray(raw) || raw.length > 10 || !raw.every((h) => typeof h === "string" && h.length <= 40)) {
        invalid.push("hashtags");
      } else {
        hashtags = raw.map((h) => String(h).replace(/^#/, "").trim()).filter(Boolean);
      }
    }

    const targetType = input.target_type;
    const targetId = input.target_id;
    const targetGiven = targetType !== null && targetType !== undefined;
    const targetIdGiven = targetId !== null && targetId !== undefined;
    if (targetGiven !== targetIdGiven) invalid.push("target_type");
    else if (targetGiven) {
      if (typeof targetType !== "string" || !(TARGET_TYPES as readonly string[]).includes(targetType) || typeof targetId !== "string" || !isUuid(targetId)) {
        invalid.push("target_type");
      }
    }
    const draftId = input.draft_id;
    const draftIdGiven = draftId !== null && draftId !== undefined;
    if (draftIdGiven && (typeof draftId !== "string" || !isUuid(draftId))) invalid.push("draft_id");
    if (invalid.length) return refuse("invalid_input", invalid);

    if (targetGiven) {
      const db = createClient();
      const { data } = await db
        .from(TARGET_TABLE[targetType as TargetType])
        .select("id")
        .eq("id", targetId as string)
        .eq("profile_id", ctx.workspace.profileId)
        .maybeSingle();
      if (!data) return refuse("not_found");
    }

    // draft_id is only ever resolved through getOwnDraft — the SAME
    // ownership-verified loader every draft tool already uses (scoped to
    // the server-resolved workspace.userId/profileId AND this conversation,
    // never to anything the model supplies). A draft the model doesn't own,
    // or that belongs to another profile/conversation, simply doesn't come
    // back — same as every other draft lookup in this codebase. Nothing is
    // applied, changed or published by this lookup.
    let draftFacts: { kind: string; facts: Record<string, unknown> } | null = null;
    if (draftIdGiven) {
      const row = await getOwnDraft(ctx.workspace, draftId as string, ctx.conversationId);
      if (!row) return refuse("draft_not_found");
      const expired = row.status === "awaiting_confirmation" && new Date(row.expires_at).getTime() <= Date.now();
      const status = expired ? "expired" : row.status;
      if (!SAFE_DRAFT_STATUSES.has(status)) return refuse("draft_not_usable");
      const extracted = draftContentFacts(row.draft_type, row.payload, row.base);
      if (!extracted) return refuse("draft_not_usable");
      draftFacts = extracted;
    }

    const view: ContentView = {
      id: crypto.randomUUID(),
      type: contentType as ContentType,
      locale: language,
      headline: headline ?? null,
      body,
      cta: cta ?? null,
      shortVersion: shortVersion ?? null,
      hashtags,
    };
    ctx.emitContent?.(view);
    return {
      ok: true,
      ...(draftFacts ? { draft_facts: draftFacts } : {}),
      shown_to_user: "A content card with Copy buttons.",
      important: draftFacts
        ? "This is a draft of content only — nothing was posted, sent, published or applied. The referenced draft itself is unchanged; only the owner's own Confirm & Apply click on ITS card can ever apply it. If draft_facts don't match what you wrote, call generate_content again with corrected content before replying."
        : "This is a draft of content only — nothing was posted, sent or published anywhere. The user copies and uses it themselves.",
    };
  },
};
