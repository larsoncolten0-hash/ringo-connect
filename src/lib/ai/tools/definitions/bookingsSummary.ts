import { createClient } from "@/lib/supabase/server";
import { NO_INPUT_SCHEMA, clipText, parseNoInput, type AiTool } from "../types";

export const getMyBookingsSummary: AiTool = {
  name: "get_my_bookings_summary",
  description:
    "Summarize the user's own bookings: whether bookings are on, the services offered, and booking requests over the last 90 days by status (counts only, no customer details).",
  kind: "read",
  permission: "bookings.view",
  inputSchema: NO_INPUT_SCHEMA,
  parseInput: parseNoInput,
  async run({ workspace, snapshot }) {
    const db = createClient();
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const [servicesRes, bookingsRes] = await Promise.all([
      db.from("booking_services").select("name").eq("profile_id", workspace.profileId).order("sort_order", { ascending: true }).limit(20),
      db.from("bookings").select("status").eq("profile_id", workspace.profileId).gte("created_at", since).limit(5000),
    ]);
    if (servicesRes.error || bookingsRes.error) throw new Error("bookings summary query failed");

    const byStatus: Record<string, number> = {};
    for (const b of bookingsRes.data || []) byStatus[b.status] = (byStatus[b.status] || 0) + 1;

    return {
      bookings_enabled: snapshot.profile.bookingsEnabled,
      services: (servicesRes.data || []).map((s: any) => clipText(s.name, 50)),
      last_90_days: { requests: (bookingsRes.data || []).length, by_status: byStatus },
      pending_needs_reply: byStatus.pending || 0,
    };
  },
};
