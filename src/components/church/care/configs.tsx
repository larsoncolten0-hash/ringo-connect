"use client";

import { useMemo } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { CARE_CATEGORY_IDS, type CareCategoryId, type PublicCareCase } from "@/lib/church/public/care";
import ChurchCareCard from "../ChurchCareCard";
import type { FieldDef, FormValues, LifecycleConfig } from "../lifecycle/types";

// The Care & Support screens are the shared lifecycle list / editor (src/components/church/lifecycle) with this config: which fields, when a language is ready to publish, and the public card drawn in
// the preview. The texts live in translations (churchCare.cases). Nothing here involves money.

const PREVIEW_ID = "00000000-0000-4000-8000-000000000000";
const THEME = { accent: "#4F46E5", accentText: "#4338CA", textColor: "#14110A", borderTint: "rgba(20,17,10,0.12)", radiusClass: "rounded-2xl" };
const s = (form: FormValues, k: string): string => (typeof form[k] === "string" ? (form[k] as string) : "");
const filled = (v: string) => v.trim() !== "";
const orNull = (v: string): string | null => (filled(v) ? v : null);

const CARE_FIELDS: FieldDef[] = [
  { key: "category", kind: "select", choices: CARE_CATEGORY_IDS },
  { key: "image_url", kind: "image" },
  { key: "image_consent", kind: "checkbox", visibleWhen: "image_url" },
  { key: "title", bilingual: true, kind: "text", max: 120 },
  { key: "summary", bilingual: true, kind: "textarea", max: 2000, rows: 7 },
];

export function useCareConfig(): LifecycleConfig {
  const { t } = useLanguage();
  return useMemo<LifecycleConfig>(
    () => ({
      apiPath: "/api/church/care",
      pagePath: "/dashboard/church/care",
      idPrefix: "cc",
      texts: t.churchCare.cases,
      views: ["all", "drafts", "published"],
      fields: CARE_FIELDS,
      ready: (form, lang) => filled(s(form, `title_${lang}`)) && filled(s(form, `summary_${lang}`)),
      blank: () => ({ category: "other", image_url: "", image_consent: false, title_en: "", title_fr: "", summary_en: "", summary_fr: "" }),
      renderPreview: (form, lang, tr) => {
        const category = (CARE_CATEGORY_IDS as readonly string[]).includes(s(form, "category")) ? (s(form, "category") as CareCategoryId) : "other";
        const c: PublicCareCase = { id: PREVIEW_ID, category, title_en: orNull(s(form, "title_en")), title_fr: orNull(s(form, "title_fr")), summary_en: orNull(s(form, "summary_en")), summary_fr: orNull(s(form, "summary_fr")), image_url: form.image_consent === true ? orNull(s(form, "image_url")) : null };
        return <ChurchCareCard t={tr} locale={lang} cases={[c]} {...THEME} />;
      },
      subline: (row) => (t.churchCare.categories as Record<string, string>)[row.category] ?? "",
      rowTitle: (row, locale) => (locale === "fr" ? row.title_fr || row.title_en : row.title_en || row.title_fr) || "",
      stateTone: { draft: "inactive", published: "active" },
      caps: { view: (c) => c.viewCare, manage: (c) => c.manageCare, publish: (c) => c.publishCare },
      extraBadges: (row) => [(t.churchCare.cases.consentBadge as Record<string, string>)[row.consent_state] ?? ""].filter(Boolean),
    }),
    [t]
  );
}
