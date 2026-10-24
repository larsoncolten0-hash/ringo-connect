import { loadPublicPrograms, type PublicProgram } from "./bible";
import { loadPublicMusic, type PublicMusicLink } from "./music";
import { loadPublicCare, type PublicCareCase } from "./care";
import { loadPublicTestimonies, type PublicTestimony } from "./testimonies";
import { loadPublicAnnouncements, loadPublicEvents, type PublicAnnouncement, type PublicEvent } from "./events";

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
}

export const EMPTY_CHURCH_PUBLIC: ChurchPublicExtras = { events: [], announcements: [], programs: [], music: [], care: [], testimonies: [] };

type Reader = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }> };

export async function loadChurchPublic(supabase: Reader, profileId: string, now: number = Date.now()): Promise<ChurchPublicExtras> {
  try {
    const [events, announcements, programs, music, care, testimonies] = await Promise.all([loadPublicEvents(supabase, profileId, now), loadPublicAnnouncements(supabase, profileId, now), loadPublicPrograms(supabase, profileId), loadPublicMusic(supabase, profileId), loadPublicCare(supabase, profileId), loadPublicTestimonies(supabase, profileId)]);
    return { events, announcements, programs, music, care, testimonies };
  } catch {
    return EMPTY_CHURCH_PUBLIC;
  }
}
