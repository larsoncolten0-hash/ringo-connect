import type { Translations } from "@/lib/i18n/translations";

/**
 * A sentence for a server code: the screen's own codes first (Events & Announcements, Bible, Attendance, Music), then the Daily Word ones, then the shared church ones, then the generic one.
 * A raw code is never shown.
 */
export function churchErrorText(t: Translations, code: string): string {
  const shared = t.churchPeople.errors as Record<string, string>;
  for (const ns of [t.churchEvents.errors, t.churchMusic.errors, t.churchAttendance.errors, t.churchBible.errors, t.churchContent.errors, t.churchReports.errors, t.churchCare.errors, t.churchTestimonies.errors, t.churchExpansion.errors, t.churchExpansion.features.errors, t.churchExpansion.counselling.errors, t.churchExpansion.giving.errors] as Record<string, string>[]) {
    if (ns[code]) return ns[code];
  }
  return shared[code] ?? shared.generic;
}
