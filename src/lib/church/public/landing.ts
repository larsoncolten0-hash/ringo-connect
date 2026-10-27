// Churches & Ministries Phase 2: the landing pages ("See more") of a church's public site. Pure helpers plus fail-safe loaders that REUSE the profile's own loaders with a larger limit, so there is one
// definition of what is public for each module (published only, consent where it applies, expiry in Cameroon time) and nothing is duplicated.
//
//   /{username}/church/announcements   everything announced and still showing, this week's first
//   /{username}/church/events          every upcoming event
//   /{username}/church/testimonies     every testimony of this church week (Monday to Sunday)
//   /{username}/church/care            every published care case
//   /{username}/church/bible           every published Bible programme

import { loadPublicAnnouncements, loadPublicEvents, type PublicAnnouncement, type PublicEvent } from "./events";
import { loadPublicCare, type PublicCareCase } from "./care";
import { loadPublicPrograms, type PublicProgram } from "./bible";
import { loadPublicTestimoniesWeek, type PublicTestimony } from "./testimonies";

export const CHURCH_LANDING_KINDS = ["announcements", "events", "testimonies", "care", "bible"] as const;
export type ChurchLandingKind = (typeof CHURCH_LANDING_KINDS)[number];
export { groupAnnouncements } from "./events";
export const isLandingKind = (v: unknown): v is ChurchLandingKind => typeof v === "string" && (CHURCH_LANDING_KINDS as readonly string[]).includes(v);

/** How many entries a landing page reads at most (the profile's own cards show a handful). */
export const LANDING_LIMIT = 100;

/** The address of a landing page: /{username}/church/{kind}. */
export const landingPath = (username: string, kind: ChurchLandingKind): string => `/${encodeURIComponent(username)}/church/${kind}`;

type Reader = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }> };

export interface ChurchLandingData {
  announcements: PublicAnnouncement[];
  events: PublicEvent[];
  testimonies: PublicTestimony[];
  care: PublicCareCase[];
  programs: PublicProgram[];
}
export const EMPTY_LANDING: ChurchLandingData = { announcements: [], events: [], testimonies: [], care: [], programs: [] };

/** Loads ONE module's full list for its landing page. FAIL-SAFE: each loader gives [] on any error, so a landing page can show its empty state but never break. */
export async function loadChurchLanding(supabase: Reader, profileId: string, kind: ChurchLandingKind, now: number = Date.now()): Promise<ChurchLandingData> {
  const out: ChurchLandingData = { ...EMPTY_LANDING };
  if (kind === "announcements") out.announcements = await loadPublicAnnouncements(supabase, profileId, now, LANDING_LIMIT);
  else if (kind === "events") out.events = await loadPublicEvents(supabase, profileId, now, LANDING_LIMIT);
  else if (kind === "testimonies") out.testimonies = await loadPublicTestimoniesWeek(supabase, profileId, now);
  else if (kind === "care") out.care = await loadPublicCare(supabase, profileId, LANDING_LIMIT);
  else if (kind === "bible") out.programs = await loadPublicPrograms(supabase, profileId, LANDING_LIMIT);
  return out;
}
