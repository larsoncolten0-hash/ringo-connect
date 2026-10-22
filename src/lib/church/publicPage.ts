import { getSubcategoryOption, type CategoryId } from "@/lib/categories";

// Churches & Ministries, public page shell (Phase 1). Pure: no I/O, no React. Everything here is derived from fields a profile ALREADY has
// (about_hours, about_location, subcategory); no church-specific column exists yet and none is invented. A value that is not there is simply
// not shown: nothing in this file supplies a default, a sample or a placeholder.

export const CHURCH_CATEGORY: CategoryId = "church_ministries";

/** Planned public modules, in the order they will take on the church page. Only what already exists renders today; the rest are named here so the
 *  later phases drop into the same order instead of reshuffling the page. Nothing in this list is shown to a visitor by itself. */
export const CHURCH_MODULE_ORDER = ["visit", "daily_word", "events_announcements", "church_music", "church_store", "links", "contact"] as const;
export type ChurchModule = (typeof CHURCH_MODULE_ORDER)[number];

/** Modules with a live implementation today. "visit" is this phase; the store is the existing catalogue (labelled "Church Store"), events are the
 *  existing events section, links and contact are the shared sections. daily_word and church_music do not exist yet. */
export const CHURCH_LIVE_MODULES: readonly ChurchModule[] = ["visit", "events_announcements", "church_store", "links", "contact"];

const SEPARATORS = /\r?\n|\s[·•|]\s|;/;
const MAX_LINES = 8;
const MAX_LINE_LENGTH = 120;

const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** The free-text "Hours" field read as service times: one entry per line, or per " · ", " | " or ";" on a single line. Empty lines are dropped, very
 *  long input is capped so a pasted paragraph cannot take over the card. Returns [] when there is nothing to show. */
export function parseServiceTimes(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw
    .split(SEPARATORS)
    .map(clean)
    .filter(Boolean)
    .slice(0, MAX_LINES)
    .map((l) => (l.length > MAX_LINE_LENGTH ? `${l.slice(0, MAX_LINE_LENGTH - 1).trimEnd()}…` : l));
}

export interface ChurchVisit {
  serviceTimes: string[];
  location: string | null;
  /** A plain maps search link for the written location, or null. Built from the owner's own text only. */
  directionsUrl: string | null;
}

/** What the "Visit us" card shows, or null when the profile has neither service times nor a location (the card is then not rendered at all). */
export function getChurchVisit(profile: { about_hours?: unknown; about_location?: unknown } | null | undefined): ChurchVisit | null {
  if (!profile) return null;
  const serviceTimes = parseServiceTimes(profile.about_hours);
  const location = clean(profile.about_location) || null;
  if (serviceTimes.length === 0 && !location) return null;
  return {
    serviceTimes,
    location,
    directionsUrl: location ? `https://www.google.com/maps/search/${encodeURIComponent(location)}` : null,
  };
}

/** The ministry type shown under the name ("Local Church", "Choir"…). Only for a profile whose PRIMARY category is the church one (a sub-type belongs to
 *  its owning category, see categories.ts), and only when the stored value is one of the church sub-types. Otherwise null. */
export function getChurchTypeLabel(
  profile: { category?: string | null; subcategory?: string | null } | null | undefined,
  locale: "en" | "fr"
): string | null {
  if (!profile || profile.category !== CHURCH_CATEGORY || profile.subcategory === "other") return null; // "other" is a catch-all, not a label worth stating
  return getSubcategoryOption(CHURCH_CATEGORY, profile.subcategory)?.label[locale] ?? null;
}
