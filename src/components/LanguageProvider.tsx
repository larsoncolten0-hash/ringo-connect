"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Locale, Translations } from "@/lib/i18n/translations";
import { fr } from "@/lib/i18n/translations.fr";
import { getLoadedDictionary } from "@/lib/i18n/dictionaryRegistry";
import { FALLBACK_LOCALE, LOCALE_STORAGE_KEY, resolveInitialLocale } from "@/lib/i18n/locales";

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translations;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

// Performance: the browser used to download BOTH languages (the whole of translations.ts) on every page. French is the platform's default language, so its dictionary is bundled
// here as before; English lives in its own chunk and is fetched only for a visitor who reads English (their saved choice, or an English browser: started the moment this module loads
// in the browser, in parallel with the rest of the page, not after hydration) or who switches to it. Until a language is loaded the visitor keeps seeing the one they have, and the
// switch happens in one step once it arrives: the language and its words never get out of step. Server rendering and the first render in the browser are French, exactly as
// before, so hydration matches. Tests (which import lib/i18n/translations.ts, the aggregate of both) find every dictionary already registered and switch synchronously.
const loaders: Record<Locale, () => Promise<Translations>> = {
  fr: () => Promise.resolve(fr),
  en: () => import("@/lib/i18n/translations.en").then((m) => m.en),
};

const pending: Partial<Record<Locale, Promise<Translations>>> = {};
function loadDictionary(locale: Locale): Promise<Translations> {
  const have = getLoadedDictionary(locale);
  if (have) return Promise.resolve(have);
  return (pending[locale] ??= loaders[locale]().catch((err) => {
    delete pending[locale]; // a failed download can be retried
    throw err;
  }));
}

// Server rendering (and the tests, which render either language with `initialLocale`) can have both dictionaries in memory: there is no download to avoid. The browser build removes
// this branch (`typeof window` is a constant there), so the English dictionary never enters a page's JavaScript through it.
function dictionaryOnServer(locale: Locale): Translations | undefined {
  if (typeof window === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return (require("@/lib/i18n/translations") as typeof import("@/lib/i18n/translations")).translations[locale];
  }
  return undefined;
}

function savedLocale(): string | null {
  try {
    return localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    return null; // private browsing / blocked site data: use the browser language
  }
}

// Browser only: a visitor who will be shown English starts downloading it immediately.
if (typeof window !== "undefined") {
  try {
    const wanted = resolveInitialLocale(savedLocale(), navigator.language);
    if (wanted !== FALLBACK_LOCALE) void loadDictionary(wanted).catch(() => {});
  } catch {
    // nothing to preload
  }
}

// `initialLocale` is optional: the app never passes it (the visitor's saved/browser
// language is resolved after mount, as before); it exists so a page can be rendered
// in a given language on the server, and so tests can render either language.
export function LanguageProvider({ children, initialLocale }: { children: React.ReactNode; initialLocale?: Locale }) {
  const startLocale = initialLocale ?? FALLBACK_LOCALE;
  const [locale, setLocaleState] = useState<Locale>(startLocale);
  // The words for the visible language. French is always in hand; any other language is registered once loaded (tests and server code load them through lib/i18n/translations.ts).
  const [dictionary, setDictionary] = useState<Translations>(() => dictionaryOnServer(startLocale) ?? getLoadedDictionary(startLocale) ?? fr);

  // Show `next` as soon as its dictionary is in hand: immediately when it already is, otherwise right after it has downloaded. A visit that has moved on to another choice in the
  // meantime wins (the latest request is applied last).
  const latest = useMemo(() => ({ n: 0 }), []);
  const show = useCallback(
    (next: Locale) => {
      const ticket = ++latest.n;
      const have = getLoadedDictionary(next);
      if (have) {
        setDictionary(have);
        setLocaleState(next);
        return;
      }
      loadDictionary(next)
        .then((d) => {
          if (ticket !== latest.n) return;
          setDictionary(d);
          setLocaleState(next);
        })
        .catch(() => {
          // the download failed (offline): stay in the language that is on screen
        });
    },
    [latest]
  );

  useEffect(() => {
    // Saved choice first, then the browser's language, then French (the primary
    // audience) — see resolveInitialLocale. Storage can throw (private browsing,
    // blocked site data); the app then simply uses the browser language.
    const saved = savedLocale();
    show(resolveInitialLocale(saved, navigator.language));
  }, [show]);

  // Keep <html lang> in step with the visible language (it is a static "en" in the
  // root layout) so screen readers pronounce the page correctly and browsers offer
  // the right spellcheck/translation behaviour.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    (next: Locale) => {
      show(next);
      try {
        localStorage.setItem(LOCALE_STORAGE_KEY, next);
      } catch {
        // the choice still applies for this visit
      }
    },
    [show]
  );

  // Memoized so consumers only see a new context value when locale
  // actually changes, not on every render of whatever else is happening
  // in the tree above them.
  const value = useMemo(() => ({ locale, setLocale, t: dictionary }), [locale, setLocale, dictionary]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within a LanguageProvider");
  return ctx;
}
