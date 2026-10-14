import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { guardConversationAction } from "@/lib/inbox/actorRoute";
import { changeAppointmentStatus, type ServiceClient } from "@/lib/salesBot/appointments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/inbox/appointments/<id>/status   { status: "confirmed" | "declined" | "cancelled" | "completed", details?: string }
// Confirms, declines or cancels one card-appointment request: the organization's OWNER, or a team member holding inbox.reply (decided by the database against the request's own
// conversation, never from anything in this request). Only those two fields (status, details) are read from the body; the request id comes from the URL. The customer is told only after the change succeeded.
// JSON only (a cross-site form post cannot send it), so cookie authentication is not exposed to CSRF.
const MAX_BODY_CHARS = 4_000;
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) return json({ ok: false, error: "invalid" }, 415);
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
    console.error(JSON.stringify({ scope: "card_appointments", result: "client_unavailable" }));
    return json({ ok: false, error: "server_error" }, 503);
  }
  const result = await changeAppointmentStatus(
    { admin: admin as unknown as ServiceClient, guard: (conversationId, permission) => guardConversationAction(conversationId, permission, "card_appointments") },
    { appointmentId: params.id, to: body.status, details: body.details },
  );
  return json(result.body, result.status);
}
