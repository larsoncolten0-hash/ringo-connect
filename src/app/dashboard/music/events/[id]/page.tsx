import { notFound } from "next/navigation";
import { requireMusicProfile } from "@/lib/musicAuth";
import EventCheckinDashboard from "@/components/music/EventCheckinDashboard";

export const dynamic = "force-dynamic";

// Gate Access + Check-in — the organizer-facing half of the scanner
// system (see supabase/migrations/2026-09-22_event_scanner_checkin.sql
// and src/app/scanner/[token]/page.tsx for the security-staff-facing
// half, which this page never links to anyone but the organizer
// themselves — a scanner link is only ever generated and shown here,
// inside the authenticated dashboard).
export default async function EventCheckinPage({ params }: { params: { id: string } }) {
  const { supabase, profile } = await requireMusicProfile();

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

  // Every digital ticket for this event — just enough columns to compute
  // sold/checked-in/inside/outside totals per ticket type, client-side
  // (see EventCheckinDashboard), same "fetch flat, reduce in the
  // component" style MusicSalesView already uses for its own analytics.
  const { data: digitalTickets } = await supabase
    .from("digital_tickets")
    .select("id, ticket_type_id, status, entry_state")
    .eq("event_id", event.id);

  // Recent check-in activity + the source data for each gate's own
  // running total (see EventCheckinDashboard's own comment on why this
  // aggregates client-side rather than through a second query) — capped
  // so one enormous event can't make this page arbitrarily heavy.
  const { data: checkinLogs } = await supabase
    .from("ticket_checkin_logs")
    .select("id, scanner_session_id, gate_name, ticket_type_name, ticket_holder_name, direction, result, created_at")
    .eq("event_id", event.id)
    .order("created_at", { ascending: false })
    .limit(5000);

  return (
    <EventCheckinDashboard
      event={event}
      ticketTypes={(event.event_ticket_types || []).sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0))}
      initialScannerSessions={scannerSessions || []}
      digitalTickets={digitalTickets || []}
      checkinLogs={checkinLogs || []}
      currency={profile.currency || "USD"}
    />
  );
}
