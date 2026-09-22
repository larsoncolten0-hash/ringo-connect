import type { DiagnosticCheck } from "./types";

// Every check below mirrors a rule that is ENFORCED somewhere in the
// existing app (named in `rule`). Deliberately absent:
//   * "community not enabled" — profiles.community_enabled is no longer
//     consulted; Community is always on (src/lib/community/enabled.ts).
//   * "plan lacks commerce/bookings" — plans.commerce_enabled and
//     plans.bookings_feature_enabled are stored but not enforced by any
//     route today, so claiming they block anything would be false.

const DAY_MS = 24 * 60 * 60 * 1000;

export const DIAGNOSTIC_CHECKS: DiagnosticCheck[] = [
  {
    id: "profile_unpublished",
    knowledge: "profiles",
    rule: "profiles.published=false hides the public page; /api/orders, /api/music/orders, bookings and Connect all require a published profile. There is no dashboard toggle for it — the Ringo team controls it.",
    evaluate: (s) => (s.profile.published ? null : { severity: "problem", facts: { published: false }, fixPath: null }),
  },
  {
    id: "profile_missing_information",
    knowledge: "profiles",
    rule: "Same items as the dashboard's 'Complete your profile' card (ProfileCompletionCard.tsx).",
    evaluate: (s) => {
      const missing: string[] = [];
      if (!s.profile.hasAvatar) missing.push("profile_photo");
      if (!s.profile.hasBio) missing.push("bio");
      if (!s.profile.category) missing.push("category");
      if (!s.profile.hasWhatsapp && s.counts.socialLinks === 0 && !s.profile.hasAboutEmail) missing.push("contact_method");
      if (s.counts.links === 0) missing.push("links");
      if (missing.length === 0) return null;
      return { severity: "warning", facts: { missing: missing.join(", ") }, fixPath: "/dashboard" };
    },
  },
  {
    id: "no_whatsapp",
    knowledge: "profiles",
    rule: "The WhatsApp chat button on the public page needs profiles.whatsapp_number.",
    evaluate: (s) => (s.profile.hasWhatsapp ? null : { severity: "tip", facts: { whatsapp_number_set: false }, fixPath: "/dashboard?section=whatsapp" }),
  },
  {
    id: "link_limit_reached",
    knowledge: "plans",
    rule: "LinksCard blocks adding links beyond plans.max_links.",
    evaluate: (s) =>
      s.plan.maxLinks !== null && s.counts.links >= s.plan.maxLinks
        ? { severity: "warning", facts: { links: s.counts.links, plan_max_links: s.plan.maxLinks, plan: s.plan.displayName }, fixPath: "/dashboard/subscription" }
        : null,
  },
  {
    id: "product_limit_reached",
    knowledge: "plans",
    rule: "CatalogCard blocks adding products beyond plans.max_products (0 = catalog locked).",
    evaluate: (s) =>
      s.plan.maxProducts !== null && s.counts.products >= s.plan.maxProducts
        ? { severity: "warning", facts: { products: s.counts.products, plan_max_products: s.plan.maxProducts, plan: s.plan.displayName }, fixPath: "/dashboard/subscription" }
        : null,
  },
  {
    id: "product_catalog_empty",
    knowledge: "catalog",
    rule: "Business & E-commerce pages sell through the catalog; an empty catalog shows nothing to buy.",
    evaluate: (s) =>
      (s.profile.category === "business_ecommerce" || s.profile.categories.includes("business_ecommerce")) && s.counts.products === 0
        ? { severity: "warning", facts: { products: 0 }, fixPath: "/dashboard?section=catalog" }
        : null,
  },
  {
    id: "restaurant_ordering_disabled",
    knowledge: "restaurant",
    rule: "/api/orders rejects every order when profiles.ordering_enabled = false.",
    evaluate: (s) =>
      s.restaurant && !s.restaurant.orderingEnabled
        ? { severity: "problem", facts: { ordering_enabled: false }, fixPath: "/dashboard?section=restaurant-settings" }
        : null,
  },
  {
    id: "restaurant_no_order_types",
    knowledge: "restaurant",
    rule: "/api/orders rejects an order whose type (dine_in/takeaway/delivery) is switched off.",
    evaluate: (s) =>
      s.restaurant && s.restaurant.orderingEnabled && !s.restaurant.dineInEnabled && !s.restaurant.takeawayEnabled && !s.restaurant.deliveryEnabled
        ? { severity: "problem", facts: { dine_in: false, takeaway: false, delivery: false }, fixPath: "/dashboard?section=restaurant-settings" }
        : null,
  },
  {
    id: "restaurant_has_no_menu",
    knowledge: "restaurant",
    rule: "Orders are built only from this profile's menu_items.",
    evaluate: (s) => (s.isRestaurant && s.counts.menuItems === 0 ? { severity: "problem", facts: { menu_items: 0 }, fixPath: "/dashboard?section=menu" } : null),
  },
  {
    id: "restaurant_no_available_items",
    knowledge: "restaurant",
    rule: "Menu items with available=false can't be ordered (MenuItemDetailView.tsx).",
    evaluate: (s) =>
      s.isRestaurant && s.counts.menuItems > 0 && s.counts.availableMenuItems === 0
        ? { severity: "problem", facts: { menu_items: s.counts.menuItems, available_menu_items: 0 }, fixPath: "/dashboard?section=menu" }
        : null,
  },
  {
    id: "music_no_tracks",
    knowledge: "music",
    rule: "The Latest Music section and Music store list tracks and releases.",
    evaluate: (s) =>
      s.isMusic && s.counts.tracks === 0 && s.counts.releases === 0 ? { severity: "tip", facts: { tracks: 0, releases: 0 }, fixPath: "/dashboard?section=tracks" } : null,
  },
  {
    id: "tracks_without_price",
    knowledge: "music",
    rule: "MusicStorePage.tsx only sells a standalone track when it has a price (and available !== false).",
    evaluate: (s) =>
      s.isMusic && s.counts.unpricedStandaloneTracks > 0
        ? { severity: "warning", facts: { tracks_without_price: s.counts.unpricedStandaloneTracks, sellable_tracks: s.counts.sellableStandaloneTracks }, fixPath: "/dashboard?section=tracks" }
        : null,
  },
  {
    id: "music_store_not_configured",
    knowledge: "music",
    rule: "/api/music/orders only accepts checkout when profiles.currency = XAF (Mobile Money via Fapshi is the only payment method); currency is chosen in the Catalog section.",
    evaluate: (s) =>
      s.isMusic && s.profile.currency !== "XAF" && (s.counts.sellableStandaloneTracks > 0 || s.counts.releases > 0 || s.counts.upcomingPublishedEvents > 0)
        ? { severity: "problem", facts: { store_currency: s.profile.currency, required_currency: "XAF" }, fixPath: "/dashboard?section=catalog" }
        : null,
  },
  {
    id: "event_missing_ticket_type",
    knowledge: "events",
    rule: "An event is only buyable online with an active ticket type (event_ticket_types) or a legacy single price (events.price).",
    evaluate: (s) =>
      s.hasTicketing && s.counts.upcomingEventsWithoutTicketing > 0
        ? { severity: "warning", facts: { upcoming_events_without_ticketing: s.counts.upcomingEventsWithoutTicketing }, fixPath: "/dashboard/tickets" }
        : null,
  },
  {
    id: "no_upcoming_events",
    knowledge: "events",
    rule: "Events whose date has passed no longer sell tickets.",
    evaluate: (s) =>
      s.hasTicketing && s.counts.events > 0 && s.counts.upcomingPublishedEvents === 0
        ? { severity: "tip", facts: { events: s.counts.events, upcoming_published_events: 0 }, fixPath: "/dashboard/tickets" }
        : null,
  },
  {
    id: "booking_not_configured",
    knowledge: "bookings",
    rule: "/api/bookings rejects requests unless profiles.bookings_enabled = true; services (booking_services) are optional.",
    evaluate: (s) => {
      if (!s.profile.bookingsEnabled && s.counts.bookingServices > 0) {
        return { severity: "warning", facts: { bookings_enabled: false, booking_services: s.counts.bookingServices }, fixPath: "/dashboard/bookings/settings" };
      }
      if (s.profile.bookingsEnabled && s.counts.bookingServices === 0) {
        return { severity: "tip", facts: { bookings_enabled: true, booking_services: 0 }, fixPath: "/dashboard/bookings/settings" };
      }
      return null;
    },
  },
  {
    id: "no_connections_yet",
    knowledge: "connect",
    rule: "Visitors connect from the public page's Connect button (customer_connections).",
    evaluate: (s) =>
      s.profile.published && s.counts.activeConnections === 0 ? { severity: "tip", facts: { active_connections: 0 }, fixPath: "/dashboard/qr-code" } : null,
  },
  {
    id: "loyalty_not_set_up",
    knowledge: "loyalty",
    rule: "Loyalty is recommended for this category (src/lib/loyalty/categories.ts) and has no active program.",
    evaluate: (s) =>
      s.loyaltyAvailability === "recommended" && s.counts.activeLoyaltyPrograms === 0
        ? { severity: "tip", facts: { active_loyalty_programs: 0 }, fixPath: "/dashboard/loyalty/setup" }
        : null,
  },
  {
    id: "plan_expiring",
    knowledge: "plans",
    rule: "Paid plans carry users.plan_expires_at; the renewal banner and downgrade cron act on it.",
    evaluate: (s) => {
      if (!s.plan.expiresAt || s.plan.name === "free") return null;
      const ms = new Date(s.plan.expiresAt).getTime() - Date.now();
      if (Number.isNaN(ms) || ms > 7 * DAY_MS) return null;
      return {
        severity: ms < 0 ? "problem" : "warning",
        facts: { plan: s.plan.displayName, expires_at: s.plan.expiresAt.slice(0, 10), already_expired: ms < 0 },
        fixPath: "/dashboard/subscription",
      };
    },
  },
];
