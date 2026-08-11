"use client";

import { useLanguage } from "@/components/LanguageProvider";

export default function LanguageToggle() {
  const { locale, setLocale } = useLanguage();

  return (
    <button
      onClick={() => setLocale(locale === "en" ? "fr" : "en")}
      aria-label="Switch language"
      className="w-9 h-9 flex items-center justify-center rounded-full text-xs font-medium text-ringo-muted hover:text-ringo-text hover:bg-ringo-muted/10 transition"
    >
      {locale === "en" ? "FR" : "EN"}
    </button>
  );
}