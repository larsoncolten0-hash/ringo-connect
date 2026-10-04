import { profileHasTicketing } from "@/lib/categories";
import { bookingsAllowed, categoryHasBooking, count, type Ctx } from "./criteria";
import type { HealthActivity, HealthItem, Recommendation } from "./types";

// ONE recommendation list for the whole product. A missing counted item becomes a "complete"
// recommendation; the optional improvements below become "grow" ones. Every condition is read from
// data the profile already has — a recommendation disappears the moment its condition is resolved,
// and nothing is suggested for a feature the profile cannot use.

/** Below this many total visits there is not yet anything meaningful to review. */
export const ANALYTICS_REVIEW_MIN_VIEWS = 25;

export function fromMissingItems(items: HealthItem[]): Recommendation[] {
  return items
    .filter((i) => !i.met)
    .map((i) => ({
      id: i.id,
      kind: "complete" as const,
      journey: i.stage,
      priority: i.priority,
      href: i.href,
      action: "link" as const,
      ...(i.catalogLabel ? { catalogLabel: i.catalogLabel } : {}),
    }));
}

const withoutImage = (rows: Array<Record<string, unknown> | null | undefined>) =>
  rows.filter((r) => !(typeof r?.image_url === "string" && r.image_url.trim())).length;

export function growthRecommendations(c: Ctx, activity?: HealthActivity | null): Recommendation[] {
  const out: Recommendation[] = [];
  const { p } = c;

  // Restaurant: photos help people choose what to order.
  if (c.isFood && withoutImage(c.rows.menuItems) > 0) {
    out.push({ id: "menuPhotos", kind: "grow", journey: "offer", priority: 40, href: "/dashboard?section=menu", action: "link" });
  }
  // Catalogue (only where the plan unlocks it): products without a picture.
  if (c.catalogAllowed && !c.isFood && withoutImage(c.rows.products) > 0) {
    out.push({
      id: "productPhotos",
      kind: "grow",
      journey: "offer",
      priority: 42,
      href: "/dashboard?section=catalog",
      action: "link",
      ...(c.catalogLabel ? { catalogLabel: c.catalogLabel } : {}),
    });
  }
  // Music: tracks exist but no release (EP / album) yet.
  if (c.isMusic && c.rows.tracks.length > 0 && c.rows.releases.length === 0) {
    out.push({ id: "addRelease", kind: "grow", journey: "offer", priority: 44, href: "/dashboard?section=releases", action: "link" });
  }
  // Bookings: a real feature for this category, allowed by the plan, and not switched on yet.
  if (categoryHasBooking(c) && bookingsAllowed(c.plan) && !p.bookings_enabled) {
    out.push({ id: "enableBooking", kind: "grow", journey: "connect", priority: 46, href: "/dashboard/bookings/settings", action: "link" });
  }
  // Ticketing categories with no event yet (events_experiences already counts this as a criterion).
  if (profileHasTicketing(p) && !c.isEventsCat && count(p.events) === 0) {
    out.push({ id: "addEvent", kind: "grow", journey: "offer", priority: 48, href: "/dashboard/tickets", action: "link" });
  }

  // Share: a live page is only useful once people open it. With zero known visits it jumps the polish queue.
  const total = activity?.totalPageViews;
  if (p.published !== false) {
    out.push({ id: "shareProfile", kind: "grow", journey: "share", priority: total === 0 ? 38 : 60, href: "/dashboard", action: "share" });
  }
  // Analytics: only suggested once there is real traffic to look at.
  if (typeof total === "number" && total >= ANALYTICS_REVIEW_MIN_VIEWS) {
    out.push({ id: "reviewAnalytics", kind: "grow", journey: "grow", priority: 80, href: "/dashboard/analytics", action: "link" });
  }
  return out;
}

export function sortRecommendations(recs: Recommendation[]): Recommendation[] {
  return [...recs].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}
