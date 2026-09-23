import type { AiLocale } from "@/lib/ai/types";

// AI Content Studio (Phase 3 Increment 2). Unlike a draft, generated content
// is never written to any Ringo record and never persisted anywhere — there
// is nothing to apply, so no ai_drafts row, no Confirm & Apply. `id` exists
// only so the browser can key/store the card in memory for this session.

export type ContentType = "promotional_post" | "whatsapp_promotion" | "social_caption" | "announcement";

export interface ContentView {
  id: string;
  type: ContentType;
  locale: AiLocale;
  headline: string | null;
  body: string;
  cta: string | null;
  shortVersion: string | null;
  hashtags: string[];
}
