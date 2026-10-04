import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveInboxOwner } from "./access";
import type { Actor, ToolResult } from "./tools";

// Shared guard for the Inbox's owner-action routes (saved replies, close/reopen). Order is fixed and fails closed:
//   1. JSON only (a cross-site form post cannot send it, so cookie authentication is not exposed to CSRF)
//   2. the signed-in user, and THEIR OWN profile with a WhatsApp account (resolveInboxOwner): the profile is never read from the request
//   3. the body is size-capped and parsed; handlers read only the fields they name, so extra fields (profile_id, recipient, ...) are ignored
//   4. the service client is created only now, server side
export const MAX_BODY_CHARS = 32_000;
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function withInboxOwner(request: Request, handler: (actor: Actor, body: Record<string, unknown>) => Promise<ToolResult>): Promise<NextResponse> {
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) return json({ ok: false, error: "invalid" }, 415);

  const access = await resolveInboxOwner();
  if (!access.ok) return json({ ok: false, error: "not_found" }, access.reason === "not_signed_in" ? 401 : 403);

  let body: Record<string, unknown> = {};
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return json({ ok: false, error: "invalid" }, 413);
    const parsed = raw.trim() === "" ? {} : JSON.parse(raw);
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return json({ ok: false, error: "invalid" }, 400);
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    console.error(JSON.stringify({ scope: "inbox_tools", result: "client_unavailable" }));
    return json({ ok: false, error: "server_error" }, 503);
  }

  const result = await handler({ admin, userId: access.owner.userId, profileId: access.owner.profileId }, body);
  return json(result.body, result.status);
}
