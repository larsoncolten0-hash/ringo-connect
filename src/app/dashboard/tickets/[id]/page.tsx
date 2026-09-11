import { notFound } from "next/navigation";
import { requireTicketingProfile } from "@/lib/ticketingAuth";
import EventCheckinDashboard from "@/components/music/EventCheckinDashboard";

export const dynamic = "force-dynamic";

// One event's full management surface — basics, ticket types, Gate
// Access, and Check-in all together (see EventCheckinDashboard.tsx),
// reached from the Tickets section's own events list
// (/dashboard/tickets). Replaces the old EventRow-in-the-main-editor +
// /dashboard/music/events/[id] split with a single dedicated page, the
// same way a booking's own page isn't nested inside the profile editor
// either.
export default async function TicketEventPage({ params }: { params: { id: string } }) {
  const { supabase, profile } = await requireTicketingProfile();

  const { data: event } = await supabase
    .from("events")
    .select("*, event_ticket_types(*)")
    .eq("id", params.id)
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (!event) return notFound();

  const { data: scannerSessions } = await supabase
    .from("scanner_sessions")
    .select("*")
    .eq("event_id", event.id)
    .order("created_at", { ascending: false });

  const { data: digitalTickets } = await supabase
    .from("digital_tickets")
    .select("id, ticket_type_id, status, entry_state")
    .eq("event_id", event.id);

  const { data: checkinLogs } = await supabase
    .from("ticket_checkin_logs")
    .select("id, scanner_session_id, gate_name, ticket_type_name, ticket_holder_name, direction, result, created_at")
    .eq("event_id", event.id)
    .order("created_at", { ascending: false })
    .limit(5000);

  return (
    <EventCheckinDashboard
      event={event}
      userId={profile.user_id}
      ticketTypes={(event.event_ticket_types || []).sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))}
      initialScannerSessions={scannerSessions || []}
      digitalTickets={digitalTickets || []}
      checkinLogs={checkinLogs || []}
      currency={profile.currency || "USD"}
    />
  );
}
