"use client";

import { useMemo } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import type { PublicProgram } from "@/lib/church/public/bible";
import ChurchBibleCard from "../ChurchBibleCard";
import type { FieldDef, FormValues, LifecycleConfig } from "../lifecycle/types";

// The Bible programmes screens are the shared lifecycle list / editor (src/components/church/lifecycle) with this config: which fields, when a language is ready to publish, and the public card drawn in
// the preview. The days of a programme (sessions) and the participant counts live in SessionsPanel, shown under the editor once the programme is saved.

const PREVIEW_ID = "00000000-0000-4000-8000-000000000000";
const THEME = { accent: "#4F46E5", accentText: "#4338CA", textColor: "#14110A", borderTint: "rgba(20,17,10,0.12)", radiusClass: "rounded-2xl" };
const s = (form: FormValues, k: string): string => (typeof form[k] === "string" ? (form[k] as string) : "");
const filled = (v: string) => v.trim() !== "";
const orNull = (v: string): string | null => (filled(v) ? v : null);

const FIELDS: FieldDef[] = [
  { key: "title", bilingual: true, kind: "text", max: 120 },
  { key: "description", bilingual: true, kind: "textarea", max: 2000, rows: 6, optional: true },
];

export function useProgramsConfig(): LifecycleConfig {
  const { t } = useLanguage();
  return useMemo<LifecycleConfig>(
    () => ({
      apiPath: "/api/church/bible",
      pagePath: "/dashboard/church/bible",
      idPrefix: "cb",
      texts: t.churchBible.programs,
      views: ["all", "drafts", "published"],
      fields: FIELDS,
      ready: (form, lang) => filled(s(form, `title_${lang}`)),
      blank: () => ({ title_en: "", title_fr: "", description_en: "", description_fr: "" }),
      renderPreview: (form, lang, tr) => {
        const p: PublicProgram = {
          id: PREVIEW_ID,
          title_en: orNull(s(form, "title_en")), title_fr: orNull(s(form, "title_fr")),
          description_en: orNull(s(form, "description_en")), description_fr: orNull(s(form, "description_fr")),
          session_count: 0, // the preview draws the card without a day count: the days are edited below
        };
        return <ChurchBibleCard t={tr} locale={lang} programs={[p]} preview {...THEME} />;
      },
      subline: (row) => t.churchBible.programs.list.sessions(Number(row.session_count ?? 0)),
      rowTitle: (row, locale) => (locale === "fr" ? row.title_fr || row.title_en : row.title_en || row.title_fr) || "",
      stateTone: { draft: "inactive", published: "active" },
      caps: { view: (c) => c.viewBible, manage: (c) => c.manageBible, publish: (c) => c.publishBible },
    }),
    [t]
  );
}
