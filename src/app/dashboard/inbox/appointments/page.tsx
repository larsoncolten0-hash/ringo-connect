import { redirect } from "next/navigation";
import AppointmentsView, { type AppointmentRow } from "@/components/inbox/AppointmentsView";
import { resolveInboxActor } from "@/lib/inbox/actor";

export const dynamic = "force-dynamic";

// Meeting requests from the WhatsApp sales bot. The organization comes from the session / the database (the owner, or a team member the database admitted for the Inbox), never from the URL
// or the browser. The list is read through the user's own session, so row-level security applies on top of the profile filter: the owner and team members with inbox.view see it, nobody else.
// Confirming, declining and cancelling need the owner or inbox.reply; the page only shows the buttons to those who have it (the route and the database check again).
export default async function AppointmentsPage() {
  const access = await resolveInboxActor();
  if (!access.ok) redirect("/dashboard");
  const { actor } = access;
  const canAct = actor.kind === "owner" || actor.permissions.includes("inbox.reply");

  let rows: AppointmentRow[] = [];
  let loadFailed = false;
  try {
    const { data, error } = await actor.supabase
      .from("card_appointments")
      .select("id, customer_name, customer_phone, preferred_time, meeting_place, note, status, decision_details, customer_notify_status, created_at, decided_at")
      .eq("profile_id", actor.profileId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error || !Array.isArray(data)) {
      loadFailed = true;
    } else {
      const ids = data.map((r: any) => String(r.id));
      const last = new Map<string, "owner" | "staff" | "customer">();
      if (ids.length > 0) {
        const events = await actor.supabase.from("card_appointment_events").select("appointment_id, actor_kind, created_at").in("appointment_id", ids).order("created_at", { ascending: true });
        if (!events.error && Array.isArray(events.data)) for (const e of events.data as any[]) last.set(String(e.appointment_id), e.actor_kind);
      }
      rows = data.map((r: any) => ({ ...r, lastActor: last.get(String(r.id)) ?? null })) as AppointmentRow[];
    }
  } catch {
    loadFailed = true;
  }
  return <AppointmentsView rows={rows} canAct={canAct} loadFailed={loadFailed} />;
}
