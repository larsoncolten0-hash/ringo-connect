import { resolveBusinessPeriod, BUSINESS_PERIODS, type BusinessPeriodKind } from "@/lib/ai/business/period";
import { createClient } from "@/lib/supabase/server";
import type { AiTool } from "../types";

// Read-only restaurant order PAYMENT view (Ringo AI x Business Toolkit, restaurant phase). Restaurant `orders` stay the single source of truth for restaurant
// revenue; this tool never writes and nothing here is copied into the books. It separates gross order sales (every non-cancelled, non-refunded order, like
// get_my_restaurant_sales) from the orders marked paid and the ones still unpaid. `payment_status` is DECLARED by the restaurant (a cash or pay-later order is
// marked paid by hand), it is not confirmed by a payment provider, and the tool says so. Days are Africa/Douala business days (fixed UTC+1, no daylight saving),
// unlike get_my_restaurant_sales which uses UTC days. No customer name, phone, email or order id is ever selected.
const MAX_ORDERS = 5000;
const EXCLUDED = new Set(["cancelled", "refunded"]);
const PERIODS = BUSINESS_PERIODS.filter((p) => p !== "custom");
const DOUALA = "+01:00";

export const getMyRestaurantPayments: AiTool<{ period: BusinessPeriodKind }> = {
  name: "get_my_restaurant_payments",
  description:
    "Restaurant order payments for a period (Africa/Douala days): gross order sales (cancelled/refunded excluded), how much of it is on orders marked paid and how much on orders still unpaid, with order counts. Payment status is declared by the restaurant, not confirmed by a payment provider. Restaurant orders are the source of truth for restaurant revenue; none of this is bookkeeping. Aggregates only.",
  kind: "read",
  permission: "sales.view",
  available: (s) => s.isRestaurant,
  inputSchema: {
    type: "object",
    properties: { period: { type: "string", enum: [...PERIODS], description: "today | yesterday | this_week | this_month | previous_month (Douala days)." } },
    required: ["period"],
    additionalProperties: false,
  },
  parseInput: (raw) => {
    const r = raw as { period?: unknown } | null;
    return r && typeof r.period === "string" && (PERIODS as readonly string[]).includes(r.period) ? { period: r.period as BusinessPeriodKind } : null;
  },
  async run({ workspace, snapshot, now }, { period }) {
    const p = resolveBusinessPeriod(period, now);
    if (!p.ok) return { error: p.error };
    const start = new Date(`${p.from}T00:00:00${DOUALA}`);
    const end = new Date(new Date(`${p.to}T00:00:00${DOUALA}`).getTime() + 86_400_000);
    const { data, error } = await createClient()
      .from("orders")
      .select("status, payment_status, total")
      .eq("profile_id", workspace.profileId)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .limit(MAX_ORDERS + 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    const truncated = rows.length > MAX_ORDERS;
    const orders = rows.slice(0, MAX_ORDERS);
    const live = orders.filter((o: any) => !EXCLUDED.has(o.status));
    const sum = (list: any[]) => list.reduce((t, o) => t + (Number(o.total) || 0), 0);
    const paid = live.filter((o: any) => o.payment_status === "paid");
    const unpaid = live.filter((o: any) => o.payment_status !== "paid");
    return {
      period,
      period_label: p.label,
      from: p.from,
      to: p.to,
      currency: snapshot.profile.currency,
      gross_order_sales: sum(live),
      order_count: live.length,
      marked_paid: { orders: paid.length, amount: sum(paid) },
      not_yet_paid: { orders: unpaid.length, amount: sum(unpaid) },
      cancelled_or_refunded_orders: orders.length - live.length,
      truncated,
      note: "Gross order sales exclude cancelled and refunded orders. 'Marked paid' is the restaurant's own declaration, not a provider-confirmed payment. These are restaurant orders, not bookkeeping revenue: never add them to Business Toolkit figures.",
    };
  },
};
