import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getLoyaltyOptions, type LoyaltyAvailability } from "@/lib/loyalty/categories";
import { profileHasCategory, profileHasTicketing } from "@/lib/categories";
import type { AiWorkspace } from "@/lib/ai/types";
import { countActiveConnections, countActiveLoyaltyPrograms } from "./scopedCounts";

// The factual picture of ONE workspace that Ringo AI reasons over: loaded
// once per chat request, then shared by the context card, the diagnostics
// and the overview tools. Rules:
//   * every query is scoped by the SERVER-resolved workspace.profileId —
//     explicitly, not just via RLS (several tables are publicly readable,
//     and admin sessions bypass owner policies);
//   * allow-listed columns only, never select("*");
//   * counts and flags, not raw rows — user-written text (bio, names) is
//     reduced to "present / absent" here; the one free-text field kept
//     (display name, location) is marked as data when rendered.

export interface WorkspaceSnapshot {
  loadedAt: string;
  profile: {
    username: string;
    displayName: string | null;
    location: string | null;
    category: string | null;
    categories: string[];
    musicRole: string | null;
    restaurantSubcategory: string | null;
    published: boolean;
    verified: boolean;
    currency: string;
    hasAvatar: boolean;
    hasBio: boolean;
    hasCoverImage: boolean;
    hasLongDescription: boolean;
    hasWhatsapp: boolean;
    hasAboutEmail: boolean;
    hasAboutPhone: boolean;
    bookingsEnabled: boolean;
    createdAt: string | null;
  };
  isMusic: boolean;
  isRestaurant: boolean;
  hasTicketing: boolean;
  restaurant: { orderingEnabled: boolean; dineInEnabled: boolean; takeawayEnabled: boolean; deliveryEnabled: boolean } | null;
  /** Platform-wide switch (Admin Settings → Commerce/Shop) — not something this profile controls. */
  platformCommerceEnabled: boolean;
  /** Shop (Increment 5A+) applies to any non-music profile; null when not applicable. */
  shop: { ordersToFulfill: number | null } | null;
  plan: {
    name: string;
    displayName: string;
    maxLinks: number | null;
    maxProducts: number | null;
    pixelsEnabled: boolean;
    customThemeEnabled: boolean;
    fullAnalyticsEnabled: boolean;
    badgeRemoved: boolean;
    teamEnabled: boolean;
    maxTeamSeats: number | null;
    expiresAt: string | null;
  };
  onboardingCompleted: boolean;
  loyaltyAvailability: LoyaltyAvailability;
  counts: {
    links: number | null;
    socialLinks: number | null;
    products: number | null;
    tracks: number | null;
    sellableStandaloneTracks: number | null;
    unpricedStandaloneTracks: number | null;
    releases: number | null;
    events: number | null;
    upcomingPublishedEvents: number | null;
    upcomingEventsWithoutTicketing: number | null;
    menuCategories: number | null;
    menuItems: number | null;
    availableMenuItems: number | null;
    restaurantTables: number | null;
    bookingServices: number | null;
    activeConnections: number | null;
    activeCommunitySubscribers: number | null;
    activeLoyaltyPrograms: number | null;
  };
}

type Db = ReturnType<typeof createClient>;

// null (not 0) when the query fails, so "couldn't verify" is never reported as "none".
async function countRows(db: Db, table: string, profileId: string, extra?: (q: any) => any): Promise<number | null> {
  let q: any = db.from(table).select("id", { count: "exact", head: true }).eq("profile_id", profileId);
  if (extra) q = extra(q);
  const { count, error } = await q;
  if (error) {
    console.error(`ai snapshot count ${table} failed:`, error.message);
    return null;
  }
  return count || 0;
}

