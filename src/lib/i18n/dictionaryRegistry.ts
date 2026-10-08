import type { Locale, Translations } from "@/lib/i18n/translations";

// Where a loaded language registers itself. The visible language's dictionary is plain data; keeping each language in its OWN module lets the browser download only the language a
// visitor reads (the other one is fetched when, and only when, it is needed: see components/LanguageProvider.tsx). Server code and tests keep importing the one aggregate
// (lib/i18n/translations.ts), which imports both, so nothing there changes.
const loaded: Partial<Record<Locale, Translations>> = {};

export function registerDictionary(locale: Locale, dictionary: Translations): void {
  loaded[locale] = dictionary;
}

/** The dictionary for a language, when it has already been loaded in this runtime. */
export function getLoadedDictionary(locale: Locale): Translations | undefined {
  return loaded[locale];
}
