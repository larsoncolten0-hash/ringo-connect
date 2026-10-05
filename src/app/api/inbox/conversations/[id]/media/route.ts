import { NextResponse } from "next/server";
import { guardConversationAction } from "@/lib/inbox/actorRoute";
import { sendMediaReply } from "@/lib/inbox/sendMedia";
import { MEDIA_MAX_BYTES } from "@/lib/whatsapp/media";

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
const OVERHEAD = 256 * 1024;

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (request.headers.get("x-ringo-upload") !== "1") return json({ ok: false, error: "invalid" }, 400);
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("multipart/form-data")) return json({ ok: false, error: "invalid" }, 415);
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
