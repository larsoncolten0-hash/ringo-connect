import { createClient } from "@/lib/supabase/server";
import { countConnectionsSince } from "@/lib/ai/context/scopedCounts";
import { NO_INPUT_SCHEMA, parseNoInput, type AiTool } from "../types";

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

export const getMyConnectSummary: AiTool = {
  name: "get_my_connect_summary",
  description:
    "Summarize the user's own audience: active connections (total, new in 7 and 30 days), active community members, and announcements sent in the last 90 days with their channels and delivery counts. Counts only — never names, emails or phone numbers.",
  kind: "read",
  permission: "customers.view",
  inputSchema: NO_INPUT_SCHEMA,
  parseInput: parseNoInput,
  async run({ workspace, snapshot }) {
    const [new7, new30, announcementsRes] = await Promise.all([
      countConnectionsSince(workspace.profileId, daysAgo(7)),
      countConnectionsSince(workspace.profileId, daysAgo(30)),
      createClient()
        .from("community_announcements")
        .select("status, channels, sent_count, recipient_count, sent_at, created_at")
        .eq("profile_id", workspace.profileId)
        .gte("created_at", daysAgo(90))
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (announcementsRes.error) throw new Error(announcementsRes.error.message);

    const announcements = announcementsRes.data || [];
    const sent = announcements.filter((a: any) => !!a.sent_at);
    return {
      active_connections: snapshot.counts.activeConnections,
      new_connections_7_days: new7,
      new_connections_30_days: new30,
      active_community_members: snapshot.counts.activeCommunitySubscribers,
      announcements_last_90_days: {
        created: announcements.length,
        sent: sent.length,
        last_sent_at: sent[0]?.sent_at ? String(sent[0].sent_at).slice(0, 10) : null,
        recent: sent.slice(0, 5).map((a: any) => ({
          sent_at: String(a.sent_at).slice(0, 10),
          channels: Array.isArray(a.channels) ? a.channels : null,
          recipients: a.recipient_count ?? null,
          delivered: a.sent_count ?? null,
        })),
      },
    };
  },
};
