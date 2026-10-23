import { loadPublicPrograms, type PublicProgram } from "./bible";
import { loadPublicMusic, type PublicMusicLink } from "./music";
import { loadPublicAnnouncements, loadPublicEvents, type PublicAnnouncement, type PublicEvent } from "./events";

// Everything a church's PUBLIC page shows beyond the Daily Word, loaded in one place (Phases 4-8). Each part is fail-safe on its own: a table that does not exist yet, a policy error or a
// timeout gives an empty part, never a broken page. The visitor's own session is used, so the database's public policies decide which rows exist for them.

export interface ChurchPublicExtras {
  events: PublicEvent[];
  announcements: PublicAnnouncement[];
  programs: PublicProgram[];
  music: PublicMusicLink[];
}

export const EMPTY_CHURCH_PUBLIC: ChurchPublicExtras = { events: [], announcements: [], programs: [], music: [] };

type Reader = { from(table: string): any };

export async function loadChurchPublic(supabase: Reader, profileId: string, now: number = Date.now()): Promise<ChurchPublicExtras> {
  try {
    const [events, announcements, programs, music] = await Promise.all([loadPublicEvents(supabase, profileId, now), loadPublicAnnouncements(supabase, profileId, now), loadPublicPrograms(supabase, profileId), loadPublicMusic(supabase, profileId)]);
    return { events, announcements, programs, music };
  } catch {
    return EMPTY_CHURCH_PUBLIC;
  }
}
