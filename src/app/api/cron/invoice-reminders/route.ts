import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendEmail } from "@/lib/email/provider";
import { notifyUser } from "@/lib/notifications";
import { sendPushToUser } from "@/lib/push/send";
import { runInvoiceReminders } from "@/lib/receivables/cron";

// Daily cron: automatic invoice payment reminders (email) and optional owner alerts. Same CRON_SECRET bearer pattern as every other cron.
//
// DORMANT BY DEFAULT: unless the environment variable INVOICE_REMINDERS_CRON_ENABLED is exactly "true" this route does nothing. Even
// when enabled, a business only gets automatic reminders after turning them on itself (OFF by default). All rules (limits, spacing,
// dedupe, suppression, paused contacts, plan/demo/category, void/paid) are enforced inside the database claim function.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const result = await runInvoiceReminders({
    admin: admin as any,
    send: sendEmail,
    notifyUser: (userId, input) => notifyUser(userId, input),
    pushToUser: (userId, payload) => sendPushToUser(admin, userId, payload),
    env: process.env as Record<string, string | undefined>,
  });
  return NextResponse.json(result);
}
