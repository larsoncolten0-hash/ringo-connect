import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { recordAudit } from "@/lib/adminAudit";
import { NextResponse } from "next/server";

// Moves a Watchdog incident along: open -> acknowledged -> resolved. Platform admins only (assertAdmin). It never deletes anything and never touches the incident's
// content: the database trigger on watchdog_events refuses any change except the status fields, refuses to reopen a resolved incident and refuses DELETE.
// The change itself is written to admin_audit_log (who, which incident, to which status).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FROM: Record<"acknowledged" | "resolved", string[]> = { acknowledged: ["open"], resolved: ["open", "acknowledged"] };

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!UUID.test(params.id)) return NextResponse.json({ error: "Invalid incident." }, { status: 400 });

  const body = await request.json().catch(() => null);
  if (body?.status !== "acknowledged" && body?.status !== "resolved") return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  const status: "acknowledged" | "resolved" = body.status;

  const now = new Date().toISOString();
  const patch = status === "acknowledged" ? { status, acknowledged_at: now, acknowledged_by: admin.id } : { status, resolved_at: now, resolved_by: admin.id };

  const adminClient = createAdminClient();
  const { data, error } = await adminClient.from("watchdog_events").update(patch).eq("id", params.id).in("status", FROM[status]).select("id, status");
  if (error) return NextResponse.json({ error: "Could not update this incident." }, { status: 400 });
  if (!data || data.length === 0) return NextResponse.json({ error: "Incident not found or already in that state." }, { status: 404 });

  await recordAudit(adminClient, { actorId: admin.id, action: `watchdog_${status}`, details: { incidentId: params.id } });
  return NextResponse.json({ ok: true, status });
}
