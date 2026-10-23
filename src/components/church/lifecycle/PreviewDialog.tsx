"use client";

import { useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { BTN_SECONDARY, Modal } from "../people/shared";
import type { FormValues, Lang, LifecycleConfig } from "./types";

// Preview of an entry exactly as the public page draws it (the same card), in either language, from what is on screen (saved or not). It is not public: no URL, no token, nothing leaves the dashboard.
export default function PreviewDialog({ config, form, initialLanguage, onClose }: { config: LifecycleConfig; form: FormValues; initialLanguage: Lang; onClose: () => void }) {
  const { t } = useLanguage();
  const c = config.texts.editor;
  const [lang, setLang] = useState<Lang>(initialLanguage);
  const other: Lang = lang === "en" ? "fr" : "en";
  const readable = config.ready(form, lang) || config.ready(form, other);
  return (
    <Modal title={c.previewTitle} subtitle={c.previewNote} onClose={onClose} wide labelledBy={`${config.idPrefix}-preview-title`}>
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
      <div className="rounded-3xl bg-ringo-bg p-3 text-ringo-text">{readable ? config.renderPreview(form, lang, t) : <p className="px-3 py-8 text-center text-sm text-ringo-muted">{c.previewEmpty}</p>}</div>
      <button type="button" onClick={onClose} className={`${BTN_SECONDARY} self-end`}>
        {t.churchPeople.common.close}
      </button>
    </Modal>
  );
}
