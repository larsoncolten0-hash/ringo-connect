import { isUuid } from "../validation";

// What a visitor who is NOT signed in may read of a Bible programme (Phase 5): the published programme, its church's name and page, and its days. All of it is public content read through the visitor's own
// (anonymous) session, so the database's public policies decide which rows exist. Nothing about any participant is involved. FAIL-SAFE: any error, or anything not published, gives null (the page then
// says the programme is not available).

type Reader = { from(table: string): any };

export interface PublicJourney {
  program: { id: string; title_en: string | null; title_fr: string | null; description_en: string | null; description_fr: string | null };
  church: { username: string | null; name: string | null };
  sessions: { id: string; position: number; title_en: string | null; title_fr: string | null; scripture_ref_en: string | null; scripture_ref_fr: string | null; note_en: string | null; note_fr: string | null }[];
  enrollment: null;
  completed: string[];
  total: number;
  done: number;
}

export async function loadPublicJourney(supabase: Reader, programId: string): Promise<PublicJourney | null> {
  try {
    if (!isUuid(programId)) return null;
    const { data: program, error } = await supabase.from("bible_programs").select("id, profile_id, status, title_en, title_fr, description_en, description_fr").eq("id", programId).eq("status", "published").maybeSingle();
    if (error || !program || (program as { status?: string }).status !== "published") return null;
    const { data: church, error: e2 } = await supabase.from("profiles").select("username, name, published").eq("id", (program as { profile_id: string }).profile_id).maybeSingle();
    if (e2 || !church || (church as { published?: boolean }).published === false) return null;
    const { data: sessions, error: e3 } = await supabase
      .from("bible_program_sessions")
      .select("id, position, title_en, title_fr, scripture_ref_en, scripture_ref_fr, note_en, note_fr")
      .eq("program_id", programId)
      .order("position", { ascending: true })
      .limit(500);
    if (e3 || !Array.isArray(sessions)) return null;
    const p = program as Record<string, string | null>;
    return {
      program: { id: p.id as string, title_en: p.title_en, title_fr: p.title_fr, description_en: p.description_en, description_fr: p.description_fr },
      church: { username: (church as Record<string, string | null>).username, name: (church as Record<string, string | null>).name },
      sessions: sessions as PublicJourney["sessions"],
      enrollment: null,
      completed: [],
      total: sessions.length,
      done: 0,
    };
  } catch {
    return null;
  }
}
