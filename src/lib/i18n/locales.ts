import type { Locale } from "@/lib/i18n/translations";

// The languages a visitor can pick, in one place. It is a Record over the Locale
// type that translations.ts already defines, so adding a language later is
// exactly: add its block to translations.ts, then add ONE entry here — TypeScript
// refuses to compile until both exist, and every language selector picks it up.
//
// Labels are each language's own name ("Français", not "French") so a visitor can
// always find their language whichever one the page is currently in — the usual
// convention for language pickers, so they are deliberately NOT translated.
export const LOCALE_META: Record<Locale, { label: string; short: string }> = {
  en: { label: "English", short: "EN" },
  fr: { label: "Français", short: "FR" },
};

export const SUPPORTED_LOCALES = Object.keys(LOCALE_META) as Locale[];

/** localStorage key the whole app already uses for the chosen language. */
export const LOCALE_STORAGE_KEY = "ringo-lang";

/** The language used when nothing else says otherwise: this platform's audience is
 *  mainly French-speaking (see LanguageProvider's original default). */
export const FALLBACK_LOCALE: Locale = "fr";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LOCALE_META, value);
}

/** saved choice -> browser language -> fallback. A saved value that is not a
 *  supported language (stale, tampered, or a language since removed) is ignored. */
export function resolveInitialLocale(saved: unknown, browserLanguage: string | null | undefined): Locale {
  if (isLocale(saved)) return saved;
  const browser = (browserLanguage || "").toLowerCase();
  const match = SUPPORTED_LOCALES.find((code) => browser === code || browser.startsWith(`${code}-`));
  // Only an English browser flips the default away from French — same rule the
  // provider always had; other languages fall back to FALLBACK_LOCALE until they exist.
  return match === "en" ? "en" : FALLBACK_LOCALE;
}

/** Next highlighted option for a listbox keyboard event (wraps; Home/End jump). */
export function listboxNextIndex(key: string, active: number, length: number): number {
  if (length <= 0) return 0;
  switch (key) {
    case "ArrowDown":
      return (active + 1) % length;
    case "ArrowUp":
      return (active - 1 + length) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return active;
  }
}
