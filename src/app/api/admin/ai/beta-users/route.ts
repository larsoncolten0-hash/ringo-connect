import { NextResponse } from "next/server";
import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/customer/connect";

export const dynamic = "force-dynamic";

// GET /api/admin/ai/beta-users — the Ringo AI allowlist with each owner's
// email/username and their requests in the last 24h.
export async function GET() {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = createAdminClient();
  const { data: rows, error } = await db
    .from("ai_beta_access")
    .select("user_id, granted_at, daily_message_limit_override, note")
    .order("granted_at", { ascending: false })
    .limit(500);
  if (error) return NextResponse.json({ error: "load_failed" }, { status: 500 });

  const ids = (rows || []).map((r) => r.user_id);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ data: users }, { data: profiles }, { data: recent }] = await Promise.all([
    ids.length ? db.from("users").select("id, email").in("id", ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? db.from("profiles").select("user_id, username").in("user_id", ids) : Promise.resolve({ data: [] as any[] }),
    ids.length ? db.from("ai_usage_events").select("user_id").in("user_id", ids).gte("created_at", since).limit(10000) : Promise.resolve({ data: [] as any[] }),
  ]);
  const email = new Map((users || []).map((u: any) => [u.id, u.email]));
  const username = new Map((profiles || []).map((p: any) => [p.user_id, p.username]));
  const used = new Map<string, number>();
  for (const r of recent || []) used.set(r.user_id, (used.get(r.user_id) || 0) + 1);

  return NextResponse.json({
    users: (rows || []).map((r) => ({
      userId: r.user_id,
      email: email.get(r.user_id) ?? null,
      username: username.get(r.user_id) ?? null,
      grantedAt: r.granted_at,
      dailyLimitOverride: r.daily_message_limit_override,
      note: r.note,
      requests24h: used.get(r.user_id) || 0,
    })),
  });
}

// POST /api/admin/ai/beta-users — { email, dailyLimitOverride?, note? }:
// grant beta access to the owner account with that email.
export async function POST(request: Request) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const override = body?.dailyLimitOverride;
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 200) : null;
  if (!email || email.length > 200) return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  if (override != null && (!Number.isInteger(override) || override < 0 || override > 1000)) {
    return NextResponse.json({ error: "invalid_limit" }, { status: 400 });
  }

  const db = createAdminClient();
  // Exact match (not ilike: "_" and "%" in an email would act as wildcards).
  const { data: user } = await db.from("users").select("id").eq("email", email).maybeSingle();
  if (!user) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

  const { error } = await db
    .from("ai_beta_access")
    .upsert(
      { user_id: user.id, granted_by: admin.id, daily_message_limit_override: override ?? null, note: note || null },
      { onConflict: "user_id" }
    );
  if (error) {
    console.error("ai beta grant failed:", error.message);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }
  await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "ai_beta_grant", target_user_id: user.id, details: { dailyLimitOverride: override ?? null } });
  return NextResponse.json({ ok: true });
}

// DELETE /api/admin/ai/beta-users?userId=<uuid> — revoke beta access.
export async function DELETE(request: Request) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const userId = new URL(request.url).searchParams.get("userId");
  if (!isUuid(userId)) return NextResponse.json({ error: "invalid_user" }, { status: 400 });

  const db = createAdminClient();
  const { error } = await db.from("ai_beta_access").delete().eq("user_id", userId);
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
  await db.from("admin_audit_log").insert({ admin_id: admin.id, action: "ai_beta_revoke", target_user_id: userId });
  return NextResponse.json({ ok: true });
}
