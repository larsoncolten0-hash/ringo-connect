import { createAdminClient } from "@/lib/supabase/server";
import type { KnowledgeModule } from "../types";

// Plan names, limits, prices and feature lists change from /admin/plans, so
// they are NEVER written into this module's body — `live` reads the plans
// table at lookup time.
async function renderLivePlans(): Promise<string> {
  const { data, error } = await createAdminClient()
    .from("plans")
    .select(
      "name, display_name, max_links, max_products, pixels_enabled, custom_theme_enabled, full_analytics_enabled, badge_removed, team_enabled, max_team_seats, association_enabled, price_xaf, price_usd, price_xaf_yearly, features_en"
    )
    .order("price_xaf", { ascending: true });
  if (error || !data) return "Live plan details could not be loaded right now — send the user to Dashboard → Subscription.";

  const lim = (v: number | null) => (v === null ? "unlimited" : String(v));
  return data
    .filter((p: any) => p.association_enabled !== true)
    .map((p: any) => {
      const flags = [
        p.custom_theme_enabled ? "custom theme" : null,
        p.pixels_enabled ? "tracking pixels" : null,
        p.full_analytics_enabled ? "full analytics history" : "basic analytics totals",
        p.badge_removed ? "no Ringo badge" : null,
        p.team_enabled ? `Team (${lim(p.max_team_seats)} staff seats)` : null,
      ]
        .filter(Boolean)
        .join(", ");
      const price = Number(p.price_xaf) > 0 ? `${p.price_xaf} XAF/month${p.price_xaf_yearly ? ` or ${p.price_xaf_yearly} XAF/year` : ""}` : "free";
      const features = Array.isArray(p.features_en) && p.features_en.length ? ` Listed features: ${p.features_en.join("; ")}.` : "";
      return `- ${p.display_name || p.name} (${price}): links ${lim(p.max_links)}, catalog products ${lim(p.max_products)}; ${flags}.${features}`;
    })
    .join("\n");
}

export const plansModule: KnowledgeModule = {
  id: "plans",
  version: 1,
  title: "Plans, limits and upgrading",
  summary: "Current plans with live limits/prices, what each unlocks, upgrading and renewal.",
  appliesTo: {},
  body: `
Plans are managed at Dashboard → Subscription (/dashboard/subscription). Upgrades are paid online (Mobile Money via Fapshi, or card via Stripe, depending on what Ringo currently has enabled). Paid plans have an expiry date; the Dashboard shows a renewal banner before it, and an expired plan is downgraded after a grace period.

What plans control (enforced in the app): number of links, number of catalog products, custom theme, tracking pixels, full analytics history (Free shows totals), removing the Ringo badge, and Team & staff seats (Business plans only).
Do not tell a user a plan blocks restaurant ordering, music/ticket checkout or bookings — those are controlled by the owner's own settings, not by the plan, in the current app.

Live plan list (from the database):
`.trim(),
  related: ["profiles", "teams", "payments"],
  live: renderLivePlans,
};
