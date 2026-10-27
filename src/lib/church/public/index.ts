import { loadPublicPrograms, type PublicProgram } from "./bible";
import { loadPublicMusic, type PublicMusicLink } from "./music";
import { loadPublicCare, type PublicCareCase } from "./care";
import { loadPublicTestimonies, type PublicTestimony } from "./testimonies";
import { loadPublicAnnouncements, loadPublicEvents, type PublicAnnouncement, type PublicEvent } from "./events";
import { loadPublicGroups, loadPublicPastors, type PublicGroup, type PublicPastor } from "./groups";
import { loadPublicFeatures, NO_FEATURES, type PublicFeatures } from "./features";

// Everything a church's PUBLIC page shows beyond the Daily Word, loaded in one place (Phases 4-8). Each part is fail-safe on its own: a table that does not exist yet, a policy error or a
// timeout gives an empty part, never a broken page. The visitor's own session is used, so the database's public policies decide which rows exist for them.

export interface ChurchPublicExtras {
  events: PublicEvent[];
  announcements: PublicAnnouncement[];
  programs: PublicProgram[];
  music: PublicMusicLink[];
  /** Care & Support cases the church published with the beneficiary's recorded consent (Phase 9). Display only: no money. */
  care: PublicCareCase[];
  /** Approved, published testimonies whose submitters consented (name only with name consent). */
  testimonies: PublicTestimony[];
  /** The published Men / Women / Youths / Children pages (a presentation: no member, no count). */
  groups: PublicGroup[];
  /** The published pastors (the Pastors page shows them in full). */
  pastors: PublicPastor[];
  /** The church's feature switches (Bible in one year, counselling, giving): every one is off until the owner switches it on. */
  features: PublicFeatures;
}

export const EMPTY_CHURCH_PUBLIC: ChurchPublicExtras = { events: [], announcements: [], programs: [], music: [], care: [], testimonies: [], groups: [], pastors: [], features: NO_FEATURES };

type Reader = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }> };

export async function loadChurchPublic(supabase: Reader, profileId: string, now: number = Date.now()): Promise<ChurchPublicExtras> {
  try {
    const [events, announcements, programs, music, care, testimonies, groups, pastors, features] = await Promise.all([loadPublicEvents(supabase, profileId, now), loadPublicAnnouncements(supabase, profileId, now), loadPublicPrograms(supabase, profileId), loadPublicMusic(supabase, profileId), loadPublicCare(supabase, profileId), loadPublicTestimonies(supabase, profileId, now), loadPublicGroups(supabase, profileId), loadPublicPastors(supabase, profileId).then((r) => r.pastors), loadPublicFeatures(supabase, profileId)]);
    return { events, announcements, programs, music, care, testimonies, groups, pastors, features };
  } catch {
    return EMPTY_CHURCH_PUBLIC;
  }
}
