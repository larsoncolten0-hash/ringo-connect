import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { parseFollowUpUpdate } from "@/lib/customerFollowUp";

// Customer Follow-Up workflow: mark a customer "needs follow-up" / "completed", set a follow-up
// date and assign a staff member. Admin-only (server-side — the page's own admin gate is UX, this
// is the real check). Writes ONLY the customer_followups table; the customer's registration,
// attribution, payment and subscription records are never touched. The assignee must be an admin.
export async function POST(request: Request) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = parseFollowUpUpdate(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;

  const db = createAdminClient();

  // The subject must exist, and the assignee must be a staff (admin) account.
  const subjectTable = v.subjectType === "request" ? "signup_requests" : "users";
  const { data: subject } = await db.from(subjectTable).select("id").eq("id", v.subjectId).maybeSingle();
  if (!subject) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (v.assignedTo) {
    const { data: staff } = await db.from("users").select("role").eq("id", v.assignedTo).maybeSingle();
    if (staff?.role !== "admin") return NextResponse.json({ error: "invalid_assignee" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error } = await db.from("customer_followups").upsert(
    {
      subject_type: v.subjectType,
      subject_id: v.subjectId,
      status: v.status,
      follow_up_date: v.followUpDate,
      assigned_to: v.assignedTo,
      note: v.note,
      updated_by: admin.id,
      updated_at: now,
    },
    { onConflict: "subject_type,subject_id" }
  );
  if (error) {
    // Table not created yet (migration not applied) — say so plainly instead of failing obscurely.
    const missing = error.code === "42P01" || error.code === "PGRST205" || /customer_followups/.test(error.message || "");
    console.error("[follow-up] save failed:", error.message);
    return NextResponse.json({ error: missing ? "workflow_unavailable" : "save_failed" }, { status: missing ? 503 : 500 });
  }
  return NextResponse.json({ ok: true });
}
