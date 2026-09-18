import { translations, type Translations } from "@/lib/i18n/translations";

// Compile-time guard for the bilingual requirement. translations.ts ends with `satisfies Record<Locale, any>`,
// which does not compare the two languages. This assignment makes `tsc` / `next build` FAIL if the French
// Membership strings are missing a key (or have a different function signature) compared with English.
export const membershipI18nParity: Translations["association"]["membership"] = translations.fr.association.membership;
