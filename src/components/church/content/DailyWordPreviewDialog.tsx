"use client";

import { useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { resolveWordLanguage, type PublicWord, type WordLang } from "@/lib/church/content/publicWord";
import DailyWordCard from "../DailyWordCard";
import { BTN_SECONDARY, Modal } from "../people/shared";

// Preview of a Daily Word exactly as the public page draws it (the same card), in either language, from what is on screen (saved or not). It is not public: no URL, no token, nothing leaves the dashboard.
export default function DailyWordPreviewDialog({ word, initialLanguage, onClose }: { word: PublicWord; initialLanguage: WordLang; onClose: () => void }) {
  const { t } = useLanguage();
  const c = t.churchContent.editor;
  const [lang, setLang] = useState<WordLang>(initialLanguage);
  const readable = resolveWordLanguage(word, lang) !== null;
  return (
    <Modal title={c.previewTitle} subtitle={c.previewNote} onClose={onClose} wide labelledBy="church-word-preview-title">
      <div role="group" aria-label={c.previewLanguage} className="inline-flex self-start rounded-full border border-ringo-border bg-ringo-surface p-1">
        {(["en", "fr"] as const).map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={lang === l}
            onClick={() => setLang(l)}
            className={`min-h-[40px] rounded-full px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40 ${lang === l ? "bg-ringo-indigo text-white" : "text-ringo-muted hover:text-ringo-text"}`}
          >
            {c.languages[l]}
          </button>
        ))}
      </div>
      <div className="rounded-3xl bg-ringo-bg p-3 text-ringo-text">
        {readable || resolveWordLanguage(word, lang === "en" ? "fr" : "en") ? (
          <DailyWordCard t={t} locale={lang} words={[word]} accent="#4F46E5" accentText="#4338CA" textColor="#14110A" borderTint="rgba(20,17,10,0.12)" radiusClass="rounded-2xl" />
        ) : (
          <p className="px-3 py-8 text-center text-sm text-ringo-muted">{c.previewEmpty}</p>
        )}
      </div>
      <button type="button" onClick={onClose} className={`${BTN_SECONDARY} self-end`}>
        {t.churchPeople.common.close}
      </button>
    </Modal>
  );
}
