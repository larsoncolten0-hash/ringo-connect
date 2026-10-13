import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { guardConversationAction } from "@/lib/inbox/actorRoute";
import { isUuid } from "@/lib/inbox/format";
import { getWhatsAppAccessToken } from "@/lib/whatsapp/outbound";
import { contentDisposition, deliveryFor, isMediaId, lookupWhatsAppMedia, openWhatsAppMedia } from "@/lib/whatsapp/mediaFetch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/inbox/conversations/<conversation id>/media/<message id>[?download=1]
// Streams ONE stored WhatsApp media file (a customer's photo / voice note / video / document, or a file Ringo sent) to a signed-in person who may read this conversation.
//   * authorization: the same guard as every Inbox route (the owner of the conversation, or a team member with inbox.view); the message and its media row are then read
//     through the person's OWN session, so the tables' row level security applies on top, and both must belong to THIS conversation
//   * the media id and the file type come from the database row, never from the request; the Meta token stays on the server; no Meta URL is ever returned
//   * the bytes are streamed (never buffered whole), with Range support passed through so audio and video can be seeked
//   * the type sent to the browser is chosen from a fixed list, every response carries nosniff and a sandboxing CSP, and the response is private to this browser
// This route returns FILES, never inbox data: errors are tiny JSON bodies with no detail.

const json = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });

function log(entry: Record<string, unknown>) {
  console.error(JSON.stringify({ scope: "inbox_media_view", ...entry }));
}

type Ctx = { params: { id: string; messageId: string } };

export async function GET(request: Request, { params }: Ctx) {
  if (!isUuid(params.id) || !isUuid(params.messageId)) return json("not_found", 404);

  const guard = await guardConversationAction(params.id, "inbox.view", "inbox_media_view");
  if (!guard.ok) return json(guard.error, guard.status);

  const token = getWhatsAppAccessToken();
  if (!token) {
    log({ result: "not_configured" });
    return json("not_configured", 503);
  }

  // The message and its media row, through the signed-in person's own session (RLS), pinned to this conversation.
  let row: { media_id: string; mime_type: string | null; filename: string | null; kind: string } | null = null;
  try {
    const session = createClient();
    const msg = await session.from("inbox_messages").select("id").eq("id", params.messageId).eq("conversation_id", params.id).maybeSingle();
    if (msg.error) {
      log({ result: "message_query_failed", code: String(msg.error.code || "").slice(0, 20) });
      return json("server_error", 500);
    }
    if (!msg.data) return json("not_found", 404);
    const media = await session.from("inbox_message_media").select("media_id, mime_type, filename, kind").eq("message_id", params.messageId).maybeSingle();
    if (media.error) {
      log({ result: "media_query_failed", code: String(media.error.code || "").slice(0, 20) });
      return json("server_error", 500);
    }
    row = media.data ?? null;
  } catch {
    log({ result: "exception" });
    return json("server_error", 500);
  }
  if (!row || !isMediaId(row.media_id)) return json("not_found", 404);

  const lookup = await lookupWhatsAppMedia(row.media_id, token);
  if (lookup.kind === "not_found") return json("expired", 410);
  if (lookup.kind !== "ok") {
    log({ result: "lookup_unavailable" });
    return json("unavailable", 502);
  }

  const download = new URL(request.url).searchParams.get("download") === "1";
  const opened = await openWhatsAppMedia(lookup.url, token, request.headers.get("range"));
  if (opened.kind === "not_found") return json("expired", 410);
  if (opened.kind === "too_large") return json("too_large", 413);
  if (opened.kind !== "ok") {
    log({ result: "download_unavailable" });
    return json("unavailable", 502);
  }

  const up = opened.response;
  const delivery = deliveryFor(row.kind, row.mime_type, lookup.mimeType ?? up.headers.get("content-type"), download);
  const headers = new Headers({
    "Content-Type": delivery.contentType,
    "Content-Disposition": contentDisposition(delivery.disposition, row.filename),
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    // The bytes of a media id never change, so the browser may keep them for a while; they are private to this signed-in browser.
    "Cache-Control": "private, max-age=3600",
  });
  // "Accept-Ranges" is only promised when the upstream really serves ranges (it answered 206, or says so): a player must not be told it can seek by range when it cannot
  if (up.status === 206 || /bytes/i.test(up.headers.get("accept-ranges") || "")) headers.set("Accept-Ranges", "bytes");
  for (const h of ["content-length", "content-range"]) {
    const v = up.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(up.body, { status: up.status === 206 ? 206 : 200, headers });
}

/** HEAD: the same checks and the same status and headers, without the body (the Inbox uses it to learn whether a file is still available before offering a download). */
export async function HEAD(request: Request, ctx: Ctx) {
  const res = await GET(request, ctx);
  try {
    await res.body?.cancel();
  } catch {
    /* nothing to cancel */
  }
  return new Response(null, { status: res.status, headers: res.headers });
}
