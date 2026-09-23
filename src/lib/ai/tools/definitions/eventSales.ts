import { createClient } from "@/lib/supabase/server";
import { BI_PERIODS, bucketByUtcDay, clampLimit, isBiPeriod, resolvePeriod, type BiPeriod, type DailyBucket } from "../period";
import { clipText, type AiTool } from "../types";

// Read-only business intelligence for ticket sales (Phase 4 increment 4).
// Tickets are purchased through the same music_orders/music_order_items
// tables music commerce uses (item_type = 'ticket'), but ticketing is
// available to `events_experiences` pages too — pages that aren't music
// pages at all — so this is gated on hasTicketing, independently of
// get_my_music_sales (gated on isMusic). Ticket revenue is ALWAYS computed
// from the line item's price_snapshot at purchase time, never
// event_ticket_types.sold_quantity * current price — a tier's price can
// change after tickets were already sold, which would misstate revenue.
// No ticket-buyer name/email/phone/id is ever selected.

const MAX_ORDERS = 5000;

export const getMyEventSales: AiTool<{ period: BiPeriod; limit: number }> = {
  name: "get_my_event_sales",
  description:
    "Get verified ticket sales for a period: tickets sold, ticket revenue, a daily trend, and the top-selling events by revenue. Only counts paid, non-cancelled/refunded ticket purchases, using the price actually paid at purchase time (never a ticket type's current price, which may have changed since). Aggregates only — no ticket-buyer names, emails, phone numbers or individual purchases.",
  kind: "read",
  permission: "tickets.view",
  available: (s) => s.hasTicketing,
  inputSchema: {
    type: "object",
    properties: {
      period: { type: "string", enum: [...BI_PERIODS], description: "today | yesterday | 7d | 30d | this_month | previous_month." },
      limit: { type: "number", description: "How many top events to return (1-10). Server clamps this regardless of what's asked." },
    },
    required: ["period", "limit"],
    additionalProperties: false,
  },
  parseInput: (raw) => {
    const r = raw as { period?: unknown; limit?: unknown } | null;
    if (!r || !isBiPeriod(r.period)) return null;
    return { period: r.period, limit: clampLimit(r.limit) };
  },
  async run({ workspace, snapshot }, { period, limit }) {
    const range = resolvePeriod(period);
    const db = createClient();
    const { data: orderRows, error } = await db
      .from("music_orders")
      .select("id, payment_status, status, created_at")
      .eq("profile_id", workspace.profileId)
      .gte("created_at", range.start.toISOString())
      .lt("created_at", range.end.toISOString())
      .limit(MAX_ORDERS);
    if (error) throw new Error(error.message);

    const eligibleIds = (orderRows || [])
      .filter((o: any) => o.payment_status === "paid" && o.status !== "cancelled" && o.status !== "refunded")
      .map((o: any) => o.id);

    let ticketRevenue = 0;
    let ticketsSold = 0;
    let trend: DailyBucket[] = [];
    let topEvents: { event_title: string | null; revenue: number; tickets: number }[] = [];

    if (eligibleIds.length > 0) {
      const { data: items, error: itemsError } = await db
        .from("music_order_items")
        .select("event_id, name_snapshot, quantity, line_total, created_at")
        .eq("item_type", "ticket")
        .in("order_id", eligibleIds)
        .limit(MAX_ORDERS * 5);
      if (itemsError) throw new Error(itemsError.message);

      const rows = items || [];
      ticketRevenue = rows.reduce((sum: number, it: any) => sum + (Number(it.line_total) || 0), 0);
      ticketsSold = rows.reduce((sum: number, it: any) => sum + (it.quantity || 0), 0);
      trend = bucketByUtcDay(
        rows as any[],
        (it) => it.created_at,
        (it) => ({ revenue: Number(it.line_total) || 0, tickets: it.quantity || 0 })
      );

      const byEvent = new Map<string, { revenue: number; tickets: number }>();
      for (const it of rows as any[]) {
        const key = it.event_id || "unknown";
        const cur = byEvent.get(key) || { revenue: 0, tickets: 0 };
        cur.revenue += Number(it.line_total) || 0;
        cur.tickets += it.quantity || 0;
        byEvent.set(key, cur);
      }
      const ranked = Array.from(byEvent.entries())
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, limit);

      const eventIds = ranked.map(([id]) => id).filter((id) => id !== "unknown");
      let titles = new Map<string, string>();
      if (eventIds.length > 0) {
        const { data: eventRows } = await db.from("events").select("id, title").eq("profile_id", workspace.profileId).in("id", eventIds);
        for (const e of eventRows || []) titles.set(e.id, clipText(e.title, 70) || "Untitled event");
      }
      topEvents = ranked.map(([id, v]) => ({ event_title: titles.get(id) ?? null, revenue: v.revenue, tickets: v.tickets }));
    }

    return {
      period,
      period_label: range.label,
      period_start: range.start.toISOString().slice(0, 10),
      period_end: new Date(range.end.getTime() - 1).toISOString().slice(0, 10),
      currency: snapshot.profile.currency,
      ticket_revenue: ticketRevenue,
      tickets_sold: ticketsSold,
      note: "Only paid, non-cancelled/refunded ticket purchases, at the price actually paid — never a ticket type's current price.",
      trend,
      top_events: topEvents,
    };
  },
};
