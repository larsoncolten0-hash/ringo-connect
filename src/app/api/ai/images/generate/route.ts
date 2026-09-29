import { NextResponse } from "next/server";
import { resolveAiImageAccess } from "@/lib/ai/imageGuard";
import { generateAndStoreImage } from "@/lib/ai/imageGenerate";
import { getOwnConversation } from "@/lib/ai/conversations";
import { isUuid } from "@/lib/customer/connect";

// POST /api/ai/images/generate — a direct REST call for Ringo AI image
// generation (the generate_image tool covers the in-chat path; this route
// and the tool both call the SAME generateAndStoreImage(), so the actual
// generate+store+account sequence exists in exactly one place).
//
// Identity, plan and quota are entirely server-resolved — never trusted
// from the client: model/size/quality always come from admin-configured
// ai_settings (never accepted as request fields), and the caller's own
// userId/profileId come from resolveAiImageAccess()'s own session lookup,
// never from anything in the request body.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_PROMPT_CHARS = 2000;

const STATUS_BY_REASON: Record<string, number> = {
  not_authenticated: 401,
  account_inactive: 403,
  no_profile: 403,
  staff_workspace: 403,
  demo_account: 403,
  disabled: 403,
  not_configured: 503,
  not_in_beta: 403,
  plan_not_eligible: 403,
  image_not_eligible: 403,
};

export async function POST(request: Request) {
  // 1–3. Authenticate, resolve normal Ringo AI access, resolve image access
  // — all in one call (resolveAiImageAccess calls resolveAiAccess first).
  const access = await resolveAiImageAccess();
  if (!access.ok) return NextResponse.json({ error: access.reason }, { status: STATUS_BY_REASON[access.reason] ?? 403 });

  // 5. Validate request. Only a prompt (and an optional conversationId to
  // attribute usage to) is ever accepted from the client — no model, size,
  // quality, user id or profile id field is read from the body.
  const body = await request.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt || prompt.length > MAX_PROMPT_CHARS) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  // Optional conversationId is only ever used for usage attribution, and
  // only once re-verified to actually belong to this caller — exactly the
  // same ownership check the chat route applies, never trusted blindly.
  let conversationId: string | null = null;
  if (body?.conversationId != null) {
    if (!isUuid(body.conversationId)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    const conv = await getOwnConversation(access.access.workspace.userId, body.conversationId);
    if (conv && conv.profile_id === access.access.workspace.profileId) conversationId = conv.id;
  }

  // 4, 6–9. Quota reservation, settings-driven model/size/quality,
  // generation, storage, usage accounting — all inside generateAndStoreImage.
  const result = await generateAndStoreImage(access.access, prompt, conversationId);
  if (!result.ok) {
    const status = result.reason === "daily_limit" || result.reason === "monthly_limit" || result.reason === "budget_reached" ? 429 : result.reason === "quota_unavailable" ? 503 : 502;
    return NextResponse.json({ error: result.reason }, { status });
  }

  // 10. A clean, durable response — never the raw base64 image data (already
  // persisted to storage by generateAndStoreImage).
  return NextResponse.json({
    imageUrl: result.imageUrl,
    storagePath: result.storagePath,
    model: result.model,
    size: result.size,
    quality: result.quality,
  });
}
