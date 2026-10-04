import { translations, type Translations } from "@/lib/i18n/translations";

// Compile-time guard for the bilingual requirement on the guidance strings (same idea as
// src/lib/ai/i18nParity.ts for Ringo AI). `Translations` is derived from the English block, so this
// assignment makes `tsc` / `next build` FAIL if the French `guidance` strings are missing a key or
// have a different function signature than English.
export const guidanceI18nParity: Translations["guidance"] = translations.fr.guidance;
