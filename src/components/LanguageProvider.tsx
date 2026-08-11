"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { translations, type Locale, type Translations } from "@/lib/i18n/translations";

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translations;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const saved = localStorage.getItem("ringo-lang");
    if (saved === "en" || saved === "fr") {
      setLocaleState(saved);
      return;
    }
    // Fall back to the browser's language on first visit.
    setLocaleState(navigator.language.toLowerCase().startsWith("fr") ? "fr" : "en");
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    localStorage.setItem("ringo-lang", next);
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