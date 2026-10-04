import { getCategory, getSubcategoryOption, profileHasCategory, type CategoryId } from "@/lib/categories";
import type { Bilingual, CategoryGroup, CriterionId, HealthInput, HealthItem, HealthPlan, HealthProfile, JourneyStage } from "./types";

// What "complete" means for a Ringo page, per kind of business. The rule is simple and strict:
// a criterion is only counted when the profile can actually use that feature TODAY (its category
// has it and its plan allows it). A locked or non-existent feature never counts against anyone —
// in particular a free plan with the catalogue locked (plans.max_products = 0) can still reach 100%.

const GROUP_BY_CATEGORY: Record<CategoryId, CategoryGroup> = {
  restaurant_food: "food",
  music_entertainment: "music",
  events_experiences: "events",
  creative_media: "creator",
  freelancers_creators: "creator",
  business_ecommerce: "shop",
  real_estate: "shop",
  agriculture_agribusiness: "shop",
  transport_logistics: "service",
  professional_services: "service",
  beauty_wellness: "service",
  health_medical: "service",
  education_training: "service",
  travel_hospitality: "service",
  construction_home_services: "service",
  other: "other",
};

// Categories whose customers expect to see opening hours.
const HOURS_CATEGORIES = new Set<string>(["beauty_wellness", "health_medical", "business_ecommerce", "professional_services", "education_training"]);

export function groupOf(category: string | null | undefined): CategoryGroup {
  return (category && GROUP_BY_CATEGORY[category as CategoryId]) || "other";
}

export const count = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
export const filled = (v: unknown): boolean => typeof v === "string" && v.trim().length > 0;

// "Add" in the editor inserts an EMPTY row straight away (links get url "https://", products/menu items
// a blank name, tracks/releases a blank title) so the user can fill it in. An empty placeholder is not
// content: only a row with something a visitor could actually see counts. Read-time only, nothing is
// deleted or changed.

/** A usable URL: more than just a scheme. "https://", "http://" and blanks are placeholders. */
export function hasUsableUrl(v: unknown): boolean {
  if (!filled(v)) return false;
  return (v as string).trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^\/+/, "").length > 0;
}

type Row = Record<string, unknown> | null | undefined;
const rowsWith = (rows: unknown, test: (r: Row) => boolean): Row[] => (Array.isArray(rows) ? (rows as Row[]).filter(test) : []);
const hasText = (key: string) => (r: Row) => filled(r?.[key]);

/** The rows of each user-added list that carry real content. */
export function meaningfulRows(p: HealthProfile) {
  return {
    links: rowsWith(p.links, (r) => hasUsableUrl(r?.url)),
    products: rowsWith(p.products, hasText("name")),
    menuItems: rowsWith(p.menu_items, hasText("name")),
    menuCategories: rowsWith(p.menu_categories, hasText("name")),
    tracks: rowsWith(p.tracks, hasText("title")),
    releases: rowsWith(p.music_releases, hasText("title")),
  };
}

/**
 * Items the owner has really added (products + menu items + tracks + releases with content, plus
 * events). Blank placeholder rows do not count. Feeds the "first item" milestone.
 */
export function countOffering(p: HealthProfile): number {
  const m = meaningfulRows(p);
  return m.products.length + m.menuItems.length + m.tracks.length + m.releases.length + count(p.events);
}

/** Restaurants store hours as { mon: { open, close, closed }, … } — "set" means at least one day was saved. */
function hasOpeningHours(v: unknown): boolean {
  return !!v && typeof v === "object" && Object.keys(v as object).length > 0;
}

export interface Ctx {
  p: HealthProfile;
  plan: HealthPlan | null;
  category: string | null;
  group: CategoryGroup;
  isFood: boolean;
  isMusic: boolean;
  isEventsCat: boolean;
  /** The catalogue is usable on this plan (max_products = 0 means locked). Unknown plan = usable. */
  catalogAllowed: boolean;
  linksAllowed: boolean;
  catalogLabel?: Bilingual;
  /** Rows that carry real content (see meaningfulRows). */
  rows: ReturnType<typeof meaningfulRows>;
}

