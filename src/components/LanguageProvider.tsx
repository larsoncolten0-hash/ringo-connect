"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { translations, type Locale, type Translations } from "@/lib/i18n/translations";
import { FALLBACK_LOCALE, LOCALE_STORAGE_KEY, resolveInitialLocale } from "@/lib/i18n/locales";

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translations;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

// `initialLocale` is optional: the app never passes it (the visitor's saved/browser
// language is resolved after mount, as before); it exists so a page can be rendered
// in a given language on the server, and so tests can render either language.
export function LanguageProvider({ children, initialLocale }: { children: React.ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? FALLBACK_LOCALE);

  useEffect(() => {
    // Saved choice first, then the browser's language, then French (the primary
    // audience) — see resolveInitialLocale. Storage can throw (private browsing,
    // blocked site data); the app then simply uses the browser language.
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {
      // ignore
    }
    setLocaleState(resolveInitialLocale(saved, navigator.language));
  }, []);

  // Keep <html lang> in step with the visible language (it is a static "en" in the
  // root layout) so screen readers pronounce the page correctly and browsers offer
  // the right spellcheck/translation behaviour.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // the choice still applies for this visit
    }
  }, []);

  // Memoized so consumers only see a new context value when locale
  // actually changes, not on every render of whatever else is happening
  // in the tree above them.
  const value = useMemo(() => ({ locale, setLocale, t: translations[locale] }), [locale, setLocale]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within a LanguageProvider");
  return ctx;
}