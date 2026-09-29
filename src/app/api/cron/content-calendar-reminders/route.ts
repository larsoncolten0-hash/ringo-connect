import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { notifyUser } from "@/lib/notifications";
import { sendPushToUser } from "@/lib/push/send";
import { translations } from "@/lib/i18n/translations";

// Daily cron — Ringo AI Content Calendar day-of reminders. Same
// CRON_SECRET bearer-auth pattern as every other cron route in this
// project (downgrade-expired, cleanup-demo-accounts, protection-auto-release).
//
// Idempotency/duplicate-prevention is entirely server-driven and atomic:
// content_calendar_claim_due_reminders() (see the migration) performs one
// UPDATE ... WHERE reminder_sent_at IS NULL ... RETURNING — a row is claimed
// (and therefore never claimed again, including by an overlapping/retried
// cron run) in the same statement that finds it. This route never does its
// own "check then send" — by the time a row comes back here, it has
// already been marked sent.
//
// Postponed/cancelled/skipped/already-published items are naturally
// excluded (the RPC only claims status = 'approved'), and a deleted item is
// simply gone, so there is nothing left to remind about for it — no special
// cases needed for either.
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return unauthorized();

  const admin = createAdminClient();
  const { data: dueItems, error } = await admin.rpc("content_calendar_claim_due_reminders");
  if (error) {
    console.error("content_calendar_claim_due_reminders failed:", error.message);
    return NextResponse.json({ error: "claim_failed" }, { status: 500 });
  }

  const items = (dueItems || []) as any[];
  if (items.length === 0) return NextResponse.json({ reminded: 0 });

  const planIds = Array.from(new Set(items.map((i) => i.plan_id)));
  const { data: plans } = await admin.from("content_calendar_plans").select("id, locale").in("id", planIds);
  const localeByPlan = new Map<string, "en" | "fr">((plans || []).map((p: any) => [p.id, p.locale === "fr" ? "fr" : "en"]));

  let reminded = 0;
  await Promise.allSettled(
    items.map(async (item) => {
      const locale = localeByPlan.get(item.plan_id) || "en";
      const c = translations[locale].ringoAi.calendar;
      const preview = (item.title || item.content || "").toString().slice(0, 120);
      const title = c.reminderTitle;
      const body = c.reminderBody(preview);
      const url = `/dashboard?section=content-calendar&item=${item.id}`;

      await Promise.allSettled([
        notifyUser(item.user_id, { type: "content_calendar_reminder", title, body, link: url }),
        sendPushToUser(admin, item.user_id, { category: "content_calendar_reminder", title, body, url }),
      ]);
      reminded++;
    })
  );

  return NextResponse.json({ reminded });
}
