import { requireTicketingProfile } from "@/lib/ticketingAuth";
import TicketsEventsList from "@/components/dashboard/TicketsEventsList";

export const dynamic = "force-dynamic";

// The events list — create an event here, then configure everything about
// it (basics, ticket types, Gate Access, Check-in) on its own page at
// /dashboard/tickets/[id]. Mirrors EventsCard's old create/list role, now
// as this section's own top-level page instead of a card inside the main
// editor.
export default async function TicketsPage() {
  const { supabase, profile } = await requireTicketingProfile();

  const { data: events } = await supabase
    .from("events")
    .select("*, event_ticket_types(id, sold_quantity, total_quantity)")
    .eq("profile_id", profile.id)
    .order("sort_order");

  return <TicketsEventsList profileId={profile.id} initialEvents={events || []} />;
}