const clip = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function loadWorkspaceSnapshot(workspace: AiWorkspace): Promise<WorkspaceSnapshot> {
  const db = createClient();
  const pid = workspace.profileId;
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: p, error: profileError }, { data: u, error: userError }] = await Promise.all([
    db
      .from("profiles")
      .select(
        "username, name, bio, avatar_url, cover_image_url, about_long_bio, about_location, about_email, about_phone, whatsapp_number, category, categories, music_role, restaurant_subcategory, published, verified, currency, bookings_enabled, ordering_enabled, dine_in_enabled, takeaway_enabled, delivery_enabled, created_at"
      )
      .eq("id", pid)
      .maybeSingle(),
    db
      .from("users")
      .select(
        "plan_expires_at, onboarding_completed_at, plans(name, display_name, max_links, max_products, pixels_enabled, custom_theme_enabled, full_analytics_enabled, badge_removed, team_enabled, max_team_seats)"
      )
      .eq("id", workspace.userId)
      .maybeSingle(),
  ]);

  // The profile and plan are the base of every answer: if they can't be read,
  // fail the request instead of describing defaults ("published", "Free")
  // as if they were this user's real account.
  if (profileError || !p || userError) {
    throw new Error(`ai snapshot base query failed: ${profileError?.message || userError?.message || "profile not found"}`);
  }
  const profile = p as Record<string, any>;
  const planRow = ((u as any)?.plans || {}) as Record<string, any>;
  const categoryShape = { category: profile.category ?? null, categories: Array.isArray(profile.categories) ? profile.categories : [] };
  const isMusic = profileHasCategory(categoryShape, "music_entertainment");
  const isRestaurant = profileHasCategory(categoryShape, "restaurant_food");
  const hasTicketing = profileHasTicketing(categoryShape);

  const [
    links,
    socialLinks,
    products,
    releases,
    menuCategories,
    menuItems,
    availableMenuItems,
    restaurantTables,
    bookingServices,
    activeCommunitySubscribers,
    trackRows,
    eventRows,
    activeConnections,
    activeLoyaltyPrograms,
    shopOrdersToFulfill,
    platformCommerceEnabled,
  ] = await Promise.all([
    countRows(db, "links", pid),
    countRows(db, "social_links", pid),
    countRows(db, "products", pid),
    countRows(db, "music_releases", pid),
    countRows(db, "menu_categories", pid),
    countRows(db, "menu_items", pid),
    countRows(db, "menu_items", pid, (q) => q.eq("available", true)),
    countRows(db, "restaurant_tables", pid),
    countRows(db, "booking_services", pid),
    countRows(db, "community_subscribers", pid, (q) => q.eq("status", "active")),
    db.from("tracks").select("price, available, release_id").eq("profile_id", pid).limit(500),
    db.from("events").select("status, event_date, price, event_ticket_types(is_active)").eq("profile_id", pid).limit(300),
    countActiveConnections(pid),
    countActiveLoyaltyPrograms(pid),
    // Shop (Increment 5A+) applies to any non-music profile; skip the query for a music profile
    // rather than counting rows that could never exist for it.
    isMusic ? Promise.resolve(null) : countRows(db, "product_orders", pid, (q) => q.eq("status", "paid")),
    // Admin-only column (platform_settings has no authenticated-role RLS policy) — the same
    // service-role read every other Shop settings reader already uses for this table.
    createAdminClient()
      .from("platform_settings")
      .select("commerce_enabled")
      .limit(1)
      .maybeSingle()
      .then(({ data, error }: { data: any; error: any }) => {
        if (error) console.error("ai snapshot platform_settings failed:", error.message);
        return data?.commerce_enabled === true;
      }),
  ]);

  const tracksOk = !trackRows.error;
  const eventsOk = !eventRows.error;
  if (trackRows.error) console.error("ai snapshot tracks failed:", trackRows.error.message);
  if (eventRows.error) console.error("ai snapshot events failed:", eventRows.error.message);
  const tracks = (trackRows.data || []) as { price: number | string | null; available: boolean | null; release_id: string | null }[];
  // Mirrors the Music store's own rule (MusicStorePage.tsx): a standalone
  // track is purchasable when available !== false, not part of a release,
  // and has a truthy price.
  const standalone = tracks.filter((t) => t.available !== false && !t.release_id);
  const sellableStandaloneTracks = standalone.filter((t) => !!Number(t.price)).length;

  const events = (eventRows.data || []) as {
    status: string | null;
    event_date: string | null;
    price: number | string | null;
    event_ticket_types: { is_active: boolean | null }[] | null;
  }[];
  const upcomingPublished = events.filter((e) => (e.status ?? "published") === "published" && !!e.event_date && e.event_date >= today);
  const upcomingEventsWithoutTicketing = upcomingPublished.filter(
    (e) => !Number(e.price) && !(e.event_ticket_types || []).some((tt) => tt.is_active !== false)
  ).length;

  return {
    loadedAt: new Date().toISOString(),
    profile: {
      username: profile.username ?? workspace.username,
      displayName: clip(profile.name, 80),
      location: clip(profile.about_location, 80),
      category: profile.category ?? null,
      categories: categoryShape.categories,
      musicRole: profile.music_role ?? null,
      restaurantSubcategory: profile.restaurant_subcategory ?? null,
      published: profile.published !== false,
      verified: profile.verified === true,
      currency: profile.currency || "USD",
      hasAvatar: !!profile.avatar_url,
      hasBio: !!clip(profile.bio, 1),
      hasCoverImage: !!profile.cover_image_url,
      hasLongDescription: !!clip(profile.about_long_bio, 1),
      hasWhatsapp: !!clip(profile.whatsapp_number, 1),
      hasAboutEmail: !!clip(profile.about_email, 1),
      hasAboutPhone: !!clip(profile.about_phone, 1),
      bookingsEnabled: profile.bookings_enabled === true,
      createdAt: profile.created_at ?? null,
    },
    isMusic,
    isRestaurant,
    hasTicketing,
    restaurant: isRestaurant
      ? {
          orderingEnabled: profile.ordering_enabled !== false,
          dineInEnabled: profile.dine_in_enabled !== false,
          takeawayEnabled: profile.takeaway_enabled !== false,
          deliveryEnabled: profile.delivery_enabled === true,
        }
      : null,
    platformCommerceEnabled,
    shop: isMusic ? null : { ordersToFulfill: shopOrdersToFulfill },
    plan: {
      name: planRow.name ?? "free",
      displayName: planRow.display_name ?? planRow.name ?? "Free",
      maxLinks: planRow.max_links ?? null,
      maxProducts: planRow.max_products ?? null,
      pixelsEnabled: planRow.pixels_enabled === true,
      customThemeEnabled: planRow.custom_theme_enabled === true,
      fullAnalyticsEnabled: planRow.full_analytics_enabled === true,
      badgeRemoved: planRow.badge_removed === true,
      teamEnabled: planRow.team_enabled === true,
      maxTeamSeats: planRow.max_team_seats ?? null,
      expiresAt: (u as any)?.plan_expires_at ?? null,
    },
    onboardingCompleted: !!(u as any)?.onboarding_completed_at,
    loyaltyAvailability: getLoyaltyOptions(categoryShape).availability,
    counts: {
      links,
      socialLinks,
      products,
      tracks: tracksOk ? tracks.length : null,
      sellableStandaloneTracks: tracksOk ? sellableStandaloneTracks : null,
      unpricedStandaloneTracks: tracksOk ? standalone.length - sellableStandaloneTracks : null,
      releases,
      events: eventsOk ? events.length : null,
      upcomingPublishedEvents: eventsOk ? upcomingPublished.length : null,
      upcomingEventsWithoutTicketing: eventsOk ? upcomingEventsWithoutTicketing : null,
      menuCategories,
      menuItems,
      availableMenuItems,
      restaurantTables,
      bookingServices,
      activeConnections,
      activeCommunitySubscribers,
      activeLoyaltyPrograms,
    },
  };
}
