import { NextResponse } from "next/server";
import { guardConversationAction } from "@/lib/inbox/actorRoute";
import { sendReply } from "@/lib/inbox/send";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/inbox/conversations/<id>/messages   { text, client_request_id }
// The ONLY inbox API: it sends one human text reply. Browser -> this route -> Meta; the browser never talks to Meta and never sees the token.
//   * the user comes from the session; the profile is derived from it (resolveInboxOwner) and re-checked by the database
//   * the recipient, business phone number id and WABA are NEVER read from the request: the conversation decides them, server side
//   * any extra field in the body (to, phone_number_id, waba_id, profile_id, ...) is ignored
// JSON only (a cross-site form post cannot send it), so cookie authentication is not exposed to CSRF.
const MAX_BODY_CHARS = 32_000;

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) return json({ ok: false, error: "invalid" }, 415);

  // the owner (unchanged) or a team member with inbox.reply: the database decides the relation to the organization that owns this conversation
  const guard = await guardConversationAction(params.id, "inbox.reply", "whatsapp_send");
  if (!guard.ok) return json({ ok: false, error: guard.error }, guard.status);

  let raw = "";
  let body: unknown = null;
  try {
    raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return json({ ok: false, error: "too_long" }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "invalid" }, 400);
  }
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const result = await sendReply({ admin: guard.admin }, { userId: guard.userId, conversationId: params.id, clientRequestId: b.client_request_id, text: b.text });
  return json(result.body, result.status);
}
