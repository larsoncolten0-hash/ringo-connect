import { resolveAiImageAccess } from "@/lib/ai/imageGuard";
import { generateAndStoreImage } from "@/lib/ai/imageGenerate";
import type { ImageView } from "@/lib/ai/content/imageView";
import type { AiTool } from "../types";

// Ringo AI Image Generation — a DIRECT action tool (kind "image"), not a
// draft and not text content. Unlike every other tool, this one has real
// per-call cost, so it re-derives and enforces its own access/quota gate at
// the moment it runs (resolveAiImageAccess, src/lib/ai/imageGuard.ts)
// rather than trusting the workspace snapshot the conversation started
// with — a plan can change mid-conversation, and quota must be reserved
// atomically against concurrent requests regardless. The actual
// generate+store+account sequence lives in src/lib/ai/imageGenerate.ts,
// shared with POST /api/ai/images/generate so it exists in exactly one place.
//
// available() below only HIDES the tool from an ineligible plan (saves
// prompt tokens, avoids offering something that will just refuse) — it is
// never the actual authorization; resolveAiImageAccess() is.

const MAX_PROMPT_CHARS = 2000;

const HINTS: Record<string, string> = {
  disabled: "Ringo AI is paused right now. Tell the user to try again later.",
  not_configured: "Image generation isn't available right now. Tell the user to try again later.",
  not_in_beta: "Image generation is in a private beta and isn't enabled for this account.",
  plan_not_eligible: "This account's plan doesn't include Ringo AI. Tell the user to check their plan.",
  image_not_eligible: "This account's plan doesn't include Ringo AI Image Generation. Tell the user which plans do (Pro and above) and that they can upgrade from Dashboard → Subscription.",
  daily_limit: "The daily image limit has been reached. Tell the user to try again tomorrow.",
  monthly_limit: "The monthly image limit has been reached. Tell the user to try again next month.",
  budget_reached: "The image generation budget for this month has been reached. Tell the user to try again later.",
  quota_unavailable: "Couldn't check the image quota right now. Tell the user to try again in a moment.",
  generation_failed: "Image generation failed on the provider's side. Tell the user it failed and they can try again.",
  storage_failed: "The image was generated but couldn't be saved. Tell the user it failed and they can try again.",
};

const refuse = (reason: string) => ({ ok: false, reason, hint: HINTS[reason] ?? "" });

export const generateImage: AiTool<{ prompt: string }> = {
  name: "generate_image",
  description:
    "Generate ONE real image (a promotional flyer, social media poster, business banner, artwork, event graphic, etc.) from a text prompt you write. This is a DIRECT action — calling this tool actually generates and shows the image immediately; it is never a draft, a preview, or something that needs a separate confirm step. Write a clear, complete prompt describing subject, style and any text to include. Only include facts that are true: a phone number, address, price, business name, event date, URL or product detail may ONLY appear if the user actually told you it in this conversation, or you already read it from a get_my_*_summary tool — never invent or guess one. If a fact you would need is missing, ask the user for it instead of calling this tool. There is no way to generate more than one image per call.",
  kind: "image",
  permission: "settings.view",
  available: (snapshot) => snapshot.plan.aiImageEnabled,
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: `The full image-generation prompt, describing exactly what to create. Max ${MAX_PROMPT_CHARS} characters.` },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  parseInput(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const prompt = (raw as { prompt?: unknown }).prompt;
    if (typeof prompt !== "string") return null;
    const trimmed = prompt.trim();
    if (!trimmed || trimmed.length > MAX_PROMPT_CHARS) return null;
    return { prompt: trimmed };
  },
  async run(ctx, input) {
    // Re-derived from the live session, never trusted from ctx/the client —
    // see the module comment. This also re-checks the kill switch, account
    // status, staff-workspace rule, demo rule, the beta allowlist and the
    // text ai_enabled gate (resolveAiAccess(), called first inside this).
    const access = await resolveAiImageAccess();
    if (!access.ok) return refuse(access.reason);

    const result = await generateAndStoreImage(access.access, input.prompt, ctx.conversationId ?? null);
    if (!result.ok) return refuse(result.reason);

    const view: ImageView = {
      id: crypto.randomUUID(),
      imageUrl: result.imageUrl,
      prompt: input.prompt,
      model: result.model,
      size: result.size,
      quality: result.quality,
    };
    ctx.emitImage?.(view);

    return {
      ok: true,
      shown_to_user: "The generated image, shown directly in the conversation with a download option.",
      important: "This is a real, already-generated and saved image — not a draft or a preview. There is nothing further to confirm or apply for the image itself.",
    };
  },
};
