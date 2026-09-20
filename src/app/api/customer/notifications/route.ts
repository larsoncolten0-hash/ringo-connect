import { NextResponse } from "next/server";
import { getCustomerFromCookie } from "@/lib/customer/session";
import { countUnread, listInbox } from "@/lib/customer/inbox";

// The signed-in customer's own notification inbox (the My Ringo bell). The customer comes only
// from the session cookie; nothing in the request selects whose notifications are returned.
// `?count=1` returns just the unread number (cheap enough to poll); otherwise the latest items
// plus the unread number.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const noStore = { headers: { "Cache-Control": "no-store" } };
  const session = await getCustomerFromCookie();
  if (!session) return NextResponse.json({ error: "not_authenticated" }, { status: 401, ...noStore });

  const unread = await countUnread(session.customer.id);
  if (new URL(request.url).searchParams.get("count") === "1") return NextResponse.json({ unread }, noStore);

  const items = await listInbox(session.customer.id);
  return NextResponse.json({ unread, items }, noStore);
}
