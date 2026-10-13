import { NextResponse } from "next/server";
import { guardConversationAction } from "@/lib/inbox/actorRoute";
import { sendMediaReply } from "@/lib/inbox/sendMedia";
import { MEDIA_MAX_BYTES } from "@/lib/whatsapp/media";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/inbox/format";
import { conversationBelongsTo, parseStagedPath, readStaged, removeStaged, statStaged } from "@/lib/inbox/stagedMedia";
import { extensionOf, sanitizeFilename } from "@/lib/whatsapp/mediaRules";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/inbox/conversations/<id>/media   multipart/form-data: file, client_request_id, caption (optional)
// Sends ONE human media reply. Browser -> this route -> Meta (upload, then send by media id); the browser never talks to Meta and never sees the
// token or any Meta media URL. Exactly like the text route:
//   * the user comes from the session; the profile is derived from it (resolveInboxOwner) and re-checked by the database
//   * the recipient, business phone number id and WABA are NEVER read from the request: the conversation decides them, server side
//   * every other form field (to, phone_number_id, waba_id, profile_id, kind, type, ...) is ignored: the kind is derived from the verified file
// CSRF: a multipart form is a "simple" cross-site request, so a custom header is required (a cross-site page cannot set it without a CORS
// preflight that this route never answers), on top of the cookie's SameSite protection.
// Size: the platform accepts about 4.5 MB per request, so the cap is 4 MB per file (see lib/whatsapp/media.ts). The Content-Length is checked BEFORE
// the body is read, and the file's own size is checked again before its bytes are loaded.
// A VIDEO over that size (up to Meta's 16 MB) arrives as JSON instead: { staged_path, name, type, client_request_id, caption }. The browser stored the file in the private staging
// bucket with a one-time signed url from /media/stage; this route reads it back with the service role, runs it through the SAME validator and sender, and deletes the copy.
const OVERHEAD = 256 * 1024;
const JSON_BODY_MAX = 8 * 1024;

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (request.headers.get("x-ringo-upload") !== "1") return json({ ok: false, error: "invalid" }, 400);
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  if (contentType.startsWith("application/json")) return postStaged(request, params.id);
  if (!contentType.startsWith("multipart/form-data")) return json({ ok: false, error: "invalid" }, 415);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MEDIA_MAX_BYTES + OVERHEAD) return json({ ok: false, error: "too_large" }, 413);

  // the owner (unchanged) or a team member with inbox.media (+ reply + view): the database decides the relation to the organization that owns this conversation
  const guard = await guardConversationAction(params.id, "inbox.media", "whatsapp_media");
  if (!guard.ok) return json({ ok: false, error: guard.error }, guard.status);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "invalid" }, 400);
  }
  const file = form.get("file");
  if (!file || typeof file === "string" || typeof (file as Blob).arrayBuffer !== "function") return json({ ok: false, error: "empty_file" }, 422);
  if ((file as Blob).size > MEDIA_MAX_BYTES) return json({ ok: false, error: "too_large" }, 413);
  const bytes = new Uint8Array(await (file as Blob).arrayBuffer());

  const result = await sendMediaReply(
    { admin: guard.admin },
    {
      userId: guard.userId,
      conversationId: params.id,
      clientRequestId: form.get("client_request_id"),
      file: { name: (file as File).name, type: (file as Blob).type, bytes },
      caption: form.get("caption"),
    },
  );
  return json(result.body, result.status);
}

async function postStaged(request: Request, conversationId: string) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > JSON_BODY_MAX) return json({ ok: false, error: "invalid" }, 413);
  const guard = await guardConversationAction(conversationId, "inbox.media", "whatsapp_media");
  if (!guard.ok) return json({ ok: false, error: guard.error }, guard.status);

  let body: Record<string, unknown> = {};
  try {
    const raw = await request.text();
    if (raw.length > JSON_BODY_MAX) return json({ ok: false, error: "invalid" }, 413);
    const parsed = JSON.parse(raw);
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return json({ ok: false, error: "invalid" }, 400);
  }
  // The conversation must belong to this person's organization; the staged object must be one THIS profile staged for THIS conversation AND for THIS send (its name carries the
  // request id): the name is rebuilt from the session, never trusted. Nothing the browser says about the FILE is used: the type and extension come from the object's own
  // server-chosen name, its size and content type from storage (asked BEFORE anything is downloaded), its codecs from its bytes.
  if (!(await conversationBelongsTo(createClient(), guard.profileId, conversationId))) return json({ ok: false, error: "not_found" }, 404);
  const parsed = parseStagedPath(body.staged_path, guard.profileId, conversationId);
  const requestId = typeof body.client_request_id === "string" && isUuid(body.client_request_id) ? body.client_request_id.toLowerCase() : null;
  if (!parsed || !requestId || requestId !== parsed.requestId) return json({ ok: false, error: "invalid" }, 422);
  const path = body.staged_path as string;

  let storage: ReturnType<typeof createAdminClient>;
  try {
    storage = createAdminClient();
  } catch {
    return json({ ok: false, error: "server_error" }, 503);
  }
  const stat = await statStaged(storage as any, path, parsed.mime);
  if (!stat.ok) {
    if (stat.error === "missing") return json({ ok: false, error: "staged_missing" }, 409);
    if (stat.error === "too_large") {
      await removeStaged(storage as any, path);
      return json({ ok: false, error: "too_large" }, 413);
    }
    if (stat.error === "bad_type") {
      await removeStaged(storage as any, path);
      return json({ ok: false, error: "type_mismatch" }, 422);
    }
    // storage metadata missing or implausible: fail closed, download nothing (the object is left for the periodic cleanup)
    console.error(JSON.stringify({ scope: "whatsapp_media", result: "staged_unverifiable" }));
    return json({ ok: false, error: "staging_unavailable" }, 503);
  }
  const staged = await readStaged(storage as any, path, stat.size);
  if (!staged.ok) {
    if (staged.error === "too_large") {
      await removeStaged(storage as any, path);
      return json({ ok: false, error: "too_large" }, 413);
    }
    if (staged.error === "missing") return json({ ok: false, error: "staged_missing" }, 409);
    return json({ ok: false, error: "staging_unavailable" }, 503);
  }
  // the display name: the browser's name without its extension, plus the verified one
  const given = sanitizeFilename(body.name) ?? "video";
  const stem = (extensionOf(given) ? given.slice(0, given.lastIndexOf(".")) : given).slice(0, 90) || "video";
  const name = `${stem}.${parsed.ext}`;
  try {
    const result = await sendMediaReply(
      { admin: guard.admin },
      { userId: guard.userId, conversationId, clientRequestId: requestId, file: { name, type: parsed.mime, bytes: staged.bytes }, caption: body.caption },
    );
    return json(result.body, result.status);
  } finally {
    // The staged copy has served its purpose whatever the outcome: a replay of the same request is answered from the stored row, never from the file.
    await removeStaged(storage as any, path);
  }
}
