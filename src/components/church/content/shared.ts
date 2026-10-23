import type { Translations } from "@/lib/i18n/translations";

/** A sentence for a server code: the Content Studio's own codes first, then the shared church ones, then the generic one. A raw code is never shown. */
export function contentErrorText(t: Translations, code: string): string {
  const own = t.churchContent.errors as Record<string, string>;
  const shared = t.churchPeople.errors as Record<string, string>;
  return own[code] ?? shared[code] ?? shared.generic;
}