export function buildContext(input: HealthInput): Ctx {
  const p = input.profile || {};
  const plan = input.plan ?? null;
  const category = p.category || null;
  return {
    p,
    plan,
    category,
    group: groupOf(category),
    isFood: profileHasCategory(p, "restaurant_food"),
    isMusic: profileHasCategory(p, "music_entertainment"),
    isEventsCat: profileHasCategory(p, "events_experiences"),
    catalogAllowed: plan?.max_products !== 0,
    linksAllowed: plan?.max_links !== 0,
    catalogLabel: getCategory(category)?.defaults.catalogLabel ?? undefined,
    rows: meaningfulRows(p),
  };
}

interface CriterionDef {
  id: CriterionId;
  stage: JourneyStage;
  priority: number;
  href: (c: Ctx) => string;
  applies: (c: Ctx) => boolean;
  met: (c: Ctx) => boolean;
}

const section = (id: string) => `/dashboard?section=${id}`;

// Lower priority number = asked about first. The few "offering" items (menu, music, products…)
// come right after the basics because they are what a visitor came for.
const CRITERIA: CriterionDef[] = [
  { id: "name", stage: "create", priority: 5, href: () => "/dashboard", applies: () => true, met: (c) => filled(c.p.name) },
  { id: "avatar", stage: "create", priority: 10, href: () => "/dashboard", applies: () => true, met: (c) => filled(c.p.avatar_url) },
  { id: "category", stage: "create", priority: 15, href: () => section("category"), applies: () => true, met: (c) => filled(c.p.category) },
  { id: "bio", stage: "create", priority: 20, href: () => "/dashboard", applies: () => true, met: (c) => filled(c.p.bio) },
  { id: "menuItems", stage: "offer", priority: 24, href: () => section("menu"), applies: (c) => c.isFood, met: (c) => c.rows.menuItems.length > 0 },
  { id: "tracks", stage: "offer", priority: 24, href: () => section("tracks"), applies: (c) => c.isMusic, met: (c) => c.rows.tracks.length > 0 || c.rows.releases.length > 0 },
  { id: "events", stage: "offer", priority: 24, href: () => "/dashboard/tickets", applies: (c) => c.isEventsCat, met: (c) => count(c.p.events) > 0 },
  {
    id: "catalog",
    stage: "offer",
    priority: 25,
    href: () => section("catalog"),
    // Only for businesses whose page is built around a catalogue, and only when the plan unlocks it.
    applies: (c) => c.catalogAllowed && !c.isFood && !c.isMusic && !c.isEventsCat && (c.group === "shop" || c.group === "service" || c.group === "creator"),
    met: (c) => c.rows.products.length > 0,
  },
  { id: "whatsapp", stage: "connect", priority: 30, href: () => section("whatsapp"), applies: () => true, met: (c) => filled(c.p.whatsapp_number) },
  {
    id: "location",
    stage: "discover",
    priority: 35,
    href: () => section("about"),
    applies: (c) => c.group === "food" || c.group === "shop" || c.group === "service" || c.group === "events",
    met: (c) => filled(c.p.about_location),
  },
  {
    id: "hours",
    stage: "discover",
    priority: 36,
    href: (c) => (c.isFood ? section("restaurant-settings") : section("about")),
    applies: (c) => c.isFood || (!!c.category && HOURS_CATEGORIES.has(c.category)),
    met: (c) => (c.isFood ? hasOpeningHours(c.p.opening_hours) : filled(c.p.about_hours)),
  },
  { id: "socials", stage: "connect", priority: 40, href: () => section("social-links"), applies: () => true, met: (c) => count(c.p.social_links) > 0 },
  { id: "links", stage: "connect", priority: 45, href: () => section("links"), applies: (c) => c.linksAllowed, met: (c) => c.rows.links.length > 0 },
];

export function evaluateCriteria(c: Ctx): HealthItem[] {
  return CRITERIA.filter((d) => d.applies(c)).map((d) => ({
    id: d.id,
    met: d.met(c),
    href: d.href(c),
    priority: d.priority,
    stage: d.stage,
    ...(d.id === "catalog" && c.catalogLabel ? { catalogLabel: c.catalogLabel } : {}),
  }));
}

/** True when this category (or its sub-type) ships a booking form — i.e. Bookings is a real feature for it. */
export function categoryHasBooking(c: Ctx): boolean {
  const cat = getCategory(c.category);
  if (!cat) return false;
  return !!cat.defaults.booking || !!getSubcategoryOption(c.category, c.p.subcategory)?.booking;
}

export function bookingsAllowed(plan: HealthPlan | null): boolean {
  return plan?.bookings_feature_enabled !== false;
}
