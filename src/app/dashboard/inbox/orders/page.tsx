import { redirect } from "next/navigation";
import OrdersView, { type CardOrderRow } from "@/components/inbox/OrdersView";
import { resolveInboxActor } from "@/lib/inbox/actor";

export const dynamic = "force-dynamic";

// Paid card orders from the WhatsApp sales bot. The organization comes from the session / the database (the owner, or a team member the database admitted for the Inbox), never from the URL
// or the browser. The list is read through the user's own session, so row-level security applies on top of the profile filter: the owner and team members with inbox.view see it, nobody else.
// Marking an order completed needs the owner or inbox.reply; the page only shows the button to those who have it (the route and the database check again).
export default async function CardOrdersPage() {
  const access = await resolveInboxActor();
  if (!access.ok) redirect("/dashboard");
  const { actor } = access;
  const canAct = actor.kind === "owner" || actor.permissions.includes("inbox.reply");

  let rows: CardOrderRow[] = [];
  let loadFailed = false;
  try {
    const { data, error } = await actor.supabase
      .from("card_orders")
      .select("id, customer_name, customer_phone, card_tier, amount_xaf, delivery_place, status, customer_notify_status, created_at, completed_at")
      .eq("profile_id", actor.profileId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error || !Array.isArray(data)) loadFailed = true;
    else rows = data as unknown as CardOrderRow[];
  } catch {
    loadFailed = true;
  }
  return <OrdersView rows={rows} canAct={canAct} loadFailed={loadFailed} />;
}
