import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendPushToCustomer } from "@/lib/customer/push";
import { discover, dispatch, type Db } from "@/lib/church/push/run";

// Every 15 minutes: queue what is new in the churches (announcements, group notices, events, testimonies, the Daily Word, the daily Bible reading, care needs, new products) and send what is due to the
// people who chose to hear about it. Same CRON_SECRET bearer-auth pattern as every other cron route of this project. Safe to run twice or at once: the queue is unique per church, kind and item, a
// claim is atomic, and a person who was already notified is never notified again. See lib/church/push/run.ts.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const db = createAdminClient() as unknown as Db;
    const found = await discover(db);
    const sent = await dispatch(db, (customerId, payload) => sendPushToCustomer(customerId, payload));
    return NextResponse.json({ queued: found.queued, discoverErrors: found.errors, ...sent });
  } catch {
    console.error(JSON.stringify({ scope: "church_push", result: "cron_error" }));
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
