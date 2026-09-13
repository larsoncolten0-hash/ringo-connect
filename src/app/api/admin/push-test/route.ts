import { assertAdmin } from "@/lib/assertAdmin";
import { createAdminClient } from "@/lib/supabase/server";
import { isPushConfigured } from "@/lib/push/webpush";
import { sendPushToUser } from "@/lib/push/send";
import { NextResponse } from "next/server";

// Sends a real push to the calling admin's own subscriptions — the
// "Send test notification" button on /admin/settings. Deliberately
// diagnostic rather than just firing blind: the two most likely reasons
// nothing shows up (VAPID env vars never set, or this admin never clicked
// the bell to actually subscribe) are checked explicitly and reported
// back, instead of a silent no-op that leaves someone wondering whether
// the whole feature is broken.
export async function POST() {
  const admin = await assertAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!isPushConfigured()) {
    return NextResponse.json(
      { error: "Push isn't configured — VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT must be set in the environment." },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();
  const { count } = await adminClient
    .from("push_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", admin.id);

  if (!count) {
    return NextResponse.json(
      { error: "Notifications aren't enabled on this device yet — click the bell icon in the sidebar first, then try again." },
      { status: 400 }
    );
  }

  await sendPushToUser(adminClient, admin.id, {
    category: "admin_test",
    title: "Test notification",
    body: "If you can see this, push notifications are working.",
    url: "/admin/settings",
  });

  // sendPushToUser never throws or reports failure directly (see its own
  // comment) — the real delivered/error outcome is in push_delivery_logs,
  // which is exactly what this endpoint reads back to give an honest
  // answer instead of always claiming success.
  const { data: lastLog } = await adminClient
    .from("push_delivery_logs")
    .select("delivered, error")
    .eq("user_id", admin.id)
    .eq("category", "admin_test")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastLog && !lastLog.delivered) {
    return NextResponse.json({ error: lastLog.error || "The push service rejected the notification." }, { status: 502 });
  }

  return NextResponse.json({ ok: true, subscriptionCount: count });
}
