import { createAdminClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Public, unauthenticated — deliberately: security staff never get a
// Supabase account or a Ringo session (see the migration's own comment on
// why). `token` alone is the entire access control here — a
// cryptographically random 64-char string (scanner_sessions.token),
// looked up with the admin client since there is no auth.uid() an RLS
// policy could ever recognize for this caller. Never returns anything
// beyond what the scanner screen itself needs — no artist revenue, no
// other events, no customer contact info (see section 30 of the spec this
// was built from).
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { token: string } }) {
  const admin = createAdminClient();

  const { data: session } = await admin
    .from("scanner_sessions")
    .select("id, event_id, gate_name, scanner_type, permission_level, is_active, expires_at, events(title)")
    .eq("token", params.token)
    .maybeSingle();

  if (!session) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!session.is_active) return NextResponse.json({ error: "revoked" }, { status: 403 });
  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    return NextResponse.json({ error: "expired" }, { status: 403 });
  }

  // "Checked In" on the scanner's own header is this gate's own tally
  // only (see section 6 of the spec) — event-wide totals live in the
  // organizer's Check-in dashboard, never here.
  const { count } = await admin
    .from("ticket_checkin_logs")
    .select("*", { count: "exact", head: true })
    .eq("scanner_session_id", session.id)
    .eq("result", "approved");

  return NextResponse.json({
    eventTitle: (session.events as any)?.title || "",
    gateName: session.gate_name,
    scannerType: session.scanner_type,
    permissionLevel: session.permission_level,
    checkedInCount: count || 0,
  });
}
