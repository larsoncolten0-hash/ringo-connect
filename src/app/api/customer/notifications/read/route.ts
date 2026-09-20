import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getCustomerFromCookie, isSameOrigin } from "@/lib/customer/session";
import { countUnread } from "@/lib/customer/inbox";
import { isUuid } from "@/lib/customer/connect";

// Mark the signed-in customer's notifications as read: `{ all: true }` or `{ ids: [...] }`.
// Every update is scoped to the session customer, so an id belonging to someone else is a no-op.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request." }, { status: 403 });

  const session = await getCustomerFromCookie();
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const now = new Date().toISOString();
  let query = createAdminClient()
    .from("customer_notifications")
    .update({ read_at: now })
    .eq("customer_id", session.customer.id)
    .is("read_at", null);

  if (body?.all === true) {
    // every unread row
  } else if (Array.isArray(body?.ids) && body.ids.length > 0 && body.ids.length <= 100 && body.ids.every(isUuid)) {
    query = query.in("id", body.ids);
  } else {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { error } = await query;
  if (error) {
    console.error("customer notifications mark-read failed:", error.message);
    return NextResponse.json({ error: "Could not update notifications." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, unread: await countUnread(session.customer.id) });
}
