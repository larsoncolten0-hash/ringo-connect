import { NextResponse } from "next/server";
import { guardConversationAction } from "@/lib/inbox/actorRoute";
import { isUuid } from "@/lib/inbox/format";
import { checkStageRequest, conversationBelongsTo, issueStagedUpload } from "@/lib/inbox/stagedMedia";
import { signedUploadHeaders } from "@/lib/publicStorageHeaders";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { STAGED_VIDEO_MAX_BYTES } from "@/lib/whatsapp/mediaRules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/inbox/conversations/<id>/media/stage   JSON: { name, type, size, client_request_id }
// Step 1 of sending a LARGE VIDEO (over what the upload route can receive, up to Meta's 16 MB): checks the declared file, and hands the browser ONE signed upload url for a
// private staging object whose name is built here from the session's profile and this conversation. The browser uploads the file straight to storage (so it never has to fit in a
// serverless request), then calls POST /media with { staged_path, ... }. Same guard as the media route (the owner, or a team member with inbox.media); a custom header is required
// (a cross-site page cannot set it without a CORS preflight this route never answers); nothing about the recipient, the phone number or the token is involved.
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (request.headers.get("x-ringo-upload") !== "1") return json({ ok: false, error: "invalid" }, 400);
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return json({ ok: false, error: "invalid" }, 415);

  const guard = await guardConversationAction(params.id, "inbox.media", "whatsapp_media");
  if (!guard.ok) return json({ ok: false, error: guard.error }, guard.status);
  // the conversation must belong to the profile the object will be filed under (another business's owner gets the same 404 as for a missing conversation)
  if (!(await conversationBelongsTo(createClient(), guard.profileId, params.id))) return json({ ok: false, error: "not_found" }, 404);

  let body: Record<string, unknown> = {};
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json({ ok: false, error: "invalid" }, 413);
    const parsed = JSON.parse(raw);
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return json({ ok: false, error: "invalid" }, 400);
  }

  const checked = checkStageRequest({ name: body.name, type: body.type, size: body.size });
  if (!checked.ok) return json({ ok: false, error: checked.error }, checked.error === "too_large" ? 413 : 422);
  // the staged object is named after the send's own request id: it can only ever be sent as THAT send (once), never under another id
  if (typeof body.client_request_id !== "string" || !isUuid(body.client_request_id)) return json({ ok: false, error: "invalid" }, 422);

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return json({ ok: false, error: "server_error" }, 503);
  }
  const issued = await issueStagedUpload(admin as any, { profileId: guard.profileId as string, conversationId: params.id, requestId: body.client_request_id.toLowerCase(), ext: checked.ext });
  if (!issued.ok) {
    console.error(JSON.stringify({ scope: "whatsapp_media", result: "staging_unavailable" }));
    return json({ ok: false, error: "staging_unavailable" }, 503);
  }
  // `headers` are the ones Supabase's gateway expects on a signed upload (built from the PUBLIC key by publicConfig.ts); the browser just forwards them.
  return json({ ok: true, path: issued.path, upload_url: issued.signedUrl, headers: signedUploadHeaders(), max_bytes: STAGED_VIDEO_MAX_BYTES }, 200);
}
