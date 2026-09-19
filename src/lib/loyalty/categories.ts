import { isCategoryId, type CategoryId } from "@/lib/categories";

// Which loyalty options each Ringo category is offered. ONE universal engine
// underneath (visits | spend | points, plus packages); this registry only decides
// what a given kind of business sees, so a barber is asked "how many haircuts?" and
// an artist is never asked about "visits".
//
// This file holds KEYS only, never display text. Every label (action names, program
// type names, availability copy) lives in src/lib/i18n/translations.ts in English
// and French and is looked up by these keys, e.g. t.loyalty.actions[key].

export const LOYALTY_ACTION_KEYS = [
  "meal",
  "drink",
  "visit",
  "haircut",
  "treatment",
  "styling",
  "session",
  "class",
  "purchase",
  "ticket",
  "merch",
  "trip",
  "booking",
  "service",
  "stay",
] as const;

export type LoyaltyActionKey = (typeof LOYALTY_ACTION_KEYS)[number];
export type LoyaltyProgramType = "visits" | "spend" | "points";
export type LoyaltyAvailability = "recommended" | "optional" | "hidden";

// Spend and points programs use a fixed action key of their own.
export const SPEND_ACTION_KEY = "spend";
export const POINTS_ACTION_KEY = "points";

interface CategoryLoyalty {
  availability: LoyaltyAvailability;
  actions: LoyaltyActionKey[];
  programTypes: LoyaltyProgramType[];
  packages: boolean;
}

const GENERIC: CategoryLoyalty = { availability: "optional", actions: ["visit"], programTypes: ["visits", "spend"], packages: false };

const BY_CATEGORY: Partial<Record<CategoryId, CategoryLoyalty>> = {
  restaurant_food: { availability: "recommended", actions: ["meal", "drink", "visit"], programTypes: ["visits", "spend", "points"], packages: true },
  beauty_wellness: { availability: "recommended", actions: ["haircut", "treatment", "styling", "visit"], programTypes: ["visits", "spend", "points"], packages: true },
  health_medical: { availability: "optional", actions: ["visit", "session", "class"], programTypes: ["visits", "spend"], packages: true },
  music_entertainment: { availability: "optional", actions: ["purchase", "ticket", "merch"], programTypes: ["visits", "spend"], packages: false },
  transport_logistics: { availability: "recommended", actions: ["trip", "booking"], programTypes: ["visits", "spend"], packages: true },
  business_ecommerce: { availability: "recommended", actions: ["purchase"], programTypes: ["visits", "spend", "points"], packages: false },
  professional_services: { availability: "optional", actions: ["service", "booking"], programTypes: ["visits", "spend"], packages: false },
  travel_hospitality: { availability: "optional", actions: ["stay", "booking"], programTypes: ["visits", "spend"], packages: false },
  // Traditional loyalty does not fit; referrals may come later. Nothing is offered by default.
  real_estate: { availability: "hidden", actions: [], programTypes: [], packages: false },
};

export interface LoyaltyOptions {
  availability: LoyaltyAvailability;
  actions: LoyaltyActionKey[];
  programTypes: LoyaltyProgramType[];
  packages: boolean;
}

/**
 * What this profile may set up. A profile can carry several categories (a primary one
 * plus extras); the options are the union of all of them, ignoring "hidden" ones, so a
 * business that is both a restaurant and a property lister still gets restaurant options.
 * A profile whose only categories are hidden ones gets availability "hidden" and nothing.
 */
export function getLoyaltyOptions(
  profile: { category?: string | null; categories?: string[] | null } | null | undefined
): LoyaltyOptions {
  const ids: CategoryId[] = [];
  const push = (value: unknown) => {
    if (isCategoryId(value) && !ids.includes(value)) ids.push(value);
  };
  push(profile?.category);
  for (const c of profile?.categories ?? []) push(c);
  if (ids.length === 0) ids.push("other");

  const actions: LoyaltyActionKey[] = [];
  const programTypes: LoyaltyProgramType[] = [];
  let packages = false;
  let recommended = false;
  let anyVisible = false;

  for (const id of ids) {
    const cfg = BY_CATEGORY[id] ?? GENERIC;
    if (cfg.availability === "hidden") continue;
    anyVisible = true;
    if (cfg.availability === "recommended") recommended = true;
    for (const a of cfg.actions) if (!actions.includes(a)) actions.push(a);
    for (const t of cfg.programTypes) if (!programTypes.includes(t)) programTypes.push(t);
    packages = packages || cfg.packages;
  }

  return {
    availability: !anyVisible ? "hidden" : recommended ? "recommended" : "optional",
    actions,
    programTypes,
    packages,
  };
}

export function isLoyaltyActionKey(value: unknown): value is LoyaltyActionKey {
  return typeof value === "string" && (LOYALTY_ACTION_KEYS as readonly string[]).includes(value);
}

/** Whether this profile may create a program of this type/action. Enforced server-side on create. */
export function isProgramAllowed(options: LoyaltyOptions, type: LoyaltyProgramType, actionKey: string): boolean {
  if (!options.programTypes.includes(type)) return false;
  if (type === "spend") return actionKey === SPEND_ACTION_KEY;
  if (type === "points") return actionKey === POINTS_ACTION_KEY;
  return isLoyaltyActionKey(actionKey) && options.actions.includes(actionKey);
}

/** Whether this profile may include this action in a package. Enforced server-side on create. */
export function isPackageActionAllowed(options: LoyaltyOptions, actionKey: string): boolean {
  return options.packages && isLoyaltyActionKey(actionKey) && options.actions.includes(actionKey);
}
