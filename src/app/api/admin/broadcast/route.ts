import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { sendPushToAllSubscribers, sendPushToAllUsers } from "@/lib/push/send";
import { NextResponse } from "next/server";

// A platform-wide push, sent by the super admin — "message notifications
// from Ringo Connect itself" per the user's own request. Two audiences:
// every fan across every creator's community (the common case — a
// platform announcement fans should hear about), or every creator/admin
// account. Logged to admin_audit_log like every other admin action, same
// as /api/admin/affiliate/settings.
export async function POST(request: Request) {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 120) : "";
  const message = typeof body?.body === "string" ? body.body.trim().slice(0, 500) : "";
  const audience = body?.audience === "users" ? "users" : "subscribers";
  const url = typeof body?.url === "string" && body.url.trim() ? body.url.trim().slice(0, 300) : "/";

  if (!title || !message) {
    return NextResponse.json({ error: "Title and message are required." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const payload = { category: "platform_broadcast", title, body: message, url };

  if (audience === "users") {
    await sendPushToAllUsers(adminClient, payload);
  } else {
    await sendPushToAllSubscribers(adminClient, payload);
  }

  await adminClient.from("admin_audit_log").insert({
    admin_id: admin.id,
    action: "send_platform_broadcast",
    details: { audience, title, body: message },
  });

  return NextResponse.json({ ok: true });
}
